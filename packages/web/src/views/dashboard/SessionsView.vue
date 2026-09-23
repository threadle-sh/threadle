<template>
  <div class="sess-chrome">
        <header class="dash-head">
          <div>
            <h1 class="dash-title">Sessions</h1>
          </div>
          <div class="view-controls">
            <ProviderFilterChips
              v-model="providerFilter"
              :options="providerFilterChips"
            />
          </div>
        </header>

        <div class="dash-toolbar sess-toolbar">
          <input
            v-model="sessionFilter"
            class="threadle-input dash-search"
            placeholder="Filter sessions…"
            spellcheck="false"
          />
          <select v-model="sessionSort" class="threadle-input sort-select">
            <option value="updated">recent first</option>
            <option value="messages">most messages</option>
            <option value="tokens">most output tokens</option>
            <option value="title">title A–Z</option>
          </select>
          <button
            type="button"
            class="filter-chip"
            :class="{ active: activeOnly }"
            :title="`only sessions with a live process (${liveSessionCount})`"
            @click="activeOnly = !activeOnly"
          >
            ● active{{ liveSessionCount ? ` ${liveSessionCount}` : "" }}
          </button>
          <button
            type="button"
            class="filter-chip"
            :class="{ active: showPilot }"
            :title="
              showPilot
                ? `only test pilot sessions (${pilotSessionCount}) — click to hide`
                : `test pilot sessions hidden (${pilotSessionCount}) — click to show only those`
            "
            @click="showPilot = !showPilot"
          >
            ✦ test{{ pilotSessionCount ? ` ${pilotSessionCount}` : "" }}
          </button>
        </div>
  </div>

        <div class="dash-load-host">
          <GraphLoadingOverlay
            :loading="listLoading"
            label="Loading sessions"
          />
          <template v-if="!listLoading">
        <div
          v-if="sessionHeat.cells.length"
          class="sess-heatmap"
          :style="{ '--heat-accent': heatAccent }"
        >
          <div class="sess-heat-head mono">
            <div class="sess-heat-summary">
              <span class="sess-heat-kv">
                <span class="sess-heat-k">sessions</span>
                <span class="sess-heat-v">{{ sessionHeat.sessInYear }}</span>
              </span>
              <span class="sess-heat-kv">
                <span class="sess-heat-k">active</span>
                <span class="sess-heat-v">{{ sessionHeat.activeDays }}d</span>
              </span>
              <span class="sess-heat-kv">
                <span class="sess-heat-k">msgs</span>
                <span class="sess-heat-v">{{ sessionHeat.msgsLabel }}</span>
              </span>
              <span class="sess-heat-kv">
                <span class="sess-heat-k">in</span>
                <span class="sess-heat-v">{{ sessionHeat.inLabel }}</span>
              </span>
              <span class="sess-heat-kv">
                <span class="sess-heat-k">out</span>
                <span class="sess-heat-v">{{ sessionHeat.outLabel }}</span>
              </span>
              <span class="sess-heat-day-slot" :class="{ on: !!heatDayLabel }">
                <button
                  type="button"
                  class="sess-heat-day-chip"
                  :disabled="!heatDayLabel"
                  :title="heatDayLabel ? 'clear day filter' : undefined"
                  @click="heatDay = null"
                >
                  <span class="sess-heat-k">day</span>
                  <span class="sess-heat-v sess-heat-v-day">{{ heatDayLabel || "Wed, Sep 00" }} ×</span>
                </button>
              </span>
            </div>
            <div class="sess-heat-right">
              <select v-model.number="heatYear" class="threadle-input sort-select sess-heat-year" title="Heatmap year">
                <option v-for="y in heatYears" :key="y" :value="y">{{ y }}</option>
              </select>
            </div>
          </div>
          <div class="sess-heat-body">
            <div class="sess-heat-dows micro-label mono" aria-hidden="true">
              <span class="sess-heat-dow-spacer" />
              <span>M</span>
              <span></span>
              <span>W</span>
              <span></span>
              <span>F</span>
              <span></span>
              <span></span>
            </div>
            <div class="sess-heat-scroll">
              <div class="sess-heat-months micro-label mono" aria-hidden="true">
                <span
                  v-for="(lab, wi) in sessionHeat.monthLabels"
                  :key="wi"
                  class="sess-heat-month"
                  >{{ lab }}</span
                >
              </div>
              <div class="sess-heat-grid">
                <div
                  v-for="(week, wi) in sessionHeat.weeks"
                  :key="wi"
                  class="sess-heat-week"
                >
                  <button
                    v-for="(cell, di) in week"
                    :key="di"
                    type="button"
                    class="sess-heat-cell"
                    :class="{
                      selected: heatDay === cell.key,
                      ghost: !cell.inYear,
                      future: cell.inYear && !cell.inRange,
                    }"
                    :data-level="cell.level"
                    :title="cell.title"
                    :disabled="!cell.inRange"
                    tabindex="-1"
                    @click="toggleHeatDay(cell)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="sess-layout">
          <div class="sess-list">
        <div v-for="group in sessionGroups" :key="group.dir" class="sess-group">
          <div class="sess-group-head">
            <div class="micro-label sess-group-name" :title="group.dir">{{ group.dir }}</div>
            <span class="sess-group-spacer" />
            <div class="group-actions">
              <button
                class="vsc-btn"
                title="Open project map — sessions, contexts, workflows, agents, rules, skills"
                @click="router.push({ path: '/map', query: { dir: group.dir } })"
              >
                ◈ map
              </button>
              <button
                class="vsc-btn"
                title="Download reasoning + context + meta for every session in this project (JSON bundle)"
                @click="downloadProjectBundle(group.dir)"
              >
                ⇓ bundle
              </button>
              <button
                class="vsc-btn"
                title="Create a workflow seeded with every session in this project and their subagents"
                @click="projectToWorkflow(group)"
              >
                → workflow
              </button>
            </div>
          </div>
          <div v-for="s in group.sessions" :key="s.provider + s.id" class="sess-block">
            <div
              class="sess-row"
              :class="{ picked: pickedSession?.id === s.id, ctx: sessCtx?.session.id === s.id }"
              @click="pickSession(s)"
              @contextmenu.prevent.stop="openSessionCtxMenu($event, s)"
              @mousedown="onSessionRowMouseDown($event, s)"
            >
              <span class="prov-dot" :style="{ background: providerColor(s.provider) }" />
              <span class="sess-title">
                <span
                  v-if="isPilotSession(s)"
                  class="sess-pilot-mark"
                  title="Settings test pilot session"
                  >✦</span
                >{{ s.title ?? shortId(s.id) }}
              </span>
              <span class="sess-meta sess-agent mono">{{ s.agent ?? "—" }}</span>
              <span class="sess-meta sess-model mono" :title="s.model">{{
                s.model?.split("/").pop() ?? "—"
              }}</span>
              <span class="sess-meta sess-msgs mono">{{
                s.messageCount ? s.messageCount + " msg" : "—"
              }}</span>
              <span class="sess-meta sess-time">{{ relativeTime(s.updatedAt) }}</span>
              <div class="row-actions" :class="{ pinned: openMenu === key(s) }" @click.stop>
                <button
                  class="row-icon"
                  title="View transcript"
                  @click="fileViewers.openTranscript(s.provider, s.id)"
                >
                  ≡
                </button>
                <button
                  class="row-icon"
                  title="View session blueprint"
                  @click="router.push(`/blueprint/${s.provider}/${s.id}`)"
                >
                  ⌗
                </button>
                <button
                  class="row-icon"
                  title="Convert to workflow"
                  @click="sessionToWorkflow(s)"
                >
                  →
                </button>
                <div class="row-menu">
                  <button
                    class="row-icon menu-btn"
                    :class="{ open: openMenu === key(s) }"
                    title="More actions"
                    @click="toggleMenu(s)"
                  >
                    ⋯
                  </button>
                  <div v-if="openMenu === key(s)" class="menu-pop">
                    <button
                      class="menu-item"
                      @click="menuAction(() => fileViewers.openTranscript(s.provider, s.id))"
                    >
                      <span class="menu-glyph">≡</span> Transcript
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => router.push(`/blueprint/${s.provider}/${s.id}`))"
                    >
                      <span class="menu-glyph">⌗</span> Blueprint
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => router.push(`/growth/${s.provider}/${s.id}`))"
                    >
                      <span class="menu-glyph"><GrowthMark /></span> Growth
                    </button>
                    <button class="menu-item" @click="menuAction(() => sessionToWorkflow(s))">
                      <span class="menu-glyph">→</span> Workflow
                    </button>
                    <button class="menu-item" @click="menuAction(() => startCompareFrom(s))">
                      <span class="menu-glyph">⇆</span> Compare
                    </button>
                    <button class="menu-item" @click="menuAction(() => emitHandoff(s))">
                      <span class="menu-glyph">⇄</span> Hand off
                    </button>
                    <button
                      class="menu-item"
                      @click="menuAction(() => settings.openPath(s.projectDir))"
                    >
                      <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
                    </button>
                    <button class="menu-item" @click="menuAction(() => downloadSessionBundle(s))">
                      <span class="menu-glyph">⇓</span> Download bundle
                    </button>
                  </div>
                </div>
              </div>
              <span class="status-dot" :class="s.status" />
            </div>
            <div v-if="expandedKey === key(s)" class="sess-children">
              <div v-if="childState(s) === 'loading'" class="sess-child-hint">loading subagent runs…</div>
              <div v-else-if="!childrenOf(s).length" class="sess-child-hint">no subagent runs</div>
              <div
                v-for="c in childrenOf(s)"
                :key="c.id"
                class="sess-row child"
                :class="{ picked: pickedSession?.id === c.id, ctx: sessCtx?.session.id === c.id }"
                @click.stop="pickSession(c)"
                @contextmenu.prevent.stop="openSessionCtxMenu($event, c)"
                @mousedown.stop="onSessionRowMouseDown($event, c)"
              >
                <span class="sess-caret child-glyph">⎇</span>
                <span class="sess-title">{{ c.title ?? shortId(c.id) }}</span>
                <span class="sess-meta mono">{{ c.agent ?? "subagent" }}</span>
                <span class="sess-meta mono">{{ c.messageCount ?? "·" }} msg</span>
                <span class="sess-meta">{{ relativeTime(c.updatedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
          </div>

          <aside v-if="pickedSession" class="sess-detail">
            <div class="sess-detail-head">
              <div class="sess-detail-titles">
                <div class="sess-detail-title" :title="pickedSession.title">
                  {{ pickedSession.title ?? shortId(pickedSession.id) }}
                </div>
                <div class="sess-detail-meta mono">
                  <SessionLivePill
                    :status="pickedLiveStatus"
                    :phase="
                      pickedSession
                        ? phaseForSession(pickedSession.provider, pickedSession.id)
                        : undefined
                    "
                  />
                  <span
                    v-if="pickedSession.kind === 'subagent-run' || pickedSession.parentId"
                    class="inst-sub micro-label"
                  >sub</span>
                  <span v-if="pickedSession.agent" class="sess-detail-agent">
                    ⟨/⟩ {{ pickedSession.agent }}
                  </span>
                  <button
                    v-if="pickedSession.parentId"
                    type="button"
                    class="sess-detail-parent"
                    title="Open parent session"
                    @click="openParentSession(pickedSession)"
                  >
                    ↑ parent {{ shortId(pickedSession.parentId) }}
                  </button>
                </div>
              </div>
              <DetailExpandControls
                @expand="detailExpanded = true"
                @close="closePickedSession"
              />
            </div>
            <div v-if="sessionFromAgents" class="sess-detail-actions">
              <button
                class="vsc-btn"
                title="Back to Agents"
                @click="backToAgents"
              >
                ← agents
              </button>
            </div>
            <div class="sess-detail-actions">
              <button
                class="vsc-btn"
                title="View the interactive message transcript in a floating window"
                @click="fileViewers.openTranscript(pickedSession.provider, pickedSession.id)"
              >
                ≡ transcript
              </button>
              <button
                class="vsc-btn"
                @click="router.push(`/blueprint/${pickedSession.provider}/${pickedSession.id}`)"
              >
                ⌗ blueprint
              </button>
              <button
                class="vsc-btn"
                title="Interactive diagram of which prompts grew the context window"
                @click="router.push(`/growth/${pickedSession.provider}/${pickedSession.id}`)"
              >
                <GrowthMark class="vsc-growth-mark" /> growth
              </button>
              <button class="vsc-btn" @click="sessionToWorkflow(pickedSession)">
                → workflow
              </button>
              <button
                class="vsc-btn"
                :class="{ toggled: compareFrom }"
                :title="compareFrom ? 'Cancel compare' : 'Pick a second session to diff against this one'"
                @click="toggleCompare"
              >
                ⇆ {{ compareFrom ? "cancel compare" : "compare" }}
              </button>
              <button
                class="vsc-btn"
                title="Distill or excerpt this session's context and start another agent with it — cross-tool handoff in one step"
                @click="emitHandoff(pickedSession!)"
              >
                ⇄ hand off
              </button>
              <button
                class="vsc-btn"
                :title="
                  isSessionFavorite(pickedSession)
                    ? 'Remove from favorites'
                    : 'Add to favorites'
                "
                @click="toggleSessionFavorite(pickedSession)"
              >
                {{ isSessionFavorite(pickedSession) ? "☆ unfavorite" : "★ favorite" }}
              </button>
            </div>
            <p v-if="compareFrom" class="compare-hint mono">
              comparing "{{ compareFrom.title ?? shortId(compareFrom.id) }}" — click the
              second session in the list
            </p>
            <SessionInfoPanel
              :provider="pickedSession.provider"
              :session-id="pickedSession.id"
              :seed="pickedSession"
              @open-parent="openParentSession(pickedSession)"
            />
          </aside>

          <DetailExpandModal
            :open="!!pickedSession && detailExpanded"
            :label="pickedSession?.title ?? (pickedSession ? shortId(pickedSession.id) : 'Session')"
            @close="detailExpanded = false"
          >
            <template v-if="pickedSession">
              <div class="sess-detail-head">
                <div class="sess-detail-titles">
                  <div class="sess-detail-title" :title="pickedSession.title">
                    {{ pickedSession.title ?? shortId(pickedSession.id) }}
                  </div>
                  <div class="sess-detail-meta mono">
                    <SessionLivePill
                    :status="pickedLiveStatus"
                    :phase="
                      pickedSession
                        ? phaseForSession(pickedSession.provider, pickedSession.id)
                        : undefined
                    "
                  />
                    <span
                      v-if="pickedSession.kind === 'subagent-run' || pickedSession.parentId"
                      class="inst-sub micro-label"
                    >sub</span>
                    <span v-if="pickedSession.agent" class="sess-detail-agent">
                      ⟨/⟩ {{ pickedSession.agent }}
                    </span>
                  </div>
                </div>
                <DetailExpandControls hide-expand @close="detailExpanded = false" />
              </div>
              <SessionInfoPanel
                :provider="pickedSession.provider"
                :session-id="pickedSession.id"
                :seed="pickedSession"
                @open-parent="openParentSession(pickedSession)"
              />
            </template>
          </DetailExpandModal>
        </div>
          </template>
        </div>

    <Teleport to="body">
      <div
        v-if="sessCtx"
        class="menu-pop wf-folder-ctx"
        :style="{ left: sessCtx.x + 'px', top: sessCtx.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              fileViewers.openTranscript(sessCtx!.session.provider, sessCtx!.session.id),
            )
          "
        >
          <span class="menu-glyph">≡</span> Transcript
        </button>
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              router.push(`/blueprint/${sessCtx!.session.provider}/${sessCtx!.session.id}`),
            )
          "
        >
          <span class="menu-glyph">⌗</span> Blueprint
        </button>
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              router.push(`/growth/${sessCtx!.session.provider}/${sessCtx!.session.id}`),
            )
          "
        >
          <span class="menu-glyph"><GrowthMark /></span> Growth
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => sessionToWorkflow(sessCtx!.session))"
        >
          <span class="menu-glyph">→</span> Workflow
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => startCompareFrom(sessCtx!.session))"
        >
          <span class="menu-glyph">⇆</span> Compare
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => emitHandoff(sessCtx!.session))"
        >
          <span class="menu-glyph">⇄</span> Hand off
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => settings.openPath(sessCtx!.session.projectDir))"
        >
          <span class="menu-glyph">⟨/⟩</span> Open in {{ settings.editorLabel }}
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => downloadSessionBundle(sessCtx!.session))"
        >
          <span class="menu-glyph">⇓</span> Download bundle
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => toggleSessionFavorite(sessCtx!.session))"
        >
          <span class="menu-glyph">{{
            isSessionFavorite(sessCtx!.session) ? "☆" : "★"
          }}</span>
          {{
            isSessionFavorite(sessCtx!.session)
              ? "Remove from favorites"
              : "Add to favorites"
          }}
        </button>
      </div>
    </Teleport>

