/**
 * Shared types.
 *
 * The vocabulary here is deliberate. A `FileFact` is something observed on the
 * machine. A `Claim` is something the agent said. They are never merged into a
 * single structure, because the whole point of this server is that they are
 * different kinds of thing.
 */

/** What was observed about one file at snapshot time. No interpretation. */
export interface FileFact {
  /** Size in bytes. */
  size: number;
  /** Last modification time, epoch milliseconds. */
  mtimeMs: number;
  /** SHA-256 of the contents, or null when the file was not hashed. */
  sha256: string | null;
  /** Why sha256 is null, when it is. */
  notHashed?: 'too-large' | 'unreadable';
}

/** Git facts, read from the repository rather than from the agent. */
export interface GitFacts {
  available: boolean;
  head?: string;
  branch?: string;
  /** Lines of `git status --porcelain=v1`, verbatim. */
  porcelain?: string[];
  /** Present when git was expected but could not be read. */
  error?: string;
}

/** The observed state of a workspace at one moment. */
export interface Snapshot {
  root: string;
  takenAt: string;
  /** Workspace-relative POSIX paths to observed facts. */
  files: Record<string, FileFact>;
  git: GitFacts;
  /** True when a cap stopped the walk before it finished. */
  truncated: boolean;
  /** Reason for truncation, when truncated. */
  truncatedReason?: string;
  /** Directory names skipped by the ignore list. */
  ignored: string[];
}

/** A stored checkpoint: a snapshot plus its identity. */
export interface Checkpoint {
  id: string;
  label?: string;
  snapshot: Snapshot;
  /** Version of the on-disk format. */
  formatVersion: 1;
}

/** How one path changed between two snapshots. */
export interface Change {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  /** Which signals differed. Empty for added and deleted. */
  differs?: Array<'content' | 'size' | 'mtime'>;
  sizeBefore?: number;
  sizeAfter?: number;
}

/** The observed difference between a checkpoint and now. */
export interface Evidence {
  checkpointId: string;
  root: string;
  from: string;
  to: string;
  changes: Change[];
  counts: { added: number; modified: number; deleted: number; unchanged: number };
  git: {
    before: GitFacts;
    after: GitFacts;
    headChanged: boolean;
  };
  caveats: string[];
}

/**
 * The four-way separation. Observed fact, inference, uncertainty and claimed
 * completion are kept apart, because collapsing them is what makes an agent's
 * report read as evidence when it is not.
 */
export interface ClaimCheck {
  checkpointId: string;
  root: string;
  /** Claimed and observed to have changed. */
  confirmed: Array<{ path: string; kind: Change['kind'] }>;
  /** Claimed, but nothing on disk changed. */
  contradicted: Array<{ path: string; reason: string }>;
  /** Observed to have changed, and never mentioned. */
  unreported: Change[];
  /** Nothing in the filesystem or git record can settle these either way. */
  unverifiable: Array<{ claim: string; reason: string }>;
  counts: { confirmed: number; contradicted: number; unreported: number; unverifiable: number };
  caveats: string[];
}
