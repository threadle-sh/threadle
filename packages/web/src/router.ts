import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "graph-list",
      component: () => import("./views/GraphList.vue"),
      beforeEnter: (to) => {
        // Viewer-first: bare `/` opens Sessions, not the wire list.
        if (!to.query.view) {
          return { path: "/", query: { ...to.query, view: "sessions" } };
        }
      },
    },
    {
      path: "/graph/:id?",
      name: "graph-editor",
      component: () => import("./wire/GraphEditor.vue"),
    },
    {
      path: "/wire/:id?",
      redirect: (to) => ({
        path: to.params.id ? `/graph/${to.params.id}` : "/",
        query: to.params.id ? to.query : { ...to.query, view: "workflows" },
      }),
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
      path: "/projects/:id?",
      name: "projects",
      component: () => import("./viewer/ProjectsView.vue"),
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
  ],
});
