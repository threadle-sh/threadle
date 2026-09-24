# threadle — agent instructions

threadle is a local-first multi-provider viewer for CLI agent sessions (Claude Code,
opencode, Cursor Agent, Antigravity, Codex, GitHub Copilot, Grok Build, Muse Code):
observability (sessions, blueprints, activity, statistics) plus optional context
wiring on a canvas (**Wire**, soft-frozen / beta).

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
| Triggers | `~/.config/threadle/triggers.json` + `threadle daemon` |
| Model usage | Claude 5h / 7d (+ Opus 7d) from `~/.claude.json`; Cursor monthly pools via CLI — run-log `!` + agent chip |
| Auto-memory | Agents → **memory** chip (Claude / Grok md / Codex stage1+FS). Not Meta. Antigravity `knowledge/` → Meta when it has files; EchoVault / Grok memtrace / Codex `jobs` → no Memory nav |
| Wire | Canvas / workflow editor (nav: **Wire (beta)**); not a separate product |

## Layout

Logical boundaries (Phase 1 — folders inside existing packages; npm bin stays `threadle`):

- `packages/shared` — types + zod schemas (SessionRef, Graph, ContextPayload)
  and the built-in `NodeDefinition` catalog (`src/nodes/`). Single source of
  truth; UI and server both import it.
- `packages/server` — Hono API (`bin: threadle`). **Core:** `src/providers/`,
  sessions/pricing/routes. **Wire:** `src/wire/workflows/` (executor, skill
  invoke). Composition roots (`server.ts`, `cli.ts`, `routes/run.ts`, …) may
  mount wire; other core modules must not import `wire/`.
- `packages/web` — Vue 3 + Vue Flow. True-black monochrome theme
  (`src/theme/theme.css`); no emojis, text glyphs only (❯ ⎇ ⟨/⟩ ▤ ⚙ ✦).
  - `src/viewer/` — sessions, map, projects, blueprints, dashboard views
  - `src/wire/` — GraphEditor, canvas nodes, graph-editor chrome
  - `src/views/GraphList.vue` + `router.ts` — app shell (may import both)
  - **Hard rule:** `viewer/**` must not import `wire/**` (`npm run check:boundary`)

## Rules

- **Viewer first.** Default UI is Sessions (and Projects); Wire is beta/reachable,
  not the product center. Prefer handoff-shaped wire work over new orchestration.
  Dogfood loop: [docs/dogfood.md](docs/dogfood.md). Wire hold: [docs/wire.md](docs/wire.md).
- **Wire soft-freeze.** Fix breakage only; no new orchestration ambition, package
  split, or second product name until launch feedback says otherwise.
- **Freeze built-in verbs.** Do not add new graph node types (`NodeType` /
  `builtins.ts`) until the canvas (`wire/GraphEditor.vue`) and server
  (`wire/workflows/executor.ts`) runners share one execute path for control-flow.
  Full-graph and partial ▶ already hit `POST /api/run/workflow`. In-tab
  `runGraph` is only the splice fallback (approval / live handoff). Prefer
  custom nodes / stdlib / recipes. Shared pure helpers live in
  `packages/shared` (`judge`, `until`, `wait-idle`, `iterator`, …).
- Never write into `~/.claude/projects`, opencode's SQLite, `~/.cursor`
  chats/transcripts, `~/.gemini/antigravity-cli`, `~/.codex`, `~/.copilot`, `~/.grok`, `~/.muse`, or `~/.local/share/muse`; parsers must skip unknown
  record types, not throw (formats are undocumented and churn).
- All list/table UIs: mono micro-labels, right-aligned numeric columns,
  `minmax(0, 1fr)` name columns, values ellipsize instead of wrapping.
- Shared nav lives in `packages/web/src/panels/nav-items.ts` — never fork it.
- Typecheck both packages (`vue-tsc`, `tsc`), run `npm run check:boundary`, and
  run `vitest` in `packages/server` before considering a change done.
- Verify UI changes with a headless-Chromium screenshot, not by reasoning
  about CSS.

## Commands

- `npm run dev` — server (tsx, :4570) + Vite (:5173)
- `npm run build` — web → `packages/server/web-dist`, then server bundle
- `npm run check:boundary` — viewer/core must not import wire
- `npm test` — boundary check + vitest suites in packages/server
