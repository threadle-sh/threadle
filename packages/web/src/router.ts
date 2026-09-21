import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "graph-list",
      component: () => import("./views/GraphList.vue"),
    },
    {
      path: "/graph/:id?",
      name: "graph-editor",
      component: () => import("./views/GraphEditor.vue"),
    },
    {
      path: "/timeline",
      name: "timeline",
      component: () => import("./views/TimelineView.vue"),
    },
    {
      path: "/diff",
      name: "session-diff",
      component: () => import("./views/SessionDiff.vue"),
    },
    {
      path: "/lineage",
      name: "lineage",
      component: () => import("./views/LineageView.vue"),
    },
    {
      path: "/map",
      name: "map",
      component: () => import("./views/MapView.vue"),
    },
    {
      path: "/atlas",
      redirect: (to) => ({ path: "/map", query: to.query }),
    },
    {
      path: "/blueprint/:provider/:id(.*)",
      name: "session-blueprint",
      component: () => import("./views/SessionBlueprint.vue"),
    },
    {
      path: "/growth/:provider/:id(.*)",
      name: "session-growth",
      component: () => import("./views/SessionGrowth.vue"),
    },
  ],
});
