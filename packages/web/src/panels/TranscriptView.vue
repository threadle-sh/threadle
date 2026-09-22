<template>
  <div class="transcript">
    <GraphLoadingOverlay
      :loading="loading"
      :error="error"
      label="Loading transcript"
    />
    <template v-if="!loading && !error">
      <div class="t-meta">
        <span class="t-meta-left">
          {{ total }} messages
          <template v-if="messages.length && total > messages.length">
            · showing {{ windowStart + 1 }}–{{ windowStart + messages.length }}
          </template>
          <span v-if="selection">
            · selected {{ selection[0] + 1 }}–{{ selection[1] + 1 }}
            <button type="button" class="t-clear" @click="clearSelection">clear</button>
          </span>
        </span>
        <button
          v-if="total > 0"
          type="button"
          class="t-jump"
          :class="{ 'has-new': unreadCount > 0 }"
          :disabled="paging"
          :title="
            unreadCount > 0
              ? `${unreadCount} new message${unreadCount === 1 ? '' : 's'} — jump to latest`
              : 'Jump to the latest messages without loading the whole transcript'
          "
          @click="jumpToLatest"
        >
          <template v-if="unreadCount > 0">↓ {{ unreadCount }} new</template>
          <template v-else>↓ latest</template>
        </button>
      </div>
      <div ref="scrollEl" class="t-scroll">
        <button
          v-if="windowStart > 0"
          type="button"
          class="threadle-btn t-more"
          :disabled="paging"
          @click="loadPrevious"
        >
          Load previous ({{ windowStart }} remaining)
        </button>
        <div
          v-for="(msg, i) in messages"
          :key="msg.id"
          :ref="(el) => setMsgEl(msg.id, el)"
          class="t-msg"
          :class="{ selected: isSelected(i), synthetic: msg.synthetic, focus: isFocused(i) }"
          @click="onSelect(i, $event)"
        >
          <div class="t-head">
            <span
              class="t-role"
              :class="msg.role"
              :style="msg.role === 'assistant' ? assistantRoleStyle : undefined"
            >{{ displayMessageRole(msg.role) }}</span>
            <span v-if="msg.synthetic" class="threadle-chip">injected context</span>
            <span class="t-time" :title="msg.timestamp ? new Date(msg.timestamp).toLocaleString() : undefined">{{
              time(msg.timestamp)
            }}</span>
            <button
              type="button"
              class="t-copy"
              title="Copy this message"
              @click.stop="copyMessage(msg)"
            >
              {{ copiedId === msg.id ? "✓ copied" : "❐ copy" }}
            </button>
          </div>
          <template v-for="(part, pi) in msg.parts" :key="pi">
            <template v-if="part.type === 'text'">
              <div
                v-if="fmtOf(part.text) === 'markdown'"
                class="t-text"
                v-html="renderMd(part.text ?? '')"
                @click="onMdClick"
              />
              <div
                v-else-if="fmtOf(part.text) === 'svg'"
                class="t-svg"
                v-html="safeSvg(part.text ?? '')"
              />
              <div v-else-if="fmtOf(part.text) === 'code'" class="t-codewrap">
                <span class="t-fmt micro-label">{{ codeLang(part.text) }}</span>
                <pre class="t-code"><code v-html="highlightCode(part.text ?? '')" /></pre>
              </div>
              <p v-else class="t-plain">{{ part.text }}</p>
            </template>
            <details v-else-if="part.type === 'thinking'" class="t-fold">
              <summary>thinking</summary>
              <pre class="t-pre">{{ part.text }}</pre>
            </details>
            <details v-else-if="part.type === 'tool_use'" class="t-fold">
              <summary>⚙ {{ part.toolName }}</summary>
              <pre class="t-pre">{{ pretty(part.toolInput) }}</pre>
            </details>
            <details
              v-else-if="part.type === 'tool_result'"
              class="t-fold"
              :class="{ error: part.isError }"
            >
              <summary>→ result{{ part.isError ? " (error)" : "" }}</summary>
              <pre class="t-pre">{{ part.text }}</pre>
            </details>
            <div v-else-if="part.type === 'patch'" class="t-patch">
              {{ part.text }}
            </div>
            <div v-else-if="part.type === 'attachment' || part.type === 'other'" class="t-misc">
              · {{ part.type }}{{ part.text ? ": " + part.text.slice(0, 120) : "" }}
            </div>
          </template>
        </div>
        <div
          v-if="agentBusy"
          class="t-live"
          :class="sessionStatus"
          aria-live="polite"
        >
          <span class="t-live-mark" aria-hidden="true">
            <i /><i /><i />
          </span>
          <span class="t-live-label">{{ liveLabel }}</span>
        </div>
        <div ref="endEl" class="t-end" aria-hidden="true" />
        <button
          v-if="remainingAfter > 0"
          type="button"
          class="threadle-btn t-more"
          :disabled="paging"
          @click="loadMore"
        >
          Load more ({{ remainingAfter }} remaining)
        </button>
      </div>
    </template>
  </div>
  <ConfirmModal
    v-model="outboundDlg"
    @confirm="onConfirmOutbound"
    @cancel="pendingOutbound = undefined"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import hljs from "highlight.js/lib/common";
