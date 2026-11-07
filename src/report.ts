import type { ClaimCheck, Evidence } from './types.js';

const MAX_LISTED = 40;

function list(lines: string[]): string {
  if (lines.length === 0) return '_none_\n';
  const shown = lines.slice(0, MAX_LISTED).map((l) => `- ${l}`).join('\n');
  const rest = lines.length > MAX_LISTED ? `\n- _and ${lines.length - MAX_LISTED} more_` : '';
  return `${shown}${rest}\n`;
}

/** A reviewable summary. Disagreements first, because that is what a person is for. */
export function renderClaimReport(check: ClaimCheck, evidence: Evidence): string {
  const out: string[] = [];
  out.push(`# Evidence report`);
  out.push('');
  out.push(`Workspace \`${check.root}\``);
  out.push(`Checkpoint \`${check.checkpointId}\` taken ${evidence.from}, compared against ${evidence.to}.`);
  out.push('');
  out.push(
    `**${check.counts.unreported} unreported · ${check.counts.contradicted} contradicted · ${check.counts.confirmed} confirmed · ${check.counts.unverifiable} unverifiable**`,
  );
  out.push('');

  out.push('## Unreported: observed on disk, never mentioned');
  out.push(list(check.unreported.map((c) => `\`${c.path}\` (${c.kind}${c.differs ? `, ${c.differs.join(' and ')} differ` : ''})`)));

  out.push('## Contradicted: claimed, but nothing changed');
  out.push(list(check.contradicted.map((c) => `\`${c.path}\` — ${c.reason}`)));

  out.push('## Unverifiable: outside what this record can settle');
  out.push(list(check.unverifiable.map((c) => `${c.claim} — ${c.reason}`)));

  out.push('## Confirmed: claimed and observed');
  out.push(list(check.confirmed.map((c) => `\`${c.path}\` (${c.kind})`)));

  out.push('## Git');
  if (!evidence.git.after.available) {
    out.push('_no repository found_\n');
  } else {
    out.push(`- HEAD ${evidence.git.headChanged ? `changed: \`${evidence.git.before.head ?? 'none'}\` to \`${evidence.git.after.head ?? 'none'}\`` : `unchanged (\`${evidence.git.after.head ?? 'none'}\`)`}`);
    out.push(`- branch \`${evidence.git.after.branch ?? 'unknown'}\``);
    out.push(`- working tree entries now: ${evidence.git.after.porcelain?.length ?? 0}`);
    out.push('');
  }

  if (check.caveats.length > 0) {
    out.push('## What this report does not cover');
    out.push(list(check.caveats));
  }

  out.push('---');
  out.push(
    'Observed facts come from the filesystem and the git repository. Claims come from the agent. They are reported separately and never merged.',
  );
  return out.join('\n');
}

/** The same discipline, without any claims to compare against. */
export function renderEvidenceReport(evidence: Evidence): string {
  const out: string[] = [];
  out.push('# Observed changes');
  out.push('');
  out.push(`Workspace \`${evidence.root}\``);
  out.push(`Checkpoint \`${evidence.checkpointId}\` taken ${evidence.from}, compared against ${evidence.to}.`);
  out.push('');
  out.push(
    `**${evidence.counts.added} added · ${evidence.counts.modified} modified · ${evidence.counts.deleted} deleted · ${evidence.counts.unchanged} unchanged**`,
  );
  out.push('');
  for (const kind of ['added', 'modified', 'deleted'] as const) {
    const rows = evidence.changes.filter((c) => c.kind === kind);
    out.push(`## ${kind[0].toUpperCase()}${kind.slice(1)}`);
    out.push(list(rows.map((c) => `\`${c.path}\`${c.differs ? ` (${c.differs.join(' and ')} differ)` : ''}`)));
  }
  if (evidence.caveats.length > 0) {
    out.push('## What this report does not cover');
    out.push(list(evidence.caveats));
  }
  return out.join('\n');
}
