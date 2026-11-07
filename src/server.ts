import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { takeSnapshot } from './snapshot.js';
import { loadCheckpoint, listCheckpoints, saveCheckpoint } from './store.js';
import { checkClaims, diffSnapshots } from './compare.js';
import { renderClaimReport, renderEvidenceReport } from './report.js';
import { checkpointOutput, claimCheckOutput, evidenceOutput, listOutput } from './schemas.js';

export const SERVER_NAME = 'murphy-mcp';
export const SERVER_VERSION = '0.1.0';

const rootArg = z
  .string()
  .describe('Absolute path to the workspace to observe. Use the project root the agent is working in.');

const scanArgs = {
  ignore: z
    .array(z.string())
    .optional()
    .describe('Extra directory names to skip, matched on a single path segment.'),
  noDefaultIgnores: z
    .boolean()
    .optional()
    .describe('Also scan .git, node_modules and .murphy. Off by default.'),
  maxFiles: z.number().int().positive().optional().describe('Stop the walk after this many files. Default 50000.'),
  maxFileBytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Do not hash files larger than this. Default 8388608.'),
};

function text(body: string, structured: unknown) {
  return { content: [{ type: 'text' as const, text: body }], structuredContent: structured as Record<string, unknown> };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'checkpoint',
    {
      title: 'Record the workspace as it is now',
      description:
        'Takes an independent record of the workspace before an agent starts work: every file path, size, modification time and SHA-256, plus the git HEAD, branch and working-tree status read from the repository. Returns a checkpoint id. Call this first. Nothing here comes from the agent.',
      inputSchema: z.object({
        root: rootArg,
        label: z.string().optional().describe('A short name for this checkpoint, such as the task it precedes.'),
        ...scanArgs,
      }),
      outputSchema: checkpointOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ root, label, ignore, noDefaultIgnores, maxFiles, maxFileBytes }) => {
      const snapshot = await takeSnapshot(root, { ignore, noDefaultIgnores, maxFiles, maxFileBytes });
      const checkpoint = await saveCheckpoint(snapshot, label);
      const out = {
        checkpointId: checkpoint.id,
        root: snapshot.root,
        takenAt: snapshot.takenAt,
        fileCount: Object.keys(snapshot.files).length,
        truncated: snapshot.truncated,
        truncatedReason: snapshot.truncatedReason,
        ignored: snapshot.ignored,
        git: snapshot.git,
      };
      const note = snapshot.truncated ? `\n\nIncomplete: ${snapshot.truncatedReason}` : '';
      return text(
        `Checkpoint \`${checkpoint.id}\` recorded ${out.fileCount} files under \`${out.root}\` at ${out.takenAt}.${note}`,
        out,
      );
    },
  );

  server.registerTool(
    'evidence_since',
    {
      title: 'What actually changed since a checkpoint',
      description:
        'Rescans the workspace and reports every file added, modified or deleted since the checkpoint, together with what moved in git. This is the observed record. It does not know and does not ask what any agent intended or reported.',
      inputSchema: z.object({
        root: rootArg,
        checkpointId: z.string().describe('The id returned by checkpoint.'),
        ...scanArgs,
      }),
      outputSchema: evidenceOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ root, checkpointId, ignore, noDefaultIgnores, maxFiles, maxFileBytes }) => {
      const checkpoint = await loadCheckpoint(root, checkpointId);
      const now = await takeSnapshot(root, {
        ignore: ignore ?? checkpoint.snapshot.ignored.filter((d) => !['.git', 'node_modules', '.murphy'].includes(d)),
        noDefaultIgnores,
        maxFiles,
        maxFileBytes,
      });
      const evidence = diffSnapshots(checkpointId, checkpoint.snapshot, now);
      return text(renderEvidenceReport(evidence), evidence);
    },
  );

  server.registerTool(
    'check_claims',
    {
      title: 'Hold an agent account against the observed record',
      description:
        "Takes what the agent said it did and compares it with what the machine shows. Returns four separate buckets: confirmed (claimed and observed), contradicted (claimed but nothing changed), unreported (changed and never mentioned), and unverifiable (claims a filesystem and git record cannot settle, such as 'the tests pass' or 'the bug is fixed'). The buckets are never merged, because a claim is not evidence.",
      inputSchema: z.object({
        root: rootArg,
        checkpointId: z.string().describe('The id returned by checkpoint.'),
        claimedPaths: z
          .array(z.string())
          .default([])
          .describe('The files the agent said it changed. Absolute or workspace-relative.'),
        claimedStatements: z
          .array(z.string())
          .default([])
          .describe('Everything else the agent asserted, in its own words. These are returned as unverifiable by design.'),
        ...scanArgs,
      }),
      outputSchema: claimCheckOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ root, checkpointId, claimedPaths, claimedStatements, ignore, noDefaultIgnores, maxFiles, maxFileBytes }) => {
      const checkpoint = await loadCheckpoint(root, checkpointId);
      const now = await takeSnapshot(root, { ignore, noDefaultIgnores, maxFiles, maxFileBytes });
      const evidence = diffSnapshots(checkpointId, checkpoint.snapshot, now);
      const check = checkClaims(checkpoint, evidence, claimedPaths ?? [], claimedStatements ?? []);
      return text(renderClaimReport(check, evidence), check);
    },
  );

  server.registerTool(
    'list_checkpoints',
    {
      title: 'Checkpoints recorded for this workspace',
      description: 'Lists the checkpoints stored under the workspace, most recent first.',
      inputSchema: z.object({ root: rootArg }),
      outputSchema: listOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ root }) => {
      const checkpoints = await listCheckpoints(root);
      const out = { root, checkpoints };
      const body =
        checkpoints.length === 0
          ? `No checkpoints under \`${root}\`.`
          : checkpoints.map((c) => `- \`${c.id}\`${c.label ? ` (${c.label})` : ''} — ${c.takenAt}, ${c.fileCount} files`).join('\n');
      return text(body, out);
    },
  );

  return server;
}
