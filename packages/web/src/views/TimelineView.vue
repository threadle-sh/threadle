<template>
  <div class="tl-page">
    <DashNav :items="navItems" active="timeline" @select="goDash" />
    <div class="tl-main">
      <div class="tl-chrome">
        <header class="dash-head">
          <div>
            <h1 class="dash-title">Timeline</h1>
          </div>
          <div class="view-controls">
            <ProviderFilterChips
              v-model="providerF"
              :options="providerFilterChips"
            />
          </div>
        </header>

        <div class="dash-toolbar tl-toolbar">
          <input
            v-model="query"
            class="threadle-input dash-search"
            placeholder="Filter sessions…"
            spellcheck="false"
          />
          <ProjectFilterSelect
            v-model="projectF"
            :options="projectOptions"
            title="Filter by session project directory (cwd)"
          />
          <div class="chip-row">
            <button
              v-for="r in RANGES"
              :key="r.id"
              class="filter-chip"
              :class="{ active: range === r.id }"
              @click="range = r.id"
            >
              {{ r.label }}
            </button>
          </div>
          <div class="chip-row">
            <button class="filter-chip" title="Zoom out (or ctrl/cmd + wheel)" @click="manualZoom(1 / 1.5)">−</button>
            <button class="filter-chip" title="Zoom in (or ctrl/cmd + wheel)" @click="manualZoom(1.5)">+</button>
            <button
              class="filter-chip"
              title="Reset zoom and jump back to now (the newest edge)"
              @click="goNow"
            >⇥ now</button>
          </div>
        </div>
      </div>

      <div class="tl-body-row">
        <div class="tl-scroll-wrap">
          <div
            ref="scrollEl"
            class="tl-scroll"
            :class="{ panning }"
            @wheel="onWheel"
            @mousedown="startPan"
          >
            <div class="tl-canvas" :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }">
              <!-- time gridlines -->
              <div
                v-for="tick in ticks"
                :key="tick.ts"
                class="tl-tick"
                :style="{ left: xOf(tick.ts) + 'px' }"
              >
                <span class="tl-tick-label mono">{{ tick.label }}</span>
              </div>
              <!-- session bars, greedy-packed into rows -->
              <div
                v-for="s in bars"
                :key="s.key"
                class="tl-bar"
                :class="{
                  live: s.running,
                  sel: picked?.id === s.id,
                  ctx: barCtx?.id === s.id && barCtx?.provider === s.provider,
                }"
                :style="{
                  left: s.x + 'px',
                  width: s.w + 'px',
                  top: s.row * ROW_H + 34 + 'px',
                  borderColor: s.color,
                }"
                :title="`${s.title}\n${s.provider} · ${s.agent ?? 'no agent'}${s.projectDir ? ` · ${s.projectDir}` : ''}\n${new Date(s.start).toLocaleString()} → ${new Date(s.end).toLocaleTimeString()}`"
                @click.stop="pickBar(s)"
                @contextmenu.prevent.stop="openBarCtx($event, s)"
                @mousedown="onBarMouseDown($event, s)"
              >
                <span class="tl-dot" :style="{ background: s.color }" />
                <span class="tl-bar-label">{{ s.title }}</span>
              </div>
            </div>
          </div>
          <GraphLoadingOverlay
            :loading="timelineLoading"
            label="Loading timeline"
          />
          <div
            v-if="!timelineLoading && !visible.length"
            class="tl-overlay-msg"
          >
            {{
              query.trim() || projectF !== "all" || providerF !== "all"
                ? "no sessions match these filters"
                : "no sessions yet"
            }}
          </div>
        </div>

        <aside v-if="picked" class="tl-detail">
          <div class="tl-detail-head">
            <span class="tl-detail-title" :title="picked.title">{{ picked.title }}</span>
            <button class="tl-close" @click="picked = undefined">✕</button>
          </div>
          <div class="tl-detail-actions">
            <button
              class="vsc-btn"
              title="View the interactive message transcript in a floating window"
              @click="fileViewers.openTranscript(picked.provider, picked.id)"
            >
              ≡ transcript
            </button>
            <button
              class="vsc-btn"
              @click="router.push(`/blueprint/${picked.provider}/${picked.id}?from=timeline`)"
            >
              ⌗ blueprint
            </button>
            <button
              class="vsc-btn"
              @click="router.push({ path: '/lineage', query: { focus: `${picked.provider}:${picked.id}` } })"
            >
              ⇄ lineage
            </button>
            <button
              class="vsc-btn"
              @click="router.push({ path: '/', query: { view: 'sessions' } })"
            >
              ❯ sessions view
            </button>
            <button
              class="vsc-btn"
              :title="
                isBarFavorite(picked) ? 'Remove from favorites' : 'Add to favorites'
              "
              @click="toggleBarFavorite(picked)"
            >
              {{ isBarFavorite(picked) ? "☆ unfavorite" : "★ favorite" }}
            </button>
          </div>
          <SessionInfoPanel :provider="picked.provider" :session-id="picked.id" />
        </aside>
      </div>
    <StatusBar />
    </div>

    <Teleport to="body">
      <div
        v-if="barCtx"
        class="menu-pop wf-folder-ctx"
        :style="{ left: barCtx.x + 'px', top: barCtx.y + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <button
          class="menu-item"
          @click="menuAction(() => pickBar(barCtx!))"
        >
          <span class="menu-glyph">↗</span> Details
        </button>
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              fileViewers.openTranscript(barCtx!.provider, barCtx!.id),
            )
          "
        >
          <span class="menu-glyph">≡</span> Transcript
        </button>
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              router.push(`/blueprint/${barCtx!.provider}/${barCtx!.id}?from=timeline`),
            )
          "
        >
          <span class="menu-glyph">⌗</span> Blueprint
        </button>
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              router.push({
                path: '/lineage',
                query: { focus: `${barCtx!.provider}:${barCtx!.id}` },
              }),
            )
          "
        >
          <span class="menu-glyph">⇄</span> Lineage
        </button>
        <button
          class="menu-item"
          @click="
            menuAction(() =>
              router.push({ path: '/', query: { view: 'sessions' } }),
            )
          "
        >
          <span class="menu-glyph">❯</span> Sessions view
        </button>
        <button
          class="menu-item"
          @click="menuAction(() => toggleBarFavorite(barCtx!))"
        >
          <span class="menu-glyph">{{ isBarFavorite(barCtx!) ? "☆" : "★" }}</span>
          {{
            isBarFavorite(barCtx!)
              ? "Remove from favorites"
              : "Add to favorites"
          }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DashNav from "@/panels/DashNav.vue";
import StatusBar from "@/panels/StatusBar.vue";
import SessionInfoPanel from "@/panels/SessionInfoPanel.vue";
import { useNavItems } from "@/panels/useNavItems";
import { useSessionsStore } from "@/stores/sessions";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useFavoritesStore } from "@/stores/favorites";
import { isSessionLive } from "@threadle/shared";
import {
  type SessionFilter,
  providerColorHex,
} from "@/lib/providers";
import ProviderFilterChips from "@/components/ProviderFilterChips.vue";
import ProjectFilterSelect from "@/components/ProjectFilterSelect.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import "@/views/dashboard/chrome.css";

