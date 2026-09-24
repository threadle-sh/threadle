<template>
  <div v-if="open" class="wf-backdrop" @click.self="emit('close')">
    <div class="wf-modal">
      <div class="wf-modal-head mono">▶ run — parameters</div>
      <div v-for="pr in params" :key="pr.name" class="wf-param-row wf-run-row">
        <label class="wf-p-label mono">{{ pr.name }} <em>{{ pr.type }}</em></label>
        <input
          v-model="draft[pr.name]"
          class="threadle-input wf-p-value mono"
          :placeholder="pr.default || pr.type"
          spellcheck="false"
          @keydown.stop
          @keydown.enter="emit('submit')"
        />
        <span v-if="errors[pr.name]" class="wf-p-err">{{ errors[pr.name] }}</span>
      </div>
      <div class="wf-modal-actions">
        <button class="threadle-btn" @click="emit('close')">Cancel</button>
        <span class="wf-spacer" />
        <button class="threadle-btn primary" @click="emit('submit')">▶ Run</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WorkflowParam } from "@threadle/shared";

defineProps<{
  open: boolean;
  params: WorkflowParam[];
  /** Mutated in place (same object the parent holds). */
  draft: Record<string, string>;
  errors: Record<string, string>;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
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
.wf-param-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wf-run-row {
  flex-wrap: wrap;
}
.wf-p-label {
  width: 140px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
}
.wf-p-label em {
  color: var(--text-faint);
  font-style: normal;
  font-size: var(--fs-2xs);
}
.wf-p-value { flex: 1; }
.wf-p-err {
  width: 100%;
  color: var(--status-error);
  font-size: var(--fs-xs);
}
.wf-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.wf-spacer { flex: 1; }
</style>
