# Adding a built-in node

Prefer a [custom node](./custom-nodes.md) when the behavior is yours — including
utilities from the [stdlib pack](../examples/nodes/stdlib/PACK.md) (`jq`, `diff`,
…). Use a **built-in** only when threadle itself must own the type.

**Freeze:** do not add new built-in node types until canvas + server runners share
one execute path for control-flow (see `AGENTS.md`). Prefer stdlib / recipes.

Built-ins are registered in `packages/shared/src/nodes/builtins.ts` as a
`NodeDefinition`. Palette, wire menu, connection product, port limits, mute,
and “can run” flags are **derived** from that catalog.

Recent example: **Wait for idle** (`type: "wait-idle"`) — park until a session is
not `running`/`waiting`. Also **Until** (`type: "until"`) — counted re-entry
(`out:reenter` / `out:exhausted`); reenter edges ignored by topo. Also **Judge**
(`type: "judge"`) and the agent **error connector** (`sourceHandle: "out:err"` —
lower red port on agent-def cards). Iterator **`mode: parallel`** fans items into
fresh agent sessions under ply (join with Merge).

## Checklist

1. **Catalog** — add a `NodeDefinition` in `packages/shared/src/nodes/builtins.ts`
2. **Shape** — `NodeType` + data interface + zod in `packages/shared/src/graph.ts`
3. **Defaults** — `buildNode` branch in `GraphEditor.vue`
4. **Card** — `canvas/nodes/YourNode.vue` + `#node-…` Vue Flow slot
5. **Run** — canvas `execNode` **and** `workflows/executor.ts` (keep in sync)
6. **Theme** — `--wire-…` in `theme.css` when you introduce a new wire color

Full walkthrough with flag reference: docs site
**Extend → Adding a built-in node** (`threadle-docs-wip`).

## Verify

```bash
cd packages/server && npm test -- node-definitions
cd packages/web && npm run typecheck
```
