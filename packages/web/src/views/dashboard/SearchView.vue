<template>
  <div class="search-page">
    <div class="search-chrome">
      <header class="dash-head">
        <div>
          <h1 class="dash-title">Search</h1>
        </div>
        <div class="view-controls">
          <ProviderFilterChips
            v-model="searchProviderF"
            :options="searchFilterChips"
          />
        </div>
      </header>

      <div class="dash-toolbar search-toolbar">
        <input
          v-model="searchQuery"
          class="threadle-input search-query"
          placeholder="which session discussed …"
          spellcheck="false"
          autofocus
        />
        <div class="chip-row">
          <button
            v-for="tf in ['all', 'transcript', 'context'] as const"
            :key="tf"
            class="filter-chip"
            :class="{ active: searchTypeF === tf }"
            @click="searchTypeF = tf"
          >
            {{ tf }}
          </button>
        </div>
        <div class="chip-row">
          <button
            v-for="rf in ['all', 'input', 'output'] as const"
            :key="rf"
            class="filter-chip"
            :class="{ active: searchRoleF === rf }"
            @click="searchRoleF = rf"
          >
            {{ rf }}
          </button>
        </div>
      </div>
    </div>

  <div class="dash-load-host">
    <GraphLoadingOverlay
      :loading="searchBusy"
      label="Searching"
    />
    <p v-if="!searchBusy && searchQuery.trim() && searchDone && !searchHits.length" class="stat-note">
      no matches
    </p>
    <p
      v-else-if="!searchBusy && searchQuery.trim() && searchDone && searchHits.length"
      class="stat-note search-hit-count"
    >
      {{ searchHits.length }} hit{{ searchHits.length === 1 ? "" : "s" }}
    </p>

    <template v-if="!searchBusy">
    <template v-for="(h, i) in searchHits" :key="i">
    <div
      class="search-hit"
      :class="{ picked: searchPickedIdx === i }"
      @click="openHit(h, i)"
    >
      <div class="search-hit-head">
        <span
          class="prov-dot"
          :style="{
            background:
              h.docType === 'payload'
                ? 'var(--context)'
                : providerColor(h.provider),
          }"
        />
        <span class="search-hit-title">{{ hitTitle(h) }}</span>
        <span v-if="h.role" class="op-badge">{{ h.role }}</span>
        <span v-if="h.docType === 'payload'" class="op-badge rule-skill">{{
          h.extra?.kind ?? "payload"
        }}</span>
        <span class="search-hit-time micro-label">{{
          h.ts ? relativeTime(h.ts) : ""
        }}</span>
      </div>
      <div class="search-hit-snippet" v-html="renderSnippet(h.snippet)" />
    </div>

    <div v-if="searchPickedIdx === i && searchPicked" class="search-expand" @click.stop>
      <div class="search-expand-bar">
        <button
          class="vsc-btn"
          :class="{ toggled: searchTab === 'info' }"
          @click="searchTab = 'info'"
        >
          info
        </button>
        <button
          class="vsc-btn"
          :class="{ toggled: searchTab === 'transcript' }"
          @click="searchTab = 'transcript'"
        >
          ≡ transcript
        </button>
        <span class="search-expand-spacer" />
        <button
          class="vsc-btn"
          title="Open the session blueprint (nodes for tools, skills, subagents, files)"
          @click="router.push(`/blueprint/${searchPicked.provider}/${searchPicked.sessionId}`)"
        >
          ⌗ blueprint
        </button>
        <button
          v-if="searchPickedRef"
          class="vsc-btn"
          title="Seed a workflow with this session as a node"
          @click="sessionToWorkflow(searchPickedRef)"
        >
          → workflow
        </button>
        <button class="vsc-btn" @click="searchPicked = undefined; searchPickedIdx = undefined; searchFocus = undefined">✕</button>
      </div>
      <div class="search-expand-body">
        <TranscriptView
          v-if="searchTab === 'transcript'"
          :provider="searchPicked.provider"
          :session-id="searchPicked.sessionId"
          :focus-message-id="searchFocus?.messageId"
          :focus-ts="searchFocus?.ts"
          :focus-role="searchFocus?.role"
        />
        <SessionInfoPanel
          v-else
          class="search-expand-info"
          :provider="searchPicked.provider"
          :session-id="searchPicked.sessionId"
        />
      </div>
    </div>
  </template>
  </template>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { SessionRef } from "@threadle/shared";
import { relativeTime, shortId } from "@/lib/format";
import {
  type SearchFilter,
  providerColor,
} from "@/lib/providers";
import { sessionsToWorkflow } from "@/lib/convert";
import { useSessionsStore } from "@/stores/sessions";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import SessionInfoPanel from "@/panels/SessionInfoPanel.vue";
import TranscriptView from "@/panels/TranscriptView.vue";
import "./chrome.css";

interface SearchHit {
  docType: "message" | "payload";
  provider: string;
  sessionId: string;
  role?: string;
  ts?: number;
  snippet: string;
  messageId?: string;
  extra?: { kind?: string; sourceProvider?: string; sourceSessionId?: string };
}

const router = useRouter();
const sessions = useSessionsStore();

