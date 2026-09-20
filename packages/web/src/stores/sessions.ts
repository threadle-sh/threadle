import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AgentDef, ProviderInfo, SessionRef } from "@threadle/shared";
import { api } from "@/api/client";
import {
  knownProviderIds,
  searchFiltersFor,
  sessionFiltersFor,
  type SearchFilter,
  type SessionFilter,
} from "@/lib/providers";

const PROVIDER_CACHE_KEY = "threadle.knownProviders";

function readCachedProviderIds(): string[] {
  try {
    const raw = localStorage.getItem(PROVIDER_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeCachedProviderIds(ids: string[]): void {
  try {
    localStorage.setItem(PROVIDER_CACHE_KEY, JSON.stringify(ids));
  } catch {
    /* quota / private mode */
  }
}

export const useSessionsStore = defineStore("sessions", () => {
  const providers = ref<ProviderInfo[]>([]);
  const sessions = ref<SessionRef[]>([]);
  const agents = ref<AgentDef[]>([]);
  const loading = ref(false);
  const error = ref<string>();
  /** Last-known present provider ids — seeds filter chips before network returns. */
  const cachedProviderIds = ref<string[]>(readCachedProviderIds());

  let providersInflight: Promise<void> | null = null;
  let refreshInflight: Promise<void> | null = null;

  function collectKnownIds(extra: Iterable<string> = []): string[] {
    return knownProviderIds(providers.value, [
      ...cachedProviderIds.value,
      ...sessions.value.map((s) => s.provider),
      ...agents.value.map((a) => a.provider),
      ...extra,
    ]);
  }

  function persistKnown(extra: Iterable<string> = []): void {
    const ids = collectKnownIds(extra);
    if (!ids.length) return;
    cachedProviderIds.value = ids;
    writeCachedProviderIds(ids);
  }

  /** Merge providers discovered elsewhere (library payloads, lineage, …) into the cache. */
  function noteProviders(ids: Iterable<string>): void {
    persistKnown(ids);
  }

  const sessionFilterChips = computed((): SessionFilter[] =>
    sessionFiltersFor(collectKnownIds()),
  );

  const searchFilterChips = computed((): SearchFilter[] =>
    searchFiltersFor(collectKnownIds()),
  );

  /** Fast path — registry only; chips can render without waiting on sessions. */
  async function refreshProviders(): Promise<void> {
    if (providersInflight) return providersInflight;
    providersInflight = (async () => {
      try {
        providers.value = await api.providers();
        persistKnown();
      } catch {
        /* keep cache / prior */
      } finally {
        providersInflight = null;
      }
    })();
    return providersInflight;
  }

  async function refresh(): Promise<void> {
    if (refreshInflight) return refreshInflight;
    loading.value = true;
    error.value = undefined;
    // Providers first so chips don't wait on the sessions scan.
    void refreshProviders();
    refreshInflight = (async () => {
      try {
        const [s, a] = await Promise.all([api.sessions(), api.agents()]);
        sessions.value = s;
        agents.value = a;
        persistKnown();
        // Ensure providers finished (or failed) before clearing loading.
        await refreshProviders();
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        loading.value = false;
        refreshInflight = null;
      }
    })();
    return refreshInflight;
  }

  /** Idempotent bootstrap — safe to call from main + every view mount. */
  function ensureHydrated(): void {
    if (!providers.value.length) void refreshProviders();
    if (!sessions.value.length) void refresh();
  }

  function find(provider: string, id: string): SessionRef | undefined {
    return sessions.value.find((s) => s.provider === provider && s.id === id);
  }

  /** Patch live process status from SSE without a full refresh.
   *  Each event is a full snapshot of currently-live processes across providers. */
  function applyLiveStatuses(
    statuses: Array<Pick<SessionRef, "provider" | "id" | "status">>,
  ): void {
    const live = new Map(
      statuses.map((u) => [`${u.provider}:${u.id}`, u.status] as const),
    );
    for (const s of sessions.value) {
      const next = live.get(`${s.provider}:${s.id}`);
      if (next !== undefined) {
        // Presence in the live map means a process is up. Provider "idle" → "live".
        s.status = next === "idle" ? "live" : next;
      } else if (
        s.status === "running" ||
        s.status === "waiting" ||
        s.status === "live"
      ) {
        s.status = "idle";
      }
    }
  }

  return {
    providers,
    sessions,
    agents,
    loading,
    error,
    cachedProviderIds,
    sessionFilterChips,
    searchFilterChips,
    noteProviders,
    refreshProviders,
    refresh,
    ensureHydrated,
    find,
    applyLiveStatuses,
  };
});
