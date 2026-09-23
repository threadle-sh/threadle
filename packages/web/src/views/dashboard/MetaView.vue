<template>
  <div class="meta-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Meta</h1>
      </div>
    </header>

    <div class="dash-toolbar meta-toolbar">
      <input
        v-model="query"
        class="threadle-input dash-search"
        placeholder="Filter…"
        spellcheck="false"
      />
      <div class="chip-row">
        <button
          v-for="f in SECTION_FILTERS"
          :key="f.id"
          type="button"
          class="filter-chip"
          :class="{ active: sectionFilter === f.id }"
          @click="sectionFilter = f.id"
        >
          {{ f.label }}{{ f.id === "all" ? "" : ` · ${sectionCounts[f.id]}` }}
        </button>
      </div>
      <select v-model="listSort" class="threadle-input sort-select">
        <option value="updated">recent first</option>
        <option value="name">name A–Z</option>
        <option value="size">largest first</option>
      </select>
    </div>
  </div>

  <div class="sess-layout">
    <div class="sess-list">
      <template v-if="showWorkflows">
        <div class="sess-group">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name">{{
              sectionFilter === "subgraph" ? "subgraphs" : "workflows"
            }}</span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ filteredGraphs.length }}</span>
          </div>
          <p v-if="!filteredGraphs.length" class="stat-note">
            {{ graphs.length ? "no workflows match these filters" : "no workflows yet" }}
          </p>
          <div v-for="g in filteredGraphs" :key="g.id" class="sess-block">
            <div
              class="sess-row"
              :class="{
                picked: picked?.kind === 'graph' && picked.graph.id === g.id,
                ctx: metaCtx?.kind === 'graph' && metaCtx.graph.id === g.id,
              }"
              @click="pickGraph(g)"
              @contextmenu.prevent.stop="openGraphCtx($event, g)"
              @mousedown="onGraphMouseDown($event, g)"
            >
              <span class="sess-title" :title="g.name">{{ g.name }}</span>
              <span class="sess-meta meta-kind mono">{{ g.kind }}</span>
              <span
                class="sess-meta meta-nw mono"
                :title="`${g.nodeCount} nodes · ${g.edgeCount} wires`"
                >{{ g.nodeCount }} · {{ g.edgeCount }}</span
              >
              <span class="sess-meta meta-time" :title="absWhen(g.updatedAt)">{{
                relativeTime(g.updatedAt)
              }}</span>
              <div
                class="row-actions meta-graph-actions"
                :class="{ pinned: openMenu === 'g:' + g.id }"
                @click.stop
              >
                <button
                  type="button"
                  class="row-icon"
                  title="Open canvas"
                  @click="router.push(`/graph/${g.id}`)"
                >
                  ⌗
                </button>
                <div class="row-menu">
                  <button
                    type="button"
                    class="row-icon menu-btn"
                    :class="{ open: openMenu === 'g:' + g.id }"
                    title="More actions"
                    @click="toggleMenu('g:' + g.id)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenu === 'g:' + g.id" class="menu-pop">
                    <button
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => router.push(`/graph/${g.id}`))"
                    >
                      <span class="menu-glyph">⌗</span> Open canvas
                    </button>
                    <button
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => copyText(g.id))"
                    >
                      <span class="menu-glyph">❐</span> Copy id
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="showDisk">
        <div class="dash-load-host">
          <GraphLoadingOverlay
            :loading="ruleGroups === undefined"
            label="Loading artifacts"
          />
        <p v-if="ruleGroups !== undefined && !filteredRuleGroups.length" class="stat-note">
          {{
            artifactTotal
              ? "no artifacts match these filters"
              : "none found — threadle looks for CLAUDE.md, CLAUDE.local.md, AGENTS.md, .cursorrules, .cursor/rules/, .claude/agents/, .claude/skills/ and .opencode/skills/ in every project with sessions, plus the global ~/.claude and ~/.config/opencode locations."
          }}
        </p>
        <template v-if="ruleGroups !== undefined">
        <div v-for="rg in filteredRuleGroups" :key="rg.scope" class="sess-group">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name" :title="rg.scope">
              {{ rg.scope === "global" ? "global (~)" : rg.scope }}
            </span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ rg.artifacts.length }}</span>
          </div>
          <div v-for="a in rg.artifacts" :key="a.path" class="sess-block">
            <div
              class="sess-row"
              :class="{
                picked: picked?.kind === 'artifact' && picked.artifact.path === a.path,
                ctx: metaCtx?.kind === 'artifact' && metaCtx.artifact.path === a.path,
              }"
              @click="pickArtifact(a, rg.scope)"
              @contextmenu.prevent.stop="openArtifactCtx($event, a, rg.scope)"
              @mousedown="onArtifactMouseDown($event, a, rg.scope)"
            >
              <span class="op-badge" :class="'rule-' + a.kind">{{ a.kind }}</span>
              <span class="sess-title mono" :title="a.name">{{ a.name }}</span>
              <span class="sess-meta meta-size mono">{{ fmtBytes(a.size) }}</span>
              <span class="sess-meta meta-time" :title="absWhen(a.mtime)">{{
                relativeTime(a.mtime)
              }}</span>
              <div
                class="row-actions meta-art-actions"
                :class="{ pinned: openMenu === 'a:' + a.path }"
                @click.stop
              >
                <button
                  v-if="isLikelyTextPath(a.path)"
                  type="button"
                  class="row-icon"
                  title="Open"
                  @click="fileViewers.open(a.path)"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  class="row-icon"
                  :title="`Open in ${settings.editorLabel}`"
                  @click="settings.openPath(a.path)"
                >
                  ⟨/⟩
                </button>
                <div class="row-menu">
                  <button
                    type="button"
                    class="row-icon menu-btn"
                    :class="{ open: openMenu === 'a:' + a.path }"
                    title="More actions"
                    @click="toggleMenu('a:' + a.path)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenu === 'a:' + a.path" class="menu-pop">
                    <button
                      v-if="isLikelyTextPath(a.path)"
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => fileViewers.open(a.path))"
                    >
                      <span class="menu-glyph">⧉</span> Open
                    </button>
                    <button
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => settings.openPath(a.path))"
                    >
                      <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
                    </button>
                    <button
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => copyText(a.path))"
                    >
                      <span class="menu-glyph">❐</span> Copy path
                    </button>
                    <button
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => emitNav(a.kind === 'skill' ? 'skills' : 'rules'))"
                    >
                      <span class="menu-glyph">→</span>
                      {{ a.kind === "skill" ? "Skills" : "Rules" }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </template>
        </div>
      </template>

      <template v-if="showStorage">
        <div class="sess-group">
          <div class="sess-group-head">
            <span class="micro-label sess-group-name">storage</span>
            <span class="sess-group-spacer" />
            <span class="sess-meta mono">{{ filteredStorage.length }}</span>
          </div>
          <p v-if="!filteredStorage.length" class="stat-note">no storage paths match</p>
          <div v-for="p in filteredStorage" :key="p.path" class="sess-block">
            <div
              class="sess-row"
              :class="{
                picked: picked?.kind === 'storage' && picked.path === p.path,
                ctx: metaCtx?.kind === 'storage' && metaCtx.path === p.path,
              }"
              @click="pickStorage(p)"
              @contextmenu.prevent.stop="openStorageCtx($event, p)"
              @mousedown="onStorageMouseDown($event, p)"
            >
              <span class="sess-title mono" :title="p.path">{{ p.path }}</span>
              <span class="sess-meta meta-owner mono">{{ p.owner }}</span>
              <span class="sess-meta meta-access" :title="p.desc">{{ p.access }}</span>
              <div
                class="row-actions meta-store-actions"
                :class="{ pinned: openMenu === 's:' + p.path }"
                @click.stop
              >
                <button
                  type="button"
                  class="row-icon"
                  title="Copy path"
                  @click="copyText(p.path)"
                >
                  ❐
                </button>
                <div class="row-menu">
                  <button
                    type="button"
                    class="row-icon menu-btn"
                    :class="{ open: openMenu === 's:' + p.path }"
                    title="More actions"
                    @click="toggleMenu('s:' + p.path)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenu === 's:' + p.path" class="menu-pop">
                    <button
                      type="button"
                      class="menu-item"
                      @click="menuAction(() => copyText(p.path))"
                    >
                      <span class="menu-glyph">❐</span> Copy path
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <aside v-if="picked?.kind === 'graph'" class="sess-detail">
      <div class="sess-detail-head">
        <div class="sess-detail-titles">
          <div class="sess-detail-title" :title="picked.graph.name">{{ picked.graph.name }}</div>
          <div class="sess-detail-meta mono">
            <span>{{ picked.graph.kind }}</span>
            <span>{{ picked.graph.nodeCount }} nodes</span>
            <span>{{ picked.graph.edgeCount }} wires</span>
          </div>
        </div>
        <DetailExpandControls
          @expand="detailExpanded = true"
          @close="closeMetaPicked"
        />
      </div>
      <div class="sess-detail-actions">
        <button type="button" class="vsc-btn" @click="router.push(`/graph/${picked.graph.id}`)">
          ⌗ open canvas
        </button>
        <button type="button" class="vsc-btn" @click="copyText(picked.graph.id)">
          {{ pathCopied === picked.graph.id ? "✓ copied" : "❐ id" }}
        </button>
      </div>
      <div class="run-kv mono">
        <span class="run-key">id</span>
        <span class="run-val" :title="picked.graph.id">{{ picked.graph.id }}</span>
        <span class="run-key">kind</span>
        <span class="run-val">{{ picked.graph.kind }}</span>
        <span class="run-key">nodes</span>
        <span class="run-val">{{ picked.graph.nodeCount }}</span>
        <span class="run-key">wires</span>
        <span class="run-val">{{ picked.graph.edgeCount }}</span>
        <span class="run-key">used by</span>
        <span class="run-val">{{
          picked.graph.kind === "subgraph" ? (picked.graph.usedBy ?? 0) : "—"
        }}</span>
        <span class="run-key">created</span>
        <span class="run-val" :title="String(picked.graph.createdAt)">{{
          absWhen(picked.graph.createdAt)
        }}</span>
        <span class="run-key">updated</span>
        <span class="run-val" :title="String(picked.graph.updatedAt)">{{
          absWhen(picked.graph.updatedAt)
        }}</span>
        <span class="run-key">age</span>
        <span class="run-val">{{ relativeTime(picked.graph.createdAt) }}</span>
        <span class="run-key">touched</span>
        <span class="run-val">{{ relativeTime(picked.graph.updatedAt) }}</span>
      </div>
    </aside>

    <aside v-else-if="picked?.kind === 'artifact'" class="sess-detail">
      <div class="sess-detail-head">
        <div class="sess-detail-titles">
          <div class="sess-detail-title mono" :title="picked.artifact.name">
            {{ picked.artifact.name }}
          </div>
          <div class="sess-detail-meta mono">
            <span class="op-badge" :class="'rule-' + picked.artifact.kind">{{
              picked.artifact.kind
            }}</span>
            <span>{{ fmtBytes(picked.artifact.size) }}</span>
            <span>{{ relativeTime(picked.artifact.mtime) }}</span>
          </div>
        </div>
        <DetailExpandControls
          @expand="detailExpanded = true"
          @close="closeMetaPicked"
        />
      </div>
      <div class="sess-detail-actions">
        <button
          v-if="isLikelyTextPath(picked.artifact.path)"
          type="button"
          class="vsc-btn"
          title="Open"
          @click="fileViewers.open(picked.artifact.path)"
        >
          ⧉ open
        </button>
        <button
          type="button"
          class="vsc-btn"
          :title="`Open in ${settings.editorLabel}`"
          @click="settings.openPath(picked.artifact.path)"
        >
          ⟨/⟩ {{ settings.editorLabel }}
        </button>
        <button
          type="button"
          class="vsc-btn"
          title="Copy path"
          @click="copyText(picked.artifact.path)"
        >
          {{ pathCopied === picked.artifact.path ? "✓ copied" : "❐ path" }}
        </button>
        <button
          v-if="picked.artifact.kind === 'skill'"
          type="button"
          class="vsc-btn"
          @click="emitNav('skills')"
        >
          → skills
        </button>
        <button v-else type="button" class="vsc-btn" @click="emitNav('rules')">→ rules</button>
      </div>
      <div class="run-kv mono">
        <span class="run-key">kind</span>
        <span class="run-val">{{ picked.artifact.kind }}</span>
        <span class="run-key">name</span>
        <span class="run-val">{{ picked.artifact.name }}</span>
        <span class="run-key">source</span>
        <span class="run-val" :title="picked.artifact.source">{{ picked.artifact.source }}</span>
        <span class="run-key">scope</span>
        <span class="run-val" :title="picked.scope">{{
          picked.scope === "global" ? "global (~)" : picked.scope
        }}</span>
        <span class="run-key">path</span>
        <span class="run-val file-path" :title="picked.artifact.path">{{
          bidiPath(picked.artifact.path)
        }}</span>
        <span class="run-key">size</span>
        <span class="run-val"
          >{{ fmtBytes(picked.artifact.size) }} ({{ picked.artifact.size }} B)</span
        >
        <span class="run-key">modified</span>
        <span class="run-val">{{ absWhen(picked.artifact.mtime) }}</span>
        <span class="run-key">origin</span>
        <span class="run-val">{{ picked.artifact.origin ?? "—" }}</span>
        <span class="run-key">layer</span>
        <span class="run-val">{{
          picked.artifact.layer != null ? picked.artifact.layer : "—"
        }}</span>
        <span class="run-key">auto-invoke</span>
        <span class="run-val">{{
          picked.artifact.kind !== "skill"
            ? "—"
            : picked.artifact.autoInvoke === false
              ? "manual"
              : "auto"
        }}</span>
        <span class="run-key">shadowed by</span>
        <span class="run-val" :title="picked.artifact.shadowedBy">{{
          picked.artifact.shadowedBy ?? "—"
        }}</span>
      </div>
      <template v-if="picked.artifact.description">
        <div class="micro-label">description</div>
        <p class="meta-desc">{{ picked.artifact.description }}</p>
      </template>
    </aside>

    <aside v-else-if="picked?.kind === 'storage'" class="sess-detail">
      <div class="sess-detail-head">
        <div class="sess-detail-titles">
          <div class="sess-detail-title mono" :title="picked.path">{{ picked.path }}</div>
          <div class="sess-detail-meta mono">
            <span>{{ picked.access }}</span>
            <span>{{ picked.owner }}</span>
          </div>
        </div>
        <DetailExpandControls
          @expand="detailExpanded = true"
          @close="closeMetaPicked"
        />
      </div>
      <div class="sess-detail-actions">
        <button type="button" class="vsc-btn" @click="copyText(picked.path)">
          {{ pathCopied === picked.path ? "✓ copied" : "❐ path" }}
        </button>
      </div>
      <div class="run-kv mono">
        <span class="run-key">path</span>
        <span class="run-val">{{ picked.path }}</span>
        <span class="run-key">access</span>
        <span class="run-val">{{ picked.access }}</span>
        <span class="run-key">owns</span>
        <span class="run-val">{{ picked.owner }}</span>
      </div>
      <p class="meta-desc">{{ picked.desc }}</p>
    </aside>

    <DetailExpandModal
      :open="!!picked && detailExpanded"
      :label="metaDetailExpandLabel"
      @close="detailExpanded = false"
    >
      <template v-if="picked?.kind === 'graph'">
        <div class="sess-detail-head">
          <div class="sess-detail-titles">
            <div class="sess-detail-title" :title="picked.graph.name">{{ picked.graph.name }}</div>
            <div class="sess-detail-meta mono">
              <span>{{ picked.graph.kind }}</span>
              <span>{{ picked.graph.nodeCount }} nodes</span>
            </div>
          </div>
          <DetailExpandControls hide-expand @close="detailExpanded = false" />
        </div>
        <div class="sess-detail-actions">
          <button type="button" class="vsc-btn" @click="router.push(`/graph/${picked.graph.id}`)">
            ⌗ open canvas
          </button>
          <button type="button" class="vsc-btn" @click="copyText(picked.graph.id)">
            {{ pathCopied === picked.graph.id ? "✓ copied" : "❐ id" }}
          </button>
        </div>
        <div class="run-kv mono">
          <span class="run-key">id</span>
          <span class="run-val" :title="picked.graph.id">{{ picked.graph.id }}</span>
          <span class="run-key">kind</span>
          <span class="run-val">{{ picked.graph.kind }}</span>
          <span class="run-key">nodes</span>
          <span class="run-val">{{ picked.graph.nodeCount }}</span>
          <span class="run-key">wires</span>
          <span class="run-val">{{ picked.graph.edgeCount }}</span>
          <span class="run-key">updated</span>
          <span class="run-val">{{ absWhen(picked.graph.updatedAt) }}</span>
        </div>
      </template>
      <template v-else-if="picked?.kind === 'artifact'">
        <div class="sess-detail-head">
          <div class="sess-detail-titles">
            <div class="sess-detail-title mono" :title="picked.artifact.name">
              {{ picked.artifact.name }}
            </div>
            <div class="sess-detail-meta mono">
              <span class="op-badge" :class="'rule-' + picked.artifact.kind">{{
                picked.artifact.kind
              }}</span>
              <span>{{ fmtBytes(picked.artifact.size) }}</span>
            </div>
          </div>
          <DetailExpandControls hide-expand @close="detailExpanded = false" />
        </div>
        <div class="sess-detail-actions">
          <button
            v-if="isLikelyTextPath(picked.artifact.path)"
            type="button"
            class="vsc-btn"
            @click="fileViewers.open(picked.artifact.path)"
          >
            ⧉ open
          </button>
          <button
            type="button"
            class="vsc-btn"
            @click="settings.openPath(picked.artifact.path)"
          >
            ⟨/⟩ {{ settings.editorLabel }}
          </button>
          <button type="button" class="vsc-btn" @click="copyText(picked.artifact.path)">
            {{ pathCopied === picked.artifact.path ? "✓ copied" : "❐ path" }}
          </button>
        </div>
        <div class="run-kv mono">
          <span class="run-key">scope</span>
          <span class="run-val">{{
            picked.scope === "global" ? "global (~)" : picked.scope
          }}</span>
          <span class="run-key">path</span>
          <span class="run-val file-path" :title="picked.artifact.path">{{
            bidiPath(picked.artifact.path)
          }}</span>
        </div>
        <template v-if="picked.artifact.description">
          <div class="micro-label">description</div>
          <p class="meta-desc">{{ picked.artifact.description }}</p>
        </template>
      </template>
      <template v-else-if="picked?.kind === 'storage'">
        <div class="sess-detail-head">
          <div class="sess-detail-titles">
            <div class="sess-detail-title mono" :title="picked.path">{{ picked.path }}</div>
            <div class="sess-detail-meta mono">
              <span>{{ picked.access }}</span>
              <span>{{ picked.owner }}</span>
            </div>
          </div>
          <DetailExpandControls hide-expand @close="detailExpanded = false" />
        </div>
        <div class="sess-detail-actions">
          <button type="button" class="vsc-btn" @click="copyText(picked.path)">
            {{ pathCopied === picked.path ? "✓ copied" : "❐ path" }}
          </button>
        </div>
        <p class="meta-desc">{{ picked.desc }}</p>
      </template>
    </DetailExpandModal>
  </div>

  <Teleport to="body">
    <div
      v-if="metaCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: metaCtx.x + 'px', top: metaCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <template v-if="metaCtx.kind === 'graph'">
        <button
          type="button"
          class="menu-item"
          @click="menuAction(() => openCtxGraph())"
        >
          <span class="menu-glyph">⌗</span> Open canvas
        </button>
        <button
          type="button"
          class="menu-item"
          @click="menuAction(() => copyCtxGraphId())"
        >
          <span class="menu-glyph">❐</span> Copy id
        </button>
      </template>
      <template v-else-if="metaCtx.kind === 'artifact'">
        <button
          v-if="isLikelyTextPath(metaCtx.artifact.path)"
          type="button"
          class="menu-item"
          @click="menuAction(() => openCtxArtifactViewer())"
        >
          <span class="menu-glyph">⧉</span> Open
        </button>
        <button
          type="button"
          class="menu-item"
          @click="menuAction(() => openCtxArtifactEditor())"
        >
          <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
        </button>
        <button
          type="button"
          class="menu-item"
          @click="menuAction(() => copyCtxArtifactPath())"
        >
          <span class="menu-glyph">❐</span> Copy path
        </button>
        <button
          type="button"
          class="menu-item"
          @click="menuAction(() => navCtxArtifact())"
        >
          <span class="menu-glyph">→</span>
          {{ metaCtx.artifact.kind === "skill" ? "Skills" : "Rules" }}
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="menu-item"
          @click="menuAction(() => copyCtxStoragePath())"
        >
          <span class="menu-glyph">❐</span> Copy path
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { GraphSummary } from "@threadle/shared";
import { bidiPath, relativeTime } from "@/lib/format";
import { copyToClipboard } from "@/lib/pathActions";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";
import "./chrome.css";

