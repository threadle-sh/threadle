import type { GraphEdge, GraphNode, SessionRef } from "@threadle/shared";
import { api } from "@/api/client";

function sessionNode(ref: SessionRef, id: string, x: number, y: number): GraphNode {
  return {
    id,
    type: ref.kind === "subagent-run" ? "subagent-run" : "session",
    position: { x, y },
    status: "idle",
    data: {
      type: ref.kind === "subagent-run" ? "subagent-run" : "session",
      ref: { provider: ref.provider, sessionId: ref.id },
      snapshot: { title: ref.title, agent: ref.agent, projectDir: ref.projectDir },
      resolved: true,
    },
  };
}

/**
 * Seed an editable workflow from real sessions: each session becomes a node,
 * its subagent runs hang beneath it on child wires. Returns the new graph id.
 */
export async function sessionsToWorkflow(
  name: string,
  sessions: SessionRef[],
): Promise<string> {
  const graph = await api.createGraph(name.slice(0, 60));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const childLists = await Promise.all(
    sessions.map((s) =>
      s.kind === "session"
        ? api.children(s.provider, s.id).catch(() => [])
        : Promise.resolve([]),
    ),
  );

  let x = 80;
  sessions.forEach((s, i) => {
    const rootId = `n-s${i}`;
    nodes.push(sessionNode(s, rootId, x, 120));
    const children = childLists[i] ?? [];
    children.forEach((child, j) => {
      const childId = `n-s${i}-c${j}`;
      nodes.push(
        sessionNode(
          child,
          childId,
          x + 45 + (j - (children.length - 1) / 2) * 140,
          290,
        ),
      );
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
  await api.saveGraph(graph);
  return graph.id;
}

/** Seed a workflow with an agent + prompt pair, ready to wire and run. */
export async function agentToWorkflow(a: {
  provider: string;
  name: string;
  source: string;
  model?: string;
}): Promise<string> {
  const graph = await api.createGraph(`Run: ${a.name}`.slice(0, 60));
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
        ref: { provider: a.provider as never, name: a.name, source: a.source },
        model: a.model,
      },
    },
  ];
  graph.edges = [
    { id: "e-p", source: "n-prompt", target: "n-agent", data: { role: "instantiate" } },
  ];
  await api.saveGraph(graph);
  return graph.id;
}

/** Seed a workflow with one pre-materialized context node from a library payload. */
export async function payloadToWorkflow(payload: {
  hash: string;
  kind: string;
  preview: string;
}): Promise<string> {
  const graph = await api.createGraph(
    `Context: ${(payload.preview || payload.kind).slice(0, 48)}`,
  );
  graph.nodes = [
    {
      id: "n-ctx",
      type: "context",
      position: { x: 120, y: 160 },
      status: "idle",
      data: {
        type: "context",
        kind: payload.kind as never,
        config: { kind: payload.kind } as never,
        payloadHash: payload.hash,
        label: payload.preview.slice(0, 60),
      },
    },
  ];
  graph.edges = [];
  await api.saveGraph(graph);
  return graph.id;
}

/**
 * Snapshot a session's reconstructed context into the library (tag: `reference`)
 * and seed a new workflow with that context node ready to wire.
 */
export async function referenceContextToWorkflow(
  provider: string,
  sessionId: string,
): Promise<{ graphId: string; hash: string; tags: string[] }> {
  const res = await fetch("/api/context/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: { provider, sessionId } }),
  });
  const body = (await res.json()) as {
    error?: string;
    hash?: string;
    kind?: string;
    preview?: string;
    tags?: string[];
  };
  if (!res.ok || !body.hash || !body.kind) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const graphId = await payloadToWorkflow({
    hash: body.hash,
    kind: body.kind,
    preview: body.preview || "session context",
  });
  return { graphId, hash: body.hash, tags: body.tags ?? ["reference"] };
}

/** Save session context to the library with the `reference` tag (no new workflow). */
export async function referenceContextToLibrary(
  provider: string,
  sessionId: string,
): Promise<{ hash: string; tags: string[]; preview: string }> {
  const res = await fetch("/api/context/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: { provider, sessionId } }),
  });
  const body = (await res.json()) as {
    error?: string;
    hash?: string;
    preview?: string;
    tags?: string[];
  };
  if (!res.ok || !body.hash) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return {
    hash: body.hash,
    tags: body.tags ?? ["reference"],
    preview: body.preview || "session context",
  };
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}
