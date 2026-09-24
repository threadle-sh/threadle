<template>
  <div class="skills-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Skills</h1>
      </div>
      <div class="view-controls dash-head-actions">
        <button class="threadle-btn" @click="triggerSkillImport">
          <span class="btn-glyph">↑</span> Import
        </button>
        <button class="threadle-btn primary" @click="openSkillCreate()">
          <span class="btn-glyph">+</span> New skillset
        </button>
        <input
          ref="skillImportInput"
          type="file"
          accept=".md,text/markdown,text/plain"
          hidden
          @change="onSkillImportFile"
        />
      </div>
    </header>
    <div class="dash-toolbar skills-toolbar">
      <input
        v-model="skillsFilter"
        class="threadle-input dash-search"
        placeholder="Filter skills…"
        spellcheck="false"
      />
      <div class="chip-row">
        <button
          class="filter-chip"
          :class="{ active: showShadowedSkills }"
          :disabled="skillStats.shadowed === 0"
          title="Show skills hidden because a higher-priority copy with the same name exists (usually a project skill)"
          @click="showShadowedSkills = !showShadowedSkills"
        >
          overridden{{ skillStats.shadowed ? ` · ${skillStats.shadowed}` : "" }}
        </button>
        <button
          class="filter-chip"
          :disabled="skillBulkBusy || skillStats.auto === 0"
          :title="skillStats.auto ? `Set all ${skillStats.auto} auto skill(s) to manual` : 'Nothing on auto'"
          @click="toggleAllSkills(false)"
        >
          {{ skillBulkBusy ? "…" : `all → manual${skillStats.auto ? ` · ${skillStats.auto}` : ""}` }}
        </button>
        <button
          class="filter-chip"
          :disabled="skillBulkBusy || skillStats.manual === 0"
          :title="skillStats.manual ? `Set all ${skillStats.manual} manual skill(s) to auto` : 'Nothing on manual'"
          @click="toggleAllSkills(true)"
        >
          {{ skillBulkBusy ? "…" : `all → auto${skillStats.manual ? ` · ${skillStats.manual}` : ""}` }}
        </button>
      </div>
    </div>
  </div>

  <div class="sess-layout dash-load-host">
    <GraphLoadingOverlay
      :loading="ruleGroups === undefined"
      label="Loading skills"
    />
    <div class="sess-list">
      <p v-if="ruleGroups !== undefined && !skillGroups.length" class="stat-note">
        {{
          skillsFilter.trim()
            ? "no skills match these filters"
            : "no skillsets found — create a custom skill, import a SKILL.md, or add <name>/SKILL.md under a project’s .claude/.cursor/.agents/.opencode skills dirs (or ~/.config/threadle/skills/{custom,imported})."
        }}
      </p>
      <template v-if="ruleGroups !== undefined">
      <div v-for="sg in skillGroups" :key="sg.key" class="rule-group">
        <div class="micro-label sess-group-name" :title="sg.hint">
          {{ sg.label }}
        </div>
        <div class="agent-grid">
          <div
            v-for="a in sg.artifacts"
            :key="a.path"
            class="agent-card skill-card"
            :class="{
              picked: pickedArtifact?.path === a.path,
              'skill-manual': a.autoInvoke === false,
              'skill-shadowed': !!a.shadowedBy,
              ctx: skillCtx?.artifact.path === a.path,
            }"
            @click="pickArtifact(a)"
            @contextmenu.prevent.stop="openSkillCtx($event, a)"
          >
            <div class="agent-card-head">
              <span class="agent-glyph">✦</span>
              <span class="agent-name mono">{{ a.name }}</span>
              <span
                v-if="a.shadowedBy"
                class="skill-badge micro-label shadowed"
                title="Overridden — a higher-priority skill with the same name wins"
              >overridden</span>
              <span
                class="skill-badge micro-label"
                :class="a.autoInvoke === false ? 'off' : 'on'"
                @click.stop="toggleSkillAuto(a)"
                :title="a.autoInvoke === false ? 'manual — click for auto' : 'auto — click for manual'"
              >{{ a.autoInvoke === false ? "manual" : "auto" }}</span>
            </div>
            <p class="agent-desc">{{ a.description || a.source }}</p>
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
      v-if="skillCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: skillCtx.x + 'px', top: skillCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        class="menu-item"
        @click="menuAction(() => pickArtifact(skillCtx!.artifact))"
      >
        <span class="menu-glyph">↗</span> Open
      </button>
      <button
        class="menu-item"
        @click="menuAction(() => toggleSkillFavorite(skillCtx!.artifact))"
      >
        <span class="menu-glyph">{{
          isSkillFavorite(skillCtx!.artifact) ? "☆" : "★"
        }}</span>
        {{
          isSkillFavorite(skillCtx!.artifact)
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
    :initial-name="skillCreatePrefill?.name"
    :initial-content="skillCreatePrefill?.content"
    :initial-location="skillCreatePrefill?.location"
    :initial-scope="skillCreatePrefill?.scope"
    @close="closeSkillCreate"
    @created="onArtifactCreated"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { isAbsolutePath, validateSkillImport } from "@threadle/shared";
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
  /** Deep-link: skill name or absolute path (`?skill=`). */
  focus?: string;
}>();

const emit = defineEmits<{
  reload: [];
}>();

const sessions = useSessionsStore();
const favorites = useFavoritesStore();
void favorites.ensureLoaded();

function skillFavoriteInput(a: RuleArtifact) {
  return {
    kind: "skill" as const,
    path: a.path,
    label: a.name,
  };
}
function isSkillFavorite(a: RuleArtifact): boolean {
  return favorites.isFavorite(skillFavoriteInput(a));
}
function toggleSkillFavorite(a: RuleArtifact): void {
  void favorites.toggle(skillFavoriteInput(a));
}

const skillCtx = ref<{ artifact: RuleArtifact; x: number; y: number }>();
let skillCtxIgnoreClick = false;

function openSkillCtx(e: MouseEvent, a: RuleArtifact): void {
  skillCtx.value = { artifact: a, x: e.clientX, y: e.clientY };
  skillCtxIgnoreClick = true;
  void Promise.resolve().then(() => {
    skillCtxIgnoreClick = false;
  });
}
function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    skillCtx.value = undefined;
  }
}
function onSkillDocClick(): void {
  if (skillCtxIgnoreClick) return;
  skillCtx.value = undefined;
}
onMounted(() => document.addEventListener("click", onSkillDocClick));
onUnmounted(() => document.removeEventListener("click", onSkillDocClick));

