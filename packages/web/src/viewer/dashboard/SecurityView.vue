<template>
  <header class="dash-head">
    <div>
      <h1 class="dash-title">Security</h1>
    </div>
  </header>

  <div class="micro-label stat-section">elevated permission modes</div>
  <div v-if="!permissionSessions.length" class="stat-note">
    no sessions with non-default permission modes
  </div>
  <div
    v-else
    class="stat-table"
    v-col-resize="'sec-perm'"
    data-cols="minmax(0,1fr) 140px 120px 90px 40px"
  >
    <div class="stat-cols micro-label">
      <span>session</span><span>mode</span><span>project</span><span>updated</span><span />
    </div>
    <div v-for="s in permissionSessions" :key="s.id" class="stat-row">
      <span class="stat-name">{{ s.title ?? shortId(s.id) }}</span>
      <span
        class="stat-val"
        :style="{
          color:
            permMode(s) === 'bypassPermissions'
              ? 'var(--status-error)'
              : 'var(--status-waiting)',
        }"
        >{{ permMode(s) }}</span
      >
      <span class="stat-val">{{ shortDir(s.projectDir) }}</span>
      <span class="stat-val">{{ relativeTime(s.updatedAt) }}</span>
      <span />
    </div>
  </div>

  <div class="micro-label stat-section">agent-def elevated settings</div>
  <div class="dash-load-host">
    <GraphLoadingOverlay
      :loading="agentsLoading"
      label="Scanning workflows"
    />
    <div v-if="!agentsLoading && !elevatedAgents.length" class="stat-note">
      no agent-def nodes with non-default permission / sandbox settings
    </div>
    <div
      v-else-if="!agentsLoading"
      class="stat-table"
      v-col-resize="'sec-agents'"
      data-cols="minmax(0,1fr) 100px 140px 120px 40px"
    >
      <div class="stat-cols micro-label">
        <span>agent</span><span>provider</span><span>setting</span><span>workflow</span><span />
      </div>
      <div v-for="(a, i) in elevatedAgents" :key="i" class="stat-row">
        <span class="stat-name">{{ a.name }}</span>
        <span class="stat-val">{{ a.provider }}</span>
        <span
          class="stat-val"
          :style="{
            color: a.elevated ? 'var(--status-error)' : 'var(--status-waiting)',
          }"
          >{{ a.setting }}</span
        >
        <span class="stat-val" :title="a.graphName">{{ a.graphName }}</span>
        <span />
      </div>
    </div>
  </div>

  <div class="micro-label stat-section">live sessions</div>
  <div v-if="!liveSessions.length" class="stat-note">none live</div>
  <div
    v-else
    class="stat-table"
    v-col-resize="'sec-live'"
    data-cols="minmax(0,1fr) 80px 120px 120px 40px"
  >
    <div class="stat-cols micro-label">
      <span>session</span><span>status</span><span>project</span><span>agent</span><span />
    </div>
    <div v-for="s in liveSessions" :key="s.id" class="stat-row">
      <span class="stat-name">
        <span class="status-dot" :class="s.status" />
        {{ s.title ?? shortId(s.id) }}
      </span>
      <span class="stat-val">{{ s.status }}</span>
      <span class="stat-val">{{ shortDir(s.projectDir) }}</span>
      <span class="stat-val">{{ s.agent ?? "—" }}</span>
      <span />
    </div>
  </div>

  <p class="stat-note sec-foot">
    binds 127.0.0.1 · read-only agent stores ·
    <button type="button" class="sec-doc-link" @click="onOpenSecurityDocs">
      docs/security.md
    </button>
  </p>
  <ConfirmModal v-model="docsDlg" @confirm="openSecurityDocs" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { SessionRef } from "@threadle/shared";
import { isSessionLive } from "@threadle/shared";
import { relativeTime, shortId } from "@ui/lib/format";
import { vColResize } from "@ui/lib/colResize";
import { useSessionsStore } from "@ui/stores/sessions";
import ConfirmModal, { type ConfirmModel } from "@ui/panels/ConfirmModal.vue";
import GraphLoadingOverlay from "@ui/components/GraphLoadingOverlay.vue";
import "@ui/theme/chrome.css";

const SECURITY_DOCS_URL =
  "https://github.com/threadle-sh/threadle/blob/main/docs/security.md";

const sessions = useSessionsStore();
const agentsLoading = ref(true);
const elevatedAgents = ref<
  Array<{
    name: string;
    provider: string;
    setting: string;
    graphName: string;
    elevated: boolean;
  }>
>([]);
const docsDlg = ref<ConfirmModel>();

function onOpenSecurityDocs(): void {
  docsDlg.value = {
    title: "Open security docs",
    emphasis: "docs/security.md",
    body: " — leave threadle and open this page on GitHub?",
    detail: SECURITY_DOCS_URL,
    confirmLabel: "Open",
    cancelLabel: "Cancel",
  };
}

function openSecurityDocs(): void {
  window.open(SECURITY_DOCS_URL, "_blank", "noopener,noreferrer");
}

function permMode(s: SessionRef): string {
  return typeof s.meta?.permissionMode === "string" ? s.meta.permissionMode : "";
}

const permissionSessions = computed(() =>
  sessions.sessions.filter((s) => {
    const m = permMode(s);
    return m && m !== "default";
  }),
);

const liveSessions = computed(() =>
  sessions.sessions.filter((s) => isSessionLive(s.status)),
);

function shortDir(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : dir;
}

/** Elevated agent nodes in saved workflows (computed by the workflows server). */
async function scanAgentDefs(): Promise<void> {
  agentsLoading.value = true;
  try {
    const res = await fetch("/api/graphs/elevated-agents");
    elevatedAgents.value = res.ok ? ((await res.json()) as typeof elevatedAgents.value) : [];
  } catch {
    elevatedAgents.value = [];
  } finally {
    agentsLoading.value = false;
  }
}

onMounted(() => {
  void scanAgentDefs();
});
</script>

<style scoped>
.sec-foot {
  margin-top: 28px;
}
.sec-doc-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.sec-doc-link:hover {
  color: var(--text);
}
</style>
