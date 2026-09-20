# threadle CLI manual

Reference for the `threadle` binary (`packages/server` → `bin: threadle`).
For a one-page overview, see [README.md](README.md).

## Synopsis

```text
threadle [server-options]
threadle daemon
threadle export <graphId|file|recipe> [out.json]
threadle export --backup [file]
threadle import <file>
threadle run <target> [run-options]
threadle jobs|status [--all]
threadle attach <jobId>
threadle logs [jobId] [--follow]
threadle stop <jobId>
threadle services|health
threadle providers | agents | sessions | graphs | models | nodes | skills | templates | recipes
threadle skills [list|import|export|toggle] …
threadle open [target…]
threadle --list-templates
threadle help | -h | --help
```

| Invocation | Effect |
|---|---|
| `threadle` | Start the local API + UI on `127.0.0.1` |
| `threadle serve` | Same as bare `threadle` (optional explicit command) |
| `threadle daemon` | Serve with `--no-open`; load `triggers.json` |
| `threadle export` / `import` | Portable `graph@1` or `backup@1` |
| `threadle run <target>` | Import/load a graph and execute it (foreground) |
| `threadle run <target> --detach` | Start the same run on the **running** server; print `jobId` |
| `threadle jobs` | List recent jobs (all statuses) |
| `threadle status` | List running jobs (`--all` = recent history) |
| `threadle attach <jobId>` | Follow a job’s logs until it ends (same as `logs -f`) |
| `threadle logs [jobId]` | Print logs (`--follow` / `-f` until the job ends) |
| `threadle stop <jobId>` | Cancel a running job |
| `threadle services` / `health` | Server process + provider availability |
| `threadle providers` | Provider adapters |
| `threadle agents` | Discovered agents (`--dir`) |
| `threadle sessions` | Sessions (`-q`, `--provider`, `--limit`) |
| `threadle graphs` / `workflows` | Saved graphs |
| `threadle models` | Models from `/api/models` |
| `threadle nodes` | Custom nodes |
| `threadle skills` | Skill libraries (`list` / `import` / `export` / `toggle`) |
| `threadle open` | Open the UI (deep link — needs a running server) |
| `threadle templates` | Bundled teaching examples |
| `threadle recipes` | Job recipes (`examples/recipes`) |
| `threadle --list-templates` | Same as `templates` |
| `threadle help` / `--help` | Print help and exit |

Unknown commands exit with status `2`.

Set `THREADLE_URL` to override the server base (default `http://127.0.0.1:<port>` from `--port`). Inventory commands (except `templates` / `recipes` / `export` / `import` / `check` / `mcp`) need a running server — including `skills` and `open`.

---

## Server mode

```bash
threadle                    # UI + API on :4570, opens browser
threadle --no-open          # same, no browser
threadle daemon             # same as --no-open; loads ~/.config/threadle/triggers.json
threadle serve --port 4570  # explicit serve
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--port <n>` | `4570` | TCP port (host is always `127.0.0.1`) |
| `--no-open` | off | Do not open a browser tab |
| `--dir <path>` | `cwd` | Project directory highlighted for agents / discovery |
| `-h`, `--help` | | Show help |

### Behavior

- Serves the built web UI from `web-dist` (production) or works with Vite in monorepo `npm run dev`.
- Starts filesystem watchers for Claude / opencode / Cursor / Antigravity / Codex / Copilot / Grok session stores (**read-only**).
- Loads `~/.config/threadle/triggers.json` (cron + path watch → detached executor).
- DNS-rebinding and CSRF guards apply to the HTTP API (loopback Host/Origin only).
- `SIGINT` / `SIGTERM` shut down managed helper processes (e.g. opencode) and exit.

### Backup / restore

```bash
threadle export --backup                         # → ./threadle-backup-<stamp>.json
threadle export --backup ~/Desktop/backup.json
threadle import ~/Desktop/backup.json            # writes graphs/payloads/nodes/settings
```

Schema: `threadle/backup@1` (JSON pack of config files — not the session observability bundle). Bare `threadle export out.json` still works as a legacy alias for `--backup` when `out.json` is not a resolvable graph.

### Portable graph export / import

```bash
threadle export hello-wire ./hello.json          # template / recipe / graph id / name
threadle export <graphId>                        # → ./threadle-<slug>.json
threadle import ./hello.json                     # saves under ~/.config/threadle/graphs/
```

