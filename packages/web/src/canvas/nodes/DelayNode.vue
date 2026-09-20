<template>
  <div
    class="delay-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="d-head">
      <span class="d-icon">◷</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Delay"
        @update:label="(v) => (data.label = v)"
      />
      <span class="d-dur">{{ durationLabel }}</span>
    </div>
    <div class="d-row nodrag">
      <label class="d-label">seconds</label>
      <input
        class="d-input"
        type="number"
        min="0"
        max="300"
        step="1"
        :value="seconds"
        @input="onSeconds"
      />
    </div>
    <div class="d-sub">wall-clock pause · no agent</div>
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-delay" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { DelayNodeData, NodeStatus } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: DelayNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const seconds = computed(() => Math.round((props.data.ms ?? 0) / 1000));

/** Human duration from `ms` — never from a stale label. */
const durationLabel = computed(() => {
  const s = seconds.value;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
});

function onSeconds(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value);
  const sec = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), 300) : 0;
  props.data.ms = sec * 1000;
}
</script>

<style scoped>
.delay-node {
  width: 180px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.delay-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.d-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.d-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--wire-delay);
  color: #0a0a0b;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.d-dur {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  letter-spacing: 0.02em;
  flex: 0 0 auto;
}
.d-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.d-label {
  font-size: var(--fs-xs);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex: 0 0 auto;
}
.d-input {
  flex: 1;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--mono);
  padding: 4px 6px;
  outline: none;
  text-align: right;
}
.d-input:focus {
  border-color: var(--accent);
}
.d-sub {
  font-size: var(--fs-xs);
  color: var(--muted);
}
</style>
