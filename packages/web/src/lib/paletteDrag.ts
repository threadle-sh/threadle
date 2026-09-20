import type { AgentDef, ContextKind, NodeType, SessionRef } from "@threadle/shared";

/** MIME type for canvas drop payloads — do not change. */
export const THREADLE_DRAG_MIME = "application/threadle";

export interface PaletteSkillDragRow {
  path: string;
  name: string;
  source: string;
  description?: string;
  origin?: string;
  autoInvoke?: boolean;
  shadowedBy?: string;
}

export interface PaletteLibraryDragItem {
  hash: string;
  kind: ContextKind;
  preview: string;
  tags?: string[];
}

export function setDrag(e: DragEvent, payload: unknown): void {
  e.dataTransfer?.setData(THREADLE_DRAG_MIME, JSON.stringify(payload));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
}

export function dragSession(e: DragEvent, s: SessionRef): void {
  setDrag(e, {
    kind: "session",
    provider: s.provider,
    sessionId: s.id,
    nodeType: s.kind === "subagent-run" ? "subagent-run" : "session",
    snapshot: { title: s.title, agent: s.agent, projectDir: s.projectDir },
  });
}

export function dragAgent(e: DragEvent, a: AgentDef): void {
  setDrag(e, {
    kind: "agent-def",
    provider: a.provider,
    name: a.name,
    source: a.source,
  });
}

export function dragContext(e: DragEvent, kind: ContextKind): void {
  setDrag(e, { kind: "context", contextKind: kind });
}

export function dragBlock(e: DragEvent, kind: NodeType): void {
  setDrag(e, { kind });
}

export function dragSkill(e: DragEvent, a: PaletteSkillDragRow): void {
  setDrag(e, {
    kind: "skill",
    path: a.path,
    name: a.name,
    source: a.source,
    description: a.description,
    origin: a.origin as "project" | "custom" | "imported" | "global" | undefined,
    autoInvoke: a.autoInvoke,
    shadowedBy: a.shadowedBy,
  });
}

export function dragRules(e: DragEvent, a: PaletteSkillDragRow): void {
  setDrag(e, {
    kind: "rules",
    path: a.path,
    name: a.name,
    source: a.source,
  });
}

export function dragCustom(e: DragEvent, name: string): void {
  setDrag(e, { kind: "custom", name });
}

export function dragLibrary(e: DragEvent, pl: PaletteLibraryDragItem): void {
  setDrag(e, {
    kind: "context",
    contextKind: pl.kind,
    payloadHash: pl.hash,
    label: pl.preview.slice(0, 60),
  });
}

export function dragSubgraph(
  e: DragEvent,
  g: { id: string; name: string },
): void {
  setDrag(e, { kind: "subgraph", graphId: g.id, name: g.name });
}
