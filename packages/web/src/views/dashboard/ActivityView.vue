<template>
  <div class="act-chrome">
    <header class="dash-head">
      <div>
        <h1 class="dash-title">Activity</h1>
      </div>
      <div class="view-controls">
        <ProviderFilterChips
          v-model="activityProviderF"
          :options="activityFilterChips"
        />
      </div>
    </header>

    <div class="dash-toolbar act-toolbar">
      <input
        v-model="activityFilter"
        class="threadle-input dash-search"
        placeholder="Filter…"
        spellcheck="false"
      />
      <ProjectFilterSelect
        v-model="projectF"
        :options="projectOptions"
        title="Filter by session project directory (cwd) or file path prefix"
      />
      <div class="chip-row">
        <button
          class="filter-chip"
          :class="{ active: activityMode === 'session' }"
          @click="activityMode = 'session'"
        >
          by session
        </button>
        <button
          class="filter-chip"
          :class="{ active: activityMode === 'file' }"
          @click="activityMode = 'file'"
        >
          by file
        </button>
        <button
          class="filter-chip"
          :class="{ active: writesOnly }"
          title="Only write / edit / create / delete / patch"
          @click="toggleWritesOnly"
        >
          writes only
        </button>
        <button
          class="filter-chip"
          :class="{ active: readsOnly }"
          title="Only read operations"
          @click="toggleReadsOnly"
        >
          reads only
        </button>
      </div>
    </div>
  </div>

  <section class="git-link mono">
    <span class="micro-label">possible sessions</span>
    <input
      v-model="gitCommit"
      class="threadle-input git-commit"
      placeholder="sha · HEAD · message"
      spellcheck="false"
      @keydown.enter="lookupGitSessions"
    />
    <button type="button" class="vsc-btn" :disabled="gitBusy" @click="lookupGitSessions">
      {{ gitBusy ? "…" : "lookup" }}
    </button>
    <span v-if="gitError" class="git-err">{{ gitError }}</span>
  </section>
  <p v-if="gitResolved" class="git-resolved mono" :title="gitResolved.sha">
    <span class="micro-label">{{ gitResolved.matchedBy === "message" ? "message →" : "rev →" }}</span>
    {{ shortSha(gitResolved.sha) }}
    <span v-if="gitResolved.subject" class="git-subj">{{ gitResolved.subject }}</span>
    <span v-if="gitResolved.matchCount && gitResolved.matchCount > 1" class="git-err">
      · newest of {{ gitResolved.matchCount }}
    </span>
  </p>
  <div v-if="gitCandidates.length" class="git-cands">
    <div
      v-for="c in gitCandidates"
      :key="c.provider + c.sessionId"
      class="git-cand"
      :class="{ open: expandedGitCand === actKey(c), ctx: actCtx && actKey(actCtx.target) === actKey(c) }"
    >
      <div
        class="git-cand-row"
        @click="toggleGitCand(c)"
        @contextmenu.prevent.stop="openActCtxMenu($event, c)"
        @mousedown="onActRowMouseDown($event, c)"
      >
        <span class="sess-caret">{{
          expandedGitCand === actKey(c) ? "▾" : "▸"
        }}</span>
        <span class="prov-dot" :style="{ background: providerColor(c.provider) }" />
        <span class="sess-title">{{ c.title?.trim() || shortId(c.sessionId) }}</span>
        <span class="sess-meta mono">score {{ c.score }}</span>
        <span class="sess-meta" :title="c.matchReasons.join(' · ')">{{
          c.matchReasons[0] ?? "possible"
        }}</span>
        <div
          class="row-actions"
          :class="{ pinned: openMenu === actKey(c) }"
          @click.stop
        >
          <button
            type="button"
            class="row-icon"
            title="View transcript"
            @click="fileViewers.openTranscript(c.provider, c.sessionId)"
          >
            ≡
          </button>
          <button
            type="button"
            class="row-icon"
            title="View session blueprint"
            @click="router.push(`/blueprint/${c.provider}/${c.sessionId}`)"
          >
            ⌗
          </button>
          <div class="row-menu">
            <button
              type="button"
              class="row-icon menu-btn"
              :class="{ open: openMenu === actKey(c) }"
              title="More actions"
              @click="toggleMenu(c)"
            >
              ⋯
            </button>
            <div v-if="openMenu === actKey(c)" class="menu-pop">
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => fileViewers.openTranscript(c.provider, c.sessionId))"
              >
                <span class="menu-glyph">≡</span> Transcript
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => router.push(`/blueprint/${c.provider}/${c.sessionId}`))"
              >
                <span class="menu-glyph">⌗</span> Blueprint
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => sessionToWorkflow(c))"
              >
                <span class="menu-glyph">→</span> Workflow
              </button>
              <button
                v-if="c.projectDir"
                type="button"
                class="menu-item"
                @click="menuAction(() => settings.openPath(c.projectDir!))"
              >
                <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => downloadSessionBundle(c))"
              >
                <span class="menu-glyph">⇓</span> Download bundle
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="expandedGitCand === actKey(c)"
        class="git-cand-detail"
      >
        <div class="run-kv mono">
          <span class="run-key">provider</span>
          <span class="run-val">{{ providerShort(c.provider) }}</span>
          <span class="run-key">session</span>
          <span class="run-val" :title="c.sessionId">{{ shortId(c.sessionId) }}</span>
          <span class="run-key">score</span>
          <span class="run-val">{{ c.score }}</span>
          <span v-if="c.projectDir" class="run-key">project</span>
          <span
            v-if="c.projectDir"
            class="run-val file-path"
            :title="c.projectDir"
          >{{ bidiPath(tildePath(c.projectDir)) }}</span>
          <span v-if="c.updatedAt" class="run-key">updated</span>
          <span v-if="c.updatedAt" class="run-val" :title="new Date(c.updatedAt).toLocaleString()">
            {{ relativeTime(c.updatedAt) }}
          </span>
        </div>
        <div v-if="c.matchReasons.length" class="git-cand-why">
          <div class="micro-label">why this match</div>
          <ul class="git-cand-reasons mono">
            <li v-for="(r, i) in c.matchReasons" :key="i">{{ r }}</li>
          </ul>
        </div>
        <div v-if="c.overlapFiles?.length" class="git-cand-why">
          <div class="micro-label">overlapping files</div>
          <div class="git-cand-files">
            <span
              v-for="(f, i) in c.overlapFiles"
              :key="i"
              class="git-cand-file mono"
              :title="f"
            >{{ fileBasename(f) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="dash-load-host">
    <GraphLoadingOverlay
      :loading="!activityLoaded"
      label="Loading activity"
    />
    <template v-if="activityLoaded && activityMode === 'session'">
    <div v-for="a in filteredActivity" :key="actKey(a)" class="sess-block act-block">
      <div
        class="sess-row"
        :class="{ ctx: actCtx && actKey(actCtx.target) === actKey(a) }"
        @click="toggleActivity(a)"
        @contextmenu.prevent.stop="openActCtxMenu($event, a)"
        @mousedown="onActRowMouseDown($event, a)"
      >
        <span class="sess-caret">{{
          expandedActivity === actKey(a) ? "▾" : "▸"
        }}</span>
        <span class="prov-dot" :style="{ background: providerColor(a.provider) }" />
        <span class="sess-title">{{ a.title?.trim() || shortId(a.sessionId) }}</span>
        <span class="sess-meta mono">{{ actFiles(a).length }} files</span>
        <span class="sess-meta">{{ relativeTime(a.updatedAt) }}</span>
        <div
          class="row-actions"
          :class="{ pinned: openMenu === actKey(a) }"
          @click.stop
        >
          <button
            type="button"
            class="row-icon"
            title="View transcript"
            @click="fileViewers.openTranscript(a.provider, a.sessionId)"
          >
            ≡
          </button>
          <button
            type="button"
            class="row-icon"
            title="View session blueprint"
            @click="router.push(`/blueprint/${a.provider}/${a.sessionId}`)"
          >
            ⌗
          </button>
          <div class="row-menu">
            <button
              type="button"
              class="row-icon menu-btn"
              :class="{ open: openMenu === actKey(a) }"
              title="More actions"
              @click="toggleMenu(a)"
            >
              ⋯
            </button>
            <div v-if="openMenu === actKey(a)" class="menu-pop">
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => fileViewers.openTranscript(a.provider, a.sessionId))"
              >
                <span class="menu-glyph">≡</span> Transcript
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => router.push(`/blueprint/${a.provider}/${a.sessionId}`))"
              >
                <span class="menu-glyph">⌗</span> Blueprint
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => sessionToWorkflow(a))"
              >
                <span class="menu-glyph">→</span> Workflow
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => settings.openPath(a.projectDir))"
              >
                <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
              </button>
              <button
                type="button"
                class="menu-item"
                @click="menuAction(() => downloadSessionBundle(a))"
              >
                <span class="menu-glyph">⇓</span> Download bundle
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="expandedActivity === actKey(a)" class="sess-children">
        <div v-for="f in actFiles(a)" :key="f.path" class="act-file-row">
          <span class="op-badge" :class="f.op">{{ f.op }}</span>
          <span class="file-path mono" :title="f.path">{{ bidiPath(f.path) }}</span>
          <span
            v-if="f.additions || f.deletions"
            class="diffstat"
            :title="f.hunks?.length ? 'lines ' + f.hunks.join(', ') : undefined"
          >
            <span class="add">+{{ f.additions }}</span>
            <span class="del">−{{ f.deletions }}</span>
          </span>
          <span class="act-time mono" :title="f.lastSeenAt ? new Date(f.lastSeenAt).toLocaleString() : undefined">
            {{ f.lastSeenAt ? relativeTime(f.lastSeenAt) : "" }}
          </span>
          <div class="row-actions act-file-actions" @click.stop>
            <button
              v-if="isLikelyTextPath(f.path)"
              type="button"
              class="row-icon"
              title="Open"
              @click="fileViewers.open(f.path)"
            >
              ⧉
            </button>
            <button
              type="button"
              class="row-icon"
              :title="`Open in ${settings.editorLabel}`"
              @click="settings.openPath(f.path)"
            >
              ⟨/⟩
            </button>
          </div>
        </div>
        <div v-if="!actFiles(a).length" class="sess-child-hint">no matching file operations</div>
      </div>
    </div>
  </template>

  <template v-else-if="activityLoaded">
    <div
      class="stat-table cols-act"
      v-col-resize="'act'"
      data-cols="minmax(0,1fr) 170px 90px 80px 110px"
    >
      <div class="stat-cols micro-label">
        <span class="th" @click="sortBy('actfile', 'path')">file{{ arrow('actfile', 'path') }}</span><span
          class="th"
          @click="sortBy('actfile', 'ops')"
          >ops{{ arrow('actfile', 'ops') }}</span
        ><span class="th" @click="sortBy('actfile', 'churn')">+/−{{ arrow('actfile', 'churn') }}</span><span
          class="th"
          @click="sortBy('actfile', 'sessions')"
          >sessions{{ arrow('actfile', 'sessions') }}</span
        ><span
          class="th"
          @click="sortBy('actfile', 'last')"
          >last touched{{ arrow('actfile', 'last') }}</span>
      </div>
      <div v-for="f in fileActivityIndex" :key="f.path" class="stat-row">
        <span class="stat-val pathcell">
          <div class="row-actions act-file-actions" @click.stop>
            <button
              v-if="isLikelyTextPath(f.path)"
              type="button"
              class="row-icon"
              title="Open"
              @click="fileViewers.open(f.path)"
            >
              ⧉
            </button>
            <button
              type="button"
              class="row-icon"
              :title="`Open in ${settings.editorLabel}`"
              @click="settings.openPath(f.path)"
            >
              ⟨/⟩
            </button>
          </div>
          <span class="file-path" :title="f.path">{{ bidiPath(f.path) }}</span>
        </span>
        <span class="stat-name act-ops">
          <span v-for="op in f.ops" :key="op" class="op-badge" :class="op">{{ op }}</span>
        </span>
        <span class="stat-val diffstat-cell">
          <span v-if="f.additions || f.deletions" class="diffstat">
            <span class="add">+{{ f.additions }}</span>
            <span class="del">−{{ f.deletions }}</span>
          </span>
          <template v-else>—</template>
        </span>
        <span class="stat-val">{{ f.sessions }}</span>
        <span class="stat-val">{{ relativeTime(f.last) }}</span>
      </div>
    </div>
  </template>
  </div>

  <Teleport to="body">
    <div
      v-if="actCtx"
      class="menu-pop wf-folder-ctx"
      :style="{ left: actCtx.x + 'px', top: actCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        type="button"
        class="menu-item"
        @click="
          menuAction(() =>
            fileViewers.openTranscript(actCtx!.target.provider, actCtx!.target.sessionId),
          )
        "
      >
        <span class="menu-glyph">≡</span> Transcript
      </button>
      <button
        type="button"
        class="menu-item"
        @click="
          menuAction(() =>
            router.push(`/blueprint/${actCtx!.target.provider}/${actCtx!.target.sessionId}`),
          )
        "
      >
        <span class="menu-glyph">⌗</span> Blueprint
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => sessionToWorkflow(actCtx!.target))"
      >
        <span class="menu-glyph">→</span> Workflow
      </button>
      <button
        v-if="actCtx.target.projectDir"
        type="button"
        class="menu-item"
        @click="menuAction(() => settings.openPath(actCtx!.target.projectDir!))"
      >
        <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => downloadSessionBundle(actCtx!.target))"
      >
        <span class="menu-glyph">⇓</span> Download bundle
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { ProviderId, SessionRef } from "@threadle/shared";
import { bidiPath, relativeTime, shortId, tildePath } from "@/lib/format";
import {
  providerColor,
  providerShort,
  type SessionFilter,
} from "@/lib/providers";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import ProjectFilterSelect from "@/components/ProjectFilterSelect.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import { vColResize } from "@/lib/colResize";
import { downloadUrl, sessionsToWorkflow } from "@/lib/convert";
import { useSettingsStore } from "@/stores/settings";
import { useSessionsStore } from "@/stores/sessions";
import { useFileViewersStore, isLikelyTextPath } from "@/stores/fileViewers";
import "./chrome.css";

