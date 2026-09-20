<template>
  <div class="fv-layer" aria-live="polite">
    <div
      v-for="w in viewers.windows"
      :key="w.id"
      class="fv-win"
      :style="{
        left: `${w.x}px`,
        top: `${w.y}px`,
        width: `${w.w}px`,
        height: `${w.h}px`,
        zIndex: w.z,
      }"
      @mousedown="viewers.bringToFront(w.id)"
    >
      <header class="fv-title" @pointerdown="onDragStart($event, w)">
        <span class="fv-name mono" :title="w.path">{{ w.name }}</span>
        <template v-if="!w.transcriptRef">
          <span
            v-if="!w.loading && !w.error && w.format === 'auto'"
            class="fv-resolved micro-label"
            :title="`auto → ${viewOf(w).format}`"
          >
            {{ viewOf(w).format }}
          </span>
          <select
            class="fv-fmt"
            :value="w.format"
            title="Highlight / render format"
            @change="onFormat(w.id, $event)"
            @pointerdown.stop
            @mousedown.stop
          >
            <option v-for="o in FORMAT_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </template>
        <span v-else class="fv-resolved micro-label" title="Interactive message list">transcript</span>
        <span class="fv-actions" @pointerdown.stop @mousedown.stop>
          <button
            v-if="viewers.canCopy(w)"
            class="fv-icon"
            type="button"
            :title="copiedId === w.id ? 'Copied' : 'Copy content'"
            :disabled="copyBusyId === w.id"
            @click.stop="onCopy(w)"
          >
            {{ copiedId === w.id ? "✓" : "❐" }}
          </button>
          <button
            v-if="viewers.canDownload(w)"
            class="fv-icon"
            type="button"
            :title="w.transcriptRef ? 'Download reconstructed context (.md)' : 'Download'"
            @click.stop="viewers.download(w.id)"
          >
            ⇓
          </button>
          <button
            v-if="w.contextRef"
            class="fv-icon"
            type="button"
            title="Save as library reference and open a new workflow"
            :disabled="refBusyId === w.id"
            @click.stop="onReferenceWorkflow(w)"
          >
            →
          </button>
          <button
            v-if="viewers.canOpenInEditor(w)"
            class="fv-icon"
            type="button"
            :title="`Open in ${settings.editorLabel}`"
            @click.stop="viewers.openInEditor(w.id)"
          >
            ⟨/⟩
          </button>
          <button class="fv-icon" type="button" title="Close" @click.stop="viewers.close(w.id)">
            ✕
          </button>
        </span>
      </header>
      <div v-if="w.truncated && !w.error" class="fv-banner micro-label">
        preview — showing first {{ fmtBytes(w.previewMaxBytes) }} of {{ fmtBytes(w.size) }} ·
        {{
          viewers.canOpenInEditor(w)
            ? `open in ${settings.editorLabel} or download for the full document`
            : "download for the full document"
        }}
      </div>
      <div v-if="w.loading" class="fv-body fv-load" :data-fv-id="w.id">
        <GraphLoadingOverlay loading label="Loading" />
      </div>
      <div v-else-if="w.error" class="fv-body fv-err" :data-fv-id="w.id">{{ w.error }}</div>
      <div v-else-if="w.transcriptRef" class="fv-body fv-transcript nowheel" :data-fv-id="w.id">
        <TranscriptView
          :provider="w.transcriptRef.provider"
          :session-id="w.transcriptRef.sessionId"
        />
      </div>
      <template v-else>
        <pre v-if="plainText(w) !== null" class="fv-body mono" :data-fv-id="w.id">{{ plainText(w) }}</pre>
        <div
          v-else
          class="fv-body"
          :class="htmlClass(w)"
          :data-fv-id="w.id"
          v-html="htmlBody(w)"
        />
      </template>
      <div
        v-for="edge in RESIZE_EDGES"
        :key="edge"
        class="fv-resize"
        :class="`fv-resize-${edge}`"
        @pointerdown.stop="onResizeStart($event, w, edge)"
      />
    </div>
  </div>
  <ConfirmModal v-model="missingDlg" @confirm="onMissingDismiss" @cancel="onMissingDismiss" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useFileViewersStore, type FileViewerWindow } from "@/stores/fileViewers";
import { useSettingsStore } from "@/stores/settings";
import { referenceContextToWorkflow } from "@/lib/convert";
import { subscribeEvents } from "@/api/client";
import TranscriptView from "@/panels/TranscriptView.vue";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import {
  FORMAT_OPTIONS,
  renderViewer,
  type FileViewerFormat,
  type ViewerRender,
  type ResolvedFormat,
} from "@/lib/fileViewerFormat";

