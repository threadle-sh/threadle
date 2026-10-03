import { createRouter, createWebHistory } from "vue-router";
import { foreignRoutes } from "@ui/boot";
import { openViewerPath } from "@ui/panels/app-links";

function addonRedirect(rest: string | string[] | undefined): string {
  const suffix = Array.isArray(rest) ? rest.filter(Boolean).join("/") : (rest || "");
  return suffix ? `/addon/workflows/${suffix}` : "/addon/workflows";
}

/** Workflows addon app (`threadle-workflows`): list, runs, nodes, graph editor. */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/addon/workflows" },
    {
      path: "/addon/workflows",
      name: "workflows",
      component: () => import("./WorkflowsHome.vue"),
    },
    {
      path: "/addon/workflows/runs",
      name: "workflow-runs",
      component: () => import("./WorkflowsRuns.vue"),
    },
    {
      path: "/addon/workflows/logs",
      name: "workflow-logs",
      component: () => import("./WorkflowsLogs.vue"),
    },
    {
      path: "/addon/workflows/nodes",
      name: "workflow-nodes",
      component: () => import("./WorkflowsNodes.vue"),
    },
    {
      path: "/addon/workflows/graph/:id?",
      name: "graph-editor",
      component: () => import("./GraphEditor.vue"),
    },
    // Compat: pre-addon paths
    {
      path: "/workflows/:pathMatch(.*)*",
      redirect: (to) => addonRedirect(to.params.pathMatch as string | string[] | undefined),
    },
    {
      path: "/graph/:id?",
      redirect: (to) =>
        to.params.id
          ? { path: `/addon/workflows/graph/${to.params.id}`, query: to.query }
          : { path: "/addon/workflows" },
    },
    {
      path: "/wire/:id?",
      redirect: (to) =>
        to.params.id
          ? { path: `/addon/workflows/graph/${to.params.id}`, query: to.query }
          : { path: "/addon/workflows" },
    },
    // Everything else belongs to the viewer app (sessions, blueprints, …).
    ...foreignRoutes(["/:pathMatch(.*)*"], "/addon/workflows", openViewerPath),
  ],
});

const PAGE_TITLE: Record<string, string> = {
  workflows: "workflows",
  "workflow-runs": "runs",
  "workflow-logs": "logs",
  "workflow-nodes": "nodes",
};

router.afterEach((to) => {
  if (to.name === "graph-editor") {
    // GraphEditor sets `workflow: <name>` once the graph loads.
    if (!to.params.id) document.title = "threadle · workflows";
    return;
  }
  const page = typeof to.name === "string" ? PAGE_TITLE[to.name] : undefined;
  document.title = page ? `workflow: ${page}` : "threadle · workflows";
});
