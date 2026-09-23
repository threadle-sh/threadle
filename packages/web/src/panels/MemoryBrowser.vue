<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { relativeTime } from "@/lib/format";
import {
  providerColor,
  providerColorHex,
  providerLabel,
} from "@/lib/providers";
import { useFileViewersStore } from "@/stores/fileViewers";
import { useSettingsStore } from "@/stores/settings";
import { vColResize } from "@/lib/colResize";
import DetailExpandControls from "@/panels/DetailExpandControls.vue";
import "@/views/dashboard/chrome.css";

export interface MemoryEntry {
  provider: string;
  scope: string;
  slug: string;
  path: string;
  name: string;
  bytes: number;
  mtime: number;
  kind: "index" | "topic" | "observation" | "archive" | "stage1" | "other";
}

const props = defineProps<{
  filter: string;
  providerFilter: string;
}>();

const emit = defineEmits<{
  loaded: [count: number];
}>();

const RANGES = [
  { id: "24h", label: "24h", ms: 24 * 3_600_000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 3_600_000 },
  { id: "30d", label: "30d", ms: 30 * 24 * 3_600_000 },
  { id: "all", label: "all", ms: Infinity },
] as const;

type MemoryRangeId = (typeof RANGES)[number]["id"];

const fileViewers = useFileViewersStore();
const settings = useSettingsStore();
const items = ref<MemoryEntry[] | undefined>(undefined);
const picked = ref<MemoryEntry>();
const hover = ref<IcicleRect>();
const expanded = ref(false);
/** Zoom focus — node id in the partition tree (`root` = full view) */
const focusId = ref("root");
/** Same chips as Timeline — filter by entry mtime */
const range = ref<MemoryRangeId>("all");
const memCtx = ref<{ x: number; y: number; entry: MemoryEntry }>();
let ctxIgnoreClick = false;

const asideFrameEl = ref<HTMLElement>();
const expandFrameEl = ref<HTMLElement>();
const asideSize = ref({ w: 400, h: 260 });
const expandSize = ref({ w: 960, h: 520 });

let asideRo: ResizeObserver | undefined;
let expandRo: ResizeObserver | undefined;

async function load(): Promise<void> {
  try {
    const res = await fetch("/api/memory");
    items.value = (await res.json()) as MemoryEntry[];
  } catch {
    items.value = [];
  }
  emit("loaded", items.value.length);
}

onMounted(() => {
  void load();
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", dismissCtx);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("click", dismissCtx);
  asideRo?.disconnect();
  expandRo?.disconnect();
});

watch(
  () => items.value?.length,
  (n) => {
    if (n != null) emit("loaded", n);
  },
);

watch(
  () => [props.filter, props.providerFilter, range.value] as const,
  () => {
    focusId.value = "root";
  },
);

watch(asideFrameEl, (el) => {
  asideRo?.disconnect();
  if (!el) return;
  asideRo = new ResizeObserver((entries) => {
    const cr = entries[0]?.contentRect;
    if (!cr) return;
    asideSize.value = {
      w: Math.max(120, Math.floor(cr.width)),
      h: Math.max(160, Math.floor(cr.height)),
    };
  });
  asideRo.observe(el);
});

watch(expandFrameEl, (el) => {
  expandRo?.disconnect();
  if (!el) return;
  expandRo = new ResizeObserver((entries) => {
    const cr = entries[0]?.contentRect;
    if (!cr) return;
    expandSize.value = {
      w: Math.max(320, Math.floor(cr.width)),
      h: Math.max(240, Math.floor(cr.height)),
    };
  });
  expandRo.observe(el);
});

const filtered = computed(() => {
  const q = props.filter.trim().toLowerCase();
  const pf = props.providerFilter;
  const rangeSpec = RANGES.find((r) => r.id === range.value) ?? RANGES[3];
  const cutoff =
    rangeSpec.ms === Infinity ? 0 : Date.now() - rangeSpec.ms;
  return (items.value ?? []).filter((e) => {
    if (pf && pf !== "all" && e.provider !== pf) return false;
    if (cutoff > 0 && !(e.mtime >= cutoff)) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.scope.toLowerCase().includes(q) ||
      e.slug.toLowerCase().includes(q) ||
      e.kind.includes(q) ||
      e.provider.toLowerCase().includes(q)
    );
  });
});

interface ScopeGroup {
  scope: string;
  slug: string;
  provider: string;
  entries: MemoryEntry[];
}

const groups = computed((): ScopeGroup[] => {
  const map = new Map<string, ScopeGroup>();
  for (const e of filtered.value) {
    const key = `${e.provider}\0${e.slug}`;
    let g = map.get(key);
    if (!g) {
      g = { scope: e.scope, slug: e.slug, provider: e.provider, entries: [] };
      map.set(key, g);
    }
    g.entries.push(e);
  }
  return [...map.values()].sort((a, b) => a.scope.localeCompare(b.scope));
});

