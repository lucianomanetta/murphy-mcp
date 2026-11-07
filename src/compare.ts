import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Change, Checkpoint, ClaimCheck, Evidence, Snapshot } from './types.js';

/** Normalises whatever the agent said into a workspace-relative POSIX path. */
function normaliseClaimedPath(root: string, claimed: string): { path: string; outsideRoot: boolean } {
  const cleaned = claimed.trim().replace(/^["']|["']$/g, '');
  const absolute = isAbsolute(cleaned) ? resolve(cleaned) : resolve(root, cleaned);
  const rel = relative(resolve(root), absolute).split(sep).join('/');
  return { path: rel, outsideRoot: rel.startsWith('../') || rel === '' };
}

function collectCaveats(before: Snapshot, after: Snapshot): string[] {
  const caveats: string[] = [];
  if (before.truncated) caveats.push(`the checkpoint was truncated: ${before.truncatedReason}`);
  if (after.truncated) caveats.push(`the current scan was truncated: ${after.truncatedReason}`);
  if (!before.git.available) caveats.push('no git repository was found, so the git signal is absent');
  const unhashed = Object.values(after.files).filter((f) => f.sha256 === null).length;
  if (unhashed > 0) {
    caveats.push(
      `${unhashed} file(s) were not hashed because they were too large or unreadable; for those, a change is inferred from size and mtime and is weaker evidence`,
    );
  }
  if (before.ignored.length > 0) caveats.push(`these directory names were not scanned: ${before.ignored.join(', ')}`);
  return caveats;
}

/** Compares two observed states. Nothing here depends on what any agent said. */
export function diffSnapshots(checkpointId: string, before: Snapshot, after: Snapshot): Evidence {
  const changes: Change[] = [];
  let unchanged = 0;

  for (const [path, was] of Object.entries(before.files)) {
    const now = after.files[path];
    if (!now) {
      changes.push({ path, kind: 'deleted', sizeBefore: was.size });
      continue;
    }
    const differs: Array<'content' | 'size' | 'mtime'> = [];
    if (was.sha256 !== null && now.sha256 !== null) {
      if (was.sha256 !== now.sha256) differs.push('content');
    } else {
      if (was.size !== now.size) differs.push('size');
      if (was.mtimeMs !== now.mtimeMs) differs.push('mtime');
    }
    if (differs.length > 0) {
      changes.push({ path, kind: 'modified', differs, sizeBefore: was.size, sizeAfter: now.size });
    } else {
      unchanged += 1;
    }
  }

  for (const [path, now] of Object.entries(after.files)) {
    if (!(path in before.files)) changes.push({ path, kind: 'added', sizeAfter: now.size });
  }

  changes.sort((a, b) => a.path.localeCompare(b.path));

  return {
    checkpointId,
    root: after.root,
    from: before.takenAt,
    to: after.takenAt,
    changes,
    counts: {
      added: changes.filter((c) => c.kind === 'added').length,
      modified: changes.filter((c) => c.kind === 'modified').length,
      deleted: changes.filter((c) => c.kind === 'deleted').length,
      unchanged,
    },
    git: {
      before: before.git,
      after: after.git,
      headChanged: before.git.head !== after.git.head,
    },
    caveats: collectCaveats(before, after),
  };
}

/**
 * Holds the agent's account against the observed record.
 *
 * `unreported` is the finding that matters most and the reason this tool
 * exists: a write that happened and was never mentioned. `unverifiable` is
 * stated explicitly instead of being quietly guessed, because presenting a
 * guess at the same confidence as a fact is the failure this is meant to stop.
 */
export function checkClaims(
  checkpoint: Checkpoint,
  evidence: Evidence,
  claimedPaths: string[],
  claimedStatements: string[],
): ClaimCheck {
  const root = evidence.root;
  const changeByPath = new Map(evidence.changes.map((c) => [c.path, c]));

  const confirmed: ClaimCheck['confirmed'] = [];
  const contradicted: ClaimCheck['contradicted'] = [];
  const unverifiable: ClaimCheck['unverifiable'] = [];
  const claimedSet = new Set<string>();

  for (const raw of claimedPaths) {
    const { path, outsideRoot } = normaliseClaimedPath(root, raw);
    if (outsideRoot) {
      unverifiable.push({
        claim: raw,
        reason: `resolves outside the observed workspace (${root}), so this server never looked at it`,
      });
      continue;
    }
    claimedSet.add(path);
    const change = changeByPath.get(path);
    if (change) {
      confirmed.push({ path, kind: change.kind });
    } else if (path in checkpoint.snapshot.files) {
      contradicted.push({ path, reason: 'the file existed at checkpoint time and is byte-identical now' });
    } else {
      contradicted.push({ path, reason: 'no such file at checkpoint time and none now' });
    }
  }

  const unreported = evidence.changes.filter((c) => !claimedSet.has(c.path));

  for (const statement of claimedStatements) {
    unverifiable.push({
      claim: statement,
      reason: 'a filesystem and git record cannot settle this; it needs its own evidence',
    });
  }

  return {
    checkpointId: evidence.checkpointId,
    root,
    confirmed,
    contradicted,
    unreported,
    unverifiable,
    counts: {
      confirmed: confirmed.length,
      contradicted: contradicted.length,
      unreported: unreported.length,
      unverifiable: unverifiable.length,
    },
    caveats: evidence.caveats,
  };
}
