# MCP with threadle

threadle speaks MCP in two directions:

| Direction | What | Command / node |
|---|---|---|
| **Server** | Hosts call your saved workflows as tools | `threadle mcp` (stdio) |
| **Client** | Canvas calls one tool on one discovered server | **◈ MCP tool** node |

This page is the how-to. Snippets and a sample workflow live under [`examples/mcp/`](../examples/mcp/).

---

## 1. Run threadle as an MCP server

### What you get

- Every saved **workflow** (not subgraph) under `~/.config/threadle/graphs/` becomes a tool.
- Tool name: `wf_<graphId>` (stable; ids are already constrained).
- Tool title: the graph **name**.
- `inputSchema`: from `Graph.params` (`text` · `int` · `float` · `bool` · `json`).
- On call: args → string params → `executeWorkflow({ approveAll: false })` → **output-node text** returned to the host. Graphs that need interactive splice must run in the UI.

Stdout is the MCP JSON-RPC channel — never `console.log` from your own wrappers. Logs go to **stderr**.

### Prerequisites

1. Node.js ≥ 22.12 and a built / installed `threadle` binary (or monorepo `tsx` path below).
2. At least one saved workflow. Fastest path:

```sh
# import a param-driven example into your library (prints a new graph id)
threadle run examples/workflows/mcp-brief.json --ephemeral=false
# or open the UI, Workflows → examples → clone, then save
threadle
```

Note the graph id from the run banner (`✓ done …` / `graph kept as …`) or from **Workflows** / `threadle graphs`.

### Connect from Claude Code / Cursor

Project `.mcp.json` (Claude Code) or `.cursor/mcp.json` (Cursor):

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

Monorepo checkout without a global install:

```json
{
  "mcpServers": {
    "threadle": {
      "command": "npx",
      "args": ["tsx", "packages/server/src/cli.ts", "mcp"],
      "cwd": "/absolute/path/to/threadle"
    }
  }
}
```

Optional env:

| Variable | Effect |
|---|---|
| `THREADLE_CONFIG_DIR` | Config root (default `~/.config/threadle`; Windows `%USERPROFILE%\.config\threadle`) |
| `THREADLE_MCP_PROJECT_DIR` | `--dir` equivalent for agent CLIs inside workflow tools |

Restart / reload MCP in the host after editing the config. Ask the model to list tools — you should see `wf_<id>` entries titled with your workflow names.

### Call a workflow from the host

1. Ensure the workflow has **params** for anything the model should fill (≔ on the canvas).
2. Ensure it is detached-ready: no blocked context, models set on agents. Workflows with **approval / live-handoff** gates are refused over MCP — run those in the UI with splice instead.
3. Put at least one **⇤ output** on the graph — that text is what the host receives.
4. In the host chat: ask to run the tool, e.g. “call the mcp-brief workflow with topic=…”.

Agent-free smoke test graph: [`examples/workflows/mcp-brief.json`](../examples/workflows/mcp-brief.json).

### Guards

| Guard | Behavior |
|---|---|
| `THREADLE_MCP_DEPTH ≥ 1` | Nested `threadle mcp` calls refused (workflow → agent → same MCP → …) |
| Same `graphId` on `THREADLE_MCP_STACK` | Re-entry refused |
| Subgraphs | Never published as tools |
| Settings publish allowlist | Empty (default) = none; listed ids only; `*` / `null` = all |
| Detached blockers | Hard readiness errors fail the tool; approval / live-handoff gates refuse (no auto-approve) |

---

## 2. MCP tool node (threadle as client)

Canvas node **◈ MCP tool** (`type: "mcp-tool"`):

1. Drop **MCP tool** from the Nodes palette (or wire-drop menu).
2. Inspector: pick a **server** discovered from local configs, then a **tool**.
3. Optional **arg port** — inbound text fills that tool argument.
4. Param widgets mirror the tool’s JSON Schema properties.
5. ▶ Run (or wire into a larger graph).

### Where servers are discovered

First match wins (project → threadle registry → user hosts):

| Path |
|---|
| `<project>/.mcp.json` (walks up to the git root — monorepo-safe) |
| `<project>/.cursor/mcp.json` (same walk-up) |
| project `opencode.json` (same walk-up) |
| `~/.config/threadle/mcp/servers.json` (threadle-owned registry) |
| `~/.cursor/mcp.json` |
| `~/.claude.json` (`mcpServers`) |
| `~/.config/opencode/config.json` / `opencode.json` |
| `~/.gemini/config/mcp_config.json` (Antigravity) |
| `<project>/.codex/config.toml` · `~/.codex/config.toml` (`mcp_servers`) |