export interface RuleArtifact {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string;
  size: number;
  mtime: number;
  description?: string;
  autoInvoke?: boolean;
  origin?: "project" | "custom" | "imported" | "global";
  layer?: number;
  shadowedBy?: string;
}
export interface RuleGroup {
  scope: string;
  artifacts: RuleArtifact[];
}

const props = defineProps<{
  graphs: GraphSummary[];
  ruleGroups: RuleGroup[] | undefined;
}>();

const emit = defineEmits<{
  nav: [id: string];
}>();

const router = useRouter();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();

type SectionFilter = "all" | "workflow" | "subgraph" | "rules" | "agent" | "skill" | "storage";

const SECTION_FILTERS: { id: SectionFilter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "workflow", label: "workflows" },
  { id: "subgraph", label: "subgraphs" },
  { id: "rules", label: "rules" },
  { id: "agent", label: "agents" },
  { id: "skill", label: "skills" },
  { id: "storage", label: "storage" },
];

const STORAGE_PATHS = [
  {
    path: "~/.config/threadle/graphs",
    desc: "Saved workflow and subgraph JSON definitions.",
    access: "read / write",
    owner: "threadle",
  },
  {
    path: "~/.config/threadle/favorites.json",
    desc: "Jump-list bookmarks (workflows, sessions, library, skills, rules, files).",
    access: "read / write",
    owner: "threadle",
  },
  {
    path: "~/.config/threadle/payloads",
    desc: "Content-addressed context payloads (library / lineage).",
    access: "read / write",
    owner: "threadle",
  },
  {
    path: "~/.claude/projects",
    desc: "Claude Code session transcripts.",
    access: "read-only",
    owner: "claude-code",
  },
  {
    path: "~/.local/share/opencode/opencode.db",
    desc: "opencode session database.",
    access: "read-only",
    owner: "opencode",
  },
  {
    path: "~/.cursor/projects",
    desc: "Cursor Agent transcripts.",
    access: "read-only",
    owner: "cursor",
  },
  {
    path: "~/.gemini/antigravity-cli",
    desc: "Antigravity brain + conversations.",
    access: "read-only",
    owner: "antigravity",
  },
  {
    path: "~/.codex/sessions",
    desc: "Codex rollouts.",
    access: "read-only",
    owner: "codex",
  },
  {
    path: "~/.copilot",
    desc: "GitHub Copilot sessions.",
    access: "read-only",
    owner: "copilot",
  },
  {
    path: "~/.grok/sessions",
    desc: "Grok Build sessions.",
    access: "read-only",
    owner: "grok",
  },
  {
    path: "~/.local/share/muse/sessions",
    desc: "Muse Code sessions.",
    access: "read-only",
    owner: "muse",
  },
  {
    path: "~/.muse",
    desc: "Muse Code config.",
    access: "read-only",
    owner: "muse",
  },
] as const;

