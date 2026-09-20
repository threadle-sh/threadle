import { Hono } from "hono";
import {
  validatePortableGraphImport,
  type Graph,
  type SessionNodeData,
} from "@threadle/shared";
import {
  createGraph,
  deleteGraph,
  importGraph,
  listGraphs,
  listGraphVersions,
  readGraph,
  readGraphVersion,
  restoreGraphVersion,
  saveGraph,
} from "../graphs/store.js";
import {
  createFolder,
  deleteFolder,
  ensureFolderPath,
  moveFolder,
  placeGraph,
  readFolderIndexLive,
  renameFolder,
} from "../graphs/folders.js";
import { registry } from "../providers/registry.js";

export const graphRoutes = new Hono();

graphRoutes.get("/", async (c) => c.json(await listGraphs()));

graphRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    kind?: "workflow" | "subgraph";
  };
  const kind = body.kind === "subgraph" ? "subgraph" : "workflow";
  return c.json(await createGraph(body.name ?? "", { kind }));
});

graphRoutes.post("/import", async (c) => {
  const body = await c.req.json().catch(() => undefined);
  const parsed = validatePortableGraphImport(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  return c.json(await importGraph(parsed.data), 201);
});

graphRoutes.get("/templates", async (c) => {
  const { WORKFLOW_TEMPLATES } = await import("../templates/workflows.js");
  return c.json(
    WORKFLOW_TEMPLATES.map(({ id, name, description, level, teaches }) => ({
      id,
      name,
      description,
      level,
      teaches,
    })),
  );
});

graphRoutes.post("/templates/:id", async (c) => {
  const id = c.req.param("id");
  if (id === "complex-delay-pipeline") {
    const { seedComplexDelayPipeline } = await import("../templates/complex-pipeline.js");
    return c.json(await seedComplexDelayPipeline(), 201);
  }
  const { getWorkflowTemplate } = await import("../templates/workflows.js");
  const tpl = getWorkflowTemplate(id);
  if (!tpl) return c.json({ error: "template not found" }, 404);
  return c.json(await importGraph({ ...tpl.graph, kind: "workflow" }, { trusted: true }), 201);
});

graphRoutes.get("/recipes", async (c) => {
  const { listRecipes } = await import("../templates/recipes.js");
  return c.json(
    listRecipes().map(({ id, name, outcome, needs, agents, params, note }) => ({
      id,
      name,
      outcome,
      needs,
      agents,
      params,
      note,
    })),
  );
});

graphRoutes.post("/recipes/:id", async (c) => {
  const { getRecipe } = await import("../templates/recipes.js");
  const recipe = getRecipe(c.req.param("id"));
  if (!recipe) return c.json({ error: "recipe not found" }, 404);
  return c.json(await importGraph({ ...recipe.graph, kind: "workflow" }, { trusted: true }), 201);
});

/* ---- optional workflow folders (metadata tree; graph files stay flat) ---- */

graphRoutes.get("/folders", async (c) => c.json(await readFolderIndexLive()));

graphRoutes.post("/folders", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    parentId?: string | null;
  };
  try {
    return c.json(
      await createFolder(body.name ?? "Untitled folder", body.parentId ?? null),
      201,
    );
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, status as 400);
  }
});

graphRoutes.put("/folders/place", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    folderId?: string | null;
  };
  if (typeof body.graphId !== "string" || !body.graphId) {
    return c.json({ error: "graphId required" }, 400);
  }
  try {
    return c.json(await placeGraph(body.graphId, body.folderId ?? null));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, status as 400);
  }
});

/** Find-or-create nested folders: { segments: ["foo","bar"] } → { index, folderId }. */
graphRoutes.post("/folders/ensure-path", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { segments?: unknown };
  const segments = Array.isArray(body.segments)
    ? body.segments.filter((s): s is string => typeof s === "string")
    : [];
  try {
    return c.json(await ensureFolderPath(segments));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, status as 400);
  }
});