</template>

<script setup lang="ts">

import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { SessionRef } from "@threadle/shared";
import { isPilotSession, isSessionLive } from "@threadle/shared";
import { api } from "@/api/client";
import { relativeTime, shortId, fmtTokens } from "@/lib/format";
import {
  type SessionFilter,
  providerColor,
} from "@/lib/providers";
import { useSessionsStore } from "@/stores/sessions";
import { useSettingsStore } from "@/stores/settings";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useFavoritesStore } from "@/stores/favorites";
import { downloadUrl, sessionsToWorkflow } from "@/lib/convert";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import SessionInfoPanel from "@/panels/SessionInfoPanel.vue";
import SessionLivePill from "@/panels/SessionLivePill.vue";
import GrowthMark from "@/panels/GrowthMark.vue";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import DetailExpandModal from "@/panels/DetailExpandModal.vue";
import { useJobPhases } from "@/lib/useJobPhases";
import "./chrome.css";

export type SessionOpenRequest = {
  session: SessionRef;
  fromAgents?: boolean;
};

const props = defineProps<{
  providerFilter: SessionFilter;
  openRequest?: SessionOpenRequest | null;
}>();

const emit = defineEmits<{
  "update:providerFilter": [v: SessionFilter];
  "update:openRequest": [v: SessionOpenRequest | null];
  nav: [id: string];
  handoff: [session: SessionRef];
}>();

