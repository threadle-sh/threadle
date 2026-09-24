<template>
  <div
    class="iter-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="i-head">
      <span class="i-icon">∀</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Iterator"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="i-row nodrag">
      <label class="i-label">split</label>
      <select v-model="data.splitMode" class="i-select">
        <option value="lines">lines</option>
        <option value="blocks">blank-line blocks</option>
        <option value="json">JSON array</option>
      </select>
    </div>
    <div class="i-row nodrag">
      <label class="i-label">map</label>
      <select
        class="i-select"
        :value="data.mode ?? 'serial'"
        @change="data.mode = ($event.target as HTMLSelectElement).value as 'serial' | 'parallel'"
      >
        <option value="serial">serial · one session</option>
        <option value="parallel">parallel · fresh / ply</option>
      </select>
    </div>
    <div class="i-row nodrag">
      <label class="i-label">max</label>
      <input
        v-model.number="data.maxItems"
        class="i-select i-num"
        type="number"
        min="1"
        placeholder="∞"
      />
    </div>
    <div class="i-sub">
      {{
        data.mode === "parallel"
          ? "fresh session per item · ply-bounded · pair with Merge"
          : "downstream agent runs once per item · one session"
      }}
    </div>
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-iterator" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { IteratorNodeData, NodeStatus } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

defineProps<{
  id: string;
  data: IteratorNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();
</script>

<style scoped>
.iter-node {
  width: 210px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.iter-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.i-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.i-icon {
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
.i-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.i-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  width: 34px;
}
.i-select {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-xs);
  font-family: var(--mono);
  padding: 4px 6px;
  outline: none;
}
.i-num {
  max-width: 80px;
}
.i-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--accent);
}
</style>