type StoragePath = (typeof STORAGE_PATHS)[number];

type Picked =
  | { kind: "graph"; graph: GraphSummary }
  | { kind: "artifact"; artifact: RuleArtifact; scope: string }
  | {
      kind: "storage";
      path: string;
      desc: string;
      access: string;
      owner: string;
    };

type MetaCtx =
  | { kind: "graph"; graph: GraphSummary; x: number; y: number }
  | { kind: "artifact"; artifact: RuleArtifact; scope: string; x: number; y: number }
  | { kind: "storage"; path: string; x: number; y: number };

const sectionFilter = ref<SectionFilter>("all");
const query = ref("");
const listSort = ref<"updated" | "name" | "size">("updated");
const picked = ref<Picked>();
const detailExpanded = ref(false);
const openMenu = ref<string>();

const metaDetailExpandLabel = computed(() => {
  const p = picked.value;
  if (!p) return "Details";
  if (p.kind === "graph") return p.graph.name;
  if (p.kind === "artifact") return p.artifact.name;
  return p.path;
});

function closeMetaPicked(): void {
  picked.value = undefined;
  detailExpanded.value = false;
}
const metaCtx = ref<MetaCtx>();
const pathCopied = ref<string>();
let metaCtxIgnoreClick = false;
let pathCopiedTimer: ReturnType<typeof setTimeout> | undefined;

