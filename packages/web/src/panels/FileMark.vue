<template>
  <svg
    class="file-mark"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M4 1.75h5.25L13 5.5v8.75a.75.75 0 0 1-.75.75h-8.5A.75.75 0 0 1 3 14.25V2.5A.75.75 0 0 1 4 1.75zm5 1.1v2.9h2.9L9 2.85zM5.25 8.25h5.5v1.1h-5.5v-1.1zm0 2.5h5.5v1.1h-5.5v-1.1z"
    />
  </svg>
</template>

<script setup lang="ts"></script>

<style scoped>
.file-mark {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  display: block;
  color: var(--text-dim);
}
</style>
