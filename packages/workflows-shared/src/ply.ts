/** Parallel wave helpers for the workflow runner (settings key remains `ply`). */

/** Build predecessor map from edges (target → source ids). */
export function predecessorMap(
  nodeIds: Iterable<string>,
  edges: Array<{ source: string; target: string }>,
): Map<string, string[]> {
  const ids = new Set(nodeIds);
  const map = new Map<string, string[]>();
  for (const id of ids) map.set(id, []);
  for (const e of edges) {
    if (!ids.has(e.target) || !ids.has(e.source)) continue;
    map.get(e.target)!.push(e.source);
  }
  return map;
}

/** Nodes whose every predecessor is in `completed`. */
export function plyReady(
  pending: Iterable<string>,
  preds: Map<string, string[]>,
  completed: Set<string>,
): string[] {
  const out: string[] = [];
  for (const id of pending) {
    const p = preds.get(id) ?? [];
    if (p.every((x) => completed.has(x))) out.push(id);
  }
  return out;
}

/** Run `items` with at most `concurrency` in flight (wave-internal pool). */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const q = [...items];
  const n = Math.max(1, Math.min(concurrency, q.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (q.length) {
        const item = q.shift()!;
        await fn(item);
      }
    }),
  );
}

export const DEFAULT_PLY = 4;
