<template>
  <div
    class="appr-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle', waiting }"
  >
    <InboundHandle :node-id="id" />
    <div class="a-head">
      <span class="a-icon">✓</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Approval gate"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="a-sub">
      {{ waiting ? "waiting for your review…" : "run pauses here until approved" }}
    </div>
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-approval" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { ApprovalNodeData, NodeStatus } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: ApprovalNodeData;
  selected?: boolean;
  status?: NodeStatus;
  /** true while this gate is the one blocking the current run */
  waiting?: boolean;
}>();
void props;
</script>

<style scoped>
.appr-node {
  width: 210px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.appr-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.appr-node.waiting {
  border-color: var(--status-waiting);
}
.a-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.a-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--status-waiting);
  color: #3a2f08;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.a-sub {
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