const viewers = useFileViewersStore();
const settings = useSettingsStore();
const router = useRouter();
const refBusyId = ref<string>();
const copyBusyId = ref<string>();
const copiedId = ref<string>();
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let unsubEvents: (() => void) | undefined;
const liveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const missingDlg = computed({
  get(): ConfirmModel | undefined {
    const a = viewers.missingAlert;
    if (!a) return undefined;
    return {
      title: "File missing",
      emphasis: a.name,
      body: " is no longer on disk — it may have been deleted or moved.",
      detail: a.path,
      confirmLabel: "OK",
      alert: true,
      danger: true,
    };
  },
  set(v: ConfirmModel | undefined) {
    if (!v) viewers.dismissMissingAlert();
  },
});

function onMissingDismiss(): void {
  viewers.dismissMissingAlert();
}

async function onCopy(w: FileViewerWindow): Promise<void> {
  if (copyBusyId.value) return;
  copyBusyId.value = w.id;
  try {
    const ok = await viewers.copyContent(w.id);
    if (!ok) return;
    copiedId.value = w.id;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (copiedId.value === w.id) copiedId.value = undefined;
    }, 1200);
  } finally {
    if (copyBusyId.value === w.id) copyBusyId.value = undefined;
  }
}

function sessionProviderOf(w: FileViewerWindow): string | undefined {
  return w.contextRef?.provider ?? w.invocationsRef?.provider ?? w.transcriptRef?.provider;
}

function bodyEl(id: string): HTMLElement | null {
  return document.querySelector(`[data-fv-id="${CSS.escape(id)}"]`);
}

function isNearBottom(el: HTMLElement, threshold = 96): boolean {
  // Nested transcript scrolls itself — parent may not overflow
  const nested = el.classList.contains("fv-transcript")
    ? ((el.querySelector(".t-scroll") as HTMLElement | null) ??
      (el.querySelector(".transcript") as HTMLElement | null))
    : null;
  const host = nested && nested.scrollHeight > nested.clientHeight + 1 ? nested : el;
  if (host.scrollHeight <= host.clientHeight + 1) return true;
  return host.scrollHeight - host.scrollTop - host.clientHeight <= threshold;
}

async function followLiveWindow(w: FileViewerWindow): Promise<void> {
  // TranscriptView handles its own live tail
  if (w.transcriptRef || (!w.contextRef && !w.invocationsRef)) return;
  const el = bodyEl(w.id);
  if (el && !isNearBottom(el)) return;
  const ok = await viewers.refreshLive(w.id);
  if (!ok) return;
  await nextTick();
  const after = bodyEl(w.id);
  if (after) after.scrollTop = after.scrollHeight;
}

function scheduleLive(provider: string): void {
  for (const w of viewers.windows) {
    if (sessionProviderOf(w) !== provider) continue;
    if (w.transcriptRef) continue; // TranscriptView owns this
    if (!w.contextRef && !w.invocationsRef) continue;
    const prev = liveTimers.get(w.id);
    if (prev) clearTimeout(prev);
    liveTimers.set(
      w.id,
      setTimeout(() => {
        liveTimers.delete(w.id);
        void followLiveWindow(w);
      }, 350),
    );
  }
}

async function onReferenceWorkflow(w: FileViewerWindow): Promise<void> {
  const ref = w.contextRef;
  if (!ref || refBusyId.value) return;
  refBusyId.value = w.id;
  try {
    const { graphId } = await referenceContextToWorkflow(ref.provider, ref.sessionId);
    await router.push(`/graph/${graphId}`);
  } catch {
    /* leave window open */
  } finally {
    refBusyId.value = undefined;
  }
}

const MIN_W = 320;
const MIN_H = 200;
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type ViewCache = { format: ResolvedFormat; render: ViewerRender };
const cache = new WeakMap<FileViewerWindow, { key: string; view: ViewCache }>();

function topWindow(): FileViewerWindow | undefined {
  let top: FileViewerWindow | undefined;
  for (const w of viewers.windows) {
    if (!top || w.z > top.z) top = w;
  }
  return top;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  if (!viewers.windows.length) return;
  // don't steal Esc from open selects / editable fields inside the viewer
  const t = e.target;
  if (t instanceof HTMLElement) {
    const tag = t.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable) {
      return;
    }
  }
  const top = topWindow();
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  viewers.close(top.id);
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  unsubEvents = subscribeEvents((ev) => {
    if (ev.type !== "sessions.changed") return;
    scheduleLive(ev.provider);
  });
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
  unsubEvents?.();
  for (const t of liveTimers.values()) clearTimeout(t);
  liveTimers.clear();
  if (copyTimer) clearTimeout(copyTimer);
});

function viewOf(w: FileViewerWindow): ViewCache {
  const key = `${w.format}\0${w.content.length}\0${w.content.slice(0, 64)}\0${w.path}`;
  const hit = cache.get(w);
  if (hit && hit.key === key) return hit.view;
  const view = renderViewer(w.format, w.path, w.content);
  cache.set(w, { key, view });
  return view;
}