const searchQuery = ref("");
const searchHits = ref<SearchHit[]>([]);
const searchBusy = ref(false);
const searchDone = ref(false);
const searchProviderF = ref<SearchFilter>("all");
const searchTypeF = ref<"all" | "transcript" | "context">("all");
const searchRoleF = ref<"all" | "input" | "output">("all");
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const searchFilterChips = computed(() => {
  const chips = [...sessions.searchFilterChips];
  if (
    searchProviderF.value !== "all" &&
    searchProviderF.value !== "payload" &&
    !chips.includes(searchProviderF.value)
  ) {
    chips.push(searchProviderF.value);
  }
  return chips;
});
watch(searchFilterChips, (chips) => {
  if (!chips.includes(searchProviderF.value)) searchProviderF.value = "all";
});

watch([searchQuery, searchProviderF, searchTypeF, searchRoleF], ([q]) => {
  clearTimeout(searchTimer);
  searchDone.value = false;
  if (!q.trim()) {
    searchHits.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    searchBusy.value = true;
    try {
      const params = new URLSearchParams({ q });
      if (searchProviderF.value !== "all") params.set("provider", searchProviderF.value);
      if (searchTypeF.value !== "all") {
        params.set("doctype", searchTypeF.value === "context" ? "payload" : "message");
      }
      if (searchRoleF.value !== "all") {
        params.set("role", searchRoleF.value === "input" ? "user" : "assistant");
      }
      const res = await fetch(`/api/search?${params}`);
      searchHits.value = ((await res.json()) as { results: SearchHit[] }).results;
    } catch {
      searchHits.value = [];
    } finally {
      searchBusy.value = false;
      searchDone.value = true;
    }
  }, 300);
});

function hitTitle(h: SearchHit): string {
  if (h.docType === "payload") {
    const src = h.extra?.sourceSessionId
      ? sessions.find(h.extra.sourceProvider ?? "", h.extra.sourceSessionId)
      : undefined;
    return `context payload · from ${src?.title ?? shortId(h.extra?.sourceSessionId ?? "?")}`;
  }
  return sessions.find(h.provider, h.sessionId)?.title ?? shortId(h.sessionId);
}

const searchPicked = ref<{ provider: string; sessionId: string }>();
const searchPickedIdx = ref<number>();
const searchTab = ref<"info" | "transcript">("transcript");
const searchFocus = ref<{ messageId?: string; ts?: number; role?: string }>();

function hitSession(h: SearchHit): { provider: string; sessionId: string } | undefined {
  if (h.docType === "payload") {
    return h.extra?.sourceSessionId
      ? { provider: h.extra.sourceProvider ?? "claude-code", sessionId: h.extra.sourceSessionId }
      : undefined;
  }
  return { provider: h.provider, sessionId: h.sessionId };
}

function openHit(h: SearchHit, idx: number): void {
  const target = hitSession(h);
  if (!target) return;
  searchTab.value = "transcript";
  if (searchPickedIdx.value === idx) {
    searchPickedIdx.value = undefined;
    searchPicked.value = undefined;
    searchFocus.value = undefined;
  } else {
    searchPickedIdx.value = idx;
    searchPicked.value = target;
    searchFocus.value =
      h.docType === "message"
        ? { messageId: h.messageId, ts: h.ts, role: h.role }
        : undefined;
  }
}

const searchPickedRef = computed(() =>
  searchPicked.value
    ? sessions.find(searchPicked.value.provider, searchPicked.value.sessionId)
    : undefined,
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderSnippet(snip: string): string {
  return escapeHtml(snip)
    .replaceAll("⟪", '<mark class="search-mark">')
    .replaceAll("⟫", "</mark>");
}

async function sessionToWorkflow(s: SessionRef): Promise<void> {
  try {
    const id = await sessionsToWorkflow(
      `${s.title ?? shortId(s.id)} (from session)`,
      [s],
    );
    await router.push(`/graph/${id}`);
  } catch (err) {
    alert(`Convert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
</script>

<style scoped>
.search-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.search-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.search-query {
  flex: 1 1 16rem;
  min-width: 12rem;
  max-width: none;
}
.search-hit-count {
  margin-top: -8px;
}
.search-hit.picked {
  background: var(--panel-bg-raised);
  border-color: var(--border-strong);
}
.search-hit {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s;
}
.search-hit:hover:not(.picked) {
  background: var(--hover-overlay);
  border-color: var(--border-strong);
}
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
.search-expand-info {
  padding: 12px 16px 6px;
  max-width: 760px;
  overflow-y: auto;
  max-height: 62vh;
}
.vsc-btn.toggled {
  color: var(--text);
  border-color: var(--text-faint);
  background: var(--node-bg-hover);
}
.search-transcript {
  margin: 0 -16px;
}
.search-hit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.search-hit-title {
  font-size: var(--fs-md);
  font-weight: 600;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.search-hit-time {
  margin-left: auto;
  flex-shrink: 0;
}
.search-hit-snippet {
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.5;
  word-break: break-word;
}
.search-hit-snippet :deep(.search-mark) {
  background: rgba(95, 159, 232, 0.22);
  color: var(--text);
  border-radius: 2px;
  padding: 0 2px;
}
</style>
