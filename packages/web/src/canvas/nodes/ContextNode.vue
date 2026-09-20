<template>
  <NodeCard
    :id="id"
    :glyph="glyph"
    icon-bg="var(--context)"
    :title="fallbackTitle"
    :label="data.label"
    renamable
    :subtitle="subtitle"
    :status="nodeStatus"
    :run-status="nodeStatus"
    :selected="selected"
    has-input
    has-output
    out-handle-color="var(--wire-context)"
    @update:label="(v) => (data.label = v)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ContextNodeData, NodeStatus } from "@threadle/shared";
import NodeCard from "./NodeCard.vue";

const props = defineProps<{
  id: string;
  data: ContextNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const KIND_META: Record<string, { glyph: string; label: string }> = {
  "distilled-summary": { glyph: "≡", label: "Distilled summary" },
  "transcript-excerpt": { glyph: "❝", label: "Transcript excerpt" },
  files: { glyph: "▤", label: "Files / artifacts" },
};

const glyph = computed(() => KIND_META[props.data.kind]?.glyph ?? "◆");
const fallbackTitle = computed(
  () => KIND_META[props.data.kind]?.label ?? props.data.kind,
);
const subtitle = computed(() =>
  props.data.payloadHash
    ? `materialized · ${props.data.payloadHash.slice(0, 8)}`
    : "not materialized",
);
const nodeStatus = computed(() => props.status ?? "idle");
</script>
