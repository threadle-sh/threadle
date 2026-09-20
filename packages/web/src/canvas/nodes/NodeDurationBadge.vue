<template>
  <span
    v-if="label"
    class="node-dur"
    :class="status"
    :title="title"
  >{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NodeType } from "@threadle/shared";
import { useGraphStore } from "@/stores/graph";
import { fmtNodeDuration } from "@/lib/format";

/** Sources / sinks / chrome — no wall-clock badge (near-instant or non-executing). */
const STATIC_NODE_TYPES = new Set<NodeType>([
  "prompt",
  "data",
  "output",
  "prompt-convert",
  "note",
  "group",
  "subagent-run",
]);

const props = defineProps<{ nodeId: string }>();
const store = useGraphStore();

const node = computed(() => store.nodeById(props.nodeId));
const status = computed(() => node.value?.status);
const ms = computed(() => node.value?.lastDurationMs);

const label = computed(() => {
  const n = node.value;
  if (!n || STATIC_NODE_TYPES.has(n.data.type)) return "";
  const d = ms.value;
  if (d == null || (status.value !== "success" && status.value !== "error")) return "";
  return fmtNodeDuration(d);
});

const title = computed(() =>
  label.value ? `Ran in ${label.value} (input → output)` : "",
);
</script>

<style scoped>
.node-dur {
  position: absolute;
  top: calc(100% + 3px);
  right: 0;
  z-index: 5;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 1;
  color: var(--text-dim);
  pointer-events: none;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.node-dur.success {
  color: var(--text-dim);
}
.node-dur.error {
  color: var(--status-error);
}
</style>