graphRoutes.patch("/folders/:folderId", async (c) => {
  const folderId = c.req.param("folderId");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    parentId?: string | null;
  };
  try {
    if (typeof body.name === "string") {
      return c.json(await renameFolder(folderId, body.name));
    }
    if ("parentId" in body) {
      return c.json(await moveFolder(folderId, body.parentId ?? null));
    }
    return c.json({ error: "name or parentId required" }, 400);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, status as 400);
  }
});

graphRoutes.delete("/folders/:folderId", async (c) => {
  try {
    return c.json(await deleteFolder(c.req.param("folderId")));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return c.json({ error: err instanceof Error ? err.message : String(err) }, status as 400);
  }
});

/** Flip workflow ↔ subgraph without rewriting nodes. */
graphRoutes.patch("/:id/kind", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string };
  if (body.kind !== "workflow" && body.kind !== "subgraph") {
    return c.json({ error: 'kind must be "workflow" or "subgraph"' }, 400);
  }
  const g = await readGraph(c.req.param("id"));
  if (!g) return c.json({ error: "graph not found" }, 404);
  g.kind = body.kind;
  return c.json(await saveGraph(g));
});

graphRoutes.get("/:id/versions", async (c) => {
  const id = c.req.param("id");
  const g = await readGraph(id);
  if (!g) return c.json({ error: "graph not found" }, 404);
  return c.json(await listGraphVersions(id));
});

graphRoutes.get("/:id/versions/:ts", async (c) => {
  const snap = await readGraphVersion(c.req.param("id"), c.req.param("ts"));
  if (!snap) return c.json({ error: "version not found" }, 404);
  return c.json(snap);
});

graphRoutes.post("/:id/restore", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ts?: string };
  if (typeof body.ts !== "string" || !body.ts) {
    return c.json({ error: "ts required" }, 400);
  }
  const restored = await restoreGraphVersion(c.req.param("id"), body.ts);
  if (!restored) return c.json({ error: "version not found" }, 404);
  return c.json(await resolveRefs(restored));
});

/** Re-resolve session/subagent refs so the UI can mark stale nodes. */
async function resolveRefs(graph: Graph): Promise<Graph> {
  await Promise.all(
    graph.nodes.map(async (node) => {
      if (node.data.type !== "session" && node.data.type !== "subagent-run") return;
      const data = node.data as SessionNodeData;
      try {
        const p = registry.get(data.ref.provider);
        const ref = await p.getSession(data.ref.sessionId);
        data.resolved = Boolean(ref);
        if (ref) {
          data.snapshot = {
            title: ref.title,
            agent: ref.agent,
            projectDir: ref.projectDir,
          };
        }
      } catch {
        data.resolved = false;
      }
    }),
  );
  return graph;
}

graphRoutes.get("/:id", async (c) => {
  const graph = await readGraph(c.req.param("id"));
  if (!graph) return c.json({ error: "graph not found" }, 404);
  return c.json(await resolveRefs(graph));
});

/**
 * Explicit first-run confirmation for an imported graph. Deliberately its
 * own route (CSRF-guarded write) — the run body never carries a confirm
 * flag, so "run" can never silently imply "confirm".
 */
graphRoutes.post("/:id/confirm-import", async (c) => {
  const graph = await readGraph(c.req.param("id"));
  if (!graph) return c.json({ error: "graph not found" }, 404);
  if (graph.origin !== "imported" || graph.confirmedAt) {
    return c.json(graph); // nothing to confirm — idempotent
  }
  const saved = await saveGraph({ ...graph, confirmedAt: Date.now() });
  return c.json(saved);
});

graphRoutes.put("/:id", async (c) => {
  const body = (await c.req.json()) as Graph;
  if (body.id !== c.req.param("id")) {
    return c.json({ error: "graph id mismatch" }, 400);
  }
  return c.json(await saveGraph(body));
});

graphRoutes.delete("/:id", async (c) => {
  await deleteGraph(c.req.param("id"));
  return c.json({ ok: true });
});