const router = useRouter();
const route = useRoute();
const sessions = useSessionsStore();
const settings = useSettingsStore();
const fileViewers = useFileViewersStore();
const favorites = useFavoritesStore();
void favorites.ensureLoaded();
const { phaseForSession } = useJobPhases();

function sessionFavoriteInput(s: SessionRef) {
  return {
    kind: "session" as const,
    provider: s.provider,
    sessionId: s.id,
    label: s.title ?? undefined,
  };
}
function isSessionFavorite(s: SessionRef): boolean {
  return favorites.isFavorite(sessionFavoriteInput(s));
}
function toggleSessionFavorite(s: SessionRef): void {
  void favorites.toggle(sessionFavoriteInput(s));
}

/** First hydrate only — keep list if pinia already has sessions. */
const listLoading = computed(
  () => sessions.loading && !sessions.sessions.length,
);

/** Only chips for providers that are connected or have sessions here. */
const providerFilterChips = computed(() => {
  const chips = [...sessions.sessionFilterChips];
  if (
    props.providerFilter !== "all" &&
    !chips.includes(props.providerFilter)
  ) {
    chips.push(props.providerFilter);
  }
  return chips;
});

watch(providerFilterChips, (chips) => {
  if (!chips.includes(props.providerFilter)) emit("update:providerFilter", "all");
});

