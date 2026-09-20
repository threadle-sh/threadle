<template>
  <div class="wf-list-pop" @click.stop>
    <div class="wf-list-head-row">
      <div class="wf-list-head micro-label">workflows</div>
      <button
        type="button"
        class="wf-list-head-btn"
        title="New folder"
        @click="emit('create-folder')"
      >
        <FolderMark class="btn-folder-mark" /> Folder
      </button>
    </div>
    <input
      :value="filter"
      class="wf-list-filter mono"
      placeholder="filter…"
      spellcheck="false"
      @keydown.escape="emit('close')"
      @input="emit('update:filter', ($event.target as HTMLInputElement).value)"
    />
    <div
      class="wf-list-scroll"
      :class="{ 'wf-list-drop-root': dropTarget === 'root' }"
      @dragover.prevent="emit('root-dragover', $event)"
      @dragleave="emit('root-dragleave', $event)"
      @drop.prevent="emit('root-drop', $event)"
    >
      <template v-for="row in workflowRows" :key="'w-' + row.key">
        <div
          v-if="row.kind === 'folder'"
          class="wf-list-row wf-list-folder"
          :class="{
            'wf-list-folder-open': folderCtxId === row.folder.id,
            'wf-list-drop-over': dropTarget === row.folder.id,
          }"
          :style="{ '--wf-depth': row.depth }"
          @contextmenu.capture.prevent.stop="emit('folder-contextmenu', $event, row.folder)"
          @mousedown.capture="emit('folder-mousedown', $event, row.folder)"
          @dragover.prevent="emit('folder-dragover', $event, row.folder.id)"
          @dragleave="emit('folder-dragleave', row.folder.id)"
          @drop.prevent="emit('folder-drop', $event, row.folder.id)"
        >
          <button
            type="button"
            class="wf-list-folder-main"
            @click="emit('create-workflow-in-folder', row.folder.id)"
          >
            <span
              class="wf-list-caret"
              title="Expand / collapse"
              @click.stop="emit('toggle-folder', row.folder.id)"
            >{{ collapsed.has(row.folder.id) ? "▸" : "▾" }}</span>
            <span class="wf-list-name">
              <FolderMark :open="!collapsed.has(row.folder.id)" /> {{ row.folder.name }}
            </span>
            <span class="wf-list-meta">{{ row.graphCount }}</span>
          </button>
          <button
            type="button"
            class="wf-list-folder-more"
            title="Folder actions"
            @click.stop="emit('folder-more', $event, row.folder)"
          >
            ⋯
          </button>
        </div>
        <div
          v-else
          class="wf-list-row wf-list-graph"
          :class="{
            active: row.graph.id === activeGraphId,
            open: openIds.includes(row.graph.id),
            'wf-list-graph-open': graphCtxId === row.graph.id,
          }"
          :style="{ '--wf-depth': row.depth }"
          draggable="true"
          @dragstart="emit('graph-dragstart', $event, row.graph.id)"
          @dragend="emit('graph-dragend')"
          @contextmenu.capture.prevent.stop="emit('graph-contextmenu', $event, row.graph)"
          @mousedown.capture="emit('graph-mousedown', $event, row.graph)"
        >
          <button
            type="button"
            class="wf-list-graph-main"
            @click="emit('open-graph', row.graph.id, row.graph.name)"
          >
            <span class="wf-list-name">{{ row.graph.name }}</span>
            <span class="wf-list-meta">{{ row.graph.nodeCount }}n</span>
          </button>
          <button
            type="button"
            class="wf-list-folder-more"
            title="Workflow actions"
            @click.stop="emit('graph-more', $event, row.graph)"
          >
            ⋯
          </button>
        </div>
      </template>
      <div v-if="subgraphRows.length" class="wire-sect micro-label">subgraphs</div>
      <template v-for="row in subgraphRows" :key="'s-' + row.key">
        <div
          v-if="row.kind === 'folder'"
          class="wf-list-row wf-list-folder"
          :class="{
            'wf-list-folder-open': folderCtxId === row.folder.id,
            'wf-list-drop-over': dropTarget === row.folder.id,
          }"
          :style="{ '--wf-depth': row.depth }"
          @contextmenu.capture.prevent.stop="emit('folder-contextmenu', $event, row.folder)"
          @mousedown.capture="emit('folder-mousedown', $event, row.folder)"
          @dragover.prevent="emit('folder-dragover', $event, row.folder.id)"
          @dragleave="emit('folder-dragleave', row.folder.id)"
          @drop.prevent="emit('folder-drop', $event, row.folder.id)"
        >
          <button
            type="button"
            class="wf-list-folder-main"
            @click="emit('create-workflow-in-folder', row.folder.id)"
          >
            <span
              class="wf-list-caret"
              title="Expand / collapse"
              @click.stop="emit('toggle-folder', row.folder.id)"
            >{{ collapsed.has(row.folder.id) ? "▸" : "▾" }}</span>
            <span class="wf-list-name">
              <FolderMark :open="!collapsed.has(row.folder.id)" /> {{ row.folder.name }}
            </span>
            <span class="wf-list-meta">{{ row.graphCount }}</span>
          </button>
          <button
            type="button"
            class="wf-list-folder-more"
            title="Folder actions"
            @click.stop="emit('folder-more', $event, row.folder)"
          >
            ⋯
          </button>
        </div>
        <div
          v-else
          class="wf-list-row wf-list-graph"
          :class="{
            active: row.graph.id === activeGraphId,
            open: openIds.includes(row.graph.id),
            'wf-list-graph-open': graphCtxId === row.graph.id,
          }"
          :style="{ '--wf-depth': row.depth }"
          draggable="true"
          @dragstart="emit('graph-dragstart', $event, row.graph.id)"
          @dragend="emit('graph-dragend')"
          @contextmenu.capture.prevent.stop="emit('graph-contextmenu', $event, row.graph)"
          @mousedown.capture="emit('graph-mousedown', $event, row.graph)"
        >
          <button
            type="button"
            class="wf-list-graph-main"
            @click="emit('open-graph', row.graph.id, row.graph.name)"
          >
            <span class="wf-list-name">{{ row.graph.name }}</span>
            <span class="wf-list-meta">{{ row.graph.usedBy ?? 0 }}×</span>
          </button>
          <button
            type="button"
            class="wf-list-folder-more"
            title="Subgraph actions"
            @click.stop="emit('graph-more', $event, row.graph)"
          >
            ⋯
          </button>
        </div>
      </template>
      <div v-if="empty" class="wf-list-empty">
        {{ loading ? "loading…" : "no workflows" }}
      </div>
    </div>
    <button class="wf-list-new" @click="emit('new-workflow')">+ New workflow</button>
  </div>
