<template>
  <header class="topbar" :class="{ 'canvas-focus': canvasFocus }">
    <button
      class="back"
      :title="parentGraph ? 'Back to ' + parentGraph.name : 'Back to workflows'"
      @click="emit('back')"
    >
      ←
    </button>
    <template v-if="parentGraph">
      <button
        class="editor-crumb mono"
        :title="'Parent workflow: ' + parentGraph.name"
        @click="emit('back')"
      >
        ⌗ {{ parentGraph.name }}
      </button>
      <span class="editor-crumb-sep">/</span>
      <span class="editor-sub-badge mono">sub</span>
    </template>
    <div v-if="hasGraph" class="name-path">
      <template v-if="!parentGraph && nameCrumbs.length">
        <template v-for="(seg, i) in nameCrumbs" :key="i + '-' + seg">
          <span
            class="name-crumb mono"
            :class="{ pending: nameCrumbsPending }"
            :title="
              nameCrumbsPending
                ? `${seg} (folder — saved when you add a node)`
                : `folder · ${seg}`
            "
          ><FolderMark class="name-crumb-mark" :open="false" />{{ seg }}</span>
          <span class="editor-crumb-sep">/</span>
        </template>
      </template>
      <input
        :value="nameDraft"
        class="graph-name"
        spellcheck="false"
        title="Workflow name — type folder/ then the name. Short backspace edits a folder; long-press removes it."
        @focus="emit('name-focus')"
        @blur="emit('name-blur')"
        @keydown="emit('name-keydown', $event)"
        @keyup="emit('name-keyup', $event)"
        @input="emit('update:nameDraft', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <span
      v-if="hasGraph"
      class="kind-badge mono"
      :class="{ sub: graphKind === 'subgraph' }"
      :title="
        graphKind === 'subgraph'
          ? 'Subgraph (nestable) — right-click the tab to promote to a workflow'
          : 'Workflow — right-click the tab to convert to a subgraph'
      "
    >
      {{ graphKind === "subgraph" ? "subgraph" : "workflow" }}
    </span>
    <span v-if="saveState === 'error'" class="save-state error">Save failed</span>
    <div class="topbar-right">
      <span
        v-if="procTop"
        class="topbar-proc mono"
        :class="{ live: procTop.activeCustomRuns + procTop.runningJobs > 0 }"
        :title="`threadle server: ${procTop.cpuPct}% of one core · ${procTop.activeCustomRuns} custom-node child process(es) · ${procTop.runningJobs} agent job(s)`"
      >
        ▦ {{ procTop.cpuPct }}%
        <template v-if="procTop.activeCustomRuns + procTop.runningJobs > 0">
          · ⚙ {{ procTop.activeCustomRuns + procTop.runningJobs }}
        </template>
      </span>
      <span v-if="graphRunError" class="run-toast">{{ graphRunError }}</span>
      <div class="topbar-tools">
        <button
          v-if="serverProjectDir"
          class="threadle-btn icon"
          :title="`Open project in ${editorLabel}`"
          @click="emit('open-project')"
        >
          ⟨/⟩
        </button>
        <button
          class="threadle-btn icon"
          :disabled="!hasGraph"
          :title="
            paramCount
              ? `${paramCount} workflow parameter(s)`
              : 'Workflow parameters — {{param:name}} in prompts'
          "
          @click="emit('open-params')"
        >
          ≔{{ paramCount ? paramCount : "" }}
        </button>
        <button
          class="threadle-btn icon"
          :disabled="!canUndo"
          title="Undo (Cmd+Z)"
          @click="emit('undo')"
        >
          ⤺
        </button>
        <button
          class="threadle-btn icon"
          :disabled="!canRedo"
          title="Redo (Cmd+Shift+Z)"
          @click="emit('redo')"
        >
          ⤻
        </button>
        <button
          class="threadle-btn icon"
          :class="{ active: canvasFocus }"
          :title="
            canvasFocus
              ? 'Exit fullscreen canvas (F or Esc)'
              : 'Fullscreen canvas — hide nav & palette (F)'
          "
          @click="emit('toggle-focus')"
        >
          {{ canvasFocus ? "↙" : "⛶" }}
        </button>
        <button
          class="threadle-btn icon"
          :disabled="!hasGraph"
          title="Copy graph as shareable JSON"
          @click="emit('export')"
        >
          {{ exportState === "copied" ? "✓" : exportState === "downloaded" ? "↓" : "⧉" }}
        </button>
        <div class="hist-wrap">
          <button
            class="threadle-btn icon"
            :disabled="!hasGraph || historyBusy"
            title="Version history"
            @click="emit('toggle-history')"
          >
            ⟲
          </button>
          <div v-if="historyOpen" class="hist-menu">
            <div class="micro-label hist-head">versions</div>
            <div v-if="!(historyVersions ?? []).length" class="hist-empty">no snapshots yet</div>
            <button
              v-for="v in historyVersions ?? []"
              :key="v.ts"
              type="button"
              class="hist-item"
              :title="v.ts"
              @click="emit('restore-version', v.ts)"
            >
              <span class="hist-ts">{{ formatHist(v) }}</span>
              <span class="hist-meta">{{ v.nodeCount ?? "—" }}n</span>
            </button>
          </div>
        </div>
      </div>
      <button
        v-if="activeTabBusy"
        class="threadle-btn danger"
        title="Stop the run (cancels the active job)"
        @click="emit('stop')"
      >
        ■ Stop
      </button>
      <button
        class="threadle-btn primary"
        :disabled="activeTabBusy || !canRunGraph || !graphReady"
        :title="runButtonTitle"
        @click="emit('run')"
      >
        {{ activeTabBusy ? "Running…" : "▶ Run" }}
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import FolderMark from "@/panels/FolderMark.vue";

