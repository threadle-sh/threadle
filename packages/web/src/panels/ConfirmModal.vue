<template>
  <Teleport to="body">
    <div
      v-if="model"
      class="wf-name-backdrop"
      @click.self="cancel"
      @keydown.esc="cancel"
    >
      <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
        <header class="wf-name-head">
          <div class="wf-name-title mono">{{ model.title }}</div>
          <button type="button" class="wf-name-close" title="Close" @click="cancel">✕</button>
        </header>
        <div class="wf-name-body">
          <p class="wf-name-copy">
            <template v-if="model.emphasis">
              <span class="mono">{{ model.emphasis }}</span>{{ model.body }}
            </template>
            <template v-else>{{ model.body }}</template>
          </p>
          <p v-if="model.detail" class="wf-name-detail">{{ model.detail }}</p>
        </div>
        <footer class="wf-name-foot">
          <button
            v-if="!model.alert"
            type="button"
            class="threadle-btn"
            @click="cancel"
          >
            {{ model.cancelLabel ?? "Cancel" }}
          </button>
          <button
            type="button"
            class="threadle-btn"
            :class="model.danger ? 'danger' : 'primary'"
            @click="confirm"
          >
            {{ model.confirmLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
export interface ConfirmModel {
  title: string;
  /** Text after optional emphasis (e.g. " is a workflow…") */
  body: string;
  /** Highlighted lead (usually a name) */
  emphasis?: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Single OK button — dismiss-only alerts (e.g. missing file). */
  alert?: boolean;
}

const model = defineModel<ConfirmModel | undefined>({ default: undefined });
const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function cancel(): void {
  emit("cancel");
  model.value = undefined;
}

function confirm(): void {
  emit("confirm");
  model.value = undefined;
}
</script>

<style scoped>
.wf-name-backdrop {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.6);
}
.wf-name-modal {
  width: min(420px, calc(100vw - 32px));
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
.wf-name-copy {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-dim);
  line-height: 1.45;
}
.wf-name-copy .mono {
  color: var(--text);
  font-family: var(--mono);
}
.wf-name-detail {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-faint);
  line-height: 1.4;
  white-space: pre-line;
  word-break: break-word;
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
