<template>
  <div class="note-node" :class="colorKey">
    <NodeResizer
      :min-width="140"
      :min-height="80"
      :line-style="{ borderColor: 'transparent' }"
      @resize-end="onResizeEnd"
    />
    <div class="note-head">
      <span class="note-glyph mono">✎</span>
      <span class="note-hint micro-label">note</span>
      <button class="note-color nodrag" title="Cycle color" @click="cycleColor">◍</button>
    </div>
    <textarea
      v-if="editing"
      ref="bodyEl"
      v-model="data.text"
      class="note-body nodrag mono"
      spellcheck="false"
      placeholder="write anything — this node never runs"
      @blur="editing = false"
      @keydown.stop
    />
    <div
      v-else
      class="note-body note-render mono"
      title="Double-click to edit"
      @dblclick.stop="startEdit"
    >{{ data.text || "double-click to write…" }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { NodeResizer } from "@vue-flow/node-resizer";
import type { NoteNodeData } from "@threadle/shared";

const props = defineProps<{
  id: string;
  data: NoteNodeData;
  selected?: boolean;
}>();

const COLORS = ["gold", "gray", "teal", "terracotta", "blue"] as const;
const colorKey = computed(() => props.data.color ?? "gold");

function cycleColor(): void {
  const i = COLORS.indexOf((props.data.color ?? "gold") as (typeof COLORS)[number]);
  props.data.color = COLORS[(i + 1) % COLORS.length];
}

function onResizeEnd(e: { params: { width: number; height: number } }): void {
  props.data.size = { width: e.params.width, height: e.params.height };
}

const editing = ref(false);
const bodyEl = ref<HTMLTextAreaElement>();

function startEdit(): void {
  editing.value = true;
  void nextTick(() => bodyEl.value?.focus());
}
</script>

<style scoped>
.note-node {
  width: 100%;
  height: 100%;
  min-width: 140px;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, #cfa93c 42%, var(--border));
  border-radius: var(--radius);
  /* Mix tint into panel so light/dark both stay readable with --text-dim */
  background: color-mix(in srgb, #cfa93c 20%, var(--panel-bg));
  box-shadow: var(--shadow);
}
.note-node.gray {
  border-color: var(--border-strong);
  background: var(--panel-bg-raised);
}
.note-node.teal {
  border-color: color-mix(in srgb, #26b3a2 42%, var(--border));
  background: color-mix(in srgb, #26b3a2 18%, var(--panel-bg));
}
.note-node.terracotta {
  border-color: color-mix(in srgb, #c96f52 42%, var(--border));
  background: color-mix(in srgb, #c96f52 18%, var(--panel-bg));
}
.note-node.blue {
  border-color: color-mix(in srgb, #5f9fe8 42%, var(--border));
  background: color-mix(in srgb, #5f9fe8 18%, var(--panel-bg));
}
.note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px 0;
}
.note-glyph {
  color: var(--context);
  font-size: var(--fs-sm);
}
.note-hint {
  flex: 1;
}
.note-color {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--fs-sm);
  padding: 0 2px;
}
.note-color:hover { color: var(--text); }
.note-body {
  flex: 1;
  min-height: 0;
  margin: 4px 9px 8px;
  background: none;
  border: none;
  outline: none;
  resize: none;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-y: auto;
}
.note-render {
  cursor: text;
}
.note-render:empty::before {
  content: "double-click to write…";
  color: var(--text-faint);
}
</style>
