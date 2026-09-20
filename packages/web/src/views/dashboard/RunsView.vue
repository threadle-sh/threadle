<template>
  <div class="run-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Runs</h1>
      </div>
    </header>

    <div class="dash-toolbar run-toolbar">
      <input
        v-model="runFilter"
        class="threadle-input dash-search"
        placeholder="Filter runs…"
        spellcheck="false"
      />
      <div class="chip-row">
        <button
          v-for="st in ['all', 'running', 'done', 'error', 'cancelled']"
          :key="st"
          type="button"
          class="filter-chip"
          :class="{ active: runStatusFilter === st }"
          @click="runStatusFilter = st as never"
        >
          {{ st }}
        </button>
      </div>
      <select v-model="runKindFilter" class="threadle-input run-kind-select" title="Filter by kind">
        <option v-for="k in RUN_KINDS" :key="k" :value="k">
          {{ k === "all" ? "all kinds" : RUN_KIND_LABELS[k] }}
        </option>
      </select>
    </div>
  </div>

  <div
    class="stat-table cols-runs"
    v-col-resize="'runs-v3'"
    data-cols="minmax(0,1.5fr) minmax(0,1.1fr) 5rem 4.5rem 4.5rem 4.5rem minmax(14rem,auto)"
  >
    <div class="stat-cols micro-label">
      <span class="th" @click="sortBy('runs', 'label')">run{{ arrow('runs', 'label') }}</span><span
        class="th"
        @click="sortBy('runs', 'graph')"
        >workflow{{ arrow('runs', 'graph') }}</span
      ><span
        class="th"
        @click="sortBy('runs', 'kind')"
        >kind{{ arrow('runs', 'kind') }}</span
      ><span class="th" @click="sortBy('runs', 'status')">status{{ arrow('runs', 'status') }}</span><span
        class="th"
        @click="sortBy('runs', 'started')"
        >started{{ arrow('runs', 'started') }}</span
      ><span class="th" @click="sortBy('runs', 'duration')">duration{{ arrow('runs', 'duration') }}</span><span>actions</span>
    </div>
    <template v-for="j in filteredRuns" :key="j.id">
      <div
        class="stat-row run-row"
        :class="{ picked: runPickedId === j.id }"
        @click="pickRun(j)"
      >
        <span class="stat-name mono" :title="j.id">{{ j.label ?? j.id }}</span>
        <span class="stat-val mono run-graph" :title="j.graphId ?? ''">
          <router-link
            v-if="j.graphId"
            :to="`/graph/${j.graphId}`"
            class="run-graph-link"
            @click.stop
          >{{ graphLabel(j.graphId) }}</router-link>
          <template v-else>—</template>
        </span>
        <span class="run-kind mono" :class="'kind-' + j.kind">{{
          RUN_KIND_LABELS[j.kind] ?? j.kind
        }}</span>
        <span class="run-status mono" :class="j.status">{{ j.status }}</span>
        <span class="stat-val">{{ relativeTime(j.createdAt) }}</span>
        <span class="stat-val">{{ runDuration(j) }}</span>
        <span class="stat-val run-acts" @click.stop>
          <button
            v-if="runSession(j)"
            class="row-icon"
            title="View transcript"
            @click="fileViewers.openTranscript(runSession(j)!.provider, runSession(j)!.newSessionId)"
          >
            ≡
          </button>
          <button
            v-if="runSession(j)"
            class="row-icon"
            title="View session blueprint"
            @click="router.push(`/blueprint/${runSession(j)!.provider}/${runSession(j)!.newSessionId}`)"
          >
            ⌗
          </button>
          <button
            v-if="j.graphId"
            class="row-icon"
            title="Open workflow"
            @click="router.push(`/graph/${j.graphId}`)"
          >
            #
          </button>
          <button
            v-if="j.status === 'running'"
            class="row-icon"
            title="Cancel this run"
            @click="cancelRun(j.id)"
          >
            ✕
          </button>
          <button
            v-else-if="j.graphId"
            class="row-icon"
            title="Re-run workflow"
            @click="router.push(`/graph/${j.graphId}?run=1`)"
          >
            ⟳
          </button>
        </span>
      </div>

      <div v-if="runPickedId === j.id" class="search-expand" @click.stop>
        <div class="search-expand-bar">
          <button
            class="vsc-btn"
            :class="{ toggled: runTab === 'info' }"
            @click="runTab = 'info'"
          >
            info
          </button>
          <button
            class="vsc-btn"
            :class="{ toggled: runTab === 'logs' }"
            @click="runTab = 'logs'"
          >
            ≣ logs
          </button>
          <button
            v-if="runSession(j)"
            class="vsc-btn"
            :class="{ toggled: runTab === 'transcript' }"
            @click="runTab = 'transcript'"
          >
            ≡ transcript
          </button>
          <span class="search-expand-spacer" />
          <button
            v-if="j.graphId"
            class="vsc-btn"
            title="Open the workflow graph"
            @click="router.push(`/graph/${j.graphId}`)"
          >
            # workflow
          </button>
          <button
            v-if="runSession(j)"
            class="vsc-btn"
            title="Open this session in the Sessions view"
            @click="openRunSession(j)"
          >
            ❯ session
          </button>
          <button
            v-if="runSession(j)"
            class="vsc-btn"
            title="Open the produced session's blueprint"
            @click="router.push(`/blueprint/${runSession(j)!.provider}/${runSession(j)!.newSessionId}`)"
          >
            ⌗ blueprint
          </button>
          <button class="vsc-btn" @click="runPickedId = undefined">✕</button>
        </div>
        <div class="search-expand-body">
          <TranscriptView
            v-if="runTab === 'transcript' && runSession(j)"
            :provider="runSession(j)!.provider"
            :session-id="runSession(j)!.newSessionId"
          />
          <div v-else-if="runTab === 'logs'" class="run-logs mono">
            <p v-if="runLogsBusy" class="stat-note">loading logs…</p>
            <p v-else-if="!runLogs.length" class="stat-note">
              no log lines recorded for this run
            </p>
            <div v-for="(l, li) in runLogs" :key="li" class="run-log-line">
              <span class="rl-ts">{{ logTime(l.ts) }}</span>
              <span class="rl-lane" :class="'rl-lane-' + l.lane">{{ l.lane }}</span>
              <span class="rl-text">{{ l.line }}</span>
            </div>
          </div>
          <div v-else class="run-info">
            <div class="run-kv mono">
              <template v-for="[k, v] in runInfoRows(j)" :key="k">
                <span class="run-key">{{ k }}</span>
                <span class="run-val">
                  <router-link
                    v-if="k === 'workflow' && j.graphId"
                    :to="`/graph/${j.graphId}`"
                    class="run-graph-link"
                  >{{ v }}</router-link>
                  <template v-else>{{ v }}</template>
                </span>
              </template>
            </div>
            <p v-if="j.error" class="run-info-error mono">{{ j.error }}</p>
          </div>
        </div>
      </div>
    </template>
    <p v-if="!filteredRuns.length" class="stat-note run-empty">
      no runs{{
        runStatusFilter !== "all" || runKindFilter !== "all"
          ? " match these filters"
          : " yet — press ▶ Run in a workflow"
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { GraphSummary, SessionRef } from "@threadle/shared";
import { api, subscribeEvents } from "@/api/client";
import { relativeTime, shortId, fmtTokens, isTokenEstimate } from "@/lib/format";
import { useSessionsStore } from "@/stores/sessions";
import { useFileViewersStore } from "@/stores/fileViewers";
import { vColResize } from "@/lib/colResize";
import TranscriptView from "@/panels/TranscriptView.vue";
import "./chrome.css";

interface RunRecord {
  id: string;
  kind: string;
  label?: string;
  graphId?: string;
  status: "running" | "done" | "error" | "cancelled";
  createdAt: number;
  finishedAt?: number;
  result?: {
    inject?: {
      provider: "claude-code" | "opencode" | "cursor" | "antigravity" | "codex" | "copilot" | "grok";
      newSessionId: string;
    };
  };
  error?: string;
}

const props = defineProps<{
  graphs: GraphSummary[];
}>();

const emit = defineEmits<{
  "open-session": [session: SessionRef];
  "running-count": [count: number | ""];
}>();

const router = useRouter();
const route = useRoute();
const sessions = useSessionsStore();
const fileViewers = useFileViewersStore();

const RUN_KINDS = [
  "all",
  "workflow",
  "run-agent",
  "run-session",
  "custom-node",
  "inject",
  "distill",
] as const;
const RUN_KIND_LABELS: Record<string, string> = {
  all: "all",
  workflow: "workflow",
  "run-agent": "agent",
  "run-session": "session",
  "custom-node": "node",
  inject: "inject",
  distill: "distill",
};

const runs = ref<RunRecord[]>([]);
const runFilter = ref("");
const runStatusFilter = ref<"all" | "running" | "done" | "error" | "cancelled">("all");
const runKindFilter = ref<(typeof RUN_KINDS)[number]>("all");
const runsNow = ref(Date.now());
let runsTimer: ReturnType<typeof setInterval> | undefined;
let runsTickTimer: ReturnType<typeof setInterval> | undefined;

const runPickedId = ref<string>();
const runTab = ref<"info" | "logs" | "transcript">("info");
const runLogs = ref<Array<{ ts: number; lane: string; line: string }>>([]);
const runLogsBusy = ref(false);

const sorts = reactive<Record<string, { key: string; dir: 1 | -1 }>>({});

function sortBy(table: string, key: string): void {
  const cur = sorts[table];
  if (cur && cur.key === key) cur.dir = (cur.dir * -1) as 1 | -1;
  else sorts[table] = { key, dir: -1 };
}

function arrow(table: string, key: string): string {
  const cur = sorts[table];
  if (!cur || cur.key !== key) return "";
  return cur.dir === -1 ? " ▾" : " ▴";
}

function applySort<T>(
  table: string,
  rows: T[],
  sel: Record<string, (r: T) => number | string>,
  defKey: string,
): T[] {
  const cur = sorts[table] ?? { key: defKey, dir: -1 as const };
  const f = sel[cur.key];
  if (!f) return rows;
  return [...rows].sort((a, b) => {
    const va = f(a);
    const vb = f(b);
    const c =
      typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
    return c * cur.dir;
  });
}

function graphLabel(id: string): string {
  return props.graphs.find((g) => g.id === id)?.name ?? id;
}

function emitRunningCount(): void {
  const n = runs.value.filter((j) => j.status === "running").length;
  emit("running-count", n || "");
}

async function loadRuns(): Promise<void> {
  try {
    runs.value = (await (await fetch("/api/jobs")).json()) as RunRecord[];
    emitRunningCount();
    maybeOpenJobFromQuery();
  } catch {
    // server offline
  }
}

function maybeOpenJobFromQuery(): void {
  const id = route.query.job;
  if (typeof id !== "string" || !id) return;
  if (runPickedId.value === id) return;
  const j = runs.value.find((r) => r.id === id);
  if (j) {
    runPickedId.value = undefined;
    pickRun(j);
  }
}

const RUNS_SEL: Record<string, (j: RunRecord) => number | string> = {
  label: (j) => j.label ?? j.id,
  graph: (j) => graphLabel(j.graphId ?? ""),
  kind: (j) => j.kind,
  status: (j) => j.status,
  started: (j) => j.createdAt,
  duration: (j) => (j.finishedAt ?? runsNow.value) - j.createdAt,
};

const filteredRuns = computed(() => {
  const q = runFilter.value.toLowerCase();
  const rows = runs.value.filter(
    (j) =>
      (runStatusFilter.value === "all" || j.status === runStatusFilter.value) &&
      (runKindFilter.value === "all" || j.kind === runKindFilter.value) &&
      (!q ||
        j.label?.toLowerCase().includes(q) ||
        j.kind.includes(q) ||
        j.graphId?.toLowerCase().includes(q) ||
        graphLabel(j.graphId ?? "").toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q) ||
        j.error?.toLowerCase().includes(q)),
  );
  return applySort("runs", rows, RUNS_SEL, "started");
});

function runSession(j: RunRecord) {
  return j.result?.inject;
}

function pickRun(j: RunRecord): void {
  if (runPickedId.value === j.id) {
    runPickedId.value = undefined;
    void router.replace({ query: { ...route.query, job: undefined } });
    return;
  }
  openRunDetail(j, j.status === "running" || !runSession(j) ? "logs" : "info");
}

function openRunDetail(j: RunRecord, tab: "info" | "logs" | "transcript"): void {
  runPickedId.value = j.id;
  runTab.value = tab;
  runLogs.value = [];
  runLogsBusy.value = true;
  if (route.query.job !== j.id) {
    void router.replace({ query: { ...route.query, view: "runs", job: j.id } });
  }
  void fetch(`/api/jobs/${j.id}/logs`)
    .then((r) => (r.ok ? r.json() : { lines: [] }))
    .then((b) => {
      runLogs.value = (b as { lines: typeof runLogs.value }).lines;
    })
    .catch(() => undefined)
    .finally(() => {
      runLogsBusy.value = false;
    });
}

function logTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function runSessionRef(j: RunRecord): SessionRef | undefined {
  const s = runSession(j);
  return s ? sessions.find(s.provider, s.newSessionId) : undefined;
}

function runTok(j: RunRecord, key: "tokensIn" | "tokensOut"): string {
  const ref = runSessionRef(j);
  const n = ref?.[key];
  return fmtTokens(n, { estimate: isTokenEstimate(ref?.meta) });
}

function openRunSession(j: RunRecord): void {
  const s = runSession(j);
  if (!s) return;
  const session =
    runSessionRef(j) ??
    ({
      provider: s.provider,
      id: s.newSessionId,
      projectDir: "",
      updatedAt: Date.now(),
      status: "unknown",
      kind: "session",
      meta: {},
    } as SessionRef);
  emit("open-session", session);
  void router.push({ path: "/", query: { view: "sessions" } });
}

function runInfoRows(j: RunRecord): Array<[string, string]> {
  const s = runSession(j);
  const rows: Array<[string, string]> = [
    ["job id", j.id],
    ["workflow", j.graphId ? `${graphLabel(j.graphId)} · ${j.graphId}` : "—"],
    ["kind", RUN_KIND_LABELS[j.kind] ?? j.kind],
    ["label", j.label ?? "—"],
    ["status", j.status],
    ["started", new Date(j.createdAt).toLocaleString()],
    ["finished", j.finishedAt ? new Date(j.finishedAt).toLocaleString() : "—"],
    ["duration", runDuration(j)],
  ];
  if (s) {
    rows.push(["result session", `${s.provider} · ${s.newSessionId}`]);
    const ref = runSessionRef(j);
    if (ref?.tokensIn != null || ref?.tokensOut != null) {
      rows.push(["tokens in", runTok(j, "tokensIn")]);
      rows.push(["tokens out", runTok(j, "tokensOut")]);
    }
  }
  return rows;
}

function runDuration(j: RunRecord): string {
  const end = j.finishedAt ?? (j.status === "running" ? runsNow.value : j.createdAt);
  const ms = Math.max(0, end - j.createdAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

async function cancelRun(id: string): Promise<void> {
  await api.cancelJob(id).catch(() => undefined);
  await loadRuns();
}

let unsub: (() => void) | undefined;

onMounted(() => {
  void loadRuns();
  runsTimer = setInterval(() => void loadRuns(), 5_000);
  runsTickTimer = setInterval(() => {
    runsNow.value = Date.now();
  }, 1_000);
  maybeOpenJobFromQuery();
  unsub = subscribeEvents((ev) => {
    if (ev.type === "job.log") {
      if (runPickedId.value === ev.jobId && runTab.value === "logs") {
        runLogs.value.push({
          ts: Date.now(),
          lane: ev.lane,
          line: ev.line,
        });
        // cap like GraphEditor's LOG_CAP — a multi-hour run watched live
        // would otherwise grow this without bound
        if (runLogs.value.length > 1000) {
          runLogs.value.splice(0, runLogs.value.length - 1000);
        }
      }
      return;
    }
    if (ev.type === "job.done" || ev.type === "job.error" || ev.type === "job.progress") {
      void loadRuns();
    }
  });
});

onUnmounted(() => {
  clearInterval(runsTimer);
  clearInterval(runsTickTimer);
  unsub?.();
});

watch(
  () => route.query.job,
  () => {
    maybeOpenJobFromQuery();
  },
);
</script>

<style scoped>
.search-expand {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--panel-bg);
  margin: -4px 0 12px;
  overflow: hidden;
}
.search-expand-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-bg-raised);
}
.search-expand-spacer {
  flex: 1;
}
.search-expand-body {
  max-height: 62vh;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.search-expand-body > .transcript {
  flex: 1;
  min-height: 0;
  max-height: 62vh;
}
:deep(.vsc-btn.toggled) {
  color: var(--text);
  border-color: var(--text-faint);
  background: var(--node-bg-hover);
}
.cols-runs .stat-cols,
.cols-runs .stat-row {
  grid-template-columns: var(--cols);
}
.cols-runs .stat-cols > span:nth-child(1),
.cols-runs .stat-cols > span:nth-child(2),
.cols-runs .stat-cols > span:nth-child(3),
.cols-runs .stat-cols > span:nth-child(4),
.cols-runs .stat-cols > span:nth-child(7) {
  text-align: left;
}
.cols-runs .stat-cols > span:nth-child(5),
.cols-runs .stat-cols > span:nth-child(6) {
  text-align: right;
}
.cols-runs .stat-row > .stat-name,
.cols-runs .stat-row > .run-graph {
  text-align: left;
  justify-self: stretch;
}
.cols-runs .stat-row > .run-kind,
.cols-runs .stat-row > .run-status {
  text-align: left;
  justify-self: start;
}
.run-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.run-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.run-kind-select {
  width: auto;
  min-width: 8.5rem;
  height: 30px;
  font-size: var(--fs-xs);
  font-family: var(--mono);
}
.run-kind {
  display: inline-block;
  font-size: var(--fs-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  line-height: 1.2;
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-kind.kind-workflow {
  color: var(--text-dim);
}
.run-kind.kind-run-agent,
.run-kind.kind-run-session {
  color: var(--lane-session);
  border-color: rgba(95, 159, 232, 0.35);
}
.run-kind.kind-inject,
.run-kind.kind-distill {
  color: var(--context);
  border-color: rgba(207, 169, 60, 0.35);
}
.run-kind.kind-custom-node {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.run-acts {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 1px;
  min-width: 0;
}
.run-graph {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.run-graph-link {
  color: var(--text-dim);
  text-decoration: none;
}
.run-graph-link:hover {
  color: var(--accent);
}
.run-status {
  display: inline-block;
  font-size: var(--fs-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  line-height: 1.2;
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-status.running {
  color: var(--status-running);
  border-color: color-mix(in srgb, var(--status-running) 40%, transparent);
}
.run-status.done {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.run-status.error {
  color: var(--status-error);
  border-color: color-mix(in srgb, var(--status-error) 40%, transparent);
}
.run-status.cancelled {
  color: var(--status-waiting);
  border-color: color-mix(in srgb, var(--status-waiting) 40%, transparent);
}
.run-empty {
  padding: 14px 16px;
}
.run-row {
  cursor: pointer;
}
.run-row.picked {
  background: var(--panel-bg-raised);
  box-shadow: none;
}
.run-logs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  max-height: 420px;
  overflow-y: auto;
  font-size: var(--fs-xs);
}
.run-log-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  line-height: 1.5;
}
.rl-ts {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.rl-lane {
  flex-shrink: 0;
  width: 62px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.rl-lane-stderr,
.rl-lane-error {
  color: var(--status-error);
}
.rl-lane-agent,
.rl-lane-assistant,
.rl-lane-result {
  color: var(--lane-session);
}
.rl-lane-tool {
  color: var(--status-waiting);
}
.rl-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dim);
  min-width: 0;
}
.run-info {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.run-kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px 16px;
  font-size: var(--fs-xs);
}
.run-key {
  color: var(--text-faint);
}
.run-val {
  color: var(--text-dim);
  word-break: break-word;
}
.run-info-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--status-error);
  border-radius: var(--radius-sm);
  color: var(--status-error);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
