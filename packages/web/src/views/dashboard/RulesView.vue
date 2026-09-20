<template>
  <div class="rules-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Rules</h1>
      </div>
      <div class="view-controls dash-head-actions">
        <button class="threadle-btn" @click="triggerRulesImport">
          <span class="btn-glyph">↑</span> Import
        </button>
        <input
          ref="rulesImportInput"
          type="file"
          accept=".md,.cursorrules,text/markdown,text/plain"
          hidden
          @change="onRulesImportFile"
        />
        <button class="threadle-btn primary" @click="createMode = 'rules'">
          <span class="btn-glyph">+</span> New rules
        </button>
      </div>
    </header>
    <div class="dash-toolbar rules-toolbar">
      <input
        v-model="rulesFilter"
        class="threadle-input dash-search"
        placeholder="Filter rules…"
        spellcheck="false"
      />
      <div class="chip-row">
        <button
          class="filter-chip"
          :class="{ active: ruleKindFilter === 'all' }"
          @click="ruleKindFilter = 'all'"
        >
          all{{ rulesStats.total ? ` · ${rulesStats.total}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: ruleKindFilter === 'rules' }"
          @click="ruleKindFilter = 'rules'"
        >
          rules{{ rulesStats.rules ? ` · ${rulesStats.rules}` : "" }}
        </button>
        <button
          class="filter-chip"
          :class="{ active: ruleKindFilter === 'agent' }"
          @click="ruleKindFilter = 'agent'"
        >
          agent defs{{ rulesStats.agents ? ` · ${rulesStats.agents}` : "" }}
        </button>
      </div>
    </div>
  </div>

  <div class="sess-layout dash-load-host">
    <GraphLoadingOverlay
      :loading="ruleGroups === undefined"
      label="Loading rules"
    />
    <div class="sess-list">
      <p v-if="ruleGroups !== undefined && !rulesGroupsFiltered.length" class="stat-note">
        {{
          rulesFilter.trim() || ruleKindFilter !== "all"
            ? "no rules match these filters"
            : "none found — add a CLAUDE.md / AGENTS.md / .cursorrules to a project, or agent definitions under .claude/agents/."
        }}
      </p>
      <template v-if="ruleGroups !== undefined">
      <div v-for="rg in rulesGroupsFiltered" :key="rg.scope" class="rule-group">
        <div class="micro-label sess-group-name" :title="rg.scope">
          {{ rg.scope === "global" ? "global (~)" : shortProjectLabel(rg.scope) }}
        </div>
        <div class="agent-grid">
          <div
            v-for="a in rg.artifacts"
            :key="a.path"
            class="agent-card skill-card"
            :class="{
              picked: pickedArtifact?.path === a.path,
              ctx: rulesCtx?.artifact.path === a.path,
            }"
            @click="pickArtifact(a)"
            @contextmenu.prevent.stop="openRulesCtx($event, a)"
          >
            <div class="agent-card-head">
              <span class="agent-glyph">{{ a.kind === "agent" ? "⟨/⟩" : "§" }}</span>
              <span class="agent-name mono">{{ a.name }}</span>
              <span class="op-badge" :class="'rule-' + a.kind">{{ a.kind }}</span>
            </div>
            <p class="agent-desc">{{ a.source }}</p>
            <span class="micro-label">{{ fmtBytes(a.size) }} · {{ relativeTime(a.mtime) }}</span>
          </div>
        </div>
      </div>
      </template>
    </div>
    <ArtifactPreview
      v-if="pickedArtifact"
      :artifact="pickedArtifact"
      @close="pickedArtifact = undefined"
      @updated="onArtifactUpdated"
    />
  </div>

  <Teleport to="body">
    <div
      v-if="rulesCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: rulesCtx.x + 'px', top: rulesCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        class="menu-item"
        @click="menuAction(() => pickArtifact(rulesCtx!.artifact))"
      >
        <span class="menu-glyph">↗</span> Open
      </button>
      <button
        class="menu-item"
        @click="menuAction(() => toggleRulesFavorite(rulesCtx!.artifact))"
      >
        <span class="menu-glyph">{{
          isRulesFavorite(rulesCtx!.artifact) ? "☆" : "★"
        }}</span>
        {{
          isRulesFavorite(rulesCtx!.artifact)
            ? "Remove from favorites"
            : "Add to favorites"
        }}
      </button>
    </div>
  </Teleport>

  <RuleCreateModal
    v-if="createMode"
    :mode="createMode"
    :project-dirs="knownProjectDirs"
    @close="createMode = undefined"
    @created="onArtifactCreated"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { isAbsolutePath, validateRulesImport } from "@threadle/shared";
import { relativeTime } from "@/lib/format";
import { useSessionsStore } from "@/stores/sessions";
import { useFavoritesStore } from "@/stores/favorites";
import ArtifactPreview from "@/panels/ArtifactPreview.vue";
import RuleCreateModal from "@/panels/RuleCreateModal.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import type { RuleArtifact, RuleGroup } from "./MetaView.vue";
import "./chrome.css";

const props = defineProps<{
  ruleGroups: RuleGroup[] | undefined;
  /** Deep-link: rules name or absolute path (`?name=` / `?path=`). */
  focus?: string;
}>();

const emit = defineEmits<{
  reload: [];
}>();

const sessions = useSessionsStore();
const favorites = useFavoritesStore();
void favorites.ensureLoaded();

function rulesFavoriteInput(a: RuleArtifact) {
  return {
    kind: "rules" as const,
    path: a.path,
    label: a.name,
  };
}
function isRulesFavorite(a: RuleArtifact): boolean {
  return favorites.isFavorite(rulesFavoriteInput(a));
}
function toggleRulesFavorite(a: RuleArtifact): void {
  void favorites.toggle(rulesFavoriteInput(a));
}

const rulesCtx = ref<{ artifact: RuleArtifact; x: number; y: number }>();
let rulesCtxIgnoreClick = false;

function openRulesCtx(e: MouseEvent, a: RuleArtifact): void {
  rulesCtx.value = { artifact: a, x: e.clientX, y: e.clientY };
  rulesCtxIgnoreClick = true;
  void Promise.resolve().then(() => {
    rulesCtxIgnoreClick = false;
  });
}
function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    rulesCtx.value = undefined;
  }
}
function onRulesDocClick(): void {
  if (rulesCtxIgnoreClick) return;
  rulesCtx.value = undefined;
}
onMounted(() => document.addEventListener("click", onRulesDocClick));
onUnmounted(() => document.removeEventListener("click", onRulesDocClick));

const ruleKindFilter = ref<"all" | "rules" | "agent">("all");
const rulesFilter = ref("");
const createMode = ref<"rules" | "skill">();
const rulesImportInput = ref<HTMLInputElement>();
const pickedArtifact = ref<RuleArtifact>();

const knownProjectDirs = computed(() =>
  [...new Set(sessions.sessions.map((s) => s.projectDir).filter((d) => isAbsolutePath(d)))].sort(),
);

const rulesStats = computed(() => {
  const arts = (props.ruleGroups ?? []).flatMap((g) =>
    g.artifacts.filter((a) => a.kind !== "skill"),
  );
  const scopes = new Set((props.ruleGroups ?? []).map((g) => g.scope));
  return {
    total: arts.length,
    rules: arts.filter((a) => a.kind === "rules").length,
    agents: arts.filter((a) => a.kind === "agent").length,
    scopes: scopes.size,
    projects: [...scopes].filter((s) => s !== "global").length,
  };
});

function matchesRulesQuery(a: RuleArtifact, scope: string): boolean {
  const q = rulesFilter.value.trim().toLowerCase();
  if (!q) return true;
  return [a.name, a.path, a.source, a.kind, a.description, scope]
    .filter(Boolean)
    .some((s) => String(s).toLowerCase().includes(q));
}

const rulesGroupsFiltered = computed(() =>
  (props.ruleGroups ?? [])
    .map((g) => ({
      scope: g.scope,
      artifacts: g.artifacts.filter(
        (a) =>
          a.kind !== "skill" &&
          (ruleKindFilter.value === "all" || a.kind === ruleKindFilter.value) &&
          matchesRulesQuery(a, g.scope),
      ),
    }))
    .filter((g) => g.artifacts.length),
);

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function shortProjectLabel(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : dir;
}

function triggerRulesImport(): void {
  rulesImportInput.value?.click();
}

async function onRulesImportFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const content = await file.text();
  const checked = validateRulesImport({ content, filename: file.name });
  if (!checked.ok) {
    alert(`Import failed: ${checked.error}`);
    return;
  }
  const projectScope =
    props.ruleGroups?.find((g) => g.scope !== "global")?.scope ?? knownProjectDirs.value[0];
  if (!projectScope) {
    alert("Import rules into a project — open a project with sessions first, or use + New rules.");
    return;
  }
  try {
    const res = await fetch("/api/rules/rules/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: projectScope,
        type: checked.data.type,
        content: checked.data.content,
        filename: file.name,
      }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${res.status}`);
    emit("reload");
  } catch (err) {
    alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function pickArtifact(a: RuleArtifact): void {
  pickedArtifact.value = pickedArtifact.value?.path === a.path ? undefined : a;
}

watch(
  () => [props.focus, props.ruleGroups] as const,
  ([focus]) => {
    if (!focus || !props.ruleGroups) return;
    const arts = props.ruleGroups.flatMap((g) =>
      g.artifacts.filter((a) => a.kind !== "skill"),
    );
    const hit =
      arts.find((a) => a.path === focus) ?? arts.find((a) => a.name === focus);
    if (hit) {
      if (hit.kind === "agent") ruleKindFilter.value = "agent";
      else if (hit.kind === "rules") ruleKindFilter.value = "rules";
      pickedArtifact.value = hit;
    }
  },
  { immediate: true },
);

function onArtifactCreated(artifact: {
  path: string;
  name: string;
  kind: string;
  source: string;
  size: number;
  mtime: number;
  description?: string;
  autoInvoke?: boolean;
}): void {
  createMode.value = undefined;
  emit("reload");
  pickedArtifact.value = {
    ...artifact,
    kind: artifact.kind as RuleArtifact["kind"],
  };
}

function onArtifactUpdated(artifact: {
  path: string;
  name: string;
  kind: string;
  source: string;
  size: number;
  mtime?: number;
  description?: string;
  autoInvoke?: boolean;
  origin?: RuleArtifact["origin"];
  layer?: number;
  shadowedBy?: string;
}): void {
  if (!props.ruleGroups) return;
  for (const g of props.ruleGroups) {
    const i = g.artifacts.findIndex((a) => a.path === artifact.path);
    if (i >= 0) {
      const prev = g.artifacts[i]!;
      g.artifacts[i] = {
        ...prev,
        ...artifact,
        kind: (artifact.kind as RuleArtifact["kind"]) || prev.kind,
        mtime: artifact.mtime ?? prev.mtime,
        origin: artifact.origin ?? prev.origin,
        layer: artifact.layer ?? prev.layer,
        shadowedBy: artifact.shadowedBy ?? prev.shadowedBy,
      };
    }
  }
  if (pickedArtifact.value?.path === artifact.path) {
    pickedArtifact.value = {
      ...pickedArtifact.value,
      ...artifact,
      kind: (artifact.kind as RuleArtifact["kind"]) || pickedArtifact.value.kind,
      mtime: artifact.mtime ?? pickedArtifact.value.mtime,
      origin: artifact.origin ?? pickedArtifact.value.origin,
      layer: artifact.layer ?? pickedArtifact.value.layer,
      shadowedBy: artifact.shadowedBy ?? pickedArtifact.value.shadowedBy,
    };
  }
}
</script>

<style scoped>
.rules-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.rules-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.rule-group {
  margin-bottom: 22px;
}
.rule-group > .sess-group-name {
  display: block;
  padding-bottom: 12px;
  line-height: 1.3;
}
.skill-card {
  cursor: pointer;
}
.skill-card.picked {
  background: var(--panel-bg-raised);
  border-color: var(--border-strong);
}
</style>
