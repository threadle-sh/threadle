import { computed, reactive, type ComputedRef } from "vue";
import type { NodeStatus } from "@threadle/shared";

export type TabRunPhase = "idle" | "running" | "waiting" | "success" | "error";

export interface TabRunState {
  phase: TabRunPhase;
  jobId?: string;
  done: number;
  total: number;
  nodes: Record<string, NodeStatus>;
}

export interface TabBarRun {
  visible: boolean;
  pct: number;
  tone: TabRunPhase | "idle";
  title: string;
}

export interface TabRunsOptions {
  labelFor: (graphId: string) => string;
  activeGraphId: () => string | undefined;
}

export function useTabRuns(opts: TabRunsOptions): {
  tabRuns: Record<string, TabRunState>;
  tabRunPhase: (id: string) => TabRunPhase;
  tabRunPct: (id: string) => number;
  tabRunTitle: (id: string) => string;
  beginTabRun: (graphId: string, jobId: string | undefined, total: number) => void;
  noteTabNode: (graphId: string, nodeId: string, status: NodeStatus) => void;
  finishTabRun: (graphId: string, ok: boolean) => void;
  dropTabRun: (graphId: string) => void;
  disposeTabRuns: () => void;
  tabBarRun: ComputedRef<TabBarRun>;
} {
  const tabRuns = reactive<Record<string, TabRunState>>({});
  const tabSuccessTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearTabSuccessTimer(graphId: string): void {
    const t = tabSuccessTimers.get(graphId);
    if (t !== undefined) {
      clearTimeout(t);
      tabSuccessTimers.delete(graphId);
    }
  }

  function tabRunPhase(id: string): TabRunPhase {
    return tabRuns[id]?.phase ?? "idle";
  }

  function tabRunPct(id: string): number {
    const tr = tabRuns[id];
    if (!tr) return 0;
    if (tr.phase === "success" || tr.phase === "error") return 100;
    if (tr.total <= 0) return tr.phase === "waiting" ? 16 : 10;
    const raw = Math.round((tr.done / tr.total) * 100);
    // Keep a visible sliver while work is in flight.
    if (tr.phase === "running" || tr.phase === "waiting") {
      return Math.max(tr.phase === "waiting" ? 12 : 8, Math.min(96, raw || 8));
    }
    return Math.min(100, raw);
  }

  function tabRunTitle(id: string): string {
    const base = `${opts.labelFor(id)} · ${id}`;
    const tr = tabRuns[id];
    if (!tr || tr.phase === "idle") return base;
    if (tr.phase === "running") return `${base} · running ${tr.done}/${tr.total}`;
    if (tr.phase === "waiting") return `${base} · waiting (splice)`;
    if (tr.phase === "error") return `${base} · failed`;
    if (tr.phase === "success") return `${base} · finished`;
    return base;
  }

  function beginTabRun(graphId: string, jobId: string | undefined, total: number): void {
    clearTabSuccessTimer(graphId);
    tabRuns[graphId] = {
      phase: "running",
      jobId,
      done: 0,
      total: Math.max(1, total),
      nodes: {},
    };
  }

  function noteTabNode(graphId: string, nodeId: string, status: NodeStatus): void {
    let tr = tabRuns[graphId];
    if (!tr || tr.phase === "success" || tr.phase === "error" || tr.phase === "idle") {
      if (status !== "running" && status !== "queued") return;
      tabRuns[graphId] = { phase: "running", done: 0, total: 1, nodes: {} };
      tr = tabRuns[graphId]!;
    }
    tr.nodes[nodeId] = status;
    const vals = Object.values(tr.nodes);
    tr.done = vals.filter((s) => s === "success" || s === "error").length;
    if (vals.length > tr.total) tr.total = vals.length;
    if (tr.phase === "waiting" && (status === "running" || status === "queued")) {
      tr.phase = "running";
    }
  }

  function finishTabRun(graphId: string, ok: boolean): void {
    clearTabSuccessTimer(graphId);
    if (ok) {
      // Finished cleanly — drop the background progress bar.
      delete tabRuns[graphId];
      return;
    }
    const tr = tabRuns[graphId];
    if (!tr) {
      tabRuns[graphId] = { phase: "error", done: 1, total: 1, nodes: {} };
    } else {
      tr.phase = "error";
      tr.done = Math.max(tr.done, tr.total);
    }
    tabSuccessTimers.set(
      graphId,
      setTimeout(() => {
        if (tabRuns[graphId]?.phase === "error") delete tabRuns[graphId];
        tabSuccessTimers.delete(graphId);
      }, 6000),
    );
  }

  /** Tab closed — a run stuck in running/waiting would otherwise keep its
   *  entry (and node-status record) alive indefinitely. */
  function dropTabRun(graphId: string): void {
    clearTabSuccessTimer(graphId);
    delete tabRuns[graphId];
  }

  /** Editor unmounting — clear every timer and entry. */
  function disposeTabRuns(): void {
    for (const t of tabSuccessTimers.values()) clearTimeout(t);
    tabSuccessTimers.clear();
    for (const k of Object.keys(tabRuns)) delete tabRuns[k];
  }

  const tabBarRun = computed((): TabBarRun => {
    const active = opts.activeGraphId();
    if (!active) return { visible: false, pct: 0, tone: "idle", title: "" };
    const tr = tabRuns[active];
    if (!tr) return { visible: false, pct: 0, tone: "idle", title: "" };
    if (tr.phase === "running" || tr.phase === "waiting") {
      const pct =
        tr.total > 0 ? Math.max(6, Math.min(100, Math.round((tr.done / tr.total) * 100))) : 10;
      return {
        visible: true,
        pct: tr.phase === "waiting" ? Math.max(pct, 20) : pct,
        tone: tr.phase,
        title: `${opts.labelFor(active)} · ${tr.done}/${tr.total}`,
      };
    }
    if (tr.phase === "error") {
      return {
        visible: true,
        pct: 100,
        tone: tr.phase,
        title: `${opts.labelFor(active)} · ${tr.phase}`,
      };
    }
    return { visible: false, pct: 0, tone: "idle", title: "" };
  });

  return {
    tabRuns,
    tabRunPhase,
    tabRunPct,
    tabRunTitle,
    beginTabRun,
    noteTabNode,
    finishTabRun,
    dropTabRun,
    disposeTabRuns,
    tabBarRun,
  };
}
