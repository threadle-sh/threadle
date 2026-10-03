import type { ContextKind, ProviderId, SessionRef } from "@threadle/shared";
import type { Graph, GraphEdge, GraphNode } from "@threadle/workflows-shared";
import { registry } from "@threadle/core/providers/registry.js";
import { createGraph, saveGraph } from "../graphs/store.js";

/**
 * Seed a new workflow from viewer objects (sessions, an agent, a library
 * payload). The viewer posts plain refs to POST /api/graphs/seed and only gets
 * an id back — graph construction stays on the workflows side.
 */
export type SeedRequest =
  | {
      kind: "sessions";
      name: string;
      sessions: Array<Pick<SessionRef, "provider" | "id" | "kind" | "title" | "agent" | "projectDir">>;
    }
  | { kind: "agent"; provider: string; name: string; source: string; model?: string }
  | { kind: "payload"; hash: string; payloadKind: string; preview: string };

const CONTEXT_KINDS: ContextKind[] = ["distilled-summary", "transcript-excerpt", "files"];

type SessionSeed = Pick<SessionRef, "provider" | "id" | "kind" | "title" | "agent" | "projectDir">;

function sessionNode(ref: SessionSeed, id: string, x: number, y: number): GraphNode {
  const type = ref.kind === "subagent-run" ? "subagent-run" : "session";
  return {
    id,
    type,
    position: { x, y },
    status: "idle",
    data: {
      type,
      ref: { provider: ref.provider, sessionId: ref.id },
      snapshot: { title: ref.title, agent: ref.agent, projectDir: ref.projectDir },
      resolved: true,
    },
  };
}

/** Each session becomes a node; its subagent runs hang beneath it on child wires. */
async function seedSessions(graph: Graph, sessions: SessionSeed[]): Promise<void> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const childLists = await Promise.all(
    sessions.map((s) => {
      const p = registry.providers.get(s.provider as ProviderId);
      return s.kind === "session" && p ? p.listChildren(s.id).catch(() => []) : Promise.resolve([]);
    }),
  );
  let x = 80;
  sessions.forEach((s, i) => {
    const rootId = `n-s${i}`;
    nodes.push(sessionNode(s, rootId, x, 120));
    const children = childLists[i] ?? [];
    children.forEach((child, j) => {
      const childId = `n-s${i}-c${j}`;
      nodes.push(sessionNode(child, childId, x + 45 + (j - (children.length - 1) / 2) * 140, 290));
      edges.push({
        id: `e-s${i}-c${j}`,
        source: rootId,
        target: childId,
        sourceHandle: "sub",
        data: { role: "child" },
      });
    });
    // space columns by the wider of the session card or its child fan
    x += Math.max(280, children.length * 145 + 60);
  });
  graph.nodes = nodes;
  graph.edges = edges;
}

export async function seedWorkflow(req: SeedRequest): Promise<Graph> {
  if (req.kind === "sessions") {
    const graph = await createGraph(req.name.slice(0, 60));
    await seedSessions(graph, req.sessions.slice(0, 200));
    return saveGraph(graph);
  }
  if (req.kind === "agent") {
    const graph = await createGraph(`Run: ${req.name}`.slice(0, 60));
    graph.nodes = [
      {
        id: "n-prompt",
        type: "prompt",
        position: { x: 60, y: 150 },
        status: "idle",
        data: { type: "prompt", text: "" },
      },
      {
        id: "n-agent",
        type: "agent-def",
        position: { x: 420, y: 160 },
        status: "idle",
        data: {
          type: "agent-def",
          ref: { provider: req.provider as ProviderId, name: req.name, source: req.source },
          model: req.model,
        },
      },
    ];
    graph.edges = [{ id: "e-p", source: "n-prompt", target: "n-agent", data: { role: "instantiate" } }];
    return saveGraph(graph);
  }
  const graph = await createGraph(`Context: ${(req.preview || req.payloadKind).slice(0, 48)}`);
  graph.nodes = [
    {
      id: "n-ctx",
      type: "context",
      position: { x: 120, y: 160 },
      status: "idle",
      data: {
        type: "context",
        kind: req.payloadKind as never,
        config: { kind: req.payloadKind } as never,
        payloadHash: req.hash,
        label: req.preview.slice(0, 60),
      },
    },
  ];
  graph.edges = [];
  return saveGraph(graph);
}

/** Loose validation for the HTTP body — returns an error string or the request. */
export function parseSeedRequest(body: unknown): SeedRequest | string {
  if (!body || typeof body !== "object") return "body required";
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;
  if (b.kind === "sessions") {
    if (!str(b.name, 200) || !Array.isArray(b.sessions)) return "name and sessions required";
    for (const s of b.sessions as Array<Record<string, unknown>>) {
      if (!s || !str(s.provider, 40) || !str(s.id, 300)) return "invalid session ref";
      if (!registry.providers.has(s.provider as ProviderId)) return `unknown provider: ${s.provider}`;
    }
    return b as SeedRequest;
  }
  if (b.kind === "agent") {
    if (!str(b.provider, 40) || !str(b.name, 200) || !str(b.source, 2000)) return "provider, name, source required";
    return b as SeedRequest;
  }
  if (b.kind === "payload") {
    if (!str(b.hash, 128) || !str(b.payloadKind, 40) || typeof b.preview !== "string") {
      return "hash, payloadKind, preview required";
    }
    if (!CONTEXT_KINDS.includes(b.payloadKind as ContextKind)) return `unknown payload kind: ${b.payloadKind}`;
    return { ...(b as SeedRequest & { kind: "payload" }), preview: String(b.preview).slice(0, 500) };
  }
  return "unknown seed kind";
}
