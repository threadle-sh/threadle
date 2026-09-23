<template>
  <div class="knot-panel">
    <label class="cfg-row">
      <span>label</span>
      <input
        class="threadle-input cfg-label"
        :value="data.label ?? ''"
        placeholder="merge"
        spellcheck="false"
        @input="onLabel"
      />
    </label>

    <label class="cfg-row">
      <span>join</span>
      <select class="threadle-input cfg-select" :value="data.strategy" @change="onStrategy">
        <option value="concat">concat</option>
        <option value="first">first wins</option>
        <option value="majority">majority</option>
        <option value="synthesize">synthesize</option>
      </select>
    </label>

    <p class="hint">{{ strategyHint }}</p>

    <div class="meta mono">ports · multi-in · 1 out</div>

    <label v-if="data.strategy === 'concat'" class="cfg-col">
      <span>separator</span>
      <textarea
        class="threadle-input sep"
        :value="data.separator ?? ''"
        rows="3"
        spellcheck="false"
        placeholder="default: blank line + ---"
        @input="onSeparator"
      />
    </label>

    <template v-if="data.strategy === 'synthesize'">
      <label class="cfg-row">
        <span>provider</span>
        <select
          class="threadle-input cfg-select"
          :value="data.provider ?? ''"
          @change="onProvider"
        >
          <option value="">—</option>
          <option v-for="id in PROVIDER_IDS" :key="id" :value="id">{{ id }}</option>
        </select>
      </label>
      <label class="cfg-row">
        <span>model</span>
        <select
          class="threadle-input cfg-select"
          :class="{ unset: !data.model }"
          :value="data.model ?? ''"
          :disabled="!data.provider"
          @change="onModel"
        >
          <option value="" disabled>{{ data.model ? "—" : "select a model…" }}</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label class="cfg-row">
        <span>agent</span>
        <input
          class="threadle-input cfg-input"
          :value="data.agent ?? ''"
          :placeholder="
            data.provider === 'cursor' || data.provider === 'antigravity'
              ? 'agent'
              : data.provider === 'codex'
                ? 'codex'
                : data.provider === 'copilot'
                  ? 'copilot'
                  : data.provider === 'grok'
                    ? 'grok'
                    : data.provider === 'muse'
                      ? 'muse'
                      : 'build'
          "
          spellcheck="false"
          @input="onAgent"
        />
      </label>
      <p class="hint">
        Without a model, synthesize passes labeled candidates as text for a downstream agent.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { KnotNodeData, KnotStrategy, ProviderId } from "@threadle/shared";
import { PROVIDER_IDS } from "@/lib/providers";

const props = defineProps<{
  data: KnotNodeData;
  models: string[];
}>();

const strategyHint = computed(() => {
  switch (props.data.strategy) {
    case "concat":
      return "Merge inbound wires into one text block.";
    case "first":
      return "Keep only the first inbound text that arrives.";
    case "majority":
      return "Pick the most common inbound text (ties break by length).";
    case "synthesize":
      return "LLM-merge candidates when provider + model are set.";
    default:
      return "";
  }
});

function onLabel(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.label = v || undefined;
}

function onStrategy(e: Event): void {
  props.data.strategy = (e.target as HTMLSelectElement).value as KnotStrategy;
}

function onSeparator(e: Event): void {
  const v = (e.target as HTMLTextAreaElement).value;
  props.data.separator = v || undefined;
}

function onProvider(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as ProviderId | "";
  props.data.provider = v || undefined;
  if (!v) props.data.model = undefined;
}

function onModel(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  props.data.model = v || undefined;
}

function onAgent(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.agent = v || undefined;
}
</script>

<style scoped>
.knot-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.cfg-select.unset {
  color: var(--text-faint);
}
.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-faint);
  line-height: 1.45;
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.sep {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  resize: vertical;
}
</style>
