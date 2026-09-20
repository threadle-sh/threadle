/**
 * Layered left→right graph packing for canvas cleanup.
 *
 * Near → far:
 * 1. As-late-as-possible layers — side inputs sit beside their consumers
 *    (a mid-chain Prompt does not jump to column 0).
 * 2. Barycenter sweeps order each column by neighbor affinity.
 * 3. Place left→right; each node’s Y targets already-placed attachments
 *    (predecessors, successors, and sibling feeders of the same consumer).
 * 4. Polish right→left so side inputs hug consumers once those exist.
 */

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface PackOptions {
  gapX?: number;
  gapY?: number;
  originX?: number;
  originY?: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Weakly-connected ALAP layer index (0 = leftmost in that component). */
export function alapLayerRanks(
  ids: Iterable<string>,
  preds: Map<string, Iterable<string>>,
  succs: Map<string, Iterable<string>>,
): Map<string, number> {
  const idList = [...ids];
  const idSet = new Set(idList);
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let x = a;
    while (x !== r) {
      const p = parent.get(x)!;
      parent.set(x, r);
      x = p;
    }
    return r;
  };
  const unite = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const id of idList) parent.set(id, id);
  for (const id of idList) {
    for (const p of preds.get(id) ?? []) if (idSet.has(p)) unite(id, p);
    for (const s of succs.get(id) ?? []) if (idSet.has(s)) unite(id, s);
  }

  const distToSink = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    if (distToSink.has(id)) return distToSink.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const ss = [...(succs.get(id) ?? [])].filter((s) => idSet.has(s));
    const d = ss.length ? 1 + Math.max(...ss.map((s) => visit(s, stack))) : 0;
    stack.delete(id);
    distToSink.set(id, d);
    return d;
  };
  for (const id of idList) visit(id, new Set());

  const maxByComp = new Map<string, number>();
  for (const id of idList) {
    const c = find(id);
    maxByComp.set(c, Math.max(maxByComp.get(c) ?? 0, distToSink.get(id) ?? 0));
  }

  const rank = new Map<string, number>();
  for (const id of idList) {
    const c = find(id);
    rank.set(id, (maxByComp.get(c) ?? 0) - (distToSink.get(id) ?? 0));
  }
  return rank;
}

function buildAdj(
  ids: string[],
  edges: LayoutEdge[],
): {
  preds: Map<string, string[]>;
  succs: Map<string, string[]>;
} {
  const idSet = new Set(ids);
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target) || e.source === e.target) continue;
    preds.get(e.target)!.push(e.source);
    succs.get(e.source)!.push(e.target);
  }
  return { preds, succs };
}

/**
 * Ideal vertical center for `id` given already-placed neighbor centers.
 * Includes sibling feeders of the same consumer, and those siblings’ placed
 * predecessors when the sibling itself is not placed yet (same column).
 */
export function idealCenterY(
  id: string,
  placedCenters: Map<string, number>,
  preds: Map<string, Iterable<string>>,
  succs: Map<string, Iterable<string>>,
  fallbackY: number,
): number {
  const samples: number[] = [];
  for (const p of preds.get(id) ?? []) {
    const y = placedCenters.get(p);
    if (y !== undefined) samples.push(y);
  }
  for (const s of succs.get(id) ?? []) {
    const sy = placedCenters.get(s);
    if (sy !== undefined) {
      samples.push(sy);
      continue;
    }
    for (const sib of preds.get(s) ?? []) {
      if (sib === id) continue;
      const y = placedCenters.get(sib);
      if (y !== undefined) {
        samples.push(y);
        continue;
      }
      for (const sp of preds.get(sib) ?? []) {
        const py = placedCenters.get(sp);
        if (py !== undefined) samples.push(py);
      }
    }
  }
  return samples.length ? median(samples) : fallbackY;
}

