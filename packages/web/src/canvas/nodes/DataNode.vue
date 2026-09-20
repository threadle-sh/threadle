<template>
  <div
    class="data-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="d-head">
      <span class="d-icon">◇</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Data"
        @update:label="(v) => (data.label = v)"
      />
      <select
        v-model="valueType"
        class="d-type nodrag mono"
        title="Value type — typed on the card, or coerced from an inbound wire"
      >
        <option v-for="t in VALUE_TYPES" :key="t" :value="t">{{ VALUE_TYPE_LABELS[t] }}</option>
      </select>
      <button
        class="d-clear nodrag"
        :disabled="!canClear"
        title="Clear stored value"
        @click="clearValue"
      >
        ⌫
      </button>
    </div>
    <textarea
      v-if="valueType === 'text' || valueType === 'json'"
      v-model="value"
      class="d-value nodrag nowheel"
      :placeholder="valueType === 'json' ? '{ … }' : 'value…'"
      rows="3"
      spellcheck="false"
    />
    <input
      v-else
      v-model="value"
      class="d-value d-value-line nodrag"
      type="text"
      :placeholder="placeholder"
      spellcheck="false"
    />
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-data" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import {
  VALUE_TYPES,
  VALUE_TYPE_LABELS,
  type DataNodeData,
  type GraphNodeData,
  type NodeStatus,
  type ValueType,
} from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: DataNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const { edges, findNode } = useVueFlow();

const valueType = computed({
  get: () => props.data.valueType ?? "text",
  set: (t: ValueType) => {
    props.data.valueType = t === "text" ? undefined : t;
  },
});

/** Pull a displayable string from a wired source without running the graph. */
function textFromSource(data: GraphNodeData | undefined): string | undefined {
  if (!data) return undefined;
  if (data.type === "data") {
    const v = data.value?.trim();
    return v || undefined;
  }
  if (data.type === "prompt") {
    const v = data.text?.trim();
    return v || undefined;
  }
  if (data.type === "output") {
    const v = (data.content ?? data.preview)?.trim();
    return v || undefined;
  }
  return undefined;
}

function sourceLabel(data: GraphNodeData | undefined): string | undefined {
  if (!data) return undefined;
  switch (data.type) {
    case "data":
      return data.label || "Data";
    case "prompt":
      return data.label || "Prompt";
    case "output":
      return "Output";
    case "custom":
      return data.snapshot?.label || data.ref.name;
    case "agent-def":
      return data.ref.name;
    case "delay":
      return "Delay";
    case "knot":
      return data.label || "Merge";
    case "tripwire":
      return data.label || "Tripwire";
    case "judge":
      return data.label || "Judge";
    case "until":
      return data.label || "Until";
    case "approval":
      return data.label || "Approval";
    case "iterator":
      return "Iterator";
    case "prompt-convert":
      return "Convert";
    case "live-handoff":
      return data.label || "Live handoff";
    case "session":
    case "subagent-run":
      return data.snapshot?.title || "Session";
    case "context":
      return data.label || data.kind;
    default:
      return data.type;
  }
}

const inboundEdges = computed(() =>
  edges.value.filter((e) => e.target === props.id),
);

const inboundPreview = computed(() => {
  const parts: string[] = [];
  for (const e of inboundEdges.value) {
    const src = findNode(e.source);
    const t = textFromSource(src?.data as GraphNodeData | undefined);
    if (t) parts.push(t);
  }
  return parts.length ? parts.join("\n\n") : undefined;
});

const inboundFromLabel = computed(() => {
  if (inboundPreview.value) return undefined;
  const names: string[] = [];
  for (const e of inboundEdges.value) {
    const src = findNode(e.source);
    const label = sourceLabel(src?.data as GraphNodeData | undefined);
    if (label) names.push(label);
  }
  return names.length ? names.join(" · ") : undefined;
});

const value = computed({
  get: () => {
    // Prefer the stored field; fall back to live inbound (e.g. Output.content)
    // so a Data wired after Output shows the string without looking empty.
    const local = props.data.value;
    if (local != null && local !== "") return local;
    return inboundPreview.value ?? local ?? "";
  },
  set: (v: string) => {
    props.data.value = v;
  },
});

const canClear = computed(() => !!(props.data.value ?? "").length);

function clearValue(): void {
  props.data.value = undefined;
}

const placeholder = computed(() => {
  if (inboundFromLabel.value) {
    return `from ${inboundFromLabel.value} · run to coerce`;
  }
  switch (valueType.value) {
    case "int":
      return "0";
    case "float":
      return "0.0";
    case "bool":
      return "true";
    default:
      return "value…";
  }
});
</script>

<style scoped>
.data-node {
  width: 220px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.data-node.selected {
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
  background: var(--wire-data);
  color: #0a0a0b;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.d-type {
  appearance: none;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-2xs);
  font-family: var(--mono);
  padding: 2px 6px;
  outline: none;
  cursor: pointer;
  flex: 0 0 auto;
  max-width: 72px;
}
.d-type:focus {
  border-color: var(--accent);
}
.d-clear {
  appearance: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
}
.d-clear:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--hover-overlay);
}
.d-clear:disabled {
  opacity: 0.35;
  cursor: default;
}
.d-value {
  width: 100%;
  box-sizing: border-box;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--mono);
  padding: 6px 8px;
  outline: none;
  resize: vertical;
  min-height: 52px;
  line-height: 1.4;
}
.d-value-line {
  min-height: 0;
  resize: none;
  height: 28px;
  padding: 4px 8px;
}
.d-value:focus {
  border-color: var(--accent);
}
</style>
