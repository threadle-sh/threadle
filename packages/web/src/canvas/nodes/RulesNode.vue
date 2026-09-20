<template>
  <NodeCard
    :id="id"
    glyph="§"
    icon-bg="var(--lane-session)"
    :title="fallbackTitle"
    :label="data.label"
    renamable
    :subtitle="data.source || 'rules file'"
    :status="nodeStatus"
    :run-status="nodeStatus"
    :selected="selected"
    :has-input="false"
    has-output
    out-handle-color="var(--wire-rules)"
    @update:label="(v) => (data.label = v)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NodeStatus, RulesNodeData } from "@threadle/shared";
import NodeCard from "./NodeCard.vue";

const props = defineProps<{
  id: string;
  data: RulesNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const fallbackTitle = computed(() => props.data.name || "Rules");
const nodeStatus = computed(() => props.status ?? "idle");
</script>
