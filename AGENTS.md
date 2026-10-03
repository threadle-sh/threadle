# threadle — agent instructions

threadle is a local-first multi-provider viewer for CLI agent sessions (Claude Code,
opencode, Cursor Agent, Antigravity, Codex, GitHub Copilot, Grok Build, Muse Code):
observability (sessions, blueprints, activity, statistics) plus optional context
wiring on a canvas (**Workflows** addon, soft-frozen).

## Vocabulary (UI + docs)

Plain terms lead. Graph JSON keeps historical type ids for compatibility.

| UI / docs | Graph JSON |
|---|---|
| Circuit breaker | `type: "tripwire"` |
| Merge | `type: "knot"` |
| Judge | `type: "judge"` |
| Until | `type: "until"` |
| Wait for idle | `type: "wait-idle"` |
| Error connector (agent) | `sourceHandle: "out:err"` |
| Parallelism | `settings.ply` |
| Parallel map (iterator) | `iterator.mode: "parallel"` |
| Spend ceiling | `settings.spendTripwireUsd` |
| Skill invoke | `skill.mode: "invoke"` (+ optional `provider`) |
| Graph lint | dock tab (not a node type) |
| Splice | edit at an approval / park gate |
| Backup bundle | `threadle/backup@1` (CLI export/import) |
| Graph history | `graphs/versions/<id>/` snapshots |
| Triggers | `~/.config/threadle/triggers.json` — fired by `threadle-workflows` or `threadle daemon` (viewer only with `--triggers`) |
| Model usage | Claude 5h / 7d (+ Opus 7d) from `~/.claude.json`; Cursor monthly pools via CLI — run-log `!` + agent chip |
| Auto-memory | Agents → **memory** chip (Claude / Grok md / Codex stage1+FS). Not Meta. Antigravity `knowledge/` → Meta when it has files; EchoVault / Grok memtrace / Codex `jobs` → no Memory nav |
| Workflows (addon) | Separate editor + runner app: `threadle-workflows` (:4571, dev :5174). UI under `/addon/workflows`. Viewer sidebar **Addons → Workflows** (soft `addon` tag); Settings → Addons → Workflows; graph links open the other app's tab |
| Runs / Logs | threadle jobs (workflow, agent, inject, distill, node) + job/app logs — pages in the **workflows addon**. CLI agent sessions live in the viewer's Sessions |

## Layout

Eight workspace packages. The viewer is the product; workflows (editor +
runner) are a separate, optional set of packages (ComfyUI-style). One npm bin
package (`threadle`) composes them. Two separate apps, same state (`~/.config/threadle`):

| App | Command | Port (dev UI) | UI build |
|---|---|---|---|
| Viewer | `threadle` | 4570 (Vite 5173) | `packages/web` → `server/web-dist` |
| Workflows addon | `threadle-workflows` | 4571 (Vite 5174) | `packages/workflows-web` → `server/web-dist-workflows` |

Both serve the full API; in dev one API server (:4570) backs both Vites.

| Package | Role | May depend on |
|---|---|---|
| `packages/shared` (`@threadle/shared`) | core types + zod (SessionRef, ContextPayload, api events, runs, GraphSummary) | — |
| `packages/workflows-shared` | graph schema, `NodeDefinition` catalog (`src/nodes/`), runner helpers (`judge`, `until`, `wait-idle`, `iterator`, …), graph import validation | shared |
| `packages/core` (`@threadle/core`) | providers, sessions, jobs/runs, context, pricing, viewer API routes | shared |
| `packages/workflows-server` | graph store, executor, triggers, templates/recipes, custom nodes, workflow MCP tools, `mountWorkflows()` | core, shared, workflows-shared |
| `packages/server` (`threadle`, bins `threadle` + `threadle-workflows`) | composition root: `server.ts`, `cli.ts`, `check.ts`; tsup bundles every `@threadle/*` | all server packages |
| `packages/ui` (`@threadle/ui`) | shell (DashNav, StatusBar), stores, core API client, theme (`src/theme/theme.css`), `boot.ts` | shared |
| `packages/workflows-web` | GraphEditor, canvas nodes, palette, inspector, Workflows list, graph API client | ui, shared, workflows-shared |
| `packages/web` (`@threadle/web`) | viewer app (`src/viewer/`, dashboard shell `src/views/Dashboard.vue`) | ui, shared — never the editor |

- Core asks workflows for data only through `core/src/workflows-port.ts`
  (registered by `mountWorkflows`); the viewer seeds workflows over HTTP
  (`POST /api/graphs/seed`) and opens the other app in its own tab
  (`ui/src/panels/app-links.ts`; app URLs from `/api/health`, liveness from `/api/apps`).
- Vite config for both apps: `packages/ui/vite.app.ts`; shared public assets in `packages/ui/public`.
- Web aliases: `@/` (web), `@ui/` (ui), `@wf/` (workflows-web).
- `threadle --no-workflows` serves the viewer without the workflows API (send-to-workflow is disabled).
- **Hard rule:** `npm run check:boundary` enforces the table above (imports + package.json deps).
- UI: true-black monochrome theme; no emojis, text glyphs only (❯ ⎇ ⟨/⟩ ▤ ⚙ ✦).

## Rules

- **Viewer first.** Default UI is Sessions; Workflows are an optional **addon**,
  not the product center. Prefer handoff-shaped workflow work over new orchestration.
  Workflows hold: [docs/workflows.md](docs/workflows.md).
- **Workflows soft-freeze.** Fix breakage only; no new orchestration ambition or
  second product name until launch feedback says otherwise. The package split
  is done — keep new workflow code inside the workflows packages.
- **Freeze built-in verbs.** Do not add new graph node types (`NodeType` /
  `builtins.ts`) until the canvas (`workflows-web/src/GraphEditor.vue`) and server
  (`workflows-server/src/workflows/executor.ts`) runners share one execute path for control-flow.
  Full-graph and partial ▶ already hit `POST /api/run/workflow`. In-tab
  `runGraph` is only the splice fallback (approval / live handoff). Prefer
  custom nodes / stdlib / recipes. Shared pure helpers live in
  `packages/workflows-shared` (`judge`, `until`, `wait-idle`, `iterator`, …).
- Never write into `~/.claude/projects`, opencode's SQLite, `~/.cursor`
  chats/transcripts, `~/.gemini/antigravity-cli`, `~/.codex`, `~/.copilot`, `~/.grok`, `~/.muse`, or `~/.local/share/muse`; parsers must skip unknown
  record types, not throw (formats are undocumented and churn).
- All list/table UIs: mono micro-labels, right-aligned numeric columns,
  `minmax(0, 1fr)` name columns, values ellipsize instead of wrapping.
- Shared nav lives in `packages/ui/src/panels/nav-items.ts` — never fork it.
- Run `npm run typecheck` (tsc for server packages, vue-tsc for web packages)
  and `npm test` (boundary check + vitest in core, workflows-server, server, ui)
  before considering a change done.
- Verify UI changes with a headless-Chromium screenshot, not by reasoning
  about CSS.

## Commands

- `npm run dev` — API server (tsx, :4570) + viewer Vite (:5173) + workflows Vite (:5174)
- `npm run build` — viewer → `server/web-dist`, workflows → `server/web-dist-workflows`, then server bundle
- `npm start` / `npm run start:workflows` — built viewer (:4570) / workflows app (:4571)
- `npm run typecheck` — every package
- `npm run check:boundary` — package dependency direction (table above)
- `npm test` — boundary check + all vitest suites
