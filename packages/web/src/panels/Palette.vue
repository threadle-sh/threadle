<template>
  <aside class="palette" :style="{ width: palWidth + 'px' }">
    <div
      class="resize-grip grip-right"
      title="Drag to resize · double-click to reset"
      @mousedown="startPalDrag"
      @dblclick="resetPalWidth"
    />
    <div class="palette-search">
      <input
        v-model="search"
        class="threadle-input"
        placeholder="Search catalog…"
        @focus="ensureCatalogLoaded"
      />
    </div>
    <div class="palette-body">
      <PaletteRail
        :active-tab="palTab"
        :is-searching="isSearching"
        @select="setTab"
      />
      <div class="pal-pane">
        <div class="pal-pane-head">
          <div class="micro-label pal-pane-title">{{ paneTitle }}</div>
          <div v-if="palTab === 'graphs' && !isSearching" class="pal-pane-actions">
            <button
              type="button"
              class="pal-pane-act"
              title="New workflow"
              @click="createPalWorkflowAtRoot"
            >+</button>
            <button
              type="button"
              class="pal-pane-act"
              title="New folder"
              @click="openPalFolderDialog('create', null)"
            ><FolderMark class="pal-folder-act" /></button>
          </div>
        </div>

        <div class="palette-scroll">
          <PaletteSearchResults
            v-if="isSearching"
            :workflows="filteredWorkflowEmbeds"
            :subgraphs="filteredSubgraphs"
            :agents="flatFilteredAgents"
            :sessions="filteredSessions"
            :blocks="filteredBlocks"
            :custom="filteredCustom"
            :context-kinds="filteredContextKinds"
            :skills="paletteSkills"
            :rules="paletteRules"
            :library="filteredLibrary"
            :hit-count="catalogHitCount"
            :loading="catalogLoading"
            @open-graph="openGraphTab"
            @drag-end="clearDragSuppress"
            @graph-drag-start="onGraphDragStart"
          />

          <template v-else>
            <PaletteAgentsPane
              v-if="palTab === 'agents'"
              :groups="agentProviderGroups"
              :empty="!filteredAgents.length"
            />
            <PaletteSessionsPane
              v-if="palTab === 'sessions'"
              :groups="sessionGroupRows"
              :empty="!filteredSessions.length"
              :expanded-session="expandedSession"
              :session-key="sessionKey"
              :subagent-state="subagentState"
              :subagents-of="subagentsOf"
              @toggle-subagents="toggleSubagents"
            />
            <PaletteNodesPane
              v-if="palTab === 'nodes'"
              :blocks="paletteBlocks"
              :custom="customNodes.defs"
              :context-kinds="contextKinds"
            />
            <PaletteSkillsPane
              v-if="palTab === 'skills'"
              :skills="paletteSkills"
              :ready="rulesReady"
            />
            <PaletteRulesPane
              v-if="palTab === 'rules'"
              :rules="paletteRules"
              :ready="rulesReady"
            />
            <PaletteLibraryPane
              v-if="palTab === 'library'"
              :items="libraryItems.slice(0, 15)"
            />
            <PaletteGraphsPane
              v-if="palTab === 'graphs'"
              :workflow-rows="palWorkflowRows"
              :subgraph-rows="palSubgraphRows"
              :subgraph-empty="!filteredSubgraphs.length"
              :collapsed="palCollapsed"
              :active-folder-id="palFolderCtx?.id"
              :active-graph-id="palGraphCtx?.id"
              @toggle-folder="togglePalFolder"
              @open-graph="openGraphTab"
              @drag-end="clearDragSuppress"
              @graph-drag-start="onGraphDragStart"
              @folder-contextmenu="openPalFolderCtx"
              @folder-mousedown="onPalFolderMouseDown"
              @folder-more="openPalFolderCtxFromEl"
              @graph-contextmenu="openPalGraphCtx"
              @graph-mousedown="onPalGraphMouseDown"
              @graph-more="openPalGraphCtxFromEl"
            />
          </template>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="palFolderCtx"
        class="menu-pop pal-folder-ctx"
        :style="{
          position: 'fixed',
          left: palFolderCtx.x + 'px',
          top: palFolderCtx.y + 'px',
          zIndex: 200,
        }"
        @click.stop
        @mousedown.stop
        @contextmenu.prevent
      >
        <button class="menu-item" @click="palFolderAction(() => createPalWorkflowInFolder(palFolderCtx!.id))">
          <span class="menu-glyph">+</span> New workflow
        </button>
        <button class="menu-item" @click="palFolderAction(() => openPalFolderDialog('create', palFolderCtx!.id))">
          <span class="menu-glyph"><FolderMark /></span> New subfolder
        </button>
        <button
          class="menu-item"
          @click="palFolderAction(() => openPalFolderDialog('rename', palFolderCtx!.id, palFolderCtx!.name))"
        >
          <span class="menu-glyph">✎</span> Rename
        </button>
        <button class="menu-item menu-danger" @click="palFolderAction(() => askPalFolderDelete(palFolderCtx!.id))">
          <span class="menu-glyph">⌫</span> Delete folder
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="palGraphCtx"
        class="menu-pop pal-folder-ctx pal-graph-ctx"
        :style="{
          position: 'fixed',
          left: palGraphCtx.x + 'px',
          top: palGraphCtx.y + 'px',
          zIndex: 200,
        }"
        @click.stop
        @mousedown.stop
        @contextmenu.prevent
      >
        <button class="menu-item" @click="palGraphAction(() => void openFromPalGraphCtx())">
          <span class="menu-glyph">↗</span> Open
        </button>
        <button class="menu-item" @click="palGraphAction(() => void runFromPalGraphCtx())">
          <span class="menu-glyph">▶</span> Run
        </button>
        <button
          class="menu-item"
          :disabled="!graphStore.graph || graphStore.graph.id === palGraphCtx.id"
          :title="
            !graphStore.graph
              ? 'Open a workflow first'
              : graphStore.graph.id === palGraphCtx.id
                ? 'Already the active canvas'
                : 'Embed as a linked frame on the current canvas'
          "
          @click="palGraphAction(() => emitEmbedFromPalGraphCtx())"
        >
          <span class="menu-glyph">⊞</span> Add to current canvas
        </button>
        <button class="menu-item" @click="palGraphAction(() => renamePalGraph(palGraphCtx!.id, palGraphCtx!.name))">
          <span class="menu-glyph">✎</span> Rename
        </button>
        <button class="menu-item" @click="palGraphAction(() => duplicatePalGraph(palGraphCtx!.id))">
          <span class="menu-glyph">⊕</span> Duplicate
        </button>
        <button
          v-if="palGraphCtx.kind !== 'subgraph'"
          class="menu-item"
          @click="palGraphAction(() => setPalGraphKind(palGraphCtx!.id, 'subgraph'))"
        >
          <span class="menu-glyph">⌗</span> Mark as subgraph
        </button>
        <button
          v-else
          class="menu-item"
          @click="palGraphAction(() => setPalGraphKind(palGraphCtx!.id, 'workflow'))"
        >
          <span class="menu-glyph">#</span> Mark as workflow
        </button>
        <button
          v-if="graphFolders.placements[palGraphCtx.id]"
          class="menu-item"
          @click="palGraphAction(() => placePalGraphRoot(palGraphCtx!.id))"
        >
          <span class="menu-glyph">↑</span> Move to root
        </button>
        <button
          class="menu-item menu-danger"
          @click="palGraphAction(() => deletePalGraph(palGraphCtx!.id, palGraphCtx!.name))"
        >
          <span class="menu-glyph">⌫</span> Delete
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="palGraphDialog"
        class="wf-name-backdrop"
        @click.self="closePalGraphDialog"
        @keydown.esc="closePalGraphDialog"
      >
        <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
          <header class="wf-name-head">
            <div class="wf-name-title mono">✎ rename</div>
            <button class="wf-name-close" title="Close" @click="closePalGraphDialog">✕</button>
          </header>
          <div class="wf-name-body">
            <label class="wf-name-field">
              <span class="micro-label">name</span>
              <input
                ref="palGraphInput"
                v-model="palGraphDialog.name"
                class="threadle-input mono"
                spellcheck="false"
                maxlength="120"
                placeholder="workflow name"
                @keydown.enter.prevent="submitPalGraphDialog"
              />
            </label>
            <p v-if="palGraphDialogError" class="wf-name-error">{{ palGraphDialogError }}</p>
          </div>
          <footer class="wf-name-foot">
            <button class="threadle-btn" @click="closePalGraphDialog">Cancel</button>
            <button class="threadle-btn primary" :disabled="palGraphDialogBusy" @click="submitPalGraphDialog">
              {{ palGraphDialogBusy ? "…" : "Rename" }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="palFolderDialog"
        class="wf-name-backdrop"
        @click.self="closePalFolderDialog"
        @keydown.esc="closePalFolderDialog"
      >
        <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
          <header class="wf-name-head">
            <div class="wf-name-title mono">
              <template v-if="palFolderDialog.mode === 'rename'">✎ rename folder</template>
              <template v-else><FolderMark class="dlg-folder-mark" /> new folder</template>
            </div>
            <button class="wf-name-close" title="Close" @click="closePalFolderDialog">✕</button>
          </header>
          <div class="wf-name-body">
            <label class="wf-name-field">
              <span class="micro-label">name</span>
              <input
                ref="palFolderInput"
                v-model="palFolderDialog.name"
                class="threadle-input mono"
                spellcheck="false"
                maxlength="120"
                placeholder="folder name"
                @keydown.enter.prevent="submitPalFolderDialog"
              />
            </label>
            <p v-if="palFolderDialogError" class="wf-name-error">{{ palFolderDialogError }}</p>
          </div>
          <footer class="wf-name-foot">
            <button class="threadle-btn" @click="closePalFolderDialog">Cancel</button>
            <button class="threadle-btn primary" :disabled="palFolderDialogBusy" @click="submitPalFolderDialog">
              {{
                palFolderDialogBusy
                  ? "…"
                  : palFolderDialog.mode === "rename"
                    ? "Rename"
                    : "Create"
              }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="palFolderDelete"
        class="wf-name-backdrop"
        @click.self="closePalFolderDelete"
        @keydown.esc="closePalFolderDelete"
      >
        <div class="wf-name-modal" role="dialog" aria-modal="true" @keydown.stop>
          <header class="wf-name-head">
            <div class="wf-name-title mono">⌫ delete folder</div>
            <button class="wf-name-close" title="Close" @click="closePalFolderDelete">✕</button>
          </header>
          <div class="wf-name-body">
            <p class="wf-name-copy">
              Delete <span class="mono">{{ palFolderDelete.name }}</span>?
              Workflows and subfolders move to the parent (or root). Graphs are not deleted.
            </p>
            <p v-if="palFolderDeleteError" class="wf-name-error">{{ palFolderDeleteError }}</p>
          </div>
          <footer class="wf-name-foot">
            <button class="threadle-btn" :disabled="palFolderDeleteBusy" @click="closePalFolderDelete">Cancel</button>
            <button class="threadle-btn danger" :disabled="palFolderDeleteBusy" @click="confirmPalFolderDelete">
              {{ palFolderDeleteBusy ? "…" : "Delete folder" }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </aside>
  <ConfirmModal
    v-model="confirmDlg"
    @confirm="onConfirmDlgYes"
    @cancel="onConfirmDlgNo"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  AgentDef,
  ContextKind,
  Graph,
  GraphEdge,
  GraphNode,
  SessionRef,
  WorkflowFolder,
  WorkflowFolderIndex,
} from "@threadle/shared";
import { emptyWorkflowFolderIndex, folderIdForPath, folderPathNames, paletteBlockEntries } from "@threadle/shared";
import { writePendingFolders, readPendingFolders } from "@/lib/pendingFolders";
import { useHorizontalResize } from "@/lib/useHorizontalResize";
import { useSessionsStore } from "@/stores/sessions";
import { useGraphStore } from "@/stores/graph";
import { useWorkflowTabsStore } from "@/stores/workflowTabs";
import { useCustomNodes } from "@/stores/custom-nodes";
import { providerLabel } from "@/lib/providers";
import { nextWorkflowName } from "@/lib/workflowName";
import { api } from "@/api/client";
import {
  VALID_TABS,
  activePalTabLabel,
  type PalTab,
} from "@/lib/paletteTabs";
import FolderMark from "@/panels/FolderMark.vue";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";
import {
  PaletteRail,
  PaletteSearchResults,
  PaletteAgentsPane,
  PaletteSessionsPane,
  PaletteNodesPane,
  PaletteSkillsPane,
  PaletteRulesPane,
  PaletteLibraryPane,
  PaletteGraphsPane,
} from "@/panels/palette";

const props = defineProps<{ currentDir?: string }>();
const emit = defineEmits<{
  embedGraph: [id: string, name: string];
}>();

const confirmDlg = ref<ConfirmModel>();
let confirmDlgResolve: ((ok: boolean) => void) | undefined;

function onConfirmDlgYes(): void {
  confirmDlgResolve?.(true);
  confirmDlgResolve = undefined;
}
function onConfirmDlgNo(): void {
  confirmDlgResolve?.(false);
  confirmDlgResolve = undefined;
}
function askConfirm(model: ConfirmModel): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDlgResolve?.(false);
    confirmDlgResolve = resolve;
    confirmDlg.value = model;
  });
}

