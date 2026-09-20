<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="outbound-urls-title"
        @keydown.stop="onModalKey"
      >
        <header class="modal-head">
          <div id="outbound-urls-title" class="modal-title">↗ Outbound URLs</div>
          <button type="button" class="modal-close" title="Close" @click="emit('close')">✕</button>
        </header>

        <div class="modal-body">
          <div class="ou-toolbar">
            <input
              ref="searchEl"
              v-model="query"
              class="threadle-input ou-search"
              placeholder="Filter URL or domain…"
              spellcheck="false"
            />

            <div class="ou-dd ou-dd-domain" ref="domainDdEl">
              <button
                type="button"
                class="ou-dd-trigger"
                :class="{ open: openDd === 'domain' }"
                :disabled="!domains.length"
                :title="domainFilter || 'all domains'"
                @click.stop="toggleDd('domain')"
              >
                <span class="ou-dd-label mono">{{ domainTriggerLabel }}</span>
                <span class="ou-dd-chev" aria-hidden="true">▾</span>
              </button>
              <div v-if="openDd === 'domain'" class="ou-dd-pop menu-pop" @click.stop>
                <div class="ou-dd-title micro-label mono">domain</div>
                <button
                  type="button"
                  class="menu-item"
                  :class="{ active: !domainFilter }"
                  @click="pickDomain('')"
                >
                  all domains
                  <em>{{ domains.length }}</em>
                </button>
                <button
                  v-for="d in domains"
                  :key="d"
                  type="button"
                  class="menu-item"
                  :class="{ active: domainFilter === d }"
                  :title="d"
                  @click="pickDomain(d)"
                >
                  <span class="ou-dd-item-label">{{ d }}</span>
                  <em>{{ domainCounts[d] ?? 0 }}</em>
                </button>
              </div>
            </div>

            <div class="ou-dd" ref="toolDdEl">
              <button
                type="button"
                class="ou-dd-trigger"
                :class="{ open: openDd === 'tool' }"
                :disabled="!tools.length"
                :title="toolFilter || 'all tools'"
                @click.stop="toggleDd('tool')"
              >
                <span class="ou-dd-label mono">{{ toolTriggerLabel }}</span>
                <span class="ou-dd-chev" aria-hidden="true">▾</span>
              </button>
              <div v-if="openDd === 'tool'" class="ou-dd-pop menu-pop" @click.stop>
                <div class="ou-dd-title micro-label mono">tool</div>
                <button
                  type="button"
                  class="menu-item"
                  :class="{ active: !toolFilter }"
                  @click="pickTool('')"
                >
                  all tools
                  <em>{{ tools.length }}</em>
                </button>
                <button
                  v-for="t in tools"
                  :key="t"
                  type="button"
                  class="menu-item"
                  :class="{ active: toolFilter === t }"
                  :title="t"
                  @click="pickTool(t)"
                >
                  <span class="ou-dd-item-label">{{ t }}</span>
                  <em>{{ toolCounts[t] ?? 0 }}</em>
                </button>
              </div>
            </div>
          </div>

          <div class="ou-meta micro-label">
            <span>
              {{ filtered.length }}
              <template v-if="filtered.length !== hits.length"> / {{ hits.length }}</template>
              URL{{ filtered.length === 1 ? "" : "s" }}
              <template v-if="loading"> · scanning transcript…</template>
            </span>
            <span class="ou-meta-actions">
              <button
                type="button"
                class="vsc-btn"
                :disabled="!filtered.length"
                title="Copy filtered URLs (one per line)"
                @click="copyFiltered"
              >
                {{ copied ? "copied" : "copy" }}
              </button>
            </span>
          </div>

          <div v-if="loading && !hits.length" class="ou-load">
            <GraphLoadingOverlay loading label="Scanning transcript" />
          </div>
          <div v-else-if="!hits.length" class="ou-empty">
            No outbound http(s) URLs found in tool calls for this session.
          </div>
          <div v-else-if="!filtered.length" class="ou-empty">No URLs match the current filters.</div>
          <div v-else class="ou-list" role="list">
            <div class="ou-row ou-head micro-label" role="row">
              <button
                type="button"
                class="ou-th ou-domain-col"
                :class="{ active: sort.key === 'domain' }"
                @click="toggleSort('domain')"
              >
                domain{{ sortArrow('domain') }}
              </button>
              <button
                type="button"
                class="ou-th ou-url-col"
                :class="{ active: sort.key === 'url' }"
                @click="toggleSort('url')"
              >
                url{{ sortArrow('url') }}
              </button>
              <button
                type="button"
                class="ou-th ou-tool-col"
                :class="{ active: sort.key === 'tool' }"
                @click="toggleSort('tool')"
              >
                tool{{ sortArrow('tool') }}
              </button>
              <button
                type="button"
                class="ou-th ou-count-col"
                :class="{ active: sort.key === 'count' }"
                @click="toggleSort('count')"
              >
                n{{ sortArrow('count') }}
              </button>
            </div>
            <a
              v-for="h in filtered"
              :key="h.url"
              class="ou-row"
              role="listitem"
              :href="h.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="h.sample ? `${h.url}\n${h.sample}` : h.url"
              @click="onUrlClick($event, h)"
            >
              <span class="ou-domain-col mono">{{ h.domain }}</span>
              <span class="ou-url-col mono">{{ h.url }}</span>
              <span class="ou-tool-col mono">{{ h.tools.join(", ") }}</span>
              <span class="ou-count-col mono">{{ h.count }}</span>
            </a>
          </div>
        </div>

        <footer class="modal-foot">
          <button type="button" class="threadle-btn" @click="emit('close')">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>
  <ConfirmModal v-model="confirmDlg" @confirm="onConfirmOpen" @cancel="pendingUrl = undefined" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { api } from "@/api/client";
