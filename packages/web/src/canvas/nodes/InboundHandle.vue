<template>
  <Handle
    type="target"
    :id="handleId || undefined"
    :position="position"
    :class="['threadle-handle', handleClass]"
    :title="title"
    :style="{ borderColor: color }"
  />
</template>

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import { useInboundHandleColor } from "@/lib/useInboundHandleColor";

const props = withDefaults(
  defineProps<{
    nodeId: string;
    handleId?: string | null;
    position?: Position;
    handleClass?: string;
    /** Native tooltip on hover */
    title?: string;
  }>(),
  { position: Position.Left, title: "in" },
);

const color = useInboundHandleColor(
  () => props.nodeId,
  () => props.handleId,
);
</script>
