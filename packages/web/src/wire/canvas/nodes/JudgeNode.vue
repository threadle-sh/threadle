<template>
  <div
    class="judge-node"
    :class="{ selected, [`run-${status}`]: status && status !== 'idle', waiting }"
  >
    <InboundHandle :node-id="id" />
    <div class="j-head">
      <span class="j-icon">?</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Judge"
        @update:label="(v) => (data.label = v)"
      />
    </div>

    <div class="j-row nodrag">
      <label class="j-label">miss</label>
      <select v-model="data.unmatched" class="j-select">
        <option value="unsure">unsure</option>
        <option value="park">park · approve</option>
      </select>
    </div>

    <div class="j-matchers nodrag">
      <div v-for="(m, i) in data.matchers" :key="m.id" class="j-matcher">
        <select v-model="m.port" class="j-port">
          <option value="pass">pass</option>
          <option value="fail">fail</option>
        </select>
        <select v-model="m.kind" class="j-kind">
          <option value="contains">has</option>
          <option value="regex">re</option>
        </select>
        <input
          v-model="m.pattern"
          class="j-pat"
          type="text"
          :placeholder="m.kind === 'regex' ? 'regex' : 'substring'"
          spellcheck="false"
        />
        <button
          type="button"
          class="j-rm"
          title="remove matcher"
          @click="removeMatcher(i)"
        >
          ×
        </button>
      </div>
      <button type="button" class="j-add" @click="addMatcher">+ matcher</button>
    </div>

    <div class="j-outs">
      <div v-for="port in JUDGE_PORTS" :key="port" class="j-out">
        <input
          class="j-out-label nodrag"
          type="text"
          :value="portLabel(port)"
          :placeholder="port"
          spellcheck="false"
          @input="setPortLabel(port, ($event.target as HTMLInputElement).value)"
        />
        <Handle
          :id="`out:${port}`"
          type="source"
          :position="Position.Right"
          :title="`out · ${portLabel(port)}`"
          class="threadle-handle port-handle wire-judge"
        />
      </div>
    </div>

    <div class="j-sub">{{ subtitle }}</div>
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { JudgeNodeData, JudgePort, NodeStatus } from "@threadle/shared";
import { JUDGE_PORTS, judgePortLabel } from "@threadle/shared";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: JudgeNodeData;
  selected?: boolean;
  status?: NodeStatus;
  waiting?: boolean;
}>();

function portLabel(port: JudgePort): string {
  return judgePortLabel(props.data, port);
}

function setPortLabel(port: JudgePort, raw: string): void {
  const v = raw.trim();
  if (!v || v === port) {
    if (props.data.portLabels) {
      delete props.data.portLabels[port];
      if (!Object.keys(props.data.portLabels).length) delete props.data.portLabels;
    }
    return;
  }
  (props.data.portLabels ??= {})[port] = v;
}

function addMatcher(): void {
  props.data.matchers.push({
    id: `m-${crypto.randomUUID().slice(0, 6)}`,
    port: "pass",
    kind: "contains",
    pattern: "",
  });
}

function removeMatcher(i: number): void {
  props.data.matchers.splice(i, 1);
}

const subtitle = computed(() => {
  const n = props.data.matchers?.length ?? 0;
  const miss = props.data.unmatched === "park" ? "park on miss" : "unsure on miss";
  return `${n} matcher${n === 1 ? "" : "s"} · first hit wins · ${miss}`;
});
</script>

<style scoped>
.judge-node {
  width: 260px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px 12px;
  transition: border-color 0.12s;
  position: relative;
}
.judge-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.judge-node.waiting {
  border-color: var(--status-waiting);
}
.j-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.j-icon {
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
.j-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.j-label {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  width: 34px;
  flex-shrink: 0;
}
.j-select,
.j-port,
.j-kind,
.j-pat,
.j-out-label {
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-xs);
  font-family: var(--mono);
  padding: 4px 6px;
  outline: none;
}
.j-select {
  flex: 1;
  min-width: 0;
}
.j-matchers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.j-matcher {
  display: flex;
  align-items: center;
  gap: 4px;
}
.j-port {
  width: 52px;
  flex-shrink: 0;
  padding: 3px 2px;
}
.j-kind {
  width: 44px;
  flex-shrink: 0;
  padding: 3px 2px;
}
.j-pat {
  flex: 1;
  min-width: 0;
  padding: 3px 5px;
}
.j-rm {
  flex-shrink: 0;
  width: 20px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--fs-md);
  line-height: 1;
  padding: 0;
}
.j-rm:hover {
  color: var(--text);
}
.j-add {
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  padding: 2px 0;
}
.j-add:hover {
  color: var(--text);
}
.j-outs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.j-out {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 22px;
  padding-right: 4px;
}
.j-out-label {
  width: 88px;
  text-align: right;
  padding: 2px 5px;
  font-size: var(--fs-2xs);
}
.port-handle {
  position: absolute;
  right: -18px;
  top: 50%;
  transform: translateY(-50%);
}
.j-sub {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--wire-judge);
}
</style>