import { copyToClipboard } from "@/lib/pathActions";
import ConfirmModal, { type ConfirmModel } from "@/panels/ConfirmModal.vue";
import GraphLoadingOverlay from "@/components/GraphLoadingOverlay.vue";
import {
  collectOutboundFromTools,
  mergeOutboundFromMessages,
  uniqueDomains,
  type BlueprintToolSource,
  type OutboundUrlHit,
} from "@/lib/outboundUrls";

type SortKey = "domain" | "url" | "tool" | "count";

const props = defineProps<{
  provider: string;
  sessionId: string;
  tools: BlueprintToolSource[];
}>();

const emit = defineEmits<{ close: [] }>();

const hits = ref<OutboundUrlHit[]>([]);
const loading = ref(false);
const query = ref("");
const domainFilter = ref("");
const toolFilter = ref("");
const copied = ref(false);
const openDd = ref<"domain" | "tool" | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const domainDdEl = ref<HTMLElement | null>(null);
const toolDdEl = ref<HTMLElement | null>(null);
/** Default matches `sortHits` in outboundUrls.ts (domain, then url). */
const sort = reactive<{ key: SortKey; dir: 1 | -1 }>({ key: "domain", dir: 1 });
const confirmDlg = ref<ConfirmModel>();
const pendingUrl = ref<string>();
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let cancelled = false;

function onUrlClick(e: MouseEvent, h: OutboundUrlHit): void {
  // Let modified / middle-clicks use the native href behavior.
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  pendingUrl.value = h.url;
  confirmDlg.value = {
    title: "Open URL",
    emphasis: h.domain,
    body: " — leave threadle and open this site?",
    detail: h.url,
    confirmLabel: "Open",
    cancelLabel: "Cancel",
  };
}

