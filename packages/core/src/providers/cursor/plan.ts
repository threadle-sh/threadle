import fs from "node:fs";
import path from "node:path";
import type { TouchedFile } from "@threadle/shared";
import { cursorHome } from "./paths.js";

/** `~/.cursor/plans/<Name>-<first8Uuid>.plan.md` */
export function plansDir(): string {
  return path.join(cursorHome(), "plans");
}

interface PlanHit {
  path: string;
  mtime: number;
  sessionId?: string;
  shortId: string;
}

let planIndexCache:
  | { at: number; byShort: Map<string, PlanHit[]>; byFull: Map<string, PlanHit[]> }
  | undefined;
const PLAN_INDEX_TTL_MS = 5_000;

/** Index all plan files once (short-id from filename + full UUID from HTML comment). */
export async function loadCursorPlanIndex(): Promise<{
  byShort: Map<string, PlanHit[]>;
  byFull: Map<string, PlanHit[]>;
}> {
  if (planIndexCache && Date.now() - planIndexCache.at < PLAN_INDEX_TTL_MS) {
    return planIndexCache;
  }
  const byShort = new Map<string, PlanHit[]>();
  const byFull = new Map<string, PlanHit[]>();
  const root = plansDir();
  let names: string[];
  try {
    names = await fs.promises.readdir(root);
  } catch {
    planIndexCache = { at: Date.now(), byShort, byFull };
    return { byShort, byFull };
  }

  const push = (map: Map<string, PlanHit[]>, key: string, hit: PlanHit) => {
    const list = map.get(key) ?? [];
    list.push(hit);
    map.set(key, list);
  };

  await Promise.all(
    names.map(async (name) => {
      if (!name.endsWith(".plan.md")) return;
      const full = path.join(root, name);
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(full);
      } catch {
        return;
      }
      const m = /-([0-9a-f]{8})\.plan\.md$/i.exec(name);
      const shortId = m?.[1]?.toLowerCase() ?? "";
      let sessionId: string | undefined;
      try {
        const fh = await fs.promises.open(full, "r");
        try {
          const buf = Buffer.alloc(120);
          const { bytesRead } = await fh.read(buf, 0, 120, 0);
          const head = buf.subarray(0, bytesRead).toString("utf8");
          const cm = /<!--\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*-->/i.exec(
            head,
          );
          if (cm?.[1]) sessionId = cm[1].toLowerCase();
        } finally {
          await fh.close();
        }
      } catch {
        /* ignore */
      }
      const hit: PlanHit = {
        path: full,
        mtime: st.mtimeMs,
        shortId,
        sessionId,
      };
      if (shortId) push(byShort, shortId, hit);
      if (sessionId) push(byFull, sessionId, hit);
    }),
  );

  const sortHits = (list: PlanHit[]) => list.sort((a, b) => b.mtime - a.mtime);
  for (const [, list] of byShort) sortHits(list);
  for (const [, list] of byFull) sortHits(list);

  planIndexCache = { at: Date.now(), byShort, byFull };
  return { byShort, byFull };
}

export function invalidateCursorPlanIndex(): void {
  planIndexCache = undefined;
}

export async function findCursorPlanFiles(sessionId: string): Promise<string[]> {
  const id = sessionId.toLowerCase();
  const short = id.slice(0, 8);
  const { byShort, byFull } = await loadCursorPlanIndex();
  const fromFull = byFull.get(id) ?? [];
  const fromShort = byShort.get(short) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of [...fromFull, ...fromShort].sort((a, b) => b.mtime - a.mtime)) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    out.push(hit.path);
  }
  return out;
}

export async function resolveCursorPlanPath(
  sessionId: string,
): Promise<string | undefined> {
  const files = await findCursorPlanFiles(sessionId);
  return files[0];
}

export async function mergeCursorPlanFiles(
  sessionId: string,
  files: TouchedFile[],
): Promise<TouchedFile[]> {
  const plans = await findCursorPlanFiles(sessionId);
  if (!plans.length) return files;
  const byPath = new Map(files.map((f) => [f.path, { ...f }]));
  for (const p of plans) {
    try {
      const st = await fs.promises.stat(p);
      const prev = byPath.get(p);
      byPath.set(p, {
        path: p,
        op: prev?.op ?? "write",
        lastSeenAt: Math.max(prev?.lastSeenAt ?? 0, st.mtimeMs) || st.mtimeMs,
        bytes: st.size,
        additions: prev?.additions,
        deletions: prev?.deletions,
      });
    } catch {
      /* missing */
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
