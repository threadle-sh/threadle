<template>
  <div class="agent-panel">
    <div class="agent-meta">
      <span class="threadle-chip">{{ agentDef?.scope ?? "agent" }}</span>
      <span class="threadle-chip">{{ data.ref.provider }}</span>
      <span v-if="agentDef?.kind" class="threadle-chip">{{ agentDef.kind }}</span>
    </div>

    <label class="field">
      <span class="field-label">model</span>
      <select
        class="threadle-input"
        :class="{ unset: !data.model }"
        :value="data.model ?? ''"
        @change="onModel"
      >
        <option value="" disabled>{{ data.model ? "—" : "select a model…" }}</option>
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
    </label>

    <label v-if="data.ref.provider === 'claude-code'" class="field">
      <span class="field-label">permission mode</span>
      <select
        class="threadle-input"
        :value="data.permissionMode ?? ''"
        @change="onPermissionMode"
      >
        <option value="">default (CLI)</option>
        <option value="default">default</option>
        <option value="acceptEdits">acceptEdits</option>
        <option value="plan">plan</option>
        <option value="bypassPermissions">bypassPermissions</option>
      </select>
    </label>

    <template v-if="data.ref.provider === 'codex'">
      <label class="field">
        <span class="field-label">sandbox</span>
        <select
          class="threadle-input"
          :value="data.sandbox ?? ''"
          @change="onSandbox"
        >
          <option value="">workspace-write (default)</option>
          <option value="read-only">read-only</option>
          <option value="workspace-write">workspace-write</option>
          <option value="danger-full-access">danger-full-access</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">ask for approval</span>
        <select
          class="threadle-input"
          :value="data.askForApproval ?? ''"
          @change="onAskForApproval"
        >
          <option value="">never (default)</option>
          <option value="never">never</option>
          <option value="on-request">on-request</option>
          <option value="on-failure">on-failure</option>
          <option value="untrusted">untrusted</option>
        </select>
      </label>
    </template>

    <template v-if="extrasSpec">
      <div class="field">
        <span class="field-label">harness extras</span>
        <div class="settings-seg" role="group" aria-label="harness extras">
          <button
            type="button"
            class="settings-seg-btn"
            :class="{ active: extrasMode === 'inherit' }"
            title="Use Settings → harness extras"
            @click="setExtras(undefined)"
          >
            inherit
          </button>
          <button
            type="button"
            class="settings-seg-btn"
            :class="{ active: extrasMode === 'off' }"
            title="Skip post-answer extras for this node"
            @click="setExtras(false)"
          >
            off
          </button>
          <button
            type="button"
            class="settings-seg-btn"
            :class="{ active: extrasMode === 'on' }"
            title="Allow post-answer extras for this node"
            @click="setExtras(true)"
          >
            on
          </button>
        </div>
        <ul class="extras-list mono" :class="{ skipped: !extrasEffective }">
          <li v-for="name in extrasSpec.lanes" :key="name">
            <span class="extras-mark">{{ extrasEffective ? "·" : "⊘" }}</span>
            <span class="extras-name">{{ name }}</span>
            <span class="extras-state">{{
              extrasEffective ? "run" : "skipped"
            }}</span>
          </li>
        </ul>
        <p class="run-hint">
          {{ extrasSpec.blurb }}
          <template v-if="extrasMode === 'inherit'">
            Inheriting Settings (currently
            <b>{{ settings.harnessExtras ? "on" : "off" }}</b>).
          </template>
          <template v-else>
            Override pinned on this node.
          </template>
        </p>
      </div>
    </template>

    <div class="field">
      <span class="field-label">ignore local md</span>
      <div class="settings-seg" role="group" aria-label="ignore local markdown">
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !data.ignoreLocalMarkdown }"
          title="Use the real project dir (AGENTS.md / CLAUDE.md / rules load)"
          @click="setIgnoreLocalMd(false)"
        >
          off
        </button>
        <button
          type="button"
          class="settings-seg-btn"
          :class="{ active: !!data.ignoreLocalMarkdown }"
          title="Bare empty workspace — skip AGENTS.md / CLAUDE.md / .cursor rules"
          @click="setIgnoreLocalMd(true)"
        >
          on
        </button>
      </div>
      <p class="run-hint">
        When on, the agent runs in an empty workspace so project markdown and
        rules do not inflate input tokens.
      </p>
    </div>

    <div class="run-box">
      <div v-if="promptText" class="prompt-preview">
        <div class="field-label">prompt (from wired prompt node)</div>
        <div class="prompt-text">{{ promptText }}</div>
      </div>
      <div v-else class="run-hint">
        Wire a <b>Prompt</b> node into this agent to run it.
      </div>
      <button
        class="threadle-btn primary"
        :disabled="!promptText?.trim() || busy"
        @click="emit('run')"
      >
        {{ busy ? "Running…" : "▶ Run agent" }}
      </button>
    </div>

    <div v-if="error" class="run-error">{{ error }}</div>
    <div v-if="progress" class="run-progress">{{ progress }}</div>

    <div v-if="agentDef?.raw" class="t-text agent-raw" v-html="rendered" />
    <p v-else-if="agentDef?.description" class="run-hint">
      {{ agentDef.description }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { renderMd } from "@/lib/safeHtml";
import type { AgentDef, AgentDefNodeData } from "@threadle/shared";
import {
  PROVIDER_HARNESS_EXTRAS,
  nodeHarnessExtrasField,
  resolveHarnessExtras,
  setNodeHarnessExtras,
} from "@threadle/shared";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{
  data: AgentDefNodeData;
  agentDef?: AgentDef;
  models: string[];
  promptText?: string;
  busy?: boolean;
  error?: string;
  progress?: string;
}>();

const emit = defineEmits<{ run: [] }>();
const settings = useSettingsStore();

onMounted(() => {
  void settings.load();
});

const extrasSpec = computed(
  () => PROVIDER_HARNESS_EXTRAS[props.data.ref.provider],
);

const extrasMode = computed<"inherit" | "on" | "off">(() => {
  const v = nodeHarnessExtrasField(props.data);
  if (v === true) return "on";
  if (v === false) return "off";
  return "inherit";
});

const extrasEffective = computed(() =>
  resolveHarnessExtras(nodeHarnessExtrasField(props.data), settings.harnessExtras),
);

function setExtras(v: boolean | undefined): void {
  setNodeHarnessExtras(props.data, v);
}

function setIgnoreLocalMd(on: boolean): void {
  if (on) props.data.ignoreLocalMarkdown = true;
  else delete props.data.ignoreLocalMarkdown;
}

const rendered = computed(() =>
  props.agentDef?.raw ? renderMd(props.agentDef.raw) : "",
);

function onModel(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  props.data.model = v || undefined; // graph node data — autosaved
}

function onPermissionMode(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  props.data.permissionMode = v || undefined;
}

function onSandbox(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  props.data.sandbox = v || undefined;
}

function onAskForApproval(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  props.data.askForApproval = v || undefined;
}
</script>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.agent-meta {
  display: flex;
  gap: 6px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}
.threadle-input.unset {
  color: var(--status-waiting);
  border-color: rgba(212, 168, 75, 0.45);
}
.settings-seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  align-self: flex-start;
}
.settings-seg-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  padding: 4px 10px;
  cursor: pointer;
}
.settings-seg-btn.active {
  background: var(--panel-bg-raised);
  color: var(--text);
}
.extras-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  background: var(--input-bg);
}
.extras-list li {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.35;
}
.extras-list.skipped li {
  color: var(--text-faint);
}
.extras-mark {
  color: var(--text-faint);
}
.extras-list.skipped .extras-mark {
  color: var(--status-waiting);
}
.extras-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.extras-state {
  text-align: right;
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.extras-list.skipped .extras-state {
  color: var(--status-waiting);
}
.run-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
}
.prompt-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompt-text {
  font-size: var(--fs-sm);
  background: var(--input-bg);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  max-height: 140px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.run-hint {
  font-size: var(--fs-sm);
  color: var(--text-faint);
  line-height: 1.4;
}
.run-error {
  font-size: var(--fs-sm);
  color: var(--status-error);
}
.run-progress {
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.agent-raw {
  font-size: var(--fs-md);
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
</style>
