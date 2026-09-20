<template>
  <div class="data-panel">
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
        <option v-for="t in VALUE_TYPES" :key="t" :value="t">{{ VALUE_TYPE_LABELS[t] }}</option>
      </select>
    </label>

    <div class="meta mono">
      {{ charsLabel }}
      <span>· {{ VALUE_TYPE_LABELS[valueType] }}</span>
      <span>· 1 in · 1 out</span>
    </div>

    <label class="cfg-col">
      <span>value</span>
      <select
        v-if="valueType === 'bool'"
        class="threadle-input cfg-select bool"
        :value="boolValue"
        @change="onBool"
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      <textarea
        v-else
        class="threadle-input text"
        :class="{ invalid: !!typeError }"
        :value="data.value ?? ''"
        :rows="valueType === 'json' || valueType === 'text' ? 12 : 3"
        spellcheck="false"
        :placeholder="placeholder"
        @input="onValue"
      />
    </label>

    <div v-if="typeError" class="warn mono">{{ typeError }}</div>
    <div v-else-if="coercedPreview" class="ok mono">coerced · {{ coercedPreview }}</div>

    <div class="actions">
      <button
        v-if="valueType === 'json'"
        type="button"
        class="threadle-btn"
        :disabled="!canFormatJson"
        title="Pretty-print JSON"
        @click="formatJson"
      >
        format json
      </button>
      <button
        type="button"
        class="threadle-btn"
        :disabled="!(data.value ?? '').length"
        title="Copy value to clipboard"
        @click="copyValue"
      >
        {{ copied ? "✓ copied" : "❐ copy" }}
      </button>
      <button
        type="button"
        class="threadle-btn"
        :disabled="!(data.value ?? '').length"
        title="Clear stored value"
        @click="clearValue"
      >
        clear
      </button>
    </div>

    <p class="hint">
      Typed coerce on the text lane. Any text-lane writer (Text stats, agents,
      prompts, merges, …) may wire in — inbound text is coerced to this type at
      run time. With nothing wired in, the typed value is emitted.
    </p>

    <dl class="facts">
      <div class="fact">
        <dt>ports</dt>
        <dd>1 in · 1 out</dd>
      </div>
      <div class="fact">
        <dt>empty in</dt>
        <dd>uses typed value</dd>
      </div>
      <div class="fact">
        <dt>wired in</dt>
        <dd>coerce → {{ VALUE_TYPE_LABELS[valueType] }}</dd>
      </div>
      <div class="fact">
        <dt>bad coerce</dt>
        <dd>blocks the run</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VALUE_TYPES,
  VALUE_TYPE_LABELS,
  coerceValue,
  valueTypeError,
  type DataNodeData,
  type ValueType,
} from "@threadle/shared";

const props = defineProps<{ data: DataNodeData }>();

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const valueType = computed(() => props.data.valueType ?? "text");

const charsLabel = computed(() => {
  const n = props.data.value?.length ?? 0;
  if (!n) return "0 chars";
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
});

const placeholder = computed(() => {
  switch (valueType.value) {
    case "int":
      return "0";
    case "float":
      return "0.0";
    case "json":
      return '{ "key": "value" }';
    default:
      return "value…";
  }
});

const typeError = computed(() => {
  const v = props.data.value;
  if (v == null || v === "") return undefined;
  return valueTypeError(v, valueType.value);
});

const coercedPreview = computed(() => {
  const v = props.data.value;
  if (v == null || v === "" || typeError.value) return undefined;
  if (valueType.value === "text") return undefined;
  const r = coerceValue(v, valueType.value);
  if ("error" in r) return undefined;
  // Only show when canonical form differs from what was typed
  if (r.value === v.trim() || r.value === v) return undefined;
  const s = r.value;
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
});

const boolValue = computed(() => {
  const v = (props.data.value ?? "").trim().toLowerCase();
  if (v === "true" || v === "1") return "true";
  if (v === "false" || v === "0") return "false";
  return "";
});

const canFormatJson = computed(() => {
  const v = props.data.value?.trim();
  if (!v) return false;
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
});

function onLabel(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.label = v || undefined;
}

function onType(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as ValueType;
  props.data.valueType = v === "text" ? undefined : v;
}

function onValue(e: Event): void {
  props.data.value = (e.target as HTMLTextAreaElement).value;
}

function onBool(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  props.data.value = v || undefined;
}

function formatJson(): void {
  const raw = props.data.value?.trim();
  if (!raw) return;
  try {
    props.data.value = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* keep as-is — error already shown */
  }
}

async function copyValue(): Promise<void> {
  const text = props.data.value ?? "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 1200);
}

function clearValue(): void {
  props.data.value = undefined;
}
</script>

<style scoped>
.data-panel {
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
.cfg-select.bool {
  align-self: flex-start;
  min-width: 100px;
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.text {
  flex: 1;
  min-height: 120px;
  resize: vertical;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.text.invalid {
  border-color: var(--status-error);
}
.warn {
  font-size: var(--fs-2xs);
  color: var(--status-error);
  line-height: 1.4;
}
.ok {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.45;
}
.facts {
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fact {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  font-size: var(--fs-xs);
  align-items: baseline;
}
.fact dt {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
.fact dd {
  margin: 0;
  color: var(--text-dim);
  min-width: 0;
}
</style>
