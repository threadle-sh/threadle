import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  emptyProjectsIndex,
  projectsIndexSchema,
  type ProjectCreate,
  type ProjectPatch,
  type ProjectsIndex,
  type ThreadleProject,
} from "@threadle/shared";
import { normalizeProjectDir, threadleConfigDir } from "../paths.js";

function projectsFile(): string {
  return path.join(threadleConfigDir(), "projects.json");
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, file);
}

function newId(): string {
  return `proj_${crypto.randomBytes(6).toString("hex")}`;
}

function normDir(dir: string): string {
  return normalizeProjectDir(dir.trim());
}

function uniqDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const n = normDir(d);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export async function readProjects(): Promise<ProjectsIndex> {
  try {
    const raw = await fs.promises.readFile(projectsFile(), "utf8");
    const parsed = projectsIndexSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data as ProjectsIndex;
  } catch {
    /* missing or corrupt */
  }
  return emptyProjectsIndex();
}

async function writeProjects(index: ProjectsIndex): Promise<ProjectsIndex> {
  await fs.promises.mkdir(path.dirname(projectsFile()), { recursive: true });
  await atomicWrite(projectsFile(), JSON.stringify(index, null, 2));
  return index;
}

/** Dirs already claimed by any project (normalized). */
export function claimedDirs(index: ProjectsIndex, exceptId?: string): Set<string> {
  const out = new Set<string>();
  for (const p of index.projects) {
    if (exceptId && p.id === exceptId) continue;
    for (const d of p.dirs) out.add(normDir(d));
  }
  return out;
}

export class ProjectStoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "ProjectStoreError";
  }
}

function assertDirsFree(index: ProjectsIndex, dirs: string[], exceptId?: string): void {
  const taken = claimedDirs(index, exceptId);
  for (const d of dirs) {
    if (taken.has(d)) {
      throw new ProjectStoreError(`directory already in another project: ${d}`, 409);
    }
  }
}

export async function createProject(input: ProjectCreate): Promise<ThreadleProject> {
  const index = await readProjects();
  const dirs = uniqDirs(input.dirs ?? []);
  assertDirsFree(index, dirs);
  const now = Date.now();
  const project: ThreadleProject = {
    id: newId(),
    name: input.name.trim(),
    dirs,
    workflowIds: [...new Set(input.workflowIds ?? [])],
    pinned: input.pinned || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  index.projects.push(project);
  await writeProjects(index);
  return project;
}

export async function getProject(id: string): Promise<ThreadleProject | null> {
  const index = await readProjects();
  return index.projects.find((p) => p.id === id) ?? null;
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
): Promise<ThreadleProject> {
  const index = await readProjects();
  const i = index.projects.findIndex((p) => p.id === id);
  if (i < 0) throw new ProjectStoreError("project not found", 404);
  const cur = index.projects[i]!;
  const dirs =
    patch.dirs !== undefined ? uniqDirs(patch.dirs) : cur.dirs.map(normDir);
  if (patch.dirs !== undefined) assertDirsFree(index, dirs, id);
  const next: ThreadleProject = {
    ...cur,
    name: patch.name !== undefined ? patch.name.trim() : cur.name,
    dirs,
    workflowIds:
      patch.workflowIds !== undefined
        ? [...new Set(patch.workflowIds)]
        : cur.workflowIds,
    pinned: patch.pinned !== undefined ? patch.pinned || undefined : cur.pinned,
    notes:
      patch.notes !== undefined
        ? patch.notes.trim() || undefined
        : cur.notes,
    updatedAt: Date.now(),
  };
  if (!next.name) throw new ProjectStoreError("name required", 400);
  index.projects[i] = next;
  await writeProjects(index);
  return next;
}

export async function deleteProject(id: string): Promise<boolean> {
  const index = await readProjects();
  const before = index.projects.length;
  index.projects = index.projects.filter((p) => p.id !== id);
  if (index.projects.length === before) return false;
  await writeProjects(index);
  return true;
}

export async function listProjects(): Promise<ThreadleProject[]> {
  const index = await readProjects();
  return [...index.projects].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}
