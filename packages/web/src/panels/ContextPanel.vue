<template>
  <div class="ctx-panel">
    <div v-if="!sourceRef" class="ctx-warn">
      Connect a session node into this context node to choose its source.
    </div>
    <div v-else class="ctx-source">
      source: <code>{{ sourceRef.provider }}</code> ·
      {{ sourceTitle ?? shortId(sourceRef.sessionId) }}
    </div>

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

    <!-- config -->
    <section class="ctx-config">
      <template v-if="data.kind === 'transcript-excerpt'">
        <label class="cfg-row">
          <span>roles</span>
          <span class="cfg-inline">
            <label
              ><input type="checkbox" v-model="excerptRoles.user" /> user</label
            >
            <label
              ><input type="checkbox" v-model="excerptRoles.assistant" />
              assistant</label
            >
          </span>
        </label>
        <label class="cfg-row">
          <span>tool calls</span>
          <select v-model="excerptCfg.includeToolCalls" class="threadle-input cfg-select">
            <option value="none">none</option>
            <option value="names">names only</option>
            <option value="full">full I/O</option>
          </select>
        </label>
        <label class="cfg-row">
          <span>thinking</span>
          <input type="checkbox" v-model="excerptCfg.includeThinking" />
        </label>
        <label class="cfg-row">
          <span>max chars</span>
          <input
            type="number"
            class="threadle-input cfg-select"
            :value="excerptCfg.maxChars ?? ''"
            placeholder="unlimited"
            @change="onMaxChars"
          />
        </label>
        <div v-if="excerptCfg.range" class="cfg-row">
          <span>range</span>
          <span class="cfg-inline">
            messages {{ excerptCfg.range[0] + 1 }}–{{ excerptCfg.range[1] + 1 }}
            <button class="lnk" @click="excerptCfg.range = undefined">clear</button>
          </span>
        </div>
      </template>

      <template v-else-if="data.kind === 'distilled-summary'">
        <label class="cfg-row">
          <span>provider</span>
          <select v-model="distillProvider" class="threadle-input cfg-select">
            <option v-for="id in PROVIDER_IDS" :key="id" :value="id">
              {{ providerLabel(id) }}
            </option>
          </select>
        </label>
        <label class="cfg-row">
          <span>model</span>
          <input
            v-model="distillCfg.model"
            class="threadle-input cfg-select"
            placeholder="provider default"
          />
        </label>
        <label class="cfg-col">
          <span>extra instructions</span>
          <textarea
            v-model="distillCfg.extraInstructions"
            class="threadle-input"
            rows="3"
            placeholder="e.g. focus on the API design decisions"
          />
        </label>
      </template>

      <template v-else-if="data.kind === 'files'">
        <label class="cfg-row">
          <span>snapshot file contents</span>
          <input type="checkbox" v-model="filesCfg.snapshotContents" />
        </label>
      </template>
    </section>

    <div class="ctx-actions">
      <button
        class="threadle-btn primary"
        :disabled="!sourceRef || busy"
        @click="emit('materialize')"
      >
        {{ busy ? "Materializing…" : data.payloadHash ? "Re-run" : "Materialize" }}
      </button>
      <span v-if="payload" class="threadle-chip"
        >≈{{ payload.meta.tokenEstimate }} tokens</span
      >
    </div>
    <div v-if="error" class="ctx-error">{{ error }}</div>
    <div v-if="progress" class="ctx-progress">{{ progress }}</div>

    <!-- payload preview -->
    <section v-if="payload" class="ctx-preview">
      <div class="preview-head">payload {{ payload.hash.slice(0, 10) }}</div>
      <div class="t-text preview-body" v-html="rendered" />
    </section>
  </div>
</template>

<script setup lang="ts">
import type {
  ContextNodeData,
  ContextPayload,
  DistillConfig,
  ExtractConfig,
  FilesConfig,
  ProviderId,
} from "@threadle/shared";
import { shortId } from "@/lib/format";
import { PROVIDER_IDS, providerLabel } from "@/lib/providers";
import { renderMd } from "@/lib/safeHtml";
import { computed, reactive } from "vue";

const props = defineProps<{
  data: ContextNodeData;
  sourceRef?: { provider: string; sessionId: string };
  sourceTitle?: string;
  payload?: ContextPayload;
  busy?: boolean;
  error?: string;
  progress?: string;
}>();

const emit = defineEmits<{ materialize: [] }>();

const rendered = computed(() =>
  props.payload ? renderMd(props.payload.content) : "",
);

// config objects are reactive references into the graph node's data (autosaved)
const excerptCfg = props.data.config as ExtractConfig;
const distillCfg = props.data.config as DistillConfig;
const filesCfg = props.data.config as FilesConfig;

const distillProvider = computed({
  get: () => distillCfg.provider ?? ("claude-code" as ProviderId),
  set: (v: ProviderId) => {
    distillCfg.provider = v;
  },
});

const excerptRoles = reactive({
  get user() {
    return excerptCfg.roles?.includes("user") ?? true;
  },
  set user(v: boolean) {
    setRole("user", v);
  },
  get assistant() {
    return excerptCfg.roles?.includes("assistant") ?? true;
  },
  set assistant(v: boolean) {
    setRole("assistant", v);
  },
});

function setRole(role: "user" | "assistant", enabled: boolean): void {
  const set = new Set(excerptCfg.roles ?? ["user", "assistant"]);
  if (enabled) set.add(role);
  else set.delete(role);
  excerptCfg.roles = [...set] as Array<"user" | "assistant">;
}

function onLabel(e: Event): void {
  const v = (e.target as HTMLInputElement).value.trim();
  props.data.label = v || undefined;
}

function onMaxChars(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  excerptCfg.maxChars = Number.isFinite(v) && v > 0 ? v : undefined;
}
</script>

<style scoped>
.ctx-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ctx-warn {
  font-size: var(--fs-sm);
  color: var(--status-waiting);
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.25);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.ctx-source {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.ctx-source code {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text);
}
.ctx-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cfg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.cfg-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.cfg-inline {
  display: flex;
  gap: 12px;
  color: var(--text);
}
.cfg-select {
  width: 180px;
}
.cfg-label {
  flex: 1;
  min-width: 0;
  width: auto;
  text-align: left;
}
.lnk {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-xs);
}
.ctx-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ctx-error {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.ctx-progress {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.ctx-preview {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.preview-head {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-family: var(--mono);
  padding: 6px 10px;
  background: var(--panel-bg-raised);
  border-bottom: 1px solid var(--border);
}
.preview-body {
  padding: 10px 12px;
  font-size: var(--fs-sm);
  max-height: 380px;
  overflow-y: auto;
}
.preview-body :deep(pre) {
  background: var(--input-bg);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: var(--fs-xs);
}
.preview-body :deep(table) {
  border-collapse: collapse;
  font-size: var(--fs-sm);
}
.preview-body :deep(td),
.preview-body :deep(th) {
  border: 1px solid var(--border);
  padding: 3px 8px;
}
</style>