const RANGES = [
  { id: "24h", label: "24h", ms: 24 * 3_600_000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 3_600_000 },
  { id: "30d", label: "30d", ms: 30 * 24 * 3_600_000 },
  { id: "all", label: "all", ms: Infinity },
] as const;

const ROW_H = 34;
const MIN_BAR_MS = 5 * 60_000; // a quick session still gets a visible bar

const router = useRouter();
const sessions = useSessionsStore();
const fileViewers = useFileViewersStore();
const favorites = useFavoritesStore();
const navItems = useNavItems();
sessions.ensureHydrated();
void favorites.ensureLoaded();

type PickedSession = {
  provider: string;
  id: string;
  title: string;
  projectDir?: string;
};

interface Bar {
  key: string;
  id: string;
  provider: string;
  title: string;
  agent?: string;
  projectDir?: string;
  start: number;
  end: number;
  x: number;
  w: number;
  row: number;
  color: string;
  running: boolean;
}

function sessionFavoriteInput(s: { provider: string; id: string; title?: string }) {
  return {
    kind: "session" as const,
    provider: s.provider,
    sessionId: s.id,
    label: s.title,
  };
}
function isBarFavorite(s: { provider: string; id: string }): boolean {
  return favorites.isFavorite(sessionFavoriteInput(s));
}
function toggleBarFavorite(s: { provider: string; id: string; title?: string }): void {
  void favorites.toggle(sessionFavoriteInput(s));
}

