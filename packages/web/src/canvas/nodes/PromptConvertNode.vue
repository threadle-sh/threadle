<template>
  <div
    class="conv-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="c-head">
      <span class="c-icon">⇄</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Text → Prompt"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <textarea
      v-model="data.template"
      class="c-text nodrag nowheel"
      placeholder="Template — use {{input}} for the incoming text, e.g.:&#10;Implement the following plan:&#10;&#10;{{input}}"
      rows="4"
      spellcheck="false"
    />
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-prompt-convert" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { NodeStatus, PromptConvertNodeData } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

defineProps<{
  id: string;
  data: PromptConvertNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();
</script>

<style scoped>
.conv-node {
  width: 260px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.conv-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.c-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.c-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--wire-prompt-convert);
  color: #3a2f08;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.c-text {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--mono);
  padding: 8px;
  resize: vertical;
  min-height: 70px;
  outline: none;
  line-height: 1.45;
}
.c-text:focus {
  border-color: var(--accent);
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--accent);
}
</style>
