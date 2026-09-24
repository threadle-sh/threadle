<template>
  <div class="grp-node" :class="[colorKey, { selected, linked: !!data.graphId, collapsed: !!data.collapsed }]">
    <Handle
      v-if="data.graphId"
      type="target"
      :position="Position.Left"
      title="in"
      class="threadle-handle grp-handle"
    />
    <Handle
      v-if="data.graphId"
      type="source"
      :position="Position.Right"
      title="out"
      class="threadle-handle grp-handle"
    />
    <NodeResizer
      v-if="!data.collapsed"
      :min-width="180"
      :min-height="120"
      :line-style="{ borderColor: 'transparent' }"
      @resize-end="onResizeEnd"
    />
    <div class="grp-head" :class="{ linked: !!data.graphId }">
      <span v-if="data.graphId" class="grp-sub-glyph mono">⌗</span>
      <span
        v-if="!editing"
        class="grp-title-text mono"
        title="Double-click to rename · drag to move the frame"
        @dblclick.stop="startEdit"
      >{{ data.label || "Group" }}</span>
      <input
        v-else
        ref="titleEl"
        v-model="data.label"
        class="grp-title nodrag"
        spellcheck="false"
        placeholder="Group"
        @blur="editing = false"
        @keydown.enter.prevent="editing = false"
        @keydown.escape.prevent="editing = false"
      />
      <span v-if="data.graphId" class="grp-sub-tag mono">sub-workflow</span>
      <button
        class="grp-color nodrag"
        :title="data.collapsed ? 'Expand: show the nodes inside' : 'Minimize: hide the nodes, keep the wiring'"
        @click="toggleCollapse"
      >{{ data.collapsed ? "⊞" : "⊟" }}</button>
      <button
        v-if="data.graphId"
        class="grp-color nodrag grp-open"
        title="Open the sub-workflow extracted from this frame (or double-click)"
        @click="router.push(`/graph/${data.graphId}?parent=${route.params.id}`)"
      >⌗ open</button>
      <button
        v-if="data.graphId"
        class="grp-color nodrag"
        title="Pull the latest nodes/wires from the linked sub-workflow into this frame"
        @click="requestSync"
      >↻</button>
      <button class="grp-color nodrag" title="Cycle color" @click="cycleColor">◍</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Handle, Position } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
import type { GroupNodeData } from "@threadle/shared";

const props = defineProps<{
  id: string;
  data: GroupNodeData;
  selected?: boolean;
}>();

const router = useRouter();
const route = useRoute();

const COLORS = ["gold", "teal", "terracotta", "blue", "gray"] as const;

const colorKey = computed(() => props.data.color ?? "gray");

function cycleColor(): void {
  const i = COLORS.indexOf((props.data.color ?? "gray") as (typeof COLORS)[number]);
  props.data.color = COLORS[(i + 1) % COLORS.length];
}

function onResizeEnd(e: { params: { width: number; height: number } }): void {
  props.data.size = { width: e.params.width, height: e.params.height };
}

const editing = ref(false);
const titleEl = ref<HTMLInputElement>();

function startEdit(): void {
  editing.value = true;
  void nextTick(() => titleEl.value?.focus());
}

function toggleCollapse(): void {
  props.data.collapsed = !props.data.collapsed;
  // the editor re-derives node/edge visibility from the store
  window.dispatchEvent(new CustomEvent("threadle:frames-changed"));
}

function requestSync(): void {
  window.dispatchEvent(
    new CustomEvent("threadle:sync-frame", { detail: { frameId: props.id } }),
  );
}
</script>

<style scoped>
.grp-node {
  width: 100%;
  height: 100%;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--hover-overlay);
}
.grp-node.selected {
  border-style: solid;
  border-color: var(--accent);
}
.grp-node.linked {
  border-style: solid;
}
.grp-head.linked {
  background: rgba(95, 159, 232, 0.08);
  border-bottom: 1px solid rgba(95, 159, 232, 0.25);
  border-radius: var(--radius) var(--radius) 0 0;
}
.grp-sub-glyph {
  color: var(--lane-session);
  font-weight: 700;
  font-size: var(--fs-sm);
}
.grp-sub-tag {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--lane-session);
  border: 1px solid rgba(95, 159, 232, 0.35);
  border-radius: 3px;
  padding: 1px 5px;
}
.grp-node.gold {
  background: rgba(207, 169, 60, 0.05);
  border-color: rgba(207, 169, 60, 0.35);
}
.grp-node.teal {
  background: rgba(38, 179, 162, 0.05);
  border-color: rgba(38, 179, 162, 0.35);
}
.grp-node.terracotta {
  background: rgba(201, 111, 82, 0.06);
  border-color: rgba(201, 111, 82, 0.35);
}
.grp-node.blue {
  background: rgba(95, 159, 232, 0.05);
  border-color: rgba(95, 159, 232, 0.35);
}
.grp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
}
.grp-title-text {
  flex: 1;
  min-width: 0;
  color: var(--text-dim);
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: grab;
}
.grp-node.collapsed {
  background: var(--node-bg);
  border-style: solid;
}
.grp-node.collapsed .grp-head {
  border-radius: var(--radius);
}
.grp-title {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.grp-title:focus {
  color: var(--text);
}
.grp-color {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--fs-sm);
  padding: 0 2px;
}
.grp-color:hover {
  color: var(--text);
}
.grp-handle {
  width: 12px;
  height: 12px;
  background: var(--node-bg);
  border: 2px solid var(--lane-session);
}
.grp-open {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  padding: 1px 6px;
  color: var(--text-dim);
}
</style>
