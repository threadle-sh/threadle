<template>
  <div class="output-node" :class="{ selected, [`run-${status}`]: status && status !== 'idle' }">
    <NodeResizer
      :is-visible="selected"
      :min-width="240"
      :min-height="140"
      color="var(--border-strong)"
      @resize-end="onResizeEnd"
    />
    <InboundHandle :node-id="id" />

    <div class="o-head">
      <span class="o-icon">⇤</span>
      <EditableNodeTitle
        :label="data.label"
        fallback="Output"
        @update:label="(v) => (data.label = v)"
      />
      <span v-if="data.content" class="o-mode-badge">{{ effectiveMode }}</span>
      <span class="o-spacer" />
      <select
        class="o-mode nodrag"
        :value="data.renderMode ?? 'auto'"
        title="Render mode"
        @change="onMode"
      >
        <option value="auto">auto</option>
        <option value="text">text</option>
        <option value="markdown">markdown</option>
        <option value="html">html</option>
        <option value="svg">svg</option>
      </select>
      <button
        class="o-refresh nodrag"
        :disabled="!data.content"
        :title="copied ? 'Copied' : 'Copy output text'"
        @click="copy"
      >
        {{ copied ? "✓" : "❐" }}
      </button>
      <button
        class="o-refresh nodrag"
        :disabled="refreshing"
        title="Pull text from the wired source (session last message, or upstream prompt/knot)"
        @click="refresh"
      >
        {{ refreshing ? "…" : "↻" }}
      </button>
      <button
        class="o-refresh nodrag"
        :disabled="!data.content && !data.preview && !error"
        title="Clear output"
        @click="clear"
      >
        ⌫
      </button>
    </div>

    <div class="o-body nodrag nowheel">
      <div v-if="error" class="o-error">{{ error }}</div>
      <div v-else-if="!data.content" class="o-empty">
        Wire a source in, then press ↻ — or run the graph.
      </div>
      <div
        v-else-if="effectiveMode === 'svg'"
        class="o-svg"
        v-html="svgContent"
      />
      <iframe
        v-else-if="effectiveMode === 'html'"
        class="o-html"
        sandbox=""
        :srcdoc="htmlContent"
      />
      <div
        v-else-if="effectiveMode === 'markdown'"
        class="o-md"
        v-html="mdContent"
      />
      <pre v-else class="o-text">{{ data.content }}</pre>
    </div>

    <Handle type="source" :position="Position.Right" title="out"
      class="threadle-handle wire-output" />
    <NodeDurationBadge :node-id="id" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { Handle, Position, useVueFlow } from "@vue-flow/core";
import { NodeResizer } from "@vue-flow/node-resizer";
import type {
  DataNodeData,
  GraphNodeData,
  KnotNodeData,
  NodeStatus,
  OutputNodeData,
  OutputRenderMode,
  PromptConvertNodeData,
  PromptNodeData,
  SessionNodeData,
} from "@threadle/shared";
import { coerceValue, mergeKnotTexts } from "@threadle/shared";
import { api } from "@/api/client";
import { copyToClipboard } from "@/lib/pathActions";
import { renderMd, safeSvg, sanitizeHtmlDocument } from "@/lib/safeHtml";
import InboundHandle from "./InboundHandle.vue";
import NodeDurationBadge from "./NodeDurationBadge.vue";
import EditableNodeTitle from "./EditableNodeTitle.vue";

const props = defineProps<{
  id: string;
  data: OutputNodeData;
  selected?: boolean;
  status?: NodeStatus;
}>();

const { edges, findNode } = useVueFlow();
const refreshing = ref(false);
const error = ref<string>();
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const MAX_CONTENT = 200_000;

