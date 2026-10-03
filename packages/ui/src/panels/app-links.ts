import { features } from "./features";

/**
 * Cross-app links. The viewer (`threadle`) and the workflows addon
 * (`threadle-workflows`) are separate apps on separate ports; each opens the
 * other in its own browser tab, never through the local router.
 *
 * Graph opens use a per-graph window name so each workflow can live in its own
 * tab (re-clicking the same id focuses that tab). Non-graph addon pages share
 * one tab. The visible tab title (`workflow: <name>`) is set by the editor via
 * `document.title` — window names are only reuse keys, not labels.
 */

type App = "viewer" | "workflows";

const VIEWER_TAB = "threadle-viewer";
const WORKFLOWS_HOME_TAB = "threadle-workflows";
const START_HINT: Record<App, string> = { viewer: "threadle", workflows: "threadle-workflows" };

/** Browsing-context name for a workflows path (reuse key for window.open). */
export function workflowsWindowName(path: string): string {
  const m = path.match(/\/(?:addon\/)?workflows\/graph\/([^/?#]+)/);
  const id = m?.[1]?.trim();
  if (id) return `threadle-wf-${id}`;
  return WORKFLOWS_HOME_TAB;
}

function windowName(which: App, path: string): string {
  return which === "workflows" ? workflowsWindowName(path) : VIEWER_TAB;
}

async function appUp(which: App): Promise<boolean> {
  try {
    const res = await fetch("/api/apps");
    if (!res.ok) return true; // older server — just try the link
    const body = (await res.json()) as Record<string, { up?: boolean }>;
    return body[which]?.up !== false;
  } catch {
    return true;
  }
}

function appUrl(which: App, path: string): string {
  return (which === "viewer" ? features.viewerUrl : features.workflowsUrl) + path;
}

/**
 * Open `path` in the other app. Prefer opening with the real URL under the
 * click gesture. Pass `preopened` when the tab was reserved before an `await`
 * (async seed/create), otherwise popup blockers steal the new tab.
 */
function openApp(which: App, path: string, preopened?: Window | null): void {
  const url = appUrl(which, path);
  const target = windowName(which, path);
  // Sync open under the user gesture. Reuse a tab reserved before await when given.
  const w =
    preopened && !preopened.closed
      ? preopened
      : window.open(url, target);
  void appUp(which).then((up) => {
    if (!up) {
      try {
        if (w && !w.closed) {
          // Only auto-close a blank reservation we own.
          if (w.location.href === "about:blank") w.close();
        }
      } catch {
        // existing cross-origin app tab — leave it
      }
      window.alert(`The ${which} app isn't running.\n\nStart it with:  ${START_HINT[which]}\n(${url})`);
      return;
    }
    if (!w) {
      // Never navigate the current viewer tab away. Ask the user to allow popups.
      window.alert(
        `Could not open a new tab (popup blocked).\n\nAllow popups for this origin, or open:\n${url}`,
      );
      return;
    }
    try {
      if (w.location.href !== url) w.location.href = url;
    } catch {
      // Cross-origin existing named tab: open/focus via a fresh named open.
      window.open(url, target);
    }
    try {
      w.focus();
    } catch {
      /* ignore */
    }
  });
}

/** Open a viewer path (e.g. `/?view=sessions`, `/blueprint/<p>/<id>`). */
export function openViewerPath(path: string): void {
  openApp("viewer", path);
}

/**
 * Normalize legacy workflow paths to the addon prefix.
 * `/workflows…` → `/addon/workflows…`, `/graph/…` → `/addon/workflows/graph/…`, `/wire/…` → graph.
 */
export function toAddonWorkflowsPath(path: string): string {
  const q = path.indexOf("?");
  const pathname = q >= 0 ? path.slice(0, q) : path;
  const search = q >= 0 ? path.slice(q) : "";
  let next = pathname;
  if (next.startsWith("/addon/workflows")) {
    /* already addon */
  } else if (next === "/workflows" || next.startsWith("/workflows/")) {
    next = `/addon${next}`;
  } else if (next === "/graph" || next.startsWith("/graph/")) {
    next = `/addon/workflows${next}`;
  } else if (next === "/wire" || next.startsWith("/wire/")) {
    next = next.replace(/^\/wire/, "/addon/workflows/graph");
  } else if (!next.startsWith("/")) {
    next = `/addon/workflows/${next}`;
  } else {
    next = `/addon/workflows${next}`;
  }
  return next + search;
}

/** True when this document is already the workflows addon app. */
export function isWorkflowsApp(): boolean {
  try {
    return window.location.origin === new URL(features.workflowsUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Reserve a new workflows browser tab during the click gesture, before any `await`.
 * Pass the result into `openWorkflowsPath` after seeding/creating a graph.
 * Uses `_blank` so each async create gets its own tab (graph id is unknown yet).
 */
export function reserveWorkflowsTab(): Window | null {
  if (isWorkflowsApp()) return null;
  return window.open("about:blank", "_blank");
}

/**
 * Open a workflows-addon path (e.g. `/addon/workflows/runs`, `/addon/workflows/graph/<id>`).
 * From the viewer this opens (or focuses) a browser tab — one per graph id.
 * From inside the addon, pass `push` so navigation stays in the SPA router.
 */
export function openWorkflowsPath(
  path: string,
  push?: (path: string) => void | Promise<unknown>,
  preopened?: Window | null,
): void {
  const normalized = toAddonWorkflowsPath(path);
  if (isWorkflowsApp() && push) {
    if (preopened && !preopened.closed) {
      try {
        preopened.close();
      } catch {
        /* ignore */
      }
    }
    void push(normalized);
    return;
  }
  openApp("workflows", normalized, preopened);
}