function pickBar(s: {
  provider: string;
  id: string;
  title: string;
  projectDir?: string;
}): void {
  picked.value = {
    provider: s.provider,
    id: s.id,
    title: s.title,
    projectDir: s.projectDir,
  };
}

const barCtx = ref<(PickedSession & { x: number; y: number })>();
let barCtxIgnoreClick = false;

function openBarCtx(e: MouseEvent, s: Bar): void {
  e.preventDefault();
  e.stopPropagation();
  window.getSelection()?.removeAllRanges();
  pickBar(s);
  const pad = 8;
  const w = 260;
  const h = 260;
  const x = Math.min(e.clientX, window.innerWidth - w - pad);
  const y = Math.min(e.clientY, window.innerHeight - h - pad);
  barCtxIgnoreClick = true;
  barCtx.value = {
    provider: s.provider,
    id: s.id,
    title: s.title,
    projectDir: s.projectDir,
    x: Math.max(pad, x),
    y: Math.max(pad, y),
  };
  window.setTimeout(() => {
    barCtxIgnoreClick = false;
  }, 400);
}

function onBarMouseDown(e: MouseEvent, s: Bar): void {
  window.getSelection()?.removeAllRanges();
  if (e.button !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  openBarCtx(e, s);
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    barCtx.value = undefined;
  }
}

function onDocClick(e: MouseEvent): void {
  if (barCtxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".wf-folder-ctx")) barCtx.value = undefined;
}

/** First load only — keep bars if pinia already has sessions from another view. */
const timelineLoading = computed(
  () => sessions.loading && !sessions.sessions.length,
);

const range = ref<(typeof RANGES)[number]["id"]>("7d");
const providerF = ref<SessionFilter>("all");
const projectF = ref<string>("all");

const providerFilterChips = computed(() => sessions.sessionFilterChips);
watch(providerFilterChips, (chips) => {
  if (!chips.includes(providerF.value)) providerF.value = "all";
});
const zoom = ref(1);
const scrollEl = ref<HTMLElement>();
let userTouched = false;
const query = ref("");
const picked = ref<{ provider: string; id: string; title: string; projectDir?: string }>();