/** Resolve displayable text from a node without running the full graph. */
async function textFromNode(nodeId: string, depth = 0): Promise<string | undefined> {
  if (depth > 8) return undefined;
  const src = findNode(nodeId);
  const d = src?.data as GraphNodeData | undefined;
  if (!d) return undefined;

  if (d.type === "prompt") {
    const t = (d as PromptNodeData).text?.trim();
    return t || undefined;
  }
  if (d.type === "output") {
    const t = (d as OutputNodeData).content?.trim();
    return t || undefined;
  }
  if (d.type === "session" || d.type === "subagent-run") {
    const ref = (d as SessionNodeData).ref;
    const t = await api.transcript(ref.provider, ref.sessionId, 0, 1000);
    const last = t.messages.filter((m) => m.role === "assistant").at(-1);
    const text = last?.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    return text || undefined;
  }
  if (d.type === "knot") {
    const kd = d as KnotNodeData;
    const inbound = edges.value.filter((e) => e.target === nodeId);
    const parts: string[] = [];
    for (const e of inbound) {
      const t = await textFromNode(e.source, depth + 1);
      if (t) parts.push(t);
    }
    if (!parts.length) return undefined;
    return mergeKnotTexts(parts, kd.strategy, { separator: kd.separator });
  }
  if (d.type === "prompt-convert") {
    const inbound = edges.value.filter((e) => e.target === nodeId);
    const parts: string[] = [];
    for (const e of inbound) {
      const t = await textFromNode(e.source, depth + 1);
      if (t) parts.push(t);
    }
    if (!parts.length) return undefined;
    const input = parts.join("\n\n");
    const tpl = (d as PromptConvertNodeData).template ?? "";
    return tpl.includes("{{input}}")
      ? tpl.replaceAll("{{input}}", input)
      : tpl.trim()
        ? `${tpl}\n\n${input}`
        : input;
  }
  if (d.type === "data") {
    const inbound = edges.value.filter((e) => e.target === nodeId);
    const parts: string[] = [];
    for (const e of inbound) {
      const t = await textFromNode(e.source, depth + 1);
      if (t) parts.push(t);
    }
    const raw = parts.length ? parts.join("\n\n") : ((d as DataNodeData).value ?? "");
    if (!raw) return undefined;
    const coerced = coerceValue(raw, (d as DataNodeData).valueType ?? "text");
    return "error" in coerced ? undefined : coerced.value;
  }
  if (d.type === "tripwire" || d.type === "judge" || d.type === "approval" || d.type === "live-handoff" || d.type === "delay") {
    const inbound = edges.value.filter((e) => e.target === nodeId);
    const parts: string[] = [];
    for (const e of inbound) {
      const t = await textFromNode(e.source, depth + 1);
      if (t) parts.push(t);
    }
    return parts.length ? parts.join("\n\n---\n\n") : undefined;
  }
  return undefined;
}

// ---- content-type detection ----

const FENCE_RE = /```(svg|html|xml)?\s*\n([\s\S]*?)```/i;

/** First fenced block whose content looks like svg/html, if any. */
function fencedPayload(content: string): { kind: "svg" | "html"; body: string } | undefined {
  const m = FENCE_RE.exec(content);
  if (!m) return undefined;
  const body = (m[2] ?? "").trim();
  if (/^<svg[\s>]/i.test(body)) return { kind: "svg", body };
  if (m[1]?.toLowerCase() === "html" || /^<!doctype html|^<html[\s>]/i.test(body)) {
    return { kind: "html", body };
  }
  return undefined;
}

const MD_RE =
  /(^|\n)#{1,6}\s|\*\*[^*]+\*\*|(^|\n)\s*[-*]\s+\S|(^|\n)\s*\d+\.\s+\S|\[[^\]]+\]\([^)]+\)|```/;

function detect(content: string): Exclude<OutputRenderMode, "auto"> {
  const t = content.trim();
  if (/^<svg[\s>]/i.test(t)) return "svg";
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return "html";
  const fenced = fencedPayload(t);
  if (fenced) return fenced.kind;
  if (MD_RE.test(t)) return "markdown";
  return "text";
}

const effectiveMode = computed<Exclude<OutputRenderMode, "auto">>(() => {
  const mode = props.data.renderMode ?? "auto";
  if (mode !== "auto") return mode;
  return props.data.content ? detect(props.data.content) : "text";
});

const svgContent = computed(() => {
  const c = props.data.content?.trim() ?? "";
  const body = /^<svg[\s>]/i.test(c) ? c : (fencedPayload(c)?.body ?? c);
  return safeSvg(body);
});