const providerFilter = computed({
  get: () => props.providerFilter,
  set: (v) => emit("update:providerFilter", v),
});


const sessionFilter = ref("");
watch(
  () => route.query.q,
  (q) => {
    if (typeof q === "string") sessionFilter.value = q;
  },
  { immediate: true },
);

// ---- sessions view ----

const sessionSort = ref<"updated" | "messages" | "tokens" | "title">("updated");

const SESSION_SORTERS: Record<string, (a: SessionRef, b: SessionRef) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  messages: (a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0),
  tokens: (a, b) => (b.tokensOut ?? 0) - (a.tokensOut ?? 0),
  title: (a, b) => (a.title ?? "").localeCompare(b.title ?? ""),
};

const activeOnly = ref(false);
/** When false (default), hide Settings test-pilot smokes. When true, only those. */
const showPilot = ref(false);
const liveSessionCount = computed(
  () => sessions.sessions.filter((s) => isSessionLive(s.status)).length,
);
const pilotSessionCount = computed(
  () => sessions.sessions.filter((s) => isPilotSession(s)).length,
);

const filteredSessions = computed((): SessionRef[] => {
  const q = sessionFilter.value.toLowerCase();
  return sessions.sessions.filter(
    (s) =>
      (!activeOnly.value || isSessionLive(s.status)) &&
      (showPilot.value ? isPilotSession(s) : !isPilotSession(s)) &&
      (providerFilter.value === "all" || s.provider === providerFilter.value) &&
      (!q ||
        s.title?.toLowerCase().includes(q) ||
        s.projectDir.toLowerCase().includes(q) ||
        s.agent?.toLowerCase().includes(q)),
  );
});

/** Year chart: same filters as the list, but always includes both actual + test. */
const heatBaseSessions = computed((): SessionRef[] => {
  const q = sessionFilter.value.toLowerCase();
  return sessions.sessions.filter(
    (s) =>
      (!activeOnly.value || isSessionLive(s.status)) &&
      (providerFilter.value === "all" || s.provider === providerFilter.value) &&
      (!q ||
        s.title?.toLowerCase().includes(q) ||
        s.projectDir.toLowerCase().includes(q) ||
        s.agent?.toLowerCase().includes(q)),
  );
});

