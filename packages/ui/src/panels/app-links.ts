import { features } from "./features";

/**
 * Cross-app links. The viewer (`threadle`) and the workflows addon
 * (`threadle-workflows`) are separate apps on separate ports; each opens the
 * other in its own named tab, never through the local router.
 */

type App = "viewer" | "workflows";

const TAB: Record<App, string> = { viewer: "threadle-viewer", workflows: "threadle-workflows" };
const START_HINT: Record<App, string> = { viewer: "threadle", workflows: "threadle-workflows" };

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

/**
 * Open `path` in the other app's named tab. The tab is opened synchronously
 * (so it isn't popup-blocked), then navigated once we know the app runs.
 */
function openApp(which: App, path: string): void {
  const url = (which === "viewer" ? features.viewerUrl : features.workflowsUrl) + path;
  const w = window.open("", TAB[which]);
  void appUp(which).then((up) => {
    if (!up) {
      try {
        if (w && w.location.href === "about:blank") w.close();
      } catch {
        // existing cross-origin app tab — leave it
      }
      window.alert(`The ${which} app isn't running.\n\nStart it with:  ${START_HINT[which]}\n(${url})`);
      return;
    }
    if (!w) {
      window.location.assign(url);
      return;
    }
    w.location.href = url;
    w.focus();
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
 * Open a workflows-addon path (e.g. `/addon/workflows/runs`, `/addon/workflows/graph/<id>`).
 * From the viewer this opens (or focuses) the addon tab. From inside the addon, pass
 * `push` so navigation stays in the SPA router.
 */
export function openWorkflowsPath(
  path: string,
  push?: (path: string) => void | Promise<unknown>,
): void {
  const normalized = toAddonWorkflowsPath(path);
  if (isWorkflowsApp() && push) {
    void push(normalized);
    return;
  }
  openApp("workflows", normalized);
}
