# MCP examples

Copy-paste configs and a tiny stdio echo server for practicing:

1. **`threadle mcp`** — expose saved workflows to Claude Code / Cursor  
2. **◈ MCP tool** node — call a discovered server from the canvas  

Full how-to: [`docs/mcp.md`](../../docs/mcp.md).

---

## Quick start — threadle as MCP server

1. Import a workflow into your library (gets a stable graph id):

```sh
# from the threadle repo root
threadle run examples/workflows/mcp-brief.json
# note the printed graph id, e.g. a1b2c3d4
threadle graphs
```

2. Point your host at threadle. Copy [`mcp.json.threadle.example`](mcp.json.threadle.example) into:

- Claude Code: `.mcp.json` in the project, or  
- Cursor: `.cursor/mcp.json`

Adjust `command` / `args` / `cwd` if you are not using a global `threadle` on `PATH`.

3. Reload MCP in the host. You should see a tool named `wf_<graphId>` titled **Example · MCP brief**.

4. Ask the model to call it with `topic` set. The reply is the workflow’s output-node text.

---

## Quick start — MCP tool node (client)

1. Copy [`mcp.json.echo.example`](mcp.json.echo.example) into your **threadle repo root** as `.mcp.json` (or merge the `echo` entry). Paths are relative to that root — discovery walks up from `--dir` to the git root. You can also put servers in `~/.config/threadle/mcp/servers.json` (stdio or `url` HTTP/SSE).

2. Start the UI with that project as `--dir` (so discovery finds `.mcp.json`):

```sh
threadle --dir /path/to/your/project
```

3. Clone **Hello MCP** or **Hello MCP params** from Workflows → examples (or `threadle run hello-mcp` / `hello-mcp-params`), **or** drop **◈ MCP tool** → server `echo` → tool `echo`:

- **Hello MCP** — wire prompt → MCP; set **arg port** `message`
- **Hello MCP params** — leave arg port empty; set `message` in the inspector

Then ▶ Run. For tool-then-reason: `threadle run mcp-then-agent` (echo + agent CLI).

The echo server is [`echo-server.mjs`](echo-server.mjs) — stdio only, no network. It needs the threadle repo’s `node_modules` (run `npx tsx` against that path). Settings → MCP can disable the client or individual servers.

---

## Optional — MongoDB find

Needs a local MongoDB and [`mongodb-mcp-server`](https://www.npmjs.com/package/mongodb-mcp-server). Not a beginner catalog template.

1. Copy [`servers.json.mongodb.example`](servers.json.mongodb.example) to `~/.config/threadle/mcp/servers.json` (merge if you already have entries). Adjust `MDB_MCP_CONNECTION_STRING` for your instance — do not commit secrets.
2. Start mongod; optionally seed `test.userprofiles`.
3. Run:

```sh
threadle run examples/workflows/mcp-mongo-find.json
```

Data node JSON fills `filter` via **argPort**; `database` / `collection` stay in the inspector. Use **⌀** on the MCP card to probe the connection.

`mongodb-mcp-server` returns documents inside `<untrusted-user-data-…>` injection-guard tags — expected, not a threadle bug. Run-log stdout is truncated (~500 chars).

---

## Files

| File | Purpose |
|---|---|
| [`mcp.json.threadle.example`](mcp.json.threadle.example) | Host config: run `threadle mcp` |
| [`mcp.json.echo.example`](mcp.json.echo.example) | Discoverable stdio echo server for the canvas node |
| [`servers.json.mongodb.example`](servers.json.mongodb.example) | Optional registry entry for MongoDB MCP (`--readOnly`) |
| [`echo-server.mjs`](echo-server.mjs) | Minimal MCP echo tool (`message` → text) |
| [`../workflows/mcp-brief.json`](../workflows/mcp-brief.json) | Agent-free workflow meant to be called as `wf_*` |
| [`../workflows/hello-mcp.json`](../workflows/hello-mcp.json) | Intermediate: prompt → ◈ MCP (argPort) → output |
| [`../workflows/hello-mcp-params.json`](../workflows/hello-mcp-params.json) | Intermediate: ◈ MCP inspector params → output |
| [`../workflows/mcp-then-agent.json`](../workflows/mcp-then-agent.json) | Advanced: MCP → convert → agent → output |
| [`../workflows/mcp-mongo-find.json`](../workflows/mcp-mongo-find.json) | Optional: Data → Mongo `find` → output |

---

## Windows notes

Config root defaults to `%USERPROFILE%\.config\threadle`. Override with `THREADLE_CONFIG_DIR`. Absolute paths in editor open / discovery use drive letters (`C:\…`), not Unix-only `/…`.
