<template>
  <div class="logs-page">
    <div class="logs-chrome">
      <header class="dash-head">
        <div>
          <h1 class="dash-title">Logs</h1>
        </div>
      </header>

      <div class="dash-toolbar logs-toolbar">
        <input
          v-model="logFilter"
          class="threadle-input dash-search"
          placeholder="Filter logs…"
          spellcheck="false"
        />
        <div class="chip-row">
          <button
            v-for="k in LOG_KINDS"
            :key="k"
            type="button"
            class="filter-chip"
            :class="{ active: logKindF === k }"
            @click="logKindF = k"
          >
            {{ LOG_KIND_LABELS[k] }}
          </button>
        </div>
      </div>
    </div>

    <div ref="logsShell" class="logs-shell mono">
      <GraphLoadingOverlay
        :loading="logsHydrating"
        label="Loading logs"
      />
      <template v-if="!logsHydrating">
      <div
        v-for="(l, i) in filteredLogs"
        :key="l.jobId + l.ts + i"
        class="log-row"
        :class="`lane-${l.lane}`"
      >
        <span class="log-ts">{{ fmtLogTs(l.ts) }}</span>
        <button
          class="log-job"
          :title="`${l.jobId} · ${l.kind} · ${l.status}` + (l.graphId ? ' · from a workflow' : '')"
          @click="openRunFromLog(l.jobId)"
        >
          {{ l.label ?? l.kind }}
        </button>
        <span class="log-line">{{ l.line }}</span>
      </div>
      <p v-if="!filteredLogs.length" class="stat-note inst-empty">
        {{ logsAll.length ? "nothing matches the filter" : "no log lines yet — run something" }}
      </p>
      </template>
    </div>
    <p class="stat-note logs-foot">
      last {{ logsAll.length }} lines across recent runs · refreshes every 5s · click a label to
      open Runs
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import "./chrome.css";

interface LogLine {
  ts: number;
  lane: string;
  line: string;
  jobId: string;
  kind: string;
  label?: string;
  graphId?: string;
  status: string;
}

const LOG_KINDS = [
  "all", "workflow", "run-agent", "run-session", "custom-node", "inject", "distill", "app",
] as const;
const LOG_KIND_LABELS: Record<string, string> = {
  all: "all",
  workflow: "workflow",
  "run-agent": "agent",
  "run-session": "session",
  "custom-node": "node",
  inject: "inject",
  distill: "distill",
  app: "app",
};

const router = useRouter();
const logsAll = ref<LogLine[]>([]);
/** First fetch only — keep lines visible during the 5s poll. */
const logsHydrating = ref(true);
const logFilter = ref("");
const logKindF = ref<(typeof LOG_KINDS)[number]>("all");
const logsShell = ref<HTMLElement>();
let logsTimer: ReturnType<typeof setInterval> | undefined;

const filteredLogs = computed(() => {
  const q = logFilter.value.toLowerCase();
  return logsAll.value.filter(
    (l) =>
      (logKindF.value === "all" || l.kind === logKindF.value) &&
      (!q ||
        l.line.toLowerCase().includes(q) ||
        (l.label ?? "").toLowerCase().includes(q) ||
        l.jobId.includes(q)),
  );
});

function fmtLogTs(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

async function loadLogs(): Promise<void> {
  const el = logsShell.value;
  const pinned = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  try {
    logsAll.value = (await (
      await fetch("/api/jobs/logs/all?limit=8000")
    ).json()) as LogLine[];
  } catch {
    // keep prior lines on poll failure
  } finally {
    logsHydrating.value = false;
  }
  if (pinned) {
    await nextTick();
    logsShell.value?.scrollTo({ top: logsShell.value.scrollHeight });
  }
}

function openRunFromLog(jobId: string): void {
  void router.replace({ query: { view: "runs", job: jobId } });
}

onMounted(() => {
  void loadLogs();
  logsTimer = setInterval(() => void loadLogs(), 5000);
});

onUnmounted(() => {
  clearInterval(logsTimer);
});
</script>

<style scoped>
.logs-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.logs-chrome {
  flex-shrink: 0;
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.logs-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.logs-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--input-bg);
  padding: 10px 0;
  overflow-y: auto;
  font-size: var(--fs-xs);
}
.logs-foot {
  flex-shrink: 0;
  margin: 10px 0 0;
}
.log-row {
  display: grid;
  grid-template-columns: 74px 170px minmax(0, 1fr);
  gap: 12px;
  padding: 2px 16px;
  align-items: baseline;
}
.log-row:hover {
  background: var(--node-bg);
}
.log-ts {
  color: var(--text-faint);
}
.log-job {
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  font: inherit;
  color: var(--text-dim);
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.log-job:hover {
  color: var(--text);
}
.log-line {
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}
.log-row.lane-stderr .log-line {
  color: var(--status-error);
}
.log-row.lane-meta .log-line,
.log-row.lane-raw .log-line {
  color: var(--text-faint);
}
</style>
