import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { FileViewerFormat } from "@/lib/fileViewerFormat";
import { copyToClipboard } from "@/lib/pathActions";
import { useSettingsStore } from "@/stores/settings";

export interface FileViewerWindow {
  id: string;
  /** Dedup key — filesystem path or virtual id (`context:…`). */
  path: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
  previewMaxBytes: number;
  /** Display mode; `auto` picks from path / content. */
  format: FileViewerFormat;
  /** Absolute disk path when the doc is a real file (enables ⟨/⟩). */
  diskPath?: string;
  /** Session context — ⟨/⟩ materializes full .md; ❐ copies / ⇓ downloads full context. */
  contextRef?: { provider: string; sessionId: string };
  /** Interactive chat transcript (TranscriptView) — ❐ / ⇓ use reconstructed context. */
  transcriptRef?: { provider: string; sessionId: string };
  /** Tool/skill/reasoning dump — ❐ / ⇓ every invocation. */
  invocationsRef?: {
    provider: string;
    sessionId: string;
    kind: "tool" | "skill" | "reasoning";
    name: string;
  };
  error?: string;
  loading: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface MissingFileAlert {
  path: string;
  name: string;
}

function isNotFoundError(status: number, error?: string): boolean {
  if (status === 404) return true;
  const msg = (error ?? "").toLowerCase();
  return msg.includes("not found") || msg.includes("enoent") || msg.includes("no such file");
}

function baseName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

const DEFAULT_W = 560;
const DEFAULT_H = 420;
const MIN_W = 320;
const MIN_H = 200;
const PREVIEW_MAX = 1_500_000;

export const useFileViewersStore = defineStore("fileViewers", () => {
  const windows = ref<FileViewerWindow[]>([]);
  /** Disk paths known missing (failed open / exists probe). */
  const missingPathSet = ref<Set<string>>(new Set());
  const missingAlert = ref<MissingFileAlert>();
  let zTop = 40;
  let cascade = 0;

  const missingPaths = computed(() => missingPathSet.value);

  function isMissing(filePath: string): boolean {
    return missingPathSet.value.has(filePath);
  }

  function markMissing(filePath: string): void {
    if (missingPathSet.value.has(filePath)) return;
    const next = new Set(missingPathSet.value);
    next.add(filePath);
    missingPathSet.value = next;
  }

  function clearMissing(filePath: string): void {
    if (!missingPathSet.value.has(filePath)) return;
    const next = new Set(missingPathSet.value);
    next.delete(filePath);
    missingPathSet.value = next;
  }

  function dismissMissingAlert(): void {
    missingAlert.value = undefined;
  }

  function raiseMissingAlert(filePath: string): void {
    markMissing(filePath);
    missingAlert.value = { path: filePath, name: baseName(filePath) };
  }

  /** Stat-check paths; updates missing set silently (no popup). */
  async function probeMissing(paths: string[]): Promise<void> {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return;
    await Promise.all(
      unique.map(async (p) => {
        try {
          const res = await fetch(`/api/files/exists?path=${encodeURIComponent(p)}`);
          const body = (await res.json()) as { exists?: boolean };
          if (!res.ok) return;
          if (body.exists) clearMissing(p);
          else markMissing(p);
        } catch {
          /* offline — leave prior state */
        }
      }),
    );
  }

  function bringToFront(id: string): void {
    zTop += 1;
    const w = windows.value.find((x) => x.id === id);
    if (w) w.z = zTop;
  }

  function close(id: string): void {
    windows.value = windows.value.filter((w) => w.id !== id);
  }

  function closeAll(): void {
    windows.value = [];
    cascade = 0;
  }

  function spawnShell(opts: {
    path: string;
    name: string;
    format?: FileViewerFormat;
    diskPath?: string;
    contextRef?: { provider: string; sessionId: string };
    transcriptRef?: { provider: string; sessionId: string };
    invocationsRef?: FileViewerWindow["invocationsRef"];
    w?: number;
    h?: number;
  }): FileViewerWindow {
    const id = `fv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const offset = (cascade++ % 8) * 28;
    const win: FileViewerWindow = {
      id,
      path: opts.path,
      name: opts.name,
      content: "",
      size: 0,
      truncated: false,
      previewMaxBytes: PREVIEW_MAX,
      format: opts.format ?? "auto",
      diskPath: opts.diskPath,
      contextRef: opts.contextRef,
      transcriptRef: opts.transcriptRef,
      invocationsRef: opts.invocationsRef,
      loading: true,
      x: 80 + offset,
      y: 72 + offset,
      w: opts.w ?? DEFAULT_W,
      h: opts.h ?? DEFAULT_H,
      z: ++zTop,
    };
    windows.value.push(win);
    return win;
  }

  async function open(filePath: string): Promise<void> {
    const existing = windows.value.find((w) => w.path === filePath);
    if (existing) {
      bringToFront(existing.id);
      return;
    }

    const win = spawnShell({
      path: filePath,
      name: baseName(filePath),
      diskPath: filePath,
    });

    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const body = (await res.json()) as {
        error?: string;
        path?: string;
        name?: string;
        content?: string;
        size?: number;
        truncated?: boolean;
        previewMaxBytes?: number;
      };
      const live = windows.value.find((w) => w.id === win.id);
      if (!live) return;
      if (!res.ok) {
        if (isNotFoundError(res.status, body.error)) {
          close(win.id);
          raiseMissingAlert(filePath);
          return;
        }
        live.loading = false;
        live.error = body.error ?? `${res.status} ${res.statusText}`;
        return;
      }
      clearMissing(filePath);
      live.loading = false;
      live.name = body.name ?? live.name;
      live.path = body.path ?? filePath;
      live.diskPath = body.path ?? filePath;
      live.content = body.content ?? "";
      live.size = body.size ?? 0;
      live.truncated = body.truncated === true;
      live.previewMaxBytes = body.previewMaxBytes ?? live.previewMaxBytes;
    } catch (err) {
      const live = windows.value.find((w) => w.id === win.id);
      if (!live) return;
      live.loading = false;
      live.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Open an in-memory document (legacy / small dumps) in a floating window.
   * Dedups by `key`; reopening focuses the existing window.
   */
  function openDocument(opts: {
    key: string;
    name: string;
    content: string;
    format?: FileViewerFormat;
    truncated?: boolean;
    size?: number;
    previewMaxBytes?: number;
    invocationsRef?: FileViewerWindow["invocationsRef"];
    w?: number;
    h?: number;
  }): void {
    const existing = windows.value.find((w) => w.path === opts.key);
    if (existing) {
      existing.content = opts.content;
      existing.size = opts.size ?? opts.content.length;
      existing.truncated = opts.truncated === true;
      existing.previewMaxBytes = opts.previewMaxBytes ?? existing.previewMaxBytes;
      existing.invocationsRef = opts.invocationsRef ?? existing.invocationsRef;
      existing.loading = false;
      existing.error = undefined;
      existing.name = opts.name;
      if (opts.format) existing.format = opts.format;
      if (opts.w != null) existing.w = opts.w;
      if (opts.h != null) existing.h = opts.h;
      bringToFront(existing.id);
      return;
    }

    const win = spawnShell({
      path: opts.key,
      name: opts.name,
      format: opts.format ?? "markdown",
      invocationsRef: opts.invocationsRef,
      w: opts.w,
      h: opts.h,
    });
    win.loading = false;
    win.content = opts.content;
    win.size = opts.size ?? opts.content.length;
    win.truncated = opts.truncated === true;
    if (opts.previewMaxBytes != null) win.previewMaxBytes = opts.previewMaxBytes;
  }

  /**
   * Open a tool/skill/reasoning invocation dump (preview-capped like context).
   * ⇓ downloads the full markdown of every invocation.
   */
  async function openInvocations(
    provider: string,
    sessionId: string,
    kind: "tool" | "skill" | "reasoning",
    name: string,
  ): Promise<void> {
    const key = `invocations:${provider}:${sessionId}:${kind}:${name}`;
    const existing = windows.value.find((w) => w.path === key);
    if (existing) {
      bringToFront(existing.id);
      return;
    }

    const label = kind === "reasoning" ? "reasoning" : name;
    const win = spawnShell({
      path: key,
      name: `invocations · ${kind} · ${label}.md`,
      format: "markdown",
      invocationsRef: { provider, sessionId, kind, name },
    });

    try {
      await fillInvocationsWindow(win);
    } catch (err) {
      const live = windows.value.find((w) => w.id === win.id);
      if (!live) return;
      live.loading = false;
      live.error = err instanceof Error ? err.message : String(err);
    }
  }

  async function fillContextWindow(win: FileViewerWindow): Promise<void> {
    const ref = win.contextRef;
    if (!ref) return;
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(ref.provider)}/context/${encodeURIComponent(ref.sessionId)}?preview=1`,
    );
    const body = (await res.json()) as {
      error?: string;
      name?: string;
      content?: string;
      size?: number;
      truncated?: boolean;
      previewMaxBytes?: number;
    };
    const live = windows.value.find((w) => w.id === win.id);
    if (!live) return;
    if (!res.ok) {
      live.error = body.error ?? `${res.status} ${res.statusText}`;
      live.loading = false;
      return;
    }
    live.error = undefined;
    live.loading = false;
    live.name = body.name ?? live.name;
    live.content = body.content ?? "";
    live.size = body.size ?? 0;
    live.truncated = body.truncated === true;
    live.previewMaxBytes = body.previewMaxBytes ?? live.previewMaxBytes;
  }

  async function fillInvocationsWindow(win: FileViewerWindow): Promise<void> {
    const ref = win.invocationsRef;
    if (!ref) return;
    const qs = new URLSearchParams({ kind: ref.kind, preview: "1" });
    if (ref.kind !== "reasoning") qs.set("name", ref.name);
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(ref.provider)}/invocations/${encodeURIComponent(ref.sessionId)}?${qs}`,
    );
    const body = (await res.json()) as {
      error?: string;
      name?: string;
      content?: string;
      size?: number;
      truncated?: boolean;
      previewMaxBytes?: number;
    };
    const live = windows.value.find((w) => w.id === win.id);
    if (!live) return;
    if (!res.ok) {
      live.error = body.error ?? `${res.status} ${res.statusText}`;
      live.loading = false;
      return;
    }
    live.error = undefined;
    live.loading = false;
    live.name = body.name ?? live.name;
    live.content = body.content ?? "";
    live.size = body.size ?? 0;
    live.truncated = body.truncated === true;
    live.previewMaxBytes = body.previewMaxBytes ?? live.previewMaxBytes;
  }

  /**
   * Soft-reload a session-backed viewer (context / tool invocations) in place.
   * Returns false if the window is gone or not a live-reloadable kind.
   */
  async function refreshLive(id: string): Promise<boolean> {
    const w = windows.value.find((x) => x.id === id);
    if (!w || w.loading) return false;
    try {
      if (w.contextRef) {
        await fillContextWindow(w);
        return true;
      }
      if (w.invocationsRef) {
        await fillInvocationsWindow(w);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Open the interactive session transcript (roles / tools / thinking) in a floating window.
   * ⇓ downloads the reconstructed context markdown (same as open context).
   */
  function openTranscript(provider: string, sessionId: string): void {
    const key = `transcript:${provider}:${sessionId}`;
    const existing = windows.value.find((w) => w.path === key);
    if (existing) {
      bringToFront(existing.id);
      return;
    }

    const short = sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
    const win = spawnShell({
      path: key,
      name: `transcript · ${provider} · ${short}`,
      format: "text",
      transcriptRef: { provider, sessionId },
      w: 640,
      h: 520,
    });
    win.loading = false;
  }

  /**
   * Open the reconstructed session context (markdown) in a floating window.
   * Large contexts are capped like file previews (`truncated: true`).
   */
  async function openContext(provider: string, sessionId: string): Promise<void> {
    const key = `context:${provider}:${sessionId}`;
    const existing = windows.value.find((w) => w.path === key);
    if (existing) {
      bringToFront(existing.id);
      return;
    }

    const short = sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
    const win = spawnShell({
      path: key,
      name: `context · ${provider} · ${short}.md`,
      format: "markdown",
      contextRef: { provider, sessionId },
    });

    try {
      await fillContextWindow(win);
    } catch (err) {
      const live = windows.value.find((w) => w.id === win.id);
      if (!live) return;
      live.loading = false;
      live.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Open a Library / lineage payload by hash in a floating viewer. */
  async function openPayload(ref: {
    hash: string;
    name?: string;
  }): Promise<void> {
    const key = `payload:${ref.hash}`;
    const label =
      (ref.name ?? "payload").replace(/[^\w.-]+/g, "_").slice(0, 48) || "payload";
    const name = `payload · ${label}.md`;
    try {
      const res = await fetch(`/api/payloads/${encodeURIComponent(ref.hash)}`);
      const body = (await res.json()) as { content?: string; error?: string };
      if (!res.ok) {
        openDocument({
          key,
          name,
          content: body.error ?? `Failed to load payload (${res.status})`,
          format: "text",
        });
        return;
      }
      const content = body.content ?? "";
      openDocument({
        key,
        name,
        content,
        format: "markdown",
        size: content.length,
      });
    } catch (err) {
      openDocument({
        key,
        name,
        content: err instanceof Error ? err.message : String(err),
        format: "text",
      });
    }
  }

  function move(id: string, x: number, y: number): void {
    const w = windows.value.find((x) => x.id === id);
    if (!w) return;
    w.x = Math.max(0, x);
    w.y = Math.max(0, y);
  }

  function resize(
    id: string,
    next: { x?: number; y?: number; w: number; h: number },
  ): void {
    const win = windows.value.find((x) => x.id === id);
    if (!win) return;
    win.w = Math.max(MIN_W, next.w);
    win.h = Math.max(MIN_H, next.h);
    if (next.x !== undefined) win.x = Math.max(0, next.x);
    if (next.y !== undefined) win.y = Math.max(0, next.y);
  }

  function setFormat(id: string, format: FileViewerFormat): void {
    const w = windows.value.find((x) => x.id === id);
    if (w) w.format = format;
  }

  /** Open in the configured editor — disk file as-is, or materialize context to tmp. */
  async function openInEditor(id: string): Promise<void> {
    const w = windows.value.find((x) => x.id === id);
    if (!w) return;
    const settings = useSettingsStore();
    if (w.diskPath) {
      settings.openPath(w.diskPath);
      return;
    }
    const ref = w.contextRef ?? w.transcriptRef;
    if (!ref) return;
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(ref.provider)}/context/${encodeURIComponent(ref.sessionId)}?materialize=1`,
      );
      const body = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !body.path) return;
      settings.openPath(body.path);
    } catch {
      /* best-effort */
    }
  }

  /** Download full content when possible (context / transcript / invocations API or in-window text). */
  async function download(id: string): Promise<void> {
    const w = windows.value.find((x) => x.id === id);
    if (!w || w.loading || w.error) return;
    const cref = w.contextRef ?? w.transcriptRef;
    if (cref) {
      const url = `/api/sessions/${encodeURIComponent(cref.provider)}/context/${encodeURIComponent(cref.sessionId)}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = w.name.endsWith(".md") ? w.name : `${w.name}.md`;
      a.click();
      return;
    }
    const iref = w.invocationsRef;
    if (iref) {
      const qs = new URLSearchParams({ kind: iref.kind });
      if (iref.kind !== "reasoning") qs.set("name", iref.name);
      const url = `/api/sessions/${encodeURIComponent(iref.provider)}/invocations/${encodeURIComponent(iref.sessionId)}?${qs}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = w.name.endsWith(".md") ? w.name : `${w.name}.md`;
      a.click();
      return;
    }
    if (!w.content) return;
    const blob = new Blob([w.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = w.name || "download.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Resolve the same text download would save, then copy to the clipboard. */
  async function copyContent(id: string): Promise<boolean> {
    const w = windows.value.find((x) => x.id === id);
    if (!w || w.loading || w.error) return false;
    try {
      const cref = w.contextRef ?? w.transcriptRef;
      if (cref) {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(cref.provider)}/context/${encodeURIComponent(cref.sessionId)}`,
        );
        if (!res.ok) return false;
        return copyToClipboard(await res.text());
      }
      const iref = w.invocationsRef;
      if (iref) {
        const qs = new URLSearchParams({ kind: iref.kind });
        if (iref.kind !== "reasoning") qs.set("name", iref.name);
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(iref.provider)}/invocations/${encodeURIComponent(iref.sessionId)}?${qs}`,
        );
        if (!res.ok) return false;
        return copyToClipboard(await res.text());
      }
      if (!w.content) return false;
      return copyToClipboard(w.content);
    } catch {
      return false;
    }
  }

  function canOpenInEditor(w: FileViewerWindow): boolean {
    return !!w.diskPath || !!w.contextRef || !!w.transcriptRef;
  }

  function canDownload(w: FileViewerWindow): boolean {
    if (w.loading || w.error) return false;
    return !!w.contextRef || !!w.transcriptRef || !!w.invocationsRef || !!w.content;
  }

  function canCopy(w: FileViewerWindow): boolean {
    return canDownload(w);
  }

  return {
    windows,
    missingPaths,
    missingAlert,
    isMissing,
    markMissing,
    clearMissing,
    dismissMissingAlert,
    raiseMissingAlert,
    probeMissing,
    open,
    openDocument,
    openInvocations,
    openTranscript,
    openContext,
    openPayload,
    refreshLive,
    close,
    closeAll,
    bringToFront,
    move,
    resize,
    setFormat,
    openInEditor,
    download,
    copyContent,
    canOpenInEditor,
    canDownload,
    canCopy,
  };
});

/** Shared client-side gate matching the server's text-file heuristic (approx). */
export function isLikelyTextPath(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? "";
  const lower = base.toLowerCase();
  if (
    [
      "makefile",
      "dockerfile",
      "containerfile",
      "gemfile",
      "rakefile",
      "procfile",
      "license",
      "licence",
      "readme",
      "changelog",
      "agents.md",
      "claude.md",
      "skill.md",
    ].includes(lower)
  ) {
    return true;
  }
  if (lower.startsWith(".env")) return true;
  const i = lower.lastIndexOf(".");
  if (i < 0) return false;
  const ext = lower.slice(i);
  return [
    ".md",
    ".txt",
    ".json",
    ".jsonc",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".vue",
    ".css",
    ".scss",
    ".html",
    ".svg",
    ".xml",
    ".csv",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cs",
    ".php",
    ".lua",
    ".graphql",
    ".proto",
    ".tf",
    ".nix",
    ".log",
    ".diff",
    ".patch",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".lock",
  ].includes(ext);
}