import type { NormalizedMessage, SessionStatus } from "@threadle/shared";
import { api, subscribeEvents } from "@/api/client";
import { providerColor } from "@/lib/providers";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import {
  escapeHtml,
  renderMd,
  safeHighlight,
  safeSvg,
} from "@/lib/safeHtml";
import { interceptContentLinkClick } from "@/lib/contentLinks";
import { useSessionsStore } from "@/stores/sessions";
import { useFileViewersStore } from "@/stores/fileViewers";
import { displayMessageRole } from "@/lib/messageRole";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";

const props = defineProps<{
  provider: string;
  sessionId: string;
  full?: boolean;
  /** Jump to this message after load (search hit). */
  focusMessageId?: string;
  focusSeq?: number;
  /** Fallback when message id is missing from an older search index row. */
  focusTs?: number;
  focusRole?: string;
}>();
const emit = defineEmits<{
  selection: [range: [number, number] | undefined];
  selectMessage: [messageId: string | undefined];
}>();

const PAGE = 200;
const sessions = useSessionsStore();
const fileViewers = useFileViewersStore();
const outboundDlg = ref<ConfirmModel>();
const pendingOutbound = ref<string>();

const transcriptBaseDir = computed(() => {
  const s = sessions.find(props.provider, props.sessionId);
  const dir = s?.projectDir?.replace(/\\/g, "/").replace(/\/+$/, "");
  return dir || undefined;
});

function onMdClick(e: MouseEvent): void {
  interceptContentLinkClick(e, {
    baseDir: transcriptBaseDir.value,
    onLocal: (filePath) => {
      void fileViewers.open(filePath);
    },
    onExternal: (url, domain) => {
      pendingOutbound.value = url;
      outboundDlg.value = {
        title: "Open URL",
        emphasis: domain,
        body: " — leave threadle and open this site?",
        detail: url,
        confirmLabel: "Open",
        cancelLabel: "Cancel",
      };
    },
  });
}