const q = computed(() => query.value.trim().toLowerCase());

function matchesQuery(...parts: Array<string | number | undefined | null>): boolean {
  const needle = q.value;
  if (!needle) return true;
  return parts.some((p) => p != null && String(p).toLowerCase().includes(needle));
}

const workflowCount = computed(
  () => props.graphs.filter((g) => g.kind !== "subgraph").length,
);
const subgraphCount = computed(
  () => props.graphs.filter((g) => g.kind === "subgraph").length,
);

const allArtifacts = computed(() =>
  (props.ruleGroups ?? []).flatMap((rg) =>
    rg.artifacts.map((a) => ({ artifact: a, scope: rg.scope })),
  ),
);

const artifactTotal = computed(() => allArtifacts.value.length);

const sectionCounts = computed(() => {
  const arts = allArtifacts.value;
  return {
    workflow: workflowCount.value,
    subgraph: subgraphCount.value,
    rules: arts.filter((x) => x.artifact.kind === "rules").length,
    agent: arts.filter((x) => x.artifact.kind === "agent").length,
    skill: arts.filter((x) => x.artifact.kind === "skill").length,
    storage: STORAGE_PATHS.length,
  };
});

const showWorkflows = computed(
  () =>
    sectionFilter.value === "all" ||
    sectionFilter.value === "workflow" ||
    sectionFilter.value === "subgraph",
);
const showDisk = computed(
  () =>
    sectionFilter.value === "all" ||
    sectionFilter.value === "rules" ||
    sectionFilter.value === "agent" ||
    sectionFilter.value === "skill",
);
const showStorage = computed(
  () => sectionFilter.value === "all" || sectionFilter.value === "storage",
);

