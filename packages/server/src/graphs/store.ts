import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  GRAPH_ID_RE,
  graphKind,
  graphSchema,
  type Graph,
  type GraphNode,
  type GraphSummary,
  type PortableGraph,
} from "@threadle/shared";

/**
 * Chokepoint for every path built from a graph id. Hono DECODES `%2F` in
 * path params, so `/api/graphs/..%2F..%2Fx` arrives here as `../../x` — an
 * unvalidated id is an arbitrary `.json` read/write/delete primitive.
 */
function isSafeGraphId(id: string): boolean {
  return GRAPH_ID_RE.test(id);
}
import { resolveKnownArtifact } from "../routes/rules.js";
import { threadleConfigDir } from "../paths.js";
import { getWorkflowTemplate } from "../templates/workflows.js";

export { threadleConfigDir, threadleSkillsDir } from "../paths.js";

/** Stable id for the seeded starter graph (recreated if missing). */
export const STARTER_GRAPH_ID = "starter";
export const STARTER_GRAPH_NAME = "Starter workflow";

function graphsDir(): string {
  return path.join(threadleConfigDir(), "graphs");
}

/**
 * Empty graphs stay here until they gain nodes — never written to disk.
 * Cleared on process restart (orphaned tabs 404, which is fine).
 */
const ephemeral = new Map<string, Graph>();

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

function isEmptyGraph(g: Pick<Graph, "nodes">): boolean {
  return g.nodes.length === 0;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, file);
}

/** Count linked-frame references: parent graph id → set of subgraph ids it embeds. */
async function collectLinkCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await ensureDir(graphsDir());
  let files: string[];
  try {
    files = await fs.promises.readdir(graphsDir());
  } catch {
    return counts;
  }
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(graphsDir(), name), "utf8");
      const parsed = JSON.parse(raw) as { nodes?: Array<{ data?: { type?: string; graphId?: string } }> };
      for (const n of parsed.nodes ?? []) {
        if (n.data?.type === "group" && n.data.graphId) {
          counts.set(n.data.graphId, (counts.get(n.data.graphId) ?? 0) + 1);
        }
      }
    } catch {
      // skip corrupt
    }
  }
  return counts;
}

export async function listGraphs(): Promise<GraphSummary[]> {
  await ensureStarterWorkflow();
  await ensureDir(graphsDir());
  // Abandoned empty drafts ("New workflow" clicked, never given a node) have
  // no file — the on-disk sweep below never sees them, so age them out of
  // the in-memory map here or they live for the process lifetime.
  const now = Date.now();
  for (const [id, g] of ephemeral) {
    if (isEmptyGraph(g) && now - g.createdAt > 24 * 3_600_000) ephemeral.delete(id);
  }
  const usedBy = await collectLinkCounts();
  const files = await fs.promises.readdir(graphsDir());
  const out: GraphSummary[] = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const id = name.slice(0, -".json".length);
      const g = await readGraph(id);
      if (!g) continue;
      // Drop empty files left over from older builds — never list empties.
      if (isEmptyGraph(g)) {
        await deleteGraph(g.id);
        continue;
      }
      out.push({
        id: g.id,
        name: g.name,
        kind: graphKind(g),
        nodeCount: g.nodes.length,
        edgeCount: g.edges.length,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        usedBy: usedBy.get(g.id) ?? 0,
        unconfirmedImport: g.origin === "imported" && !g.confirmedAt ? true : undefined,
      });
    } catch {
      // corrupt graph file — skip from listing, never delete
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Ensure the built-in starter workflow exists as a normal saved graph.
 * Uses a stable id so it isn't duplicated on every boot.
 */
export async function ensureStarterWorkflow(): Promise<Graph> {
  const existing = await readGraph(STARTER_GRAPH_ID);
  if (existing) return existing;

  const tpl = getWorkflowTemplate("plan-implement-review");
  const now = Date.now();
  const base = tpl?.graph;
  const nodes = base
    ? await resolvePortableNodes(
        base.nodes.map((n) => ({
          ...n,
          status: "idle" as const,
          lastRunId: undefined,
        })) as GraphNode[],
      )
    : [];
  const graph: Graph = {
    id: STARTER_GRAPH_ID,
    name: STARTER_GRAPH_NAME,
    schemaVersion: 1,
    kind: "workflow",
    nodes,
    edges: (base?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      data: e.data,
    })),
    params: base?.params?.map((p) => ({ ...p })),
    viewport: base?.viewport,
    createdAt: now,
    updatedAt: now,
  };
  return saveGraph(graph);
}

