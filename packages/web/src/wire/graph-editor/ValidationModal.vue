<template>
  <div v-if="open" class="wf-backdrop" @click.self="emit('close')">
    <div class="wf-modal">
      <div class="wf-modal-head mono">✗ cannot run</div>
      <p class="wf-hint">Fix these before starting:</p>
      <ul class="wf-gate-list mono">
        <li
          v-for="(i, idx) in issues"
          :key="i.nodeId + i.kind + idx"
          class="wf-val-item"
          @click="emit('focus-issue', i)"
        >
          <span class="wf-val-label">{{ i.label }}</span>
          <span class="wf-val-msg">{{ i.message }}</span>
        </li>
      </ul>
      <div class="wf-modal-actions">
        <span class="wf-spacer" />
        <button class="threadle-btn primary" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WorkflowIssue } from "@threadle/shared";

defineProps<{
  open: boolean;
  issues: WorkflowIssue[];
}>();

const emit = defineEmits<{
  close: [];
  "focus-issue": [issue: WorkflowIssue];
}>();
</script>

<style scoped>
.wf-backdrop {
  position: absolute;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
}
.wf-modal {
  width: 480px;
  max-width: 92%;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wf-modal-head {
  font-size: var(--fs-md);
  font-weight: 700;
}
.wf-hint {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.wf-gate-list {
  margin: 0;
  padding-left: 1.2em;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.55;
}
.wf-val-item {
  cursor: pointer;
  list-style: disc;
  margin: 4px 0;
}
.wf-val-item:hover .wf-val-label {
  color: var(--text);
}
.wf-val-label {
  color: var(--text);
}
.wf-val-msg {
  color: var(--text-faint);
}
.wf-val-msg::before {
  content: " — ";
  color: var(--text-faint);
}
.wf-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.wf-spacer { flex: 1; }
</style>
