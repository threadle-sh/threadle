import { z } from "zod";

/** Optional browse folder for workflows (metadata only — graph files stay flat). */
export interface WorkflowFolder {
  id: string;
  name: string;
  /** null = top-level folder */
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Sidecar index at `~/.config/threadle/workflow-folders.json`.
 * Graphs not listed in `placements` live at the root (no folder).
 */
export interface WorkflowFolderIndex {
  schemaVersion: 1;
  folders: WorkflowFolder[];
  /** graphId → folderId */
  placements: Record<string, string>;
}

export const workflowFolderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).max(64).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const workflowFolderIndexSchema = z.object({
  schemaVersion: z.literal(1),
  folders: z.array(workflowFolderSchema),
  placements: z.record(z.string(), z.string()),
});

export function emptyWorkflowFolderIndex(): WorkflowFolderIndex {
  return { schemaVersion: 1, folders: [], placements: {} };
}

/**
 * Parse a path-style workflow name.
 * `foo/bar/workflow-123` or `foo / bar / workflow-123` →
 * folders `["foo","bar"]`, name `workflow-123`.
 * A bare name (no `/`) keeps placement unchanged on the client.
 */
export function parseWorkflowPath(raw: string): {
  folders: string[];
  name: string;
  /** true when the input used `/` */
  hasPath: boolean;
} {
  const trimmed = raw.trim();
  const hasPath = trimmed.includes("/");
  const parts = trimmed
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.slice(0, 120));
  if (parts.length === 0) return { folders: [], name: "", hasPath };
  if (parts.length === 1) return { folders: [], name: parts[0]!, hasPath };
  return {
    folders: parts.slice(0, -1),
    name: parts[parts.length - 1]!,
    hasPath,
  };
}

/** Display path with spaced separators: `foo / bar / name`. */
export function formatWorkflowPath(folders: string[], name: string): string {
  const parts = [...folders.map((f) => f.trim()).filter(Boolean), name.trim()].filter(
    Boolean,
  );
  return parts.join(" / ");
}

/** Ancestor folder names from root → leaf for a folder id. */
export function folderPathNames(
  index: WorkflowFolderIndex,
  folderId: string | null | undefined,
): string[] {
  if (!folderId) return [];
  const byId = new Map(index.folders.map((f) => [f.id, f]));
  const names: string[] = [];
  let cur: string | null = folderId;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const f = byId.get(cur);
    if (!f) break;
    names.unshift(f.name);
    cur = f.parentId;
  }
  return names;
}

/** Resolve an existing folder id for a root→leaf name path (no create). */
export function folderIdForPath(
  index: WorkflowFolderIndex,
  names: string[],
): string | null {
  let parentId: string | null = null;
  let leafId: string | null = null;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const hit = index.folders.find((f) => f.parentId === parentId && f.name === name);
    if (!hit) return null;
    leafId = hit.id;
    parentId = hit.id;
  }
  return leafId;
}

/** Ancestor folder names from root → leaf for a graph placement. */
export function folderNamesForGraph(
  index: WorkflowFolderIndex,
  graphId: string,
): string[] {
  return folderPathNames(index, index.placements[graphId]);
}
