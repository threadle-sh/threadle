import { z } from "zod";
import { GRAPH_ID_RE } from "./graph.js";

/** Stable project id: `proj_` + hex. */
export const PROJECT_ID_RE = /^proj_[a-f0-9]{8,16}$/;

export interface ThreadleProject {
  id: string;
  name: string;
  /** Absolute workspace roots belonging to this project. */
  dirs: string[];
  /** Linked workflow graph ids. */
  workflowIds: string[];
  pinned?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectsIndex {
  schemaVersion: 1;
  projects: ThreadleProject[];
}

export const threadleProjectSchema = z.object({
  id: z.string().regex(PROJECT_ID_RE),
  name: z.string().min(1).max(120),
  dirs: z.array(z.string().min(1).max(2048)).max(64),
  workflowIds: z.array(z.string().regex(GRAPH_ID_RE)).max(128),
  pinned: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const projectsIndexSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(threadleProjectSchema),
});

export function emptyProjectsIndex(): ProjectsIndex {
  return { schemaVersion: 1, projects: [] };
}

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  dirs: z.array(z.string().min(1).max(2048)).max(64).optional(),
  workflowIds: z.array(z.string().regex(GRAPH_ID_RE)).max(128).optional(),
  pinned: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});

export const projectPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  dirs: z.array(z.string().min(1).max(2048)).max(64).optional(),
  workflowIds: z.array(z.string().regex(GRAPH_ID_RE)).max(128).optional(),
  pinned: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});

export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