/** Sessions shown in the list — optional heat-day pin (any session open that day) */
const listedSessions = computed((): SessionRef[] => {
  const day = heatDay.value;
  if (!day) return filteredSessions.value;
  return filteredSessions.value.filter((s) => sessionTouchesDay(s, day));
});

const sessionGroups = computed(() => {
  const matching = [...listedSessions.value].sort(SESSION_SORTERS[sessionSort.value]);
  const groups = new Map<string, SessionRef[]>();
  for (const s of matching) {
    const dir = s.projectDir || "(unknown)";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(s);
  }
  return [...groups.entries()]
    .map(([dir, list]) => ({ dir, sessions: list }))
    .sort((a, b) => (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0));
});

/** Local calendar day key YYYY-MM-DD */
function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday-based weekday 0..6 (Mon=0 … Sun=6) */
function mondayIndex(ts: number): number {
  const dow = new Date(ts).getDay(); // Sun=0
  return dow === 0 ? 6 : dow - 1;
}

/** Inclusive [createdAt, updatedAt] day range — days the session was open / used. */
function sessionDayRange(s: SessionRef): { start: string; end: string } | null {
  if (!s.updatedAt) return null;
  const end = dayKey(s.updatedAt);
  const start = s.createdAt ? dayKey(s.createdAt) : end;
  return start <= end ? { start, end } : { start: end, end: start };
}

function sessionTouchesDay(s: SessionRef, day: string): boolean {
  const r = sessionDayRange(s);
  return !!r && day >= r.start && day <= r.end;
}

/** Walk each local calendar day the session spans (capped). */
function forEachSessionDay(s: SessionRef, cb: (key: string) => void): void {
  const r = sessionDayRange(s);
  if (!r) return;
  const [ys, ms, ds] = r.start.split("-").map(Number);
  const [ye, me, de] = r.end.split("-").map(Number);
  if (!ys || !ms || !ds || !ye || !me || !de) return;
  const cur = new Date(ys, ms - 1, ds);
  const last = new Date(ye, me - 1, de);
  let n = 0;
  while (cur <= last && n < 400) {
    cb(dayKey(cur.getTime()));
    cur.setDate(cur.getDate() + 1);
    n += 1;
  }
}

interface HeatCell {
  key: string;
  level: 0 | 1 | 2 | 3 | 4;
  title: string;
  /** Past/today in the selected year — clickable */
  inRange: boolean;
  /** Calendar day belongs to the selected year (not pad days) */
  inYear: boolean;
  count: number;
}

const heatYear = ref(new Date().getFullYear());
const heatDay = ref<string | null>(null);

const heatDayLabel = computed(() => {
  const k = heatDay.value;
  if (!k) return "";
  const [y, m, d] = k.split("-").map(Number);
  if (!y || !m || !d) return k;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
});

function toggleHeatDay(cell: HeatCell): void {
  if (!cell.inRange) return;
  heatDay.value = heatDay.value === cell.key ? null : cell.key;
}

const heatYears = computed(() => {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const s of sessions.sessions) {
    if (s.updatedAt) years.add(new Date(s.updatedAt).getFullYear());
    if (s.createdAt) years.add(new Date(s.createdAt).getFullYear());
  }
  return [...years].sort((a, b) => b - a);
});

watch(heatYears, (ys) => {
  if (!ys.includes(heatYear.value)) heatYear.value = ys[0] ?? new Date().getFullYear();
});

watch(heatYear, () => {
  heatDay.value = null;
});

