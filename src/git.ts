import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitFacts } from './types.js';

const run = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.toString();
}

/**
 * Reads git facts from the repository itself.
 *
 * A workspace with no repository is a normal case, not an error: the server
 * simply has one fewer independent signal, and says so.
 */
export async function readGitFacts(root: string): Promise<GitFacts> {
  try {
    await git(root, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { available: false };
  }

  const facts: GitFacts = { available: true };
  try {
    facts.head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    // A repository with no commits yet has no HEAD. That is a fact, not a failure.
    facts.head = undefined;
  }
  try {
    facts.branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    facts.branch = undefined;
  }
  try {
    const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
    facts.porcelain = status.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0);
  } catch (error) {
    facts.error = error instanceof Error ? error.message : String(error);
  }
  return facts;
}