interface SessionActivity {
  provider: "claude-code" | "opencode" | "cursor" | "antigravity" | "codex" | "copilot" | "grok";
  sessionId: string;
  title?: string;
  projectDir: string;
  updatedAt: number;
  files: Array<{ path: string; op: string; lastSeenAt?: number; additions?: number; deletions?: number; hunks?: string[] }>;
}

interface FileActivityRow {
  path: string;
  ops: string[];
  sessions: number;
  last: number;
  additions: number;
  deletions: number;
}

interface GitCandidate {
  provider: string;
  sessionId: string;
  title?: string;
  projectDir?: string;
  updatedAt?: number;
  score: number;
  matchReasons: string[];
  overlapFiles?: string[];
  label: string;
}

type ActSessTarget = {
  provider: string;
  sessionId: string;
  title?: string;
  projectDir?: string;
};

const router = useRouter();
const settings = useSettingsStore();
const sessions = useSessionsStore();
const fileViewers = useFileViewersStore();

const activity = ref<SessionActivity[]>([]);
const activityLoaded = ref(false);
const activityMode = ref<"session" | "file">("session");
const activityFilter = ref("");
const activityProviderF = ref<SessionFilter>("all");
const projectF = ref("all");
const writesOnly = ref(false);
const readsOnly = ref(false);
const expandedActivity = ref<string>();
const expandedGitCand = ref<string>();
const openMenu = ref<string>();
const actCtx = ref<{ target: ActSessTarget; x: number; y: number }>();
let actCtxIgnoreClick = false;