/** Heatmap tint: provider color when filtered to one provider, otherwise mono text. */
const heatAccent = computed(() =>
  providerFilter.value === "all" ? "var(--text)" : providerColor(providerFilter.value),
);

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sessionHeat = computed(() => {
  const year = heatYear.value;
  const yearPrefix = `${year}-`;
  const today = startOfLocalDay(Date.now());
  const testMode = showPilot.value;
  const actualCounts = new Map<string, number>();
  const testCounts = new Map<string, number>();
  const weights = new Map<string, number>();
  let sessInYear = 0;

  for (const s of heatBaseSessions.value) {
    if (!s.updatedAt) continue;
    const isTest = isPilotSession(s);
    // Heat / year totals follow the list filter: actual by default, tests when ✦ test is on.
    const contributesHeat = testMode ? isTest : !isTest;
    const w = contributesHeat
      ? Math.max(1, Math.min(20, Math.ceil((s.messageCount ?? 0) / 50) || 1))
      : 0;
    let touchesYear = false;
    const days: string[] = [];
    forEachSessionDay(s, (k) => {
      days.push(k);
      if (k.startsWith(yearPrefix)) touchesYear = true;
    });
    if (!touchesYear) continue;
    if (contributesHeat) sessInYear += 1;
    const dayN = days.length || 1;
    const perDay = w > 0 ? Math.max(1, Math.round(w / dayN)) : 0;
    for (const k of days) {
      if (!k.startsWith(yearPrefix)) continue;
      if (isTest) testCounts.set(k, (testCounts.get(k) ?? 0) + 1);
      else actualCounts.set(k, (actualCounts.get(k) ?? 0) + 1);
      if (perDay > 0) weights.set(k, (weights.get(k) ?? 0) + perDay);
    }
  }

  // Walk real local calendar days — never add 86400000 (DST shifts break that).
  const start = new Date(year, 0, 1);
  start.setDate(start.getDate() - mondayIndex(start.getTime()));
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, 11, 31);
  end.setDate(end.getDate() + (6 - mondayIndex(end.getTime())));
  end.setHours(0, 0, 0, 0);

  const todayKey = dayKey(today);
  const weeks: HeatCell[][] = [];
  let max = 0;
  const raw: {
    key: string;
    weight: number;
    sessions: number;
    tests: number;
    ts: number;
    inRange: boolean;
    inYear: boolean;
  }[] = [];

  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const ts = cur.getTime();
    const key = dayKey(ts);
    const inYear = cur.getFullYear() === year;
    const inRange = inYear && key <= todayKey;
    const weight = inYear ? (weights.get(key) ?? 0) : 0;
    const sessionsN = inYear ? (actualCounts.get(key) ?? 0) : 0;
    const testsN = inYear ? (testCounts.get(key) ?? 0) : 0;
    if (inRange && weight > max) max = weight;
    raw.push({
      key,
      weight,
      sessions: sessionsN,
      tests: testsN,
      ts,
      inRange,
      inYear,
    });
    cur.setDate(cur.getDate() + 1);
  }

  const weekCount = raw.length / 7;

  const levelOf = (n: number): 0 | 1 | 2 | 3 | 4 => {
    if (n <= 0 || max <= 0) return 0;
    const r = n / max;
    if (r <= 0.2) return 1;
    if (r <= 0.4) return 2;
    if (r <= 0.7) return 3;
    return 4;
  };

  function heatTitle(actual: number, tests: number, date: string): string {
    if (testMode) {
      const testPart =
        tests === 0
          ? "No test sessions"
          : `${tests} test session${tests === 1 ? "" : "s"}`;
      if (actual <= 0) return `${testPart} · ${date}`;
      return `${testPart} (${actual} session${actual === 1 ? "" : "s"}) · ${date}`;
    }
    const actualPart =
      actual === 0
        ? "No sessions"
        : `${actual} session${actual === 1 ? "" : "s"}`;
    if (tests <= 0) return `${actualPart} · ${date}`;
    return `${actualPart} (${tests} test session${tests === 1 ? "" : "s"}) · ${date}`;
  }

  for (let w = 0; w < weekCount; w++) {
    const week: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = raw[w * 7 + d]!;
      const level = cell.inRange ? levelOf(cell.weight) : 0;
      const date = new Date(cell.ts).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      let title = "";
      if (cell.inRange) {
        title = heatTitle(cell.sessions, cell.tests, date);
      } else if (cell.inYear) {
        title = date;
      }
      week.push({
        key: cell.key,
        level,
        inRange: cell.inRange,
        inYear: cell.inYear,
        count: testMode ? cell.tests : cell.sessions,
        title,
      });
    }
    weeks.push(week);
  }

  const monthLabels = Array.from({ length: weekCount }, () => "");
  for (let m = 0; m < 12; m++) {
    const firstKey = `${year}-${String(m + 1).padStart(2, "0")}-01`;
    const di = raw.findIndex((c) => c.key === firstKey);
    if (di < 0) continue;
    const wi = Math.floor(di / 7);
    if (!monthLabels[wi]) monthLabels[wi] = MONTH_SHORT[m]!;
  }

  const inYearCells = raw.filter((c) => c.inYear && c.inRange);
  const activeDays = inYearCells.filter((c) =>
    testMode ? c.tests > 0 : c.sessions > 0,
  ).length;

  // Year totals for the header — match the active list filter (actual vs test).
  let msgs = 0;
  let tokensIn = 0;
  let out = 0;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  for (const s of heatBaseSessions.value) {
    if (testMode ? !isPilotSession(s) : isPilotSession(s)) continue;
    const r = sessionDayRange(s);
    if (!r || r.end < yearStart || r.start > yearEnd) continue;
    msgs += s.messageCount ?? 0;
    tokensIn += s.tokensIn ?? 0;
    out += s.tokensOut ?? 0;
  }

  return {
    weeks,
    cells: raw,
    weekCount,
    monthLabels,
    sessInYear,
    activeDays,
    msgsLabel: msgs ? fmtTokens(msgs) : "—",
    inLabel: tokensIn ? fmtTokens(tokensIn) : "—",
    outLabel: out ? fmtTokens(out) : "—",
  };
});

const expandedKey = ref<string>();
const childrenCache = reactive(new Map<string, SessionRef[] | "loading" | "none">());

function key(s: SessionRef): string {
  return `${s.provider}:${s.id}`;
}

function childState(s: SessionRef): "unknown" | "loading" | "none" | "loaded" {
  const c = childrenCache.get(key(s));
  if (c === undefined) return "unknown";
  if (c === "loading") return "loading";
  if (c === "none" || c.length === 0) return "none";
  return "loaded";
}

