<template>
  <div class="sub-node" :class="{ selected, stale }">
    <Handle
      type="target"
      :position="Position.Top"
      title="in · parent"
      class="threadle-handle sub-in"
    />
    <div class="sub-circle" :style="{ borderColor: providerColor }">
      <span class="sub-glyph">⎇</span>
      <span class="status-dot sub-status" :class="status" />
    </div>
    <div class="sub-label" :title="title">{{ title }}</div>
    <div class="sub-agent">{{ agent }}</div>
    <Handle
      type="source"
      :position="Position.Right"
      title="out"
      class="threadle-handle sub-out"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import type { SessionNodeData } from "@threadle/shared";
import { useSessionsStore } from "@/stores/sessions";
import { shortId } from "@/lib/format";
import { providerColor as colorFor } from "@/lib/providers";

const props = defineProps<{
  id: string;
  data: SessionNodeData;
  selected?: boolean;
}>();

const sessions = useSessionsStore();

const live = computed(() =>
  sessions.find(props.data.ref.provider, props.data.ref.sessionId),
);
const stale = computed(() => props.data.resolved === false && !live.value);

const providerColor = computed(() => colorFor(props.data.ref.provider));

const title = computed(
  () =>
    live.value?.title ??
    props.data.snapshot?.title ??
    shortId(props.data.ref.sessionId),
);

const agent = computed(
  () => live.value?.agent ?? props.data.snapshot?.agent ?? "subagent",
);

const status = computed(() => live.value?.status ?? "idle");
</script>

<style scoped>
.sub-node {
  width: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
.sub-node.stale {
  opacity: 0.55;
}
.sub-circle {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--node-bg);
  border: 1.5px solid var(--border-strong);
  box-shadow: var(--shadow);
  display: grid;
  place-items: center;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.sub-node.selected .sub-circle {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.sub-glyph {
  font-size: var(--fs-2xl);
  color: var(--text-dim);
}
.sub-status {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 7px;
  height: 7px;
  border: 2px solid var(--canvas-bg);
  box-sizing: content-box;
}
.sub-label {
  max-width: 120px;
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub-agent {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  margin-top: -3px;
}
.threadle-handle {
  width: 8px;
  height: 8px;
  background: var(--node-bg);
  border: 2px solid var(--border-strong);
}
.sub-in {
  top: -3px;
}
.sub-out {
  top: 26px;
  border-color: var(--accent);
}
</style>
