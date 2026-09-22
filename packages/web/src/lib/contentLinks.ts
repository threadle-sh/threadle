/**
 * Classify hrefs inside rendered markdown / HTML (file viewers, transcripts).
 * Local paths open in-app; http(s) must go through the outbound confirm popup.
 */

export type ContentLinkKind =
  | { kind: "external"; url: string; domain: string }
  | { kind: "local"; path: string }
  | { kind: "hash" }
  | { kind: "ignore" };

function stripFileUrl(href: string): string | undefined {
  try {
    const u = new URL(href);
    if (u.protocol !== "file:") return undefined;
    let p = decodeURIComponent(u.pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    return p || undefined;
  } catch {
    return undefined;
  }
}

/** Normalize a POSIX-ish path (collapse . / ..) */
export function normalizePosixPath(p: string): string {
  const abs = p.startsWith("/");
  const parts = p.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
      continue;
    }
    out.push(part);
  }
  const joined = out.join("/");
  return abs ? `/${joined}` : joined;
}

/** True for absolute POSIX / Windows paths (not URLs) */
export function looksLikeAbsPath(s: string): boolean {
  if (!s) return false;
  if (s.startsWith("/") && !s.startsWith("//")) return true;
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  return false;
}

/**
 * Resolve a local file path from an href, optionally relative to `baseDir`
 * (directory of the document that contained the link).
 */
export function resolveLocalFilePath(
  href: string,
  baseDir?: string,
): string | undefined {
  const raw = href.trim();
  if (!raw || raw.startsWith("#")) return undefined;

  const fromFile = stripFileUrl(raw);
  if (fromFile) return normalizePosixPath(fromFile);

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;

  if (looksLikeAbsPath(raw)) {
    return normalizePosixPath(raw.replace(/\\/g, "/"));
  }

  if (!baseDir) return undefined;
  if (raw.includes("://")) return undefined;
  const base = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const joined = normalizePosixPath(`${base}/${raw}`);
  if (!joined.startsWith("/")) return undefined;
  return joined;
}

export function classifyContentHref(
  href: string | null | undefined,
  baseDir?: string,
): ContentLinkKind {
  if (!href) return { kind: "ignore" };
  const raw = href.trim();
  if (!raw) return { kind: "ignore" };
  if (raw.startsWith("#")) return { kind: "hash" };

  try {
    const u = new URL(raw);
    const proto = u.protocol.toLowerCase();
    if (proto === "http:" || proto === "https:") {
      return { kind: "external", url: u.href, domain: u.hostname };
    }
    if (proto === "file:") {
      const p = stripFileUrl(raw);
      return p ? { kind: "local", path: normalizePosixPath(p) } : { kind: "ignore" };
    }
    return { kind: "ignore" };
  } catch {
    // Relative or bare path
  }

  const local = resolveLocalFilePath(raw, baseDir);
  if (local) return { kind: "local", path: local };
  return { kind: "ignore" };
}

/**
 * CSS class for an in-app (local file) content link.
 * Relative hrefs count as local even without a baseDir (decoration only).
 */
export const CONTENT_LINK_LOCAL_CLASS = "cl-local";

/** True when href should show the internal-link marker (not http(s) / hash) */
export function isInternalContentHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const raw = href.trim();
  if (!raw || raw.startsWith("#")) return false;
  // `/` baseDir only for classification — we don't need a real path here.
  const kind = classifyContentHref(raw, "/");
  return kind.kind === "local";
}

/**
 * Mark local-file anchors with `cl-local` so CSS can show an internal glyph.
 * Safe to run after DOMPurify; no-ops when DOMParser is unavailable.
 */
export function decorateContentLinkHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="cl-root">${html}</div>`,
      "text/html",
    );
    const root = doc.getElementById("cl-root");
    if (!root) return html;
    for (const a of root.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (!isInternalContentHref(href)) continue;
      const prev = a.getAttribute("class") ?? "";
      if (prev.split(/\s+/).includes(CONTENT_LINK_LOCAL_CLASS)) continue;
      a.setAttribute(
        "class",
        prev ? `${prev} ${CONTENT_LINK_LOCAL_CLASS}` : CONTENT_LINK_LOCAL_CLASS,
      );
      if (!a.getAttribute("title")) {
        a.setAttribute("title", "Open in threadle");
      }
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Intercept a click inside a rendered HTML body.
 * Returns true if the event was handled.
 */
export function interceptContentLinkClick(
  e: MouseEvent,
  opts: {
    baseDir?: string;
    onLocal: (filePath: string) => void;
    onExternal: (url: string, domain: string) => void;
  },
): boolean {
  if (e.defaultPrevented) return false;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const t = e.target;
  if (!(t instanceof Element)) return false;
  const a = t.closest("a");
  if (!a || !e.currentTarget || !(e.currentTarget instanceof Node) || !e.currentTarget.contains(a)) {
    return false;
  }
  const href = a.getAttribute("href");
  const kind = classifyContentHref(href, opts.baseDir);
  if (kind.kind === "hash") return false;
  if (kind.kind === "ignore") {
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
  e.preventDefault();
  e.stopPropagation();
  if (kind.kind === "local") opts.onLocal(kind.path);
  else opts.onExternal(kind.url, kind.domain);
  return true;
}
