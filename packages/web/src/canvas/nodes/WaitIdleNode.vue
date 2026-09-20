<template>
  <div
    class="wi-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle', waiting }"
  >
    <InboundHandle :node-id="id" />
    <div class="wi-head">
      <span class="wi-icon">◌</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Wait for idle"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="wi-row nodrag">
      <label class="wi-label">timeout</label>
      <input
        class="wi-input"
        type="number"
        min="1"
        max="300"
        step="1"
        :value="timeoutSec"
        @input="onTimeout"
      />
      <span class="wi-unit">s</span>
    </div>
    <div class="wi-row nodrag">
      <label class="wi-label">on miss</label>
      <select v-model="data.onTimeout" class="wi-select">
        <option value="park">park</option>
        <option value="skip">skip</option>
        <option value="abort">abort</option>
      </select>
    </div>
    <div class="wi-sub">
      {{
        waiting
          ? "waiting for session to go idle…"
          : "session in · park until not generating"
      }}
    </div>
    <Handle
      type="source"
      :position="Position.Right"
      title="out"
      class="threadle-handle wire-wait-idle"
    />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeStatus, WaitIdleNodeData } from "@threadle/shared";
import { clampWaitIdleTimeoutMs } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: WaitIdleNodeData;
  selected?: boolean;
  status?: NodeStatus;
  waiting?: boolean;
}>();

if (!props.data.onTimeout) props.data.onTimeout = "park";

const timeoutSec = computed(() =>
  Math.round(clampWaitIdleTimeoutMs(props.data.timeoutMs) / 1000),
);

function onTimeout(e: Event): void {
  const sec = Number((e.target as HTMLInputElement).value);
  props.data.timeoutMs = clampWaitIdleTimeoutMs(
    Number.isFinite(sec) ? sec * 1000 : undefined,
  );
}
</script>

<style scoped>
.wi-node {
  width: 220px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.wi-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.wi-node.waiting {
  border-color: var(--status-waiting);
}
.wi-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.wi-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--lane-session);
  color: #0b1c30;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.wi-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.wi-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  min-width: 52px;
}
.wi-input {
  width: 56px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  padding: 3px 6px;
}
.wi-unit {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.wi-select {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  padding: 3px 6px;
}
.wi-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  margin-top: 4px;
}
</style>