Transports: **stdio** (`command` + `args`), **streamable-http** (`url`, optional `headers`), and **sse** (`url` / `serverUrl` with `type`/`transport: "sse"`). Bare `url` without a type defaults to streamable-http.

Example registry entry (`~/.config/threadle/mcp/servers.json`):

```json
{
  "mcpServers": {
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}
```

### Settings (Settings → MCP)

| Setting | Effect |
|---|---|
| **MCP client** off/on | When off, canvas discovery/calls refuse (`/api/mcp/call`, tool list) |
| **disable** per server | Hides that id from the client; Settings list still shows it |
| **publish allowlist** | Graph ids exposed by `threadle mcp` as `wf_*` — one per line; empty = none (default); `*` alone = all |

Unix-domain sockets and WebSockets are not supported.

### Env for spawned MCP servers

The client does **not** pass a full copy of the threadle process environment.
Spawned **stdio** servers get the same allowlist as [custom nodes](custom-nodes.md)
(`PATH`, `HOME`, `USERPROFILE`, temp dirs, locale, shell basics, …), then any
`env` map declared on that server in `.mcp.json`. Put tokens there explicitly
when a server needs them — they will not leak from the threadle process by accident.
HTTP/SSE remotes use optional `headers` from the config instead.

API (when the UI server is up):

- `GET /api/mcp/servers` — all discovered (includes `disabled`, `transport`, registry paths)
- `GET /api/mcp/servers/:id/tools`
- `POST /api/mcp/call` `{ server, tool, args?, params?, projectDir? }`

### Example: call a tiny echo server from the canvas

See [`examples/mcp/`](../examples/mcp/) — drop the sample `.mcp.json`, run threadle with `--dir` pointing at that folder (or copy the snippet into your project), then clone from examples:

| Template | Teaches |
|---|---|
| `hello-mcp` | Inbound text → **argPort** `message` |
| `hello-mcp-params` | Inspector **params** only (no wire / no argPort) |
| `mcp-then-agent` | Echo payload → convert → agent (pick a model on ◇) |

```sh
threadle run hello-mcp
threadle run hello-mcp-params
threadle run mcp-then-agent --approve-all
```

Child **stderr** from the spawned MCP process shows in the Run log (prefixed `◈ <server>:`). Stdout stays the MCP protocol channel.

Calling **threadle’s own** MCP from a canvas node is allowed. Calling it *from inside* a workflow that was itself started via `threadle mcp` is refused (depth guard).

### Optional: MongoDB find

For a third-party server with JSON args and env in the registry:

1. Copy [`examples/mcp/servers.json.mongodb.example`](../examples/mcp/servers.json.mongodb.example) into `~/.config/threadle/mcp/servers.json` (merge if needed). Set `MDB_MCP_CONNECTION_STRING` for your local instance — never commit real credentials.
2. Run mongod; optionally seed `test.userprofiles`.
3. `threadle run examples/workflows/mcp-mongo-find.json` — Data (JSON filter) → ◈ `find` (`argPort` = `filter`) → output. Use **⌀** on the card to probe.

`mongodb-mcp-server` wraps query results in `<untrusted-user-data-…>` tags (injection guard). That text is what the MCP node emits; the Run log also truncates long stdout to ~500 characters, so the closing tag may look cut off.

Not seeded in the in-app examples table (needs Mongo).

---

## 3. End-to-end recipes

### A. Host runs a saved workflow

```text
Save mcp-brief → add threadle to .mcp.json → reload host → call wf_<id>
```

### B. Canvas calls an external MCP tool

```text
Configure .mcp.json → threadle UI → drop ◈ MCP tool → pick server/tool → ▶
# or: threadle run hello-mcp / hello-mcp-params
```

### C. Workflow params ↔ MCP args

Declare params on the graph (`text` / `int` / …). The host’s tool schema matches those names. CLI equivalent:

```sh
threadle run <graphId> --param topic="…" --approve-all
```

MCP does the same with `approveAll: false` — gated graphs belong in the UI.

---

## Related

- [CLI README](cli/README.md) — short MCP snippet
- [CLI manual](cli/manual.md) — `threadle mcp` in the command table
- [Custom nodes](custom-nodes.md) — similar trust / timeout model for local executables
- [examples/mcp/](../examples/mcp/) — copy-paste configs + echo server + optional Mongo registry
- [examples/workflows/](../examples/workflows/) — `hello-mcp`, `hello-mcp-params`, `mcp-then-agent`, `mcp-mongo-find`
