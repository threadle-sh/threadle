import type {
  AgentDef,
  ContextPayload,
  ContextRequest,
  Graph,
  GraphSummary,
  InjectRequest,
  InjectResult,
  ModelInfo,
  NormalizedMessage,
  PortableGraph,
  RunAgentRequest,
  RunSessionRequest,
  ProviderInfo,
  ServerEvent,
  SessionRef,
  TouchedFile,
  WorkflowFolderIndex,
  FavoriteCreate,
  FavoriteEntry,
  ProviderId,
} from "@threadle/shared";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  providers: () => http<ProviderInfo[]>("/api/providers"),

  sessions: (params: { provider?: string; projectDir?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    );
    return http<SessionRef[]>(`/api/sessions?${qs}`);
  },
  session: (provider: string, id: string) =>
    http<SessionRef>(`/api/sessions/${provider}/detail/${id}`),
  children: (provider: string, id: string) =>
    http<SessionRef[]>(`/api/sessions/${provider}/children/${id}`),
  transcript: (
    provider: string,
    id: string,
    offset = 0,
    limit = 500,
    full = false,
    around?: { messageId?: string; ts?: number; role?: string },
  ) => {
    const qs = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    if (full) qs.set("full", "1");
    if (around?.messageId) qs.set("around", around.messageId);
    if (around?.ts != null) qs.set("aroundTs", String(around.ts));
    if (around?.role) qs.set("aroundRole", around.role);
    return http<{
      total: number;
      offset: number;
      messages: NormalizedMessage[];
      focusIndex?: number;
    }>(`/api/sessions/${provider}/transcript/${id}?${qs}`);
  },
  files: (provider: string, id: string) =>
    http<TouchedFile[]>(`/api/sessions/${provider}/files/${id}`),

  agents: (projectDir?: string) =>
    http<AgentDef[]>(
      `/api/agents${projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ""}`,
    ),

  graphs: () => http<GraphSummary[]>("/api/graphs"),
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

  backupPack: () =>
    http<{
      $schema: string;
      exportedAt: string;
      files: Array<{ path: string; encoding: string; content: string }>;
    }>("/api/backup/pack", { method: "POST" }),
  backupRestore: (bundle: unknown, categories?: string[]) =>
    http<{ ok: boolean; written: number; skipped: string[]; exportedAt: string }>(
      "/api/backup/restore",
      {
        method: "POST",
        body: JSON.stringify({ bundle, categories }),
      },
    ),

  extractContext: (req: ContextRequest) =>
    http<ContextPayload>("/api/context/extract", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  distillContext: (req: ContextRequest) =>
    http<{ jobId: string }>("/api/context/distill", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  filesContext: (req: ContextRequest) =>
    http<ContextPayload>("/api/context/files", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  payload: (hash: string) => http<ContextPayload>(`/api/payloads/${hash}`),

  inject: (req: InjectRequest) =>
    http<{ jobId: string }>("/api/inject", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  models: () => http<ModelInfo[]>("/api/models"),

  job: (id: string) =>
    http<{
      id: string;
      kind?: string;
      label?: string;
      graphId?: string;
      status: "running" | "done" | "error" | "cancelled";
      createdAt?: number;
      finishedAt?: number;
      result?: ServerEvent;
      error?: string;
    }>(`/api/jobs/${id}`),
  jobs: () =>
    http<
      Array<{
        id: string;
        kind: string;
        label?: string;
        graphId?: string;
        sessionRef?: { provider: string; sessionId: string };
        status: "running" | "done" | "error" | "cancelled";
        createdAt: number;
        finishedAt?: number;
        error?: string;
        result?: {
          inject?: {
            provider: string;
            newSessionId: string;
          };
        };
      }>
    >("/api/jobs"),
  cancelJob: (id: string) =>
    http<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),
  jobLogs: (id: string) =>
    http<{ lines: Array<{ ts: number; lane: string; line: string }> }>(
      `/api/jobs/${encodeURIComponent(id)}/logs`,
    ),
  runAgent: (req: RunAgentRequest) =>
    http<{ jobId: string }>("/api/run/agent", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  pilotPlan: (extraTests = false) =>
    http<{
      prompt: string;
      extraTests: boolean;
      harnessExtras: false;
      extraCaseCount: number;
      cases: Array<{
        id: string;
        provider: ProviderId;
        variant: string;
        agent: string;
        model?: string;
        permissionMode?: string;
        sandbox?: string;
        askForApproval?: string;
        harnessExtras?: boolean;
        extra?: boolean;
        note?: string;
        available: boolean;
        skipReason?: string;
      }>;
    }>(`/api/run/pilot${extraTests ? "?extra=1" : ""}`),
  runSession: (req: RunSessionRequest) =>
    http<{ jobId: string }>("/api/run/session", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  favorites: (check = false) =>
    http<{ items: Array<FavoriteEntry & { alive?: boolean }> }>(
      `/api/favorites${check ? "?check=1" : ""}`,
    ),
  addFavorite: (body: FavoriteCreate) =>
    http<{
      index: { schemaVersion: 1; items: FavoriteEntry[] };
      entry: FavoriteEntry;
      created: boolean;
    }>("/api/favorites", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeFavorite: (id: string) =>
    http<{ items: FavoriteEntry[] }>(`/api/favorites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  pruneFavorites: () =>
    http<{ items: FavoriteEntry[]; removed: number }>("/api/favorites/prune", {
      method: "POST",
    }),
};

const eventHandlers = new Set<(e: ServerEvent) => void>();
let sharedEventSource: EventSource | null = null;

function ensureEventSource(): void {
  if (sharedEventSource) return;
  sharedEventSource = new EventSource("/api/events");
  sharedEventSource.onmessage = (ev) => {
    try {
      const event = JSON.parse(ev.data) as ServerEvent;
      for (const h of eventHandlers) h(event);
    } catch {
      // malformed event
    }
  };
}

/** Shared SSE — one browser connection, fan-out to every subscriber. */
export function subscribeEvents(handler: (e: ServerEvent) => void): () => void {
  eventHandlers.add(handler);
  ensureEventSource();
  return () => {
    eventHandlers.delete(handler);
    if (eventHandlers.size === 0 && sharedEventSource) {
      sharedEventSource.close();
      sharedEventSource = null;
    }
  };
}
