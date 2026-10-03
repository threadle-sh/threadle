/** Appearance preference: follow OS, or force light/dark. */
export type Appearance = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

export const APPEARANCE_KEY = "threadle.appearance";

export function isAppearance(v: unknown): v is Appearance {
  return v === "system" || v === "light" || v === "dark";
}

export function readStoredAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (isAppearance(raw)) return raw;
  } catch {
    // private mode / unavailable
  }
  return "system";
}

export function storeAppearance(a: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, a);
  } catch {
    // ignore
  }
}

export function resolveTheme(appearance: Appearance): ResolvedTheme {
  if (appearance === "light" || appearance === "dark") return appearance;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/** Apply resolved theme to <html> (data-theme + color-scheme). */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

let mediaListener: ((e: MediaQueryListEvent) => void) | undefined;
let mediaQuery: MediaQueryList | undefined;

/** Apply preference and keep system mode in sync with OS changes. */
export function applyAppearance(appearance: Appearance): void {
  storeAppearance(appearance);
  applyResolvedTheme(resolveTheme(appearance));

  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
    mediaQuery = undefined;
    mediaListener = undefined;
  }
  if (appearance === "system" && typeof window !== "undefined" && window.matchMedia) {
    mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    mediaListener = () => applyResolvedTheme(resolveTheme("system"));
    mediaQuery.addEventListener("change", mediaListener);
  }
}
