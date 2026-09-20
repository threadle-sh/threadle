<script setup lang="ts">
import type { AgentDef, ContextKind, NodeType, SessionRef } from "@threadle/shared";
import { providerColor, providerLabel } from "@/lib/providers";
import { relativeTime, shortId } from "@/lib/format";
import {
  dragAgent,
  dragBlock,
  dragContext,
  dragCustom,
  dragLibrary,
  dragRules,
  dragSession,
  dragSkill,
  dragSubgraph,
  type PaletteLibraryDragItem,
  type PaletteSkillDragRow,
} from "@/lib/paletteDrag";

export interface PaletteSearchGraph {
  id: string;
  name: string;
  nodeCount: number;
  usedBy?: number;
}

export interface PaletteSearchBlock {
  type: NodeType;
  label: string;
  hint: string;
  glyph: string;
  iconBg: string;
  iconFg?: string;
}

export interface PaletteSearchCustom {
  name: string;
  label: string;
  glyph: string;
  description?: string;
  kind: string;
  file?: string;
  command?: string[];
}

export interface PaletteSearchContextKind {
  kind: ContextKind;
  glyph: string;
  label: string;
  hint: string;
}

defineProps<{
  workflows: PaletteSearchGraph[];
  subgraphs: PaletteSearchGraph[];
  agents: AgentDef[];
  sessions: SessionRef[];
  blocks: PaletteSearchBlock[];
  custom: PaletteSearchCustom[];
  contextKinds: PaletteSearchContextKind[];
  skills: PaletteSkillDragRow[];
  rules: PaletteSkillDragRow[];
  library: Array<PaletteLibraryDragItem & { tags: string[] }>;
  hitCount: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  openGraph: [g: PaletteSearchGraph];
  dragEnd: [];
  graphDragStart: [];
}>();

function onDragGraph(e: DragEvent, g: PaletteSearchGraph): void {
  emit("graphDragStart");
  dragSubgraph(e, g);
}
</script>