defineProps<{
  canvasFocus: boolean;
  parentGraph?: { id: string; name: string };
  hasGraph: boolean;
  nameCrumbs: string[];
  nameCrumbsPending: boolean;
  nameDraft: string;
  graphKind?: "workflow" | "subgraph" | string;
  saveState?: string;
  procTop?: { cpuPct: number; activeCustomRuns: number; runningJobs: number };
  graphRunError?: string;
  serverProjectDir?: string;
  editorLabel: string;
  paramCount: number;
  canUndo: boolean;
  canRedo: boolean;
  exportState: "" | "copied" | "downloaded";
  activeTabBusy: boolean;
  canRunGraph: boolean;
  graphReady: boolean;
  runButtonTitle: string;
  historyOpen?: boolean;
  historyBusy?: boolean;
  historyVersions?: Array<{ ts: string; updatedAt?: number; name?: string; nodeCount?: number }>;
}>();

const emit = defineEmits<{
  back: [];
  "update:nameDraft": [value: string];
  "name-focus": [];
  "name-blur": [];
  "name-keydown": [e: KeyboardEvent];
  "name-keyup": [e: KeyboardEvent];
  "open-project": [];
  "open-params": [];
  undo: [];
  redo: [];
  "toggle-focus": [];
  export: [];
  "toggle-history": [];
  "restore-version": [ts: string];
  stop: [];
  run: [];
}>();

function formatHist(v: {
  ts: string;
  updatedAt?: number;
  name?: string;
}): string {
  if (v.updatedAt) {
    try {
      return new Date(v.updatedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      // fall through
    }
  }
  return v.ts.replace(/T/, " ").slice(0, 16);
}
</script>

<style scoped>
.topbar.canvas-focus {
  border-bottom-color: var(--border);
}
.topbar.canvas-focus .topbar-proc {
  display: none;
}
.topbar-proc {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  white-space: nowrap;
  cursor: default;
  margin-right: 4px;
}
.topbar-proc.live {
  color: var(--status-running);
}
.topbar {
  height: var(--chrome-bar-h);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 16px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  box-sizing: border-box;
}
.topbar .threadle-btn {
  height: 28px;
  padding: 0 10px;
}
.topbar-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
  padding-right: 8px;
  border-right: 1px solid var(--border);
}
.topbar .threadle-btn.icon {
  width: 28px;
  min-width: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  color: var(--text-dim);
  background: transparent;
  border-color: transparent;
}
.topbar .threadle-btn.icon:hover:not(:disabled) {
  color: var(--text);
  background: var(--node-bg);
  border-color: transparent;
}
.topbar .threadle-btn.icon.active {
  color: var(--text);
  background: var(--accent-soft);
  border-color: var(--border-strong);
}
.topbar .threadle-btn.icon:disabled {
  opacity: 0.35;
}
.back {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: var(--fs-lg);
  display: grid;
  place-items: center;
  text-decoration: none;
  flex-shrink: 0;
  padding: 0;
}
.back:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.editor-crumb {
  background: none;
  border: none;
  color: var(--text-faint);
  font-size: var(--fs-sm);
  cursor: pointer;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.editor-crumb:hover {
  color: var(--text);
}
.editor-crumb-sep {
  color: var(--text-faint);
  flex-shrink: 0;
  user-select: none;
}
.name-path {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 520px;
}
.name-crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--node-bg, var(--input-bg));
  border: 1px solid var(--border);
}
.name-crumb.pending {
  color: var(--text);
  border-style: dashed;
  border-color: var(--border-strong);
}
.name-crumb-mark {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  color: var(--text-faint);
}
.editor-sub-badge {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--lane-session);
  border: 1px solid rgba(95, 159, 232, 0.35);
  border-radius: 3px;
  padding: 1px 6px;
}
.kind-badge {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 7px;
  user-select: none;
}
.kind-badge.sub {
  color: var(--lane-session);
  border-color: rgba(95, 159, 232, 0.35);
}
.graph-name {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-lg);
  font-weight: 600;
  font-family: var(--font);
  height: 30px;
  padding: 0 8px;
  flex: 1 1 auto;
  min-width: 80px;
  max-width: none;
  width: 100%;
  outline: none;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
}
.graph-name:hover {
  border-color: var(--border);
}
.graph-name:focus {
  border-color: var(--accent);
  background: var(--input-bg);
}
.save-state {
  font-size: var(--fs-sm);
  color: var(--text-faint);
}
.save-state.error {
  color: var(--status-error);
}
.run-toast {
  font-size: var(--fs-sm);
  color: var(--status-error);
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.topbar-right {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}
.hist-wrap {
  position: relative;
}
.hist-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  max-width: 280px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  z-index: 40;
  display: flex;
  flex-direction: column;
}
.hist-head {
  padding: 4px 8px 2px;
  color: var(--text-faint);
}
.hist-empty {
  padding: 8px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-faint);
}
.hist-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  cursor: pointer;
}
.hist-item:hover {
  background: var(--input-bg);
  color: var(--text);
}
.hist-ts {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-meta {
  flex: 0 0 auto;
  color: var(--text-faint);
}
</style>
