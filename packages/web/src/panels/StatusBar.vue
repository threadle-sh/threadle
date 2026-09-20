<template>
  <footer
    class="status-bar mono"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <span v-if="status" class="sb-item sb-status">{{ status }}</span>
    <span
      v-if="activeLine"
      class="sb-item sb-active"
      :title="activeTitle"
    >● {{ activeLine }}</span>
    <span class="sb-spacer" />
    <span
      class="sb-item"
      :class="{ live: runningSessions > 0 }"
    >❯ {{ runningSessions }} live</span>
    <span class="sb-item" :class="{ live: runningJobs > 0 }">
      ◷ {{ runningJobs }} running
    </span>
    <span class="sb-item">⟨/⟩ {{ agentCount }} agents</span>
    <span
      class="sb-item"
      :class="{ warn: servicesUp < servicesTotal }"
    >⏻ {{ servicesUp }}/{{ servicesTotal }}</span>
    <span class="sb-item">▦ {{ fmtMem(mem) }}</span>

    <div v-if="hintOpen" class="sb-hint" role="tooltip">
      <div class="sb-hint-col">
        <div class="micro-label sb-hint-h">sessions</div>
        <div class="sb-kv">
          <span>running</span><span class="num" :class="{ hot: statusCounts.running }">{{ statusCounts.running }}</span>
          <span>waiting</span><span class="num" :class="{ wait: statusCounts.waiting }">{{ statusCounts.waiting }}</span>
          <span>live</span><span class="num">{{ statusCounts.live }}</span>
          <span>total</span><span class="num">{{ sessions.sessions.length }}</span>
        </div>
        <div v-if="liveByProvider.length" class="sb-hint-sub micro-label">by provider</div>
        <div v-if="liveByProvider.length" class="sb-kv">
          <template v-for="row in liveByProvider" :key="row.id">
            <span>{{ row.label }}</span><span class="num">{{ row.count }}</span>
          </template>
        </div>
      </div>

      <div class="sb-hint-col">
        <div class="micro-label sb-hint-h">services</div>
        <div v-if="usedProviders.length" class="sb-kv">
          <template v-for="p in usedProviders" :key="p.id">
            <span>{{ providerShort(p.id) }}</span>
            <span class="num" :class="p.available ? 'ok' : 'bad'">{{
              p.available ? "up" : "down"
            }}</span>
          </template>
        </div>
        <p v-else class="sb-hint-empty">no services used yet</p>
        <div class="sb-hint-sub micro-label">server</div>
        <div class="sb-kv">
          <span>memory</span><span class="num">{{ fmtMem(mem) }}</span>
          <span>uptime</span><span class="num">{{ fmtUptime(uptime) }}</span>
          <span>jobs</span><span class="num" :class="{ hot: runningJobs }">{{ runningJobs }}</span>
          <span>agents</span><span class="num">{{ agentCount }}</span>
        </div>
      </div>

      <div v-if="activeRunning?.length || activeQueued?.length" class="sb-hint-col">
        <div class="micro-label sb-hint-h">workflow</div>
        <div v-if="activeRunning?.length" class="sb-list">
          <div class="sb-hint-sub micro-label">running</div>
          <div v-for="n in activeRunning" :key="'r-' + n" class="sb-line hot">● {{ n }}</div>
        </div>
        <div v-if="activeQueued?.length" class="sb-list">
          <div class="sb-hint-sub micro-label">queued</div>
          <div v-for="n in activeQueued" :key="'q-' + n" class="sb-line">◦ {{ n }}</div>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { isSessionLive } from "@threadle/shared";
import { useSessionsStore } from "@/stores/sessions";
import { providerShort } from "@/lib/providers";

const props = defineProps<{
  /** context line from the host view, e.g. the editor's save state */
  status?: string;
  /** labels of nodes currently executing on this graph */
  activeRunning?: string[];
  /** labels of nodes waiting for their turn */
  activeQueued?: string[];
}>();

const sessions = useSessionsStore();

const mem = ref(0);
const uptime = ref(0);
const runningJobs = ref(0);
const hintOpen = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let hintTimer: ReturnType<typeof setTimeout> | undefined;

const runningSessions = computed(
  () => sessions.sessions.filter((s) => isSessionLive(s.status)).length,
);
const agentCount = computed(() => sessions.agents.length);

