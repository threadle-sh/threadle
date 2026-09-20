<template>
  <div
    class="threadle-node"
    :class="{
      selected,
      stale,
      'has-err-out': hasErrOutput,
      [`run-${runStatus}`]: runStatus && runStatus !== 'idle',
    }"
  >
    <Handle
      v-if="hasInput"
      type="target"
      :position="Position.Left"
      class="threadle-handle"
      title="in"
      :style="{ borderColor: inboundColor }"
    />
    <div class="icon-tile" :style="{ background: iconBg }">
      <span class="glyph">{{ glyph }}</span>
    </div>
    <div class="node-body">
      <EditableNodeTitle
        v-if="renamable"
        :label="label"
        :fallback="title"
        @update:label="emit('update:label', $event)"
      />
      <div v-else class="node-title" :title="title">{{ title }}</div>
      <div class="node-sub" :title="subtitle">{{ subtitle }}</div>
    </div>
    <div v-if="$slots.trailing" class="node-trailing nodrag nopan">
      <slot name="trailing" />
    </div>
    <span class="status-dot" :class="status" />
    <NodeDurationBadge :node-id="id" />
    <Handle
      v-if="hasOutput"
      type="source"
      :position="Position.Right"
      class="threadle-handle out-handle"
      title="out"
      :style="outHandleColor ? { borderColor: outHandleColor } : undefined"
    />
    <Handle
      v-if="hasErrOutput"
      id="out:err"
      type="source"
      :position="Position.Right"
      class="threadle-handle err-handle"
      title="err · after retries exhausted"
    />
    <Handle
      v-if="hasSubOutput"
      id="sub"
      type="source"
      :position="Position.Bottom"
      class="threadle-handle sub-handle"
      title="sub · child session"
    />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import { useInboundHandleColor } from "@/lib/useInboundHandleColor";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  glyph: string;
  iconBg: string;
  title: string;
  subtitle: string;
  status?: string;
  /** graph-run status — drives the active-node border highlight */
  runStatus?: string;
  selected?: boolean;
  stale?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  /** optional error branch (`out:err`) under the primary out */
  hasErrOutput?: boolean;
  /** bottom attachment point for subagent child nodes */
  hasSubOutput?: boolean;
  /** overrides out-handle border (e.g. agent provider color) */
  outHandleColor?: string;
  /** double-click title to rename */
  renamable?: boolean;
  /** current custom label when renamable */
  label?: string;
}>();

const emit = defineEmits<{
  "update:label": [value: string | undefined];
}>();

const inboundColor = useInboundHandleColor(() => props.id);
</script>

<style scoped>
.threadle-node {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 210px;
  min-height: 64px;
  padding: 10px 12px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  position: relative;
  transition: border-color 0.12s, background 0.12s;
}
.threadle-node:hover {
  background: var(--node-bg-hover);
}
.threadle-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.threadle-node.stale {
  opacity: 0.6;
  border-style: dashed;
}
.icon-tile {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.glyph {
  font-size: var(--fs-2xl);
  color: #fff;
}
.node-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.node-trailing {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 3px;
  align-self: flex-start;
  margin-top: -2px;
}
.node-title {
  font-size: var(--fs-md);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-sub {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0;
}
.status-dot {
  position: absolute;
  bottom: 8px;
  left: 8px;
  width: 7px;
  height: 7px;
  pointer-events: none;
}

.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--accent);
  transition: width 0.1s, height 0.1s;
}
.threadle-handle:hover {
  width: 14px;
  height: 14px;
}
/* Happy-path out sits mid-upper; err is mid-lower — both clear of each other.
   Vue Flow sets inline top on handles; :deep + !important wins. */
.threadle-node.has-err-out :deep(.out-handle) {
  top: 28% !important;
}
.threadle-node :deep(.err-handle) {
  top: 72% !important;
  bottom: auto !important;
  border-color: var(--status-error) !important;
}
.sub-handle {
  width: 7px;
  height: 7px;
  border-color: var(--border-strong);
}
</style>