const htmlContent = computed(() => {
  const c = props.data.content?.trim() ?? "";
  const body = /^<!doctype html|^<html[\s>]/i.test(c)
    ? c
    : (fencedPayload(c)?.body ?? c);
  return sanitizeHtmlDocument(body);
});

const mdContent = computed(() => renderMd(props.data.content ?? ""));

// ---- interactions ----

function onMode(e: Event): void {
  const v = (e.target as HTMLSelectElement).value as OutputRenderMode;
  props.data.renderMode = v === "auto" ? undefined : v;
}

function onResizeEnd(e: { params: { width: number; height: number } }): void {
  props.data.size = { width: e.params.width, height: e.params.height };
}

/** Pull text from whatever is wired in (session last message, prompt, knot, …). */
async function refresh(): Promise<void> {
  error.value = undefined;
  const inbound = edges.value.filter((e) => e.target === props.id);
  if (!inbound.length) {
    error.value = "nothing wired in";
    return;
  }
  refreshing.value = true;
  try {
    const parts: string[] = [];
    for (const e of inbound) {
      const t = await textFromNode(e.source);
      if (t) parts.push(t);
    }
    if (!parts.length) {
      error.value = "upstream has no text — run the graph, or wire a prompt/session";
      return;
    }
    const text = parts.join("\n\n---\n\n");
    props.data.content = text.length > MAX_CONTENT ? text.slice(0, MAX_CONTENT) : text;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    refreshing.value = false;
  }
}

function clear(): void {
  error.value = undefined;
  props.data.content = undefined;
  props.data.preview = undefined;
}

async function copy(): Promise<void> {
  const text = props.data.content;
  if (!text) return;
  const ok = await copyToClipboard(text);
  if (!ok) return;
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, 1200);
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<style scoped>
.output-node {
  width: 100%;
  height: 100%;
  min-width: 240px;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  background: var(--node-bg);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  transition: border-color 0.12s;
  position: relative;
}
.output-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
}
.o-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.o-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--panel-bg-raised);
  color: var(--status-running);
  display: grid;
  place-items: center;
  font-size: var(--fs-md);
  font-weight: 700;
  flex: 0 0 auto;
}
.o-mode-badge {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 6px;
}
.o-spacer {
  flex: 1;
}
.o-mode {
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-dim);
  font-size: var(--fs-2xs);
  padding: 2px 4px;
  outline: none;
}
.o-refresh {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  width: 22px;
  height: 22px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.o-refresh:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
}
.o-refresh:disabled {
  opacity: 0.35;
  cursor: default;
}
.o-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
}
.o-empty {
  font-size: var(--fs-xs);
  color: var(--text-faint);
  font-style: italic;
}
.o-error {
  font-size: var(--fs-xs);
  color: var(--status-error);
}
.o-text {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.o-md {
  font-size: var(--fs-sm);
  line-height: 1.55;
}
.o-md :deep(pre) {
  background: var(--input-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--fs-xs);
}
.o-md :deep(code) {
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.o-md :deep(p) {
  margin: 0.4em 0;
}
.o-md :deep(h1),
.o-md :deep(h2),
.o-md :deep(h3) {
  margin: 0.6em 0 0.3em;
  font-size: 1.1em;
}
.o-md :deep(table) {
  border-collapse: collapse;
  font-size: var(--fs-xs);
}
.o-md :deep(td),
.o-md :deep(th) {
  border: 1px solid var(--border);
  padding: 3px 8px;
}
.o-svg {
  height: 100%;
  display: grid;
  place-items: center;
}
.o-svg :deep(svg) {
  max-width: 100%;
  max-height: 100%;
  height: auto;
}
.o-html {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: var(--radius-sm);
  background: #fff;
}
.threadle-handle {
  width: 10px;
  height: 10px;
  background: var(--node-bg);
  border: 2px solid var(--accent);
}
</style>

<style>
/* node-resizer handles, restyled to the theme (unscoped: rendered on wrapper) */
.vue-flow__resize-control.handle {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--panel-bg-raised);
  border: 1px solid var(--border-strong);
}
.vue-flow__resize-control.line {
  border-color: transparent;
}
</style>