</template>

<script setup lang="ts">
import type { GraphSummary, WorkflowFolder } from "@threadle/shared";
import FolderMark from "@/panels/FolderMark.vue";

export type WfListRow =
  | { kind: "folder"; key: string; folder: WorkflowFolder; depth: number; graphCount: number }
  | { kind: "graph"; key: string; graph: GraphSummary; depth: number };

defineProps<{
  filter: string;
  workflowRows: WfListRow[];
  subgraphRows: WfListRow[];
  collapsed: Set<string>;
  dropTarget: string | null;
  activeGraphId: string;
  openIds: string[];
  folderCtxId?: string;
  graphCtxId?: string;
  empty: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update:filter": [value: string];
  "create-folder": [];
  "create-workflow-in-folder": [folderId: string];
  "toggle-folder": [folderId: string];
  "folder-contextmenu": [e: MouseEvent, folder: WorkflowFolder];
  "folder-mousedown": [e: MouseEvent, folder: WorkflowFolder];
  "folder-more": [e: MouseEvent, folder: WorkflowFolder];
  "folder-dragover": [e: DragEvent, folderId: string];
  "folder-dragleave": [folderId: string];
  "folder-drop": [e: DragEvent, folderId: string];
  "root-dragover": [e: DragEvent];
  "root-dragleave": [e: DragEvent];
  "root-drop": [e: DragEvent];
  "graph-dragstart": [e: DragEvent, graphId: string];
  "graph-dragend": [];
  "graph-contextmenu": [e: MouseEvent, graph: GraphSummary];
  "graph-mousedown": [e: MouseEvent, graph: GraphSummary];
  "graph-more": [e: MouseEvent, graph: GraphSummary];
  "open-graph": [id: string, name: string];
  "new-workflow": [];
}>();
</script>

