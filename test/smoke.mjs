/**
 * End-to-end check over a real stdio MCP connection.
 *
 * Builds a throwaway workspace, records a checkpoint, then changes the
 * workspace in three ways and reports only one of them, which is the shape of
 * the failure this server exists to catch.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const here = fileURLToPath(new URL('.', import.meta.url));
const entry = join(here, '..', 'dist', 'index.js');

const root = mkdtempSync(join(tmpdir(), 'murphy-mcp-'));
let failed = false;

function git(...args) {
  execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
}

function callTool(client, name, args) {
  return client.request({ method: 'tools/call', params: { name, arguments: args } });
}

try {
  writeFileSync(join(root, 'a.txt'), 'original a\n');
  writeFileSync(join(root, 'b.txt'), 'original b\n');
  writeFileSync(join(root, 'keep.txt'), 'untouched\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'initial');

  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'inherit' });
  const client = new Client({ name: 'murphy-mcp-smoke', version: '0.0.0' });
  await client.connect(transport);

  const tools = await client.request({ method: 'tools/list', params: {} });
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['check_claims', 'checkpoint', 'evidence_since', 'list_checkpoints']);
  console.log('tools/list ok:', names.join(', '));

  const made = await callTool(client, 'checkpoint', { root, label: 'before task' });
  const checkpointId = made.structuredContent.checkpointId;
  assert.ok(checkpointId, 'checkpoint returned no id');
  assert.equal(made.structuredContent.git.available, true, 'git should have been detected');
  console.log(`checkpoint ok: ${checkpointId}, ${made.structuredContent.fileCount} files, HEAD ${made.structuredContent.git.head.slice(0, 8)}`);

  // Three real changes. Only one of them will be reported by the "agent".
  writeFileSync(join(root, 'a.txt'), 'changed a\n');
  rmSync(join(root, 'b.txt'));
  mkdirSync(join(root, 'generated'), { recursive: true });
  writeFileSync(join(root, 'generated', 'out.bin'), 'a side effect nobody mentioned\n');

  const evidence = await callTool(client, 'evidence_since', { root, checkpointId });
  const ev = evidence.structuredContent;
  assert.equal(ev.counts.modified, 1, 'expected one modified file');
  assert.equal(ev.counts.deleted, 1, 'expected one deleted file');
  assert.ok(ev.counts.added >= 1, 'expected at least one added file');
  console.log(`evidence_since ok: +${ev.counts.added} ~${ev.counts.modified} -${ev.counts.deleted}`);

  const checked = await callTool(client, 'check_claims', {
    root,
    checkpointId,
    claimedPaths: ['a.txt', 'never_touched.ts'],
    claimedStatements: ['The test suite passes.'],
  });
  const c = checked.structuredContent;

  assert.deepEqual(c.confirmed.map((x) => x.path), ['a.txt'], 'a.txt should be confirmed');
  assert.deepEqual(c.contradicted.map((x) => x.path), ['never_touched.ts'], 'the invented path should be contradicted');

  const unreported = c.unreported.map((x) => `${x.kind}:${x.path}`).sort();
  assert.ok(unreported.includes('deleted:b.txt'), `b.txt deletion should be unreported, got ${unreported}`);
  assert.ok(unreported.includes('added:generated/out.bin'), `the generated file should be unreported, got ${unreported}`);

  assert.equal(c.unverifiable.length, 1, 'the statement should come back unverifiable');
  assert.equal(c.unverifiable[0].claim, 'The test suite passes.');

  console.log(
    `check_claims ok: ${c.counts.confirmed} confirmed, ${c.counts.contradicted} contradicted, ${c.counts.unreported} unreported, ${c.counts.unverifiable} unverifiable`,
  );

  const listed = await callTool(client, 'list_checkpoints', { root });
  assert.equal(listed.structuredContent.checkpoints.length, 1);
  console.log('list_checkpoints ok');

  console.log('\n--- report as the reviewer sees it ---\n');
  console.log(checked.content[0].text);

  await client.close();
  console.log('\nALL CHECKS PASSED');
} catch (error) {
  failed = true;
  console.error('\nFAILED:', error);
} finally {
  rmSync(root, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
