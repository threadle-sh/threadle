<template>
  <div class="prompt-panel">
    <label class="cfg-row">
      <span>label</span>
      <input
        class="threadle-input cfg-label"
        :value="data.label ?? ''"
        placeholder="optional"
        spellcheck="false"
        @input="onLabel"
      />
    </label>

    <label class="cfg-row">
      <span>value type</span>
      <select class="threadle-input cfg-select" :value="valueType" @change="onType">
        <option v-for="t in VALUE_TYPES" :key="t" :value="t">{{ t }}</option>
      </select>
    </label>

    <div class="meta mono">{{ charsLabel }} · source · ∞ out</div>

    <label class="cfg-col">
      <span>text</span>
      <textarea
        class="threadle-input text"
        :value="data.text"
        rows="12"
        spellcheck="false"
        placeholder="Prompt text to emit on run…"
        @input="onText"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VALUE_TYPES, type PromptNodeData, type ValueType } from "@threadle/shared";

const props = defineProps<{ data: PromptNodeData }>();

const valueType = computed(() => props.data.valueType ?? "text");

const charsLabel = computed(() => {
  const n = props.data.text?.length ?? 0;
  if (!n) return "0 chars";
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
});

function onLabel(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.label = v || undefined;
}

function onType(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as ValueType;
  props.data.valueType = v === "text" ? undefined : v;
}

function onText(e: Event): void {
  props.data.text = (e.target as HTMLTextAreaElement).value;
}
</script>

<style scoped>
.prompt-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}
.cfg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.cfg-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.cfg-input,
.cfg-select {
  width: auto;
  min-width: 140px;
  font-size: var(--fs-xs);
}
.cfg-label {
  flex: 1;
  min-width: 0;
  width: auto;
  font-size: var(--fs-xs);
  text-align: left;
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.text {
  flex: 1;
  min-height: 160px;
  resize: vertical;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
</style>