function projectLabel(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

/** Distinct project dirs (session cwd), newest activity first. */
const projectOptions = computed(() => {
  const latest = new Map<string, number>();
  for (const s of sessions.sessions) {
    if (s.kind === "subagent-run") continue;
    const dir = s.projectDir?.trim();
    if (!dir || dir === "(unknown)") continue;
    const ts = s.updatedAt ?? s.createdAt ?? 0;
    latest.set(dir, Math.max(latest.get(dir) ?? 0, ts));
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

function zoomBy(factor: number, anchorClientX?: number): void {
  const el = scrollEl.value;
  const next = Math.min(12, Math.max(0.1, zoom.value * factor));
  if (next === zoom.value) return;
  const ratio = next / zoom.value;
  // keep the time under the anchor (or viewport center) fixed while zooming
  const anchor = el
    ? (anchorClientX ?? el.getBoundingClientRect().left + el.clientWidth / 2) -
      el.getBoundingClientRect().left
    : 0;
  const before = (el?.scrollLeft ?? 0) + anchor;
  zoom.value = next;
  void nextTick(() => {
    if (el) el.scrollLeft = before * ratio - anchor;
  });
}

/** reset zoom to the selected window and jump back to now */
function goNow(): void {
  zoom.value = 1;
  void nextTick(scrollToNow);
}

/** jump the viewport to the newest edge — "now" sits at the right */
function scrollToNow(): void {
  const el = scrollEl.value;
  if (el) el.scrollLeft = el.scrollWidth;
}

function manualZoom(factor: number): void {
  userTouched = true;
  zoomBy(factor);
}

function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    userTouched = true;
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
    return;
  }
  // shift+wheel pans horizontally even where the browser doesn't map it
  if (e.shiftKey && scrollEl.value) {
    e.preventDefault();
    scrollEl.value.scrollLeft += e.deltaY;
  }
}

// ---- drag-to-pan: grab empty canvas and drag, like the workflow editor ----

const panning = ref(false);
let panStart: { x: number; y: number; sl: number; st: number } | undefined;

function startPan(e: MouseEvent): void {
  if (e.button !== 0) return;
  if (e.target instanceof Element && e.target.closest(".tl-bar")) return; // bars stay clickable
  const el = scrollEl.value;
  if (!el) return;
  panStart = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
  panning.value = true;
  userTouched = true;
  const onMove = (ev: MouseEvent): void => {
    if (!panStart || !scrollEl.value) return;
    scrollEl.value.scrollLeft = panStart.sl - (ev.clientX - panStart.x);
    scrollEl.value.scrollTop = panStart.st - (ev.clientY - panStart.y);
  };
  const onUp = (ev: MouseEvent): void => {
    // a "pan" that never moved is a background click — close the detail aside
    if (panStart && Math.hypot(ev.clientX - panStart.x, ev.clientY - panStart.y) < 4) {
      picked.value = undefined;
    }
    panStart = undefined;
    panning.value = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function goDash(view: string): void {
  if (view === "timeline") return;
  if (view === "lineage") {
    const q = picked.value
      ? { focus: `${picked.value.provider}:${picked.value.id}` }
      : undefined;
    return void router.push({ path: "/lineage", query: q });
  }
  if (view === "map") {
    const dir = picked.value?.projectDir;
    return void router.push({
      path: "/map",
      query: dir ? { dir } : undefined,
    });
  }
  void router.push({ path: "/", query: { view } });
}

const rangeMs = computed(() => RANGES.find((r) => r.id === range.value)!.ms);

// measured viewport width — the range WINDOW is scaled to fill it
const viewportW = ref(1400);
function measure(): void {
  if (scrollEl.value) viewportW.value = scrollEl.value.clientWidth;
}

// default and on range switch: fit the whole range into the window
watch(range, () => {
  zoom.value = 1;
  userTouched = false; // a new window starts anchored at "now" again
  void nextTick(scrollToNow);
});

// the WHOLE history lives on the canvas — the range only sets the zoom window
const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  return sessions.sessions
    .filter((s) => s.kind !== "subagent-run")
    .filter((s) => providerF.value === "all" || s.provider === providerF.value)
    .filter((s) => projectF.value === "all" || s.projectDir === projectF.value)
    .filter(
      (s) =>
        !q ||
        (s.title ?? "").toLowerCase().includes(q) ||
        (s.agent ?? "").toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.projectDir ?? "").toLowerCase().includes(q),
    )
    .sort((x, y) => (x.createdAt ?? x.updatedAt) - (y.createdAt ?? y.updatedAt));
});

watch(visible, (list) => {
  if (!picked.value) return;
  if (!list.some((s) => s.provider === picked.value!.provider && s.id === picked.value!.id)) {
    picked.value = undefined;
  }
});

const minTs = computed(() => {
  const starts = visible.value.map((s) => s.createdAt ?? s.updatedAt);
  if (!starts.length) {
    const span =
      rangeMs.value === Infinity ? 7 * 24 * 3_600_000 : rangeMs.value;
    return Date.now() - span;
  }
  return Math.min(...starts);
});
const maxTs = computed(() =>
  visible.value.length
    ? Math.max(...visible.value.map((s) => s.updatedAt), Date.now())
    : Date.now(),
);

/** px per hour: the selected window fills the viewport at zoom 1 */
const pxPerHour = computed(() => {
  const windowH =
    rangeMs.value === Infinity
      ? Math.max(1, (maxTs.value - minTs.value) / 3_600_000)
      : rangeMs.value / 3_600_000;
  return ((viewportW.value - 300) / windowH) * zoom.value;
});

function xOf(ts: number): number {
  return ((ts - minTs.value) / 3_600_000) * pxPerHour.value + 20;
}

const canvasWidth = computed(() => xOf(maxTs.value) + 260);

/** greedy row packing: reuse a row when the previous bar (plus its label) ended */
const bars = computed<Bar[]>(() => {
  const rowEnds: number[] = [];
  const out: Bar[] = [];
  for (const s of visible.value) {
    const start = s.createdAt ?? s.updatedAt;
    const end = Math.max(s.updatedAt, start + MIN_BAR_MS);
    const x = xOf(start);
    const w = Math.max(8, xOf(end) - x);
    const needsUntil = x + w + 190; // bar + label width
    let row = rowEnds.findIndex((e) => e < x);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(needsUntil);
    } else {
      rowEnds[row] = needsUntil;
    }
    out.push({
      key: `${s.provider}:${s.id}`,
      id: s.id,
      provider: s.provider,
      title: s.title ?? s.id.slice(0, 10),
      agent: s.agent,
      projectDir: s.projectDir || undefined,
      start,
      end,
      x,
      w,
      row,
      color: providerColorHex(s.provider),
      running: isSessionLive(s.status),
    });
  }
  return out;
});