Same `threadle/graph@1` shape as the canvas **⤒ export** download. `threadle run ./hello.json` still imports implicitly before executing.

### Triggers (`threadle daemon`)

Copy [`examples/triggers/triggers.example.json`](../../examples/triggers/triggers.example.json) to `~/.config/threadle/triggers.json`. Cron (5-field) and path-watch entries call the detached executor with `approveAll` as configured.

### Examples

```sh
threadle
threadle daemon
threadle --port 4600 --no-open
threadle --dir ~/src/my-app
```

---

## Jobs & inventory

These talk to a **running** server (`THREADLE_URL` / `--port`). `templates` is the exception — it prints the bundled catalog offline.

### Jobs

| Command | Effect |
|---|---|
| `threadle jobs` | Recent jobs (all statuses) |
| `threadle status` | Running only; `--all` ≈ `jobs` |
| `threadle attach <jobId>` | Follow logs until the job ends |
| `threadle logs [jobId] [-f]` | One job or recent cross-job lines; `-f` = attach |
| `threadle stop <jobId>` | Cancel |

### Inventory

| Command | Effect | Flags |
|---|---|---|
| `services` / `health` | Health + process + providers | — |
| `providers` | Adapters only | — |
| `agents` | Discovered agents | `--dir` |
| `sessions` | Session list | `-q`, `--provider`, `--limit`, `--dir` |
| `graphs` / `workflows` | Saved graphs | — |
| `models` | `/api/models` | — |
| `nodes` | Custom nodes | — |
| `skills` | Skill libraries (SKILL.md packs) | `list` / `import` / `export` / `toggle`; `--auto` / `--manual`; import `--scope` / `--location` |
| `templates` | Bundled teaching examples | also `--list-templates` |
| `recipes` | Job recipes (`examples/recipes`) | offline |
| `check` | PATH + providers + config + UI assets | offline |
| `mcp` | Stdio MCP server — workflows as tools | offline |

```sh
threadle services
threadle agents --dir .
threadle sessions -q auth --provider cursor
threadle graphs && threadle models && threadle nodes
threadle skills
threadle skills import ./review.SKILL.md
threadle skills export review-diff ./review.SKILL.md
threadle skills toggle review-diff --manual
threadle mcp   # stdio — use from .mcp.json, not a TTY
```

### Skills

Parity with the canvas **Skills** view. Needs a running server.

```sh
threadle skills                              # list (alias: skills list)
threadle skills import <file.md> [--scope global] [--location threadle-imported]
threadle skills export <name|path> [out.md]
threadle skills toggle <name|path> --auto|--manual
```

- **list** — name, auto/manual mode, origin, scope, shadowed flag, description
- **import** — writes under threadle-imported (or `--location threadle-custom` / agent homes)
- **export** — downloads the skill’s `SKILL.md` (default `./<name>.SKILL.md`)
- **toggle** — sets `disable-model-invocation` frontmatter (`--manual`) or clears it (`--auto`)

### MCP

`threadle mcp` lists each saved workflow as tool `wf_<graphId>` (skips subgraphs). Args map from workflow params; execution uses `approveAll: false` and returns concatenated output-node text. Publish allowlist defaults to none.

**Full how-to** (connect hosts, canvas client node, guards, examples): [docs/mcp.md](../mcp.md) · [examples/mcp/](../../examples/mcp/).

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

```sh
threadle run examples/workflows/mcp-brief.json   # save a param-driven tool graph
threadle mcp                                     # stdio — host owns the process
```

---

## `threadle run`

```sh
threadle run <target> [options]
```

Runs a workflow with the **server-side** executor (same path as **▶ Run** on a graph without interactive gates, and as **≫**): prompts, converters, custom nodes, agents, sessions, iterators, frames, mute/bypass, error policy, and `{{param:…}}` substitution. Result statuses and output-node contents are written back to the graph under `~/.config/threadle/graphs/`.

### Target resolution (in order)

1. **Recipe** — id from `threadle recipes` (e.g. `repo-brief`)
2. **Bundled template** — id from `--list-templates` (e.g. `plan-implement-review`)
3. **Filesystem path** — if `<target>` exists as a file, parse as portable `threadle/graph@1` JSON and import
4. **Example / recipe JSON** — `examples/recipes/<target>.json` or `examples/workflows/<target>.json` relative to cwd
5. **Saved graph id** — eight-character id (or whatever id is on disk) under `~/.config/threadle/graphs/<id>.json`