function actKey(t: { provider: string; sessionId: string }): string {
  return t.provider + t.sessionId;
}

function fileBasename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function toggleGitCand(c: GitCandidate): void {
  const k = actKey(c);
  expandedGitCand.value = expandedGitCand.value === k ? undefined : k;
}

function openActCtxMenu(e: MouseEvent, target: ActSessTarget): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const pad = 8;
  const w = 260;
  const h = 220;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  actCtxIgnoreClick = true;
  actCtx.value = { target, x: Math.max(pad, x), y: Math.max(pad, y) };
  window.setTimeout(() => {
    actCtxIgnoreClick = false;
  }, 400);
}

function onActRowMouseDown(e: MouseEvent, target: ActSessTarget): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openActCtxMenu(e, target);
}

function toggleMenu(t: ActSessTarget): void {
  actCtx.value = undefined;
  const k = actKey(t);
  openMenu.value = openMenu.value === k ? undefined : k;
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    openMenu.value = undefined;
    actCtx.value = undefined;
  }
}

function onDocClick(e: MouseEvent): void {
  if (actCtxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".row-menu") && !t.closest?.(".wf-folder-ctx")) {
    openMenu.value = undefined;
    actCtx.value = undefined;
  }
}

function toSessionRef(t: ActSessTarget): SessionRef {
  const found = sessions.sessions.find(
    (s) => s.provider === t.provider && s.id === t.sessionId,
  );
  if (found) return found;
  return {
    provider: t.provider as ProviderId,
    id: t.sessionId,
    projectDir: t.projectDir ?? "(unknown)",
    title: t.title,
    updatedAt: Date.now(),
    status: "unknown",
    kind: "session",
  };
}

