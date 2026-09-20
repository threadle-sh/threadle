# threadle CLI

Headless entry to threadle: start the local UI, run portable workflows, and inspect server-side jobs.

```sh
npx threadle                              # UI on http://127.0.0.1:4570
threadle daemon                          # long-lived serve (no browser) + triggers.json
threadle check                           # PATH + providers + config
threadle check --providers               # + inject flag probes (see docs/provider-freshness.md)
threadle export hello-wire ./out.json   # portable threadle/graph@1
threadle import ./out.json              # save graph (or restore backup@1)
threadle export --backup [file]         # threadle/backup@1 archive
threadle skills                         # list skill libraries (needs server)
threadle skills import ./review.SKILL.md
threadle skills toggle review-diff --manual
threadle open skills
threadle open workflow a1b2c3d4
threadle open session cursor:ses_1
threadle run plan-implement-review --approve-all
threadle run knot-concat --detach         # background on the running server
threadle run detached-delay --detach      # ~60s, no agents — then: attach / jobs
threadle run <id> --watch --approve-all   # re-run on graph mtime / git changes
threadle jobs
threadle attach <jobId>                   # follow until done
threadle services
threadle agents --dir .
threadle logs <jobId> --follow            # same as attach
```

| | |
|---|---|
| **Manual** | [Full command reference →](manual.md) |
| **Example workflows** | [Catalog + portable JSON →](../../examples/workflows/README.md) — teaching templates |
| **Triggers** | [Example triggers.json →](../../examples/triggers/triggers.example.json) — cron / watch + daemon |
| **Recipes** | [Job recipes →](../../examples/recipes/README.md) — clone, fill contract, run |
| **Starter workflow** | [Plan → Implement → Review](../../examples/workflows/plan-implement-review.json) — also seeded as graph id `starter` |
| **Portable graphs** | `threadle/graph@1` — `threadle export <id>` / `import` / canvas download / `run` |
| **Backup** | `threadle/backup@1` — `threadle export --backup` / `import` (auto-detect) |

## Install

```sh
curl -fsSL https://threadle.sh/install.sh | bash
threadle                              # UI on http://127.0.0.1:4570
```

Portable install (bundled Node 26 + app) into `~/.local/share/threadle` — no npm. Pin a version with `THREADLE_VERSION=1.0.1`. The installer verifies SHA-256 against the release `SHA256SUMS` file.

**Or** Node.js ≥ 22.12 + npm:

```sh
npx threadle                 # published package (builds UI into the tarball)
# from the monorepo:
npm install && npm run build
npm start                    # same as: node packages/server/dist/cli.js
threadle check              # first-run / support checks
# or during development:
npx tsx packages/server/src/cli.ts --no-open
```

Published binary: `threadle`. Pack smoke locally: `npm run pack:smoke`. Portable pack smoke: `npm run pack:portable:smoke`.

## Modes

### 1. Server (default)

```sh
threadle [--port 4570] [--no-open] [--dir <project>]
```

Binds `127.0.0.1` only, serves the Vue UI, watches agent storage read-only. Keep this up for **≫**, `--detach`, and every job / inventory command (`jobs`, `services`, `agents`, …).

### 2. Run a graph

```sh
threadle run <file|recipe|template|graphId> [--param k=v]... [--approve-all] [--dir <path>] [--detach] [--watch] [--ephemeral]
```

- **Foreground** (default): in-process runner; streams logs to stdout; exits `0`/`1`.
- **`--detach`**: imports the graph if needed, `POST /api/run/workflow` on the running server, prints a `jobId`, exits. Inspect with `jobs` / `logs`.

```sh
threadle run plan-implement-review \
  --param task="fix the flaky auth test" \
  --approve-all \
  --dir .
```

```sh
threadle --list-templates
```

### 3. Jobs & inventory on the running server

```sh
threadle jobs                # all recent jobs
threadle status              # running only
threadle attach <jobId>      # follow logs until the job ends
threadle logs [jobId] -f     # same as attach when -f + jobId
threadle stop <jobId>
threadle services            # health + providers + process
threadle providers
threadle agents --dir .
threadle sessions -q auth --provider cursor
threadle graphs
threadle models
threadle nodes
threadle skills                         # list / import / export / toggle
threadle open [target…]                 # open UI deep link (needs server)
threadle templates
threadle recipes
```

Override the base URL with `THREADLE_URL` (default `http://127.0.0.1:<port>`).

## What `run` accepts

1. **Recipe id** — e.g. `repo-brief` (`threadle recipes`)
2. **Bundled template id** — e.g. `plan-implement-review` (`threadle templates`)
3. **Portable JSON file** — export from the canvas (`threadle/graph@1`)
4. **Example / recipe path** — `examples/recipes/<name>.json` or `examples/workflows/<name>.json` relative to cwd
5. **Existing graph id** — under `~/.config/threadle/graphs/` (Windows: `%USERPROFILE%\.config\threadle\graphs\`)

Imported runs keep the graph by default (open later with `threadle`). Pass `--ephemeral` to delete after a **foreground** exit (`--detach` always keeps the graph for the server job).

## MCP

**Manual:** [How to run, connect, and work with MCP →](../mcp.md) · **Examples:** [`examples/mcp/`](../../examples/mcp/)

### `threadle mcp` (server)

Expose saved **workflows** (not subgraphs) as MCP tools over stdio. Tool name is `wf_<graphId>`; title is the graph name; `Graph.params` become the tool `inputSchema`. **Settings → MCP → publish allowlist** defaults to empty (publish none); list graph ids or set `*` for all. Gated graphs (approval / live handoff) are refused — run those in the UI with splice.

```json
{
  "mcpServers": {
    "threadle": {
      "command": "threadle",
      "args": ["mcp"]
    }
  }
}
```

Smoke-test workflow: `threadle run examples/workflows/mcp-brief.json` then call `wf_<id>` from the host.

### ◈ MCP tool node (client)

Canvas node that calls one tool on a discovered MCP server (stdio, streamable-http, or SSE) from project configs, `~/.config/threadle/mcp/servers.json`, or host MCP configs. See the [MCP manual](../mcp.md#2-mcp-tool-node-threadle-as-client) and [`examples/mcp/`](../../examples/mcp/) echo server.

## Params & gates

- `--param name=value` fills `{{param:name}}` in prompts / converters (repeatable).
- Workflows with **approval** nodes need `--approve-all` in CLI (no interactive dock).

## Trust

Same model as the UI: loopback only, never writes into `~/.claude`, opencode DB, Cursor chat stores, Antigravity brain, Codex rollouts, Copilot session store, or Grok session dirs. Agent runs go through each tool's official CLI.

---

See [manual.md](manual.md) for flags, exit codes, portable format notes, and examples.
