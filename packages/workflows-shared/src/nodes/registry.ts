import type { NodeType } from "../graph.js";
import { BUILTIN_NODE_DEFINITIONS } from "./builtins.js";
import type { NodeDefinition, NodeMenuEntry } from "./definition.js";

const byId = new Map<NodeType, NodeDefinition>(
  BUILTIN_NODE_DEFINITIONS.map((d) => [d.id, d]),
);

/** All built-in definitions in registration order. */
export function allNodeDefinitions(): readonly NodeDefinition[] {
  return BUILTIN_NODE_DEFINITIONS;
}

export function getNodeDefinition(id: NodeType): NodeDefinition | undefined {
  return byId.get(id);
}

/** Throws if unknown — use after graph validation. */
export function requireNodeDefinition(id: NodeType): NodeDefinition {
  const d = byId.get(id);
  if (!d) throw new Error(`unknown node type: ${id}`);
  return d;
}

export function isTextSource(id: NodeType): boolean {
  return Boolean(byId.get(id)?.textSource);
}

export function isTextSink(id: NodeType): boolean {
  return Boolean(byId.get(id)?.textSink);
}

export const TEXT_SOURCES: readonly NodeType[] = BUILTIN_NODE_DEFINITIONS.filter(
  (d) => d.textSource,
).map((d) => d.id);

export const TEXT_SINKS: readonly NodeType[] = BUILTIN_NODE_DEFINITIONS.filter(
  (d) => d.textSink,
).map((d) => d.id);

export const STRUCTURAL_CONNECTIONS: ReadonlyArray<[NodeType, NodeType]> =
  BUILTIN_NODE_DEFINITIONS.flatMap((d) =>
    (d.structuralTo ?? []).map((t): [NodeType, NodeType] => [d.id, t]),
  );

export const FORBIDDEN_TEXT_PAIRS: ReadonlySet<string> = new Set(
  BUILTIN_NODE_DEFINITIONS.flatMap((d) =>
    (d.forbidTextTo ?? []).map((t) => `${d.id}>${t}`),
  ),
);

export const BUILTIN_PORT_LIMITS: Record<NodeType, { in: number; out: number }> =
  Object.fromEntries(
    BUILTIN_NODE_DEFINITIONS.map((d) => [d.id, { ...d.ports }]),
  ) as Record<NodeType, { in: number; out: number }>;

export const REQUIRES_INPUT: ReadonlySet<NodeType> = new Set(
  BUILTIN_NODE_DEFINITIONS.filter((d) => d.requiresInput).map((d) => d.id),
);

export const EMITS_TEXT: ReadonlySet<NodeType> = new Set(
  BUILTIN_NODE_DEFINITIONS.filter((d) => d.emitsText).map((d) => d.id),
);

export const MUTABLE_NODE_TYPES: ReadonlySet<NodeType> = new Set(
  BUILTIN_NODE_DEFINITIONS.filter((d) => d.mutable).map((d) => d.id),
);

export const SKIP_EXEC_TYPES: ReadonlySet<NodeType> = new Set(
  BUILTIN_NODE_DEFINITIONS.filter((d) => d.skipExec).map((d) => d.id),
);

export const SKIP_DETACHED_TYPES: ReadonlySet<NodeType> = new Set(
  BUILTIN_NODE_DEFINITIONS.filter((d) => d.skipExec || d.skipInDetached).map(
    (d) => d.id,
  ),
);

function menuOrder(e: NodeMenuEntry): number {
  return e.order ?? 999;
}

/** Palette “blocks” section — one entry per definition with `palette` set. */
export function paletteBlockEntries(): Array<NodeMenuEntry & { type: NodeType }> {
  const out: Array<NodeMenuEntry & { type: NodeType }> = [];
  for (const d of BUILTIN_NODE_DEFINITIONS) {
    if (!d.palette) continue;
    out.push({ ...d.palette, type: d.id, label: d.palette.label || d.label, glyph: d.palette.glyph || d.glyph });
  }
  return out.sort((a, b) => menuOrder(a) - menuOrder(b));
}

export interface WireMenuBlock {
  type: NodeType;
  label: string;
  glyph: string;
  hint: string;
  order: number;
  contextKind?: NodeMenuEntry["contextKind"];
}

/** Wire-drop / empty-canvas add menu built-ins (including context flavors). */
export function wireMenuBlocks(): WireMenuBlock[] {
  const out: WireMenuBlock[] = [];
  for (const d of BUILTIN_NODE_DEFINITIONS) {
    if (!d.wireMenu) continue;
    const entries = Array.isArray(d.wireMenu) ? d.wireMenu : [d.wireMenu];
    for (const e of entries) {
      out.push({
        type: d.id,
        label: e.label || d.label,
        glyph: e.glyph || d.glyph,
        hint: e.hint,
        order: e.order ?? 999,
        contextKind: e.contextKind,
      });
    }
  }
  return out.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/** Whether ▶ Run should count this node (session special-cased by caller). */
export function definitionExecutesOnRun(id: NodeType): boolean | "session-if-wired" {
  return byId.get(id)?.executesOnRun ?? false;
}

export function wireColorForType(id: NodeType): string {
  return byId.get(id)?.wireColor ?? "var(--accent)";
}
