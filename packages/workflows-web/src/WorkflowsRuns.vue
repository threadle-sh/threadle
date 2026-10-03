<template>
  <div class="dash">
    <WorkflowsNav active="runs" />
    <div class="dash-col">
      <main class="dash-main">
        <header class="dash-head">
          <div>
            <h1 class="dash-title">Runs</h1>
          </div>
        </header>
        <div class="dash-toolbar">
          <input v-model="filter" class="threadle-input dash-search" placeholder="Filter runs…" spellcheck="false" />
          <div class="chip-row">
            <button
              v-for="k in KINDS"
              :key="k"
              type="button"
              class="filter-chip"
              :class="{ active: kindFilter === k }"
              @click="kindFilter = k"
            >
              {{ KIND_LABELS[k] }}
            </button>
          </div>
          <div class="chip-row">
            <button
              v-for="st in STATUSES"
              :key="st"
              type="button"
              class="filter-chip"
              :class="{ active: statusFilter === st }"
              @click="statusFilter = st"
            >
              {{ st }}
            </button>
          </div>
        </div>

        <div class="stat-table wfr-table">
          <div class="stat-cols micro-label">
            <span>run</span><span>workflow</span><span>kind</span><span>status</span><span>started</span><span>duration</span><span>actions</span>
          </div>
          <template v-for="j in rows" :key="j.id">
            <div class="stat-row wfr-row" :class="{ picked: picked === j.id }" @click="toggle(j.id)">
              <span class="stat-name mono" :title="j.id">{{ j.label ?? j.id }}</span>
              <span class="stat-val wfr-graph">
                <router-link v-if="j.graphId" :to="`/addon/workflows/graph/${j.graphId}`" class="wfr-link" @click.stop>{{
                  graphName(j.graphId)
                }}</router-link>
                <template v-else>—</template>
              </span>
              <span class="wfr-kind mono">{{ KIND_LABELS[j.kind] ?? j.kind }}</span>
              <span class="wfr-status mono" :class="j.status">{{ j.status }}</span>
              <span class="stat-val">{{ relativeTime(j.createdAt) }}</span>
              <span class="stat-val">{{ duration(j) }}</span>
              <span class="stat-val wfr-acts" @click.stop>
                <button v-if="j.graphId" class="row-icon" title="Open workflow" @click="router.push(`/addon/workflows/graph/${j.graphId}`)">⌗</button>
                <button v-if="j.status === 'running'" class="row-icon" title="Cancel this run" @click="cancel(j.id)">✕</button>
                <button
                  v-else-if="j.graphId"
                  class="row-icon"
                  title="Re-run workflow"
                  @click="router.push(`/addon/workflows/graph/${j.graphId}?run=1`)"
                >
                  ⟳
                </button>
              </span>
            </div>
            <div v-if="picked === j.id" class="wfr-logs mono">
              <p v-if="logsBusy" class="stat-note">loading logs…</p>
              <p v-else-if="!logs.length" class="stat-note">no log lines recorded for this run</p>
              <div v-for="(l, i) in logs" :key="i" class="wfr-log-line">
                <span class="wfr-ts">{{ new Date(l.ts).toLocaleTimeString() }}</span>
                <span class="wfr-lane" :class="'lane-' + l.lane">{{ l.lane }}</span>
                <span class="wfr-text">{{ l.line }}</span>
              </div>
              <p v-if="j.error" class="wfr-error">{{ j.error }}</p>
            </div>
          </template>
          <p v-if="!rows.length" class="stat-note wfr-empty">
            {{ runs.length ? "no runs match these filters" : "no runs yet — press ▶ Run in a workflow" }}
          </p>
        </div>
      </main>
      <StatusBar />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { GraphSummary } from "@threadle/shared";
import StatusBar from "@ui/panels/StatusBar.vue";
import { relativeTime } from "@ui/lib/format";
import { api, subscribeEvents } from "@wf/api/client";
import WorkflowsNav from "./WorkflowsNav.vue";
import "@ui/theme/chrome.css";

type Job = Awaited<ReturnType<typeof api.jobs>>[number];

const STATUSES = ["all", "running", "done", "error", "cancelled"] as const;
const KINDS = ["all", "workflow", "run-agent", "run-session", "custom-node", "inject", "distill"] as const;
const KIND_LABELS: Record<string, string> = {
  all: "all kinds",
  workflow: "workflow",
  "run-agent": "agent",
  "run-session": "session",
  "custom-node": "node",
  inject: "inject",
  distill: "distill",
};