export async function readGraph(id: string): Promise<Graph | undefined> {
  if (!isSafeGraphId(id)) return undefined;
  const file = path.join(graphsDir(), `${id}.json`);
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch {
    return ephemeral.get(id);
  }
  const parsed = graphSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const err = new Error(
      `graph ${id} failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    ) as Error & { status: number };
    err.status = 422;
    throw err;
  }
  return parsed.data as Graph;
}

export async function createGraph(
  name: string,
  opts?: { kind?: "workflow" | "subgraph" },
): Promise<Graph> {
  const now = Date.now();
  const graph: Graph = {
    id: crypto.randomUUID().slice(0, 8),
    name: name || "Untitled graph",
    schemaVersion: 1,
    kind: opts?.kind ?? "workflow",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  // Empty — keep in memory only until the first non-empty save.
  ephemeral.set(graph.id, graph);
  return graph;
}

export async function saveGraph(graph: Graph): Promise<Graph> {
  await ensureDir(graphsDir());
  const parsed = graphSchema.safeParse({
    ...graph,
    kind: graph.kind ?? "workflow",
    updatedAt: Date.now(),
  });
  if (!parsed.success) {
    const err = new Error(
      `invalid graph: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
    ) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  const g = parsed.data as Graph;
  const file = path.join(graphsDir(), `${g.id}.json`);
  if (isEmptyGraph(g)) {
    // Never persist empties: drop any prior file, keep session-local for GET.
    await fs.promises.rm(file, { force: true });
    ephemeral.set(g.id, g);
    return g;
  }
  ephemeral.delete(g.id);
  await snapshotGraphVersion(g.id, file);
  await atomicWrite(file, JSON.stringify(g, null, 2));
  return g;
}

const GRAPH_VERSION_CAP = 30;

function versionsDir(id: string): string {
  if (!isSafeGraphId(id)) throw new Error(`invalid graph id: ${id}`);
  return path.join(graphsDir(), "versions", id);
}

/** Sanitize ISO timestamp for filenames (colons are awkward on some FS). */
export function versionStamp(d = new Date()): string {
  return d.toISOString().replace(/:/g, "-");
}

/** Copy previous on-disk graph to versions/<id>/<iso>.json before overwrite. */
async function snapshotGraphVersion(id: string, currentFile: string): Promise<void> {
  let prev: string;
  try {
    prev = await fs.promises.readFile(currentFile, "utf8");
  } catch {
    return; // first save — nothing to snapshot
  }
  const dir = versionsDir(id);
  await ensureDir(dir);
  const stamp = versionStamp();
  await atomicWrite(path.join(dir, `${stamp}.json`), prev);
  await trimGraphVersions(id);
}

async function trimGraphVersions(id: string): Promise<void> {
  const dir = versionsDir(id);
  let names: string[];
  try {
    names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }
  names.sort(); // ISO-like stamps sort chronologically
  while (names.length > GRAPH_VERSION_CAP) {
    const oldest = names.shift();
    if (!oldest) break;
    await fs.promises.rm(path.join(dir, oldest), { force: true });
  }
}

export interface GraphVersionSummary {
  ts: string;
  updatedAt?: number;
  name?: string;
  nodeCount?: number;
}

