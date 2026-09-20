<template>
  <!-- plain manifests keep the compact card; ports/params get the extended one -->
  <NodeCard
    v-if="!extended"
    :id="id"
    :glyph="glyph"
    icon-bg="var(--wire-custom)"
    :title="fallbackTitle"
    :label="data.label"
    renamable
    :subtitle="subtitle"
    :status="status ?? 'idle'"
    :run-status="status ?? 'idle'"
    :selected="selected"
    has-input
    has-output
    out-handle-color="var(--wire-custom)"
    @update:label="(v) => (data.label = v)"
  />
  <div
    v-else
    class="custom-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <div class="c-head">
      <div class="icon-tile"><span class="glyph">{{ glyph }}</span></div>
      <div class="c-body">
        <EditableNodeTitle
          :label="data.label"
          :fallback="fallbackTitle"
          @update:label="(v) => (data.label = v)"
        />
        <div class="c-sub" :title="subtitle">{{ subtitle }}</div>
      </div>
    </div>

    <div v-if="inPorts.length || outPorts.length" class="c-ports">
      <div class="c-col c-in">
        <div v-for="p in inPorts" :key="p.name" class="c-port">
          <InboundHandle
            :node-id="id"
            :handle-id="`in:${p.name}`"
            handle-class="port-handle in"
            :title="`in · ${p.name}`"
          />
          <span class="p-name" :class="{ optional: p.required === false }">{{ p.name }}</span>
          <span v-if="(p.maxConnections ?? 1) > 1" class="p-cap mono" title="max connections">×{{ p.maxConnections }}</span>
          <span v-if="p.type !== 'text'" class="p-type mono">{{ p.type }}</span>
        </div>
        <!-- legacy single input when only outputs are named -->
        <div v-if="!inPorts.length" class="c-port">
          <InboundHandle :node-id="id" handle-class="port-handle in" title="in" />
          <span class="p-name dim">input</span>
        </div>
      </div>
      <div class="c-col c-out">
        <div v-for="p in outPorts" :key="p.name" class="c-port out">
          <span v-if="p.type !== 'text'" class="p-type mono">{{ p.type }}</span>
          <span v-if="(p.maxConnections ?? 1) > 1" class="p-cap mono" title="max connections">×{{ p.maxConnections }}</span>
          <span class="p-name">{{ p.name }}</span>
          <Handle
            :id="`out:${p.name}`"
            type="source"
            :position="Position.Right"
            :title="`out · ${p.name}`"
            class="threadle-handle port-handle out wire-custom"
          />
        </div>
        <!-- legacy single output when only inputs are named -->
        <div v-if="!outPorts.length" class="c-port out">
          <span class="p-name dim">output</span>
          <Handle
            type="source"
            :position="Position.Right"
            title="out"
            class="threadle-handle port-handle out wire-custom"
          />
        </div>
      </div>
    </div>
    <template v-else>
      <!-- params only: keep the plain single lane -->
      <InboundHandle :node-id="id" handle-class="head-handle" title="in" />
      <Handle
        type="source"
        :position="Position.Right"
        title="out"
        class="threadle-handle head-handle wire-custom"
      />
    </template>

    <div v-if="def?.params?.length" class="c-widgets nodrag">
      <label
        v-for="p in def.params"
        :key="p.name"
        class="c-widget"
        :class="{ invalid: !!errorOf(p) }"
        :title="errorOf(p) ?? p.description ?? ''"
      >
        <span class="w-label">{{ p.label ?? p.name }}</span>
        <select v-if="p.type === 'choice'" class="w-input" :value="valueOf(p)" @change="set(p, ($event.target as HTMLSelectElement).value)">
          <option v-for="o in p.options" :key="o" :value="o">{{ o }}</option>
        </select>
        <input
          v-else-if="p.type === 'bool'"
          type="checkbox"
          class="w-check"
          :checked="/^(true|1)$/i.test(valueOf(p))"
          @change="set(p, ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
        />
        <input
          v-else-if="p.type === 'int' || p.type === 'float'"
          type="number"
          class="w-input mono"
          :min="p.min"
          :max="p.max"
          :step="p.type === 'int' ? 1 : 'any'"
          :value="valueOf(p)"
          :placeholder="p.default ?? ''"
          @input="set(p, ($event.target as HTMLInputElement).value)"
        />
        <textarea
          v-else-if="p.type === 'json' || p.multiline"
          class="w-input w-area mono nowheel"
          rows="2"
          spellcheck="false"
          :value="valueOf(p)"
          :placeholder="p.default ?? ''"
          @input="set(p, ($event.target as HTMLTextAreaElement).value)"
        />
        <input
          v-else
          class="w-input"
          :value="valueOf(p)"
          :placeholder="p.default ?? ''"
          spellcheck="false"
          @input="set(p, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <span class="status-dot" :class="status ?? 'idle'" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import type { CustomNodeData, CustomParamDef, CustomPortDef, NodeStatus } from "@threadle/shared";
