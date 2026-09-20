<template>
  <svg
    class="folder-mark"
    :class="{ open }"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M2 3.25h3.5l1.25 1.35H14a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H2a.75.75 0 0 1-.75-.75v-9A.75.75 0 0 1 2 3.25z"
    />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ open?: boolean }>();
</script>

<style scoped>
.folder-mark {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  display: block;
  color: var(--text-dim);
}
.folder-mark.open {
  color: var(--text);
}
</style>
