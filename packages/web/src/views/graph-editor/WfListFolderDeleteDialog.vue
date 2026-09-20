<template>
  <Teleport to="body">
    <div
      v-if="target"
      class="wf-name-backdrop"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
        <header class="wf-name-head">
          <div class="wf-name-title mono">⌫ delete folder</div>
          <button class="wf-name-close" title="Close" @click="emit('close')">✕</button>
        </header>
        <div class="wf-name-body">
          <p class="wf-name-copy">
            Delete <span class="mono">{{ target.name }}</span>? Workflows and subfolders move to
            the parent (or root). Graphs are not deleted.
          </p>
          <p v-if="error" class="wf-name-error">{{ error }}</p>
        </div>
        <footer class="wf-name-foot">
          <button class="threadle-btn" :disabled="busy" @click="emit('close')">Cancel</button>
          <button class="threadle-btn danger" :disabled="busy" @click="emit('confirm')">
            {{ busy ? "…" : "Delete folder" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  target?: { id: string; name: string };
  error: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<style scoped>
.wf-name-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
}
.wf-name-modal {
  width: min(380px, calc(100vw - 32px));
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
}
.wf-name-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 8px;
}
.wf-name-title {
  font-size: var(--fs-md);
  color: var(--text);
  letter-spacing: 0.02em;
}
.wf-name-close {
  appearance: none;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-lg);
  line-height: 1;
  padding: 2px 4px;
}
.wf-name-close:hover {
  color: var(--text);
}
.wf-name-body {
  padding: 4px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wf-name-error {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--status-error);
}
.wf-name-copy {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.45;
}
.wf-name-copy .mono {
  color: var(--text);
}
.wf-name-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 16px;
}
.wf-name-foot .threadle-btn.danger {
  border-color: color-mix(in srgb, var(--status-error) 55%, var(--border));
  color: var(--status-error);
}
.wf-name-foot .threadle-btn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--status-error) 12%, transparent);
  border-color: var(--status-error);
}
</style>
