import { reactive } from "vue";

/** Server-reported feature flags and app locations (from /api/health). */
export const features = reactive({
  /** false when the server runs with --no-workflows (Workflows addon API unmounted) */
  workflows: true,
  /** where the viewer app lives (threadle, :4570 — dev :5173) */
  viewerUrl: "http://127.0.0.1:4570",
  /** where the Workflows addon app lives (threadle-workflows, :4571 — dev :5174) */
  workflowsUrl: "http://127.0.0.1:4571",
});

export function applyHealthFeatures(h: {
  workflows?: boolean;
  viewerUrl?: string;
  workflowsUrl?: string;
}): void {
  if (typeof h.workflows === "boolean") features.workflows = h.workflows;
  if (typeof h.viewerUrl === "string" && h.viewerUrl) features.viewerUrl = h.viewerUrl;
  if (typeof h.workflowsUrl === "string" && h.workflowsUrl) features.workflowsUrl = h.workflowsUrl;
}
