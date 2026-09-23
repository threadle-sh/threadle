<template>
  <div
    class="node-ctx"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
    @contextmenu.prevent
  >
    <div class="node-ctx-title mono">{{ label }}</div>
    <template v-if="path">
      <button
        v-if="pathIsText"
        class="node-ctx-item"
        title="Open"
        @click="emit('open-viewer')"
      >
        ⧉ open
      </button>
      <button
        class="node-ctx-item"
        :title="`Open in ${editorLabel}`"
        @click="emit('open-in-code')"
      >
        open in {{ editorLabel }}
      </button>
      <button class="node-ctx-item" title="Copy absolute path" @click="emit('copy-path')">
        copy path
      </button>
      <button
        v-if="pathIsText"
        class="node-ctx-item"
        :disabled="copyBusy"
        title="Copy file contents to the clipboard"
        @click="emit('copy-content')"
      >
        {{ copyBusy ? "copying…" : "copy content" }}
      </button>
      <div class="wire-sect micro-label">run</div>
    </template>
    <button
      class="node-ctx-item"
      :disabled="graphRunning"
      title="Run this node and everything downstream of it — upstream nodes feed in their last result"
      @click="emit('run-from')"
    >
      ❯ run from this node
    </button>
    <button
      class="node-ctx-item"
      :disabled="graphRunning"
      title="Run only this node — inputs come from the wired nodes' last results"
      @click="emit('test-node')"
    >
      ⊙ test this node
    </button>
    <button
      v-if="isOutput"
      class="node-ctx-item"
      :disabled="!canClearOutput"
      title="Clear captured output content"
      @click="emit('clear-output')"
    >
      ⌫ clear
    </button>
    <button
      v-if="isData"
      class="node-ctx-item"
      :disabled="!canClearData"
      title="Clear stored data value"
      @click="emit('clear-data')"
    >
      ⌫ clear
    </button>
    <button
      v-if="mutable"
      class="node-ctx-item"
      title="Muted nodes are skipped by the runner; downstream nodes starve (Cmd+M)"
      @click="emit('toggle-mute')"
    >
      ⊘ {{ muted ? "unmute" : "mute" }}
    </button>
    <button
      v-if="mutable"
      class="node-ctx-item"
      title="Bypassed nodes pass their input straight through without executing (Cmd+B)"
      @click="emit('toggle-bypass')"
    >
      ⤳ {{ bypassed ? "unbypass" : "bypass" }}
    </button>
    <button
      v-if="mutable"
      class="node-ctx-item"
      title="Extra attempts (with backoff) before this node counts as failed"
      @click.stop="emit('cycle-retry')"
    >
      ⟳ retry: {{ retry === 0 ? "off" : `${retry}×` }}
    </button>
    <button
      v-if="mutable"
      class="node-ctx-item"
      title="On final failure: mark this node errored but keep the run alive (downstream starves)"
      @click.stop="emit('toggle-continue-on-error')"
    >
      ⤼ on error: {{ continueOnError ? "continue" : "fail run" }}
    </button>
    <div
      v-if="isAgent"
      class="node-ctx-subwrap"
      @mouseenter="emit('open-model-menu')"
      @mouseleave="emit('close-model-menu')"
    >
      <button
        class="node-ctx-item node-ctx-has-sub"
        :class="{ open: modelOpen }"
        @click.stop="emit('toggle-model-menu')"
      >
        ◇ model <span class="node-ctx-chevron">›</span>
      </button>
      <div v-if="modelOpen" class="node-ctx-flyout">
        <div class="wire-sect micro-label">
          {{ modelCurrent || "select model" }}
        </div>
        <div class="node-ctx-flyout-scroll">
          <button
            class="node-ctx-item"
            :class="{ current: !modelCurrent }"
            :disabled="!modelCurrent"
            @click="emit('set-model', undefined)"
          >
            default
          </button>
          <button
            v-for="m in models"
            :key="m"
            class="node-ctx-item"
            :class="{ current: modelCurrent === m }"
            :disabled="modelCurrent === m"
            :title="m"
            @click="emit('set-model', m)"
          >
            {{ m }}
          </button>
          <div v-if="!models.length" class="node-ctx-empty">
            no models for this provider
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="isAgent"
      class="node-ctx-subwrap"
      @mouseenter="emit('open-exchange-menu')"
      @mouseleave="emit('close-exchange-menu')"
    >
      <button
        class="node-ctx-item node-ctx-has-sub"
        :class="{ open: exchangeOpen }"
        @click.stop="emit('toggle-exchange-menu')"
      >
        ⇄ exchange agent <span class="node-ctx-chevron">›</span>
      </button>
      <div v-if="exchangeOpen" class="node-ctx-flyout">
        <div class="wire-sect micro-label">replace with</div>
        <div class="node-ctx-flyout-scroll">
          <button
            v-for="a in exchangeAgents"
            :key="`${a.provider}:${a.name}:${a.source}`"
            class="node-ctx-item"
            :class="{ current: a.current }"
            :disabled="a.current"
            :title="a.description || a.source"
            @click="emit('exchange-agent', a)"
          >
            <span class="prov-dot" :data-p="a.provider" />
            {{ a.name }}
            <span class="wire-dim">{{ a.provider }}</span>
          </button>
          <div v-if="!exchangeAgents.length" class="node-ctx-empty">
            no agents loaded
          </div>
        </div>
      </div>
    </div>
    <template v-if="selectedCount >= 2">
      <div class="wire-sect micro-label">{{ selectedCount }} selected</div>
      <button class="node-ctx-item" @click="emit('group-selection')">
        ▦ group selection
      </button>
      <button class="node-ctx-item" @click="emit('save-selection-as-workflow')">
        ⌗ save selection as sub-workflow
      </button>
    </template>
    <button
      v-if="isGroup"
      class="node-ctx-item"
      @click="emit('ungroup')"
    >
      ▦ ungroup
    </button>
    <button
      v-if="isLinked"
      class="node-ctx-item"
      @click="emit('sync-frame')"
    >
      ↻ sync from sub-workflow
    </button>
    <button
      v-if="isGroup"
      class="node-ctx-item"
      @click="emit('cleanup-frame')"
    >
      ⊡ cleanup this frame
    </button>
    <div v-if="isGroup" class="wire-sect micro-label">frame</div>
    <button
      v-if="isGroup"
      class="node-ctx-item"
      @click="emit('remove-frame')"
    >
      ⌫ remove frame from canvas
    </button>
    <button
      v-if="isLinked"
      class="node-ctx-item"
      @click="emit('delete-linked-subgraph')"
    >
      ⌫ delete linked subgraph
    </button>
    <button class="node-ctx-item" @click="emit('cleanup-arrangement')">
      ⊡ cleanup arrangement
    </button>
  </div>