const canvasHeight = computed(
  () => (Math.max(...bars.value.map((b) => b.row), 0) + 1) * ROW_H + 60,
);

/** hour or day ticks depending on zoom */
const ticks = computed(() => {
  const out: Array<{ ts: number; label: string }> = [];
  const pxPerDay = pxPerHour.value * 24;
  const daily = pxPerHour.value < 30;
  let step = daily ? 24 * 3_600_000 : 3_600_000;
  if (daily && pxPerDay < 70) step = 7 * 24 * 3_600_000; // weekly when tight
  if (!daily && pxPerHour.value < 90) step = 6 * 3_600_000; // 6-hourly between
  const first = Math.ceil(minTs.value / step) * step;
  for (let ts = first; ts <= maxTs.value; ts += step) {
    const d = new Date(ts);
    out.push({
      ts,
      label: daily
        ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    });
  }
  return out;
});

// keep the viewport anchored at "now" while data streams in — until the user interacts
function tryAutoAnchor(): void {
  if (userTouched || !visible.value.length || !scrollEl.value) return;
  measure();
  scrollToNow();
}
watch(() => visible.value.length, () => void nextTick(tryAutoAnchor));
// canvas width can change without new sessions (viewport measure, zoom base) —
// keep "now" pinned to the right edge until the user pans/zooms
watch(canvasWidth, () => {
  if (!userTouched) void nextTick(scrollToNow);
});
onMounted(() => {
  void nextTick(tryAutoAnchor);
  window.addEventListener("resize", measure);
  document.addEventListener("click", onDocClick);
});
onUnmounted(() => {
  window.removeEventListener("resize", measure);
  document.removeEventListener("click", onDocClick);
});
</script>

<style scoped>
.tl-page {
  display: flex;
  height: 100vh;
  background: var(--canvas-bg);
}
.tl-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tl-chrome {
  flex-shrink: 0;
  padding: 32px 36px 0;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
}
.tl-chrome .dash-head {
  margin-bottom: 14px;
}
.tl-toolbar {
  gap: 10px;
  padding-bottom: 16px;
  margin-bottom: 0;
}
.tl-body-row {
  flex: 1;
  min-height: 0;
  display: flex;
}
.tl-scroll-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
}
.tl-overlay-msg {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 5;
  padding: 28px 36px;
  color: var(--text-faint);
  font-size: var(--fs-sm);
  text-align: center;
  pointer-events: none;
}
.tl-detail {
  width: 400px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--panel-bg);
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tl-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tl-detail-title {
  font-size: var(--fs-lg);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-md);
}
.tl-close:hover {
  color: var(--text);
}
.tl-detail-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tl-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  cursor: grab;
}
.tl-scroll.panning {
  cursor: grabbing;
  user-select: none;
}
.tl-canvas {
  position: relative;
  min-height: 100%;
}
.tl-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--grid-dot);
}
.tl-tick-label {
  position: sticky;
  top: 6px;
  display: inline-block;
  transform: translateX(4px);
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  white-space: nowrap;
}
.tl-bar {
  position: absolute;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-left-width: 3px;
  border-radius: 5px;
  padding: 0 8px 0 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.tl-bar:hover {
  background: var(--node-bg-hover);
  z-index: 3;
}
.tl-bar.live {
  border-color: var(--status-running);
}
.tl-bar.sel {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
  z-index: 4;
}
.tl-bar.ctx {
  z-index: 5;
}
.tl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tl-bar-label {
  font-size: var(--fs-xs);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: visible;
}
.tl-bar:hover .tl-bar-label {
  color: var(--text);
}
</style>
