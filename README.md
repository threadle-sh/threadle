<p align="center">
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/images/header.jpg" alt="threadle" width="920" />
</p>
<p align="center"><strong>See what your agents did.</strong></p>
<p align="center"><em>Local multi-provider session viewer. Nothing to import.</em></p>
<p align="center">
  <a href="https://github.com/threadle-sh/threadle/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-white?style=flat-square&labelColor=0a0a0c" alt="MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2022.12-white?style=flat-square&labelColor=0a0a0c" alt="Node ≥ 22.12" /></a>
  <a href="https://github.com/threadle-sh/threadle/blob/main/docs/install.md"><img src="https://img.shields.io/badge/os-macOS%20%7C%20Linux%20%7C%20Windows-white?style=flat-square&labelColor=0a0a0c" alt="macOS / Linux / Windows" /></a>
  <a href="https://github.com/threadle-sh/threadle/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/threadle-sh/threadle/ci.yml?branch=main&style=flat-square&label=ci&labelColor=0a0a0c" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/threadle"><img src="https://img.shields.io/npm/v/threadle?style=flat-square&labelColor=0a0a0c&color=white" alt="npm" /></a>
  <a href="https://github.com/threadle-sh/threadle/releases"><img src="https://img.shields.io/github/v/release/threadle-sh/threadle?style=flat-square&labelColor=0a0a0c&color=white" alt="release" /></a>
</p>

threadle turns every AI coding session on your machine into something you can inspect, search, and reuse locally.

Your agents already write everything down: transcripts, tool calls, token counts, the files they touched. Almost nobody reads it. threadle reads the storage you already have and draws it as sessions, blueprints, map, timeline, search, and statistics.

**Yours, with no catch.** Discovery is read-only. threadle binds `127.0.0.1`, has no account and no telemetry, and does not upload transcripts. If threadle disappears tomorrow, your sessions stay exactly where they always were.

