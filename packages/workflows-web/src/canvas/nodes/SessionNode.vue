<template>
  <NodeCard
    :id="id"
    :glyph="isSubagent ? '⎇' : '❯'"
    :icon-bg="providerColor"
    :title="fallbackTitle"
    :label="data.label"
    renamable
    :subtitle="subtitle"
    :status="liveStatus"
    :run-status="status ?? 'idle'"
    :selected="selected"
    :stale="stale"
    has-input
    has-output
    :has-sub-output="!isSubagent"
    :out-handle-color="providerColor"
    @update:label="(v) => (data.label = v)"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NodeStatus } from "@threadle/shared";
import type { SessionNodeData } from "@threadle/workflows-shared";
import NodeCard from "./NodeCard.vue";
import { useSessionsStore } from "@ui/stores/sessions";
import { basename, relativeTime, shortId } from "@ui/lib/format";
import { providerColor as colorFor } from "@ui/lib/providers";

const props = defineProps<{
  id: string;
  data: SessionNodeData;
  selected?: boolean;
  /** graph-run status (border highlight); the dot shows live provider status */
  status?: NodeStatus;
}>();

const sessions = useSessionsStore();

const live = computed(() =>
  sessions.find(props.data.ref.provider, props.data.ref.sessionId),
);

const isSubagent = computed(() => props.data.type === "subagent-run");
const stale = computed(() => props.data.resolved === false && !live.value);

const providerColor = computed(() => colorFor(props.data.ref.provider));

const fallbackTitle = computed(
  () =>
    live.value?.title ??
    props.data.snapshot?.title ??
    shortId(props.data.ref.sessionId),
);

const subtitle = computed(() => {
  const s = live.value;
  const dir = basename(s?.projectDir ?? props.data.snapshot?.projectDir);
  const agent = s?.agent ?? props.data.snapshot?.agent;
  const time = s ? relativeTime(s.updatedAt) : "";
  return [agent, dir, time].filter(Boolean).join(" · ");
});

const liveStatus = computed(() => live.value?.status ?? "idle");
</script>
