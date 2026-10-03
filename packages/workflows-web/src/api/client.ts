import type { Graph, PortableGraph, WorkflowFolderIndex } from "@threadle/workflows-shared";
import { api as coreApi, http } from "@ui/api/client";

export { subscribeEvents } from "@ui/api/client";

/** Core API plus the workflows (graph) API — editor code imports this one. */
export const api = {
  ...coreApi,
  createGraph: (name: string, opts?: { kind?: "workflow" | "subgraph" }) =>
    http<Graph>("/api/graphs", {
      method: "POST",
      body: JSON.stringify({ name, kind: opts?.kind ?? "workflow" }),
    }),
  importGraph: (graph: PortableGraph) =>
    http<Graph>("/api/graphs/import", {
      method: "POST",
      body: JSON.stringify(graph),
    }),
  graphFolders: () => http<WorkflowFolderIndex>("/api/graphs/folders"),
  createGraphFolder: (name: string, parentId?: string | null) =>
    http<WorkflowFolderIndex>("/api/graphs/folders", {
      method: "POST",
      body: JSON.stringify({ name, parentId: parentId ?? null }),
    }),
  renameGraphFolder: (folderId: string, name: string) =>
    http<WorkflowFolderIndex>(`/api/graphs/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  moveGraphFolder: (folderId: string, parentId: string | null) =>
    http<WorkflowFolderIndex>(`/api/graphs/folders/${folderId}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId }),
    }),
  deleteGraphFolder: (folderId: string) =>
    http<WorkflowFolderIndex>(`/api/graphs/folders/${folderId}`, { method: "DELETE" }),
  placeGraphInFolder: (graphId: string, folderId: string | null) =>
    http<WorkflowFolderIndex>("/api/graphs/folders/place", {
      method: "PUT",
      body: JSON.stringify({ graphId, folderId }),
    }),
  ensureGraphFolderPath: (segments: string[]) =>
    http<{ index: WorkflowFolderIndex; folderId: string | null }>(
      "/api/graphs/folders/ensure-path",
      {
        method: "POST",
        body: JSON.stringify({ segments }),
      },
    ),
  graphTemplates: () =>
    http<
      Array<{
        id: string;
        name: string;
        description: string;
        level?: string;
        teaches?: string[];
      }>
    >("/api/graphs/templates"),
  fromTemplate: (id: string) =>
    http<Graph>(`/api/graphs/templates/${id}`, { method: "POST" }),
  graphRecipes: () =>
    http<
      Array<{
        id: string;
        name: string;
        outcome: string;
        needs: { model: boolean; dir: boolean; session: boolean };
        agents: number | string;
        params: string[];
        note?: string;
      }>
    >("/api/graphs/recipes"),
  fromRecipe: (id: string) =>
    http<Graph>(`/api/graphs/recipes/${id}`, { method: "POST" }),
  graph: (id: string) => http<Graph>(`/api/graphs/${id}`),
  saveGraph: (graph: Graph) =>
    http<Graph>(`/api/graphs/${graph.id}`, {
      method: "PUT",
      body: JSON.stringify(graph),
    }),
  setGraphKind: (id: string, kind: "workflow" | "subgraph") =>
    http<Graph>(`/api/graphs/${id}/kind`, {
      method: "PATCH",
      body: JSON.stringify({ kind }),
    }),
  deleteGraph: (id: string) =>
    http<{ ok: boolean }>(`/api/graphs/${id}`, { method: "DELETE" }),

  graphVersions: (id: string) =>
    http<
      Array<{ ts: string; updatedAt?: number; name?: string; nodeCount?: number }>
    >(`/api/graphs/${id}/versions`),
  graphVersion: (id: string, ts: string) =>
    http<Graph>(`/api/graphs/${id}/versions/${encodeURIComponent(ts)}`),
  restoreGraphVersion: (id: string, ts: string) =>
    http<Graph>(`/api/graphs/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ ts }),
    }),

  confirmImport: (id: string) =>
    http<Graph>(`/api/graphs/${encodeURIComponent(id)}/confirm-import`, { method: "POST" }),
};
