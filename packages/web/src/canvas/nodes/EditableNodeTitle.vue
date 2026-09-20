<template>
  <input
    v-if="editing"
    ref="inputEl"
    class="node-title-input nodrag nopan"
    :value="draft"
    :placeholder="fallback"
    spellcheck="false"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @dblclick.stop
    @keydown.stop="onKey"
    @blur="commit"
    @input="onInput"
  />
  <span
    v-else
    class="node-title-text"
    :title="`${display} — drag to move · double-click to rename`"
    @dblclick.stop.prevent="startEdit"
  >{{ display }}</span>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

const props = defineProps<{
  /** Current label (may be empty). */
  label?: string;
  /** Shown when label is empty (e.g. "Data", "Prompt"). */
  fallback: string;
}>();

const emit = defineEmits<{
  "update:label": [value: string | undefined];
}>();

const editing = ref(false);
const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

const display = computed(() => {
  const t = props.label?.trim();
  return t || props.fallback;
});

function onInput(e: Event): void {
  draft.value = (e.target as HTMLInputElement).value;
}

function startEdit(): void {
  draft.value = props.label?.trim() ?? "";
  editing.value = true;
  void nextTick(() => {
    const el = inputEl.value;
    if (!el) return;
    el.focus();
    el.select();
  });
}

function commit(): void {
  if (!editing.value) return;
  editing.value = false;
  const next = draft.value.trim();
  emit("update:label", next || undefined);
}

function cancel(): void {
  editing.value = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    e.preventDefault();
    (e.target as HTMLInputElement).blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancel();
  }
}
</script>

<style scoped>
.node-title-text {
  display: block;
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Let Vue Flow drag from the title; rename only on double-click. */
  cursor: inherit;
  border-radius: var(--radius-sm);
  padding: 1px 2px;
  margin: -1px -2px;
}
.node-title-input {
  display: block;
  flex: 1;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  font-size: var(--fs-md);
  font-weight: 600;
  font-family: var(--font);
  color: var(--text);
  background: var(--input-bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  outline: none;
  line-height: 1.2;
}
</style>
