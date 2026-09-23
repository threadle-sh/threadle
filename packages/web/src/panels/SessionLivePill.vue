<template>
  <span
    v-if="status === 'waiting' || status === 'running'"
    class="session-live-pill"
    :class="status"
    :title="title"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SessionStatus } from "@threadle/shared";

const props = defineProps<{
  status?: SessionStatus;
  /** Live deriveRunPhase label when a threadle job owns this session */
  phase?: string;
}>();

const label = computed(() => {
  if (props.status === "waiting") return "needs input";
  if (props.status === "running") {
    const p = props.phase?.trim();
    return p || "running";
  }
  return "";
});

const title = computed(() => {
  if (props.status === "waiting") {
    return "Session is waiting for you — permission, approval, or other input";
  }
  if (props.status === "running") {
    const p = props.phase?.trim();
    return p
      ? `Agent phase: ${p}`
      : "Agent is actively working in this session";
  }
  return "";
});
</script>
