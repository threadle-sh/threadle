<template>
  <div v-if="open" class="wf-backdrop" @click.self="emit('close')">
    <div class="wf-modal">
      <div class="wf-modal-head mono">≔ workflow parameters</div>
      <p class="wf-hint">
        Reference a parameter as <span class="mono">{{ "\{\{param:name\}\}" }}</span>
        inside prompt text or converter templates. Run asks for values.
      </p>
      <div v-for="(pr, i) in params" :key="i" class="wf-param-row">
        <input
          v-model="pr.name"
          class="threadle-input wf-p-name mono"
          placeholder="name"
          spellcheck="false"
          @keydown.stop
        />
        <select v-model="pr.type" class="threadle-input wf-p-type mono">
          <option v-for="t in VALUE_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
        <input
          v-model="pr.default"
          class="threadle-input wf-p-default mono"
          placeholder="default"
          spellcheck="false"
          @keydown.stop
        />
        <button class="wf-p-del" title="Remove" @click="emit('remove-param', i)">✕</button>
      </div>
      <div class="micro-label" style="margin-top: 14px">runner</div>
      <div class="wf-param-row wf-run-row">
        <label class="wf-p-label mono">parallelism <em>max concurrency</em></label>
        <input
          class="threadle-input wf-p-value mono"
          type="number"
          min="1"
          max="32"
          :value="ply"
          @input="emit('update:ply', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="wf-param-row wf-run-row">
        <label class="wf-p-label mono">spend ceiling <em>USD</em></label>
        <input
          class="threadle-input wf-p-value mono"
          type="number"
          min="0"
          step="0.01"
          :value="spendTripwireUsd"
          placeholder="off"
          @input="emit('update:spend-tripwire-usd', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="wf-modal-actions">
        <button class="threadle-btn" @click="emit('add-param')">＋ add parameter</button>
        <span class="wf-spacer" />
        <button class="threadle-btn primary" @click="emit('close')">Done</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VALUE_TYPES, type WorkflowParam } from "@threadle/shared";

defineProps<{
  open: boolean;
  params: WorkflowParam[];
  ply: number;
  /** Empty string when unset (shows placeholder "off"). */
  spendTripwireUsd: number | "";
}>();

const emit = defineEmits<{
  close: [];
  "add-param": [];
  "remove-param": [index: number];
  "update:ply": [raw: string];
  "update:spend-tripwire-usd": [raw: string];
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
.wf-param-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wf-run-row {
  flex-wrap: wrap;
}
.wf-p-name { flex: 1; }
.wf-p-type { width: 90px; }
.wf-p-default { flex: 1; }
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
.wf-p-del {
  background: none;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}
.wf-p-del:hover { color: var(--status-error); }
.wf-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.wf-spacer { flex: 1; }
</style>
