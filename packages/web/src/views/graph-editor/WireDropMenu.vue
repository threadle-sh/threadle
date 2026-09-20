<template>
  <div
    class="node-ctx wire-menu"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
    @contextmenu.prevent
  >
    <div class="node-ctx-title mono">{{ title }}</div>
    <input
      v-if="hasLists"
      :value="filter"
      class="wire-filter mono"
      placeholder="filter…"
      spellcheck="false"
      @keydown.stop
      @input="emit('update:filter', ($event.target as HTMLInputElement).value)"
    />
    <div class="wire-scroll">
      <button
        v-for="b in blocks"
        :key="b.label"
        class="node-ctx-item"
        @click="emit('pick', b.payload)"
      >
        {{ b.glyph }} {{ b.label }}
      </button>
      <div v-if="customs.length" class="wire-sect micro-label">custom nodes</div>
      <button
        v-for="d in customs"
        :key="d.name"
        class="node-ctx-item"
        :title="d.description"
        @click="emit('pick', { kind: 'custom', name: d.name })"
      >
        {{ d.glyph }} {{ d.label }}
      </button>
      <div v-if="agents.length" class="wire-sect micro-label">agents</div>
      <button
        v-for="a in agents"
        :key="a.provider + ':' + a.name"
        class="node-ctx-item"
        @click="emit('pick', { kind: 'agent-def', provider: a.provider, name: a.name, source: a.source })"
      >
        ⟨/⟩ {{ a.name }} <em class="wire-dim">{{ a.provider }}</em>
      </button>
      <div v-if="library.length" class="wire-sect micro-label">library</div>
      <button
        v-for="pl in library"
        :key="pl.hash"
        class="node-ctx-item wire-sess"
        :title="pl.preview"
        @click="emit('pick', { kind: 'context', contextKind: pl.kind, payloadHash: pl.hash, label: pl.preview.slice(0, 60) })"
      >
        ❝ {{ pl.preview || pl.kind }}
      </button>
      <div v-if="sessions.length" class="wire-sect micro-label">sessions</div>
      <button
        v-for="s in sessions"
        :key="s.provider + ':' + s.id"
        class="node-ctx-item wire-sess"
        @click="emit('pick', { kind: 'session', provider: s.provider, sessionId: s.id, snapshot: { title: s.title, agent: s.agent, projectDir: s.projectDir } })"
      >
        ❯ {{ s.title ?? s.id }}
      </button>
      <div
        v-if="!blocks.length && !agents.length && !sessions.length"
        class="wire-sect micro-label"
      >
        no compatible node
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProviderId } from "@threadle/shared";

export interface WireMenuBlock {
  label: string;
  glyph: string;
  /** Opaque pick payload (GraphEditor DragPayload). */
  payload: object;
}

export interface WireMenuCustom {
  name: string;
  label: string;
  glyph: string;
  description?: string;
}

export interface WireMenuAgent {
  provider: ProviderId | string;
  name: string;
  source: string;
}

export interface WireMenuLibItem {
  hash: string;
  kind: string;
  preview: string;
}

export interface WireMenuSession {
  provider: ProviderId | string;
  id: string;
  title?: string;
  agent?: string;
  projectDir?: string;
}

defineProps<{
  x: number;
  y: number;
  title: string;
  hasLists: boolean;
  filter: string;
  blocks: WireMenuBlock[];
  customs: WireMenuCustom[];
  agents: WireMenuAgent[];
  library: WireMenuLibItem[];
  sessions: WireMenuSession[];
}>();

const emit = defineEmits<{
  "update:filter": [value: string];
  pick: [payload: object];
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
.wire-menu {
  min-width: 230px;
  max-width: 300px;
}
.wire-scroll {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.wire-scroll > * {
  flex-shrink: 0;
}
.wire-filter {
  margin: 2px 5px 5px;
  padding: 5px 8px;
  font-size: var(--fs-xs);
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  outline: none;
}
.wire-filter:focus {
  border-color: var(--border-strong);
}
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
.wire-sess {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