const router = useRouter();
const route = useRoute();
const runs = ref<Job[]>([]);
const graphs = ref<GraphSummary[]>([]);
const filter = ref("");
const statusFilter = ref<(typeof STATUSES)[number]>("all");
const kindFilter = ref<(typeof KINDS)[number]>("all");
const picked = ref<string>();
const logs = ref<Array<{ ts: number; lane: string; line: string }>>([]);
const logsBusy = ref(false);
const now = ref(Date.now());

const rows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return runs.value.filter(
    (j) =>
      (statusFilter.value === "all" || j.status === statusFilter.value) &&
      (kindFilter.value === "all" || j.kind === kindFilter.value) &&
      (!q ||
        (j.label ?? "").toLowerCase().includes(q) ||
        graphName(j.graphId ?? "").toLowerCase().includes(q) ||
        j.id.includes(q)),
  );
});

function graphName(id: string): string {
  return graphs.value.find((g) => g.id === id)?.name ?? id;
}

function duration(j: Job): string {
  const end = j.finishedAt ?? (j.status === "running" ? now.value : j.createdAt);
  const ms = Math.max(0, end - j.createdAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

async function load(): Promise<void> {
  try {
    runs.value = await api.jobs();
    const want = route.query.job;
    if (typeof want === "string" && want && picked.value !== want && runs.value.some((j) => j.id === want)) {
      void toggle(want);
    }
  } catch {
    // server offline
  }
}

async function toggle(id: string): Promise<void> {
  if (picked.value === id) {
    picked.value = undefined;
    return;
  }
  picked.value = id;
  logs.value = [];
  logsBusy.value = true;
  try {
    logs.value = (await api.jobLogs(id)).lines;
  } catch {
    logs.value = [];
  } finally {
    logsBusy.value = false;
  }
}

async function cancel(id: string): Promise<void> {
  await api.cancelJob(id).catch(() => undefined);
  await load();
}

let poll: ReturnType<typeof setInterval> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
let unsub: (() => void) | undefined;

onMounted(() => {
  void load();
  void api.graphs().then((g) => (graphs.value = g)).catch(() => undefined);
  poll = setInterval(() => void load(), 5_000);
  tick = setInterval(() => (now.value = Date.now()), 1_000);
  unsub = subscribeEvents((ev) => {
    if (ev.type === "job.log" && ev.jobId === picked.value) {
      logs.value.push({ ts: Date.now(), lane: ev.lane, line: ev.line });
      return;
    }
    if (ev.type === "job.done" || ev.type === "job.error") void load();
  });
});

onUnmounted(() => {
  clearInterval(poll);
  clearInterval(tick);
  unsub?.();
});
</script>

<style scoped>
.dash {
  height: 100%;
  min-height: 0;
  display: flex;
}
.dash-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dash-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: scroll;
  scrollbar-gutter: stable;
  padding: 32px 36px 64px;
}
.wfr-table .stat-cols,
.wfr-table .stat-row {
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1.2fr) 5.5rem 6rem 5rem 5rem 5rem;
}
.wfr-table .stat-cols > span:nth-child(5),
.wfr-table .stat-cols > span:nth-child(6) {
  text-align: right;
}
.wfr-row {
  cursor: pointer;
}
.wfr-row.picked {
  background: var(--panel-bg-raised);
}
.wfr-graph {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.wfr-link {
  color: var(--text-dim);
  text-decoration: none;
}
.wfr-link:hover {
  color: var(--accent);
}
.wfr-kind {
  justify-self: start;
  font-size: var(--fs-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.wfr-status {
  justify-self: start;
  font-size: var(--fs-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  line-height: 1.2;
}
.wfr-status.running {
  color: var(--status-running);
  border-color: color-mix(in srgb, var(--status-running) 40%, transparent);
}
.wfr-status.error {
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 40%, transparent);
}
.wfr-status.cancelled {
  color: var(--status-waiting);
  border-color: color-mix(in srgb, var(--status-waiting) 40%, transparent);
}
.wfr-acts {
  display: flex;
  justify-content: flex-end;
  gap: 1px;
}
.wfr-logs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  margin: -4px 0 12px;
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--panel-bg);
  font-size: var(--fs-xs);
}
.wfr-log-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  line-height: 1.5;
}
.wfr-ts {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.wfr-lane {
  flex-shrink: 0;
  width: 62px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.wfr-lane.lane-stderr {
  color: var(--status-error);
}
.wfr-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dim);
  min-width: 0;
}
.wfr-error {
  margin: 8px 0 0;
  color: var(--status-error);
  white-space: pre-wrap;
}
.wfr-empty {
  padding: 14px 16px;
}
</style>