<template>
  <div>
    <section v-if="workflows.length" class="pal-section">
      <div class="micro-label pal-sub-heading">workflows · {{ workflows.length }}</div>
      <div
        v-for="g in workflows"
        :key="'w-' + g.id"
        class="pal-item pal-item-clickable"
        draggable="true"
        @click="emit('openGraph', g)"
        @dragstart="onDragGraph($event, g)"
        @dragend="emit('dragEnd')"
      >
        <span class="pal-icon" style="background: var(--accent-soft); color: var(--text)">#</span>
        <div class="pal-item-body">
          <div class="pal-item-title pal-ellipsis">{{ g.name }}</div>
          <div class="pal-item-sub">{{ g.nodeCount }} nodes · workflow</div>
        </div>
      </div>
    </section>

    <section v-if="subgraphs.length" class="pal-section">
      <div class="micro-label pal-sub-heading">subgraphs · {{ subgraphs.length }}</div>
      <div
        v-for="g in subgraphs"
        :key="'s-' + g.id"
        class="pal-item pal-item-clickable"
        draggable="true"
        @click="emit('openGraph', g)"
        @dragstart="onDragGraph($event, g)"
        @dragend="emit('dragEnd')"
      >
        <span class="pal-icon" style="background: var(--panel-bg-raised); color: var(--text-dim)">⌗</span>
        <div class="pal-item-body">
          <div class="pal-item-title pal-ellipsis">{{ g.name }}</div>
          <div class="pal-item-sub">{{ g.nodeCount }} nodes</div>
        </div>
      </div>
    </section>

    <section v-if="agents.length" class="pal-section">
      <div class="micro-label pal-sub-heading">agents · {{ agents.length }}</div>
      <div
        v-for="agent in agents"
        :key="agent.provider + agent.name"
        class="pal-item"
        draggable="true"
        @dragstart="dragAgent($event, agent)"
      >
        <span
          class="pal-icon"
          :style="{ background: providerColor(agent.provider) }"
        >⟨/⟩</span>
        <div class="pal-item-body">
          <div class="pal-item-title">{{ agent.name }}</div>
          <div class="pal-item-sub">
            {{ providerLabel(agent.provider) }}
            · {{ agent.description ?? agent.scope }}
          </div>
        </div>
      </div>
    </section>

    <section v-if="sessions.length" class="pal-section">
      <div class="micro-label pal-sub-heading">sessions · {{ sessions.length }}</div>
      <div
        v-for="s in sessions"
        :key="s.provider + s.id"
        class="pal-item"
        draggable="true"
        @dragstart="dragSession($event, s)"
      >
        <span
          class="pal-icon"
          :style="{ background: providerColor(s.provider) }"
        >❯</span>
        <div class="pal-item-body">
          <div class="pal-item-title">{{ s.title ?? shortId(s.id) }}</div>
          <div class="pal-item-sub">
            {{ s.agent ? s.agent + " · " : "" }}{{ relativeTime(s.updatedAt) }}
          </div>
        </div>
        <span class="status-dot" :class="s.status" />
      </div>
    </section>

    <section v-if="blocks.length" class="pal-section">
      <div class="micro-label pal-sub-heading">blocks · {{ blocks.length }}</div>
      <div
        v-for="b in blocks"
        :key="b.type"
        class="pal-item"
        draggable="true"
        @dragstart="dragBlock($event, b.type)"
      >
        <span
          class="pal-icon"
          :style="{ background: b.iconBg, color: b.iconFg || undefined }"
        >{{ b.glyph }}</span>
        <div class="pal-item-body">
          <div class="pal-item-title">{{ b.label }}</div>
          <div class="pal-item-sub">{{ b.hint }}</div>
        </div>
      </div>
    </section>

    <section v-if="custom.length" class="pal-section">
      <div class="micro-label pal-sub-heading">custom · {{ custom.length }}</div>
      <div
        v-for="d in custom"
        :key="d.name"
        class="pal-item"
        draggable="true"
        :title="d.description ?? (d.kind === 'class' ? `class · ${d.file}` : d.command?.join(' '))"
        @dragstart="dragCustom($event, d.name)"
      >
        <span class="pal-icon" style="background: var(--context)">{{ d.glyph }}</span>
        <div class="pal-item-body">
          <div class="pal-item-title">{{ d.label }}</div>
          <div class="pal-item-sub">{{ d.description ?? "text in → text out" }}</div>
        </div>
      </div>
    </section>

    <section v-if="contextKinds.length" class="pal-section">
      <div class="micro-label pal-sub-heading">context · {{ contextKinds.length }}</div>
      <div
        v-for="ck in contextKinds"
        :key="ck.kind"
        class="pal-item"
        draggable="true"
        @dragstart="dragContext($event, ck.kind)"
      >
        <span class="pal-icon" style="background: var(--context)">{{ ck.glyph }}</span>
        <div class="pal-item-body">
          <div class="pal-item-title">{{ ck.label }}</div>
          <div class="pal-item-sub">{{ ck.hint }}</div>
        </div>
      </div>
    </section>

    <section v-if="skills.length" class="pal-section">
      <div class="micro-label pal-sub-heading">skills · {{ skills.length }}</div>
      <div
        v-for="a in skills"
        :key="a.path"
        class="pal-item"
        draggable="true"
        :title="a.description || a.path"
        @dragstart="dragSkill($event, a)"
      >
        <span class="pal-icon" style="background: var(--accent); color: var(--accent-fg)">✦</span>
        <div class="pal-item-body">
          <div class="pal-item-title mono">{{ a.name }}</div>
          <div class="pal-item-sub">{{ a.source }}</div>
        </div>
      </div>
    </section>

    <section v-if="rules.length" class="pal-section">
      <div class="micro-label pal-sub-heading">rules · {{ rules.length }}</div>
      <div
        v-for="a in rules"
        :key="a.path"
        class="pal-item"
        draggable="true"
        :title="a.path"
        @dragstart="dragRules($event, a)"
      >
        <span class="pal-icon" style="background: var(--lane-session); color: #0b1c30">§</span>
        <div class="pal-item-body">
          <div class="pal-item-title mono">{{ a.name }}</div>
          <div class="pal-item-sub">{{ a.source }}</div>
        </div>
      </div>
    </section>

    <section v-if="library.length" class="pal-section">
      <div class="micro-label pal-sub-heading">library · {{ library.length }}</div>
      <div
        v-for="pl in library"
        :key="pl.hash"
        class="pal-item"
        draggable="true"
        :title="pl.preview"
        @dragstart="dragLibrary($event, pl)"
      >
        <span class="pal-icon" style="background: var(--context)">❝</span>
        <div class="pal-item-body">
          <div class="pal-item-title pal-ellipsis">{{ pl.preview || pl.kind }}</div>
          <div class="pal-item-sub">
            {{ pl.kind }} · {{ pl.tags.length ? pl.tags.join(", ") : "untagged" }}
          </div>
        </div>
      </div>
    </section>

    <p v-if="!hitCount" class="pal-empty">
      {{ loading ? "loading catalog…" : "no matches across catalog" }}
    </p>
  </div>
</template>