const filteredStorage = computed(() =>
  STORAGE_PATHS.filter((p) => matchesQuery(p.path, p.desc, p.access, p.owner)),
);

const filteredGraphs = computed(() => {
  let list = props.graphs;
  if (sectionFilter.value === "workflow") {
    list = list.filter((g) => g.kind !== "subgraph");
  } else if (sectionFilter.value === "subgraph") {
    list = list.filter((g) => g.kind === "subgraph");
  }
  list = list.filter((g) =>
    matchesQuery(g.name, g.id, g.kind, g.nodeCount, g.edgeCount),
  );
  const rows = [...list];
  if (listSort.value === "name") {
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } else if (listSort.value === "size") {
    rows.sort(
      (a, b) =>
        b.nodeCount + b.edgeCount - (a.nodeCount + a.edgeCount) ||
        b.updatedAt - a.updatedAt,
    );
  } else {
    rows.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
  }
  return rows;
});

const filteredRuleGroups = computed(() => {
  const groups = props.ruleGroups ?? [];
  const kindFilter =
    sectionFilter.value === "rules" ||
    sectionFilter.value === "agent" ||
    sectionFilter.value === "skill"
      ? sectionFilter.value
      : null;

  const out: RuleGroup[] = [];
  for (const rg of groups) {
    let artifacts = rg.artifacts.filter((a) => {
      if (kindFilter && a.kind !== kindFilter) return false;
      return matchesQuery(
        a.name,
        a.path,
        a.source,
        a.kind,
        a.description,
        a.origin,
        a.shadowedBy,
        rg.scope,
      );
    });
    artifacts = [...artifacts];
    if (listSort.value === "name") {
      artifacts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } else if (listSort.value === "size") {
      artifacts.sort((a, b) => b.size - a.size || b.mtime - a.mtime);
    } else {
      artifacts.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
    }
    if (artifacts.length) out.push({ scope: rg.scope, artifacts });
  }
  return out;
});

