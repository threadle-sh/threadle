import type { GraphEdge, GraphNode } from "./graph.js";

function byPos(a: GraphNode, b: GraphNode): number {
  return a.position.y - b.position.y || a.position.x - b.position.x;
}

/** Members of a frame that no other member feeds — inbound frame wires land here. */
export function entryMembers(nodes: GraphNode[], edges: GraphEdge[], frameId: string): GraphNode[] {
  const members = nodes.filter(
    (n) => n.subOf === frameId && n.data.type !== "group" && n.data.type !== "note",
  );
  const ids = new Set(members.map((m) => m.id));
  const fed = new Set(
    edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => e.target),
  );
  return members.filter((m) => !fed.has(m.id)).sort(byPos);
}

/** Members that feed no other member — outbound frame wires originate here. */
export function exitMembers(nodes: GraphNode[], edges: GraphEdge[], frameId: string): GraphNode[] {
  const members = nodes.filter(
    (n) => n.subOf === frameId && n.data.type !== "group" && n.data.type !== "note",
  );
  const ids = new Set(members.map((m) => m.id));
  const feeding = new Set(
    edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => e.source),
  );
  return members.filter((m) => !feeding.has(m.id)).sort(byPos);
}

export function isLinkedFrameNode(n: GraphNode | undefined): boolean {
  return n?.data.type === "group" && !!n.data.graphId;
}

/**
 * Expand edges attached to linked frames onto entry/exit members.
 *
 * - node → frame: broadcast to every entry (subgraph roots)
 * - frame → node: fan-in from every exit
 * - frame → frame: zip by y-order (avoids cartesian N×M explosions)
 */
export function expandFrameEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: GraphEdge[] = [];
  for (const e of edges) {
    const sGroup = isLinkedFrameNode(byId.get(e.source));
    const tGroup = isLinkedFrameNode(byId.get(e.target));
    if (!sGroup && !tGroup) {
      out.push(e);
      continue;
    }
    const sources = sGroup
      ? exitMembers(nodes, edges, e.source).map((m) => m.id)
      : [e.source];
    const targets = tGroup
      ? entryMembers(nodes, edges, e.target).map((m) => m.id)
      : [e.target];
    if (!sources.length || !targets.length) continue; // dangling frame wire — skip
    if (sGroup && tGroup) {
      const n = Math.max(sources.length, targets.length);
      for (let i = 0; i < n; i++) {
        const source = sources[Math.min(i, sources.length - 1)]!;
        const target = targets[Math.min(i, targets.length - 1)]!;
        out.push({ ...e, id: `${e.id}:${source}:${target}`, source, target });
      }
    } else {
      for (const source of sources) {
        for (const target of targets) {
          out.push({ ...e, id: `${e.id}:${source}:${target}`, source, target });
        }
      }
    }
  }
  return out;
}

/** Pre-run warnings for linked frames with missing boundaries or empty members. */
export function frameBoundaryWarnings(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const warn: string[] = [];
  for (const n of nodes) {
    if (!isLinkedFrameNode(n) || n.muted || n.bypassed) continue;
    const members = nodes.filter(
      (m) => m.subOf === n.id && m.data.type !== "group" && m.data.type !== "note",
    );
    const label = n.data.type === "group" ? n.data.label || "sub-workflow" : "sub-workflow";
    if (!members.length) {
      warn.push(`sub-workflow "${label}" has no member nodes`);
      continue;
    }
    const entries = entryMembers(nodes, edges, n.id);
    const exits = exitMembers(nodes, edges, n.id);
    const inbound = edges.some((e) => e.target === n.id);
    const outbound = edges.some((e) => e.source === n.id);
    if (inbound && !entries.length) {
      warn.push(`sub-workflow "${label}" has inbound wires but no entry member`);
    }
    if (outbound && !exits.length) {
      warn.push(`sub-workflow "${label}" has outbound wires but no exit member`);
    }
  }
  return warn;
}
