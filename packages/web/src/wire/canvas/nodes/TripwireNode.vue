<template>
  <div
    class="trip-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle' }"
  >
    <InboundHandle :node-id="id" />
    <div class="t-head">
      <span class="t-icon">‡</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Circuit breaker"
        @update:label="(v) => (data.label = v)"
      />
    </div>
    <div class="t-row nodrag">
      <label class="t-label">mode</label>
      <select v-model="data.mode" class="t-select">
        <option value="spend">spend $</option>
        <option value="tokens">tokens</option>
        <option value="duration">duration</option>
        <option value="content">content</option>
        <option value="retries">retry fuse</option>
      </select>
    </div>
    <div class="t-row nodrag">
      <label class="t-label">on</label>
      <select v-model="data.action" class="t-select">
        <option value="abort">abort run</option>
        <option value="skip">skip branch</option>
        <option value="park">park · approve</option>
      </select>
    </div>
    <div v-if="data.mode === 'spend'" class="t-row nodrag">
      <label class="t-label">USD</label>
      <input
        v-model.number="data.thresholdUsd"
        class="t-input"
        type="number"
        min="0.01"
        step="0.01"
        placeholder="1.00"
      />
    </div>
    <div v-else-if="data.mode === 'tokens'" class="t-row nodrag">
      <label class="t-label">tok</label>
      <input
        v-model.number="data.thresholdTokens"
        class="t-input"
        type="number"
        min="1"
        step="1000"
        placeholder="100000"
      />
    </div>
    <div v-else-if="data.mode === 'duration'" class="t-row nodrag">
      <label class="t-label">sec</label>
      <input
        :value="msToSec(data.thresholdMs)"
        class="t-input"
        type="number"
        min="1"
        step="1"
        placeholder="60"
        @input="setSec(($event.target as HTMLInputElement).value)"
      />
    </div>
    <div v-else-if="data.mode === 'retries'" class="t-row nodrag">
      <label class="t-label">n</label>
      <input
        v-model.number="data.thresholdRetries"
        class="t-input"
        type="number"
        min="1"
        step="1"
        placeholder="3"
      />
    </div>
    <template v-else>
      <div class="t-row nodrag">
        <label class="t-label">min</label>
        <input
          v-model.number="data.minChars"
          class="t-input"
          type="number"
          min="0"
          step="1"
          placeholder="chars"
        />
      </div>
      <div class="t-row nodrag">
        <label class="t-label">re</label>
        <input
          v-model="data.pattern"
          class="t-input"
          type="text"
          placeholder="regex"
          spellcheck="false"
        />
      </div>
      <label class="t-check nodrag">
        <input v-model="data.tripOnMatch" type="checkbox" />
        trip on match
      </label>
    </template>
    <div class="t-sub">{{ subtitle }}</div>
    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-tripwire" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { NodeStatus, TripwireNodeData } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: TripwireNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

function msToSec(ms?: number): number | "" {
  if (ms == null || !Number.isFinite(ms)) return "";
  return Math.round(ms / 1000);
}

function setSec(raw: string): void {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) {
    delete props.data.thresholdMs;
    return;
  }
  props.data.thresholdMs = Math.round(n * 1000);
}

const subtitle = computed(() => {
  switch (props.data.mode) {
    case "spend":
      return "trip when run spend hits USD";
    case "tokens":
      return "trip on session tokens (or chars÷4)";
    case "duration":
      return "trip when run wall-clock exceeds";
    case "content":
      return props.data.tripOnMatch
        ? "trip when regex matches inbound text"
        : "trip on empty / short / non-matching text";
    case "retries":
      return "trip after N continue-on-error failures";
    default:
      return "";
  }
});
</script>

<style scoped>
.trip-node {
  width: 220px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.trip-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.t-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.t-icon {
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
.t-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.t-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  width: 34px;
  flex-shrink: 0;
}
.t-select,
.t-input {
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
.t-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  margin-bottom: 6px;
  cursor: pointer;
}
.t-sub {
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
