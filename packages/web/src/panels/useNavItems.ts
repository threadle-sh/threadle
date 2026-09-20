import { computed, onMounted, ref, type ComputedRef, type Ref } from "vue";
import { api } from "@/api/client";
import { useSessionsStore } from "@/stores/sessions";
import { DEFAULT_NAV_ITEMS, type NavItem } from "./nav-items";

type Count = number | "";

function blank(): Count {
  return "";
}

function isExampleWorkflow(name: string): boolean {
  return /^(Example|Recipe)\s*·/i.test(name);
}

/** Module-level counts — survive DashNav remounts across routes so the rail doesn't flicker. */
const workflowCount = ref<Count>(blank());
const runsRunning = ref<Count>(blank());
const libraryCount = ref<Count>(blank());
const lineageCount = ref<Count>(blank());
const rulesCount = ref<Count>(blank());
const skillsCount = ref<Count>(blank());
const filesCount = ref<Count>(blank());
const activityCount = ref<Count>(blank());
const favoritesCount = ref<Count>(blank());

let refreshInflight: Promise<void> | null = null;
let lastRefreshAt = 0;
const REFRESH_COOLDOWN_MS = 8_000;

function setCount(target: Ref<Count>, n: number): void {
  // Keep the previous value on soft zeros only when we never loaded; otherwise 0 → blank.
  target.value = n || blank();
}

async function refreshNavCounts(force = false): Promise<void> {
  const now = Date.now();
  if (!force && refreshInflight) return refreshInflight;
  if (!force && now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
  lastRefreshAt = now;

  const run = (async () => {
    await Promise.all([
      api
        .graphs()
        .then((g) => {
          setCount(
            workflowCount,
            g.filter((x) => !isExampleWorkflow(x.name)).length,
          );
        })
        .catch(() => {
          /* keep prior */
        }),

      api
        .jobs()
        .then((jobs) => {
          setCount(
            runsRunning,
            jobs.filter((j) => j.status === "running").length,
          );
        })
        .catch(() => {
          /* keep prior */
        }),

      fetch("/api/payloads")
        .then((r) => (r.ok ? r.json() : []))
        .then((body: unknown) => {
          setCount(libraryCount, Array.isArray(body) ? body.length : 0);
        })
        .catch(() => {
          /* keep prior */
        }),

      api
        .favorites()
        .then((body) => {
          setCount(favoritesCount, body.items?.length ?? 0);
        })
        .catch(() => {
          /* keep prior */
        }),

      fetch("/api/lineage")
        .then((r) => (r.ok ? r.json() : {}))
        .then((body: { payloads?: unknown[]; injects?: unknown[] }) => {
          const payloads = Array.isArray(body.payloads) ? body.payloads.length : 0;
          const injects = Array.isArray(body.injects) ? body.injects.length : 0;
          // Prefer handoff count; fall back to payload count so the rail isn't empty.
          setCount(lineageCount, injects || payloads);
        })
        .catch(() => {
          /* keep prior */
        }),

      fetch("/api/rules")
        .then((r) => (r.ok ? r.json() : []))
        .then((body: unknown) => {
          const groups = Array.isArray(body)
            ? (body as Array<{ artifacts?: Array<{ kind?: string }> }>)
            : [];
          const arts = groups.flatMap((g) => g.artifacts ?? []);
          setCount(
            rulesCount,
            arts.filter((a) => a.kind !== "skill").length,
          );
          setCount(
            skillsCount,
            arts.filter((a) => a.kind === "skill").length,
          );
        })
        .catch(() => {
          /* keep prior */
        }),

      fetch("/api/files")
        .then((r) => (r.ok ? r.json() : []))
        .then((body: unknown) => {
          const groups = Array.isArray(body)
            ? (body as Array<{ entries?: unknown[] }>)
            : [];
          const n = groups.reduce((sum, g) => sum + (g.entries?.length ?? 0), 0);
          setCount(filesCount, n);
        })
        .catch(() => {
          /* keep prior */
        }),

      fetch("/api/files/activity")
        .then((r) => (r.ok ? r.json() : []))
        .then((body: unknown) => {
          setCount(activityCount, Array.isArray(body) ? body.length : 0);
        })
        .catch(() => {
          /* keep prior */
        }),
    ]);
  })();

  refreshInflight = run.finally(() => {
    if (refreshInflight === run) refreshInflight = null;
  });
  return refreshInflight;
}

/**
 * Sidebar items with live counts — shared across Map / Lineage / Timeline /
 * blueprint / editor so the rail stays populated outside GraphList.
 */
export function useNavItems(opts?: {
  /** Override / extend counts (e.g. GraphList supplies richer workflow + rules). */
  counts?: Partial<Record<string, () => string | number>>;
}): ComputedRef<NavItem[]> {
  const sessions = useSessionsStore();

  onMounted(() => {
    sessions.ensureHydrated();
    void refreshNavCounts();
  });

  const projectCount = computed((): Count => {
    const dirs = new Set<string>();
    for (const s of sessions.sessions) {
      if (s.projectDir) dirs.add(s.projectDir);
    }
    return dirs.size || blank();
  });

  const securityCount = computed((): Count => {
    const n = sessions.sessions.filter((s) => {
      const m = s.meta?.permissionMode;
      return typeof m === "string" && m !== "" && m !== "default";
    }).length;
    return n || blank();
  });

  const baseCounts: Record<string, () => string | number> = {
    workflows: () => workflowCount.value,
    runs: () => runsRunning.value,
    sessions: () => sessions.sessions.length || blank(),
    map: () => projectCount.value,
    lineage: () => lineageCount.value,
    activity: () => activityCount.value,
    library: () => libraryCount.value,
    favorites: () => favoritesCount.value,
    agents: () => sessions.agents.length || blank(),
    rules: () => rulesCount.value,
    skills: () => skillsCount.value,
    services: () =>
      sessions.providers.filter((p) => p.available).length || blank(),
    files: () => filesCount.value,
    security: () => securityCount.value,
  };

  return computed(() =>
    DEFAULT_NAV_ITEMS.map((v) => {
      const fromOpts = opts?.counts?.[v.id]?.();
      // Empty override → keep shared base (e.g. GraphList rules before /api/rules loads).
      const count =
        fromOpts !== undefined && fromOpts !== ""
          ? fromOpts
          : (baseCounts[v.id]?.() ?? "");
      return { ...v, count };
    }),
  );
}
