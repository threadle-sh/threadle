# NodeDefinition

Built-in graph types are registered as a `NodeDefinition` in
`packages/shared/src/nodes/`. Menus, wiring, ports, and mute/run flags are
derived from that catalog.

Full write-up: docs site **Extend → NodeDefinition**.  
Contributor checklist: [Adding a built-in node](./add-builtin-node.md).

Custom nodes are separate — see [custom-nodes.md](./custom-nodes.md) and the
walkthroughs linked from the docs site (Extract URLs, Command node, Typed chain).