/** Pack a column so tops respect order and stay near each node’s ideal center. */
export function packColumnNearIdeals(
  items: Array<{ id: string; h: number; idealCenterY: number }>,
  gapY: number,
): Map<string, number> {
  const ordered = [...items].sort(
    (a, b) => a.idealCenterY - b.idealCenterY || a.id.localeCompare(b.id),
  );
  const tops: number[] = [];
  let prevBottom = -Infinity;
  for (let i = 0; i < ordered.length; i++) {
    const it = ordered[i]!;
    const want = it.idealCenterY - it.h / 2;
    const top = i === 0 ? want : Math.max(want, prevBottom + gapY);
    tops.push(top);
    prevBottom = top + it.h;
  }
  if (ordered.length) {
    const errors = ordered.map((it, i) => it.idealCenterY - (tops[i]! + it.h / 2));
    const shift = median(errors);
    for (let i = 0; i < tops.length; i++) tops[i]! += shift;
  }
  const out = new Map<string, number>();
  ordered.forEach((it, i) => out.set(it.id, tops[i]!));
  return out;
}

function placeColumns(
  cols: number[],
  byCol: Map<number, string[]>,
  byId: Map<string, LayoutNode>,
  colX: Map<number, number>,
  preds: Map<string, string[]>,
  succs: Map<string, string[]>,
  gapY: number,
  originY: number,
  placedCenter: Map<string, number>,
  positions: Map<string, { x: number; y: number }>,
): void {
  for (const col of cols) {
    const list = byCol.get(col)!;
    for (const id of list) placedCenter.delete(id);
    const items = list.map((id) => {
      const n = byId.get(id)!;
      return {
        id,
        h: n.h,
        idealCenterY: idealCenterY(id, placedCenter, preds, succs, originY),
      };
    });
    const packed = packColumnNearIdeals(items, gapY);
    const bx = colX.get(col) ?? 0;
    for (const id of list) {
      const n = byId.get(id)!;
      const y = packed.get(id)!;
      positions.set(id, { x: bx, y });
      placedCenter.set(id, y + n.h / 2);
    }
  }
}

/**
 * Compute non-overlapping positions for a directed flow graph.
 * Returns top-left coordinates for each node id.
 */
export function packLayeredFlow(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: PackOptions = {},
): Map<string, { x: number; y: number }> {
  const gapX = opts.gapX ?? 120;
  const gapY = opts.gapY ?? 72;
  const originX = opts.originX ?? 80;
  const originY = opts.originY ?? 220;

  if (!nodes.length) return new Map();

  const ids = nodes.map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { preds, succs } = buildAdj(ids, edges);
  const rank = alapLayerRanks(ids, preds, succs);

  const byCol = new Map<number, string[]>();
  for (const id of ids) {
    const c = rank.get(id) ?? 0;
    const list = byCol.get(c) ?? [];
    list.push(id);
    byCol.set(c, list);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);

  const orderOf = new Map<string, number>();
  const reindex = (): void => {
    let ord = 0;
    for (const col of cols) {
      for (const id of byCol.get(col)!) orderOf.set(id, ord++);
    }
  };
  reindex();

  const baryOf = (id: string, neighbors: Iterable<string>): number => {
    const xs: number[] = [];
    for (const n of neighbors) {
      const o = orderOf.get(n);
      if (o !== undefined) xs.push(o);
    }
    return xs.length ? avg(xs) : (orderOf.get(id) ?? 0);
  };

  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const seq = forward ? cols : [...cols].reverse();
    for (const col of seq) {
      const list = byCol.get(col)!;
      list.sort((a, b) => {
        const na = forward ? preds.get(a)! : succs.get(a)!;
        const nb = forward ? preds.get(b)! : succs.get(b)!;
        const attached = (ns: string[]) => ns.some((n) => orderOf.has(n));
        const ca = attached(na) ? 0 : 1;
        const cb = attached(nb) ? 0 : 1;
        return ca - cb || baryOf(a, na) - baryOf(b, nb) || a.localeCompare(b);
      });
      byCol.set(col, list);
    }
    reindex();
  }

  const colWidths = new Map<number, number>();
  for (const col of cols) {
    const list = byCol.get(col)!;
    colWidths.set(col, Math.max(...list.map((id) => byId.get(id)!.w), 200));
  }
  const colX = new Map<number, number>();
  let xCursor = originX;
  for (const col of cols) {
    colX.set(col, xCursor);
    xCursor += (colWidths.get(col) ?? 200) + gapX;
  }

  const placedCenter = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();

  // Near → far (sources / spine first)
  placeColumns(cols, byCol, byId, colX, preds, succs, gapY, originY, placedCenter, positions);
  // Far → near polish (pull side inputs onto consumers)
  placeColumns([...cols].reverse(), byCol, byId, colX, preds, succs, gapY, originY, placedCenter, positions);

  return positions;
}