/** Providers that appear in session history — skip unused tools (e.g. grok never run). */
const usedProviders = computed(() => {
  const used = new Set(sessions.sessions.map((s) => s.provider));
  return sessions.providers.filter((p) => used.has(p.id));
});
const servicesUp = computed(() => usedProviders.value.filter((p) => p.available).length);
const servicesTotal = computed(() => usedProviders.value.length);

const statusCounts = computed(() => {
  let running = 0;
  let waiting = 0;
  let live = 0;
  for (const s of sessions.sessions) {
    if (s.status === "running") running += 1;
    else if (s.status === "waiting") waiting += 1;
    else if (s.status === "live") live += 1;
  }
  return { running, waiting, live };
});

const liveByProvider = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sessions.sessions) {
    if (!isSessionLive(s.status)) continue;
    counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: providerShort(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

const activeLine = computed(() => {
  const run = props.activeRunning ?? [];
  const queued = props.activeQueued ?? [];
  if (!run.length && !queued.length) return "";
  if (run.length === 1 && !queued.length) return run[0];
  if (run.length === 1) return `${run[0]} · ${queued.length} queued`;
  if (run.length > 1) {
    const names = run.slice(0, 3).join(", ");
    const more = run.length > 3 ? ` +${run.length - 3}` : "";
    const q = queued.length ? ` · ${queued.length} queued` : "";
    return `${run.length} active: ${names}${more}${q}`;
  }
  return `${queued.length} queued`;
});

const activeTitle = computed(() => {
  const run = props.activeRunning ?? [];
  const queued = props.activeQueued ?? [];
  const parts: string[] = [];
  if (run.length) parts.push(`running: ${run.join(", ")}`);
  if (queued.length) parts.push(`queued: ${queued.join(", ")}`);
  return parts.join(" · ") || "no active nodes";
});

function onEnter(): void {
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintOpen.value = true;
  }, 280);
}

function onLeave(): void {
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintOpen.value = false;
  }, 120);
}

async function poll(): Promise<void> {
  try {
    const h = (await (await fetch("/api/health")).json()) as { mem?: number; uptime?: number };
    mem.value = h.mem ?? 0;
    uptime.value = h.uptime ?? 0;
  } catch {
    // server unreachable — keep last values
  }
  try {
    const jobs = (await (await fetch("/api/jobs")).json()) as Array<{ status: string }>;
    runningJobs.value = jobs.filter((j) => j.status === "running").length;
  } catch {
    // ignore
  }
}

function fmtMem(n: number): string {
  if (!n) return "—";
  return n >= 1_073_741_824 ? `${(n / 1_073_741_824).toFixed(1)} GB` : `${Math.round(n / 1_048_576)} MB`;
}

function fmtUptime(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m`;
  return `${sec}s`;
}

onMounted(() => {
  if (!sessions.sessions.length) sessions.ensureHydrated();
  void poll();
  timer = setInterval(() => void poll(), 5000);
});
onUnmounted(() => {
  clearInterval(timer);
  if (hintTimer) clearTimeout(hintTimer);
});
</script>

<style scoped>
.status-bar {
  position: relative;
  margin-top: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 26px;
  padding: 0 14px;
  background: var(--panel-bg);
  border-top: 1px solid var(--border);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  user-select: none;
}
.sb-item {
  white-space: nowrap;
}
.sb-item.live {
  color: var(--status-running);
}
.sb-item.warn {
  color: var(--status-waiting);
}
.sb-status {
  color: var(--text-dim);
  min-width: 14rem; /* avoid layout jump when save state / active line toggle */
}
.sb-active {
  color: var(--status-running);
  max-width: min(42vw, 28rem);
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-spacer {
  flex: 1;
}

.sb-hint {
  position: absolute;
  right: 10px;
  bottom: calc(100% + 6px);
  z-index: 80;
  display: flex;
  gap: 18px;
  max-width: min(92vw, 560px);
  padding: 12px 14px;
  background: var(--panel-bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  pointer-events: none;
}
.sb-hint-col {
  min-width: 132px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-hint-h {
  color: var(--text-faint);
  margin-bottom: 2px;
}
.sb-hint-sub {
  color: var(--text-faint);
  margin-top: 6px;
}
.sb-hint-empty {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.sb-kv {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 14px;
  align-items: baseline;
}
.sb-kv > span:nth-child(odd) {
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-kv .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
.sb-kv .num.hot,
.sb-line.hot {
  color: var(--status-running);
}
.sb-kv .num.wait {
  color: var(--status-waiting);
}
.sb-kv .num.ok {
  color: var(--status-running);
}
.sb-kv .num.bad {
  color: var(--status-error);
}
.sb-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sb-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
</style>
