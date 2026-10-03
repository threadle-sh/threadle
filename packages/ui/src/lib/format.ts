export function relativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function basename(p?: string): string {
  if (!p) return "";
  return p.split("/").filter(Boolean).pop() ?? p;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Replace `/Users/x` or `/home/x` with `~` for compact display. */
export function tildePath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/** Wrap a path in LTR isolates so RTL-based left-ellipsis doesn't move the leading slash. */
export function bidiPath(p: string): string {
  return `⁦${p}⁩`;
}

/** Compact token count; prefix ~ when values are estimated (e.g. Cursor chars/4). */
export function fmtTokens(
  n?: number,
  opts?: { estimate?: boolean },
): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  let s: string;
  if (n >= 1_000_000) s = `${(n / 1_000_000).toFixed(1)}M`;
  else if (n >= 1_000) s = `${(n / 1_000).toFixed(1)}k`;
  else s = String(n);
  return opts?.estimate ? `~${s}` : s;
}

export function isTokenEstimate(meta?: Record<string, unknown>): boolean {
  return meta?.tokenSource === "estimate";
}

/** Wall-clock node run time — ms under 1s, else compact s / m. */
export function fmtNodeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec ? `${m}m ${sec}s` : `${m}m`;
}