interface TreeNode {
  id: string;
  parentId: string | null;
  label: string;
  detail: string;
  bytes: number;
  provider: string;
  depth: number;
  entry?: MemoryEntry;
  children: TreeNode[];
  x0: number;
  x1: number;
}

interface IcicleRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  detail: string;
  bytes: number;
  provider: string;
  path?: string;
  entry?: MemoryEntry;
  depth: number;
  /** Depth relative to zoom focus (0 = focus row) */
  relDepth: number;
  zoomable: boolean;
}

const GAP = 1.5;
/** Max sibling bars before folding into `other · N` (zoomable) */
const ICICLE_TOP_K = 16;
/** At most this many depth bands on screen; deeper levels need zoom */
const ICICLE_MAX_BANDS = 3;

function leafNode(
  e: MemoryEntry,
  parentId: string,
  depth: number,
): TreeNode {
  return {
    id: `f:${e.path}`,
    parentId,
    label: e.name.replace(/\.md$/i, "").split("/").pop() || e.name,
    detail: e.name,
    bytes: Math.max(e.bytes, 1),
    provider: e.provider,
    depth,
    entry: e,
    children: [],
    x0: 0,
    x1: 0,
  };
}

function folderBucket(
  id: string,
  parentId: string,
  label: string,
  detail: string,
  provider: string,
  depth: number,
  entries: MemoryEntry[],
): TreeNode {
  const node: TreeNode = {
    id,
    parentId,
    label,
    detail,
    bytes: entries.reduce((s, e) => s + Math.max(e.bytes, 1), 0) || 1,
    provider,
    depth,
    children: [],
    x0: 0,
    x1: 0,
  };
  for (const e of [...entries].sort(
    (a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name),
  )) {
    node.children.push(leafNode(e, id, depth + 1));
  }
  return node;
}

/** Keep top-K by bytes; fold the rest under a zoomable `other · N` node */
function capChildren(parent: TreeNode, k: number): void {
  for (const c of parent.children) capChildren(c, k);
  if (parent.children.length <= k) return;
  const sorted = [...parent.children].sort(
    (a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label),
  );
  const keep = sorted.slice(0, k);
  const rest = sorted.slice(k);
  const otherId = `${parent.id}:other`;
  const other: TreeNode = {
    id: otherId,
    parentId: parent.id,
    label: `other · ${rest.length}`,
    detail: `${rest.length} more under ${parent.label}`,
    bytes: rest.reduce((s, c) => s + c.bytes, 0) || 1,
    provider: parent.provider,
    depth: parent.depth + 1,
    children: [],
    x0: 0,
    x1: 0,
  };
  for (const r of rest) {
    reparentDepth(r, otherId, other.depth + 1);
    other.children.push(r);
  }
  parent.children = [...keep, other];
}

function reparentDepth(node: TreeNode, parentId: string, depth: number): void {
  node.parentId = parentId;
  node.depth = depth;
  for (const c of node.children) reparentDepth(c, node.id, depth + 1);
}

function subtreeHasPath(node: TreeNode, filePath: string): boolean {
  if (node.entry?.path === filePath) return true;
  return node.children.some((c) => subtreeHasPath(c, filePath));
}

function maxDepthOf(node: TreeNode): number {
  let m = node.id === "root" ? -1 : node.depth;
  for (const c of node.children) m = Math.max(m, maxDepthOf(c));
  return m;
}

/**
 * Scope children: MEMORY.md + folder buckets (topics / observations / archive)
 * so archive mass is one bar until zoomed — not a 100-file comb.
 */
