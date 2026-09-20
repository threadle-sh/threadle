import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  emptyWorkflowFolderIndex,
  workflowFolderIndexSchema,
  type WorkflowFolder,
  type WorkflowFolderIndex,
} from "@threadle/shared";
import { threadleConfigDir } from "../paths.js";

function foldersFile(): string {
  return path.join(threadleConfigDir(), "workflow-folders.json");
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, file);
}

export async function readFolderIndex(): Promise<WorkflowFolderIndex> {
  try {
    const raw = await fs.promises.readFile(foldersFile(), "utf8");
    const parsed = workflowFolderIndexSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data as WorkflowFolderIndex;
  } catch {
    // missing or corrupt — start empty
  }
  return emptyWorkflowFolderIndex();
}

/**
 * Drop placements whose graphs no longer exist (abandoned empty drafts, deleted files).
 * Called on folder reads so the UI doesn't show ghost counts.
 */
export async function readFolderIndexLive(): Promise<WorkflowFolderIndex> {
  const index = await readFolderIndex();
  const { readGraph } = await import("./store.js");
  let dirty = false;
  const placements: Record<string, string> = {};
  for (const [graphId, folderId] of Object.entries(index.placements)) {
    const g = await readGraph(graphId);
    if (!g) {
      dirty = true;
      continue;
    }
    placements[graphId] = folderId;
  }
  if (!dirty) return index;
  return writeFolderIndex({ ...index, placements });
}

async function writeFolderIndex(index: WorkflowFolderIndex): Promise<WorkflowFolderIndex> {
  const cleaned = pruneOrphans(index);
  await fs.promises.mkdir(path.dirname(foldersFile()), { recursive: true });
  await atomicWrite(foldersFile(), JSON.stringify(cleaned, null, 2));
  return cleaned;
}

/** Drop placements / parent links that point at missing folders. */
function pruneOrphans(index: WorkflowFolderIndex): WorkflowFolderIndex {
  const ids = new Set(index.folders.map((f) => f.id));
  const folders = index.folders.map((f) => ({
    ...f,
    parentId: f.parentId && ids.has(f.parentId) ? f.parentId : null,
  }));
  const placements: Record<string, string> = {};
  for (const [graphId, folderId] of Object.entries(index.placements)) {
    if (ids.has(folderId)) placements[graphId] = folderId;
  }
  return { schemaVersion: 1, folders, placements };
}

function newId(): string {
  return crypto.randomBytes(4).toString("hex");
}

function isDescendant(
  folders: WorkflowFolder[],
  ancestorId: string,
  maybeChildId: string,
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur: string | null = maybeChildId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === ancestorId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export async function createFolder(
  name: string,
  parentId: string | null = null,
): Promise<WorkflowFolderIndex> {
  const index = await readFolderIndex();
  const trimmed = name.trim().slice(0, 120) || "Untitled folder";
  if (parentId && !index.folders.some((f) => f.id === parentId)) {
    const err = new Error("parent folder not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  const now = Date.now();
  index.folders.push({
    id: newId(),
    name: trimmed,
    parentId,
    createdAt: now,
    updatedAt: now,
  });
  return writeFolderIndex(index);
}

export async function renameFolder(
  folderId: string,
  name: string,
): Promise<WorkflowFolderIndex> {
  const index = await readFolderIndex();
  const folder = index.folders.find((f) => f.id === folderId);
  if (!folder) {
    const err = new Error("folder not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) {
    const err = new Error("name required") as Error & { status: number };
    err.status = 400;
    throw err;
  }
  folder.name = trimmed;
  folder.updatedAt = Date.now();
  return writeFolderIndex(index);
}

/**
 * Move a folder under another (or to root). Rejects cycles.
 */
export async function moveFolder(
  folderId: string,
  parentId: string | null,
): Promise<WorkflowFolderIndex> {
  const index = await readFolderIndex();
  const folder = index.folders.find((f) => f.id === folderId);
  if (!folder) {
    const err = new Error("folder not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (parentId === folderId) {
    const err = new Error("cannot nest a folder inside itself") as Error & { status: number };
    err.status = 400;
    throw err;
  }
  if (parentId) {
    if (!index.folders.some((f) => f.id === parentId)) {
      const err = new Error("parent folder not found") as Error & { status: number };
      err.status = 404;
      throw err;
    }
    if (isDescendant(index.folders, folderId, parentId)) {
      const err = new Error("cannot move a folder into its descendant") as Error & {
        status: number;
      };
      err.status = 400;
      throw err;
    }
  }
  folder.parentId = parentId;
  folder.updatedAt = Date.now();
  return writeFolderIndex(index);
}

/**
 * Delete a folder. Child folders and graph placements move to the deleted
 * folder's parent (or root). Graphs are never deleted.
 */
export async function deleteFolder(folderId: string): Promise<WorkflowFolderIndex> {
  const index = await readFolderIndex();
  const folder = index.folders.find((f) => f.id === folderId);
  if (!folder) {
    const err = new Error("folder not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  const promoteTo = folder.parentId;
  for (const f of index.folders) {
    if (f.parentId === folderId) {
      f.parentId = promoteTo;
      f.updatedAt = Date.now();
    }
  }
  for (const [graphId, fid] of Object.entries(index.placements)) {
    if (fid === folderId) {
      if (promoteTo) index.placements[graphId] = promoteTo;
      else delete index.placements[graphId];
    }
  }
  index.folders = index.folders.filter((f) => f.id !== folderId);
  return writeFolderIndex(index);
}

/**
 * Find-or-create folders along a path under root.
 * `["foo","bar"]` → folderId of `bar` (child of `foo`).
 * Empty segments → folderId null (root).
 */
export async function ensureFolderPath(
  segments: string[],
): Promise<{ index: WorkflowFolderIndex; folderId: string | null }> {
  const clean = segments
    .map((s) => s.trim().slice(0, 120))
    .filter(Boolean);
  let index = await readFolderIndex();
  if (!clean.length) return { index, folderId: null };

  let parentId: string | null = null;
  let leafId: string | null = null;
  let dirty = false;
  for (const name of clean) {
    const existing = index.folders.find(
      (f) => f.parentId === parentId && f.name === name,
    );
    if (existing) {
      leafId = existing.id;
      parentId = existing.id;
      continue;
    }
    const now = Date.now();
    const id = newId();
    index.folders.push({
      id,
      name,
      parentId,
      createdAt: now,
      updatedAt: now,
    });
    leafId = id;
    parentId = id;
    dirty = true;
  }
  if (dirty) index = await writeFolderIndex(index);
  return { index, folderId: leafId };
}

/** Place a graph in a folder, or null to move to root. */
export async function placeGraph(
  graphId: string,
  folderId: string | null,
): Promise<WorkflowFolderIndex> {
  const index = await readFolderIndex();
  if (folderId) {
    if (!index.folders.some((f) => f.id === folderId)) {
      const err = new Error("folder not found") as Error & { status: number };
      err.status = 404;
      throw err;
    }
    index.placements[graphId] = folderId;
  } else {
    delete index.placements[graphId];
  }
  return writeFolderIndex(index);
}

/** Drop placement when a graph is deleted. */
export async function unplaceGraph(graphId: string): Promise<void> {
  const index = await readFolderIndex();
  if (!(graphId in index.placements)) return;
  delete index.placements[graphId];
  await writeFolderIndex(index);
}
