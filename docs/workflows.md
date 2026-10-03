# Workflows (addon) — soft freeze

Workflows is an optional **addon**: canvas editor + runner in the same
`npx threadle` install. It is **not** the reason threadle exists. It lives in
its own packages (ComfyUI-style editor/runner next to the viewer):

| Package | What |
|---|---|
| `packages/workflows-shared` | graph schema, node catalog, pure runner helpers |
| `packages/workflows-server` | graph store, headless executor, triggers, templates/recipes, custom nodes, MCP workflow tools |
| `packages/workflows-web` | editor UI (Workflows list, GraphEditor, palette, inspector) |

## Running it

- `threadle-workflows` — the workflows addon on http://127.0.0.1:4571. UI paths under `/addon/workflows` (list, runs, logs, nodes, graph editor). Fires `triggers.json`.
- `threadle` — the viewer on http://127.0.0.1:4570. Sidebar **Addons → Workflows** (soft `addon` tag); that link, graph links and "send to workflow" open the addon in its own tab (or tell you to start it). Settings → Addons → Workflows for examples / open.
- Both share `~/.config/threadle`, so graphs, runs and payloads are the same in both.
- `threadle --no-workflows` — viewer without the workflows addon API at all.
- Dev: `npm run dev` → API :4570, viewer Vite :5173, workflows Vite :5174.

## Hold

- **Do:** fix breakage, handoff-shaped polish, keep `check:boundary` green.
- **Don’t:** new graph node types / verbs, orchestration OS ambition, second product name.
- Built-in verb freeze stays in `AGENTS.md` until canvas + server share one execute path.

## After launch

Watch issue mix. If the addon stays unused, freeze harder (or stop shipping it in the default bin). If it heats up, the packages are ready to publish on their own.