function pickGraph(g: GraphSummary): void {
  detailExpanded.value = false;
  picked.value =
    picked.value?.kind === "graph" && picked.value.graph.id === g.id
      ? undefined
      : { kind: "graph", graph: g };
}

function pickArtifact(a: RuleArtifact, scope: string): void {
  detailExpanded.value = false;
  picked.value =
    picked.value?.kind === "artifact" && picked.value.artifact.path === a.path
      ? undefined
      : { kind: "artifact", artifact: a, scope };
}

function pickStorage(p: StoragePath): void {
  detailExpanded.value = false;
  picked.value =
    picked.value?.kind === "storage" && picked.value.path === p.path
      ? undefined
      : {
          kind: "storage",
          path: p.path,
          desc: p.desc,
          access: p.access,
          owner: p.owner,
        };
}

function emitNav(id: string): void {
  emit("nav", id);
}

function absWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function placeMenu(e: MouseEvent, w = 248, h = 180): { x: number; y: number } {
  const pad = 8;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  return { x: Math.max(pad, x), y: Math.max(pad, y) };
}

function armCtxIgnore(): void {
  metaCtxIgnoreClick = true;
  window.setTimeout(() => {
    metaCtxIgnoreClick = false;
  }, 400);
}

function openGraphCtx(e: MouseEvent, graph: GraphSummary): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const { x, y } = placeMenu(e, 220, 100);
  armCtxIgnore();
  metaCtx.value = { kind: "graph", graph, x, y };
}