<style scoped>
.wf-list-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 8px;
  z-index: 70;
  width: 280px;
  max-height: min(420px, 70vh);
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 6px;
}
.wf-list-head {
  padding: 4px 8px 6px;
}
.wf-list-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-right: 4px;
}
.wf-list-head-btn {
  appearance: none;
  background: none;
  border: none;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  padding: 2px 6px;
}
.wf-list-head-btn:hover {
  color: var(--text);
}
.wf-list-filter {
  margin: 0 4px 6px;
  padding: 5px 8px;
  font-size: var(--fs-xs);
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  outline: none;
}
.wf-list-filter:focus {
  border-color: var(--border-strong);
}
.wf-list-scroll {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  flex: 1;
  border-radius: 4px;
}
.wf-list-scroll.wf-list-drop-root {
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
}
.wf-list-folder.wf-list-drop-over,
.wf-list-folder.wf-list-drop-over .wf-list-folder-main {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--text);
}
.wf-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  padding-left: calc(8px + var(--wf-depth, 0) * 12px);
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  cursor: pointer;
  box-sizing: border-box;
}
.wf-list-row:hover {
  background: var(--input-bg);
  color: var(--text);
}
.wf-list-row.active {
  color: var(--text);
  background: var(--accent-soft);
}
.wf-list-row.open:not(.active) .wf-list-name::before {
  content: "· ";
  color: var(--status-running);
}
.wf-list-folder {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  padding: 0;
  color: var(--text);
  user-select: none;
  -webkit-user-select: none;
}
.wf-list-folder-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  padding-left: calc(8px + var(--wf-depth, 0) * 12px);
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
}
.wf-list-folder-main:hover {
  background: var(--input-bg);
}
.wf-list-folder-more {
  appearance: none;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-faint);
  font-size: var(--fs-md);
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
}
.wf-list-folder:hover .wf-list-folder-more,
.wf-list-folder.wf-list-folder-open .wf-list-folder-more,
.wf-list-folder-more:focus {
  opacity: 1;
}
.wf-list-graph {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  padding: 0;
  color: var(--text-dim);
  user-select: none;
  -webkit-user-select: none;
}
.wf-list-graph.active {
  color: var(--text);
}
.wf-list-graph-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  padding-left: calc(8px + var(--wf-depth, 0) * 12px);
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}
.wf-list-graph-main:hover {
  background: var(--input-bg);
  color: var(--text);
}
.wf-list-graph:hover .wf-list-folder-more,
.wf-list-graph.wf-list-graph-open .wf-list-folder-more {
  opacity: 1;
}
.wf-list-folder-more:hover {
  color: var(--text);
  background: var(--input-bg);
}
.wf-list-folder .wf-list-name::before {
  content: none !important;
}
.wf-list-caret {
  display: inline-block;
  width: 10px;
  color: var(--text-faint);
  cursor: pointer;
}
.wf-list-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.wf-list-name :deep(.folder-mark) {
  flex-shrink: 0;
}
.btn-folder-mark {
  width: 12px;
  height: 12px;
  color: currentColor;
}
.wf-list-meta {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.wf-list-empty {
  padding: 12px 8px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-align: center;
}
.wf-list-new {
  margin-top: 4px;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel-bg-raised);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  cursor: pointer;
  text-align: left;
}
.wf-list-new:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.wire-sect {
  padding: 7px 9px 3px;
  border-top: 1px solid var(--border);
  margin-top: 3px;
}
</style>