const showShadowedSkills = ref(false);
const skillsFilter = ref("");
const skillBulkBusy = ref(false);
const createMode = ref<"rules" | "skill">();
const skillCreatePrefill = ref<{
  name?: string;
  content?: string;
  location?: "claude" | "opencode" | "cursor" | "agents" | "threadle-custom" | "threadle-imported";
  scope?: string;
}>();
const skillImportInput = ref<HTMLInputElement>();
const pickedArtifact = ref<RuleArtifact>();

const knownProjectDirs = computed(() =>
  [...new Set(sessions.sessions.map((s) => s.projectDir).filter((d) => isAbsolutePath(d)))].sort(),
);

const allSkills = computed(() =>
  (props.ruleGroups ?? []).flatMap((g) => g.artifacts.filter((a) => a.kind === "skill")),
);

const skillStats = computed(() => {
  const skills = allSkills.value;
  const effective = skills.filter((s) => !s.shadowedBy);
  return {
    effective: effective.length,
    auto: effective.filter((s) => s.autoInvoke !== false).length,
    manual: effective.filter((s) => s.autoInvoke === false).length,
    shadowed: skills.filter((s) => !!s.shadowedBy).length,
    custom: skills.filter((s) => s.origin === "custom").length,
    imported: skills.filter((s) => s.origin === "imported").length,
    project: skills.filter((s) => s.origin === "project").length,
  };
});

function shortProjectLabel(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : dir;
}

function skillBucketLabel(
  origin: RuleArtifact["origin"],
  scope: string,
): { key: string; label: string; hint: string; order: number } {
  if (
    origin === "project" ||
    (scope !== "global" && (origin === "custom" || origin === "imported") && scope.includes("/"))
  ) {
    if (scope !== "global") {
      return {
        key: `project:${scope}`,
        label: `project · ${shortProjectLabel(scope)}`,
        hint: scope,
        order: 10,
      };
    }
  }
  if (origin === "custom") {
    return {
      key: "custom",
      label: "custom (threadle)",
      hint: "~/.config/threadle/skills/custom",
      order: 20,
    };
  }
  if (origin === "imported") {
    return {
      key: "imported",
      label: "imported (threadle)",
      hint: "~/.config/threadle/skills/imported",
      order: 30,
    };
  }
  if (scope !== "global") {
    return {
      key: `project:${scope}`,
      label: `project · ${shortProjectLabel(scope)}`,
      hint: scope,
      order: 10,
    };
  }
  return {
    key: "global",
    label: "global (agent homes)",
    hint: "~/.claude / ~/.cursor / ~/.agents / opencode / antigravity / codex / copilot / grok / muse",
    order: 40,
  };
}

