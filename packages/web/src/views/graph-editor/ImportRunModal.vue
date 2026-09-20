<template>
  <div v-if="open" class="wf-backdrop" @click.self="emit('close')">
    <div class="wf-modal">
      <div class="wf-modal-head mono">⚠ imported workflow</div>
      <p class="wf-hint">
        This workflow came from imported JSON and has not run before. Review
        what it will execute — agents run under <b>your</b> credentials, custom
        nodes run <b>your</b> installed code with the parameters below.
      </p>
      <div class="wf-gate-block">
        <div class="micro-label">on ▶ it will execute</div>
        <ul v-if="manifest.length" class="wf-gate-list mono">
          <li v-for="it in manifest" :key="it.nodeId" class="wf-gate-item" :class="{ muted: it.muted }">
            <span class="kind">[{{ it.kind }}]</span>
            {{ it.label }} — {{ it.detail }}<template v-if="it.muted"> (muted)</template>
            <div v-for="fl in it.flags ?? []" :key="fl" class="flag">{{ fl }}</div>
          </li>
        </ul>
        <p v-else class="wf-hint mono">no executing nodes — prompts / outputs only</p>
      </div>
      <p class="wf-hint">
        Only confirm workflows from sources you trust. Confirming is remembered
        for this workflow.
      </p>
      <div class="wf-modal-actions">
        <button class="threadle-btn" @click="emit('close')">Cancel</button>
        <span class="wf-spacer" />
        <button class="threadle-btn primary" @click="emit('confirm')">Confirm &amp; run</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ManifestItem } from "@threadle/shared";

defineProps<{
  open: boolean;
  manifest: ManifestItem[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
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
  width: 520px;
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
.wf-gate-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-bg-raised);
  max-height: 300px;
  overflow-y: auto;
}
.wf-gate-list {
  margin: 0;
  padding-left: 1.2em;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.55;
}
.wf-gate-item {
  list-style: disc;
  margin: 4px 0;
}
.wf-gate-item.muted {
  color: var(--text-faint);
}
.kind {
  color: var(--text-faint);
}
.flag {
  color: var(--text-faint);
  padding-left: 1em;
}
.wf-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.wf-spacer { flex: 1; }
</style>
