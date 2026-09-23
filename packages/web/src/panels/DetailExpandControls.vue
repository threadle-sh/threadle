<script setup lang="ts">
defineProps<{
  expandTitle?: string;
  closeTitle?: string;
  /** Hide the expand control (close-only) */
  hideExpand?: boolean;
}>();

defineEmits<{
  expand: [];
  close: [];
}>();
</script>

<template>
  <div class="detail-expand-controls">
    <button
      v-if="!hideExpand"
      type="button"
      class="detail-icon-btn"
      :title="expandTitle ?? 'Expand'"
      @click="$emit('expand')"
    >
      □
    </button>
    <button
      type="button"
      class="detail-icon-btn"
      :title="closeTitle ?? 'Close'"
      @click="$emit('close')"
    >
      ✕
    </button>
  </div>
</template>
