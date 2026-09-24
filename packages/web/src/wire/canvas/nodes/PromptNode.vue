<template>
  <div
    class="prompt-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <div class="p-head">
      <span class="p-icon">✎</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Prompt"
        @update:label="(v) => (data.label = v)"
      />
      <select
        v-model="valueType"
        class="p-type nodrag mono"
        title="The value type this prompt emits — typed nodes downstream validate it"
      >
        <option v-for="t in VALUE_TYPES" :key="t" :value="t">{{ t }}</option>
      </select>
    </div>
    <textarea
      v-model="data.text"
      class="p-text nodrag nowheel"
      placeholder="Type the prompt to feed into an agent…"
      rows="4"
      spellcheck="false"
    />
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-prompt" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import {
  VALUE_TYPES,
  type NodeStatus,
  type PromptNodeData,
  type ValueType,
} from "@threadle/shared";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: PromptNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const valueType = computed({
  get: () => props.data.valueType ?? "text",
  set: (t: ValueType) => {
    props.data.valueType = t === "text" ? undefined : t;
  },
});
</script>

<style scoped>
.prompt-node {
  width: 260px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.prompt-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.p-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.p-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--wire-prompt);
  color: #0a0a0b;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
}
.p-type {
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  padding: 2px 4px;
  outline: none;
  cursor: pointer;
}
.p-type:focus,
.p-type:hover {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.p-text {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--font);
  padding: 8px;
  resize: vertical;
  min-height: 70px;
  outline: none;
  line-height: 1.45;
}
.p-text:focus {
  border-color: var(--accent);
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--accent);
}
</style>