async function sessionToWorkflow(t: ActSessTarget): Promise<void> {
  try {
    const s = toSessionRef(t);
    const id = await sessionsToWorkflow(
      `${s.title ?? shortId(s.id)} (from session)`,
      [s],
    );
    await router.push(`/graph/${id}`);
  } catch (err) {
    alert(`Convert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function downloadSessionBundle(t: ActSessTarget): Promise<void> {
  try {
    await downloadUrl(
      `/api/sessions/${t.provider}/bundle/${t.sessionId}`,
      `threadle-bundle-${shortId(t.sessionId).replace("…", "")}.json`,
    );
  } catch (err) {
    alert(`Bundle failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const activityFilterChips = computed(() => sessions.sessionFilterChips);
watch(activityFilterChips, (chips) => {
  if (!chips.includes(activityProviderF.value)) activityProviderF.value = "all";
});

function providerMatches(provider: string): boolean {
  return activityProviderF.value === "all" || provider === activityProviderF.value;
}

function projectLabel(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

/** Distinct project dirs from activity rows (and sessions), newest first. */
const projectOptions = computed(() => {
  const latest = new Map<string, number>();
  for (const a of activity.value) {
    const dir = a.projectDir?.trim();
    if (!dir || dir === "(unknown)") continue;
    latest.set(dir, Math.max(latest.get(dir) ?? 0, a.updatedAt));
  }
  for (const s of sessions.sessions) {
    if (s.kind === "subagent-run") continue;
    const dir = s.projectDir?.trim();
    if (!dir || dir === "(unknown)") continue;
    latest.set(dir, Math.max(latest.get(dir) ?? 0, s.updatedAt ?? s.createdAt ?? 0));
  }
  return [...latest.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir]) => ({ dir, label: projectLabel(dir) }));
});
watch(projectOptions, (opts) => {
  if (projectF.value !== "all" && !opts.some((p) => p.dir === projectF.value)) {
    projectF.value = "all";
  }
});

function projectMatches(a: SessionActivity): boolean {
  if (projectF.value === "all") return true;
  return a.projectDir === projectF.value;
}

function pathUnderProject(filePath: string): boolean {
  if (projectF.value === "all") return true;
  const root = projectF.value;
  return filePath === root || filePath.startsWith(root.endsWith("/") ? root : root + "/");
}

function toggleWritesOnly(): void {
  writesOnly.value = !writesOnly.value;
  if (writesOnly.value) readsOnly.value = false;
}

function toggleReadsOnly(): void {
  readsOnly.value = !readsOnly.value;
  if (readsOnly.value) writesOnly.value = false;
}

const gitCommit = ref("");
const gitBusy = ref(false);
const gitError = ref("");
const gitCandidates = ref<GitCandidate[]>([]);
const gitResolved = ref<{
  sha: string;
  subject?: string;
  matchedBy: "rev" | "message";
  matchCount?: number;
} | null>(null);

function shortSha(sha: string): string {
  return sha.length > 12 ? sha.slice(0, 7) : sha;
}

async function lookupGitSessions(): Promise<void> {
  const commit = gitCommit.value.trim() || "HEAD";
  gitBusy.value = true;
  gitError.value = "";
  gitCandidates.value = [];
  gitResolved.value = null;
  try {
    let dir: string | undefined;
    const h = await fetch("/api/health").then(
      (r) => r.json() as Promise<{ projectDir?: string }>,
    );
    dir = h.projectDir;
    if (!dir) dir = activity.value[0]?.projectDir;
    const q = new URLSearchParams({ commit });
    if (dir) q.set("dir", dir);
    else {
      throw new Error("dir required — start threadle with --dir <repo>");
    }
    const r = await fetch(`/api/git/sessions?${q}`);
    const body = (await r.json()) as {
      error?: string;
      commit?: {
        sha: string;
        subject?: string;
        matchedBy?: "rev" | "message";
        matchCount?: number;
      };
      candidates?: Array<{
        provider: string;
        sessionId: string;
        title?: string;
        projectDir?: string;
        updatedAt?: number;
        score: number;
        matchReasons?: string[];
        reasons?: string[];
        overlapFiles?: string[];
        label?: string;
      }>;
    };
    if (!r.ok) throw new Error(body.error ?? `lookup failed (${r.status})`);
    if (body.commit?.sha) {
      gitResolved.value = {
        sha: body.commit.sha,
        subject: body.commit.subject,
        matchedBy: body.commit.matchedBy ?? "rev",
        matchCount: body.commit.matchCount,
      };
    }
    gitCandidates.value = (body.candidates ?? []).map((c) => ({
      provider: c.provider,
      sessionId: c.sessionId,
      title: c.title,
      projectDir: c.projectDir,
      updatedAt: c.updatedAt,
      score: c.score,
      matchReasons: c.matchReasons ?? c.reasons ?? [],
      overlapFiles: c.overlapFiles,
      label: c.label ?? "possible",
    }));
    expandedGitCand.value = undefined;
    if (!gitCandidates.value.length) gitError.value = "no possible sessions";
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Collapse legacy execa dumps if an old server is still running.
    gitError.value = /Command failed|fatal:/i.test(raw)
      ? `no commit matches rev or message: ${commit}`
      : raw;
  } finally {
    gitBusy.value = false;
  }
}

const sorts = reactive<Record<string, { key: string; dir: 1 | -1 }>>({});

function sortBy(table: string, key: string): void {
  const cur = sorts[table];
  if (cur && cur.key === key) cur.dir = (cur.dir * -1) as 1 | -1;
  else sorts[table] = { key, dir: -1 };
}

function arrow(table: string, key: string): string {
  const cur = sorts[table];
  if (!cur || cur.key !== key) return "";
  return cur.dir === -1 ? " ▾" : " ▴";
}

function applySort<T>(
  table: string,
  rows: T[],
  sel: Record<string, (r: T) => number | string>,
  defKey: string,
): T[] {
  const cur = sorts[table] ?? { key: defKey, dir: -1 as const };
  const f = sel[cur.key];
  if (!f) return rows;
  return [...rows].sort((a, b) => {
    const va = f(a);
    const vb = f(b);
    const c =
      typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
    return c * cur.dir;
  });
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  sessions.ensureHydrated();
  if (!activityLoaded.value) {
    void fetch("/api/files/activity")
      .then((r) => r.json() as Promise<SessionActivity[]>)
      .then((a) => {
        activity.value = a;
        activityLoaded.value = true;
        sessions.noteProviders(a.map((x) => x.provider));
      });
  }
});
onUnmounted(() => document.removeEventListener("click", onDocClick));

const WRITE_OPS = new Set(["write", "edit", "create", "delete", "patch"]);
const READ_OPS = new Set(["read"]);

function opMatches(op: string): boolean {
  if (writesOnly.value) return WRITE_OPS.has(op);
  if (readsOnly.value) return READ_OPS.has(op);
  return true;
}

function actFiles(a: SessionActivity): SessionActivity["files"] {
  const q = activityFilter.value.toLowerCase();
  return a.files.filter(
    (f) =>
      opMatches(f.op) &&
      pathUnderProject(f.path) &&
      (!q || f.path.toLowerCase().includes(q)),
  );
}

const filteredActivity = computed(() => {
  const q = activityFilter.value.toLowerCase();
  return activity.value.filter((a) => {
    if (!providerMatches(a.provider)) return false;
    if (!projectMatches(a)) return false;
    if (!a.files.some((f) => opMatches(f.op) && pathUnderProject(f.path))) return false;
    if (!q) return true;
    return (
      a.title?.toLowerCase().includes(q) ||
      a.projectDir.toLowerCase().includes(q) ||
      a.files.some(
        (f) =>
          opMatches(f.op) &&
          pathUnderProject(f.path) &&
          f.path.toLowerCase().includes(q),
      )
    );
  });
});

const ACT_FILE_SEL: Record<string, (f: FileActivityRow) => number | string> = {
  path: (f) => f.path,
  ops: (f) => f.ops.join(","),
  sessions: (f) => f.sessions,
  last: (f) => f.last,
  churn: (f) => f.additions + f.deletions,
};

const fileActivityIndex = computed<FileActivityRow[]>(() => {
  const q = activityFilter.value.toLowerCase();
  const map = new Map<
    string,
    { ops: Set<string>; sessions: Set<string>; last: number; additions: number; deletions: number }
  >();
  for (const a of activity.value) {
    if (!providerMatches(a.provider)) continue;
    if (!projectMatches(a)) continue;
    for (const f of a.files) {
      if (!opMatches(f.op)) continue;
      if (!pathUnderProject(f.path)) continue;
      if (q && !f.path.toLowerCase().includes(q)) continue;
      if (!map.has(f.path)) {
        map.set(f.path, {
          ops: new Set(),
          sessions: new Set(),
          last: 0,
          additions: 0,
          deletions: 0,
        });
      }
      const r = map.get(f.path)!;
      r.ops.add(f.op);
      r.sessions.add(a.provider + a.sessionId);
      r.last = Math.max(r.last, f.lastSeenAt ?? a.updatedAt);
      r.additions += f.additions ?? 0;
      r.deletions += f.deletions ?? 0;
    }
  }
  const rows = [...map.entries()].map(([path, r]) => ({
    path,
    ops: [...r.ops].sort(),
    sessions: r.sessions.size,
    last: r.last,
    additions: r.additions,
    deletions: r.deletions,
  }));
  return applySort("actfile", rows, ACT_FILE_SEL, "sessions");
});

function toggleActivity(a: SessionActivity): void {
  const k = actKey(a);
  expandedActivity.value = expandedActivity.value === k ? undefined : k;
}
</script>

<style scoped>
.act-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.act-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.act-path .row-icon {
  direction: ltr;
}
.act-time {
  margin-left: auto;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  flex-shrink: 0;
  padding-right: 8px;
}
.act-block {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 6px;
  overflow: hidden;
}
.act-file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 16px 4px 38px;
  min-width: 0;
}
.act-file-row .file-path {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.act-file-actions {
  width: auto;
}
.act-ops {
  gap: 4px;
}
.cols-act {
  --cols: minmax(0, 1fr) 170px 90px 80px 110px;
}
.cols-act .stat-cols,
.cols-act .stat-row {
  grid-template-columns: var(--cols);
}
.cols-act .stat-cols span:nth-child(2) {
  text-align: left;
}
.cols-act .stat-row {
  height: auto;
  min-height: 38px;
  padding-top: 4px;
  padding-bottom: 4px;
}
.git-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0 12px;
  flex-wrap: wrap;
}
.git-commit {
  width: min(420px, 100%);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.git-err {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
}
.git-resolved {
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  margin: -6px 0 10px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.git-subj {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.git-cands {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.git-cand {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.git-cand.open {
  border-color: var(--border-strong);
}
.git-cand-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  min-width: 0;
  cursor: pointer;
}
.git-cand-row:hover {
  background: var(--hover-overlay);
}
.git-cand-row .sess-title {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-cand-row .sess-meta {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 36%;
  text-align: left;
}
.git-cand-row .sess-meta.mono {
  flex: 0 0 auto;
  max-width: none;
}
.git-cand-row .row-actions {
  width: auto;
}
.git-cand-detail {
  padding: 4px 12px 12px 34px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--border);
  background: var(--panel-bg);
}
.git-cand-why {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.git-cand-reasons {
  margin: 0;
  padding-left: 1.1em;
  color: var(--text-dim);
  font-size: var(--fs-2xs);
  line-height: 1.45;
}
.git-cand-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.git-cand-file {
  font-size: var(--fs-2xs);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 7px;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-folder-ctx {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 80;
}
.pathcell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.pathcell .file-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