If none match, the command fails with a message listing known recipe and template ids.

### Options

| Flag | Description |
|---|---|
| `--param <name>=<value>` | Set a workflow param (repeatable). Name: `[a-zA-Z0-9_-]{1,64}`. Value max 100 000 chars. |
| `--approve-all` | Auto-approve every approval-gate node. **Required** if the graph has gates; otherwise the run refuses to start. |
| `--dir <path>` | Project directory for agent CLIs (default: `cwd`) |
| `--keep` | Keep an imported graph after the run (default for file/template imports) |
| `--ephemeral` | Delete the imported graph after a **foreground** run (ignored if `--keep`; refused with `--detach`) |
| `--detach` | Start on the running server (`POST /api/run/workflow`), print `jobId`, exit. Requires `threadle` already listening. |
| `--watch` | After a successful run, re-run when the **portable graph file** mtime changes and/or when **git** status under `--dir` (or cwd) changes. Non-git projects without a graph file fall back to a directory fs watch. Not with `--detach` / `--ephemeral`. Prefer `triggers.json` + `threadle daemon` for multi-graph automation. |
| `--list-templates` | Global flag (not nested under `run`): list templates and exit |

### Detached runs

```sh
# terminal A
threadle --no-open

# terminal B — fire several in parallel
threadle run knot-concat --detach
threadle run hello-wire --detach
threadle run detached-delay --detach   # ~60s agent-free — watch jobs/logs
threadle status
threadle jobs
threadle attach job_….…
threadle logs job_….… --follow
threadle stop job_….…
threadle services
```

Same job registry as UI **▶** / **≫**. Parallelism across jobs is “start many server jobs”; within a graph, `settings.ply` (UI: **parallelism**) caps concurrent ready nodes.

### Stdout lanes

Log lines are prefixed:

| Prefix | Lane |
|---|---|
| ` ` (space) | agent / node stdout-style output |
| `·` | meta (progress, skips, mute/bypass) |
| `!` | stderr / failures |

Banner lines:

```text
❯ running "<name>" (<graphId>) [imported]
✓ done — N output node(s) updated
· graph kept as <id> — open with: threadle
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Workflow finished |
| `1` | Execution error (graph kept unless `--ephemeral`) |
| `2` | Usage / parse error (missing target, bad `--param`, unknown command) |

### Signals

`SIGINT` / `SIGTERM` abort the in-flight run and shut down managed servers.

### Examples

```sh
# Iconic loop — bundled template
threadle run plan-implement-review \
  --param task="Add a regression test for the login race" \
  --approve-all \
  --dir .

# Portable export from another machine
threadle run ./plan-implement-review.json --approve-all

# Example checked into the repo
threadle run examples/workflows/plan-implement-review.json --approve-all

# Re-run a graph already in ~/.config/threadle/graphs
threadle run a1b2c3d4 --param task="retry with sharper brief" --approve-all