function onConfirmOpen(): void {
  const url = pendingUrl.value;
  pendingUrl.value = undefined;
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function toggleSort(key: SortKey): void {
  if (sort.key === key) sort.dir = (sort.dir * -1) as 1 | -1;
  else {
    sort.key = key;
    // counts default desc; text columns default asc
    sort.dir = key === "count" ? -1 : 1;
  }
}

function sortArrow(key: SortKey): string {
  if (sort.key !== key) return "";
  return sort.dir === -1 ? " ▾" : " ▴";
}

function sortValue(h: OutboundUrlHit, key: SortKey): string | number {
  switch (key) {
    case "domain":
      return h.domain;
    case "url":
      return h.url;
    case "tool":
      return h.tools.join(", ");
    case "count":
      return h.count;
  }
}

const domains = computed(() => uniqueDomains(hits.value));
const tools = computed(() =>
  [...new Set(hits.value.flatMap((h) => h.tools))].sort((a, b) => a.localeCompare(b)),
);

const domainCounts = computed(() => {
  const m: Record<string, number> = {};
  for (const h of hits.value) m[h.domain] = (m[h.domain] ?? 0) + 1;
  return m;
});

const toolCounts = computed(() => {
  const m: Record<string, number> = {};
  for (const h of hits.value) {
    for (const t of h.tools) m[t] = (m[t] ?? 0) + 1;
  }
  return m;
});

const domainTriggerLabel = computed(() =>
  domainFilter.value
    ? domainFilter.value
    : domains.value.length
      ? `all domains (${domains.value.length})`
      : "all domains",
);

const toolTriggerLabel = computed(() =>
  toolFilter.value
    ? toolFilter.value
    : tools.value.length
      ? `all tools (${tools.value.length})`
      : "all tools",
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const rows = hits.value.filter((h) => {
    if (domainFilter.value && h.domain !== domainFilter.value) return false;
    if (toolFilter.value && !h.tools.includes(toolFilter.value)) return false;
    if (!q) return true;
    return (
      h.url.toLowerCase().includes(q) ||
      h.domain.toLowerCase().includes(q) ||
      h.tools.some((t) => t.toLowerCase().includes(q)) ||
      (h.sample?.toLowerCase().includes(q) ?? false)
    );
  });
  const { key, dir } = sort;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const c =
      typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
    if (c !== 0) return c * dir;
    // stable tie-breakers
    return a.domain.localeCompare(b.domain) || a.url.localeCompare(b.url);
  });
});

watch([domains, tools], () => {
  if (domainFilter.value && !domains.value.includes(domainFilter.value)) {
    domainFilter.value = "";
  }
  if (toolFilter.value && !tools.value.includes(toolFilter.value)) {
    toolFilter.value = "";
  }
});

function toggleDd(which: "domain" | "tool"): void {
  openDd.value = openDd.value === which ? null : which;
}

function pickDomain(d: string): void {
  domainFilter.value = d;
  openDd.value = null;
}

function pickTool(t: string): void {
  toolFilter.value = t;
  openDd.value = null;
}

function closeDd(): void {
  openDd.value = null;
}

async function copyFiltered(): Promise<void> {
  const text = filtered.value.map((h) => h.url).join("\n");
  if (!text) return;
  await copyToClipboard(text);
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
  }, 1200);
}

function seedFromTools(): void {
  hits.value = collectOutboundFromTools(props.tools);
}

async function enrichFromTranscript(): Promise<void> {
  loading.value = true;
  try {
    const page = 400;
    let offset = 0;
    let total = Infinity;
    while (!cancelled && offset < total) {
      const res = await api.transcript(props.provider, props.sessionId, offset, page, true);
      total = res.total;
      if (!res.messages.length) break;
      hits.value = mergeOutboundFromMessages(hits.value, res.messages);
      offset += res.messages.length;
      if (res.messages.length < page) break;
    }
  } catch {
    /* blueprint seed is enough if transcript fails */
  } finally {
    if (!cancelled) loading.value = false;
  }
}

function onModalKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  if (confirmDlg.value) return;
  e.stopPropagation();
  if (openDd.value) {
    closeDd();
    return;
  }
  emit("close");
}

function onDocPointer(e: MouseEvent): void {
  if (!openDd.value) return;
  const t = e.target as Node | null;
  if (domainDdEl.value?.contains(t) || toolDdEl.value?.contains(t)) return;
  closeDd();
}