function buildScopeChildren(
  sNode: TreeNode,
  slist: MemoryEntry[],
): void {
  const index: MemoryEntry[] = [];
  const topics: MemoryEntry[] = [];
  const observations: MemoryEntry[] = [];
  const archive: MemoryEntry[] = [];
  const loose: MemoryEntry[] = [];

  for (const e of slist) {
    if (e.kind === "index" || e.name === "MEMORY.md" || e.name.endsWith("/MEMORY.md")) {
      index.push(e);
      continue;
    }
    if (e.kind === "archive" || e.name.startsWith("archive/")) {
      archive.push(e);
      continue;
    }
    if (e.kind === "observation" || e.name.startsWith("observations/")) {
      observations.push(e);
      continue;
    }
    if (e.kind === "topic" || e.name.startsWith("topics/")) {
      topics.push(e);
      continue;
    }
    // stage1 / flat Claude topics land here
    if (e.name.includes("/")) loose.push(e);
    else topics.push(e);
  }

  for (const e of index) {
    sNode.children.push(leafNode(e, sNode.id, sNode.depth + 1));
  }
  if (topics.length === 1 && !observations.length && !archive.length && !loose.length) {
    sNode.children.push(leafNode(topics[0]!, sNode.id, sNode.depth + 1));
  } else if (topics.length) {
    sNode.children.push(
      folderBucket(
        `${sNode.id}:topics`,
        sNode.id,
        "topics",
        `${topics.length} topic${topics.length === 1 ? "" : "s"}`,
        sNode.provider,
        sNode.depth + 1,
        topics,
      ),
    );
  }
  if (observations.length) {
    sNode.children.push(
      folderBucket(
        `${sNode.id}:observations`,
        sNode.id,
        "observations",
        `${observations.length} observation${observations.length === 1 ? "" : "s"}`,
        sNode.provider,
        sNode.depth + 1,
        observations,
      ),
    );
  }
  if (archive.length) {
    sNode.children.push(
      folderBucket(
        `${sNode.id}:archive`,
        sNode.id,
        "archive",
        `${archive.length} archived`,
        sNode.provider,
        sNode.depth + 1,
        archive,
      ),
    );
  }
  for (const e of loose) {
    sNode.children.push(leafNode(e, sNode.id, sNode.depth + 1));
  }
}

