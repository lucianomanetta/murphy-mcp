import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { opendir, lstat, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { FileFact, Snapshot } from './types.js';
import { readGitFacts } from './git.js';

/**
 * Directories skipped by default.
 *
 * This list is short on purpose. Build output, caches, lockfiles and generated
 * artifacts are exactly the writes an agent tends to leave out of its account,
 * so ignoring `dist`, `.next`, `target` or `coverage` would hide the findings
 * this server exists to surface. Only the version-control internals, the
 * dependency tree and this server's own store are skipped.
 */
export const DEFAULT_IGNORED_DIRS = ['.git', 'node_modules', '.murphy'];

export interface SnapshotOptions {
  /** Extra directory names to skip, matched on a single path segment. */
  ignore?: string[];
  /** Skip the default ignore list. Off by default. */
  noDefaultIgnores?: boolean;
  /** Stop after this many files. Default 50000. */
  maxFiles?: number;
  /** Do not hash files larger than this. Default 8 MiB. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILES = 50_000;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

async function sha256OfFile(absolute: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((done, fail) => {
    const stream = createReadStream(absolute);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', fail);
    stream.on('end', () => done());
  });
  return hash.digest('hex');
}

/** Workspace-relative POSIX path, so a checkpoint reads the same on any OS. */
function toPosixRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

/**
 * Walks the workspace and records what is actually on disk.
 *
 * Symbolic links are recorded as links and never followed. Following them
 * would let a snapshot wander outside the root, and an evidence tool that
 * cannot say where it looked is not evidence.
 */
export async function takeSnapshot(rootInput: string, options: SnapshotOptions = {}): Promise<Snapshot> {
  const root = await realpath(resolve(rootInput));
  const stats = await lstat(root);
  if (!stats.isDirectory()) {
    throw new Error(`root is not a directory: ${root}`);
  }

  const ignored = new Set<string>([
    ...(options.noDefaultIgnores ? [] : DEFAULT_IGNORED_DIRS),
    ...(options.ignore ?? []),
  ]);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const files: Record<string, FileFact> = {};
  let count = 0;
  let truncated = false;
  let truncatedReason: string | undefined;

  const queue: string[] = [root];
  while (queue.length > 0 && !truncated) {
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await opendir(dir);
    } catch {
      continue;
    }
    for await (const entry of entries) {
      if (truncated) break;
      const absolute = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        // Recorded as present, never followed and never hashed.
        files[toPosixRelative(root, absolute)] = { size: 0, mtimeMs: 0, sha256: null, notHashed: 'unreadable' };
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;

      if (count >= maxFiles) {
        truncated = true;
        truncatedReason = `stopped at maxFiles=${maxFiles}; the snapshot is incomplete and any comparison drawn from it is partial`;
        break;
      }

      let fact: FileFact;
      try {
        const st = await lstat(absolute);
        if (st.size > maxFileBytes) {
          fact = { size: st.size, mtimeMs: st.mtimeMs, sha256: null, notHashed: 'too-large' };
        } else {
          fact = { size: st.size, mtimeMs: st.mtimeMs, sha256: await sha256OfFile(absolute) };
        }
      } catch {
        fact = { size: 0, mtimeMs: 0, sha256: null, notHashed: 'unreadable' };
      }
      files[toPosixRelative(root, absolute)] = fact;
      count += 1;
    }
  }

  return {
    root,
    takenAt: new Date().toISOString(),
    files,
    git: await readGitFacts(root),
    truncated,
    truncatedReason,
    ignored: [...ignored].sort(),
  };
}
