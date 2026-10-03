import { z } from "zod";
import {
  formatZodIssue,
  parseImportJson,
  type ImportResult,
} from "@threadle/shared";
import { portableGraphSchema, type PortableGraph } from "./graph.js";

/**
 * Structural checks beyond zod shape: node.type ≡ data.type, unique ids,
 * edges reference existing nodes, unique param names.
 */
export function portableGraphStructureError(g: PortableGraph): string | null {
  const nodeIds = new Set<string>();
  for (const n of g.nodes) {
    if (nodeIds.has(n.id)) return `nodes: duplicate id "${n.id}"`;
    nodeIds.add(n.id);
    if (n.type !== n.data.type) {
      return `nodes.${n.id}: type "${n.type}" does not match data.type "${n.data.type}"`;
    }
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) return `edges: duplicate id "${e.id}"`;
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source)) {
      return `edges.${e.id}: source "${e.source}" is not a node in this graph`;
    }
    if (!nodeIds.has(e.target)) {
      return `edges.${e.id}: target "${e.target}" is not a node in this graph`;
    }
  }
  if (g.params?.length) {
    const names = new Set<string>();
    for (const p of g.params) {
      if (names.has(p.name)) return `params: duplicate name "${p.name}"`;
      names.add(p.name);
    }
  }
  return null;
}

/** Full portable workflow import gate (file drop, list import, API, CLI). */
export function validatePortableGraphImport(raw: unknown): ImportResult<PortableGraph> {
  const parsed = portableGraphSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `invalid graph JSON — ${formatZodIssue(parsed.error)}` };
  }
  const structural = portableGraphStructureError(parsed.data);
  if (structural) return { ok: false, error: `invalid graph JSON — ${structural}` };
  return { ok: true, data: parsed.data };
}

/** Parse + validate a workflow JSON file's text. */
export function validatePortableGraphJsonText(text: string): ImportResult<PortableGraph> {
  const json = parseImportJson(text);
  if (!json.ok) return json;
  return validatePortableGraphImport(json.data);
}

// ---- palette / canvas MIME drag (not a file, but still an import surface) ----

export const dragPayloadSchema = z.object({
  kind: z.enum([
    "session",
    "agent-def",
    "context",
    "prompt",
    "output",
    "prompt-convert",
    "delay",
    "data",
    "approval",
    "live-handoff",
    "wait-idle",
    "iterator",
    "knot",
    "tripwire",
    "judge",
    "until",
    "group",
    "note",
    "custom",
    "mcp-tool",
    "skill",
    "rules",
    "subgraph",
  ]),
  graphId: z.string().optional(),
  provider: z.string().optional(),
  sessionId: z.string().optional(),
  nodeType: z.enum(["session", "subagent-run"]).optional(),
  snapshot: z
    .object({
      title: z.string().optional(),
      agent: z.string().optional(),
      projectDir: z.string().optional(),
    })
    .optional(),
  name: z.string().optional(),
  source: z.string().optional(),
  contextKind: z.enum(["distilled-summary", "transcript-excerpt", "files"]).optional(),
  payloadHash: z.string().optional(),
  label: z.string().optional(),
  path: z.string().optional(),
  description: z.string().optional(),
  origin: z.enum(["project", "custom", "imported", "global"]).optional(),
  autoInvoke: z.boolean().optional(),
  shadowedBy: z.string().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
});
export type DragPayloadImport = z.infer<typeof dragPayloadSchema>;

export function validateDragPayload(raw: unknown): ImportResult<DragPayloadImport> {
  const parsed = dragPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `invalid drag payload — ${formatZodIssue(parsed.error)}` };
  }
  if (parsed.data.kind === "subgraph" && !parsed.data.graphId) {
    return { ok: false, error: "invalid drag payload — subgraph requires graphId" };
  }
  return { ok: true, data: parsed.data };
}

export function validateDragPayloadJsonText(text: string): ImportResult<DragPayloadImport> {
  const json = parseImportJson(text);
  if (!json.ok) return json;
  return validateDragPayload(json.data);
}