function buildTree(rows: MemoryEntry[]): TreeNode {
  const root: TreeNode = {
    id: "root",
    parentId: null,
    label: "memory",
    detail: "all",
    bytes: 0,
    provider: "",
    depth: -1,
    children: [],
    x0: 0,
    x1: 1,
  };

  const byProv = new Map<string, MemoryEntry[]>();
  for (const e of rows) {
    const list = byProv.get(e.provider) ?? [];
    list.push(e);
    byProv.set(e.provider, list);
  }

  for (const [prov, list] of [...byProv.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const pNode: TreeNode = {
      id: `p:${prov}`,
      parentId: "root",
      label: providerLabel(prov),
      detail: `${list.length} file${list.length === 1 ? "" : "s"}`,
      bytes: list.reduce((s, e) => s + Math.max(e.bytes, 1), 0),
      provider: prov,
      depth: 0,
      children: [],
      x0: 0,
      x1: 0,
    };

    const byScope = new Map<string, MemoryEntry[]>();
    for (const e of list) {
      const sl = byScope.get(e.slug) ?? [];
      sl.push(e);
      byScope.set(e.slug, sl);
    }
    for (const [slug, slist] of [...byScope.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const scopeLabel = slist[0]?.scope.split("/").filter(Boolean).pop() || slug;
      const sNode: TreeNode = {
        id: `s:${prov}:${slug}`,
        parentId: pNode.id,
        label: scopeLabel,
        detail: slist[0]?.scope ?? slug,
        bytes: slist.reduce((s, e) => s + Math.max(e.bytes, 1), 0),
        provider: prov,
        depth: 1,
        children: [],
        x0: 0,
        x1: 0,
      };
      buildScopeChildren(sNode, slist);
      pNode.children.push(sNode);
    }
    root.children.push(pNode);
  }

  root.bytes = root.children.reduce((s, c) => s + c.bytes, 0) || 1;
  for (const p of root.children) capChildren(p, ICICLE_TOP_K);
  assignPartition(root, 0, 1);
  return root;
}

function assignPartition(node: TreeNode, x0: number, x1: number): void {
  node.x0 = x0;
  node.x1 = x1;
  if (!node.children.length) return;
  const sum = node.children.reduce((s, c) => s + c.bytes, 0) || 1;
  let x = x0;
  const span = x1 - x0;
  for (const c of node.children) {
    const w = (c.bytes / sum) * span;
    assignPartition(c, x, x + w);
    x += w;
  }
}

function flatten(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  if (node.id !== "root") out.push(node);
  for (const c of node.children) flatten(c, out);
  return out;
}

const tree = computed(() => buildTree(filtered.value));

const nodeById = computed(() => {
  const map = new Map<string, TreeNode>();
  map.set("root", tree.value);
  for (const n of flatten(tree.value)) map.set(n.id, n);
  return map;
});

const focusNode = computed((): TreeNode => {
  return nodeById.value.get(focusId.value) ?? tree.value;
});

watch(tree, () => {
  if (!nodeById.value.has(focusId.value)) focusId.value = "root";
});

interface IcicleLayout {
  rects: IcicleRect[];
  width: number;
  height: number;
}

function bandWeights(n: number): number[] {
  if (n <= 1) return [1];
  if (n === 2) return [0.28, 0.72];
  if (n === 3) return [0.12, 0.28, 0.6];
  return Array.from({ length: n }, (_, i) => 1 + i);
}

function layoutZoomed(
  root: TreeNode,
  focus: TreeNode,
  viewportW: number,
  viewportH: number,
): IcicleLayout {
  if (!root.children.length || viewportW < 8 || viewportH < 8) {
    return { rects: [], width: viewportW, height: viewportH };
  }

  const fx0 = focus.x0;
  const fx1 = focus.x1;
  const fSpan = Math.max(fx1 - fx0, 1e-9);
  const treeMax = maxDepthOf(root);
  // Skip the focus node itself — breadcrumbs say where you are; chart shows children only.
  const startDepth = focus.id === "root" ? 0 : focus.depth + 1;
  if (startDepth > treeMax) {
    return { rects: [], width: viewportW, height: viewportH };
  }
  const endDepth = Math.min(treeMax, startDepth + ICICLE_MAX_BANDS - 1);

  const depths: number[] = [];
  for (let d = startDepth; d <= endDepth; d++) depths.push(d);

  const n = depths.length;
  const weights = bandWeights(n);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const yForDepth = new Map<number, { y: number; h: number }>();
  let yCursor = 0;
  for (let i = 0; i < n; i++) {
    const h = (viewportH * weights[i]!) / wSum;
    yForDepth.set(depths[i]!, { y: yCursor, h });
    yCursor += h;
  }

  const rects: IcicleRect[] = [];
  for (const node of flatten(root)) {
    if (node.x1 <= fx0 || node.x0 >= fx1) continue;
    if (node.depth < startDepth || node.depth > endDepth) continue;
    const band = yForDepth.get(node.depth);
    if (!band) continue;

    const x = ((node.x0 - fx0) / fSpan) * viewportW;
    const w = ((node.x1 - node.x0) / fSpan) * viewportW;
    const cx = Math.max(0, x);
    const cw = Math.min(viewportW, x + w) - cx;
    if (cw < 0.5) continue;

    rects.push({
      id: node.id,
      x: cx,
      y: band.y,
      w: Math.max(cw - GAP, 0),
      h: Math.max(band.h - GAP, 0),
      label: node.label,
      detail: node.detail,
      bytes: node.bytes,
      provider: node.provider,
      path: node.entry?.path,
      entry: node.entry,
      depth: node.depth,
      relDepth: node.depth - startDepth,
      zoomable: node.children.length > 0,
    });
  }
  return { rects, width: viewportW, height: viewportH };
}

const asideLayout = computed(() =>
  layoutZoomed(tree.value, focusNode.value, asideSize.value.w, asideSize.value.h),
);
const expandLayout = computed(() =>
  layoutZoomed(tree.value, focusNode.value, expandSize.value.w, expandSize.value.h),
);

const crumbs = computed(() => {
  const out: { id: string; label: string }[] = [{ id: "root", label: "all" }];
  let n: TreeNode | undefined = focusNode.value;
  const stack: TreeNode[] = [];
  while (n && n.id !== "root") {
    stack.push(n);
    n = n.parentId ? nodeById.value.get(n.parentId) : undefined;
  }
  for (const s of stack.reverse()) {
    out.push({ id: s.id, label: s.label });
  }
  return out;
});

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function scopeShort(scope: string): string {
  const parts = scope.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : scope;
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(128,128,128,${a})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function isPicked(r: IcicleRect): boolean {
  return !!r.entry && picked.value?.path === r.entry.path;
}

function isRelated(r: IcicleRect): boolean {
  const p = picked.value;
  if (!p) return true;
  if (r.entry) return r.entry.path === p.path;
  if (r.depth === 0) return r.provider === p.provider;
  if (r.depth === 1) return r.id === `s:${p.provider}:${p.slug}`;
  const n = nodeById.value.get(r.id);
  return n ? subtreeHasPath(n, p.path) : true;
}

function fillFor(r: IcicleRect): string {
  const base = providerColorHex(r.provider || "claude-code");
  if (isPicked(r)) return hexAlpha(base, 0.92);
  if (r.depth === 0) return hexAlpha(base, 0.72);
  if (r.depth === 1) return hexAlpha(base, 0.42);
  if (r.zoomable) return hexAlpha(base, 0.3);
  return hexAlpha(base, 0.22);
}

function labelFill(r: IcicleRect): string {
  if (isPicked(r) || r.depth === 0) return "#fafafa";
  return "var(--text)";
}

function labelOk(r: IcicleRect, large: boolean): boolean {
  const min = large ? 44 : 28;
  return r.w >= min && r.h >= (large ? 16 : 12);
}

function clipLabel(r: IcicleRect, large: boolean): string {
  if (!labelOk(r, large)) return "";
  const charW = large ? 7.2 : 6.2;
  const max = Math.max(1, Math.floor((r.w - 10) / charW));
  const s = r.label;
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

function zoomTo(id: string): void {
  if (!nodeById.value.has(id)) return;
  focusId.value = id;
}

function zoomToProject(provider: string, slug: string): void {
  const id = `s:${provider}:${slug}`;
  if (!nodeById.value.has(id)) return;
  focusId.value = id;
  const first = filtered.value.find((e) => e.provider === provider && e.slug === slug);
  if (first) picked.value = first;
}

function zoomOut(): void {
  const cur = focusNode.value;
  focusId.value = cur.parentId ?? "root";
}

function pick(e: MemoryEntry): void {
  const same = picked.value?.path === e.path;
  picked.value = same ? undefined : e;
  if (!picked.value) return;
  // Keep the sidebar chart with the selection — zoom to that project folder.
  const projectId = `s:${e.provider}:${e.slug}`;
  if (nodeById.value.has(projectId) && focusId.value !== projectId) {
    focusId.value = projectId;
  }
}

function onIcicleClick(r: IcicleRect): void {
  if (r.entry) {
    pick(r.entry);
    return;
  }
  // Non-leaf → zoom in (breadcrumb / ↑ to go out). Never "click again to zoom out".
  if (r.zoomable && r.id !== focusId.value) {
    zoomTo(r.id);
  }
}

function onIcicleDblClick(r: IcicleRect): void {
  if (r.entry) openEntry(r.entry);
}

function focusHint(): string {
  const r = hover.value;
  if (r?.entry) return `${r.detail} · ${fmtBytes(r.bytes)} · click selects · dblclick opens`;
  if (r?.zoomable) return `${r.detail} · ${fmtBytes(r.bytes)} · click to zoom in`;
  if (r) return `${r.detail} · ${fmtBytes(r.bytes)}`;
  if (picked.value) {
    return `${picked.value.name} · ${fmtBytes(picked.value.bytes)}`;
  }
  if (focusId.value !== "root") return "breadcrumb or ↑ to zoom out";
  return "click a folder to zoom in";
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return;
  if (memCtx.value) {
    memCtx.value = undefined;
    return;
  }
  if (focusId.value !== "root") {
    zoomOut();
    return;
  }
  if (expanded.value) expanded.value = false;
}

function isCodexStage1(e: MemoryEntry): boolean {
  return e.path.startsWith("codex-memory:");
}

function codexThreadId(e: MemoryEntry): string | undefined {
  if (!isCodexStage1(e)) return undefined;
  const id = e.path.slice("codex-memory:".length).trim();
  return id || undefined;
}

function openEntry(e: MemoryEntry): void {
  picked.value = e;
  expanded.value = false;
  memCtx.value = undefined;
  if (isCodexStage1(e)) {
    void openCodexStage1(e);
    return;
  }
  fileViewers.open(e.path);
}

function openCodexTranscript(e: MemoryEntry): void {
  const id = codexThreadId(e);
  if (!id) return;
  picked.value = e;
  expanded.value = false;
  memCtx.value = undefined;
  fileViewers.openTranscript("codex", id);
}

async function openCodexStage1(e: MemoryEntry): Promise<void> {
  const id = e.path.slice("codex-memory:".length);
  try {
    const res = await fetch(
      `/api/memory/content?provider=codex&id=${encodeURIComponent(id)}`,
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const body = (await res.json()) as {
      name?: string;
      content?: string;
      truncated?: boolean;
      size?: number;
    };
    fileViewers.openDocument({
      key: e.path,
      name: body.name ?? e.name,
      content: body.content ?? "",
      format: "markdown",
      truncated: body.truncated === true,
      size: body.size,
    });
  } catch {
    fileViewers.openDocument({
      key: e.path,
      name: e.name,
      content: "(could not load stage-1 memory)",
      format: "markdown",
    });
  }
}

function openInEditor(e: MemoryEntry): void {
  picked.value = e;
  expanded.value = false;
  memCtx.value = undefined;
  if (isCodexStage1(e)) return;
  settings.openPath(e.path);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function entryFromRect(r: IcicleRect): MemoryEntry | undefined {
  if (r.entry) return r.entry;
  const n = nodeById.value.get(r.id);
  if (!n) return undefined;
  // first leaf under node
  const stack = [...n.children];
  while (stack.length) {
    const c = stack.shift()!;
    if (c.entry) return c.entry;
    stack.push(...c.children);
  }
  return undefined;
}

function openMemCtx(e: MouseEvent, entry: MemoryEntry): void {
  e.preventDefault();
  e.stopPropagation();
  picked.value = entry;
  const pad = 8;
  const mw = 220;
  const mh = 200;
  memCtx.value = {
    x: Math.min(e.clientX, window.innerWidth - mw - pad),
    y: Math.min(e.clientY, window.innerHeight - mh - pad),
    entry,
  };
  ctxIgnoreClick = true;
  requestAnimationFrame(() => {
    ctxIgnoreClick = false;
  });
}

function openMemCtxFromRect(e: MouseEvent, r: IcicleRect): void {
  const entry = entryFromRect(r);
  if (!entry) return;
  openMemCtx(e, entry);
}

function dismissCtx(e: MouseEvent): void {
  if (ctxIgnoreClick || e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (!t.closest?.(".mem-ctx")) {
    memCtx.value = undefined;
  }
}

function menuAction(fn: () => unknown): void {
  try {
    void fn();
  } finally {
    memCtx.value = undefined;
  }
}

async function openExpand(): Promise<void> {
  expanded.value = true;
  await nextTick();
}

function closeExpand(): void {
  expanded.value = false;
}
</script>

<template>
  <div class="mem-layout">
    <div class="mem-range chip-row">
      <button
        v-for="r in RANGES"
        :key="r.id"
        type="button"
        class="filter-chip"
        :class="{ active: range === r.id }"
        :title="
          r.ms === Infinity
            ? 'Show all memory entries'
            : `Updated within the last ${r.label}`
        "
        @click="range = r.id"
      >
        {{ r.label }}
      </button>
    </div>
    <div class="mem-body">
    <div class="agent-main mem-main">
      <p v-if="items === undefined" class="stat-note">Loading memory…</p>
      <p v-else-if="!filtered.length" class="stat-note">
        {{
          filter.trim() ||
          (providerFilter && providerFilter !== "all") ||
          range !== "all"
            ? "no memory matches these filters"
            : "no auto-memory found — Claude projects/*/memory, Grok memory-v2, Codex memories"
        }}
      </p>
      <template v-else>
        <div
          class="stat-table cols-mem"
          v-col-resize="'mem-v1'"
          data-cols="88px minmax(0,1fr) 72px 64px 72px"
        >
          <div class="stat-cols micro-label">
            <span class="th">project</span
            ><span class="th">name</span
            ><span class="th">kind</span
            ><span class="th">size</span
            ><span class="th">updated</span>
          </div>
          <template v-for="g in groups" :key="g.provider + g.slug">
            <div
              class="mem-group micro-label"
              role="button"
              tabindex="0"
              title="Show this project in the icicle"
              @click="zoomToProject(g.provider, g.slug)"
              @keydown.enter.prevent="zoomToProject(g.provider, g.slug)"
            >
              <span class="prov-dot" :style="{ background: providerColor(g.provider) }" />
              {{ providerLabel(g.provider) }} · {{ g.scope }}
            </div>
            <div
              v-for="e in g.entries"
              :key="e.path"
              class="stat-row mem-row"
              :class="{ picked: picked?.path === e.path }"
              @click="pick(e)"
              @dblclick="openEntry(e)"
              @contextmenu.prevent.stop="openMemCtx($event, e)"
            >
              <span class="stat-name mono" :title="e.scope">{{ scopeShort(e.scope) }}</span>
              <span class="stat-name" :title="e.path">{{ e.name }}</span>
              <span class="stat-val mono">{{ e.kind }}</span>
              <span class="stat-val">{{ fmtBytes(e.bytes) }}</span>
              <span
                class="stat-val"
                :title="new Date(e.mtime).toLocaleString()"
              >{{ relativeTime(e.mtime) }}</span>
            </div>
          </template>
        </div>
        <p class="stat-note mem-note">
          Auto-memory (Claude · Grok · Codex). Icicle folds archive / top-16 into zoomable buckets · breadcrumb / ↑ / Esc out.
        </p>
      </template>
    </div>

    <aside class="mem-aside">
      <div class="mem-aside-head">
        <span class="mem-aside-title mono">icicle · bytes</span>
        <button
          v-if="filtered.length"
          type="button"
          class="detail-icon-btn"
          title="Expand icicle"
          @click="openExpand"
        >
          □
        </button>
      </div>
      <div v-if="!filtered.length" class="mem-aside-empty">
        <p class="stat-note">Nothing to chart.</p>
      </div>
      <template v-else>
        <div class="mem-nav">
          <nav class="mem-crumbs mono">
            <template v-for="(c, i) in crumbs" :key="c.id">
              <button
                type="button"
                class="mem-crumb"
                :class="{ current: c.id === focusId }"
                :disabled="c.id === focusId"
                @click="zoomTo(c.id)"
              >{{ c.label }}</button>
              <span v-if="i < crumbs.length - 1" class="mem-crumb-sep">/</span>
            </template>
          </nav>
          <button
            v-if="focusId !== 'root'"
            type="button"
            class="vsc-btn mem-zoom-out"
            title="Zoom out"
            @click="zoomOut"
          >↑</button>
        </div>
        <div ref="asideFrameEl" class="mem-icicle-frame">
          <svg
            class="mem-icicle"
            :viewBox="`0 0 ${asideLayout.width} ${asideLayout.height}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Memory icicle by bytes"
          >
            <g v-for="r in asideLayout.rects" :key="r.id">
              <rect
                :x="r.x"
                :y="r.y"
                :width="Math.max(r.w, 0)"
                :height="Math.max(r.h, 0)"
                :fill="fillFor(r)"
                :opacity="picked && !isRelated(r) ? 0.28 : 1"
                class="mem-seg"
                :class="{ picked: isPicked(r), leaf: !!r.entry }"
                @click="onIcicleClick(r)"
                @dblclick="onIcicleDblClick(r)"
                @contextmenu.prevent.stop="openMemCtxFromRect($event, r)"
                @mouseenter="hover = r"
                @mouseleave="hover = undefined"
              >
                <title>{{ r.detail }} · {{ fmtBytes(r.bytes) }}</title>
              </rect>
              <text
                v-if="clipLabel(r, false)"
                :x="r.x + 5"
                :y="r.y + r.h / 2 + 3.5"
                class="mem-seg-label"
                :fill="labelFill(r)"
                pointer-events="none"
              >{{ clipLabel(r, false) }}</text>
            </g>
          </svg>
        </div>
        <p class="mem-hint mono">{{ focusHint() }}</p>
        <template v-if="picked">
          <div class="run-kv mono mem-kv">
            <span class="run-key">name</span><span class="run-val">{{ picked.name }}</span>
            <span class="run-key">kind</span><span class="run-val">{{ picked.kind }}</span>
            <span class="run-key">size</span><span class="run-val">{{ fmtBytes(picked.bytes) }}</span>
            <span class="run-key">scope</span><span class="run-val" :title="picked.scope">{{ picked.scope }}</span>
          </div>
          <div class="sess-detail-actions">
            <button class="vsc-btn" type="button" @click="openEntry(picked)">⧉ open</button>
            <button
              v-if="isCodexStage1(picked)"
              class="vsc-btn"
              type="button"
              title="Open Codex session transcript"
              @click="openCodexTranscript(picked)"
            >
              ▸ transcript
            </button>
          </div>
        </template>
      </template>
    </aside>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="expanded"
      class="mem-backdrop"
      @click.self="closeExpand"
    >
      <div
        class="mem-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Memory icicle"
        @keydown.stop
      >
        <header class="mem-modal-head">
          <div class="mem-modal-title mono">icicle · bytes</div>
          <div class="mem-modal-actions">
            <button
              v-if="picked"
              type="button"
              class="vsc-btn"
              @click="openEntry(picked)"
            >
              ⧉ open
            </button>
            <button
              v-if="picked && isCodexStage1(picked)"
              type="button"
              class="vsc-btn"
              title="Open Codex session transcript"
              @click="openCodexTranscript(picked)"
            >
              ▸ transcript
            </button>
            <DetailExpandControls hide-expand @close="closeExpand" />
          </div>
        </header>
        <div class="mem-nav mem-modal-nav">
          <nav class="mem-crumbs mono">
            <template v-for="(c, i) in crumbs" :key="c.id">
              <button
                type="button"
                class="mem-crumb"
                :class="{ current: c.id === focusId }"
                :disabled="c.id === focusId"
                @click="zoomTo(c.id)"
              >{{ c.label }}</button>
              <span v-if="i < crumbs.length - 1" class="mem-crumb-sep">/</span>
            </template>
          </nav>
          <button
            v-if="focusId !== 'root'"
            type="button"
            class="vsc-btn mem-zoom-out"
            title="Zoom out"
            @click="zoomOut"
          >↑</button>
        </div>
        <p class="mem-hint mono mem-modal-hint">{{ focusHint() }}</p>
        <div ref="expandFrameEl" class="mem-modal-chart">
          <svg
            class="mem-icicle"
            :viewBox="`0 0 ${expandLayout.width} ${expandLayout.height}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Memory icicle expanded"
          >
            <g v-for="r in expandLayout.rects" :key="r.id">
              <rect
                :x="r.x"
                :y="r.y"
                :width="Math.max(r.w, 0)"
                :height="Math.max(r.h, 0)"
                :fill="fillFor(r)"
                :opacity="picked && !isRelated(r) ? 0.28 : 1"
                class="mem-seg"
                :class="{ picked: isPicked(r), leaf: !!r.entry }"
                @click="onIcicleClick(r)"
                @dblclick="onIcicleDblClick(r)"
                @contextmenu.prevent.stop="openMemCtxFromRect($event, r)"
                @mouseenter="hover = r"
                @mouseleave="hover = undefined"
              >
                <title>{{ r.detail }} · {{ fmtBytes(r.bytes) }}</title>
              </rect>
              <text
                v-if="clipLabel(r, true)"
                :x="r.x + 8"
                :y="r.y + r.h / 2 + 4"
                class="mem-seg-label mem-seg-label-lg"
                :fill="labelFill(r)"
                pointer-events="none"
              >{{ clipLabel(r, true) }}</text>
            </g>
          </svg>
        </div>
        <p class="stat-note mem-modal-foot">Esc zooms out · at root closes</p>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="memCtx"
      class="menu-pop wf-folder-ctx mem-ctx"
      :style="{ left: memCtx.x + 'px', top: memCtx.y + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => openEntry(memCtx!.entry))"
      >
        <span class="menu-glyph">⧉</span> Open
      </button>
      <button
        v-if="isCodexStage1(memCtx.entry)"
        type="button"
        class="menu-item"
        @click="menuAction(() => openCodexTranscript(memCtx!.entry))"
      >
        <span class="menu-glyph">▸</span> Transcript
      </button>
      <button
        v-if="!isCodexStage1(memCtx.entry)"
        type="button"
        class="menu-item"
        @click="menuAction(() => openInEditor(memCtx!.entry))"
      >
        <span class="menu-glyph">✎</span> {{ settings.editorLabel }}
      </button>
      <button
        v-if="!isCodexStage1(memCtx.entry)"
        type="button"
        class="menu-item"
        @click="menuAction(() => copyText(memCtx!.entry.path))"
      >
        <span class="menu-glyph">❐</span> Copy path
      </button>
      <button
        type="button"
        class="menu-item"
        @click="menuAction(() => copyText(memCtx!.entry.name))"
      >
        <span class="menu-glyph">❐</span> Copy name
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.mem-layout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.mem-range {
  flex-shrink: 0;
}
.mem-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
}
.mem-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.mem-aside {
  width: min(460px, 40vw);
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-bg);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 160px);
  overflow: auto;
  position: sticky;
  top: 12px;
  align-self: flex-start;
}
.mem-aside-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
}
.mem-aside-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.mem-aside-title {
  font-size: var(--fs-sm);
  color: var(--text);
}
.mem-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}
.mem-zoom-out {
  flex-shrink: 0;
  padding: 2px 8px;
}
.mem-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  flex: 1;
  min-width: 0;
}
.mem-crumb {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0;
  font: inherit;
}
.mem-crumb:hover:not(:disabled) {
  color: var(--text);
}
.mem-crumb.current,
.mem-crumb:disabled {
  color: var(--text);
  font-weight: 600;
  cursor: default;
}
.mem-crumb-sep {
  color: var(--text-faint);
}
.mem-modal-nav {
  flex-shrink: 0;
}
.mem-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 4px;
  color: var(--text-faint);
  cursor: pointer;
}
.mem-group:hover {
  color: var(--text-dim);
}
.mem-row {
  cursor: pointer;
}
.mem-note {
  padding: 12px 16px 24px;
}
.mem-icicle-frame {
  width: 100%;
  height: 280px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.mem-icicle {
  width: 100%;
  height: 100%;
  display: block;
}
.mem-seg {
  cursor: pointer;
  stroke: var(--bg);
  stroke-width: 1;
  transition: opacity 0.12s ease, x 0.2s ease, width 0.2s ease;
}
.mem-seg:hover {
  filter: brightness(1.18);
}
.mem-seg.picked {
  stroke: var(--text-dim);
  stroke-width: 1;
  filter: none;
}
.mem-seg-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
}
.mem-seg-label-lg {
  font-size: 12px;
}
.mem-hint {
  font-size: var(--fs-2xs);
  color: var(--text-faint);
  margin: 0;
  min-height: 1.4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mem-kv {
  margin-top: 2px;
}
.cols-mem .stat-row,
.cols-mem .stat-cols {
  display: grid;
  grid-template-columns: var(--cols-mem-v1, 88px minmax(0, 1fr) 72px 64px 72px);
  gap: 0 12px;
  align-items: center;
  padding-left: 16px;
  padding-right: 16px;
}

.mem-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.65);
}
.mem-modal {
  width: min(1100px, calc(100vw - 48px));
  height: min(780px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-strong);
  padding: 16px 18px 14px;
  overflow: hidden;
}
.mem-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.mem-modal-title {
  font-size: var(--fs-md);
  font-weight: 600;
}
.mem-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mem-modal-hint {
  margin: 0;
  flex-shrink: 0;
}
.mem-modal-chart {
  flex: 1;
  min-height: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.mem-modal-foot {
  margin: 0;
  flex-shrink: 0;
}
.mem-ctx {
  z-index: 140;
}
</style>
