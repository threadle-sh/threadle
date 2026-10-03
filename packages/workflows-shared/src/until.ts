/** Until — counted re-entry of a subgraph (not a free DAG cycle). */

export const UNTIL_MAX_ITERATIONS_DEFAULT = 3;
export const UNTIL_MAX_ITERATIONS_HARD_CAP = 8;

export const UNTIL_PORTS = ["reenter", "exhausted"] as const;
export type UntilPort = (typeof UNTIL_PORTS)[number];

export function clampUntilMaxIterations(raw: number | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return UNTIL_MAX_ITERATIONS_DEFAULT;
  return Math.min(n, UNTIL_MAX_ITERATIONS_HARD_CAP);
}

export function isUntilReenterHandle(handle?: string | null): boolean {
  return handle === "out:reenter" || handle === "reenter";
}

/** Topo / reachability ignore reenter edges so the graph stays a DAG. */
export function isReenterEdge(e: {
  sourceHandle?: string | null;
  data?: { role?: string } | null;
}): boolean {
  if (e.data?.role === "reenter") return true;
  return isUntilReenterHandle(e.sourceHandle);
}

export function untilPortsOutput(
  winner: UntilPort,
  text: string,
): Record<UntilPort, string> {
  return {
    reenter: winner === "reenter" ? text : "",
    exhausted: winner === "exhausted" ? text : "",
  };
}

/** Edges that participate in topo / predecessor scheduling (exclude reenter back-edges). */
export function structuralEdges<T extends { sourceHandle?: string | null; data?: { role?: string } | null }>(
  edges: readonly T[],
): T[] {
  return edges.filter((e) => !isReenterEdge(e));
}

/**
 * Nodes to reset for an Until re-entry: reenter targets plus every node
 * reachable from them via structural edges, including the Until itself.
 */
export function untilLoopBody(
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null; data?: { role?: string } | null }>,
  untilId: string,
): { targets: string[]; body: string[] } {
  const targets = edges
    .filter((e) => e.source === untilId && isUntilReenterHandle(e.sourceHandle))
    .map((e) => e.target);
  const struct = structuralEdges(edges);
  const body = new Set<string>(targets);
  const queue = [...targets];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of struct) {
      if (e.source !== id) continue;
      if (body.has(e.target)) continue;
      body.add(e.target);
      queue.push(e.target);
    }
  }
  body.add(untilId);
  return { targets, body: [...body] };
}

export type UntilAdvance =
  | { kind: "exhausted"; winner: "exhausted" }
  | { kind: "exhausted-no-wire"; winner: "exhausted" }
  | { kind: "reenter"; winner: "reenter"; nextIter: number };

/**
 * Pure until step: given current iteration count (0-based completed reenters)
 * and whether reenter targets exist, decide the next arm.
 */
export function advanceUntil(opts: {
  maxIterations: number;
  /** How many times this Until has already taken the reenter arm. */
  iterCount: number;
  hasReenterTargets: boolean;
}): UntilAdvance {
  const max = clampUntilMaxIterations(opts.maxIterations);
  if (opts.iterCount < max) {
    if (!opts.hasReenterTargets) {
      return { kind: "exhausted-no-wire", winner: "exhausted" };
    }
    return { kind: "reenter", winner: "reenter", nextIter: opts.iterCount + 1 };
  }
  return { kind: "exhausted", winner: "exhausted" };
}