const skillGroups = computed(() => {
  const buckets = new Map<
    string,
    { key: string; label: string; hint: string; order: number; artifacts: RuleArtifact[] }
  >();
  const q = skillsFilter.value.trim().toLowerCase();
  for (const g of props.ruleGroups ?? []) {
    for (const a of g.artifacts) {
      if (a.kind !== "skill") continue;
      if (!showShadowedSkills.value && a.shadowedBy) continue;
      if (
        q &&
        ![a.name, a.path, a.source, a.description, a.origin, a.shadowedBy, g.scope]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      ) {
        continue;
      }
      let origin = a.origin;
      if (g.scope !== "global" && (origin === "custom" || origin === "imported")) {
        origin = "project";
      }
      const meta = skillBucketLabel(origin ?? (g.scope === "global" ? "global" : "project"), g.scope);
      const bucket = buckets.get(meta.key) ?? { ...meta, artifacts: [] };
      bucket.artifacts.push(a);
      buckets.set(meta.key, bucket);
    }
  }
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      artifacts: b.artifacts.sort(
        (x, y) => (x.layer ?? 99) - (y.layer ?? 99) || x.name.localeCompare(y.name),
      ),
    }))
    .filter((b) => b.artifacts.length)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
});

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function openSkillCreate(prefill?: typeof skillCreatePrefill.value): void {
  skillCreatePrefill.value = prefill ?? { location: "threadle-custom", scope: "global" };
  createMode.value = "skill";
}

function closeSkillCreate(): void {
  createMode.value = undefined;
  skillCreatePrefill.value = undefined;
}

function triggerSkillImport(): void {
  skillImportInput.value?.click();
}

async function onSkillImportFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const content = await file.text();
  const checked = validateSkillImport({
    content,
    filename: file.name,
    allowDeriveName: true,
  });
  if (!checked.ok) {
    alert(`Import failed: ${checked.error}`);
    return;
  }
  openSkillCreate({
    name: checked.data.name,
    content: checked.data.content,
    location: "threadle-imported",
    scope: "global",
  });
}

function pickArtifact(a: RuleArtifact): void {
  pickedArtifact.value = pickedArtifact.value?.path === a.path ? undefined : a;
}

watch(
  () => [props.focus, props.ruleGroups] as const,
  ([focus]) => {
    if (!focus || !props.ruleGroups) return;
    const skills = allSkills.value;
    const hit =
      skills.find((a) => a.path === focus) ??
      skills.find((a) => a.name === focus && !a.shadowedBy) ??
      skills.find((a) => a.name === focus);
    if (hit) {
      if (hit.shadowedBy) showShadowedSkills.value = true;
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
  closeSkillCreate();
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

async function toggleSkillAuto(a: RuleArtifact): Promise<void> {
  try {
    const res = await fetch("/api/rules/skill/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: a.path, autoInvoke: a.autoInvoke === false }),
    });
    const body = (await res.json()) as { error?: string; artifact?: RuleArtifact };
    if (!res.ok || !body.artifact) throw new Error(body.error ?? `${res.status}`);
    onArtifactUpdated(body.artifact);
  } catch {
    // leave UI as-is; preview shows errors when opened
  }
}

async function toggleAllSkills(autoInvoke: boolean): Promise<void> {
  const targets = allSkills.value.filter(
    (a) => !a.shadowedBy && (a.autoInvoke !== false) !== autoInvoke,
  );
  if (!targets.length) return;
  skillBulkBusy.value = true;
  try {
    for (const a of targets) {
      try {
        const res = await fetch("/api/rules/skill/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: a.path, autoInvoke }),
        });
        const body = (await res.json()) as { error?: string; artifact?: RuleArtifact };
        if (res.ok && body.artifact) onArtifactUpdated(body.artifact);
      } catch {
        // continue remaining
      }
    }
  } finally {
    skillBulkBusy.value = false;
  }
}
</script>

<style scoped>
.skills-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.skills-toolbar {
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
.skill-card.skill-manual {
  opacity: 0.72;
}
.skill-card.skill-shadowed {
  opacity: 0.45;
}
.skill-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.skill-card .agent-name {
  margin-right: auto;
}
.skill-badge:hover {
  border-color: var(--border-strong);
  color: var(--text);
}
.skill-badge.shadowed {
  cursor: default;
  color: var(--text-faint);
}
.skill-badge.on {
  color: var(--text);
}
.skill-badge.off {
  color: var(--text-faint);
}
</style>