function childrenOf(s: SessionRef): SessionRef[] {
  const c = childrenCache.get(key(s));
  if (!Array.isArray(c)) return [];
  return [...c].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function storeChildren(k: string, children: SessionRef[]): void {
  if (!children.length) {
    childrenCache.set(k, "none");
    return;
  }
  childrenCache.set(
    k,
    [...children].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
  );
}

async function toggleChildren(s: SessionRef): Promise<void> {
  const k = key(s);
  if (expandedKey.value === k) {
    expandedKey.value = undefined;
    return;
  }
  expandedKey.value = k;
  if (childrenCache.has(k)) return;
  childrenCache.set(k, "loading");
  try {
    storeChildren(k, await api.children(s.provider, s.id));
  } catch {
    childrenCache.set(k, "none");
  }
}

const sessionFromAgents = ref(false);


async function ensureChildrenExpanded(parent: SessionRef): Promise<void> {
  const k = key(parent);
  expandedKey.value = k;
  if (childrenCache.has(k) && childrenCache.get(k) !== "loading") return;
  childrenCache.set(k, "loading");
  try {
    storeChildren(k, await api.children(parent.provider, parent.id));
  } catch {
    childrenCache.set(k, "none");
  }
}

function openParentSession(child: SessionRef): void {
  if (!child.parentId) return;
  const parent = sessions.sessions.find(
    (p) => p.provider === child.provider && p.id === child.parentId,
  );
  if (parent) {
    pickedSession.value = parent;
    void ensureChildrenExpanded(parent);
    return;
  }
  pickedSession.value = {
    provider: child.provider,
    id: child.parentId,
    projectDir: child.projectDir,
    updatedAt: child.updatedAt,
    status: "unknown",
    kind: "session",
  };
}

function closePickedSession(): void {
  const cur = pickedSession.value;
  if (cur?.parentId) {
    if (expandedKey.value === `${cur.provider}:${cur.parentId}`) {
      expandedKey.value = undefined;
    }
  } else if (cur && expandedKey.value === key(cur)) {
    expandedKey.value = undefined;
  }
  pickedSession.value = undefined;
  detailExpanded.value = false;
  compareFrom.value = undefined;
  sessionFromAgents.value = false;
}

// ---- session detail panel ----

const pickedSession = ref<SessionRef>();
const compareFrom = ref<SessionRef>();
const detailExpanded = ref(false);

/** Always read live status from the store — pickedSession can be a stale snapshot after refresh. */
const pickedLiveStatus = computed(() => {
  const p = pickedSession.value;
  if (!p) return undefined;
  return sessions.find(p.provider, p.id)?.status ?? p.status;
});

/** Keep the detail panel attached to the current store object after refresh. */
watch(
  () => sessions.sessions,
  () => {
    const p = pickedSession.value;
    if (!p) return;
    const fresh = sessions.find(p.provider, p.id);
    if (fresh && fresh !== p) pickedSession.value = fresh;
  },
);

function pickSession(s: SessionRef): void {
  // compare mode: the next clicked session becomes side B of the diff
  if (compareFrom.value && compareFrom.value.id !== s.id) {
    const from = compareFrom.value;
    compareFrom.value = undefined;
    void router.push({
      path: "/diff",
      query: { a: `${from.provider}::${from.id}`, b: `${s.provider}::${s.id}` },
    });
    return;
  }
  sessionFromAgents.value = false;
  if (pickedSession.value?.id === s.id) {
    // collapse detail + nested runs
    if (s.parentId) {
      if (expandedKey.value === `${s.provider}:${s.parentId}`) {
        expandedKey.value = undefined;
      }
    } else if (expandedKey.value === key(s)) {
      expandedKey.value = undefined;
    }
    pickedSession.value = undefined;
    detailExpanded.value = false;
    return;
  }
  pickedSession.value = s;
  detailExpanded.value = false;
  // reveal nested runs under the parent (caret was removed; expand on select)
  if (!s.parentId && s.kind !== "subagent-run") {
    void ensureChildrenExpanded(s);
  } else if (s.parentId) {
    const parent = sessions.sessions.find(
      (p) => p.provider === s.provider && p.id === s.parentId,
    );
    if (parent) void ensureChildrenExpanded(parent);
  }
}

function toggleCompare(): void {
  compareFrom.value = compareFrom.value ? undefined : pickedSession.value;
}

function startCompareFrom(s: SessionRef): void {
  pickSession(s);
  compareFrom.value = s;
}

let sessCtxIgnoreClick = false;
const sessCtx = ref<{ session: SessionRef; x: number; y: number }>();
const openMenu = ref<string>();

function openSessionCtxMenu(e: MouseEvent, session: SessionRef): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  openMenu.value = undefined;
  const pad = 8;
  const w = 260;
  const h = 280;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  sessCtxIgnoreClick = true;
  sessCtx.value = { session, x: Math.max(pad, x), y: Math.max(pad, y) };
  window.setTimeout(() => {
    sessCtxIgnoreClick = false;
  }, 400);
}

function onSessionRowMouseDown(e: MouseEvent, session: SessionRef): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openSessionCtxMenu(e, session);
}

function toggleMenu(s: SessionRef): void {
  sessCtx.value = undefined;
  openMenu.value = openMenu.value === key(s) ? undefined : key(s);
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    openMenu.value = undefined;
    sessCtx.value = undefined;
  }
}

function onDocClick(e: MouseEvent): void {
  if (sessCtxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".row-menu") && !t.closest?.(".wf-folder-ctx")) {
    openMenu.value = undefined;
    sessCtx.value = undefined;
  }
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

