<template>
  <div
    class="until-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="u-head">
      <span class="u-icon">↻</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Until"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="u-row nodrag">
      <label class="u-label">max</label>
      <input
        class="u-input"
        type="number"
        min="1"
        max="8"
        step="1"
        :value="maxIterations"
        @input="onMax"
      />
    </div>
    <div class="u-outs">
      <div class="u-out">
        <span class="u-out-label">reenter</span>
        <Handle
          id="out:reenter"
          type="source"
          :position="Position.Right"
          title="out · reenter"
          class="threadle-handle port-handle wire-until"
        />
      </div>
      <div class="u-out">
        <span class="u-out-label">exhausted</span>
        <Handle
          id="out:exhausted"
          type="source"
          :position="Position.Right"
          title="out · exhausted"
          class="threadle-handle port-handle wire-until"
        />
      </div>
    </div>
    <div class="u-sub">counted re-entry · cap {{ maxIterations }} · not a free cycle</div>
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeStatus, UntilNodeData } from "@threadle/shared";
import { clampUntilMaxIterations } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: UntilNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const maxIterations = computed(() => clampUntilMaxIterations(props.data.maxIterations));

function onMax(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value);
  props.data.maxIterations = clampUntilMaxIterations(raw);
}
</script>

<style scoped>
.until-node {
  width: 200px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.until-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.u-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.u-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--status-waiting);
  color: #0a0a0b;
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.u-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.u-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  width: 34px;
  flex-shrink: 0;
}
.u-input {
  flex: 1;
  min-width: 0;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-xs);
  font-family: var(--mono);
  padding: 4px 6px;
  outline: none;
}
.u-outs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.u-out {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 22px;
  padding-right: 4px;
}
.u-out-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.port-handle {
  position: absolute;
  right: -18px;
  top: 50%;
  transform: translateY(-50%);
}
.u-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--wire-until);
}
</style>
