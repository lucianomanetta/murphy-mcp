import { z } from 'zod';

export const gitFactsSchema = z.object({
  available: z.boolean(),
  head: z.string().optional(),
  branch: z.string().optional(),
  porcelain: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const changeSchema = z.object({
  path: z.string(),
  kind: z.enum(['added', 'modified', 'deleted']),
  differs: z.array(z.enum(['content', 'size', 'mtime'])).optional(),
  sizeBefore: z.number().optional(),
  sizeAfter: z.number().optional(),
});

export const checkpointOutput = z.object({
  checkpointId: z.string(),
  root: z.string(),
  takenAt: z.string(),
  fileCount: z.number(),
  truncated: z.boolean(),
  truncatedReason: z.string().optional(),
  ignored: z.array(z.string()),
  git: gitFactsSchema,
});

export const evidenceOutput = z.object({
  checkpointId: z.string(),
  root: z.string(),
  from: z.string(),
  to: z.string(),
  changes: z.array(changeSchema),
  counts: z.object({
    added: z.number(),
    modified: z.number(),
    deleted: z.number(),
    unchanged: z.number(),
  }),
  git: z.object({
    before: gitFactsSchema,
    after: gitFactsSchema,
    headChanged: z.boolean(),
  }),
  caveats: z.array(z.string()),
});

export const claimCheckOutput = z.object({
  checkpointId: z.string(),
  root: z.string(),
  confirmed: z.array(z.object({ path: z.string(), kind: z.enum(['added', 'modified', 'deleted']) })),
  contradicted: z.array(z.object({ path: z.string(), reason: z.string() })),
  unreported: z.array(changeSchema),
  unverifiable: z.array(z.object({ claim: z.string(), reason: z.string() })),
  counts: z.object({
    confirmed: z.number(),
    contradicted: z.number(),
    unreported: z.number(),
    unverifiable: z.number(),
  }),
  caveats: z.array(z.string()),
});

export const listOutput = z.object({
  root: z.string(),
  checkpoints: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      takenAt: z.string(),
      fileCount: z.number(),
    }),
  ),
});