export async function listGraphVersions(id: string): Promise<GraphVersionSummary[]> {
  const dir = versionsDir(id);
  let names: string[];
  try {
    names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  names.sort().reverse();
  const out: GraphVersionSummary[] = [];
  for (const name of names) {
    const ts = name.slice(0, -".json".length);
    let meta: GraphVersionSummary = { ts };
    try {
      const raw = JSON.parse(await fs.promises.readFile(path.join(dir, name), "utf8")) as {
        updatedAt?: number;
        name?: string;
        nodes?: unknown[];
      };
      meta = {
        ts,
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
        name: typeof raw.name === "string" ? raw.name : undefined,
        nodeCount: Array.isArray(raw.nodes) ? raw.nodes.length : undefined,
      };
    } catch {
      // keep ts-only
    }
    out.push(meta);
  }
  return out;
}

export async function readGraphVersion(id: string, ts: string): Promise<Graph | undefined> {
  if (!isSafeGraphId(id)) return undefined;
  const safe = ts.replace(/[^0-9A-Za-z.T_+-]/g, "");
  if (!safe || safe !== ts) return undefined;
  const file = path.join(versionsDir(id), `${safe}.json`);
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch {
    return undefined;
  }
  const parsed = graphSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return undefined;
  return parsed.data as Graph;
}

/** Replace current graph with a version snapshot (snapshots current first via saveGraph). */
export async function restoreGraphVersion(id: string, ts: string): Promise<Graph | undefined> {
  const snap = await readGraphVersion(id, ts);
  if (!snap) return undefined;
  return saveGraph({ ...snap, id });
}

/** Fill skill/rules absolute paths from name (+ origin/source) when missing. */
export async function resolvePortableNodes(nodes: GraphNode[]): Promise<GraphNode[]> {
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (n.data.type !== "skill" && n.data.type !== "rules") {
      out.push(n);
      continue;
    }
    const data = n.data;
    if (data.path) {
      out.push(n);
      continue;
    }
    if (!data.name) {
      out.push(n);
      continue;
    }
    try {
      const art = await resolveKnownArtifact({
        kind: data.type,
        name: data.name,
        origin: data.type === "skill" ? data.origin : undefined,
        source: data.source,
      });
      out.push({
        ...n,
        data: {
          ...data,
          path: art.path,
          source: art.source,
          ...(data.type === "skill"
            ? {
                origin: art.origin ?? data.origin,
                description: art.description ?? data.description,
                autoInvoke: art.autoInvoke ?? data.autoInvoke,
                shadowedBy: art.shadowedBy,
              }
            : {}),
        },
      });
    } catch {
      // Leave unresolved — executor / UI will surface a clear error.
      out.push(n);
    }
  }
  return out;
}

/** Create a new graph from portable (exported) JSON: fresh id, idle nodes. */
/**
 * Import a portable graph. Untrusted by default: the saved graph is stamped
 * `origin:"imported"` with no `confirmedAt`, and the executor refuses to run
 * it until the user confirms its execution manifest. Built-in callers
 * (templates, recipes, seeds) pass `trusted: true`.
 */
export async function importGraph(
  pg: PortableGraph,
  opts?: { trusted?: boolean },
): Promise<Graph> {
  const created = await createGraph(pg.name, {
    kind: pg.kind === "subgraph" ? "subgraph" : "workflow",
  });
  const nodes = await resolvePortableNodes(
    pg.nodes.map((n) => ({
      ...n,
      status: "idle" as const,
      lastRunId: undefined,
    })) as GraphNode[],
  );
  return saveGraph({
    ...created,
    kind: pg.kind === "subgraph" ? "subgraph" : "workflow",
    nodes,
    edges: pg.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      data: e.data,
    })),
    params: pg.params?.map((p) => ({ ...p })),
    settings: pg.settings ? { ...pg.settings } : undefined,
    viewport: pg.viewport,
    ...(opts?.trusted ? {} : { origin: "imported" as const }),
  } as Graph);
}

/** Overwrite an existing graph id from portable JSON (watch-mode reload). */
export async function replaceGraphFromPortable(
  id: string,
  pg: PortableGraph,
): Promise<Graph> {
  const existing = await readGraph(id);
  if (!existing) throw new Error(`graph not found: ${id}`);
  const nodes = await resolvePortableNodes(
    pg.nodes.map((n) => ({
      ...n,
      status: "idle" as const,
      lastRunId: undefined,
    })) as GraphNode[],
  );
  return saveGraph({
    ...existing,
    name: pg.name || existing.name,
    kind: pg.kind === "subgraph" ? "subgraph" : existing.kind ?? "workflow",
    nodes,
    edges: pg.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      data: e.data,
    })),
    params: pg.params?.map((p) => ({ ...p })),
    settings: pg.settings ? { ...pg.settings } : undefined,
    viewport: pg.viewport,
  } as Graph);
}

export async function deleteGraph(id: string): Promise<void> {
  if (!isSafeGraphId(id)) return;
  ephemeral.delete(id);
  await fs.promises.rm(path.join(graphsDir(), `${id}.json`), { force: true });
  const { unplaceGraph } = await import("./folders.js");
  await unplaceGraph(id).catch(() => undefined);
}
