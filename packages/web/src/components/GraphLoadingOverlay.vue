<template>
  <div
    v-if="loading || error"
    class="graph-load-overlay"
    :class="{ 'is-error': !!error && !loading }"
    :aria-busy="loading || undefined"
  >
    <div v-if="loading" class="graph-spinner" :aria-label="label" />
    <div v-else class="graph-load-msg">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean;
    error?: string;
    label?: string;
  }>(),
  { label: "Loading" },
);
</script>

<style scoped>
.graph-load-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  z-index: 5;
}
.graph-load-overlay.is-error {
  pointer-events: auto;
}
.graph-spinner {
  width: 22px;
  height: 22px;
  border: 1.5px solid var(--border);
  border-top-color: var(--text-dim);
  border-radius: 50%;
  animation: graph-spin 0.7s linear infinite;
}
@keyframes graph-spin {
  to {
    transform: rotate(360deg);
  }
}
.graph-load-msg {
  padding: 28px 36px;
  color: var(--status-error);
  font-size: var(--fs-sm);
  text-align: center;
  max-width: 28rem;
}
</style>
