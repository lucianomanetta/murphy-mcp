#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

/**
 * One instance per connection, built by the factory.
 *
 * The 2026-07-28 core is stateless, so nothing that has to outlive a single
 * call is kept in this process. Checkpoints go to disk under the workspace.
 */
serveStdio(() => createServer(), {
  onerror: (error) => {
    process.stderr.write(`murphy-mcp: ${error.stack ?? error.message}\n`);
  },
});