function plainText(w: FileViewerWindow): string | null {
  const r = viewOf(w).render;
  return r.kind === "plain" ? r.text : null;
}

function htmlBody(w: FileViewerWindow): string {
  const r = viewOf(w).render;
  return r.kind === "html" ? r.html : "";
}

function htmlClass(w: FileViewerWindow): string {
  const r = viewOf(w).render;
  return r.kind === "html" ? r.className : "";
}

function onFormat(id: string, e: Event): void {
  const el = e.target as HTMLSelectElement;
  viewers.setFormat(id, el.value as FileViewerFormat);
}

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} kB`;
  return `${n} B`;
}

function onDragStart(e: PointerEvent, w: FileViewerWindow): void {
  if (e.button !== 0) return;
  // Don't start a drag from title controls — pointer capture would eat the click
  // (Safari especially; format select already stops pointerdown for the same reason).
  const from = e.target;
  if (
    from instanceof Element &&
    from.closest("button, select, input, textarea, a, .fv-actions")
  ) {
    return;
  }
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  viewers.bringToFront(w.id);
  const startX = e.clientX;
  const startY = e.clientY;
  const origX = w.x;
  const origY = w.y;

  function onMove(ev: PointerEvent): void {
    viewers.move(w.id, origX + (ev.clientX - startX), origY + (ev.clientY - startY));
  }
  function onUp(): void {
    target.releasePointerCapture(e.pointerId);
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
  }
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}

function onResizeStart(e: PointerEvent, w: FileViewerWindow, edge: ResizeEdge): void {
  if (e.button !== 0) return;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  viewers.bringToFront(w.id);
  const startX = e.clientX;
  const startY = e.clientY;
  const orig = { x: w.x, y: w.y, w: w.w, h: w.h };

  function onMove(ev: PointerEvent): void {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    let nextX = orig.x;
    let nextY = orig.y;
    let nextW = orig.w;
    let nextH = orig.h;

    if (edge.includes("e")) nextW = orig.w + dx;
    if (edge.includes("s")) nextH = orig.h + dy;
    if (edge.includes("w")) {
      nextW = orig.w - dx;
      nextX = orig.x + dx;
      if (nextW < MIN_W) {
        nextX = orig.x + orig.w - MIN_W;
        nextW = MIN_W;
      }
    }
    if (edge.includes("n")) {
      nextH = orig.h - dy;
      nextY = orig.y + dy;
      if (nextH < MIN_H) {
        nextY = orig.y + orig.h - MIN_H;
        nextH = MIN_H;
      }
    }

    viewers.resize(w.id, {
      x: edge.includes("w") ? nextX : undefined,
      y: edge.includes("n") ? nextY : undefined,
      w: nextW,
      h: nextH,
    });
  }

  function onUp(): void {
    target.releasePointerCapture(e.pointerId);
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
  }
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}
</script>

<style scoped>
.fv-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 120;
}
.fv-win {
  position: absolute;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  min-height: 200px;
  background: var(--panel-bg, #0e0e11);
  border: 1px solid var(--border, #1d1e22);
  border-radius: 8px;
  box-shadow: var(--shadow-strong);
  overflow: hidden;
}
.fv-resize {
  position: absolute;
  z-index: 2;
  touch-action: none;
}
.fv-resize-n,
.fv-resize-s {
  left: 8px;
  right: 8px;
  height: 6px;
  cursor: ns-resize;
}
.fv-resize-e,
.fv-resize-w {
  top: 8px;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}
.fv-resize-n {
  top: 0;
}
.fv-resize-s {
  bottom: 0;
}
.fv-resize-e {
  right: 0;
}
.fv-resize-w {
  left: 0;
}
.fv-resize-ne,
.fv-resize-nw,
.fv-resize-se,
.fv-resize-sw {
  width: 12px;
  height: 12px;
}
.fv-resize-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.fv-resize-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.fv-resize-se {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}
.fv-resize-se::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 1.5px solid var(--text-faint);
  border-bottom: 1.5px solid var(--text-faint);
  opacity: 0.7;
  pointer-events: none;
}
.fv-resize-sw {
  left: 0;
  bottom: 0;
  cursor: nesw-resize;
}
.fv-title {
  position: relative;
  z-index: 3; /* above edge/corner resize hit-targets so ✕ / ⇓ stay clickable */
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 12px;
  background: var(--panel-bg-raised);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
}
.fv-title:active {
  cursor: grabbing;
}
.fv-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fv-resolved {
  flex-shrink: 0;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 6px;
  line-height: 18px;
}
.fv-fmt {
  flex-shrink: 0;
  max-width: 110px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-dim);
  font-size: var(--fs-2xs);
  font-family: var(--mono);
  padding: 2px 4px;
  outline: none;
  cursor: pointer;
}
.fv-fmt:hover,
.fv-fmt:focus {
  color: var(--text);
  border-color: var(--border-strong);
}
.fv-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.fv-icon {
  background: none;
  border: none;
  color: var(--text-dim);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--fs-sm);
}
.fv-icon:disabled {
  opacity: 0.45;
  cursor: default;
}
.fv-icon:hover:not(:disabled) {
  background: var(--hover-overlay);
  color: var(--text);
}
.fv-banner {
  flex-shrink: 0;
  padding: 6px 12px;
  background: rgba(232, 185, 62, 0.12);
  color: var(--status-waiting, #e8b93e);
  border-bottom: 1px solid var(--border, #1d1e22);
}
.fv-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px 14px;
  overflow: auto;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--text);
}
.fv-load {
  position: relative;
  overflow: hidden;
  padding: 0;
}
.fv-transcript {
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.fv-transcript :deep(.transcript) {
  flex: 1;
  min-height: 0;
  height: 100%;
}
.fv-transcript :deep(.t-meta) {
  padding: 8px 12px;
  background: var(--panel-bg-raised);
  border-bottom-color: var(--border);
}
.fv-transcript :deep(.t-scroll) {
  padding: 12px;
}
.fv-body.mono,
pre.fv-body {
  font-family: var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.fv-err {
  color: var(--status-error, #e07070);
}

/* markdown */
.fv-md {
  font-size: var(--fs-sm);
  line-height: 1.55;
}
.fv-md :deep(pre) {
  background: var(--input-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-xs);
  font-family: var(--mono);
}
.fv-md :deep(code) {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.fv-md :deep(p) {
  margin: 0.4em 0;
}
.fv-md :deep(h1),
.fv-md :deep(h2),
.fv-md :deep(h3) {
  margin: 0.6em 0 0.3em;
  font-size: 1.1em;
}
.fv-md :deep(ul),
.fv-md :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}
.fv-md :deep(table) {
  border-collapse: collapse;
  font-size: var(--fs-xs);
}
.fv-md :deep(td),
.fv-md :deep(th) {
  border: 1px solid var(--border);
  padding: 3px 8px;
}
.fv-md :deep(a) {
  color: var(--lane-session);
}

/* code + monochrome hljs tokens */
.fv-code {
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.5;
  white-space: pre;
  word-break: normal;
  overflow-x: auto;
}
.fv-code :deep(code.hljs) {
  display: block;
  background: transparent;
  padding: 0;
  color: var(--text);
}
.fv-code :deep(.hljs-comment),
.fv-code :deep(.hljs-quote) {
  color: var(--text-faint);
  font-style: italic;
}
.fv-code :deep(.hljs-keyword),
.fv-code :deep(.hljs-selector-tag),
.fv-code :deep(.hljs-meta .hljs-keyword) {
  color: var(--hljs-keyword, #c4b5fd);
}
.fv-code :deep(.hljs-string),
.fv-code :deep(.hljs-attr),
.fv-code :deep(.hljs-template-variable) {
  color: var(--hljs-string, #86efac);
}
.fv-code :deep(.hljs-number),
.fv-code :deep(.hljs-literal),
.fv-code :deep(.hljs-symbol) {
  color: var(--hljs-number, #fcd34d);
}
.fv-code :deep(.hljs-built_in),
.fv-code :deep(.hljs-type),
.fv-code :deep(.hljs-title),
.fv-code :deep(.hljs-title.function_),
.fv-code :deep(.hljs-title.class_) {
  color: var(--hljs-fn, #7dd3fc);
}
.fv-code :deep(.hljs-variable),
.fv-code :deep(.hljs-params),
.fv-code :deep(.hljs-property),
.fv-code :deep(.hljs-attribute) {
  color: var(--text-dim);
}
.fv-code :deep(.hljs-meta),
.fv-code :deep(.hljs-doctag) {
  color: var(--hljs-meta, #94a3b8);
}
.fv-code :deep(.hljs-deletion) {
  color: var(--status-error);
}
.fv-code :deep(.hljs-addition) {
  color: var(--status-success);
}
.fv-md :deep(.hljs-comment),
.fv-md :deep(.hljs-quote) {
  color: var(--text-faint);
}
.fv-md :deep(.hljs-keyword) {
  color: var(--hljs-keyword, #c4b5fd);
}
.fv-md :deep(.hljs-string) {
  color: var(--hljs-string, #86efac);
}
.fv-md :deep(.hljs-number) {
  color: var(--hljs-number, #fcd34d);
}
.fv-md :deep(.hljs-built_in),
.fv-md :deep(.hljs-title) {
  color: var(--hljs-fn, #7dd3fc);
}
</style>