# CI-style: import, run, discard
threadle run plan-implement-review --approve-all --ephemeral
```

---

## Templates

```sh
threadle --list-templates
# same as:
threadle templates
```

Tab-separated: `id`, `level`, `name`, `description`. Portable JSON for every id lives under [`examples/workflows/`](../../examples/workflows/) (see that README for the full table).

| id | Level | Notes |
|---|---|---|
| `hello-wire` | beginner | Prompt → output, no agent |
| `splice-gate` | beginner | Approval + splice |
| `one-shot-agent` | beginner | Prompt → agent → output |
| `param-prompt` | beginner | `{{param:topic}}` |
| `prompt-convert` | beginner | Converter template |
| `detached-delay` | intermediate | ◷ Delay (~60s) |
| `knot-concat` | intermediate | ⋈ Merge concat |
| `knot-first` | intermediate | ⋈ Merge first-wins |
| `iterator-lines` | intermediate | ∀ split checklist |
| `mute-bypass` | intermediate | Mute / bypass |
| `content-tripwire` | intermediate | ‡ Content breaker parks on ERROR |
| `judge-branch` | intermediate | ? Judge routes pass / fail / unsure |
| `until-reenter` | intermediate | ↻ Until counted re-entry |
| `wait-idle-gate` | intermediate | ◌ Wait until session idle |
| `min-chars-tripwire` | intermediate | ‡ Min-chars breaker |
| `spend-tripwire` | intermediate | Spend ceiling + branch breaker |
| `agent-err-fallback` | advanced | Agent red `out:err` connector → fallback convert |
| `skill-invoke-judge` | advanced | ✦ Skill invoke (`/{name}` on any provider) → ? Judge |
| `iterator-agent` | advanced | ∀ + agent per item (serial) |
| `iterator-parallel` | advanced | ∀ parallel map + Merge |
| `token-tripwire` | advanced | ‡ Token breaker skip |
| `plan-implement-review` | advanced | Plan → implement → review |
| `ply-fan-knot` | advanced | Parallelism=2 + majority merge |
| `expert-guarded-fan` | expert | Parallel fan, merge, breaker, splice |
| `complex-delay-pipeline` | expert | 5 subgraphs, delays only |

UI equivalent: **Workflows → Examples**, or `POST /api/graphs/templates/:id`.

Job recipes (diff review, handover, …) live separately — `threadle recipes`, **Workflows → recipes**, `GET|POST /api/graphs/recipes`. See [examples/recipes/](../../examples/recipes/README.md).

---

## Portable graphs (`threadle/graph@1`)

Export from the canvas (**⤒** download), or from the CLI:

```bash
threadle export <graphId|name|recipe|template|file> [out.json]
threadle import ./flow.json
```

Shape (zod: `portableGraphSchema`):

```json
{
  "$schema": "threadle/graph@1",
  "name": "My flow",
  "params": [{ "name": "task", "type": "text", "default": "…" }],
  "nodes": [ /* graph nodes, status idle */ ],
  "edges": [ /* … */ ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

### What export strips (so files travel)

| Cleared | Why |
|---|---|
| `lastRunId`, `status`, `resolved` | Runtime-only |
| Skill / rules **absolute paths** | Re-resolve by `name` (+ `origin` / `source`) on import |
| Session / subagent `sessionId` | Machine-local |
| Context `payloadHash` | Content-addressed local store |
| Group `graphId` | Local sub-workflow link |
| Output `content` / `preview` | Run artifacts |
| Absolute agent `source` paths | Normalized to `<provider>:file` |

**Kept:** `params`, `kind` (`workflow` \| `subgraph`). Builtin agent refs (`cursor:builtin`, …) stay as-is.

Legacy graphs without `kind` load as **workflow**. Extracting a selection creates a **subgraph**; drag a workflow onto the canvas to embed a confirmed subgraph clone.

For a **full machine** archive (graphs + payloads + nodes + settings + favorites + folders), use `threadle export --backup` / `import` (`threadle/backup@1`) — not portable export. Graph **version history** lives under `~/.config/threadle/graphs/versions/<id>/` (editor topbar → versions).

### Import / resolve

`threadle run` and `POST /api/graphs/import` call the same import path: fresh graph id, idle nodes, skill/rules path fill when a matching artifact exists on the machine. Missing skills fail at run time (or stay muted if the node is muted).

---

## Watch mode

```sh
threadle run <target> --watch --approve-all [--dir <project>]
```

Poor-man’s trigger (single graph, foreground):

1. **Graph file mtime** — if `<target>` is a portable / example `.json`, reload that file into the same graph id and re-run when it changes.
2. **Git changes** — if `--dir` (default cwd) is a git work tree, poll `HEAD` + `git status --porcelain` and re-run on change.
3. **Fallback** — non-git project and no graph file → directory fs watch (ignores `.git`, `node_modules`, build dirs).

The first run must succeed before watching starts. Graph id is stable across re-runs (no duplicate imports). Incompatible with `--detach` and `--ephemeral`.

Prefer `triggers.json` + `threadle daemon` for scheduled / multi-graph automation.

---

## Open UI

```sh
threadle open                              # home
threadle open skills                       # dashboard tab
threadle open workflow <id|name>           # /graph/:id
threadle open session <provider> <id>      # /blueprint/…
threadle open session cursor:abc123
threadle open skill review-diff            # Skills tab + focus
threadle open rules CLAUDE.md              # Rules tab + focus
threadle open run <jobId>                  # Runs tab
threadle open map | timeline | lineage
threadle open --print skills               # print URL only
```

Needs a running server (`threadle --no-open`). Override base with `THREADLE_URL` / `--port`.

---

## Git ↔ session (API)

```http
GET /api/git/sessions?dir=<repo>&commit=<sha>
```

Ranks **possible** sessions by time / branch / files touched. Heuristic only — also surfaced in the Activity view.

---

## Partial runs & replay

Canvas **Run from** / **Test** stay in-tab and reuse upstream node texts outside the scope. Detached jobs can pass the same idea via `scope` and optional `replayFromJobId`; successful node texts land in `runs/<jobId>/outputs.json` for later replay.

---

## Environment

| Variable | Effect |
|---|---|
| `THREADLE_CONFIG_DIR` | Override config root (default `~/.config/threadle`; Windows: `%USERPROFILE%\.config\threadle`) |
| `THREADLE_URL` | Base URL for inventory / jobs / `run --detach` (default `http://127.0.0.1:<port>`) |
| `THREADLE_MCP_PROJECT_DIR` | Project dir for `threadle mcp` workflow tool runs (default cwd) |

Under that directory: `graphs/`, `skills/`, `nodes/`, `payloads/`, `runs/`, etc.

---

## Detached-run constraints (CLI and ≫)

Same preflight as the UI server runner (`assessDetachedReadiness`):

- **Approval gates** — need `--approve-all` / `approveAll: true`
- **Context nodes** — extract / distill / files mid-run when a session or agent is wired; or reuse a Library `payloadHash`
- **Skill / rules** — need `path` or resolvable `name`
- **Frames** — illegal cross-frame wires block the run

Interactive canvas runs can pause at approval docks; server jobs cannot without approve-all.

---

## Relation to the HTTP API

| CLI | API |
|---|---|
| `threadle` | Serves `/api/*` + UI |
| `threadle run … --detach` | Import (if needed) + `POST /api/run/workflow` |
| `threadle run …` (foreground) | In-process `executeWorkflow` (no long-lived job unless you use `--detach`) |
| `threadle status` | `GET /api/jobs` (CLI filters to running unless `--all`) |
| `threadle jobs` | `GET /api/jobs` |
| `threadle logs [id]` | `GET /api/jobs/:id/logs` or `GET /api/jobs/logs/all` |
| `threadle attach <id>` | Same as `logs <id> --follow` (poll until terminal status) |
| `threadle stop <id>` | `DELETE /api/jobs/:id` |
| `threadle services` | `GET /api/health` + `/api/internals/process` + `/api/providers` |
| `threadle agents` | `GET /api/agents` |
| `threadle sessions` | `GET /api/sessions` |
| `threadle graphs` | `GET /api/graphs` |
| `threadle models` | `GET /api/models` |
| `threadle nodes` | `GET /api/custom-nodes` |
| `threadle skills` | `GET /api/rules` (skills only) |
| `threadle skills import` | `POST /api/rules/skill/import` |
| `threadle skills export` | `GET /api/rules/skill/export` |
| `threadle skills toggle` | `POST /api/rules/skill/toggle` |
| `threadle open …` | Opens browser to UI deep link (no API) |
| `threadle templates` | Bundled catalog (or `GET /api/graphs/templates`) |
| `threadle recipes` | Job recipes (or `GET /api/graphs/recipes`) |
| `threadle check` | Offline: Node, config, web-dist, templates, CLI PATH, providers |
| `threadle check --providers` | Also probe inject-critical tokens in CLI help (subcommand help / aliases where needed; skip missing binaries) |
| `threadle --list-templates` | `GET /api/graphs/templates` |

UI **▶** (no gates) and **≫** use the same `POST /api/run/workflow` path as `--detach`.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `approval gate(s) — pass approveAll` | Add `--approve-all` |
| `no skill named "…" found` | Install/unmute the skill, or mute the node in the UI and re-export |
| `nothing to run for "…"` | Path, recipe id, template id, or graph id wrong; run `threadle recipes` / `--list-templates` |
| `threadle server not reachable` | Start `threadle --no-open` before `jobs` / `services` / `skills` / `open` / `run --detach` |
| Agent CLI not found | Install Cursor `agent` / Claude Code / opencode / Antigravity `agy` / Codex / GitHub Copilot / Grok Build; ensure on `PATH` — or run `threadle check` |
| Wrong project files | Pass `--dir` to the repo root you intend |
| `context not materialized` / blocked ❝ | Wire a session/agent (extracts mid-run), drag from Library, or mute |

---

## See also

- [CLI README](README.md) — short overview
- [examples/recipes](../../examples/recipes/) — job recipes
- [examples/workflows](../../examples/workflows/) — teaching templates
- [Custom nodes](../custom-nodes.md) — `~/.config/threadle/nodes/`
- Root [README](../../README.md) — product overview