function onConfirmOutbound(): void {
  const url = pendingOutbound.value;
  pendingOutbound.value = undefined;
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

const assistantRoleStyle = computed(() => ({
  color: providerColor(props.provider),
}));
const scrollEl = ref<HTMLElement>();
const endEl = ref<HTMLElement>();
const messages = ref<NormalizedMessage[]>([]);
/** Absolute index of `messages[0]` in the full transcript. */
const windowStart = ref(0);
const total = ref(0);
const loading = ref(true);
const paging = ref(false);
const error = ref<string>();
/** Absolute index of the search-focus message, if any. */
const focusAbsIndex = ref<number>();
const msgEls = new Map<string, HTMLElement>();

function setMsgEl(id: string, el: unknown): void {
  if (el instanceof HTMLElement) msgEls.set(id, el);
  else msgEls.delete(id);
}

function isFocused(i: number): boolean {
  return focusAbsIndex.value === windowStart.value + i;
}
/** Live process status for this session (running / waiting / …). */
const sessionStatus = ref<SessionStatus>();
/** Absolute message indices in the full transcript (for extract). */
const selection = ref<[number, number]>();
const copiedId = ref<string>();
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
/** Absolute index used as shift-click anchor. */
let anchor: number | undefined;

const remainingAfter = computed(() =>
  Math.max(0, total.value - (windowStart.value + messages.value.length)),
);

const agentBusy = computed(
  () => sessionStatus.value === "running" || sessionStatus.value === "waiting",
);

const liveLabel = computed(() => {
  if (sessionStatus.value === "waiting") return "waiting";
  if (sessionStatus.value === "running") return "thinking";
  return "";
});

function applySessionStatus(status: SessionStatus | undefined): void {
  sessionStatus.value = status;
  const hit = sessions.find(props.provider, props.sessionId);
  if (hit && status) hit.status = status;
}

function syncStatusFromStore(): void {
  const hit = sessions.find(props.provider, props.sessionId);
  if (hit) sessionStatus.value = hit.status;
}

type TextFormat = "markdown" | "code" | "svg" | "text";

const MD_MARKERS =
  /(^|\n)#{1,6}\s|\*\*[^*\n]+\*\*|(^|\n)\s*[-*]\s+\S|(^|\n)\s*\d+\.\s+\S|\[[^\]]+\]\([^)]+\)|```|(^|\n)>\s/;

const fmtCache = new Map<string, TextFormat>();

function detectFormat(text: string): TextFormat {
  const t = text.trim();
  if (!t) return "text";
  if (/^<svg[\s>]/i.test(t)) return "svg";
  // JSON / JS object-ish
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return "code";
    } catch {
      // not strict JSON — fall through
    }
  }
  // unified diff
  if (/^(diff --git|--- |\+\+\+ |@@ )/m.test(t)) return "code";
  if (MD_MARKERS.test(t)) return "markdown";
  // code-ish: majority of lines end in ; { } or are indented, with no prose sentences
  const lines = t.split("\n");
  if (lines.length >= 3) {
    const codey = lines.filter(
      (l) => /[;{}]\s*$/.test(l) || /^(\s{2,}|\t)/.test(l) || /^(import|const|let|function|class|def|fn|pub|#include)\b/.test(l),
    ).length;
    if (codey / lines.length > 0.5) return "code";
  }
  return "text";
}

function fmtOf(text?: string): TextFormat {
  if (!text) return "text";
  const key = text.length > 200 ? `${text.length}:${text.slice(0, 200)}` : text;
  let f = fmtCache.get(key);
  if (!f) {
    f = detectFormat(text);
    fmtCache.set(key, f);
  }
  return f;
}

function codeLang(text?: string): string {
  const t = (text ?? "").trim();
  if (/^[{[]/.test(t)) return "json";
  if (/^(diff --git|--- |\+\+\+ |@@ )/m.test(t)) return "diff";
  return "code";
}

const HIGHLIGHT_CAP = 6000;

function highlightCode(text: string): string {
  if (text.length > HIGHLIGHT_CAP) return escapeHtml(text);
  try {
    return safeHighlight(hljs.highlightAuto(text).value);
  } catch {
    return escapeHtml(text);
  }
}

function pretty(v: unknown): string {
  const s = JSON.stringify(v, null, 2) ?? "";
  return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s;
}

function time(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messagePlain(msg: NormalizedMessage): string {
  const chunks: string[] = [];
  for (const part of msg.parts) {
    switch (part.type) {
      case "text":
      case "thinking":
      case "tool_result":
      case "patch":
      case "attachment":
      case "other":
        if (part.text) chunks.push(part.text);
        break;
      case "tool_use":
        chunks.push(
          [part.toolName ? `⚙ ${part.toolName}` : "⚙ tool", pretty(part.toolInput)].join("\n"),
        );
        break;
    }
  }
  return chunks.join("\n\n").trim();
}

async function copyMessage(msg: NormalizedMessage): Promise<void> {
  const text = messagePlain(msg);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedId.value = msg.id;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    if (copiedId.value === msg.id) copiedId.value = undefined;
  }, 1200);
}

async function fetchPage(
  offset: number,
  limit: number,
  around?: { messageId?: string; ts?: number; role?: string },
) {
  return api.transcript(props.provider, props.sessionId, offset, limit, props.full, around);
}

function scrollHost(): HTMLElement | null {
  return scrollEl.value ?? null;
}

async function scrollToEnd(): Promise<void> {
  await nextTick();
  const host = scrollHost();
  if (host) host.scrollTop = host.scrollHeight;
  else endEl.value?.scrollIntoView({ block: "end" });
}

async function scrollToFocus(): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await nextTick();

  const host = scrollHost();
  const id =
    props.focusMessageId ??
    (focusAbsIndex.value != null
      ? messages.value[focusAbsIndex.value - windowStart.value]?.id
      : undefined);
  const el = id ? msgEls.get(id) : undefined;

  if (host && el instanceof HTMLElement) {
    const padTop = 12;
    const hostRect = host.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top - hostRect.top - padTop;
    host.scrollTop = Math.max(0, host.scrollTop + delta);
    return;
  }

  if (!host || focusAbsIndex.value == null || messages.value.length === 0) return;
  const local = focusAbsIndex.value - windowStart.value;
  if (local < 0 || local >= messages.value.length) return;
  const frac = local / Math.max(1, messages.value.length - 1);
  host.scrollTop = frac * Math.max(0, host.scrollHeight - host.clientHeight);
}