function onGraphMouseDown(e: MouseEvent, graph: GraphSummary): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openGraphCtx(e, graph);
}

function openArtifactCtx(e: MouseEvent, artifact: RuleArtifact, scope: string): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const { x, y } = placeMenu(e, 248, 180);
  armCtxIgnore();
  metaCtx.value = { kind: "artifact", artifact, scope, x, y };
}

function onArtifactMouseDown(e: MouseEvent, artifact: RuleArtifact, scope: string): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openArtifactCtx(e, artifact, scope);
}

function openStorageCtx(e: MouseEvent, p: StoragePath): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const { x, y } = placeMenu(e, 200, 80);
  armCtxIgnore();
  metaCtx.value = { kind: "storage", path: p.path, x, y };
}

function onStorageMouseDown(e: MouseEvent, p: StoragePath): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openStorageCtx(e, p);
}

function toggleMenu(key: string): void {
  metaCtx.value = undefined;
  openMenu.value = openMenu.value === key ? undefined : key;
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    openMenu.value = undefined;
    metaCtx.value = undefined;
  }
}

function openCtxGraph(): void {
  const c = metaCtx.value;
  if (c?.kind !== "graph") return;
  void router.push(`/graph/${c.graph.id}`);
}

function copyCtxGraphId(): void {
  const c = metaCtx.value;
  if (c?.kind !== "graph") return;
  void copyText(c.graph.id);
}

