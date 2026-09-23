<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";

const props = defineProps<{
  open: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

function onKey(e: KeyboardEvent): void {
  if (!props.open || e.key !== "Escape") return;
  emit("close");
  e.preventDefault();
  e.stopPropagation();
}

onMounted(() => document.addEventListener("keydown", onKey, true));
onUnmounted(() => document.removeEventListener("keydown", onKey, true));

watch(
  () => props.open,
  (open) => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = open ? "hidden" : "";
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="detail-expand-backdrop"
      @click.self="$emit('close')"
    >
      <div
        class="detail-expand-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="label || 'Details'"
        @click.stop
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