const { width: palWidth, startDrag: startPalDrag, resetWidth: resetPalWidth } =
  useHorizontalResize("threadle.palette.width", 300, 220, 520, "left");

const sessions = useSessionsStore();
const graphStore = useGraphStore();
const wfTabs = useWorkflowTabsStore();
const customNodes = useCustomNodes();
void customNodes.load();
const router = useRouter();
const search = ref("");
const paletteBlocks = paletteBlockEntries();

const isSearching = computed(() => search.value.trim().length > 0);

const storedTab = localStorage.getItem("threadle.palette.tab");
const palTab = ref<PalTab>(
  storedTab && VALID_TABS.has(storedTab) ? (storedTab as PalTab) : "agents",
);

const activeTabLabel = computed(() => activePalTabLabel(palTab.value));

function setTab(t: PalTab): void {
  search.value = "";
  palTab.value = t;
  localStorage.setItem("threadle.palette.tab", t);
  if (t === "library") loadLibraryOnce();
  if (t === "graphs") {
    graphsLoaded = false;
    loadGraphsOnce();
  }
  if (t === "skills" || t === "rules") loadRulesOnce();
}

interface LibraryItem {
  hash: string;
  kind: ContextKind;
  preview: string;
  tags: string[];
}
const libraryItems = ref<LibraryItem[]>([]);
let libraryLoaded = false;