import { paramValueError } from "@threadle/shared";
import NodeCard from "./NodeCard.vue";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";
import { useCustomNodes } from "@/stores/custom-nodes";

const props = defineProps<{
  id: string;
  data: CustomNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const customNodes = useCustomNodes();
const { updateNodeInternals } = useVueFlow();

const def = computed(() =>
  customNodes.defs.find((d) => d.name === props.data.ref.name),
);

const inPorts = computed<CustomPortDef[]>(
  () => def.value?.inputs ?? props.data.snapshot?.inputs ?? [],
);
const outPorts = computed<CustomPortDef[]>(
  () => def.value?.outputs ?? props.data.snapshot?.outputs ?? [],
);
const extended = computed(
  () => inPorts.value.length > 0 || outPorts.value.length > 0 || !!def.value?.params?.length,
);

// handles move when the manifest resolves (async) — tell Vue Flow to remeasure
watch([extended, () => inPorts.value.length, () => outPorts.value.length], () => {
  void updateNodeInternals([props.id]);
});

const glyph = computed(
  () => def.value?.glyph ?? props.data.snapshot?.glyph ?? "⌁",
);
const fallbackTitle = computed(
  () => def.value?.label ?? props.data.snapshot?.label ?? props.data.ref.name,
);
const subtitle = computed(() => {
  const base = def.value
    ? def.value.description ?? "custom node"
    : "custom node (manifest missing)";
  if (extended.value) return base;
  const inT = def.value?.input ?? props.data.snapshot?.input ?? "text";
  const outT = def.value?.output ?? props.data.snapshot?.output ?? "text";
  return inT !== "text" || outT !== "text" ? `${base} · ${inT} → ${outT}` : base;
});

function valueOf(p: CustomParamDef): string {
  return props.data.params?.[p.name] ?? p.default ?? "";
}

function set(p: CustomParamDef, v: string): void {
  // stored values stay lean: dropping back to the default clears the override
  if (v === (p.default ?? "")) {
    if (props.data.params) {
      delete props.data.params[p.name];
      if (!Object.keys(props.data.params).length) delete props.data.params;
    }
    return;
  }
  (props.data.params ??= {})[p.name] = v;
}

function errorOf(p: CustomParamDef): string | undefined {
  return paramValueError(valueOf(p), p);
}
</script>

<style scoped>
.custom-node {
  display: flex;
  flex-direction: column;
  width: 240px;
  padding: 10px 12px 14px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  position: relative;
  transition: border-color 0.12s, background 0.12s;
}
.custom-node:hover {
  background: var(--node-bg-hover);
}
.custom-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.c-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.icon-tile {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--context);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.glyph {
  font-size: var(--fs-2xl);
  color: #fff;
}
.c-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.c-sub {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.c-ports {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}
.c-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.c-port {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  font-size: var(--fs-xs);
}
.c-port.out {
  justify-content: flex-end;
}
.p-name {
  color: var(--text);
  white-space: nowrap;
}
.p-name.optional::after {
  content: "?";
  color: var(--text-faint);
}
.p-name.dim {
  color: var(--text-faint);
}
.p-type {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 3px;
}
.p-cap {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.port-handle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}
.port-handle.in {
  left: -18px;
}
.port-handle.out {
  right: -18px;
}
.head-handle {
  top: 28px;
}

.c-widgets {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.c-widget {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
}
.w-label {
  color: var(--text-dim);
  min-width: 62px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.w-input {
  flex: 1;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-xs);
  font-family: var(--font);
  padding: 3px 6px;
  outline: none;
}
.w-input:focus {
  border-color: var(--accent);
}
.w-area {
  resize: vertical;
  min-height: 34px;
  line-height: 1.4;
}
.w-check {
  accent-color: var(--accent);
}
.c-widget.invalid .w-input {
  border-color: var(--error, #e5484d);
}

.status-dot {
  position: absolute;
  bottom: 8px;
  left: 8px;
  width: 7px;
  height: 7px;
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
</style>
