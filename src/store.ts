import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Checkpoint, Snapshot } from './types.js';

/**
 * Checkpoints live on disk, not in memory.
 *
 * The 2026-07-28 protocol core is stateless, so a server instance cannot be
 * relied on to outlive the call that created a checkpoint. Persisting also
 * means the evidence survives the agent session it describes, which is the
 * situation in which anyone actually wants to read it.
 */
export const STORE_DIRNAME = '.murphy';

function storeDir(root: string): string {
  return join(resolve(root), STORE_DIRNAME, 'checkpoints');
}

function newId(): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export async function saveCheckpoint(snapshot: Snapshot, label?: string): Promise<Checkpoint> {
  const dir = storeDir(snapshot.root);
  await mkdir(dir, { recursive: true });
  // Keep the evidence store out of the repository it is observing.
  await writeFile(join(resolve(snapshot.root), STORE_DIRNAME, '.gitignore'), '*\n', 'utf8');

  const checkpoint: Checkpoint = { id: newId(), label, snapshot, formatVersion: 1 };
  await writeFile(join(dir, `${checkpoint.id}.json`), JSON.stringify(checkpoint), 'utf8');
  return checkpoint;
}

export async function loadCheckpoint(root: string, id: string): Promise<Checkpoint> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) {
    throw new Error(`invalid checkpoint id: ${id}`);
  }
  const file = join(storeDir(root), `${id}.json`);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`no checkpoint ${id} under ${resolve(root)}. Call checkpoint first, or pass the root it was taken in.`);
  }
  const parsed = JSON.parse(raw) as Checkpoint;
  if (parsed.formatVersion !== 1) {
    throw new Error(`checkpoint ${id} was written by a different version of this server`);
  }
  return parsed;
}

export async function listCheckpoints(root: string): Promise<Array<{ id: string; label?: string; takenAt: string; fileCount: number }>> {
  let names: string[];
  try {
    names = await readdir(storeDir(root));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(await readFile(join(storeDir(root), name), 'utf8')) as Checkpoint;
      out.push({
        id: parsed.id,
        label: parsed.label,
        takenAt: parsed.snapshot.takenAt,
        fileCount: Object.keys(parsed.snapshot.files).length,
      });
    } catch {
      // A corrupt checkpoint is skipped rather than failing the listing.
    }
  }
  return out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}
