import type { NodeType } from "./graph.js";
import { SKIP_EXEC_TYPES } from "./nodes/index.js";

/**
 * Node types the canvas / detached seeders can contribute without re-executing
 * (mirrors GraphEditor `seedOutput` + executor seed).
 */
export const SEEDABLE_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "prompt",
  "skill",
  "rules",
  "session",
  "subagent-run",
  "agent-def",
  "context",
  "output",
  "prompt-convert",
  "delay",
  "data",
  "approval",
  "knot",
  "tripwire",
  "judge",
  "until",
  "live-handoff",
  "wait-idle",
  "iterator",
]);

export type RunScopeClass = "re-run" | "reuse" | "missing";

export interface RunScopeClassification {
  /** In-scope — will execute. */
  reRun: string[];
  /** Out of scope but seedable (or skip-exec decoration). */
  reuse: string[];
  /** Out of scope and not seedable — prior cache may still fill at runtime. */
  missing: string[];
  counts: { reRun: number; reuse: number; missing: number };
}

export interface ClassifyRunScopeNode {
  id: string;
  data: { type: NodeType };
  muted?: boolean;
}

/**
 * Classify every graph node for a partial / scoped run preview.
 * Pure — no I/O; does not inspect prior job caches.
 */
export function classifyRunScope(
  nodes: readonly ClassifyRunScopeNode[],
  scope: ReadonlySet<string>,
): RunScopeClassification {
  const reRun: string[] = [];
  const reuse: string[] = [];
  const missing: string[] = [];
  for (const n of nodes) {
    if (scope.has(n.id)) {
      reRun.push(n.id);
      continue;
    }
    const t = n.data.type;
    if (SKIP_EXEC_TYPES.has(t) || SEEDABLE_NODE_TYPES.has(t) || n.muted) {
      reuse.push(n.id);
    } else {
      missing.push(n.id);
    }
  }
  return {
    reRun,
    reuse,
    missing,
    counts: { reRun: reRun.length, reuse: reuse.length, missing: missing.length },
  };
}

/** BFS: `nodeId` plus every downstream target reachable via `edges`. */
export function descendantsOf(
  nodeId: string,
  edges: readonly { source: string; target: string }[],
): Set<string> {
  const scope = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.source === cur && !scope.has(e.target)) {
        scope.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return scope;
}
