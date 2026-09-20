<template>
  <div class="svc-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Services</h1>
      </div>
      <div class="view-controls">
        <div class="chip-row">
          <button
            class="filter-chip"
            :class="{ active: !connectedOnly }"
            @click="connectedOnly = false"
          >
            all{{ providers.length ? ` · ${providers.length}` : "" }}
          </button>
          <button
            class="filter-chip"
            :class="{ active: connectedOnly }"
            :title="`only tools threadle can reach (${connectedCount})`"
            @click="connectedOnly = true"
          >
            ● connected{{ connectedCount ? ` · ${connectedCount}` : "" }}
          </button>
        </div>
      </div>
    </header>
    <div class="dash-toolbar svc-toolbar">
      <input
        v-model="svcFilter"
        class="threadle-input dash-search"
        placeholder="Filter services…"
        spellcheck="false"
      />
    </div>
  </div>
  <div class="svc-cards">
    <div v-for="p in visibleProviders" :key="p.id" class="svc-card">
      <div class="svc-head">
        <span class="prov-dot svc-dot" :style="{ background: providerColor(p.id) }" />
        <span class="svc-name mono">{{ providerServiceName(p.id) }}</span>
        <span
          class="svc-status mono"
          :class="p.available ? 'ok' : 'bad'"
        >{{ p.available ? "⏻ connected" : "✕ unavailable" }}</span>
      </div>
      <div class="run-kv mono svc-kv">
        <span class="run-key">version</span><span class="run-val">{{ p.version ?? "—" }}</span>
        <span class="run-key">storage</span
        ><span class="run-val file-path" :title="p.storage?.path">{{
          p.storage ? bidiPath(tildePath(p.storage.path)) : "—"
        }}</span>
        <span class="run-key">size</span
        ><span class="run-val">{{ p.storage ? fmtBytes(p.storage.bytes) + (p.storage.files > 1 ? ` · ${p.storage.files} files` : "") : "—" }}</span>
        <span class="run-key">sessions</span
        ><span class="run-val">
          {{ provSessions(p.id).length }}
          <em v-if="provLive(p.id)" class="svc-live">· {{ provLive(p.id) }} live</em>
          <em v-if="provRunning(p.id)" class="svc-live">· {{ provRunning(p.id) }} running</em>
        </span>
        <span class="run-key">agents</span
        ><span class="run-val">{{ sessions.agents.filter((a) => a.provider === p.id).length }}</span>
        <span class="run-key">models</span
        ><span class="run-val">{{ provModelCount(p.id) || "—" }}</span>
        <span class="run-key">last activity</span
        ><span class="run-val">{{ provLastActivity(p.id) }}</span>
      </div>
      <div class="sess-detail-actions">
        <button class="vsc-btn" @click="jumpToProviderSessions(p.id)">❯ sessions</button>
        <button class="vsc-btn" @click="emit('nav', 'usage')">◍ statistics</button>
        <button class="vsc-btn" @click="emit('nav', 'activity')">⊙ activity</button>
      </div>
    </div>
  </div>
  <p v-if="!visibleProviders.length" class="stat-note">
    {{
      svcFilter.trim()
        ? "no services match these filters"
        : connectedOnly
          ? "no connected services"
          : "no services discovered"
    }}
  </p>
  <p class="stat-note">
    Storage is read directly (transcripts / sqlite, read-only); runs and injections go
    through each tool's CLI or HTTP API. threadle's own server binds 127.0.0.1 only.
  </p>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ProviderInfo } from "@threadle/shared";
import { isSessionLive } from "@threadle/shared";
import { api } from "@/api/client";
import { bidiPath, relativeTime, tildePath } from "@/lib/format";
import { providerColor, providerServiceName } from "@/lib/providers";
import { useSessionsStore } from "@/stores/sessions";
import "./chrome.css";

const props = defineProps<{
  providers: ProviderInfo[];
}>();

const emit = defineEmits<{
  nav: [id: string];
  "set-provider-filter": [id: string];
}>();

const sessions = useSessionsStore();

/** Default to connected so unavailable tools stay out of the way. */
const connectedOnly = ref(true);
const svcFilter = ref("");

const connectedCount = computed(
  () => props.providers.filter((p) => p.available).length,
);

const visibleProviders = computed(() => {
  const q = svcFilter.value.trim().toLowerCase();
  return props.providers.filter((p) => {
    if (connectedOnly.value && !p.available) return false;
    if (!q) return true;
    return (
      p.id.toLowerCase().includes(q) ||
      providerServiceName(p.id).toLowerCase().includes(q) ||
      (p.version?.toLowerCase().includes(q) ?? false) ||
      (p.storage?.path.toLowerCase().includes(q) ?? false)
    );
  });
});

const svcModels = ref<Array<{ provider: string; id: string }>>([]);
let svcModelsLoaded = false;

async function loadSvcModels(): Promise<void> {
  if (svcModelsLoaded) return;
  svcModelsLoaded = true;
  try {
    svcModels.value = (await api.models()) as Array<{ provider: string; id: string }>;
  } catch {
    svcModels.value = [];
  }
}

onMounted(() => {
  void loadSvcModels();
});

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function provSessions(id: string) {
  return sessions.sessions.filter((s) => s.provider === id);
}
function provLive(id: string): number {
  return provSessions(id).filter((s) => isSessionLive(s.status)).length;
}
function provRunning(id: string): number {
  return provSessions(id).filter((s) => s.status === "running").length;
}
function provModelCount(id: string): number {
  return svcModels.value.filter((m) => m.provider === id).length;
}
function provLastActivity(id: string): string {
  const ts = Math.max(0, ...provSessions(id).map((s) => s.updatedAt));
  return ts ? relativeTime(ts) : "—";
}
function jumpToProviderSessions(id: string): void {
  emit("set-provider-filter", id);
  emit("nav", "sessions");
}
</script>

<style scoped>
.svc-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.svc-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.svc-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 14px;
}
.svc-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.svc-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.svc-dot {
  width: 10px;
  height: 10px;
}
.svc-name {
  font-size: var(--fs-lg);
  font-weight: 600;
  flex: 1;
}
.svc-status {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
}
.svc-status.ok {
  color: var(--status-running);
  border-color: rgba(74, 222, 128, 0.35);
}
.svc-status.bad {
  color: var(--status-error);
  border-color: var(--status-error);
}
.svc-kv {
  font-size: var(--fs-xs);
  flex: 1;
}
.svc-card > .sess-detail-actions {
  margin-top: auto;
}
.svc-live {
  font-style: normal;
  color: var(--status-running);
}
</style>
