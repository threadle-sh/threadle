<template>
  <div class="out-panel">
    <label class="cfg-row">
      <span>render</span>
      <select
        class="threadle-input cfg-select"
        :value="data.renderMode ?? 'auto'"
        @change="onMode"
      >
        <option value="auto">auto</option>
        <option value="text">text</option>
        <option value="markdown">markdown</option>
        <option value="html">html</option>
        <option value="svg">svg</option>
      </select>
    </label>

    <div class="meta mono">
      <span>{{ charsLabel }}</span>
      <span>· 1 in · 1 out</span>
      <span v-if="data.size">· {{ Math.round(data.size.width) }}×{{ Math.round(data.size.height) }}</span>
    </div>

    <div class="actions">
      <button
        type="button"
        class="threadle-btn"
        :disabled="!data.content"
        title="Copy output text to clipboard"
        @click="copy"
      >
        {{ copied ? "✓ copied" : "❐ copy" }}
      </button>
    </div>

    <div v-if="!data.content" class="empty">
      No content yet. Run the graph, or press ↻ on the node to pull from the wired source.
    </div>
    <pre v-else class="preview">{{ data.content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { OutputNodeData, OutputRenderMode } from "@threadle/shared";
import { copyToClipboard } from "@/lib/pathActions";

const props = defineProps<{ data: OutputNodeData }>();
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const charsLabel = computed(() => {
  const n = props.data.content?.length ?? 0;
  if (!n) return "0 chars";
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
});

function onMode(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as OutputRenderMode;
  props.data.renderMode = v === "auto" ? undefined : v;
}

async function copy(): Promise<void> {
  const text = props.data.content;
  if (!text) return;
  const ok = await copyToClipboard(text);
  if (!ok) return;
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 1200);
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<style scoped>
.out-panel {
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
.cfg-select {
  width: auto;
  min-width: 110px;
  font-size: var(--fs-xs);
}
.meta {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  display: flex;
  gap: 6px;
}
.actions {
  display: flex;
  gap: 8px;
}
.empty {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-style: italic;
  line-height: 1.45;
}
.preview {
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