</template>

<script setup lang="ts">
export interface CtxExchangeAgent {
  provider: string;
  name: string;
  source: string;
  description?: string;
  model?: string;
  current?: boolean;
}

defineProps<{
  x: number;
  y: number;
  label: string;
  path?: string;
  pathIsText: boolean;
  editorLabel: string;
  copyBusy: boolean;
  graphRunning: boolean;
  isOutput: boolean;
  canClearOutput: boolean;
  isData: boolean;
  canClearData: boolean;
  mutable: boolean;
  muted: boolean;
  bypassed: boolean;
  retry: number;
  continueOnError: boolean;
  isAgent: boolean;
  modelOpen: boolean;
  modelCurrent?: string;
  models: string[];
  exchangeOpen: boolean;
  exchangeAgents: CtxExchangeAgent[];
  selectedCount: number;
  isGroup: boolean;
  isLinked: boolean;
}>();

const emit = defineEmits<{
  "open-viewer": [];
  "open-in-code": [];
  "copy-path": [];
  "copy-content": [];
  "run-from": [];
  "test-node": [];
  "clear-output": [];
  "clear-data": [];
  "toggle-mute": [];
  "toggle-bypass": [];
  "cycle-retry": [];
  "toggle-continue-on-error": [];
  "open-model-menu": [];
  "close-model-menu": [];
  "toggle-model-menu": [];
  "set-model": [model: string | undefined];
  "open-exchange-menu": [];
  "close-exchange-menu": [];
  "toggle-exchange-menu": [];
  "exchange-agent": [agent: CtxExchangeAgent];
  "group-selection": [];
  "save-selection-as-workflow": [];
  ungroup: [];
  "sync-frame": [];
  "cleanup-frame": [];
  "remove-frame": [];
  "delete-linked-subgraph": [];
  "cleanup-arrangement": [];
}>();
</script>

<style scoped>
.node-ctx {
  position: fixed;
  z-index: 60;
  min-width: 190px;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.node-ctx-title {
  font-size: var(--fs-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  padding: 5px 9px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 3px;
}
.node-ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text-dim);
  cursor: pointer;
}
.node-ctx-item:hover:not(:disabled) {
  background: var(--input-bg);
  color: var(--text);
}
.node-ctx-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.node-ctx-subwrap {
  position: relative;
}
.node-ctx-has-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.node-ctx-has-sub.open,
.node-ctx-subwrap:hover > .node-ctx-has-sub {
  background: var(--input-bg);
  color: var(--text);
}
.node-ctx-chevron {
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.node-ctx-flyout {
  position: absolute;
  left: calc(100% + 4px);
  top: 0;
  min-width: 220px;
  max-width: 280px;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  z-index: 61;
  display: flex;
  flex-direction: column;
}
.node-ctx-flyout-scroll {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.node-ctx-flyout-scroll > * {
  flex-shrink: 0;
}
.node-ctx-item.current {
  opacity: 0.55;
}
.node-ctx-empty {
  padding: 8px 9px;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.prov-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 6px;
  background: var(--text-faint);
  vertical-align: middle;
}
.prov-dot[data-p="claude-code"] { background: var(--claude); }
.prov-dot[data-p="opencode"] { background: var(--opencode); }
.prov-dot[data-p="cursor"] { background: var(--cursor); }
.prov-dot[data-p="antigravity"] { background: var(--antigravity); }
.prov-dot[data-p="codex"] { background: var(--codex); }
.prov-dot[data-p="copilot"] { background: var(--copilot); }
.prov-dot[data-p="grok"] { background: var(--grok); }
.prov-dot[data-p="muse"] { background: var(--muse); }
.wire-sect {
  padding: 7px 9px 3px;
  border-top: 1px solid var(--border);
  margin-top: 3px;
}
.wire-dim {
  font-style: normal;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
</style>
