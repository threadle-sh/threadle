import { createRouter, createWebHistory } from "vue-router";
import { foreignRoutes } from "@ui/boot";
import { openWorkflowsPath } from "@ui/panels/app-links";

/** Viewer app (`threadle`). The workflows addon is a separate app (`threadle-workflows`). */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "dashboard",
      component: () => import("./views/Dashboard.vue"),
      beforeEnter: (to) => {
        // Old links to views that moved into the workflows addon.
        const moved = {
          workflows: "/addon/workflows",
          runs: "/addon/workflows/runs",
          logs: "/addon/workflows/logs",
        } as const;
        const target = moved[to.query.view as keyof typeof moved];
        if (target) {
          openWorkflowsPath(target);
          return { path: "/", query: { view: "sessions" } };
        }
        // Viewer-first: bare `/` opens Sessions.
        if (!to.query.view) {
          return { path: "/", query: { ...to.query, view: "sessions" } };
        }
      },
    },
    {
      path: "/timeline",
      name: "timeline",
      component: () => import("./viewer/TimelineView.vue"),
    },
    {
      path: "/diff",
      name: "session-diff",
      component: () => import("./viewer/SessionDiff.vue"),
    },
    {
      path: "/lineage",
      name: "lineage",
      component: () => import("./viewer/LineageView.vue"),
    },
    {
      path: "/map",
      name: "map",
      component: () => import("./viewer/MapView.vue"),
    },
    {
      path: "/projects/:pathMatch(.*)*",
      redirect: () => ({ path: "/", query: { view: "sessions" } }),
    },
    {
      path: "/atlas",
      redirect: (to) => ({ path: "/map", query: to.query }),
    },
    {
      path: "/blueprint/:provider/:id(.*)",
      name: "session-blueprint",
      component: () => import("./viewer/SessionBlueprint.vue"),
    },
    {
      path: "/growth/:provider/:id(.*)",
      name: "session-growth",
      component: () => import("./viewer/SessionGrowth.vue"),
    },
    // Addon paths open the workflows app (legacy prefixes normalized by openWorkflowsPath).
    ...foreignRoutes(
      [
        "/addon/workflows/:rest(.*)*",
        "/addon/workflows/graph/:id?",
        "/workflows/:rest(.*)*",
        "/wire/:id?",
      ],
      "/",
      openWorkflowsPath,
    ),
  ],
});
