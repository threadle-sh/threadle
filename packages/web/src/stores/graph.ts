import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Graph, GraphNode, GraphEdge, GraphNodeData } from "@threadle/shared";
import { api } from "@/api/client";

/** Drop runner ephemera so status/output ticks don't enter undo. */
function structuralNodes(nodes: GraphNode[]): unknown[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: stripRuntimeData(n.data),
    subOf: n.subOf,
    originId: n.originId,
    muted: n.muted,
    bypassed: n.bypassed,
    retry: n.retry,
    continueOnError: n.continueOnError,
  }));
}

function stripRuntimeData(data: GraphNodeData): unknown {
  if (data.type === "output") {
    const { content: _c, preview: _p, ...rest } = data;
    return rest;
  }
  return data;
}

/** Editor-owned shape — excludes status / lastRunId / output contents. */
function editorKey(g: Graph): string {
  return JSON.stringify({
    name: g.name,
    kind: g.kind,
    params: g.params,
    settings: g.settings,
    edges: g.edges,
    nodes: structuralNodes(g.nodes),
  });
}

/** Undo snapshots — same exclusion so a run doesn't flood history. */
function historyKey(g: Graph): string {
  return JSON.stringify({ nodes: structuralNodes(g.nodes), edges: g.edges });
}

export const useGraphStore = defineStore("graph", () => {
  const graph = ref<Graph>();
  const saveState = ref<"saved" | "saving" | "dirty" | "error">("saved");
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let suppress = false;
  let lastEditor = "";

  // ---- undo / redo: debounced snapshots of nodes+edges ----
  const past = ref<string[]>([]);
  const future = ref<string[]>([]);
  let last = "";
  let histTimer: ReturnType<typeof setTimeout> | undefined;
  let skipHistory = false;

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  function commitHistory(): void {
    if (!graph.value) return;
    if (skipHistory) {
      skipHistory = false;
      return;
    }
    const now = historyKey(graph.value);
    if (now === last) return;
    past.value.push(last);
    if (past.value.length > 50) past.value.shift();
    future.value = [];
    last = now;
  }

  function applyState(json: string): void {
    if (!graph.value) return;
    const state = JSON.parse(json) as {
      nodes: ReturnType<typeof structuralNodes>;
      edges: GraphEdge[];
    };
    skipHistory = true;
    if (histTimer) clearTimeout(histTimer);
    // Restore structural fields onto existing nodes so runtime status/content survive undo
    const byId = new Map(graph.value.nodes.map((n) => [n.id, n]));
    const nextNodes: GraphNode[] = state.nodes.map((s) => {
      const raw = s as {
        id: string;
        type: GraphNode["type"];
        position: GraphNode["position"];
        data: GraphNodeData;
        subOf?: string;
        originId?: string;
        muted?: boolean;
        bypassed?: boolean;
        retry?: number;
        continueOnError?: boolean;
      };
      const prev = byId.get(raw.id);
      return {
        id: raw.id,
        type: raw.type,
        position: raw.position,
        data:
          raw.data.type === "output" && prev?.data.type === "output"
            ? {
                ...raw.data,
                content: prev.data.content,
                preview: prev.data.preview,
              }
            : raw.data,
        status: prev?.status ?? "idle",
        lastRunId: prev?.lastRunId,
        subOf: raw.subOf,
        originId: raw.originId,
        muted: raw.muted,
        bypassed: raw.bypassed,
        retry: raw.retry,
        continueOnError: raw.continueOnError,
      };
    });
    graph.value.nodes = nextNodes;
    graph.value.edges = state.edges;
    last = json;
    lastEditor = editorKey(graph.value);
  }

  function undo(): boolean {
    if (!graph.value || !past.value.length) return false;
    // a pending snapshot means `last` is stale — commit it first
    if (histTimer) {
      clearTimeout(histTimer);
      commitHistory();
    }
    if (!past.value.length) return false;
    const prev = past.value.pop()!;
    future.value.push(last);
    applyState(prev);
    return true;
  }

  function redo(): boolean {
    if (!graph.value || !future.value.length) return false;
    const next = future.value.pop()!;
    past.value.push(last);
    applyState(next);
    return true;
  }

  async function load(id: string): Promise<void> {
    suppress = true;
    if (editCheckTimer !== undefined) {
      clearTimeout(editCheckTimer);
      editCheckTimer = undefined;
    }
    graph.value = await api.graph(id);
    saveState.value = "saved";
    past.value = [];
    future.value = [];
    last = historyKey(graph.value);
    lastEditor = editorKey(graph.value);
    // let the watcher skip the load-triggered mutation
    queueMicrotask(() => {
      suppress = false;
    });
  }

  /** Leave the editor with no workflow selected (empty canvas). */
  function clear(): void {
    if (saveTimer) clearTimeout(saveTimer);
    if (histTimer) clearTimeout(histTimer);
    if (editCheckTimer !== undefined) {
      clearTimeout(editCheckTimer);
      editCheckTimer = undefined;
    }
    suppress = true;
    graph.value = undefined;
    saveState.value = "saved";
    past.value = [];
    future.value = [];
    last = "";
    lastEditor = "";
    queueMicrotask(() => {
      suppress = false;
    });
  }

  function scheduleSave(): void {
    if (!graph.value || suppress) return;
    saveState.value = "dirty";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1000);
    if (histTimer) clearTimeout(histTimer);
    histTimer = setTimeout(commitHistory, 400);
  }

  async function flush(): Promise<void> {
    if (!graph.value) return;
    // Empty drafts stay session-local — never treat them as saved work.
    if (graph.value.nodes.length === 0) {
      saveState.value = "saved";
      try {
        const saved = await api.saveGraph(graph.value);
        graph.value.updatedAt = saved.updatedAt;
        lastEditor = editorKey(graph.value);
      } catch {
        /* ephemeral update failed — ignore */
      }
      return;
    }
    saveState.value = "saving";
    try {
      const saved = await api.saveGraph(graph.value);
      graph.value.updatedAt = saved.updatedAt;
      saveState.value = "saved";
      lastEditor = editorKey(graph.value);
    } catch {
      saveState.value = "error";
    }
  }

  // Debounced: the deep watcher fires on EVERY node-status tick during runs,
  // and editorKey() JSON.stringifies all nodes+edges — un-debounced that's a
  // full-graph serialization per SSE event, the main GC-pressure source in a
  // long-lived canvas tab. 300ms trailing keeps saves just as safe.
  let editCheckTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    graph,
    () => {
      if (!graph.value || suppress) return;
      if (editCheckTimer !== undefined) clearTimeout(editCheckTimer);
      editCheckTimer = setTimeout(() => {
        editCheckTimer = undefined;
        if (!graph.value || suppress) return;
        const ed = editorKey(graph.value);
        // Status / output-content ticks are runner ephemera — don't flash "unsaved"
        if (ed === lastEditor) return;
        lastEditor = ed;
        scheduleSave();
      }, 300);
    },
    { deep: true },
  );

  function addNode(node: GraphNode): void {
    graph.value?.nodes.push(node);
  }

  function removeNode(id: string): void {
    if (!graph.value) return;
    graph.value.nodes = graph.value.nodes.filter((n) => n.id !== id);
    graph.value.edges = graph.value.edges.filter(
      (e) => e.source !== id && e.target !== id,
    );
  }

  function addEdge(edge: GraphEdge): void {
    graph.value?.edges.push(edge);
  }

  function removeEdge(id: string): void {
    if (!graph.value) return;
    graph.value.edges = graph.value.edges.filter((e) => e.id !== id);
  }

  function nodeById(id: string): GraphNode | undefined {
    return graph.value?.nodes.find((n) => n.id === id);
  }

  return {
    graph,
    saveState,
    load,
    clear,
    flush,
    addNode,
    removeNode,
    addEdge,
    removeEdge,
    nodeById,
    undo,
    redo,
    canUndo,
    canRedo,
  };
});
