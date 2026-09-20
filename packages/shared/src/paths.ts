/**
 * Path helpers that work in both Node and the browser (no `node:path`).
 * Used for absolute-path gates and editor URL schemes on Windows + Unix.
 */

/** True for Unix `/…`, Windows `C:\…` / `C:/…`, and UNC `\\server\share`. */
export function isAbsolutePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  return false;
}

/**
 * Build a URL-scheme open URI (`vscode://file/…`, `cursor://file/…`, …).
 * Always uses forward slashes; Windows drive paths become `/C:/Users/…`.
 */
export function editorFileUri(scheme: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const withLeading = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `${scheme}://file${withLeading}`;
}

/** Basename without assuming `/` only. */
export function pathBasename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * Normalize for containment compares: unify `\` → `/`, optional case-fold
 * (Windows drive letters), strip a trailing slash (except roots).
 */
export function normalizePathForCompare(
  p: string,
  opts?: { caseInsensitive?: boolean },
): string {
  let s = p.replace(/\\/g, "/");
  if (opts?.caseInsensitive) s = s.toLowerCase();
  // Keep `C:/` / `/` as roots; strip trailing slash otherwise.
  if (s.length > 1 && s.endsWith("/") && !/^[a-z]:\/$/i.test(s)) {
    s = s.slice(0, -1);
  }
  return s;
}

/**
 * True when `child` is the same path as `root` or a descendant.
 * Pass already-resolved absolute paths. On Windows set `caseInsensitive: true`.
 */
export function isPathInside(
  child: string,
  root: string,
  opts?: { caseInsensitive?: boolean },
): boolean {
  const c = normalizePathForCompare(child, opts);
  const r = normalizePathForCompare(root, opts);
  if (c === r) return true;
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return c.startsWith(prefix);
}
