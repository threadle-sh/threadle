<template>
  <div
    class="knot-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="k-head">
      <span class="k-icon">⋈</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Merge"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="k-row nodrag">
      <label class="k-label">join</label>
      <select v-model="data.strategy" class="k-select">
        <option value="concat">concat</option>
        <option value="first">first wins</option>
        <option value="majority">majority</option>
        <option value="synthesize">synthesize</option>
      </select>
    </div>
    <div class="k-sub">
      {{
        data.strategy === "concat"
          ? "merge inbound wires explicitly"
          : data.strategy === "first"
            ? "take the first inbound text"
            : data.strategy === "majority"
              ? "pick the most common inbound text"
              : "LLM-merge candidates (needs model)"
      }}
    </div>
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-knot" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { KnotNodeData, NodeStatus } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

defineProps<{
  id: string;
  data: KnotNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();
</script>

<style scoped>
.knot-node {
  width: 210px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.knot-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.k-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.k-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #0a0a0b;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.k-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.k-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  width: 34px;
}
.k-select {
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
.k-sub {
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