function loadLibraryOnce(): void {
  if (libraryLoaded) return;
  libraryLoaded = true;
  void fetch("/api/payloads")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      libraryItems.value = rows as LibraryItem[];
    })
    .catch(() => undefined);
}

interface RuleArtifactRow {
  path: string;
  name: string;
  kind: "rules" | "agent" | "skill";
  source: string;
  description?: string;
  origin?: string;
  autoInvoke?: boolean;
  shadowedBy?: string;
}
interface RuleGroupRow {
  scope: string;
  artifacts: RuleArtifactRow[];
}
const ruleGroups = ref<RuleGroupRow[]>([]);
const rulesReady = ref(false);
let rulesLoaded = false;

function loadRulesOnce(): void {
  if (rulesLoaded) return;
  rulesLoaded = true;
  void fetch("/api/rules")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      ruleGroups.value = rows as RuleGroupRow[];
    })
    .catch(() => undefined)
    .finally(() => {
      rulesReady.value = true;
    });
}

const paletteSkills = computed(() => {
  const q = search.value.trim().toLowerCase();
  const out: RuleArtifactRow[] = [];
  for (const g of ruleGroups.value) {
    for (const a of g.artifacts) {
      if (a.kind !== "skill") continue;
      if (a.shadowedBy) continue;
      if (
        q &&
        !a.name.toLowerCase().includes(q) &&
        !a.source.toLowerCase().includes(q) &&
        !(a.description ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push(a);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
});

const paletteRules = computed(() => {
  const q = search.value.trim().toLowerCase();
  const out: RuleArtifactRow[] = [];
  for (const g of ruleGroups.value) {
    for (const a of g.artifacts) {
      if (a.kind !== "rules") continue;
      if (
        q &&
        !a.name.toLowerCase().includes(q) &&
        !a.source.toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push(a);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
});

interface GraphListItem {
  id: string;
  name: string;
  kind?: "workflow" | "subgraph";
  nodeCount: number;
  edgeCount?: number;
  usedBy?: number;
}
const graphItems = ref<GraphListItem[]>([]);
const graphFolders = ref<WorkflowFolderIndex>(emptyWorkflowFolderIndex());
let graphsLoaded = false;

const PAL_COLLAPSE_KEY = "threadle:wf-folders-collapsed";
const palCollapsed = ref<Set<string>>(loadPalCollapsed());

function loadPalCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(PAL_COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    // ignore
  }
  return new Set();
}

function togglePalFolder(id: string): void {
  const next = new Set(palCollapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  palCollapsed.value = next;
  localStorage.setItem(PAL_COLLAPSE_KEY, JSON.stringify([...next]));
}

function clearTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}

const palFolderCtx = ref<{ id: string; name: string; x: number; y: number }>();
const palGraphCtx = ref<{
  id: string;
  name: string;
  kind?: "workflow" | "subgraph";
  nodeCount: number;
  usedBy?: number;
  x: number;
  y: number;
}>();
let palFolderCtxIgnoreUntil = 0;

const palGraphCtxAsItem = computed((): GraphListItem | undefined => {
  const c = palGraphCtx.value;
  if (!c) return undefined;
  return {
    id: c.id,
    name: c.name,
    nodeCount: c.nodeCount,
    edgeCount: 0,
    kind: c.kind,
    usedBy: c.usedBy,
  };
});

function snapshotPalGraph(): GraphListItem | undefined {
  const g = palGraphCtxAsItem.value;
  return g ? { ...g } : undefined;
}

async function openFromPalGraphCtx(): Promise<void> {
  const g = snapshotPalGraph();
  if (g) await openGraphTab(g);
}

async function runFromPalGraphCtx(): Promise<void> {
  const g = snapshotPalGraph();
  if (g) await runPalGraph(g);
}

function emitEmbedFromPalGraphCtx(): void {
  const g = snapshotPalGraph();
  if (g) emit("embedGraph", g.id, g.name);
}

function placePalFolderCtx(clientX: number, clientY: number, folder: WorkflowFolder): void {
  clearTextSelection();
  const pad = 8;
  const w = 220;
  const h = 180;
  const x = Math.min(clientX, window.innerWidth - w - pad);
  const y = Math.min(clientY, window.innerHeight - h - pad);
  palFolderCtxIgnoreUntil = Date.now() + 400;
  palGraphCtx.value = undefined;
  palFolderCtx.value = {
    id: folder.id,
    name: folder.name,
    x: Math.max(pad, x),
    y: Math.max(pad, y),
  };
}

function placePalGraphCtx(clientX: number, clientY: number, g: GraphListItem): void {
  clearTextSelection();
  const pad = 8;
  const w = 240;
  const h = 320;
  const x = Math.min(clientX, window.innerWidth - w - pad);
  const y = Math.min(clientY, window.innerHeight - h - pad);
  palFolderCtxIgnoreUntil = Date.now() + 400;
  palFolderCtx.value = undefined;
  palGraphCtx.value = {
    id: g.id,
    name: g.name,
    kind: g.kind === "subgraph" ? "subgraph" : "workflow",
    nodeCount: g.nodeCount,
    usedBy: g.usedBy,
    x: Math.max(pad, x),
    y: Math.max(pad, y),
  };
}

function openPalFolderCtx(e: MouseEvent, folder: WorkflowFolder): void {
  e.preventDefault();
  e.stopPropagation();
  placePalFolderCtx(e.clientX, e.clientY, folder);
}

function onPalFolderMouseDown(e: MouseEvent, folder: WorkflowFolder): void {
  clearTextSelection();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  placePalFolderCtx(e.clientX, e.clientY, folder);
}

function openPalFolderCtxFromEl(e: MouseEvent, folder: WorkflowFolder): void {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  placePalFolderCtx(r.right - 4, r.bottom + 2, folder);
}

function openPalGraphCtx(e: MouseEvent, g: GraphListItem): void {
  e.preventDefault();
  e.stopPropagation();
  placePalGraphCtx(e.clientX, e.clientY, g);
}

function onPalGraphMouseDown(e: MouseEvent, g: GraphListItem): void {
  clearTextSelection();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  placePalGraphCtx(e.clientX, e.clientY, g);
}

function openPalGraphCtxFromEl(e: MouseEvent, g: GraphListItem): void {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  placePalGraphCtx(r.right - 4, r.bottom + 2, g);
}

function palFolderAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    palFolderCtx.value = undefined;
  }
}

function palGraphAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    palGraphCtx.value = undefined;
  }
}

function onPalDocPointerDown(e: PointerEvent): void {
  if (Date.now() < palFolderCtxIgnoreUntil) return;
  const t = e.target as HTMLElement;
  if (
    t.closest?.(".pal-folder-ctx") ||
    t.closest?.(".pal-graph-ctx") ||
    t.closest?.(".pal-folder-more")
  ) {
    return;
  }
  if (t.closest?.(".pal-folder") && e.button === 2) return;
  if (t.closest?.(".pal-graph") && e.button === 2) return;
  palFolderCtx.value = undefined;
  palGraphCtx.value = undefined;
}

onMounted(() => document.addEventListener("pointerdown", onPalDocPointerDown, true));
onUnmounted(() => document.removeEventListener("pointerdown", onPalDocPointerDown, true));

const palGraphDialog = ref<{ id: string; name: string }>();
const palGraphInput = ref<HTMLInputElement>();
const palGraphDialogBusy = ref(false);
const palGraphDialogError = ref("");

function closePalGraphDialog(): void {
  if (palGraphDialogBusy.value) return;
  palGraphDialog.value = undefined;
  palGraphDialogError.value = "";
}

async function renamePalGraph(id: string, current: string): Promise<void> {
  palGraphDialogError.value = "";
  palGraphDialog.value = { id, name: current };
  await nextTick();
  palGraphInput.value?.focus();
  palGraphInput.value?.select();
}

async function submitPalGraphDialog(): Promise<void> {
  const dlg = palGraphDialog.value;
  if (!dlg || palGraphDialogBusy.value) return;
  const trimmed = dlg.name.trim();
  if (!trimmed) {
    palGraphDialogError.value = "name required";
    return;
  }
  palGraphDialogBusy.value = true;
  palGraphDialogError.value = "";
  try {
    const g = await api.graph(dlg.id);
    g.name = trimmed.slice(0, 120);
    await api.saveGraph(g);
    const row = graphItems.value.find((x) => x.id === dlg.id);
    if (row) row.name = g.name;
    wfTabs.setName(dlg.id, g.name);
    if (graphStore.graph?.id === dlg.id) graphStore.graph.name = g.name;
    palGraphDialog.value = undefined;
    await refreshPalGraphs();
  } catch (err) {
    palGraphDialogError.value = err instanceof Error ? err.message : String(err);
  } finally {
    palGraphDialogBusy.value = false;
  }
}

async function duplicatePalGraph(id: string): Promise<void> {
  try {
    const src = await api.graph(id);
    const kind = src.kind === "subgraph" ? "subgraph" : "workflow";
    const copy = await api.createGraph(`${src.name} copy`.slice(0, 60), { kind });
    copy.kind = kind;
    const idMap = new Map<string, string>();
    const srcNodes = JSON.parse(JSON.stringify(src.nodes)) as GraphNode[];
    for (const n of srcNodes) idMap.set(n.id, crypto.randomUUID().slice(0, 8));
    copy.nodes = srcNodes.map((n) => {
      const nextId = idMap.get(n.id)!;
      const subOf = n.subOf ? idMap.get(n.subOf) : undefined;
      return { ...n, id: nextId, subOf, status: "idle" as const, lastRunId: undefined };
    });
    copy.edges = (JSON.parse(JSON.stringify(src.edges)) as GraphEdge[]).map((e) => ({
      ...e,
      id: crypto.randomUUID().slice(0, 8),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    if (src.params?.length) {
      copy.params = JSON.parse(JSON.stringify(src.params)) as Graph["params"];
    }
    if (src.settings) {
      copy.settings = JSON.parse(JSON.stringify(src.settings)) as Graph["settings"];
    }
    if (src.viewport) copy.viewport = { ...src.viewport };
    await api.saveGraph(copy);
    const folderId = graphFolders.value.placements[id];
    if (folderId) {
      graphFolders.value = await api.placeGraphInFolder(copy.id, folderId);
    }
    await refreshPalGraphs();
    wfTabs.ensureOpen(copy.id, copy.name);
    if (graphStore.graph) await graphStore.flush();
    await router.push(`/graph/${copy.id}`);
  } catch (err) {
    alert(`Duplicate failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function setPalGraphKind(id: string, kind: "workflow" | "subgraph"): Promise<void> {
  try {
    if (graphStore.graph?.id === id) await graphStore.flush();
    const saved = await api.setGraphKind(id, kind);
    if (graphStore.graph?.id === id) graphStore.graph.kind = saved.kind ?? kind;
    await refreshPalGraphs();
  } catch (err) {
    alert(`Could not change kind: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function placePalGraphRoot(graphId: string): Promise<void> {
  try {
    graphFolders.value = await api.placeGraphInFolder(graphId, null);
  } catch (err) {
    alert(`Could not move: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function deletePalGraph(id: string, name: string): Promise<void> {
  const row = graphItems.value.find((g) => g.id === id);
  const label = row?.kind === "subgraph" ? "subgraph" : "workflow";
  const ok = await askConfirm({
    title: `delete ${label}`,
    emphasis: `"${name}"`,
    body: ` ${label} will be deleted.`,
    detail: "Referenced sessions are not touched.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteGraph(id);
    if (wfTabs.openIds.includes(id)) wfTabs.close(id);
    if (graphStore.graph?.id === id) {
      await router.push("/graph");
    }
    await refreshPalGraphs();
  } catch (err) {
    alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runPalGraph(g: GraphListItem): Promise<void> {
  await openGraphTab(g);
  await router.replace({ path: `/graph/${g.id}`, query: { run: "1" } });
}
async function refreshPalGraphs(): Promise<void> {
  try {
    const [rows, folders] = await Promise.all([
      fetch("/api/graphs").then((r) => (r.ok ? r.json() : [])),
      api.graphFolders().catch(() => emptyWorkflowFolderIndex()),
    ]);
    graphItems.value = rows as GraphListItem[];
    graphFolders.value = folders;
  } catch {
    /* ignore */
  }
}

async function createPalWorkflowInFolder(folderId: string): Promise<void> {
  try {
    const next = new Set(palCollapsed.value);
    // Keep the target folder (and ancestors) expanded so the new draft is visible.
    let cur: string | null = folderId;
    const byId = new Map(graphFolders.value.folders.map((f) => [f.id, f]));
    while (cur) {
      next.delete(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    palCollapsed.value = next;
    localStorage.setItem(PAL_COLLAPSE_KEY, JSON.stringify([...next]));
    const name = nextWorkflowName(graphItems.value);
    const path = folderPathNames(graphFolders.value, folderId);
    const g = await api.createGraph(name, { kind: "workflow" });
    writePendingFolders(g.id, path);
    await refreshPalGraphs();
    wfTabs.ensureOpen(g.id, g.name);
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Could not create workflow: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function createPalWorkflowAtRoot(): Promise<void> {
  try {
    loadGraphsOnce();
    const name = nextWorkflowName(graphItems.value);
    const g = await api.createGraph(name, { kind: "workflow" });
    await refreshPalGraphs();
    wfTabs.ensureOpen(g.id, g.name);
    await router.push(`/graph/${g.id}`);
  } catch (err) {
    alert(`Could not create workflow: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type PalFolderDialog =
  | { mode: "create"; parentId: string | null; name: string }
  | { mode: "rename"; folderId: string; name: string };

const palFolderDialog = ref<PalFolderDialog>();
const palFolderInput = ref<HTMLInputElement>();
const palFolderDialogBusy = ref(false);
const palFolderDialogError = ref("");
const palFolderDelete = ref<{ id: string; name: string }>();
const palFolderDeleteBusy = ref(false);
const palFolderDeleteError = ref("");

function closePalFolderDialog(): void {
  if (palFolderDialogBusy.value) return;
  palFolderDialog.value = undefined;
  palFolderDialogError.value = "";
}

async function openPalFolderDialog(
  mode: "create" | "rename",
  id: string | null,
  currentName?: string,
): Promise<void> {
  palFolderDialogError.value = "";
  if (mode === "create") {
    palFolderDialog.value = { mode: "create", parentId: id, name: "" };
    if (id) {
      const next = new Set(palCollapsed.value);
      if (next.delete(id)) {
        palCollapsed.value = next;
        localStorage.setItem(PAL_COLLAPSE_KEY, JSON.stringify([...next]));
      }
    }
  } else {
    if (!id) return;
    palFolderDialog.value = { mode: "rename", folderId: id, name: currentName ?? "folder" };
  }
  await nextTick();
  palFolderInput.value?.focus();
  if (mode === "rename") palFolderInput.value?.select();
}

async function submitPalFolderDialog(): Promise<void> {
  const dlg = palFolderDialog.value;
  if (!dlg || palFolderDialogBusy.value) return;
  const trimmed = dlg.name.trim() || (dlg.mode === "create" ? "Untitled folder" : "");
  if (!trimmed) {
    palFolderDialogError.value = "name required";
    return;
  }
  palFolderDialogBusy.value = true;
  palFolderDialogError.value = "";
  try {
    if (dlg.mode === "create") {
      graphFolders.value = await api.createGraphFolder(trimmed, dlg.parentId);
    } else {
      graphFolders.value = await api.renameGraphFolder(dlg.folderId, trimmed);
    }
    palFolderDialog.value = undefined;
  } catch (err) {
    palFolderDialogError.value = err instanceof Error ? err.message : String(err);
  } finally {
    palFolderDialogBusy.value = false;
  }
}

function askPalFolderDelete(id: string): void {
  const folder = graphFolders.value.folders.find((f) => f.id === id);
  palFolderDeleteError.value = "";
  palFolderDelete.value = { id, name: folder?.name ?? "folder" };
}

function closePalFolderDelete(): void {
  if (palFolderDeleteBusy.value) return;
  palFolderDelete.value = undefined;
  palFolderDeleteError.value = "";
}

async function confirmPalFolderDelete(): Promise<void> {
  const dlg = palFolderDelete.value;
  if (!dlg || palFolderDeleteBusy.value) return;
  palFolderDeleteBusy.value = true;
  palFolderDeleteError.value = "";
  try {
    graphFolders.value = await api.deleteGraphFolder(dlg.id);
    palFolderDelete.value = undefined;
  } catch (err) {
    palFolderDeleteError.value = err instanceof Error ? err.message : String(err);
  } finally {
    palFolderDeleteBusy.value = false;
  }
}

function loadGraphsOnce(): void {
  if (graphsLoaded) return;
  graphsLoaded = true;
  void Promise.all([
    fetch("/api/graphs").then((r) => (r.ok ? r.json() : [])),
    api.graphFolders().catch(() => emptyWorkflowFolderIndex()),
  ])
    .then(([rows, folders]) => {
      graphItems.value = rows as GraphListItem[];
      graphFolders.value = folders;
    })
    .catch(() => undefined);
}

// Restore tab loaders after declarations (avoid TDZ on cold start).
if (palTab.value === "library") loadLibraryOnce();
if (palTab.value === "skills" || palTab.value === "rules") loadRulesOnce();
if (palTab.value === "graphs") loadGraphsOnce();

const route = useRoute();
const filteredSubgraphs = computed(() => {
  const q = search.value.trim().toLowerCase();
  return graphItems.value
    .filter((g) => g.kind === "subgraph")
    .filter((g) => !q || g.name.toLowerCase().includes(q));
});
const filteredWorkflowEmbeds = computed(() => {
  const q = search.value.trim().toLowerCase();
  return graphItems.value
    .filter((g) => g.kind !== "subgraph")
    .filter((g) => !q || g.name.toLowerCase().includes(q));
});

/** Open empty drafts aren't in GET /graphs — keep them visible under their folder. */
function palOpenDrafts(kind: "workflow" | "subgraph"): GraphListItem[] {
  const known = new Set(graphItems.value.map((g) => g.id));
  const out: GraphListItem[] = [];
  const seen = new Set<string>();
  const consider = (id: string, name: string, gKind: "workflow" | "subgraph", nodeCount: number) => {
    if (known.has(id) || seen.has(id)) return;
    if ((gKind === "subgraph") !== (kind === "subgraph")) return;
    const placed = graphFolders.value.placements[id];
    const pending = readPendingFolders(id);
    if (!placed && pending === undefined) return;
    seen.add(id);
    out.push({ id, name, kind: gKind, nodeCount, edgeCount: 0 });
  };
  const g = graphStore.graph;
  if (g) {
    consider(
      g.id,
      g.name,
      g.kind === "subgraph" ? "subgraph" : "workflow",
      g.nodes.length,
    );
  }
  for (const id of wfTabs.openIds) {
    consider(id, wfTabs.label(id) || id, "workflow", 0);
  }
  return out;
}

type PalGraphRow =
  | { kind: "folder"; key: string; folder: WorkflowFolder; depth: number; graphCount: number }
  | { kind: "graph"; key: string; graph: GraphListItem; depth: number };

function palFolderIndexWithPending(): WorkflowFolderIndex {
  const base = graphFolders.value;
  const placements = { ...base.placements };
  const ids = new Set<string>([
    ...Object.keys(placements),
    ...wfTabs.openIds,
    ...(graphStore.graph ? [graphStore.graph.id] : []),
  ]);
  for (const id of ids) {
    const pending = readPendingFolders(id);
    if (pending === undefined) continue;
    if (pending.length === 0) {
      delete placements[id];
      continue;
    }
    const fid = folderIdForPath(base, pending);
    if (fid) placements[id] = fid;
  }
  return { ...base, placements };
}

/** Folders first at every level. Empty folders show for workflows; subgraphs only when they have matches. */
function buildPalGraphRows(
  graphs: GraphListItem[],
  kind: "workflow" | "subgraph",
  opts?: { showEmptyFolders?: boolean },
): PalGraphRow[] {
  const index = palFolderIndexWithPending();
  const showEmpty = opts?.showEmptyFolders ?? kind === "workflow";
  const graphsByFolder = new Map<string | null, GraphListItem[]>();
  graphsByFolder.set(null, []);
  for (const f of index.folders) graphsByFolder.set(f.id, []);
  for (const g of graphs) {
    const fid = index.placements[g.id] ?? null;
    const bucket = graphsByFolder.get(fid) ?? graphsByFolder.get(null)!;
    bucket.push(g);
  }

  const countByFolder = new Map<string | null, number>();
  for (const f of index.folders) countByFolder.set(f.id, 0);
  countByFolder.set(null, 0);
  for (const g of graphs) {
    const fid = index.placements[g.id] ?? null;
    countByFolder.set(fid, (countByFolder.get(fid) ?? 0) + 1);
  }

  const childrenOf = new Map<string | null, WorkflowFolder[]>();
  childrenOf.set(null, []);
  for (const f of index.folders) {
    const parent = f.parentId;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(f);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  function countDeep(folderId: string): number {
    let n = countByFolder.get(folderId) ?? 0;
    for (const child of childrenOf.get(folderId) ?? []) n += countDeep(child.id);
    return n;
  }

  const rows: PalGraphRow[] = [];
  function walk(parentId: string | null, depth: number): void {
    for (const folder of childrenOf.get(parentId) ?? []) {
      const count = countDeep(folder.id);
      if (count === 0 && !showEmpty) continue;
      rows.push({
        kind: "folder",
        key: `folder:${folder.id}`,
        folder,
        depth,
        graphCount: count,
      });
      if (!palCollapsed.value.has(folder.id)) {
        walk(folder.id, depth + 1);
        for (const g of graphsByFolder.get(folder.id) ?? []) {
          rows.push({ kind: "graph", key: `graph:${g.id}`, graph: g, depth: depth + 1 });
        }
      }
    }
    if (parentId === null) {
      for (const g of graphsByFolder.get(null) ?? []) {
        // Flat root list still hides the open tab (embed of self is useless).
        if (g.id === String(route.params.id)) continue;
        rows.push({ kind: "graph", key: `graph:${g.id}`, graph: g, depth: 0 });
      }
    }
  }
  walk(null, 0);
  return rows;
}

const palWorkflowRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  const drafts = palOpenDrafts("workflow").filter(
    (g) => !q || g.name.toLowerCase().includes(q),
  );
  const graphs = [...drafts, ...filteredWorkflowEmbeds.value];
  return buildPalGraphRows(graphs, "workflow", { showEmptyFolders: true });
});
const palSubgraphRows = computed(() => {
  const q = search.value.trim().toLowerCase();
  const drafts = palOpenDrafts("subgraph").filter(
    (g) => !q || g.name.toLowerCase().includes(q),
  );
  const graphs = [...drafts, ...filteredSubgraphs.value];
  return buildPalGraphRows(graphs, "subgraph", { showEmptyFolders: false });
});

/** Ignore the click that follows a completed drag. */
let suppressGraphClick = false;

function clearDragSuppress(): void {
  // dragend fires before click — clear on next tick so the click is skipped
  setTimeout(() => {
    suppressGraphClick = false;
  }, 0);
}

function onGraphDragStart(): void {
  suppressGraphClick = true;
}

async function openGraphTab(g: GraphListItem): Promise<void> {
  if (suppressGraphClick) return;
  if (g.id === String(route.params.id)) return;
  if (graphStore.graph) await graphStore.flush();
  wfTabs.ensureOpen(g.id, g.name);
  await router.push(`/graph/${g.id}`);
}

const contextKinds: Array<{
  kind: ContextKind;
  glyph: string;
  label: string;
  hint: string;
}> = [
  {
    kind: "distilled-summary",
    glyph: "≡",
    label: "Distilled summary",
    hint: "AI-condensed context brief",
  },
  {
    kind: "transcript-excerpt",
    glyph: "❝",
    label: "Transcript excerpt",
    hint: "raw conversation text",
  },
  {
    kind: "files",
    glyph: "▤",
    label: "Files / artifacts",
    hint: "files the session touched",
  },
];

function matches(text: string | undefined): boolean {
  if (!search.value) return true;
  return (text ?? "").toLowerCase().includes(search.value.toLowerCase());
}

const filteredBlocks = computed(() =>
  paletteBlocks.filter(
    (b) => matches(b.label) || matches(b.hint) || matches(b.type),
  ),
);

const filteredCustom = computed(() =>
  customNodes.defs.filter(
    (d) => matches(d.label) || matches(d.name) || matches(d.description),
  ),
);

const filteredContextKinds = computed(() =>
  contextKinds.filter(
    (ck) => matches(ck.label) || matches(ck.hint) || matches(ck.kind),
  ),
);

const filteredLibrary = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return libraryItems.value.slice(0, 15);
  return libraryItems.value.filter(
    (pl) =>
      pl.preview.toLowerCase().includes(q) ||
      pl.kind.toLowerCase().includes(q) ||
      pl.tags.some((t) => t.toLowerCase().includes(q)) ||
      pl.hash.toLowerCase().includes(q),
  );
});

const filteredAgents = computed(() =>
  sessions.agents.filter(
    (a) =>
      matches(a.name) ||
      matches(a.description) ||
      matches(a.provider) ||
      matches(providerLabel(a.provider)) ||
      matches(a.kind) ||
      matches(a.scope),
  ),
);

const filteredSessions = computed(() =>
  sessions.sessions.filter(
    (s) => matches(s.title) || matches(s.projectDir) || matches(s.id),
  ),
);

const flatFilteredAgents = computed(() =>
  [...filteredAgents.value].sort((a, b) => {
    const pa = providerLabel(a.provider).localeCompare(providerLabel(b.provider));
    if (pa !== 0) return pa;
    return a.name.localeCompare(b.name);
  }),
);

const catalogHitCount = computed(
  () =>
    filteredWorkflowEmbeds.value.length +
    filteredSubgraphs.value.length +
    filteredAgents.value.length +
    filteredSessions.value.length +
    filteredBlocks.value.length +
    filteredCustom.value.length +
    filteredContextKinds.value.length +
    paletteSkills.value.length +
    paletteRules.value.length +
    filteredLibrary.value.length,
);

const catalogLoading = computed(() => {
  if (!isSearching.value) return false;
  // loaders set *Loaded before the fetch resolves
  if (rulesLoaded && !rulesReady.value) return true;
  return false;
});

const paneTitle = computed(() => {
  if (!isSearching.value) return activeTabLabel.value;
  const n = catalogHitCount.value;
  if (!n) return catalogLoading.value ? "catalog · loading…" : "catalog · search";
  return `catalog · ${n} match${n === 1 ? "" : "es"}`;
});

function ensureCatalogLoaded(): void {
  loadLibraryOnce();
  loadRulesOnce();
  loadGraphsOnce();
  void customNodes.load();
  if (!sessions.agents.length || !sessions.sessions.length) {
    void sessions.refresh();
  }
}

watch(isSearching, (on) => {
  if (on) ensureCatalogLoaded();
});

/** Agents grouped provider → agent type (kind). */
const agentProviderGroups = computed(() => {
  const providers = new Map<string, Map<string, AgentDef[]>>();
  for (const a of filteredAgents.value) {
    if (!providers.has(a.provider)) providers.set(a.provider, new Map());
    const kinds = providers.get(a.provider)!;
    const kind = a.kind ?? a.scope;
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind)!.push(a);
  }
  return [...providers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, kinds]) => ({
      provider,
      label: providerLabel(provider),
      kinds: [...kinds.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, agents]) => ({
          kind,
          agents: agents.sort((x, y) => x.name.localeCompare(y.name)),
        })),
    }));
});

const sessionGroups = computed(() => {
  const groups = new Map<string, SessionRef[]>();
  for (const s of filteredSessions.value) {
    const key = s.projectDir || "(unknown)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const entries = [...groups.entries()].map(([dir, list]) => ({
    dir,
    sessions: list,
  }));
  // current project first, then by most recent activity
  entries.sort((a, b) => {
    if (a.dir === props.currentDir) return -1;
    if (b.dir === props.currentDir) return 1;
    return (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0);
  });
  return entries;
});

function groupLabel(dir: string): string {
  const name = dir.split("/").filter(Boolean).pop() ?? dir;
  return dir === props.currentDir ? `${name} (current)` : name;
}

const sessionGroupRows = computed(() =>
  sessionGroups.value.map((g) => ({
    dir: g.dir,
    label: groupLabel(g.dir),
    sessions: g.sessions,
  })),
);

// ---- subagent expander ----

const expandedSession = ref<string>();
const subagentCache = reactive(new Map<string, SessionRef[] | "loading" | "none">());

function sessionKey(s: SessionRef): string {
  return `${s.provider}:${s.id}`;
}

function subagentState(s: SessionRef): "unknown" | "loading" | "none" | "loaded" {
  const c = subagentCache.get(sessionKey(s));
  if (c === undefined) return "unknown";
  if (c === "loading") return "loading";
  if (c === "none" || c.length === 0) return "none";
  return "loaded";
}

function subagentsOf(s: SessionRef): SessionRef[] {
  const c = subagentCache.get(sessionKey(s));
  return Array.isArray(c) ? c : [];
}

async function toggleSubagents(s: SessionRef): Promise<void> {
  const k = sessionKey(s);
  if (expandedSession.value === k) {
    expandedSession.value = undefined;
    return;
  }
  expandedSession.value = k;
  if (subagentCache.has(k)) return;
  subagentCache.set(k, "loading");
  try {
    const children = await api.children(s.provider, s.id);
    subagentCache.set(k, children.length ? children : "none");
  } catch {
    subagentCache.set(k, "none");
  }
}
</script>

<style src="./palette/palette-styles.css"></style>
