<template>
  <div class="map-page">
    <DashNav :items="navItems" active="map" @select="onNav" />
    <div class="map-main">
      <div class="map-chrome">
        <header class="dash-head">
          <div class="map-title-row">
            <button
              v-if="dir"
              type="button"
              class="map-back"
              title="Back to project list"
              @click="clearDir"
            >
              ←
            </button>
            <h1 class="dash-title">Map</h1>
          </div>
          <div v-if="dir" class="view-controls">
            <span class="map-project-switch">
              <button
                type="button"
                class="map-project-dd threadle-input"
                title="Switch project"
                :aria-expanded="projectPopOpen"
                @click.stop="toggleProjectPop"
              >
                <span class="mono map-project-dd-label" :title="dir">{{ dirShort }}</span>
                <span class="map-project-dd-caret" aria-hidden="true">▾</span>
              </button>
              <div
                v-if="projectPopOpen"
                class="map-project-pop"
                role="listbox"
                @click.stop
              >
                <input
                  ref="projectPopInput"
                  v-model="projectPopFilter"
                  class="threadle-input map-project-pop-search"
                  placeholder="Filter projects…"
                  spellcheck="false"
                  @keydown.esc.stop="closeProjectPop"
                />
                <div class="map-project-pop-list">
                  <button
                    v-for="row in projectPopRows"
                    :key="row.dir"
                    type="button"
                    class="map-project-pop-item"
                    :class="{ active: row.dir === dir }"
                    role="option"
                    :aria-selected="row.dir === dir"
                    :title="row.dir"
                    @click="pickProjectFromPop(row.dir)"
                  >
                    <span class="map-project-pop-name">{{ shortProjectPath(row.dir) }}</span>
                    <span class="map-project-pop-meta mono">
                      <template v-if="row.live">● </template>{{ row.count }} sess
                    </span>
                  </button>
                  <div v-if="!projectPopRows.length" class="map-project-pop-empty mono">
                    no projects match
                  </div>
                </div>
              </div>
            </span>
          </div>
          <div v-else class="view-controls">
            <ProviderFilterChips
              v-model="listProvider"
              :options="providerFilterChips"
            />
          </div>
        </header>

        <div v-if="!dir" class="dash-toolbar map-list-toolbar">
          <input
            v-model="listFilter"
            class="threadle-input dash-search"
            placeholder="Filter projects…"
            spellcheck="false"
          />
          <select v-model="listSort" class="threadle-input sort-select">
            <option value="updated">recent first</option>
            <option value="sessions">most sessions</option>
            <option value="messages">most messages</option>
            <option value="path">path A–Z</option>
          </select>
          <button
            type="button"
            class="filter-chip"
            :class="{ active: listLiveOnly }"
            :title="`only projects with a live session (${liveProjectCount})`"
            @click="listLiveOnly = !listLiveOnly"
          >
            ● active{{ liveProjectCount ? ` ${liveProjectCount}` : "" }}
          </button>
        </div>

        <div v-if="dir && doc" class="map-toolbar">
          <input
            v-model="query"
            class="threadle-input dash-search"
            placeholder="Search layers…"
            spellcheck="false"
          />
          <div class="type-filterbar">
            <span
              class="micro-label type-filter-label"
              title="Right-click for layer options"
              @contextmenu.prevent="openHubFilterMenu($event)"
            >show</span>
            <button
              v-for="h in HUBS"
              :key="h.id"
              class="type-chip"
              :class="{ active: isOpen(h.id) }"
              :title="`${h.label} · ${hubCount(doc, h.id)} — click to toggle, right-click for options`"
              @click="toggleHub(h.id)"
              @contextmenu.prevent="openHubFilterMenu($event, h.id)"
            >
              {{ h.glyph }} {{ h.label }}
              <em v-if="hubCount(doc, h.id)">{{ hubCount(doc, h.id) }}</em>
            </button>
            <button
              class="type-chip"
              title="Reload map for this project (keeps open layers)"
              :disabled="loading"
              @click="load"
            >
              ↻ refresh
            </button>
            <button class="type-chip" title="Fit the visible graph" @click="fitAll">⊡ fit</button>
          </div>
          <FilterChipMenu
            :open="!!hubFilterMenu"
            :x="hubFilterMenu?.x ?? 0"
            :y="hubFilterMenu?.y ?? 0"
            :title="hubFilterMenuTitle"
            :has-key="!!hubFilterMenu?.key"
            :has-nonempty="hubFilterHasNonempty"
            @only="applyHubFilterOnly"
            @except="applyHubFilterExcept"
            @add="applyHubFilterAdd"
            @hide="applyHubFilterHide"
            @show-all="applyHubFilterShowAll"
            @hide-all="applyHubFilterHideAll"
            @invert="applyHubFilterInvert"
            @nonempty="applyHubFilterNonempty"
          />
        </div>
        <div v-else-if="dir" class="map-toolbar">
          <div class="chip-row">
            <button
              class="filter-chip"
              title="Reload map for this project"
              :disabled="loading"
              @click="load"
            >
              ↻ refresh
            </button>
          </div>
        </div>
      </div>

      <div v-if="!dir" class="map-picker">
        <GraphLoadingOverlay
          :loading="listLoading"
          label="Loading projects"
        />
        <div v-if="!listLoading && !allProjectRows.length" class="map-dim">
          no project directories yet — open Sessions after agents have run
        </div>
        <div v-else-if="!listLoading && !projectRows.length" class="map-dim">
          no projects match these filters
        </div>
        <div v-else-if="!listLoading" class="map-pick-list">
          <div class="map-pick-cols micro-label">
            <span
              class="th"
              :class="{ sorted: listSort === 'path' }"
              @click="listSort = 'path'"
            >project<span v-if="listSort === 'path'" class="sort-mark"> ▾</span></span>
            <span
              class="th num"
              :class="{ sorted: listSort === 'sessions' }"
              @click="listSort = 'sessions'"
            >sessions<span v-if="listSort === 'sessions'" class="sort-mark"> ▾</span></span>
            <span
              class="th num"
              :class="{ sorted: listSort === 'messages' }"
              @click="listSort = 'messages'"
            >messages<span v-if="listSort === 'messages'" class="sort-mark"> ▾</span></span>
            <span
              class="th num"
              :class="{ sorted: listSort === 'updated' }"
              @click="listSort = 'updated'"
            >updated<span v-if="listSort === 'updated'" class="sort-mark"> ▾</span></span>
            <span class="th actions" aria-hidden="true" />
            <span class="th status" aria-hidden="true" />
          </div>
          <div
            v-for="row in projectRows"
            :key="row.dir"
            class="map-pick-block"
          >
            <div
              class="map-pick-row"
              :class="{ ctx: projectRowCtxDir === row.dir }"
              :title="row.dir"
              @click="selectDir(row.dir)"
              @contextmenu.prevent.stop="openProjectRowCtx($event, row)"
              @mousedown="onProjectRowMouseDown($event, row)"
            >
              <div class="map-pick-proj">
                <div class="map-pick-idents">
                  <span class="map-pick-basename">{{ projectBasename(row.dir) }}</span>
                  <span class="map-pick-parent mono">{{ projectParentLabel(row.dir) }}</span>
                </div>
                <span class="map-pick-provs">
                  <span
                    v-for="p in sortedProviders(row)"
                    :key="p"
                    class="prov-dot"
                    :style="{ background: providerColor(p) }"
                    :title="providerShort(p)"
                  />
                </span>
              </div>
              <span class="map-pick-meta mono" :title="`${row.count} session${row.count === 1 ? '' : 's'}`">{{
                fmtCount(row.count)
              }}</span>
              <span
                class="map-pick-meta mono"
                :title="row.messages ? `${fmtCount(row.messages)} messages` : 'no messages'"
              >{{ row.messages ? fmtCount(row.messages) : "—" }}</span>
              <span class="map-pick-meta mono map-pick-time" :title="absWhen(row.updatedAt)">{{
                relativeTime(row.updatedAt)
              }}</span>
              <div class="row-actions" @click.stop>
                <button
                  type="button"
                  class="row-icon"
                  title="Open project map"
                  @click="selectDir(row.dir)"
                >
                  ◈
                </button>
                <button
                  type="button"
                  class="row-icon"
                  :title="`Open in ${settings.editorLabel}`"
                  @click="settings.openPath(row.dir)"
                >
                  ⟨/⟩
                </button>
                <button
                  type="button"
                  class="row-icon"
                  title="Sessions in this project"
                  @click="goProjectSessions(row.dir)"
                >
                  ❯
                </button>
              </div>
              <span
                class="status-dot"
                :class="row.live ? 'live' : undefined"
                :title="row.live ? `${row.live} live session${row.live === 1 ? '' : 's'}` : 'idle'"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-else class="map-body">
        <div class="map-canvas">
          <VueFlow
            id="map"
            :nodes="flowNodes"
            :edges="flowEdges"
            :nodes-connectable="false"
            :default-edge-options="{ animated: false }"
            fit-view-on-init
            :min-zoom="0.2"
            @pane-click="onPaneClick"
            @nodes-initialized="fitAll"
          >
            <Background id="grid-minor" variant="lines" :gap="10" :line-width="1" color="var(--grid-line)" />
            <Background id="grid-major" variant="lines" :gap="100" :line-width="1" color="var(--grid-line-major)" />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              :node-color="miniColor"
              mask-color="rgba(18, 18, 20, 0.75)"
            />

            <template #node-map-project="{ data }">
              <div
                class="mp-node mp-root"
                :class="{ picked: selected?.kind === 'project' }"
                :title="data.whenAbs || data.dir"
                @click.stop="pickProject(data)"
                @contextmenu.prevent.stop="onProjectCtx($event, data)"
              >
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span class="mp-glyph">⟨/⟩</span>
                  <span class="mp-name" :title="data.dir">{{ data.label }}</span>
                </div>
                <div class="mp-sub mono">{{ data.meta }}</div>
              </div>
            </template>

            <template #node-map-hub="{ id, data }">
              <div
                class="mp-node mp-hub"
                :class="{ picked: selected?.id === id, open: isOpen(data.hub) }"
                @click.stop="pickHub(data)"
                @contextmenu.prevent.stop="onHubCtx($event, data)"
              >
                <Handle type="target" :position="Position.Left" class="mp-handle" />
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span class="mp-glyph" :style="{ color: data.tone }">{{ data.glyph }}</span>
                  <span class="mp-name">{{ data.label }}</span>
                  <span class="mp-badge mono">{{ data.count }}</span>
                </div>
              </div>
            </template>

            <template #node-map-session="{ id, data }">
              <div
                class="mp-node"
                :class="{
                  picked: selected?.id === id,
                  sub: data.sub,
                  dimmed: isLeafDimmed(id),
                  hit: isLeafHit(id),
                }"
                :title="data.whenAbs || data.title"
                @click.stop="pickSession(id, data)"
                @dblclick.stop="openBlueprint(data.provider, data.sessionId)"
                @contextmenu.prevent.stop="onSessionCtx($event, id, data)"
              >
                <Handle type="target" :position="Position.Left" class="mp-handle" />
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span class="mp-glyph" :style="{ color: providerColor(data.provider) }">❯</span>
                  <span class="mp-name" :title="data.title">{{ data.title }}</span>
                  <span v-if="data.status && data.status !== 'idle' && data.status !== 'unknown'" class="mp-live mono">{{ data.status }}</span>
                </div>
                <div class="mp-sub mono">{{ data.meta }}</div>
              </div>
            </template>

            <template #node-map-context="{ id, data }">
              <div
                class="mp-node"
                :class="{
                  picked: selected?.id === id,
                  dimmed: isLeafDimmed(id),
                  hit: isLeafHit(id),
                }"
                :title="data.whenAbs || data.preview"
                @click.stop="pickContext(id, data)"
                @dblclick.stop="
                  void fileViewers.openPayload({
                    hash: data.hash,
                    name: data.preview || data.kind,
                  })
                "
                @contextmenu.prevent.stop="onContextCtx($event, id, data)"
              >
                <Handle type="target" :position="Position.Left" class="mp-handle" />
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span class="mp-glyph" style="color: var(--context)">❝</span>
                  <span class="mp-name" :title="data.preview">{{ data.preview || shortId(data.hash) }}</span>
                </div>
                <div class="mp-sub mono">{{ data.meta }}</div>
              </div>
            </template>

            <template #node-map-workflow="{ id, data }">
              <div
                class="mp-node"
                :class="{
                  picked: selected?.id === id,
                  dimmed: isLeafDimmed(id),
                  hit: isLeafHit(id),
                }"
                :title="data.whenAbs || data.name"
                @click.stop="pickWorkflow(id, data)"
                @dblclick.stop="openGraph(data.graphId)"
                @contextmenu.prevent.stop="onWorkflowCtx($event, id, data)"
              >
                <Handle type="target" :position="Position.Left" class="mp-handle" />
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span class="mp-glyph">⌗</span>
                  <span class="mp-name" :title="data.name">{{ data.name }}</span>
                </div>
                <div class="mp-sub mono">{{ data.meta }}</div>
              </div>
            </template>

            <template #node-map-agent="{ id, data }">
              <div
                class="mp-node"
                :class="{
                  picked: selected?.id === id,
                  dimmed: isLeafDimmed(id),
                  hit: isLeafHit(id),
                }"
                :title="data.sub2 || data.name"
                @click.stop="pickAgent(id, data)"
                @dblclick.stop="goAgent(data.provider, data.name)"
                @contextmenu.prevent.stop="onAgentCtx($event, id, data)"
              >
                <Handle type="target" :position="Position.Left" class="mp-handle" />
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span class="mp-glyph" :style="{ color: providerColor(data.provider) }">⟨/⟩</span>
                  <span class="mp-name" :title="data.name">{{ data.name }}</span>
                </div>
                <div class="mp-sub mono">{{ data.meta }}</div>
              </div>
            </template>

            <template #node-map-artifact="{ id, data }">
              <div
                class="mp-node"
                :class="{
                  picked: selected?.id === id,
                  dimmed: isLeafDimmed(id),
                  hit: isLeafHit(id),
                }"
                :title="data.whenAbs || data.path"
                @click.stop="pickArtifact(id, data)"
                @dblclick.stop="goArtifact(data.kind, data.path)"
                @contextmenu.prevent.stop="onArtifactCtx($event, id, data)"
              >
                <Handle type="target" :position="Position.Left" class="mp-handle" />
                <Handle type="source" :position="Position.Right" class="mp-handle" />
                <div class="mp-head">
                  <span
                    class="mp-glyph"
                    :style="{ color: data.kind === 'skill' ? 'var(--accent)' : 'var(--text-dim)' }"
                  >{{ data.kind === "skill" ? "✦" : "§" }}</span>
                  <span class="mp-name" :title="data.path">{{ data.name }}</span>
                </div>
                <div class="mp-sub mono">{{ data.meta }}</div>
              </div>
            </template>
          </VueFlow>
          <GraphLoadingOverlay
            :loading="loading"
            :error="error"
            label="Loading map"
          />
          <div v-if="!loading && !error && query.trim() && searchHits && !searchHits.size" class="map-nores mono">
            no matches for "{{ query.trim() }}"
          </div>
        </div>

        <aside v-if="selected" class="map-detail">
          <div class="map-detail-head">
            <div class="map-detail-titles">
              <span class="map-detail-title" :title="selected.title">{{ selected.title }}</span>
              <span class="micro-label">{{ selected.kindLabel }}</span>
            </div>
            <DetailExpandControls @expand="mapDetailExpanded = true" @close="closeMapDetail" />
          </div>
          <div v-if="selected.blurb" class="map-detail-blurb">{{ selected.blurb }}</div>
          <div class="run-kv mono">
            <template v-for="(row, i) in selected.rows" :key="i">
              <span class="run-key">{{ row.k }}</span>
              <span class="run-val" :class="{ dim: row.dim }" :title="row.title ?? row.v">{{ row.v }}</span>
            </template>
          </div>
          <div v-if="selected.actions?.length" class="map-detail-actions">
            <button
              v-for="(a, i) in selected.actions"
              :key="i"
              class="vsc-btn"
              @click="a.run()"
            >
              {{ a.label }}
            </button>
          </div>
        </aside>

        <DetailExpandModal
          :open="!!selected && mapDetailExpanded"
          :label="selected?.title ?? 'Details'"
          @close="mapDetailExpanded = false"
        >
          <template v-if="selected">
            <div class="map-detail-head">
              <div class="map-detail-titles">
                <span class="map-detail-title" :title="selected.title">{{ selected.title }}</span>
                <span class="micro-label">{{ selected.kindLabel }}</span>
              </div>
              <DetailExpandControls hide-expand @close="mapDetailExpanded = false" />
            </div>
            <div v-if="selected.blurb" class="map-detail-blurb">{{ selected.blurb }}</div>
            <div class="run-kv mono">
              <template v-for="(row, i) in selected.rows" :key="i">
                <span class="run-key">{{ row.k }}</span>
                <span class="run-val" :class="{ dim: row.dim }" :title="row.title ?? row.v">{{ row.v }}</span>
              </template>
            </div>
            <div v-if="selected.actions?.length" class="map-detail-actions">
              <button
                v-for="(a, i) in selected.actions"
                :key="i"
                class="vsc-btn"
                @click="a.run()"
              >
                {{ a.label }}
              </button>
            </div>
          </template>
        </DetailExpandModal>
      </div>
    <StatusBar />
    </div>

    <Teleport to="body">
      <div
        v-if="nodeCtx"
        class="menu-pop map-node-ctx"
        :style="{ left: nodeCtx.x + 'px', top: nodeCtx.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          v-for="(item, i) in nodeCtx.items"
          :key="i"
          type="button"
          class="menu-item"
          :disabled="item.disabled"
          @click="runCtxItem(item)"
        >
          <span class="menu-glyph">{{ item.glyph }}</span> {{ item.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  VueFlow,
  useVueFlow,
  Handle,
  Position,
  MarkerType,
  type Edge,
  type Node,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import {
  atlasAgentNodeId,
  atlasArtifactNodeId,
  atlasContextNodeId,
  atlasDocumentSchema,
  atlasHubNodeId,
  atlasProjectId,
  atlasSessionNodeId,
  atlasWorkflowNodeId,
  isAbsolutePath,
  isSessionLive,
  packLayeredFlow,
  type AtlasDocument,
  type AtlasHubId,
} from "@threadle/shared";
import DashNav from "@/panels/DashNav.vue";
import StatusBar from "@/panels/StatusBar.vue";
import { useNavItems } from "@/panels/useNavItems";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import { providerColor, providerShort, type SessionFilter } from "@/lib/providers";
import { relativeTime, shortId, fmtTokens } from "@/lib/format";
import { useFilterChipMenu } from "@/lib/useFilterChipMenu";
import FilterChipMenu from "@/components/FilterChipMenu.vue";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";
import "@/views/dashboard/chrome.css";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";

const HUBS: Array<{ id: AtlasHubId; label: string; glyph: string; tone: string }> = [
  { id: "sessions", label: "sessions", glyph: "❯", tone: "var(--lane-session)" },
  { id: "contexts", label: "contexts", glyph: "❝", tone: "var(--context)" },
  { id: "workflows", label: "workflows", glyph: "⌗", tone: "var(--text-dim)" },
  { id: "agents", label: "agents", glyph: "⟨/⟩", tone: "var(--wire-agent-def)" },
  { id: "rules", label: "rules", glyph: "§", tone: "var(--text-dim)" },
  { id: "skills", label: "skills", glyph: "✦", tone: "var(--accent)" },
];

interface DetailAction {
  label: string;
  run: () => void;
}
interface DetailRow {
  k: string;
  v: string;
  title?: string;
  dim?: boolean;
}
interface DetailSel {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  blurb?: string;
  rows: DetailRow[];
  actions?: DetailAction[];
}
interface CtxItem {
  glyph: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}

const route = useRoute();
const router = useRouter();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const navItems = useNavItems();
const { fitView } = useVueFlow({ id: "map" });

const nodeCtx = ref<{ x: number; y: number; items: CtxItem[] }>();
let nodeCtxIgnoreClick = false;
/** Project list row currently showing a context menu (dir path). */
const projectRowCtxDir = ref<string>();

const dir = computed(() => {
  const q = route.query.dir;
  return typeof q === "string" && q.trim() ? q.trim() : "";
});

const dirShort = computed(() => {
  if (!dir.value) return "";
  const parts = dir.value.split("/").filter(Boolean);
  if (parts.length <= 3) return dir.value;
  return `…/${parts.slice(-3).join("/")}`;
});

const listProvider = ref<SessionFilter>("all");
const listLiveOnly = ref(false);
const listSort = ref<"updated" | "sessions" | "messages" | "path">("updated");
const listFilter = ref("");
const projectPopOpen = ref(false);
const projectPopFilter = ref("");
const projectPopInput = ref<HTMLInputElement | null>(null);

const providerFilterChips = computed(() => sessions.sessionFilterChips);
watch(providerFilterChips, (chips) => {
  if (!chips.includes(listProvider.value)) listProvider.value = "all";
});

interface ProjectRow {
  dir: string;
  count: number;
  messages: number;
  updatedAt: number;
  live: number;
  providers: Set<string>;
}

const allProjectRows = computed((): ProjectRow[] => {
  const map = new Map<string, ProjectRow>();
  for (const s of sessions.sessions) {
    if (!s.projectDir) continue;
    let cur = map.get(s.projectDir);
    if (!cur) {
      cur = {
        dir: s.projectDir,
        count: 0,
        messages: 0,
        updatedAt: 0,
        live: 0,
        providers: new Set(),
      };
      map.set(s.projectDir, cur);
    }
    cur.count += 1;
    cur.messages += s.messageCount ?? 0;
    cur.providers.add(s.provider);
    if (s.updatedAt > cur.updatedAt) cur.updatedAt = s.updatedAt;
    if (isSessionLive(s.status)) cur.live += 1;
  }
  return [...map.values()];
});

const liveProjectCount = computed(
  () => allProjectRows.value.filter((r) => r.live > 0).length,
);

const projectRows = computed((): ProjectRow[] => {
  const q = listFilter.value.trim().toLowerCase();
  let rows = allProjectRows.value.filter((r) => {
    if (listLiveOnly.value && !r.live) return false;
    if (listProvider.value !== "all" && !r.providers.has(listProvider.value)) return false;
    if (q && !r.dir.toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = listSort.value;
  rows = [...rows].sort((a, b) => {
    if (sort === "sessions") return b.count - a.count || b.updatedAt - a.updatedAt;
    if (sort === "messages") return b.messages - a.messages || b.updatedAt - a.updatedAt;
    if (sort === "path") return a.dir.localeCompare(b.dir);
    return b.updatedAt - a.updatedAt;
  });
  return rows;
});

const projectPopRows = computed((): ProjectRow[] => {
  const q = projectPopFilter.value.trim().toLowerCase();
  let rows = [...allProjectRows.value];
  if (q) rows = rows.filter((r) => r.dir.toLowerCase().includes(q));
  rows.sort((a, b) => b.updatedAt - a.updatedAt || a.dir.localeCompare(b.dir));
  return rows;
});

/** First hydrate only — keep list if pinia already has sessions from another view. */
const listLoading = computed(
  () => sessions.loading && !sessions.sessions.length,
);

const doc = ref<AtlasDocument>();
const loading = ref(false);
const error = ref<string>();
const selected = ref<DetailSel>();
const mapDetailExpanded = ref(false);

function closeMapDetail(): void {
  selected.value = undefined;
  mapDetailExpanded.value = false;
}

watch(
  () => selected.value?.id,
  () => {
    mapDetailExpanded.value = false;
  },
);

/** Which hubs are open — plain object so Vue tracks each key */
const expanded = ref<Partial<Record<AtlasHubId, boolean>>>({});
const query = ref("");

const NODE_W = { project: 220, hub: 200, leaf: 240 };
const NODE_H = { project: 56, hub: 44, leaf: 52 };

function isOpen(hub: AtlasHubId): boolean {
  if (expanded.value[hub]) return true;
  const hits = searchHits.value;
  const d = doc.value;
  if (!hits?.size || !d) return false;
  return leafSpecs(d, hub).some((l) => hits.has(l.id));
}

function hubCount(d: AtlasDocument, hub: AtlasHubId): number {
  return d.layers[hub].length;
}

const {
  menu: hubFilterMenu,
  menuTitle: hubFilterMenuTitle,
  openMenu: openHubFilterMenu,
  applyOnly: applyHubFilterOnly,
  applyExcept: applyHubFilterExcept,
  applyAdd: applyHubFilterAdd,
  applyHide: applyHubFilterHide,
  applyShowAll: applyHubFilterShowAll,
  applyHideAll: applyHubFilterHideAll,
  applyInvert: applyHubFilterInvert,
  applyNonempty: applyHubFilterNonempty,
  hasNonempty: hubFilterHasNonempty,
} = useFilterChipMenu<AtlasHubId>({
  keys: () => HUBS.map((h) => h.id),
  isOn: (k) => !!expanded.value[k],
  setAll: (next) => {
    const out: Partial<Record<AtlasHubId, boolean>> = {};
    for (const h of HUBS) {
      if (next[h.id]) out[h.id] = true;
    }
    expanded.value = out;
    persistExpanded();
    void nextTick(() => nextTick(() => fitAll()));
  },
  count: (k) => (doc.value ? hubCount(doc.value, k) : 0),
  labelFor: (k) => {
    const h = HUBS.find((x) => x.id === k);
    return h ? `${h.glyph} ${h.label}` : k;
  },
});

function fmtChars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Absolute local datetime for tooltips / detail. */
function absWhen(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

function whenPair(ts?: number): { when: string; whenAbs: string } {
  if (!ts) return { when: "", whenAbs: "" };
  return { when: relativeTime(ts), whenAbs: absWhen(ts) };
}

function kindShort(kind: string): string {
  if (kind === "transcript-excerpt") return "excerpt";
  if (kind === "distilled-summary") return "distill";
  if (kind === "files") return "files";
  return kind;
}

function hubActivity(d: AtlasDocument, hub: AtlasHubId): number | undefined {
  if (hub === "sessions") {
    return d.layers.sessions.reduce((m, s) => Math.max(m, s.updatedAt || 0), 0) || undefined;
  }
  if (hub === "contexts") {
    return d.layers.contexts.reduce((m, c) => Math.max(m, c.createdAt || 0), 0) || undefined;
  }
  if (hub === "workflows") {
    return d.layers.workflows.reduce((m, w) => Math.max(m, w.updatedAt || 0), 0) || undefined;
  }
  if (hub === "rules" || hub === "skills") {
    const list = hub === "rules" ? d.layers.rules : d.layers.skills;
    return list.reduce((m, a) => Math.max(m, a.mtime || 0), 0) || undefined;
  }
  return undefined;
}

/** Leaves for a hub, in display order (sessions nest children under parents). */
function leafSpecs(d: AtlasDocument, hub: AtlasHubId): Array<{
  id: string;
  type: string;
  data: Record<string, unknown>;
}> {
  if (hub === "sessions") {
    const tops = d.layers.sessions.filter((s) => !s.parentId);
    const kids = d.layers.sessions.filter((s) => s.parentId);
    const out: Array<{ id: string; type: string; data: Record<string, unknown> }> = [];
    const pushSession = (
      s: (typeof d.layers.sessions)[number],
      sub: boolean,
    ): void => {
      const title = s.title?.trim() || shortId(s.id);
      const tok =
        s.tokensIn != null || s.tokensOut != null
          ? `${fmtTokens(s.tokensIn)}→${fmtTokens(s.tokensOut)} tok`
          : null;
      const bits = sub
        ? [
            providerShort(s.provider),
            "subagent",
            s.messageCount != null ? `${s.messageCount} msg` : null,
            tok,
          ].filter(Boolean)
        : [
            providerShort(s.provider),
            s.agent ?? null,
            s.messageCount != null ? `${s.messageCount} msg` : null,
            tok,
            s.childCount ? `${s.childCount} sub` : null,
            s.contextOutCount || s.contextInCount
              ? `ctx ${s.contextOutCount}→${s.contextInCount}`
              : null,
          ].filter(Boolean);
      const w = whenPair(s.updatedAt);
      out.push({
        id: atlasSessionNodeId(s.provider, s.id),
        type: "map-session",
        data: {
          provider: s.provider,
          sessionId: s.id,
          title,
          meta: bits.join(" · "),
          ...w,
          sub,
          status: s.status,
          agent: s.agent,
          model: s.model,
          messageCount: s.messageCount,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          childCount: s.childCount,
          contextInCount: s.contextInCount,
          contextOutCount: s.contextOutCount,
          updatedAt: s.updatedAt,
        },
      });
    };
    for (const s of tops) {
      pushSession(s, false);
      for (const c of kids.filter((k) => k.parentId === s.id && k.provider === s.provider)) {
        pushSession(c, true);
      }
    }
    for (const c of kids) {
      if (tops.some((t) => t.id === c.parentId && t.provider === c.provider)) continue;
      if (out.some((n) => n.id === atlasSessionNodeId(c.provider, c.id))) continue;
      pushSession(c, true);
    }
    return out;
  }
  if (hub === "contexts") {
    return d.layers.contexts.map((c) => {
      const w = whenPair(c.createdAt);
      return {
        id: atlasContextNodeId(c.hash),
        type: "map-context",
        data: {
          hash: c.hash,
          preview: c.preview,
          kind: c.kind,
          chars: fmtChars(c.chars),
          charsRaw: c.chars,
          createdAt: c.createdAt,
          source: c.source,
          meta: `${kindShort(c.kind)} · ${fmtChars(c.chars)} · ${providerShort(c.source.provider)}`,
          ...w,
        },
      };
    });
  }
  if (hub === "workflows") {
    return d.layers.workflows.map((w) => {
      const when = whenPair(w.updatedAt);
      return {
        id: atlasWorkflowNodeId(w.id),
        type: "map-workflow",
        data: {
          graphId: w.id,
          name: w.name,
          nodeCount: w.nodeCount,
          kind: w.kind,
          sessionKeys: w.sessionKeys,
          updatedAt: w.updatedAt,
          meta: [
            w.kind ?? "workflow",
            `${w.nodeCount} nodes`,
            w.sessionKeys.length ? `${w.sessionKeys.length} sess` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          ...when,
        },
      };
    });
  }
  if (hub === "agents") {
    return d.layers.agents.map((a) => ({
      id: atlasAgentNodeId(a.provider, a.name),
      type: "map-agent",
      data: {
        provider: a.provider,
        name: a.name,
        scope: a.scope,
        kind: a.kind,
        source: a.source,
        description: a.description,
        model: a.model,
        meta: [providerShort(a.provider), a.scope, a.kind, a.model?.split("/").pop()]
          .filter(Boolean)
          .join(" · "),
        sub2: a.description
          ? a.description.length > 48
            ? `${a.description.slice(0, 48)}…`
            : a.description
          : undefined,
      },
    }));
  }
  if (hub === "rules") {
    return d.layers.rules.map((r) => {
      const w = whenPair(r.mtime);
      return {
        id: atlasArtifactNodeId(r.path),
        type: "map-artifact",
        data: {
          path: r.path,
          name: r.name,
          source: r.source,
          kind: r.kind === "skill" ? "skill" : "rules",
          size: r.size,
          mtime: r.mtime,
          description: r.description,
          meta: `${r.source} · ${fmtBytes(r.size)}`,
          ...w,
        },
      };
    });
  }
  return d.layers.skills.map((s) => {
    const w = whenPair(s.mtime);
    return {
      id: atlasArtifactNodeId(s.path),
      type: "map-artifact",
      data: {
        path: s.path,
        name: s.name,
        source: s.source,
        kind: "skill",
        size: s.size,
        mtime: s.mtime,
        description: s.description,
        meta: `${s.source} · ${fmtBytes(s.size)}`,
        ...w,
      },
    };
  });
}

function leafSearchHaystack(data: Record<string, unknown>): string {
  return [
    data.title,
    data.name,
    data.preview,
    data.meta,
    data.sub2,
    data.provider,
    data.sessionId,
    data.hash,
    data.path,
    data.agent,
    data.model,
    data.kind,
    data.source,
    data.description,
    data.status,
    data.graphId,
  ]
    .filter((v) => typeof v === "string" && v)
    .join(" ")
    .toLowerCase();
}

/** Matching leaf ids when query is non-empty; undefined when idle. */
const searchHits = computed((): Set<string> | undefined => {
  const q = query.value.trim().toLowerCase();
  const d = doc.value;
  if (!q || !d) return undefined;
  const hits = new Set<string>();
  for (const h of HUBS) {
    for (const leaf of leafSpecs(d, h.id)) {
      if (leafSearchHaystack(leaf.data).includes(q)) hits.add(leaf.id);
    }
  }
  return hits;
});

function isSearchHit(id: string): boolean {
  return !!searchHits.value?.has(id);
}

/** Selected leaf + cross-edge neighbors — for focus dimming. */
const neighborFocus = computed((): Set<string> | undefined => {
  const sel = selected.value;
  const d = doc.value;
  if (!sel || !d) return undefined;
  if (sel.kind === "hub" || sel.kind === "project") return undefined;
  const id = sel.id;
  if (id.startsWith("band:")) return undefined;
  const ids = new Set<string>([id]);
  for (const e of d.edges) {
    if (!CROSS_KINDS.has(e.kind)) continue;
    if (e.source === id) ids.add(e.target);
    if (e.target === id) ids.add(e.source);
  }
  return ids;
});

function isLeafDimmed(id: string): boolean {
  const hits = searchHits.value;
  if (hits) return !hits.has(id);
  const focus = neighborFocus.value;
  if (focus) return !focus.has(id);
  return false;
}

function isLeafHit(id: string): boolean {
  if (isSearchHit(id)) return true;
  return selected.value?.id === id;
}

function shortProjectPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-3).join("/")}`;
}

function projectBasename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? p) || "/";
}

function projectParentLabel(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 1) return p.startsWith("/") ? "/" : "";
  const parent = (p.startsWith("/") ? "/" : "") + parts.slice(0, -1).join("/");
  if (parent.length <= 42) return parent;
  const segs = parent.split("/").filter(Boolean);
  if (segs.length <= 2) return parent;
  return `…/${segs.slice(-2).join("/")}`;
}

function sortedProviders(row: ProjectRow): string[] {
  return [...row.providers].sort((a, b) => a.localeCompare(b));
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

function goProjectSessions(projectDir: string): void {
  void router.push({
    path: "/",
    query: { view: "sessions", q: projectDir },
  });
}

/** Cross-layer edges that make the map a real graph (not just hub fans). */
const CROSS_KINDS = new Set([
  "session-child",
  "context-from",
  "context-inject",
  "graph-uses-session",
  "session-uses-agent",
]);

function edgeStyle(kind: string): {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
} {
  if (kind === "context-from") {
    return { stroke: "var(--context)", strokeWidth: 1.75, strokeDasharray: "7 4", opacity: 0.72 };
  }
  if (kind === "context-inject") {
    return { stroke: "var(--context)", strokeWidth: 1.75, strokeDasharray: "2 5", opacity: 0.72 };
  }
  if (kind === "session-uses-agent") {
    return { stroke: "var(--wire-agent-def)", strokeWidth: 1.85, opacity: 0.7 };
  }
  if (kind === "graph-uses-session") {
    return { stroke: "var(--edge)", strokeWidth: 1.7, opacity: 0.65 };
  }
  if (kind === "session-child") {
    return { stroke: "var(--lane-session)", strokeWidth: 1.85, opacity: 0.75 };
  }
  if (kind === "hub-child") {
    return { stroke: "var(--border)", strokeWidth: 1, opacity: 0.2 };
  }
  return { stroke: "var(--border-strong)", strokeWidth: 1.4, opacity: 0.45 };
}

/** Layout: hubs left, leaf grids to their right. */
const HUB_X = 260;
const LEAF_X = 520;

const anyOpenHub = computed(() => HUBS.some((h) => isOpen(h.id)));

/** Prefer a short wide grid over a tall single column. */
function hubGridCols(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

/**
 * Pack one hub's leaves: ALAP for intra-hub relations, wrapping grid for the rest.
 */
function packHubCluster(
  leaves: Array<{ id: string; w: number; h: number }>,
  intra: Array<{ source: string; target: string }>,
  originX: number,
  originY: number,
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const positions = new Map<string, { x: number; y: number }>();
  if (!leaves.length) return { positions, width: 0, height: 0 };

  const linked = new Set<string>();
  for (const e of intra) {
    linked.add(e.source);
    linked.add(e.target);
  }
  const connected = leaves.filter((l) => linked.has(l.id));
  const orphans = leaves.filter((l) => !linked.has(l.id));

  let cursorY = originY;
  let maxRight = originX;
  let maxBottom = originY;

  if (connected.length) {
    const packed = packLayeredFlow(connected, intra, {
      gapX: 72,
      gapY: 22,
      originX,
      originY: cursorY,
    });
    const byId = new Map(connected.map((l) => [l.id, l]));
    for (const [id, p] of packed) {
      positions.set(id, p);
      const leaf = byId.get(id)!;
      maxRight = Math.max(maxRight, p.x + leaf.w);
      maxBottom = Math.max(maxBottom, p.y + leaf.h);
    }
    cursorY = maxBottom + 28;
  }

  const cols = hubGridCols(orphans.length);
  const gapX = 24;
  const gapY = 18;
  orphans.forEach((leaf, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = originX + col * (NODE_W.leaf + gapX);
    const y = cursorY + row * (NODE_H.leaf + gapY);
    positions.set(leaf.id, { x, y });
    maxRight = Math.max(maxRight, x + leaf.w);
    maxBottom = Math.max(maxBottom, y + leaf.h);
  });

  return {
    positions,
    width: Math.max(0, maxRight - originX),
    height: Math.max(NODE_H.hub, maxBottom - originY),
  };
}

/**
 * Cluster layout:
 * 1. Each open hub owns a vertical band with a multi-column leaf grid.
 * 2. Intra-hub relations still ALAP within that band.
 * 3. Membership is spatial (band) — no hub→leaf spokes cluttering the canvas.
 */
const flowNodes = computed((): Node[] => {
  const d = doc.value;
  if (!d) return [];
  const projectLabel = d.dir.split("/").filter(Boolean).pop() ?? d.dir;
  const openHubs = HUBS.filter((h) => isOpen(h.id));
  const anyOpen = openHubs.length > 0;

  type Spec = { id: string; type: string; w: number; h: number; data: Record<string, unknown>; hub?: AtlasHubId };
  const projectSpec: Spec = (() => {
    const newest = hubActivity(d, "sessions") ?? hubActivity(d, "contexts");
    const pw = whenPair(newest);
    const live = d.layers.sessions.filter(
      (s) => s.status === "live" || s.status === "running" || s.status === "waiting",
    ).length;
    return {
      id: atlasProjectId(),
      type: "map-project",
      w: NODE_W.project,
      h: NODE_H.project,
      data: {
        dir: d.dir,
        label: projectLabel,
        meta: [
          `${d.layers.sessions.length} sess`,
          live ? `${live} live` : null,
          `${d.layers.contexts.length} ctx`,
          `${d.layers.workflows.length} wf`,
        ]
          .filter(Boolean)
          .join(" · "),
        ...pw,
      },
    };
  })();

  const hubSpecs: Spec[] = HUBS.map((h) => {
    const open = isOpen(h.id);
    return {
      id: atlasHubNodeId(h.id),
      type: "map-hub",
      w: NODE_W.hub,
      h: NODE_H.hub,
      hub: h.id,
      data: {
        hub: h.id,
        label: h.label,
        glyph: h.glyph,
        tone: h.tone,
        count: hubCount(d, h.id),
        open,
      },
    };
  });

  const leafSpecsList: Spec[] = [];
  for (const h of openHubs) {
    for (const leaf of leafSpecs(d, h.id)) {
      leafSpecsList.push({
        id: leaf.id,
        type: leaf.type,
        w: NODE_W.leaf,
        h: NODE_H.leaf,
        hub: h.id,
        data: leaf.data,
      });
    }
  }

  // Closed / skeleton: vertical stack on the left
  if (!anyOpen) {
    const gap = 28;
    let y = 40;
    const nodes: Node[] = [];
    nodes.push({
      id: projectSpec.id,
      type: projectSpec.type,
      position: { x: 40, y: 40 + ((HUBS.length - 1) * (NODE_H.hub + gap)) / 2 },
      data: projectSpec.data,
      draggable: false,
    });
    for (const hs of hubSpecs) {
      nodes.push({
        id: hs.id,
        type: hs.type,
        position: { x: 300, y },
        data: hs.data,
        draggable: false,
      });
      y += NODE_H.hub + gap;
    }
    return nodes;
  }

  const leafIds = new Set(leafSpecsList.map((l) => l.id));
  const crossEdges: Array<{ source: string; target: string }> = [];
  for (const e of d.edges) {
    if (!CROSS_KINDS.has(e.kind)) continue;
    if (!leafIds.has(e.source) || !leafIds.has(e.target)) continue;
    crossEdges.push({ source: e.source, target: e.target });
  }

  const leafPositions = new Map<string, { x: number; y: number }>();
  const hubY = new Map<AtlasHubId, number>();
  const BAND_GAP = 80;
  let bandY = 40;

  for (const h of openHubs) {
    const leaves = leafSpecsList.filter((l) => l.hub === h.id);
    hubY.set(h.id, bandY);
    if (!leaves.length) {
      bandY += NODE_H.hub + BAND_GAP;
      continue;
    }
    const ids = new Set(leaves.map((l) => l.id));
    const intra = crossEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const packed = packHubCluster(
      leaves.map((s) => ({ id: s.id, w: s.w, h: s.h })),
      intra,
      LEAF_X,
      bandY,
    );
    for (const [id, p] of packed.positions) leafPositions.set(id, p);
    bandY = bandY + packed.height + BAND_GAP;
  }

  let closedY = bandY + 8;
  for (const h of HUBS) {
    if (isOpen(h.id)) continue;
    hubY.set(h.id, closedY);
    closedY += NODE_H.hub + 20;
  }

  const openHubYs = openHubs.map((h) => hubY.get(h.id)!);
  const projectY = openHubYs.length
    ? openHubYs.reduce((a, b) => a + b, 0) / openHubYs.length
    : 80;

  const nodes: Node[] = [
    {
      id: projectSpec.id,
      type: projectSpec.type,
      position: { x: 36, y: projectY },
      data: projectSpec.data,
      draggable: false,
      zIndex: 5,
    },
  ];
  for (const hs of hubSpecs) {
    nodes.push({
      id: hs.id,
      type: hs.type,
      position: { x: HUB_X, y: hubY.get(hs.hub!) ?? 48 },
      data: hs.data,
      draggable: false,
      zIndex: 5,
    });
  }
  for (const leaf of leafSpecsList) {
    const p = leafPositions.get(leaf.id) ?? { x: LEAF_X, y: 48 };
    nodes.push({
      id: leaf.id,
      type: leaf.type,
      position: { x: p.x, y: p.y },
      data: leaf.data,
      draggable: false,
      zIndex: 5,
    });
  }
  return nodes;
});

const flowEdges = computed((): Edge[] => {
  const d = doc.value;
  if (!d) return [];
  const visible = new Set(flowNodes.value.map((n) => n.id));
  const anyOpen = anyOpenHub.value;
  const edges: Edge[] = [];

  for (const e of d.edges) {
    if (!visible.has(e.source) || !visible.has(e.target)) continue;
    if (!anyOpen) {
      if (e.kind !== "project-has") continue;
    } else {
      if (!CROSS_KINDS.has(e.kind)) continue;
    }

    const style = edgeStyle(e.kind);
    const hits = searchHits.value;
    const focus = neighborFocus.value;
    const selId = selected.value?.id;
    const edgeDim =
      (!!hits && !hits.has(e.source) && !hits.has(e.target)) ||
      (!!focus && !focus.has(e.source) && !focus.has(e.target));
    const edgeHi =
      !!selId &&
      !!focus &&
      (e.source === selId || e.target === selId);
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      // Bezier arcs clear leaf columns better than orthogonal corridors
      type: "default",
      animated: false,
      zIndex: 0,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: edgeHi ? 13 : 11,
        height: edgeHi ? 13 : 11,
      },
      class: edgeHi ? "map-e-hi" : edgeDim ? "map-e-dim" : "map-e",
      style: {
        stroke: style.stroke,
        strokeWidth: edgeHi ? style.strokeWidth + 0.6 : style.strokeWidth,
        strokeDasharray: style.strokeDasharray,
        opacity: edgeDim ? 0.2 : edgeHi ? 1 : style.opacity,
      },
    });
  }
  return edges;
});

function toggleHub(hub: AtlasHubId): void {
  expanded.value = { ...expanded.value, [hub]: !expanded.value[hub] };
  persistExpanded();
  void nextTick(() => nextTick(() => fitAll()));
}

function expandStateForDoc(d: AtlasDocument): Partial<Record<AtlasHubId, boolean>> {
  const out: Partial<Record<AtlasHubId, boolean>> = {};
  for (const h of HUBS) {
    if (hubCount(d, h.id) > 0) out[h.id] = true;
  }
  return out;
}

/** First-visit default: sessions + contexts when present (quiet otherwise). */
function defaultExpandState(d: AtlasDocument): Partial<Record<AtlasHubId, boolean>> {
  const out: Partial<Record<AtlasHubId, boolean>> = {};
  if (hubCount(d, "sessions") > 0) out.sessions = true;
  if (hubCount(d, "contexts") > 0) out.contexts = true;
  return out;
}

function expandedStorageKey(projectDir: string): string {
  return `threadle:map:expanded:${projectDir}`;
}

function readPersistedExpanded(projectDir: string): Partial<Record<AtlasHubId, boolean>> | null {
  try {
    const raw = sessionStorage.getItem(expandedStorageKey(projectDir));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<AtlasHubId, boolean>>;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistExpanded(): void {
  if (!dir.value) return;
  try {
    sessionStorage.setItem(expandedStorageKey(dir.value), JSON.stringify(expanded.value));
  } catch {
    // quota / private mode — ignore
  }
}

function anyHubOpen(): boolean {
  return HUBS.some((h) => !!expanded.value[h.id]);
}

function expandAll(): void {
  if (!doc.value) return;
  expanded.value = expandStateForDoc(doc.value);
  persistExpanded();
  void nextTick(() => nextTick(() => fitAll()));
}

function collapseAll(): void {
  expanded.value = {};
  persistExpanded();
  void nextTick(() => nextTick(() => fitAll()));
}

function pickHub(data: {
  hub: AtlasHubId;
  label: string;
  count: number;
}): void {
  const open = isOpen(data.hub);
  selected.value = {
    id: atlasHubNodeId(data.hub),
    kind: "hub",
    kindLabel: "layer",
    title: data.label,
    blurb: open
      ? `${data.count} item${data.count === 1 ? "" : "s"} visible — use the layer chips to collapse.`
      : `${data.count} item${data.count === 1 ? "" : "s"} — expand from the layer chips above.`,
    rows: [
      { k: "layer", v: data.hub },
      { k: "items", v: String(data.count) },
      { k: "state", v: open ? "open" : "closed" },
    ],
    actions: [
      {
        label: open ? "▾ collapse layer" : "▸ expand layer",
        run: () => toggleHub(data.hub),
      },
    ],
  };
}

function fitAll(): void {
  void fitView({ padding: 0.18, duration: 200 });
}

function fitNode(id: string): void {
  void fitView({ nodes: [id], padding: 0.4, duration: 220 });
}

function onPaneClick(): void {
  closeMapDetail();
  nodeCtx.value = undefined;
  projectRowCtxDir.value = undefined;
}

function openNodeCtx(e: MouseEvent, items: CtxItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  projectRowCtxDir.value = undefined;
  const pad = 8;
  const menuW = 220;
  const menuH = Math.min(360, 12 + items.length * 34);
  let x = e.clientX;
  let y = e.clientY;
  x = Math.max(pad, Math.min(x, window.innerWidth - menuW - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - menuH - pad));
  nodeCtxIgnoreClick = true;
  nodeCtx.value = { x, y, items };
  window.setTimeout(() => {
    nodeCtxIgnoreClick = false;
  }, 400);
}

function openProjectRowCtx(e: MouseEvent, row: ProjectRow): void {
  openNodeCtx(e, [
    {
      glyph: "◈",
      label: "Open project map",
      run: () => selectDir(row.dir),
    },
    {
      glyph: "⟨/⟩",
      label: `Open in ${settings.editorLabel}`,
      run: () => settings.openPath(row.dir),
    },
    {
      glyph: "❯",
      label: "Sessions in this project",
      run: () => goProjectSessions(row.dir),
    },
  ]);
  projectRowCtxDir.value = row.dir;
}

function onProjectRowMouseDown(e: MouseEvent, row: ProjectRow): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openProjectRowCtx(e, row);
}

function runCtxItem(item: CtxItem): void {
  nodeCtx.value = undefined;
  projectRowCtxDir.value = undefined;
  if (!item.disabled) item.run();
}

function onlyHub(hub: AtlasHubId): void {
  const next: Partial<Record<AtlasHubId, boolean>> = {};
  for (const h of HUBS) next[h.id] = h.id === hub;
  expanded.value = next;
  persistExpanded();
  void nextTick(() => nextTick(() => fitAll()));
}

function onProjectCtx(
  e: MouseEvent,
  data: { dir: string; label: string; meta: string; when: string; whenAbs: string },
): void {
  openNodeCtx(e, [
    {
      glyph: "❯",
      label: "Sessions",
      run: () => void router.push({ path: "/", query: { view: "sessions" } }),
    },
    {
      glyph: "⟨/⟩",
      label: `Open in ${settings.editorLabel}`,
      run: () => settings.openPath(data.dir),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(atlasProjectId()),
    },
  ]);
}

function onHubCtx(
  e: MouseEvent,
  data: { hub: AtlasHubId; label: string; count: number },
): void {
  const open = isOpen(data.hub);
  openNodeCtx(e, [
    {
      glyph: open ? "▾" : "▸",
      label: open ? "Collapse layer" : "Expand layer",
      run: () => toggleHub(data.hub),
    },
    {
      glyph: "◎",
      label: "Only this layer",
      run: () => onlyHub(data.hub),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(atlasHubNodeId(data.hub)),
    },
  ]);
}

function onSessionCtx(
  e: MouseEvent,
  id: string,
  data: {
    provider: string;
    sessionId: string;
    title: string;
    status: string;
    agent?: string;
    model?: string;
    messageCount?: number;
    tokensIn?: number;
    tokensOut?: number;
    childCount: number;
    contextInCount: number;
    contextOutCount: number;
    updatedAt: number;
    sub: boolean;
  },
): void {
  openNodeCtx(e, [
    {
      glyph: "❯",
      label: "Open",
      run: () => goSession(data.provider, data.sessionId),
    },
    {
      glyph: "≡",
      label: "Open transcript",
      run: () => fileViewers.openTranscript(data.provider, data.sessionId),
    },
    {
      glyph: "❝",
      label: "Open context",
      run: () => void fileViewers.openContext(data.provider, data.sessionId),
    },
    {
      glyph: "⌗",
      label: "Blueprint",
      run: () => openBlueprint(data.provider, data.sessionId),
    },
    {
      glyph: "⇄",
      label: "Lineage",
      run: () =>
        void router.push({
          path: "/lineage",
          query: { focus: `${data.provider}:${data.sessionId}` },
        }),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(id),
    },
  ]);
}

function onContextCtx(
  e: MouseEvent,
  id: string,
  data: {
    hash: string;
    preview: string;
    kind: string;
    chars: string;
    charsRaw: number;
    createdAt: number;
    source: { provider: string; sessionId: string };
  },
): void {
  openNodeCtx(e, [
    {
      glyph: "≡",
      label: "Open",
      run: () =>
        void fileViewers.openPayload({
          hash: data.hash,
          name: data.preview || data.kind,
        }),
    },
    {
      glyph: "⇄",
      label: "Lineage",
      run: () => openLineage(data.hash),
    },
    {
      glyph: "⌗",
      label: "Source blueprint",
      run: () => openBlueprint(data.source.provider, data.source.sessionId),
    },
    {
      glyph: "❝",
      label: "Library",
      run: () => void router.push({ path: "/", query: { view: "library" } }),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(id),
    },
  ]);
}

function onWorkflowCtx(
  e: MouseEvent,
  id: string,
  data: {
    graphId: string;
    name: string;
    nodeCount: number;
    kind?: string;
    sessionKeys: string[];
    updatedAt: number;
  },
): void {
  openNodeCtx(e, [
    {
      glyph: "⌗",
      label: "Open canvas",
      run: () => openGraph(data.graphId),
    },
    {
      glyph: "☰",
      label: "Workflows",
      run: () => void router.push({ path: "/", query: { view: "workflows" } }),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(id),
    },
  ]);
}

function onAgentCtx(
  e: MouseEvent,
  id: string,
  data: {
    provider: string;
    name: string;
    scope: string;
    kind?: string;
    source: string;
    description?: string;
    model?: string;
  },
): void {
  const items: CtxItem[] = [
    {
      glyph: "⟨/⟩",
      label: "Open",
      run: () => goAgent(data.provider, data.name),
    },
  ];
  if (isAbsolutePath(data.source) && isLikelyTextPath(data.source)) {
    items.push({
      glyph: "≡",
      label: "View source",
      run: () => void fileViewers.open(data.source),
    });
  }
  if (isAbsolutePath(data.source)) {
    items.push({
      glyph: "⟨/⟩",
      label: `Open in ${settings.editorLabel}`,
      run: () => settings.openPath(data.source),
    });
  }
  items.push({
    glyph: "⊡",
    label: "Fit to node",
    run: () => fitNode(id),
  });
  openNodeCtx(e, items);
}

function onArtifactCtx(
  e: MouseEvent,
  id: string,
  data: {
    path: string;
    name: string;
    source: string;
    kind: string;
    size: number;
    mtime: number;
    description?: string;
  },
): void {
  const items: CtxItem[] = [
    {
      glyph: data.kind === "skill" ? "✦" : "§",
      label: "Open",
      run: () => goArtifact(data.kind, data.path),
    },
  ];
  if (isLikelyTextPath(data.path)) {
    items.push({
      glyph: "≡",
      label: "View source",
      run: () => void fileViewers.open(data.path),
    });
  }
  items.push(
    {
      glyph: "⟨/⟩",
      label: `Open in ${settings.editorLabel}`,
      run: () => settings.openPath(data.path),
    },
    {
      glyph: "⊡",
      label: "Fit to node",
      run: () => fitNode(id),
    },
  );
  openNodeCtx(e, items);
}

function onDocPointer(e: PointerEvent): void {
  if (nodeCtxIgnoreClick || !nodeCtx.value) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(".map-node-ctx")) return;
  nodeCtx.value = undefined;
  projectRowCtxDir.value = undefined;
}

function miniColor(n: { type?: string }): string {
  if (n.type === "map-project") return "#1a1a1d";
  if (n.type === "map-hub") return "#2d2e34";
  if (n.type === "map-session") return "#5f9fe8";
  if (n.type === "map-context") return "#cfa93c";
  if (n.type === "map-workflow") return "#55565c";
  if (n.type === "map-agent") return "#818cf8";
  return "#8f9095";
}

function pickProject(data: {
  dir: string;
  label: string;
  meta?: string;
  when?: string;
  whenAbs?: string;
}): void {
  const d = doc.value;
  selected.value = {
    id: "project",
    kind: "project",
    kindLabel: "project",
    title: data.label,
    blurb: data.dir,
    rows: [
      { k: "path", v: data.dir },
      ...(d
        ? [
            { k: "sessions", v: String(d.layers.sessions.length) },
            { k: "contexts", v: String(d.layers.contexts.length) },
            { k: "workflows", v: String(d.layers.workflows.length) },
            { k: "agents", v: String(d.layers.agents.length) },
            { k: "rules", v: String(d.layers.rules.length) },
            { k: "skills", v: String(d.layers.skills.length) },
          ]
        : []),
      ...(data.when
        ? [
            { k: "activity", v: data.when, title: data.whenAbs },
            ...(data.whenAbs ? [{ k: "at", v: data.whenAbs, dim: true }] : []),
          ]
        : []),
    ],
    actions: [
      {
        label: "❯ sessions",
        run: () => void router.push({ path: "/", query: { view: "sessions" } }),
      },
    ],
  };
}

function pickSession(
  id: string,
  data: {
    provider: string;
    sessionId: string;
    title: string;
    status: string;
    agent?: string;
    model?: string;
    messageCount?: number;
    tokensIn?: number;
    tokensOut?: number;
    childCount: number;
    contextInCount: number;
    contextOutCount: number;
    updatedAt: number;
    sub: boolean;
  },
): void {
  selected.value = {
    id,
    kind: "session",
    kindLabel: data.sub ? "subagent" : "session",
    title: data.title,
    rows: [
      { k: "id", v: shortId(data.sessionId), title: data.sessionId },
      { k: "provider", v: providerShort(data.provider) },
      { k: "status", v: data.status },
      ...(data.agent ? [{ k: "agent", v: data.agent }] : []),
      ...(data.model ? [{ k: "model", v: data.model.split("/").pop() ?? data.model, title: data.model }] : []),
      ...(data.messageCount != null ? [{ k: "messages", v: String(data.messageCount) }] : []),
      ...(data.tokensIn != null || data.tokensOut != null
        ? [
            {
              k: "tokens",
              v: `${fmtTokens(data.tokensIn)} in · ${fmtTokens(data.tokensOut)} out`,
            },
          ]
        : []),
      { k: "subagents", v: String(data.childCount) },
      { k: "contexts", v: `${data.contextOutCount} out · ${data.contextInCount} in` },
      { k: "updated", v: relativeTime(data.updatedAt), title: absWhen(data.updatedAt) },
      { k: "at", v: absWhen(data.updatedAt), dim: true },
    ],
    actions: [
      {
        label: "❯ open",
        run: () => goSession(data.provider, data.sessionId),
      },
      {
        label: "≡ transcript",
        run: () => fileViewers.openTranscript(data.provider, data.sessionId),
      },
      {
        label: "❝ context",
        run: () => void fileViewers.openContext(data.provider, data.sessionId),
      },
      {
        label: "⌗ blueprint",
        run: () => openBlueprint(data.provider, data.sessionId),
      },
    ],
  };
}

function pickContext(
  id: string,
  data: {
    hash: string;
    preview: string;
    kind: string;
    chars: string;
    charsRaw: number;
    createdAt: number;
    source: { provider: string; sessionId: string };
  },
): void {
  selected.value = {
    id,
    kind: "context",
    kindLabel: kindShort(data.kind),
    title: data.preview || shortId(data.hash),
    blurb: data.preview || undefined,
    rows: [
      { k: "hash", v: `${data.hash.slice(0, 16)}…`, title: data.hash },
      { k: "kind", v: data.kind },
      { k: "size", v: `${fmtChars(data.charsRaw)} chars` },
      {
        k: "from",
        v: `${providerShort(data.source.provider)} · ${shortId(data.source.sessionId)}`,
        title: `${data.source.provider}:${data.source.sessionId}`,
      },
      { k: "created", v: relativeTime(data.createdAt), title: absWhen(data.createdAt) },
      { k: "at", v: absWhen(data.createdAt), dim: true },
    ],
    actions: [
      {
        label: "⧉ open",
        run: () =>
          void fileViewers.openPayload({
            hash: data.hash,
            name: data.preview || data.kind,
          }),
      },
      { label: "⇄ lineage", run: () => openLineage(data.hash) },
      {
        label: "⌗ source blueprint",
        run: () => openBlueprint(data.source.provider, data.source.sessionId),
      },
    ],
  };
}

function pickWorkflow(
  id: string,
  data: {
    graphId: string;
    name: string;
    nodeCount: number;
    kind?: string;
    sessionKeys: string[];
    updatedAt: number;
  },
): void {
  selected.value = {
    id,
    kind: "workflow",
    kindLabel: data.kind ?? "workflow",
    title: data.name,
    rows: [
      { k: "id", v: data.graphId },
      { k: "nodes", v: String(data.nodeCount) },
      { k: "sessions", v: String(data.sessionKeys.length) },
      ...(data.sessionKeys.length
        ? [
            {
              k: "refs",
              v: data.sessionKeys
                .slice(0, 3)
                .map((k) => {
                  const i = k.indexOf(":");
                  return i < 0 ? k : shortId(k.slice(i + 1));
                })
                .join(", ") + (data.sessionKeys.length > 3 ? "…" : ""),
              title: data.sessionKeys.join("\n"),
            },
          ]
        : []),
      { k: "updated", v: relativeTime(data.updatedAt), title: absWhen(data.updatedAt) },
      { k: "at", v: absWhen(data.updatedAt), dim: true },
    ],
    actions: [{ label: "⌗ open workflow", run: () => openGraph(data.graphId) }],
  };
}

function pickAgent(
  id: string,
  data: {
    provider: string;
    name: string;
    scope: string;
    kind?: string;
    source: string;
    description?: string;
    model?: string;
  },
): void {
  selected.value = {
    id,
    kind: "agent",
    kindLabel: "agent",
    title: data.name,
    blurb: data.description,
    rows: [
      { k: "provider", v: providerShort(data.provider) },
      { k: "scope", v: data.scope },
      ...(data.kind ? [{ k: "kind", v: data.kind }] : []),
      ...(data.model ? [{ k: "model", v: data.model }] : []),
      { k: "source", v: data.source },
    ],
    actions: [
      {
        label: "⟨/⟩ open",
        run: () => goAgent(data.provider, data.name),
      },
      ...(isAbsolutePath(data.source) && isLikelyTextPath(data.source)
        ? [
            {
              label: "≡ view source",
              run: () => void fileViewers.open(data.source),
            },
          ]
        : []),
    ],
  };
}

function pickArtifact(
  id: string,
  data: {
    path: string;
    name: string;
    source: string;
    kind: string;
    size: number;
    mtime: number;
    description?: string;
  },
): void {
  selected.value = {
    id,
    kind: data.kind,
    kindLabel: data.kind,
    title: data.name,
    blurb: data.description,
    rows: [
      { k: "source", v: data.source },
      { k: "path", v: data.path },
      { k: "size", v: fmtBytes(data.size) },
      { k: "mtime", v: relativeTime(data.mtime), title: absWhen(data.mtime) },
      { k: "at", v: absWhen(data.mtime), dim: true },
    ],
    actions: [
      {
        label: data.kind === "skill" ? "✦ open" : "§ open",
        run: () => goArtifact(data.kind, data.path),
      },
      ...(isLikelyTextPath(data.path)
        ? [
            {
              label: "≡ view source",
              run: () => void fileViewers.open(data.path),
            },
          ]
        : []),
    ],
  };
}

async function load(): Promise<void> {
  if (!dir.value) {
    doc.value = undefined;
    return;
  }
  const projectDir = dir.value;
  loading.value = true;
  error.value = undefined;
  doc.value = undefined;
  closeMapDetail();
  try {
    const res = await fetch(`/api/atlas?dir=${encodeURIComponent(projectDir)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const raw: unknown = await res.json();
    const parsed = atlasDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new Error("invalid map response");
    doc.value = parsed.data;
    // Keep open layers across refresh. First visit: restore session or open all.
    if (!anyHubOpen()) {
      expanded.value =
        readPersistedExpanded(projectDir) ?? defaultExpandState(parsed.data);
    }
    persistExpanded();
    void nextTick(() => nextTick(() => fitAll()));
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    doc.value = undefined;
  } finally {
    loading.value = false;
  }
}

watch(dir, (next, prev) => {
  if (next !== prev) {
    // New project — clear so load() can restore that dir's open set / expand-all
    expanded.value = {};
    closeMapDetail();
    query.value = "";
    if (projectPopOpen.value) closeProjectPop();
  }
  void load();
}, { immediate: true });

function selectDir(d: string): void {
  void router.replace({ path: "/map", query: { dir: d } });
}

function closeProjectPop(): void {
  projectPopOpen.value = false;
  projectPopFilter.value = "";
}

function toggleProjectPop(): void {
  if (projectPopOpen.value) {
    closeProjectPop();
    return;
  }
  projectPopOpen.value = true;
  projectPopFilter.value = "";
  void nextTick(() => projectPopInput.value?.focus());
}

function pickProjectFromPop(d: string): void {
  closeProjectPop();
  if (d !== dir.value) selectDir(d);
}

function onProjectPopDocClick(ev: MouseEvent): void {
  if (!projectPopOpen.value) return;
  const t = ev.target;
  if (!(t instanceof Element)) return;
  if (t.closest(".map-project-switch")) return;
  closeProjectPop();
}

onMounted(() => {
  document.addEventListener("mousedown", onProjectPopDocClick);
  document.addEventListener("pointerdown", onDocPointer, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onProjectPopDocClick);
  document.removeEventListener("pointerdown", onDocPointer, true);
});

function clearDir(): void {
  closeProjectPop();
  void router.replace({ path: "/map" });
}

function onNav(id: string): void {
  if (id === "map") return;
  if (id === "lineage") return void router.push("/lineage");
  if (id === "timeline") return void router.push("/timeline");
  void router.push({ path: "/", query: { view: id } });
}

function openBlueprint(provider: string, sessionId: string): void {
  void router.push(`/blueprint/${provider}/${sessionId}?from=map`);
}

function openLineage(hash: string): void {
  void router.push({ path: "/lineage", query: { focus: `payload:${hash}` } });
}

function openGraph(id: string): void {
  void router.push(`/graph/${id}`);
}

/** Open Sessions with this session already selected (not the bare list). */
function goSession(provider: string, sessionId: string): void {
  void router.push({
    path: "/",
    query: { view: "sessions", provider, session: sessionId },
  });
}

function goAgent(provider: string, name: string): void {
  void router.push({
    path: "/",
    query: { view: "agents", provider, agent: name },
  });
}

function goArtifact(kind: string, focusPath?: string): void {
  const view = kind === "skill" ? "skills" : "rules";
  if (!focusPath) {
    void router.push({ path: "/", query: { view } });
    return;
  }
  void router.push({
    path: "/",
    query:
      kind === "skill"
        ? { view, skill: focusPath }
        : { view, path: focusPath },
  });
}

sessions.ensureHydrated();
</script>

<style scoped>
.map-page {
  display: flex;
  height: 100vh;
  background: var(--canvas-bg);
  color: var(--text);
}
.map-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.map-chrome {
  flex-shrink: 0;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.map-chrome .dash-head {
  margin-bottom: 14px;
}
.map-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.map-back {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  width: 30px;
  height: 30px;
  cursor: pointer;
  font-size: var(--fs-lg);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  padding: 0;
}
.map-back:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
.map-project-switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.map-project-dd {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: min(280px, 32vw);
  height: 30px;
  padding: 4px 10px;
  font-size: var(--fs-sm);
  cursor: pointer;
  text-align: left;
}
.map-project-dd:hover {
  border-color: var(--border-strong);
}
.map-project-dd[aria-expanded="true"] {
  border-color: var(--border-strong);
}
.map-project-dd-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.map-project-dd-caret {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  line-height: 1;
}
.map-project-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: auto;
  z-index: 40;
  width: min(420px, 70vw);
  min-width: 100%;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.map-project-pop-search {
  width: 100%;
  height: 30px;
  padding: 4px 10px;
  font-size: var(--fs-sm);
}
.map-project-pop-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.map-project-pop-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  margin: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.map-project-pop-item:hover {
  background: var(--hover-overlay);
}
.map-project-pop-item.active {
  background: var(--panel-bg-raised);
}
.map-project-pop-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}
.map-project-pop-meta {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.map-project-pop-empty {
  padding: 10px 8px;
  color: var(--text-faint);
  font-size: var(--fs-xs);
}
.map-node-ctx {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 90;
}
.map-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.map-list-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}

/* project picker — scannable rows: name + parent, metrics, hover actions */
.map-picker {
  position: relative;
  padding: 20px 36px 48px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  flex: 1;
  background: var(--panel-bg);
}
.map-pick-list {
  width: 100%;
  max-width: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.map-pick-cols,
.map-pick-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5rem 5.75rem 5rem 7.25rem 0.75rem;
  align-items: center;
  column-gap: 14px;
  padding: 0 14px;
  box-sizing: border-box;
}
.map-pick-cols {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 34px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  border-top-left-radius: calc(var(--radius) - 1px);
  border-top-right-radius: calc(var(--radius) - 1px);
}
.map-pick-cols .th {
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  color: var(--text-faint);
}
.map-pick-cols .th:hover {
  color: var(--text);
}
.map-pick-cols .th.num {
  text-align: right;
}
.map-pick-cols .th.sorted {
  color: var(--text-dim);
}
.map-pick-cols .th.actions {
  cursor: default;
}
.map-pick-cols .sort-mark {
  color: var(--text-faint);
  font-weight: 400;
}
.map-pick-block {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-bottom: 1px solid var(--border);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
}
.map-pick-block:last-of-type {
  border-bottom: none;
}
.map-pick-block:last-of-type .map-pick-row {
  border-bottom-left-radius: calc(var(--radius) - 1px);
  border-bottom-right-radius: calc(var(--radius) - 1px);
}
.map-pick-row {
  min-height: 52px;
  padding-top: 8px;
  padding-bottom: 8px;
  cursor: pointer;
}
.map-pick-block:hover .map-pick-row,
.map-pick-row:hover,
.map-pick-row.ctx {
  background: var(--hover-overlay);
}
.map-pick-proj {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.map-pick-idents {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.map-pick-basename {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  font-weight: 500;
  line-height: 1.2;
  color: var(--text);
}
.map-pick-parent {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  line-height: 1.2;
}
.map-pick-provs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.map-pick-meta {
  color: var(--text-dim);
  font-size: var(--fs-xs);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
}
.map-pick-time {
  color: var(--text-faint);
}
.map-pick-row .row-actions {
  width: 92px;
  justify-self: end;
}
.map-pick-row:hover .row-icon:not(:disabled) {
  color: var(--text-dim);
}
.map-pick-row .status-dot {
  justify-self: end;
}

.map-dim {
  padding: 28px 36px;
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.map-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.map-canvas {
  flex: 1;
  min-width: 0;
  position: relative;
}
.map-nores {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-faint);
  font-size: var(--fs-xs);
  pointer-events: none;
}
.map-detail {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--panel-bg);
  padding: 14px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.map-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.map-detail-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.map-detail-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.map-detail-blurb {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  line-height: 1.45;
  word-break: break-word;
}
.ap-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-md);
  flex-shrink: 0;
}
.ap-close:hover {
  color: var(--text);
}
.run-kv {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px 14px;
  font-size: var(--fs-xs);
}
.run-key {
  color: var(--text-faint);
}
.run-val {
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-val.dim {
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.map-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* blueprint-style nodes: glyph + name, no color tiles */
.mp-node {
  min-width: 180px;
  max-width: 240px;
  background: var(--node-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: none;
  padding: 7px 10px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, opacity 0.12s;
}
.mp-node:hover {
  background: var(--node-bg-hover);
}
.mp-node.dimmed {
  /* keep fill opaque so wires behind don't read as "through" the card */
  opacity: 1;
}
.mp-node.dimmed .mp-head,
.mp-node.dimmed .mp-sub,
.mp-node.dimmed .mp-glyph,
.mp-node.dimmed .mp-badge,
.mp-node.dimmed .mp-live {
  opacity: 0.32;
}
.mp-node.dimmed {
  border-color: color-mix(in srgb, var(--border) 55%, transparent);
  background: var(--node-bg);
}
.mp-node.dimmed:hover .mp-head,
.mp-node.dimmed:hover .mp-sub,
.mp-node.dimmed:hover .mp-glyph,
.mp-node.dimmed:hover .mp-badge,
.mp-node.dimmed:hover .mp-live {
  opacity: 0.7;
}
.mp-node.hit {
  border-color: var(--border-strong);
  background: var(--panel-bg-raised);
}
.mp-node.picked,
.mp-hub.open {
  background: var(--panel-bg-raised);
  border-color: var(--border-strong);
  box-shadow: none;
}
.mp-root {
  min-width: 220px;
  border-color: var(--border-strong);
}
.mp-node.sub {
  opacity: 0.92;
}
.mp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mp-glyph {
  font-family: var(--mono);
  color: var(--text-dim);
  flex-shrink: 0;
  font-size: var(--fs-md);
}
.mp-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-badge {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.mp-live {
  flex-shrink: 0;
  color: var(--status-live);
  font-size: var(--fs-2xs);
  text-transform: lowercase;
}
.mp-sub {
  margin-top: 2px;
  padding-left: 22px;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-handle {
  width: 6px !important;
  height: 6px !important;
  background: var(--border-strong) !important;
  border: none !important;
}
</style>

<style>
/* Map edges — keep strokes readable on the grid (Vue Flow path specificity) */
.vue-flow__edge.map-e path.vue-flow__edge-path {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.vue-flow__edge.map-e-hi path.vue-flow__edge-path {
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 0.5px color-mix(in srgb, currentColor 40%, transparent));
}
.vue-flow__edge.map-e-dim path.vue-flow__edge-path {
  opacity: 0.22;
}
.vue-flow__edge.map-e-hi .vue-flow__edge-interaction {
  stroke-width: 20;
}
</style>
