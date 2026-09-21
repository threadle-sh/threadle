<template>
  <svg
    class="growth-mark"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- axes -->
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      d="M2.5 13.5h11M2.5 13.5V2.5"
      opacity="0.45"
    />
    <!-- rising line -->
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M3.5 11.5 6.25 8.75 8.5 9.75 12.5 4"
    />
  </svg>
</template>

<script setup lang="ts"></script>

<style scoped>
.growth-mark {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  display: block;
  color: var(--text-dim);
}
</style>