function openCtxArtifactViewer(): void {
  const c = metaCtx.value;
  if (c?.kind !== "artifact") return;
  void fileViewers.open(c.artifact.path);
}

function openCtxArtifactEditor(): void {
  const c = metaCtx.value;
  if (c?.kind !== "artifact") return;
  settings.openPath(c.artifact.path);
}

function copyCtxArtifactPath(): void {
  const c = metaCtx.value;
  if (c?.kind !== "artifact") return;
  void copyText(c.artifact.path);
}

function navCtxArtifact(): void {
  const c = metaCtx.value;
  if (c?.kind !== "artifact") return;
  emitNav(c.artifact.kind === "skill" ? "skills" : "rules");
}

function copyCtxStoragePath(): void {
  const c = metaCtx.value;
  if (c?.kind !== "storage") return;
  void copyText(c.path);
}

async function copyText(text: string): Promise<void> {
  const ok = await copyToClipboard(text);
  if (!ok) return;
  pathCopied.value = text;
  if (pathCopiedTimer) clearTimeout(pathCopiedTimer);
  pathCopiedTimer = setTimeout(() => {
    pathCopied.value = undefined;
  }, 1500);
}

function onDocClick(e: MouseEvent): void {
  if (metaCtxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".row-menu") && !t.closest?.(".wf-folder-ctx")) {
    openMenu.value = undefined;
    metaCtx.value = undefined;
  }
}

watch([sectionFilter, query], () => {
  const p = picked.value;
  if (!p) return;
  if (p.kind === "graph") {
    if (!filteredGraphs.value.some((g) => g.id === p.graph.id)) closeMetaPicked();
    return;
  }
  if (p.kind === "artifact") {
    const still = filteredRuleGroups.value.some((rg) =>
      rg.artifacts.some((a) => a.path === p.artifact.path),
    );
    if (!still) closeMetaPicked();
    return;
  }
  if (p.kind === "storage") {
    if (!showStorage.value || !filteredStorage.value.some((s) => s.path === p.path)) {
      closeMetaPicked();
    }
  }
});

onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  if (pathCopiedTimer) clearTimeout(pathCopiedTimer);
});
</script>

<style scoped>
.meta-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.meta-toolbar {
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.meta-toolbar .chip-row {
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: wrap;
}
.meta-kind {
  width: 72px;
}
.meta-nw {
  width: 64px;
  font-variant-numeric: tabular-nums;
}
.meta-time {
  width: 64px;
}
.meta-size {
  width: 64px;
  font-variant-numeric: tabular-nums;
}
.meta-owner {
  width: 88px;
}
.meta-access {
  width: 88px;
}
.meta-graph-actions,
.meta-art-actions {
  width: auto;
}
.meta-store-actions {
  width: auto;
}
.meta-desc {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: 1.45;
  white-space: pre-wrap;
}
.wf-folder-ctx {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 80;
}
.sess-row .op-badge {
  flex-shrink: 0;
}
</style>