function hasFocusTarget(): boolean {
  return Boolean(props.focusMessageId || props.focusTs != null);
}

async function loadAroundFocus(): Promise<void> {
  followPinned.value = false;
  const res = await fetchPage(0, PAGE, {
    messageId: props.focusMessageId,
    ts: props.focusTs,
    role: props.focusRole,
  });
  messages.value = res.messages;
  total.value = res.total;
  windowStart.value = res.offset ?? 0;
  focusAbsIndex.value = res.focusIndex;
  seenTotal.value = Math.min(seenTotal.value, total.value);
  bindScrollPin();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = undefined;
  clearSelection();
  windowStart.value = 0;
  messages.value = [];
  total.value = 0;
  focusAbsIndex.value = undefined;
  msgEls.clear();
  followPinned.value = !hasFocusTarget();
  syncStatusFromStore();
  let wantFocus = false;
  try {
    if (hasFocusTarget()) {
      wantFocus = true;
      await loadAroundFocus();
    } else {
      // Open on the live tail — page 0 breaks follow for long transcripts.
      await refreshLatestWindow(true);
      followPinned.value = true;
      markCaughtUp();
    }
    syncStatusFromStore();
    bindScrollPin();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
  if (wantFocus) await scrollToFocus();
  else if (!error.value) await scrollToEnd();
}

async function loadMore(): Promise<void> {
  if (paging.value || remainingAfter.value <= 0) return;
  paging.value = true;
  try {
    const offset = windowStart.value + messages.value.length;
    const res = await fetchPage(offset, PAGE);
    messages.value.push(...res.messages);
    total.value = res.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    paging.value = false;
  }
}

async function loadPrevious(): Promise<void> {
  if (paging.value || windowStart.value <= 0) return;
  paging.value = true;
  const host = scrollHost();
  const prevHeight = host?.scrollHeight ?? 0;
  const prevTop = host?.scrollTop ?? 0;
  try {
    const limit = Math.min(PAGE, windowStart.value);
    const offset = windowStart.value - limit;
    const res = await fetchPage(offset, limit);
    messages.value = [...res.messages, ...messages.value];
    total.value = res.total;
    windowStart.value = res.offset ?? offset;
    await nextTick();
    if (host) host.scrollTop = prevTop + (host.scrollHeight - prevHeight);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    paging.value = false;
  }
}

/** Load only the last page and scroll to the newest message. */
async function jumpToLatest(): Promise<void> {
  if (paging.value) return;
  paging.value = true;
  clearSelection();
  error.value = undefined;
  followPinned.value = true;
  try {
    await refreshLatestWindow(true);
    await scrollToEnd();
    followPinned.value = true;
    markCaughtUp();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    paging.value = false;
  }
}

function isShowingLatest(): boolean {
  return remainingAfter.value === 0 && messages.value.length > 0;
}

function isScrolledNearEnd(threshold = 120): boolean {
  const host = scrollHost();
  if (!host) return true;
  if (host.scrollHeight <= host.clientHeight + 1) return true;
  return host.scrollHeight - host.scrollTop - host.clientHeight <= threshold;
}

/** User wants live tail until they scroll away from the bottom. */
const followPinned = ref(true);
/** Absolute transcript length last seen while pinned / after ↓ latest. */
const seenTotal = ref(0);
/** New messages arrived while reading above the live tail. */
const unreadCount = computed(() => Math.max(0, total.value - seenTotal.value));
let scrollPinHost: HTMLElement | null = null;

function markCaughtUp(): void {
  seenTotal.value = total.value;
}

function onScrollPin(): void {
  const near = isScrolledNearEnd();
  const wasPinned = followPinned.value;
  followPinned.value = near;
  if (near && (!wasPinned || unreadCount.value > 0)) {
    // Scrolled back to bottom — catch up without forcing a jump click.
    scheduleLiveFollow();
  }
}

function bindScrollPin(): void {
  const host = scrollHost();
  if (scrollPinHost === host) return;
  scrollPinHost?.removeEventListener("scroll", onScrollPin);
  scrollPinHost = host;
  host?.addEventListener("scroll", onScrollPin, { passive: true });
}

/** Re-fetch the trailing page; merge in place when possible to avoid flicker. */
async function refreshLatestWindow(scroll: boolean): Promise<void> {
  let knownTotal = total.value;
  if (knownTotal <= 0) {
    const probe = await fetchPage(0, 1);
    knownTotal = probe.total;
    total.value = probe.total;
    if (knownTotal === 0) {
      messages.value = [];
      windowStart.value = 0;
      markCaughtUp();
      return;
    }
  }

  let res = await fetchPage(Math.max(0, knownTotal - PAGE), PAGE);
  // Always land on the true tail — total can grow while the first request is in flight.
  let end = (res.offset ?? 0) + res.messages.length;
  if (end < res.total) {
    res = await fetchPage(Math.max(0, res.total - PAGE), PAGE);
    end = (res.offset ?? 0) + res.messages.length;
  }
  if (end < res.total && res.total > 0) {
    res = await fetchPage(Math.max(0, res.total - PAGE), PAGE);
  }

  // Prefer length-derived start so remainingAfter stays 0 on the live page.
  const newStart = Math.max(0, res.total - res.messages.length);
  const shouldStick = scroll && (followPinned.value || isScrolledNearEnd());

  applyLatestWindow(res.messages, newStart, res.total);

  if (shouldStick) {
    await scrollToEnd();
    followPinned.value = true;
    markCaughtUp();
  }
}

/** When reading above the tail, only advance `total` so the jump button can show unread. */
async function probeUnread(): Promise<void> {
  try {
    const probe = await fetchPage(0, 1);
    if (probe.total > total.value) total.value = probe.total;
  } catch {
    // ignore transient probe errors
  }
}

/** Patch the trailing window: reuse unchanged prefix rows, replace/append the rest. */
function applyLatestWindow(
  incoming: NormalizedMessage[],
  newStart: number,
  newTotal: number,
): void {
  const prev = messages.value;
  if (prev.length > 0 && newStart === windowStart.value && incoming.length > 0) {
    const indexById = new Map(prev.map((m, i) => [m.id, i]));
    let incIdx = -1;
    let prevIdx = -1;
    for (let i = 0; i < incoming.length; i++) {
      const at = indexById.get(incoming[i]!.id);
      if (at !== undefined) {
        incIdx = i;
        prevIdx = at;
        break;
      }
    }
    if (incIdx >= 0 && prevIdx >= 0) {
      let next = [...prev.slice(0, prevIdx), ...incoming.slice(incIdx)];
      if (next.length > PAGE) {
        const trim = next.length - PAGE;
        next = next.slice(trim);
      }
      messages.value = next;
      total.value = newTotal;
      windowStart.value = Math.max(0, newTotal - next.length);
      return;
    }
  }
  messages.value = incoming;
  total.value = newTotal;
  windowStart.value = newStart;
}

let liveTimer: ReturnType<typeof setTimeout> | undefined;
let busyPoll: ReturnType<typeof setInterval> | undefined;
let unsubEvents: (() => void) | undefined;
/** Separate from paging so Load more / previous don't starve live follow. */
const following = ref(false);
let needsFollow = false;

async function liveFollow(): Promise<void> {
  if (loading.value || !props.sessionId) return;
  if (paging.value || following.value) {
    needsFollow = true;
    return;
  }
  following.value = true;
  needsFollow = false;
  try {
    const sticking = followPinned.value || isScrolledNearEnd();
    if (sticking && (isShowingLatest() || messages.value.length === 0)) {
      followPinned.value = true;
      await refreshLatestWindow(true);
      bindScrollPin();
    } else {
      // Keep the reading position; only surface that newer messages exist.
      await probeUnread();
    }
  } catch {
    // keep last good view — transient fetch errors during live watch
  } finally {
    following.value = false;
    if (needsFollow) {
      needsFollow = false;
      scheduleLiveFollow();
    }
  }
}

function scheduleLiveFollow(): void {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = undefined;
    void liveFollow();
  }, 150);
}