From the tools you already run: [Claude Code](https://claude.com/claude-code), [opencode](https://opencode.ai), [Cursor](https://cursor.com) `agent`, [Antigravity](https://antigravity.google) `agy`, [Codex](https://github.com/openai/codex), [GitHub Copilot](https://github.com/features/copilot) CLI, [Grok Build](https://x.ai/cli), and [Muse Code](https://dev.meta.ai).

[Website](https://threadle.sh) · [Docs](https://docs.threadle.sh) · [Install](https://github.com/threadle-sh/threadle/blob/main/docs/install.md) · [CLI](https://github.com/threadle-sh/threadle/tree/main/docs/cli) · [MCP](https://github.com/threadle-sh/threadle/blob/main/docs/mcp.md) · [Security](https://github.com/threadle-sh/threadle/blob/main/SECURITY.md)

<p align="center">
  <a href="https://docs.threadle.sh">
    <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/sessions.png" alt="Sessions: every local session with tokens, cache, and spend" width="920" />
  </a>
</p>
<p align="center"><em>Every local session with tokens, cache, and spend. Grouped by project, live status included.</em></p>

<p align="center">
  <a href="https://docs.threadle.sh">
    <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/blueprint.png" alt="Session blueprint: turns, tool calls, files touched, and subagents" width="920" />
  </a>
</p>
<p align="center"><em>Every session, drawn.</em></p>

---

## Install

**Curl portable** (macOS or Linux, arm64 / x64, bundled Node 26):

```bash
curl -fsSL https://threadle.sh/install.sh | bash
threadle                                 # http://127.0.0.1:4570 → Sessions
```

**Windows, or anywhere with Node ≥ 22.12:**

```bash
npx threadle
# or from a clone
git clone https://github.com/threadle-sh/threadle && cd threadle
npm install && npm run build && npm start
```

Prefer **WSL** on Windows if you want the curl installer and Linux agent paths (`~/.claude`, …). Native Windows threadle sees native Windows agent homes (`%USERPROFILE%\.…`). It does not bridge into WSL storage.

> [!TIP]
> Sessions appear on first launch. Nothing to import. `threadle check` verifies PATH, provider storage, and UI assets. `threadle check --providers` probes inject-critical CLI flags.

Pin a curl release with `THREADLE_VERSION=1.2.0`. Uninstall as cleanly as you installed: `rm -rf ~/.local/share/threadle ~/.local/bin/threadle ~/.local/bin/threadle-workflows`. Everything threadle wrote lives in `~/.config/threadle`. [Install notes](https://github.com/threadle-sh/threadle/blob/main/docs/install.md) · [provider freshness](https://github.com/threadle-sh/threadle/blob/main/docs/provider-freshness.md)

## Quick start

```bash
threadle                                 # viewer, Sessions by default (:4570)
threadle check                           # PATH + provider storage
```

Open a session. Open its blueprint. Check Statistics when you care about spend.

## Viewer

**See.** Every local session across providers with spend, cache, and context pressure. Blueprints for turns, tools, files, and subagents. Map, timeline, search, and statistics.

**Connect.** Distill a session into a brief and inject it into another tool. Payloads stay tagged and show up in lineage.

A handoff, concretely:

```
Claude Code plans an auth refactor   →  the session appears in threadle
Distill it into a brief              →  tagged, content-addressed, in the library
Inject the brief into Cursor         →  same repo, next tool, no copy-paste
Lineage: session → brief → session   →  nothing lost at the boundary
```

<details>
<summary><strong>More views</strong> · lineage · map · timeline · library · growth · statistics · files · search</summary>
<br />
<p align="center">
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/lineage.png" alt="Lineage: a brief traced from the session that made it to every run it fed" width="920" />
  <br /><em>Follow a brief from the session that made it through every run it fed, across tools.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/map.png" alt="Map: one project as a graph of sessions, contexts, workflows, and agents" width="920" />
  <br /><em>One project as a graph: sessions, contexts, workflows, agents, and skills in one picture.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/timeline.png" alt="Timeline: provider-colored swimlanes of parallel work on one clock" width="920" />
  <br /><em>Parallel work on one clock: provider-colored swimlanes, zoom from a week to a minute.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/library.png" alt="Library: content-addressed briefs, ready to reuse" width="920" />
  <br /><em>Distilled briefs, tagged and content-addressed, ready to drag in again.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/growth-cache.png" alt="Growth: context tokens across prompts with cache overlay" width="920" />
  <br /><em>Context tokens across prompts. Peak, cache, and the turns that grew the window.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/statistics.png" alt="Statistics: spend, tokens, and cache across providers and projects" width="920" />
  <br /><em>Honest numbers per provider and project. Tracked dollars, not forecasts.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/files.png" alt="Files: every file a session touched, diffable and traceable" width="920" />
  <br /><em>Everything your agents touched, across sessions, with churn counts.</em>
  <br /><br />
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/search.png" alt="Search: full-text across transcripts and payloads" width="920" />
  <br /><em>Full-text across every transcript and payload. Ranked snippets, straight to the turn.</em>
</p>

The full set lives in [`docs/screenshots/`](https://github.com/threadle-sh/threadle/tree/main/docs/screenshots).
</details>

## Addon: Workflows

Optional. Soft-frozen. Not required for the viewer.

An optional editor for short, repeatable jobs across agents. Approvals, spend limits, and handoffs stay on your machine. Install once with threadle, then start it with `threadle-workflows` when you want the canvas:

```bash
threadle-workflows                       # editor + runner (:4571), UI under /addon/workflows
threadle run hello                       # bundled teaching graph
threadle run plan-implement-review --param task="…" --approve-all
```

<p align="center">
  <img src="https://raw.githubusercontent.com/threadle-sh/threadle/main/docs/screenshots/canvas.png" alt="Workflows addon: Plan → Implement → Review on a canvas" width="920" />
</p>
<p align="center"><em>Workflows addon. Optional canvas, same local install.</em></p>

Shipped recipes such as `best-of-n`, `diff-review-panel`, and `handover-brief` live in [`examples/recipes/`](https://github.com/threadle-sh/threadle/tree/main/examples/recipes). Hold rules and package layout: [docs/workflows.md](https://github.com/threadle-sh/threadle/blob/main/docs/workflows.md).

## Ask (MCP)

`threadle mcp` answers spend and session questions from inside a coding session. It can also expose saved Workflows graphs as tools when you use the addon.

## Trust

Parsers never mutate `~/.claude`, opencode’s SQLite, `~/.cursor`, `~/.gemini/antigravity-cli`, `~/.codex`, `~/.copilot`, `~/.grok`, `~/.muse`, or `~/.local/share/muse`. Runs spawn the official CLI, and *it* writes new sessions.

The server rejects foreign `Host` (DNS rebinding) and cross-site write `Origin` (CSRF). There is no remote mode and no auth token. List prices ship bundled (CI-refreshed from [models.dev](https://models.dev)). The process does not fetch them at runtime. Everything threadle persists is under `~/.config/threadle/`.

Detached CLI runs of Workflows graphs cannot splice a parked gate or distill mid-run. They need `--approve-all` or a pre-materialized payload. [Constraints](https://github.com/threadle-sh/threadle/blob/main/docs/cli/manual.md#detached-run-constraints-cli-and-).

## Documentation

| Goal | Start here |
| --- | --- |
| Tour, learning path, recipes | [docs.threadle.sh](https://docs.threadle.sh) |
| CLI, jobs, detached runs | [docs/cli](https://github.com/threadle-sh/threadle/tree/main/docs/cli) |
| MCP | [docs/mcp.md](https://github.com/threadle-sh/threadle/blob/main/docs/mcp.md) · [examples/mcp](https://github.com/threadle-sh/threadle/tree/main/examples/mcp) |
| Custom nodes | [docs/custom-nodes.md](https://github.com/threadle-sh/threadle/blob/main/docs/custom-nodes.md) · [stdlib pack](https://github.com/threadle-sh/threadle/tree/main/examples/nodes/stdlib) |
| File viewer | [docs/file-viewer.md](https://github.com/threadle-sh/threadle/blob/main/docs/file-viewer.md) |
| Workflows addon hold | [docs/workflows.md](https://github.com/threadle-sh/threadle/blob/main/docs/workflows.md) |

## Development

```bash
git clone https://github.com/threadle-sh/threadle.git
cd threadle
npm install
npm run dev                              # API :4570 + viewer :5173 + workflows :5174
npm run check:boundary                   # package dependency direction (viewer/core ↛ workflows)
```

```
packages/shared             core types + zod
packages/core               providers, sessions, runs, viewer API
packages/server             threadle + threadle-workflows bins (composition root)
packages/ui                 shared Vue shell (nav, stores, theme)
packages/web                viewer app (threadle)
packages/workflows-shared   graph schema, node catalog, runner helpers
packages/workflows-server   graph store, executor, triggers, templates
packages/workflows-web      workflows addon app (threadle-workflows)
```

See [CONTRIBUTING.md](https://github.com/threadle-sh/threadle/blob/main/CONTRIBUTING.md) and [AGENTS.md](https://github.com/threadle-sh/threadle/blob/main/AGENTS.md). The fastest bug report is an issue with a session bundle attached (*Sessions → ⇓ bundle*).

## License

[MIT](https://github.com/threadle-sh/threadle/blob/main/LICENSE) © Fabian Bienk / [zFarbp](https://github.com/zFarbp)