async function downloadSessionBundle(s: SessionRef): Promise<void> {
  try {
    await downloadUrl(
      `/api/sessions/${s.provider}/bundle/${s.id}`,
      `threadle-bundle-${shortId(s.id).replace("…", "")}.json`,
    );
  } catch (err) {
    alert(`Bundle failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function downloadProjectBundle(dir: string): Promise<void> {
  try {
    await downloadUrl(
      `/api/bundle/project?dir=${encodeURIComponent(dir)}`,
      `threadle-project-${dir.split("/").filter(Boolean).pop() ?? "bundle"}.json`,
    );
  } catch (err) {
    alert(`Bundle failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function sessionToWorkflow(s: SessionRef): Promise<void> {
  try {
    const id = await sessionsToWorkflow(
      `${s.title ?? shortId(s.id)} (from session)`,
      [s],
    );
    await router.push(`/graph/${id}`);
  } catch (err) {
    alert(`Convert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function projectToWorkflow(group: { dir: string; sessions: SessionRef[] }): Promise<void> {
  try {
    const name = group.dir.split("/").filter(Boolean).pop() ?? "project";
    const id = await sessionsToWorkflow(`${name} (project)`, group.sessions);
    await router.push(`/graph/${id}`);
  } catch (err) {
    alert(`Convert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}


function emitHandoff(s: SessionRef): void {
  emit("handoff", s);
}

function backToAgents(): void {
  sessionFromAgents.value = false;
  emit("nav", "agents");
}

watch(
  () => props.openRequest,
  (req) => {
    if (!req) return;
    sessionFromAgents.value = !!req.fromAgents;
    void focusSession(req.session);
    emit("update:openRequest", null);
  },
  { immediate: true },
);

async function focusSession(s: SessionRef): Promise<void> {
  pickedSession.value = s;
  if (s.parentId) {
    const parent = sessions.sessions.find(
      (p) => p.provider === s.provider && p.id === s.parentId,
    );
    if (parent) await ensureChildrenExpanded(parent);
  } else if (s.kind !== "subagent-run") {
    await ensureChildrenExpanded(s);
  }
}


</script>

<style scoped>
.sess-chrome {
  margin: -32px -36px 24px;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.sess-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.sess-agent {
  width: 88px;
}
.sess-model {
  width: 132px;
}
.sess-msgs {
  width: 72px;
  font-variant-numeric: tabular-nums;
}
.sess-time {
  width: 64px;
}
.sess-pilot-mark {
  display: inline-block;
  margin-right: 6px;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
}
.sess-row:hover .sess-pilot-mark,
.sess-row.picked .sess-pilot-mark {
  color: var(--text-dim);
}
.compare-hint {
  margin: 6px 0 0;
  font-size: var(--fs-2xs);
  color: var(--status-waiting);
}
.sess-heatmap {
  margin: 0 0 20px;
  padding: 12px 14px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  max-width: 100%;
}
.sess-heat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  min-width: 0;
  height: 24px;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.sess-heat-summary {
  display: flex;
  flex-wrap: nowrap;
  align-items: baseline;
  gap: 14px;
  min-width: 0;
  overflow: hidden;
}
.sess-heat-kv {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
  flex-shrink: 0;
}
.sess-heat-k {
  color: var(--text-faint);
}
.sess-heat-v {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  min-width: 3.5ch;
}
.sess-heat-v-day {
  min-width: 8.5ch;
}
.sess-heat-day-slot {
  display: inline-flex;
  align-items: baseline;
  visibility: hidden;
  pointer-events: none;
  flex-shrink: 0;
  min-width: 11rem;
}
.sess-heat-day-slot.on {
  visibility: visible;
  pointer-events: auto;
}
.sess-heat-day-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.sess-heat-day-chip:hover:not(:disabled) .sess-heat-v {
  color: var(--text);
}
.sess-heat-day-chip:disabled {
  cursor: default;
}
.sess-heat-right {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.sess-heat-year {
  width: auto;
  min-width: 4.5rem;
  height: 24px;
  padding: 0 6px;
  font-size: var(--fs-xs);
}
.sess-heat-body {
  display: flex;
  gap: 14px;
  align-items: stretch;
  min-width: 0;
  width: 100%;
}
.sess-heat-dows {
  display: grid;
  grid-template-rows: 14px repeat(7, 1fr);
  gap: 2px;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  line-height: 1;
  flex-shrink: 0;
  height: 114px; /* 14 month + 2 gap + 98 grid */
  box-sizing: border-box;
}
.sess-heat-dow-spacer {
  display: block;
  height: 14px;
}
.sess-heat-scroll {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 0;
  padding-bottom: 2px;
  display: flex;
  flex-direction: column;
}
.sess-heat-months {
  display: flex;
  gap: 2px;
  height: 14px;
  margin-bottom: 2px;
  color: var(--text-faint);
  font-size: var(--fs-2xs);
  line-height: 14px;
  width: 100%;
}
.sess-heat-month {
  flex: 1 1 0;
  min-width: 0;
  overflow: visible;
  white-space: nowrap;
}
.sess-heat-grid {
  display: flex;
  gap: 2px;
  width: 100%;
  height: 98px;
}
.sess-heat-week {
  flex: 1 1 0;
  min-width: 0;
  display: grid;
  grid-template-rows: repeat(7, 1fr);
  gap: 2px;
}
.sess-heat-cell {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  margin: 0;
  border-radius: 2px;
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.sess-heat-cell.ghost {
  opacity: 0;
  border-color: transparent;
  pointer-events: none;
  cursor: default;
}
.sess-heat-cell.future,
.sess-heat-cell:disabled:not(.ghost) {
  opacity: 1;
  cursor: default;
  pointer-events: none;
}
.sess-heat-cell.selected {
  box-shadow: inset 0 0 0 1.5px var(--heat-accent, var(--text));
  border-color: var(--heat-accent, var(--text));
}
.sess-heat-cell[data-level="0"] {
  background: color-mix(in srgb, var(--text) 6%, transparent);
}
.sess-heat-cell[data-level="1"] {
  background: color-mix(in srgb, var(--heat-accent, var(--text)) 22%, transparent);
  border-color: transparent;
}
.sess-heat-cell[data-level="2"] {
  background: color-mix(in srgb, var(--heat-accent, var(--text)) 42%, transparent);
  border-color: transparent;
}
.sess-heat-cell[data-level="3"] {
  background: color-mix(in srgb, var(--heat-accent, var(--text)) 68%, transparent);
  border-color: transparent;
}
.sess-heat-cell[data-level="4"] {
  background: var(--heat-accent, var(--text));
  border-color: transparent;
}

</style>
