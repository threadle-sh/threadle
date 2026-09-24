<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="wf-name-backdrop"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
        <header class="wf-name-head">
          <div class="wf-name-title mono">✎ rename</div>
          <button class="wf-name-close" title="Close" @click="emit('close')">✕</button>
        </header>
        <div class="wf-name-body">
          <label class="wf-name-field">
            <span class="micro-label">name</span>
            <input
              ref="inputEl"
              :value="name"
              class="threadle-input mono"
              spellcheck="false"
              maxlength="120"
              placeholder="workflow name"
              @input="emit('update:name', ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="emit('submit')"
            />
          </label>
          <p v-if="error" class="wf-name-error">{{ error }}</p>
        </div>
        <footer class="wf-name-foot">
          <button class="threadle-btn" @click="emit('close')">Cancel</button>
          <button class="threadle-btn primary" :disabled="busy" @click="emit('submit')">
            {{ busy ? "…" : "Rename" }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  name: string;
  error: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  "update:name": [value: string];
}>();

const inputEl = ref<HTMLInputElement>();

watch(
  () => props.open,
  async (v) => {
    if (!v) return;
    await nextTick();
    inputEl.value?.focus();
    inputEl.value?.select();
  },
);

defineExpose({
  focus() {
    inputEl.value?.focus();
    inputEl.value?.select();
  },
});
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
.wf-name-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wf-name-error {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--status-error);
}
.wf-name-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 16px;
}
</style>
