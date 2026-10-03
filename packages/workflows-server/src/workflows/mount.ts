import type { Hono } from "hono";
import { registerWorkflowsPort } from "@threadle/core/workflows-port.js";
import { listGraphs, readGraph } from "../graphs/store.js";
import { graphRoutes } from "../routes/graphs.js";
import { activeCustomRuns, customNodeRoutes } from "../routes/custom-nodes.js";
import { WORKFLOW_TEMPLATES } from "../templates/workflows.js";
import { scanGraphsForAtlas } from "./atlas-scan.js";
import { workflowJobRoutes, workflowRunRoutes } from "./routes.js";

/**
 * Register the workflows package with core (graph reads for favorites /
 * atlas / check / internals). Safe to call more than once.
 */
export function registerWorkflows(): void {
  registerWorkflowsPort({
    listGraphs,
    graphExists: async (id) => !!(await readGraph(id)),
    atlasGraphs: scanGraphsForAtlas,
    templateCount: () => WORKFLOW_TEMPLATES.length,
    activeCustomRuns,
  });
}

/**
 * Mount workflow API routes. Call BEFORE core routes: `/api/run/workflow`
 * and `/api/jobs/:id/outputs` share prefixes with core routers.
 */
export function mountWorkflows(app: Hono): void {
  registerWorkflows();
  app.route("/api/graphs", graphRoutes);
  app.route("/api/custom-nodes", customNodeRoutes);
  app.route("/api/run", workflowRunRoutes);
  app.route("/api/jobs", workflowJobRoutes);
}
