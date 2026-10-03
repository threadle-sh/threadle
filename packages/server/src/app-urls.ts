/**
 * The viewer and the workflows editor are separate apps on separate ports.
 * Each UI asks /api/health where the other one lives; dev overrides these
 * with the Vite ports (THREADLE_VIEWER_URL / THREADLE_WORKFLOWS_URL).
 */
export const VIEWER_PORT = 4570;
export const WORKFLOWS_PORT = 4571;

export type UiMode = "viewer" | "workflows";

export function appUrls(): { viewerUrl: string; workflowsUrl: string } {
  return {
    viewerUrl: (process.env.THREADLE_VIEWER_URL || `http://127.0.0.1:${VIEWER_PORT}`).replace(/\/+$/, ""),
    workflowsUrl: (process.env.THREADLE_WORKFLOWS_URL || `http://127.0.0.1:${WORKFLOWS_PORT}`).replace(/\/+$/, ""),
  };
}

/** Built UI directory for a mode, relative to the server bundle (dist/ or src/). */
export function webDistDir(here: string, ui: UiMode): string {
  return `${here}/../${ui === "workflows" ? "web-dist-workflows" : "web-dist"}`;
}

let probeCache: { at: number; value: AppsStatus } | undefined;

export interface AppsStatus {
  viewer: { url: string; up: boolean };
  workflows: { url: string; up: boolean };
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800), redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Probe both app URLs (server-side: the browser's CSP forbids cross-origin fetches). */
export async function appsStatus(self: UiMode): Promise<AppsStatus> {
  if (probeCache && Date.now() - probeCache.at < 3_000) return probeCache.value;
  const { viewerUrl, workflowsUrl } = appUrls();
  const [v, w] = await Promise.all([
    self === "viewer" ? Promise.resolve(true) : reachable(viewerUrl),
    self === "workflows" ? Promise.resolve(true) : reachable(workflowsUrl),
  ]);
  const value = { viewer: { url: viewerUrl, up: v }, workflows: { url: workflowsUrl, up: w } };
  probeCache = { at: Date.now(), value };
  return value;
}
