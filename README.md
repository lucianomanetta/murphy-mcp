# murphy-mcp

**An MCP server that gives a coding agent a record it did not write.**

A coding agent finishes a task and tells you what it did. The report is coherent, well structured, and
usually correct. It is also the only account you have, written by the party being assessed.

This server produces the other account. It records the workspace before the work starts, reads it again
afterwards, and reports what actually changed: every file added, modified or deleted, plus what moved in
git. Then it holds the agent's own account against that record and reports the disagreements.

It does not ask the agent what happened. That is the point.

Built on the [2026-07-28 MCP specification](https://modelcontextprotocol.io/specification/2026-07-28)
with the v2 TypeScript SDK. MIT licensed.

---

## What it catches

The failure mode is not a lying agent. An agent's report is a summary written from its own context
window, and that context is a partial view of a system with far more state than the agent can hold. The
report is usually accurate about intent and less reliable about effect.

Three things show up again and again:

- **Side effects outside the narrative.** The agent describes editing three files. Four were written. The
  fourth was a cache, a lockfile, a generated artifact, or a config the tooling rewrote.
- **Completion claimed at the boundary of knowledge.** The agent finishes the part it can see and reports
  the task complete, because from inside its context the task is complete.
- **Claims nothing on disk supports.** "The tests pass." "The bug is fixed." Possibly true, and not
  something a file listing can settle either way.

This server names all three, separately.

## Install

Published builds:

```bash
npx -y murphy-mcp
```

Claude Code:

```bash
claude mcp add murphy -- npx -y murphy-mcp
```

Any MCP client, by config:

```json
{
  "mcpServers": {
    "murphy": {
      "command": "npx",
      "args": ["-y", "murphy-mcp"]
    }
  }
}
```

From a clone:

```bash
npm install && npm run build
```

then point the client at `node /absolute/path/to/murphy-mcp/dist/index.js`.

## Use

Take a checkpoint before the work, then check the account afterwards.

```
checkpoint        { root: "/path/to/project", label: "refactor auth" }
                  -> checkpointId

... the agent works ...

check_claims      { root, checkpointId,
                    claimedPaths: ["src/auth.ts", "src/session.ts"],
                    claimedStatements: ["All tests pass."] }
```

What comes back:

```
# Evidence report

**2 unreported · 1 contradicted · 1 confirmed · 1 unverifiable**

## Unreported: observed on disk, never mentioned
- `b.txt` (deleted)
- `generated/out.bin` (added)

## Contradicted: claimed, but nothing changed
- `never_touched.ts` — no such file at checkpoint time and none now

## Unverifiable: outside what this record can settle
- The test suite passes. — a filesystem and git record cannot settle this; it needs its own evidence

## Confirmed: claimed and observed
- `a.txt` (modified)
```

Disagreements come first, because that is what a person is for. Nobody reviews a flat log of 50,000
events; anyone can scan a list of four disagreements in a minute.

## The four buckets

They are kept apart on purpose. Collapsing them is what makes a claim read as evidence.

| Bucket | Meaning |
|---|---|
| **confirmed** | Claimed, and observed on disk |
| **contradicted** | Claimed, and nothing changed |
| **unreported** | Changed on disk, and never mentioned |
| **unverifiable** | Nothing in a filesystem or git record can settle it |

`unverifiable` is stated explicitly instead of being quietly guessed. Presenting a guess at the same
confidence as a fact is the failure this is meant to stop.

## Tools

### `checkpoint`
Records the workspace as it is now: path, size, modification time and SHA-256 for every file, plus git
HEAD, branch and `status --porcelain`. Returns a checkpoint id.

`root` (required) · `label` · `ignore` · `noDefaultIgnores` · `maxFiles` · `maxFileBytes`

### `evidence_since`
Rescans and reports what changed since the checkpoint. The observed record alone, with no claims
involved.

`root` (required) · `checkpointId` (required) · the same scan options

### `check_claims`
Holds the agent's account against the record and returns the four buckets.

`root` (required) · `checkpointId` (required) · `claimedPaths` · `claimedStatements` · the same scan
options

### `list_checkpoints`
Lists the checkpoints stored under a workspace, most recent first.

`root` (required)

## Design decisions worth knowing

**Build output is not ignored.** Only `.git`, `node_modules` and the server's own `.murphy` store are
skipped by default. Ignoring `dist`, `.next`, `target` or `coverage` would hide exactly the writes that
tend to fall outside an agent's account. If you want them skipped, pass them in `ignore`.

**Checkpoints are written to disk**, under `.murphy/checkpoints` in the workspace, with a `.gitignore`
that keeps the store out of the repository. The 2026-07-28 protocol core is stateless, so nothing that
has to outlive a single call is kept in the process. It also means the evidence survives the session it
describes, which is when anyone actually wants to read it.

**Symbolic links are recorded and never followed.** A snapshot that can wander outside its root cannot
say where it looked.

**Hashing has limits, and they are reported.** Files over 8 MiB are not hashed; for those a change is
inferred from size and modification time, which is weaker evidence, and the report says so. Every
truncation, skipped directory and unhashed file appears under "What this report does not cover".

## What this does not do

Honest scope, so nobody is surprised:

- **No process ancestry and no network capture.** It sees the filesystem and the git repository. It
  cannot tell you which command produced a write, or what was fetched.
- **It does not read `.gitignore`.** The default ignore list is the three directories above and whatever
  you pass.
- **It is not a sandbox or a guardrail.** It observes after the fact. It blocks nothing.
- **It cannot verify behaviour.** "The tests pass" comes back as unverifiable every time, by design. Run
  the tests.

## Relation to MURPHY

[MURPHY](https://github.com/lucianomanetta/murphy) is a separate, commercial, local-first Windows tool
that reconstructs agent activity from process ancestry, filesystem activity, workspace boundaries and
network behaviour. This server is an independent, cross-platform, open implementation of the filesystem
and git half of the same idea, usable from any MCP client.

The reasoning behind both is written up in
[An agent's report is not evidence](https://github.com/lucianomanetta/murphy/blob/main/docs/an-agents-report-is-not-evidence.md).

## Development

```bash
npm install
npm run build
node test/smoke.mjs
```

The smoke test builds a throwaway git workspace, drives the server over a real stdio MCP connection,
makes three changes, reports one of them, and asserts that the other two come back as unreported.

## Licence

MIT. See [LICENSE](LICENSE).
