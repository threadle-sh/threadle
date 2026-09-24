import path from "node:path";
import { Hono } from "hono";
import {
  projectCreateSchema,
  projectPatchSchema,
  type ProviderId,
  type ThreadleProject,
} from "@threadle/shared";
import { listGraphs } from "../graphs/store.js";
import { normalizeProjectDir, sameProjectDir } from "../paths.js";
import { registry } from "../providers/registry.js";
import {
  isKnownProjectDir,
  listKnownProjectDirs,
} from "../readable-paths.js";
import {
  claimedDirs,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  ProjectStoreError,
  readProjects,
  updateProject,
} from "../projects/store.js";

export const projectRoutes = new Hono();

export type WorkspaceDirSummary = {
  dir: string;
  basename: string;
  providers: ProviderId[];
  sessionCount: number;
  liveCount: number;
  lastActivity: number;
};

export type ProjectWorkflowSummary = {
  id: string;
  name: string;
  missing?: boolean;
};

export type ProjectRollup = ThreadleProject & {
  basename: string;
  providers: ProviderId[];
  sessionCount: number;
  liveCount: number;
  lastActivity: number;
  workflows: ProjectWorkflowSummary[];
  members: WorkspaceDirSummary[];
};

async function collectSessionStats(): Promise<Map<string, WorkspaceDirSummary>> {
  const byDir = new Map<string, WorkspaceDirSummary>();

  const touch = (
    dir: string,
    provider: ProviderId,
    updatedAt: number,
    live: boolean,
  ): void => {
    const key = normalizeProjectDir(dir);
    if (!key) return;
    let row = byDir.get(key);
    if (!row) {
      row = {
        dir: key,
        basename: path.basename(key) || key,
        providers: [],
        sessionCount: 0,
        liveCount: 0,
        lastActivity: 0,
      };
      byDir.set(key, row);
    }
    row.sessionCount += 1;
    if (live) row.liveCount += 1;
    if (updatedAt > row.lastActivity) row.lastActivity = updatedAt;
    if (!row.providers.includes(provider)) row.providers.push(provider);
  };

  for (const p of registry.providers.values()) {
    try {
      if (!(await p.available())) continue;
      const sessions = await p.listSessions();
      for (const s of sessions) {
        if (!s.projectDir) continue;
        touch(
          s.projectDir,
          s.provider as ProviderId,
          s.updatedAt ?? 0,
          s.status === "running" || s.status === "waiting",
        );
      }
    } catch {
      /* skip provider */
    }
  }
  return byDir;
}

function emptyMember(dir: string): WorkspaceDirSummary {
  const key = normalizeProjectDir(dir);
  return {
    dir: key,
    basename: path.basename(key) || key,
    providers: [],
    sessionCount: 0,
    liveCount: 0,
    lastActivity: 0,
  };
}

async function enrichProject(
  project: ThreadleProject,
  stats: Map<string, WorkspaceDirSummary>,
  graphNames: Map<string, string>,
): Promise<ProjectRollup> {
  const members = project.dirs.map((d) => {
    const key = normalizeProjectDir(d);
    return stats.get(key) ?? emptyMember(key);
  });
  const providers = new Set<ProviderId>();
  let sessionCount = 0;
  let liveCount = 0;
  let lastActivity = project.updatedAt;
  for (const m of members) {
    sessionCount += m.sessionCount;
    liveCount += m.liveCount;
    if (m.lastActivity > lastActivity) lastActivity = m.lastActivity;
    for (const p of m.providers) providers.add(p);
  }
  const workflows: ProjectWorkflowSummary[] = project.workflowIds.map((id) => {
    const name = graphNames.get(id);
    return name ? { id, name } : { id, name: id, missing: true };
  });
  return {
    ...project,
    basename: project.name,
    providers: [...providers],
    sessionCount,
    liveCount,
    lastActivity,
    workflows,
    members,
  };
}

async function graphNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const g of await listGraphs()) map.set(g.id, g.name);
  } catch {
    /* ignore */
  }
  return map;
}

async function assertDirsKnown(dirs: string[]): Promise<string | null> {
  for (const d of dirs) {
    if (!(await isKnownProjectDir(d))) {
      return `projectDir is not a known project directory: ${d}`;
    }
  }
  return null;
}

projectRoutes.get("/", async (c) => {
  const [projects, stats, graphs, known] = await Promise.all([
    listProjects(),
    collectSessionStats(),
    graphNameMap(),
    listKnownProjectDirs(),
  ]);
  const claimed = claimedDirs(await readProjects());
  const enriched = await Promise.all(
    projects.map((p) => enrichProject(p, stats, graphs)),
  );
  const unassigned: WorkspaceDirSummary[] = [];
  for (const dir of known) {
    const key = normalizeProjectDir(dir);
    if (claimed.has(key)) continue;
    unassigned.push(stats.get(key) ?? emptyMember(key));
  }
  unassigned.sort((a, b) => b.lastActivity - a.lastActivity || a.dir.localeCompare(b.dir));
  return c.json({ projects: enriched, unassigned });
});

projectRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await getProject(id);
  if (!project) return c.json({ error: "project not found" }, 404);
  const [stats, graphs] = await Promise.all([collectSessionStats(), graphNameMap()]);
  return c.json(await enrichProject(project, stats, graphs));
});

projectRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = projectCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid project" }, 400);
  const dirs = parsed.data.dirs ?? [];
  const bad = await assertDirsKnown(dirs);
  if (bad) return c.json({ error: bad }, 403);
  try {
    const project = await createProject(parsed.data);
    const [stats, graphs] = await Promise.all([
      collectSessionStats(),
      graphNameMap(),
    ]);
    return c.json(await enrichProject(project, stats, graphs), 201);
  } catch (e) {
    if (e instanceof ProjectStoreError) {
      return c.json({ error: e.message }, e.status);
    }
    throw e;
  }
});

projectRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = projectPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid patch" }, 400);
  if (parsed.data.dirs) {
    const bad = await assertDirsKnown(parsed.data.dirs);
    if (bad) return c.json({ error: bad }, 403);
  }
  try {
    const project = await updateProject(id, parsed.data);
    const [stats, graphs] = await Promise.all([
      collectSessionStats(),
      graphNameMap(),
    ]);
    return c.json(await enrichProject(project, stats, graphs));
  } catch (e) {
    if (e instanceof ProjectStoreError) {
      return c.json({ error: e.message }, e.status);
    }
    throw e;
  }
});

projectRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await deleteProject(id);
  if (!ok) return c.json({ error: "project not found" }, 404);
  return c.json({ ok: true });
});

/** Helper for tests / callers that need dir membership checks. */
export function projectOwnsDir(project: ThreadleProject, dir: string): boolean {
  return project.dirs.some((d) => sameProjectDir(d, dir));
}