function syncBusyPoll(): void {
  const busy = sessionStatus.value === "running" || sessionStatus.value === "waiting";
  if (busy && !busyPoll) {
    busyPoll = setInterval(() => {
      scheduleLiveFollow();
    }, 1000);
  } else if (!busy && busyPoll) {
    clearInterval(busyPoll);
    busyPoll = undefined;
  }
}

onMounted(() => {
  unsubEvents = subscribeEvents((ev) => {
    if (ev.type === "live.status") {
      const hit = ev.statuses.find(
        (s) => s.provider === props.provider && s.id === props.sessionId,
      );
      if (hit) {
        applySessionStatus(hit.status);
      } else if (
        sessionStatus.value === "running" ||
        sessionStatus.value === "waiting" ||
        sessionStatus.value === "live"
      ) {
        applySessionStatus("idle");
      }
      syncBusyPoll();
      return;
    }
    if (ev.type !== "sessions.changed") return;
    if (ev.provider !== props.provider) return;
    scheduleLiveFollow();
  });
  syncBusyPoll();
});

onUnmounted(() => {
  unsubEvents?.();
  if (liveTimer) clearTimeout(liveTimer);
  if (busyPoll) clearInterval(busyPoll);
  scrollPinHost?.removeEventListener("scroll", onScrollPin);
  scrollPinHost = null;
});

