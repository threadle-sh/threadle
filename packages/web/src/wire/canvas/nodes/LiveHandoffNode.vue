<template>
  <div
    class="lh-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle', waiting }"
  >
    <InboundHandle :node-id="id" />
    <div class="lh-head">
      <span class="lh-icon">⇄</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Live handoff"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="lh-sub">
      <template v-if="waiting">chat until Ready…</template>
      <template v-else-if="agentLabel">{{ agentLabel }} · {{ kindLabel }}</template>
      <template v-else>bind an agent · chat · Ready hands off</template>
    </div>
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-live-handoff" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { LiveHandoffNodeData, NodeStatus } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: LiveHandoffNodeData;
  selected?: boolean;
  status?: NodeStatus;
  /** true while this gate is blocking the current run */
  waiting?: boolean;
}>();

const agentLabel = computed(() => {
  const r = props.data.ref;
  if (!r) return "";
  return `${r.name}`;
});

const kindLabel = computed(() =>
  props.data.handoffKind === "transcript-excerpt" ? "excerpt" : "distill",
);
</script>

<style scoped>
.lh-node {
  width: 230px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.lh-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.lh-node.waiting {
  border-color: var(--status-waiting);
}
.lh-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.lh-icon {
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
.lh-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--accent);
}
</style>