onMounted(() => {
  seedFromTools();
  document.addEventListener("mousedown", onDocPointer);
  void nextTick(() => searchEl.value?.focus());
  void enrichFromTranscript();
});

onUnmounted(() => {
  cancelled = true;
  document.removeEventListener("mousedown", onDocPointer);
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: grid;
  place-items: center;
  z-index: 220;
}
.modal {
  width: min(860px, calc(100vw - 32px));
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 10px;
  flex-shrink: 0;
}
.modal-title {
  font-weight: 600;
  font-size: var(--fs-xl);
}
.modal-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--fs-lg);
}
.modal-close:hover {
  color: var(--text);
}
.modal-body {
  padding: 0 18px 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 18px;
  flex-shrink: 0;
}

.ou-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.85fr) minmax(130px, 0.4fr);
  gap: 8px;
  align-items: start;
}
.ou-search {
  min-width: 0;
}

.ou-dd {
  position: relative;
  min-width: 0;
}
.ou-dd-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 8px 0 10px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--fs-sm);
  cursor: pointer;
  outline: none;
}
.ou-dd-trigger:hover:not(:disabled) {
  border-color: var(--border-strong);
}
.ou-dd-trigger.open,
.ou-dd-trigger:focus-visible {
  border-color: var(--accent);
}
.ou-dd-trigger:disabled {
  opacity: 0.4;
  cursor: default;
}
.ou-dd-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.ou-dd-trigger.open .ou-dd-label,
.ou-dd-trigger:not(:disabled):hover .ou-dd-label {
  color: var(--text);
}
.ou-dd-chev {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  line-height: 1;
}
.ou-dd-pop {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 30;
  min-width: 100%;
  max-height: min(360px, 50vh);
  overflow-y: auto;
  background: var(--panel-bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.ou-dd-domain .ou-dd-pop {
  right: auto;
  min-width: max(100%, 280px);
  width: max-content;
  max-width: min(420px, 70vw);
  max-height: min(480px, 65vh);
}
.ou-dd-title {
  padding: 5px 9px 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 3px;
  color: var(--text-faint);
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  color: var(--text);
  cursor: pointer;
}
.menu-item:hover {
  background: var(--accent-soft);
}
.menu-item.active {
  background: var(--hover-overlay);
  color: var(--text);
}
.menu-item em {
  flex-shrink: 0;
  font-style: normal;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.ou-dd-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ou-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-faint);
}
.ou-meta-actions {
  display: flex;
  gap: 6px;
}
.ou-empty {
  padding: 28px 8px;
  text-align: center;
  color: var(--text-faint);
  font-size: var(--fs-sm);
}
.ou-load {
  position: relative;
  flex: 1;
  min-height: 12rem;
}
.ou-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.ou-row {
  display: grid;
  grid-template-columns: minmax(100px, 0.35fr) minmax(0, 1fr) minmax(72px, 0.28fr) 36px;
  gap: 10px;
  align-items: center;
  padding: 7px 10px;
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid var(--border);
}
.ou-row:last-child {
  border-bottom: none;
}
.ou-row:not(.ou-head):hover {
  background: var(--hover-overlay);
}
.ou-head {
  position: sticky;
  top: 0;
  background: var(--panel-bg-raised, var(--panel-bg));
  z-index: 1;
  color: var(--text-faint);
  border-bottom: 1px solid var(--border-strong);
}
.ou-th {
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: inherit;
  cursor: pointer;
  text-align: inherit;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ou-th:hover,
.ou-th.active {
  color: var(--text);
}
.ou-domain-col,
.ou-url-col,
.ou-tool-col {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
}
.ou-domain-col {
  color: var(--text-dim);
}
.ou-url-col {
  color: var(--text);
}
.ou-tool-col {
  color: var(--text-dim);
  text-align: right;
}
.ou-count-col {
  text-align: right;
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.ou-head .ou-domain-col,
.ou-head .ou-url-col,
.ou-head .ou-tool-col,
.ou-head .ou-count-col {
  color: inherit;
  font-size: inherit;
}
</style>