watch(
  () => [
    props.provider,
    props.sessionId,
    props.focusMessageId,
    props.focusSeq,
    props.focusTs,
    props.focusRole,
  ],
  () => {
    sessionStatus.value = undefined;
    followPinned.value = !hasFocusTarget();
    seenTotal.value = 0;
    syncStatusFromStore();
    syncBusyPoll();
    void load();
  },
  { immediate: true },
);

watch(sessionStatus, () => syncBusyPoll());

function isSelected(i: number): boolean {
  if (!selection.value) return false;
  const abs = windowStart.value + i;
  return abs >= selection.value[0] && abs <= selection.value[1];
}

function onSelect(i: number, e: MouseEvent): void {
  const abs = windowStart.value + i;
  // plain click sets the anchor; shift-click extends to a range
  if (e.shiftKey && anchor !== undefined) {
    selection.value = [Math.min(anchor, abs), Math.max(anchor, abs)];
  } else if (selection.value && selection.value[0] === abs && selection.value[1] === abs) {
    clearSelection();
    return;
  } else {
    anchor = abs;
    selection.value = [abs, abs];
  }
  emit("selection", selection.value);
  emit("selectMessage", messages.value[i]?.id);
}

function clearSelection(): void {
  anchor = undefined;
  selection.value = undefined;
  emit("selection", undefined);
  emit("selectMessage", undefined);
}
</script>

