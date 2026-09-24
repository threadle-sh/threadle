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
import type { AgentDefNodeData, SessionRef } from "@threadle/shared";
import { isSessionLive } from "@threadle/shared";
import { relativeTime, shortId } from "@/lib/format";
import { vColResize } from "@/lib/colResize";
import { api } from "@/api/client";
import { useSessionsStore } from "@/stores/sessions";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import "./chrome.css";

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

function agentElevatedSetting(d: AgentDefNodeData): { setting: string; elevated: boolean } | null {
  if (d.permissionMode && d.permissionMode !== "default") {
    return {
      setting: `perm ${d.permissionMode}`,
      elevated: d.permissionMode === "bypassPermissions",
    };
  }
  if (d.sandbox && d.sandbox !== "workspace-write") {
    return {
      setting: `sandbox ${d.sandbox}`,
      elevated: d.sandbox === "danger-full-access",
    };
  }
  if (d.askForApproval && d.askForApproval !== "never") {
    return { setting: `ask ${d.askForApproval}`, elevated: false };
  }
  return null;
}

async function scanAgentDefs(): Promise<void> {
  agentsLoading.value = true;
  try {
    const summaries = await api.graphs();
    const rows: typeof elevatedAgents.value = [];
    await Promise.all(
      summaries.slice(0, 80).map(async (s) => {
        try {
          const g = await api.graph(s.id);
          for (const n of g.nodes) {
            if (n.data.type !== "agent-def") continue;
            const hit = agentElevatedSetting(n.data);
            if (!hit) continue;
            rows.push({
              name: n.data.label || n.data.ref.name,
              provider: n.data.ref.provider,
              setting: hit.setting,
              graphName: g.name,
              elevated: hit.elevated,
            });
          }
        } catch {
          // skip unloadable graphs
        }
      }),
    );
    rows.sort((a, b) => a.graphName.localeCompare(b.graphName) || a.name.localeCompare(b.name));
    elevatedAgents.value = rows;
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
