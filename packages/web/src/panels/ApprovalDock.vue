<template>
  <div class="approval-dock" @click.stop>
    <div class="approval-head mono">
      ✓ approval gate — review or splice the text before the run continues
    </div>
    <textarea
      v-model="text"
      class="approval-text nowheel approval-edit"
      spellcheck="false"
    />
    <div class="approval-actions">
      <button class="threadle-btn primary" @click="emit('approve')">
        ✓ approve · continue
      </button>
      <button class="threadle-btn danger" @click="emit('reject')">
        ✕ reject · stop run
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const text = defineModel<string>("text", { required: true });

const emit = defineEmits<{
  approve: [];
  reject: [];
}>();
</script>

<style scoped>
.approval-dock {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  width: min(680px, 84%);
  background: var(--panel-bg);
  border: 1px solid var(--status-waiting);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.approval-head {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--status-waiting);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.approval-text {
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dim);
}
.approval-edit {
  width: 100%;
  min-height: 160px;
  resize: vertical;
  color: var(--text);
  outline: none;
}
.approval-edit:focus {
  border-color: var(--accent);
}
.approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