<style scoped>
.transcript {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.t-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  font-size: var(--fs-sm);
  color: var(--text-faint);
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-bg-raised);
  z-index: 1;
}
.t-meta-left {
  min-width: 0;
  flex: 1;
}
.t-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 24px;
}
.t-jump {
  appearance: none;
  flex-shrink: 0;
  background: var(--panel-bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1;
  height: 22px;
  padding: 0 8px;
}
.t-jump:hover:not(:disabled) {
  color: var(--text);
  background: var(--node-bg-hover);
  border-color: var(--text-faint);
}
.t-jump.has-new {
  color: var(--status-running);
  border-color: var(--status-running);
  background: color-mix(in srgb, var(--status-running) 12%, transparent);
}
.t-jump.has-new:hover:not(:disabled) {
  color: var(--status-running);
  border-color: var(--status-running);
  background: color-mix(in srgb, var(--status-running) 18%, transparent);
}
.t-jump:disabled {
  opacity: 0.45;
  cursor: default;
}
.t-clear {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-xs);
}
.t-end {
  height: 0;
  width: 0;
  overflow: hidden;
}
.t-live {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 2px 6px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  user-select: none;
}
.t-live.waiting {
  color: var(--status-waiting);
}
.t-live.running {
  color: var(--text-dim);
}
.t-live-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 14px;
}
.t-live-mark i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.25;
  animation: t-live-dot 1.15s ease-in-out infinite;
}
.t-live-mark i:nth-child(2) {
  animation-delay: 0.18s;
}
.t-live-mark i:nth-child(3) {
  animation-delay: 0.36s;
}
.t-live-label {
  line-height: 1;
}
@keyframes t-live-dot {
  0%,
  80%,
  100% {
    opacity: 0.22;
    transform: translateY(0) scale(0.85);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px) scale(1);
  }
}
.t-msg {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.1s;
}
.t-msg:hover {
  border-color: var(--border-strong);
}
.t-msg.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.t-msg.focus {
  border-color: var(--lane-session);
  background: color-mix(in srgb, var(--lane-session) 14%, transparent);
}
.t-msg.synthetic {
  border-style: dashed;
}
.t-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.t-role {
  font-size: var(--fs-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.t-role.user {
  color: var(--accent);
}
.t-time {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-family: var(--mono);
  white-space: nowrap;
}
.t-copy {
  appearance: none;
  background: var(--panel-bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1;
  height: 22px;
  padding: 0 8px;
  flex-shrink: 0;
  box-shadow: var(--shadow);
}
.t-copy:hover {
  color: var(--text);
  background: var(--node-bg-hover);
  border-color: var(--text-faint);
}
.t-text {
  font-size: var(--fs-md);
  line-height: 1.55;
  overflow-wrap: break-word;
}
.t-text :deep(pre) {
  background: var(--input-bg);
  padding: 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-sm);
}
.t-text :deep(code) {
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.t-text :deep(p) {
  margin: 0.4em 0;
}
.t-plain {
  margin: 0;
  font-size: var(--fs-md);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.t-codewrap {
  position: relative;
  margin: 4px 0;
}
.t-fmt {
  position: absolute;
  top: 6px;
  right: 10px;
  opacity: 0.7;
}
.t-code {
  background: var(--input-bg);
  border: 1px solid var(--border);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  line-height: 1.5;
  margin: 0;
  white-space: pre;
}
.t-svg {
  display: grid;
  place-items: center;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px;
  margin: 4px 0;
}
.t-svg :deep(svg) {
  max-width: 100%;
  max-height: 320px;
  height: auto;
}
.t-text :deep(table) {
  display: block;
  overflow-x: auto;
  max-width: 100%;
}
.t-fold {
  margin: 4px 0;
  font-size: var(--fs-sm);
}
.t-fold summary {
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.t-fold.error summary {
  color: var(--status-error);
}
.t-pre {
  background: var(--input-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-xs);
  font-family: var(--mono);
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.t-misc {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-style: italic;
}
.t-patch {
  font-size: var(--fs-sm);
  color: var(--context);
  font-family: var(--mono);
}
.t-more {
  width: 100%;
  justify-content: center;
  margin: 8px 0;
}
</style>
