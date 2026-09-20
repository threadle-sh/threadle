<p align="center">
  <img src="images/header.jpg" alt="threadle" width="920" />
</p>
<p align="center"><strong>The node-graph patchbay for your AI coding sessions.</strong></p>
<p align="center"><em>From session to the next run.</em></p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-white?style=flat-square&labelColor=0a0a0c" alt="MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022.12-white?style=flat-square&labelColor=0a0a0c" alt="Node ≥ 22.12" /></a>
  <a href="docs/install.md"><img src="https://img.shields.io/badge/os-macOS%20%7C%20Linux%20%7C%20Windows-white?style=flat-square&labelColor=0a0a0c" alt="macOS / Linux / Windows" /></a>
  <a href="https://github.com/threadle-sh/threadle/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/threadle-sh/threadle/ci.yml?branch=main&style=flat-square&label=ci&labelColor=0a0a0c" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/threadle"><img src="https://img.shields.io/npm/v/threadle?style=flat-square&labelColor=0a0a0c&color=white" alt="npm" /></a>
  <a href="https://github.com/threadle-sh/threadle/releases"><img src="https://img.shields.io/github/v/release/threadle-sh/threadle?style=flat-square&labelColor=0a0a0c&color=white" alt="release" /></a>
</p>

Your agents write everything down: transcripts, tool calls, files touched, spend. Then nobody reads it, and the context dies at each tool boundary. threadle reads it, draws it, and lets you wire it into the next run. Every [Claude Code](https://claude.com/claude-code), [opencode](https://opencode.ai), [Cursor](https://cursor.com) `agent`, [Antigravity](https://antigravity.google) `agy`, [Codex](https://github.com/openai/codex), [GitHub Copilot](https://github.com/features/copilot) CLI, and [Grok Build](https://x.ai/cli) session becomes a wireable node. Inspect what happened. Hand context across tools. Run the pipeline.

**Yours, with no catch.** Discovery is read-only against storage you already have. threadle binds `127.0.0.1`, has no account and no telemetry, and does not upload transcripts. Pressing ▶ drives each tool’s own CLI under your credentials. If threadle disappears tomorrow, your sessions are exactly where they always were.

[Website](https://threadle.sh) · [Docs](https://docs.threadle.sh) · [Install](docs/install.md) · [CLI](docs/cli/) · [MCP](docs/mcp.md) · [Security](SECURITY.md)

<p align="center">
  <a href="https://docs.threadle.sh">
    <img src="docs/screenshots/canvas.png" alt="threadle canvas: agents, sessions, and context wired into one workflow" width="920" />
  </a>
</p>
<p align="center"><em>One canvas. Every agent.</em></p>

---

## Install

**Curl portable.** macOS or Linux (arm64 / x64), bundled Node 26:

```bash
curl -fsSL https://threadle.sh/install.sh | bash
threadle                                 # http://127.0.0.1:4570
```

**Windows, and anywhere with Node ≥ 22.12.** Use npm:

```bash
npx threadle
# or from a clone
git clone https://github.com/threadle-sh/threadle && cd threadle
npm install && npm run build && npm start
```

Prefer **WSL** on Windows if you want the curl installer and Linux agent paths (`~/.claude`, …). Native Windows threadle sees native Windows agent homes (`%USERPROFILE%\.…`). It does not bridge into WSL storage.

> [!TIP]
> Sessions appear on first launch, nothing to import. `threadle check` verifies PATH, provider storage, and UI assets. `threadle check --providers` probes inject-critical CLI flags.

Pin a curl release with `THREADLE_VERSION=1.0.2`. Uninstall as cleanly as you installed: `rm -rf ~/.local/share/threadle ~/.local/bin/threadle`. Everything threadle wrote lives in `~/.config/threadle`. [Install notes](docs/install.md) · [provider freshness](docs/provider-freshness.md)

## Quick start

```bash
threadle                                 # UI
threadle run hello-wire                  # agent-free example
threadle run plan-implement-review --param task="…" --approve-all
```

## How it fits together

- **See.** Every session on disk, with spend, cache, and context pressure. Open a blueprint for turns, tools, files, subagents.
- **Connect.** Distill a session into a brief and inject it into another tool. Payloads stay tagged and show up in lineage.
- **Run.** Wire agents, gates, iterators, merges. ▶ is a server job. Approval parks for a splice, and live handoff chats until Ready.
- **Ask.** `threadle mcp` exposes sessions and saved workflows as MCP tools, so your agent can answer *"what did I spend on this last week?"* without leaving the session.

<p align="center">
  <a href="https://docs.threadle.sh">
    <img src="docs/screenshots/blueprint.png" alt="Session blueprint: turns, tool calls, files touched, and subagents for one session" width="920" />
  </a>
</p>
<p align="center"><em>Every session, drawn. See what your agents did while you weren't looking.</em></p>

A handoff, concretely:

```
Claude Code plans an auth refactor   →  the session appears in threadle
Distill it into a brief              →  tagged, content-addressed, in the library
Inject the brief into Cursor         →  same repo, next tool, no copy-paste
Lineage: session → brief → session   →  nothing lost at the boundary
```

Recipes (`best-of-n`, `handover-brief`, …) live in [`examples/recipes/`](examples/recipes/).

<details>
<summary><strong>Eight views, one source of truth</strong> · sessions · lineage · map · timeline · library · statistics · files · subworkflows</summary>
<br />
<p align="center">
  <img src="docs/screenshots/sessions.png" alt="Sessions: every local session with tokens, cache, and spend" width="920" />
  <br /><br />
  <img src="docs/screenshots/lineage.png" alt="Lineage: a brief traced from the session that made it to every run it fed" width="920" />
  <br /><br />
  <img src="docs/screenshots/map.png" alt="Map: one project as a graph of sessions, contexts, workflows, and agents" width="920" />
  <br /><br />
  <img src="docs/screenshots/timeline.png" alt="Timeline: provider-colored swimlanes of parallel work on one clock" width="920" />
  <br /><br />
  <img src="docs/screenshots/library.png" alt="Library: saved workflows and content-addressed briefs, ready to reuse" width="920" />
  <br /><br />
  <img src="docs/screenshots/statistics.png" alt="Statistics: spend, tokens, and cache across providers and projects" width="920" />
  <br /><br />
  <img src="docs/screenshots/files.png" alt="Files: every file a session touched, diffable and traceable" width="920" />
  <br /><br />
  <img src="docs/screenshots/subworkflows.png" alt="Subworkflows: a graph that nests other graphs as reusable steps" width="920" />
</p>

The full set lives in [`docs/screenshots/`](docs/screenshots/).
</details>

## Trust

Parsers never mutate `~/.claude`, opencode’s SQLite, `~/.cursor`, `~/.gemini/antigravity-cli`, `~/.codex`, `~/.copilot`, or `~/.grok`. Runs spawn the official CLI, and *it* writes new sessions.

The server rejects foreign `Host` (DNS rebinding) and cross-site write `Origin` (CSRF). There is no remote mode and no auth token. List prices ship bundled (CI-refreshed from [models.dev](https://models.dev)). The process does not fetch them at runtime. Everything threadle persists is under `~/.config/threadle/`.

Detached / CLI runs cannot splice a parked gate or distill mid-run. They need `--approve-all` or a pre-materialized payload. Live chat stays on the canvas. [Constraints](docs/cli/manual.md#detached-run-constraints-cli-and-).

## Documentation

| Goal | Start here |
| --- | --- |
| Tour, learning path, recipes | [docs.threadle.sh](https://docs.threadle.sh) |
| CLI, jobs, detached runs | [docs/cli](docs/cli/), also `skills`, `open`, `run --watch` |
| MCP server + canvas client | [docs/mcp.md](docs/mcp.md) · [examples/mcp](examples/mcp/) |
| Custom nodes | [docs/custom-nodes.md](docs/custom-nodes.md) · [stdlib pack](examples/nodes/stdlib/) |
| File viewer | [docs/file-viewer.md](docs/file-viewer.md) |

## Development

```bash
git clone https://github.com/threadle-sh/threadle.git
cd threadle
npm install
npm run dev                              # API :4570 + Vite :5173
```

```
packages/shared   types, zod, node catalog
packages/server   Hono API + `threadle` bin
packages/web      Vue 3 + Vue Flow
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks before a PR. The fastest bug report is an issue with a session bundle attached (*Sessions → ⇓ bundle*).

## License

[MIT](LICENSE) © Fabian Bienk / [zFarbp](https://github.com/zFarbp)
