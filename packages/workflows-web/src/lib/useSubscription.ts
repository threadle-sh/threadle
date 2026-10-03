import { ref } from "vue";
import type { ClaudeUsageWindowView } from "@threadle/shared";

export interface SubscriptionSnapshot {
  available: boolean;
  claudeWindows?: ClaudeUsageWindowView[];
  note?: string;
  usage?: {
    fiveHour?: { utilization: number; resetsAt?: string };
    sevenDay?: { utilization: number; resetsAt?: string };
    sevenDayOpus?: { utilization: number; resetsAt?: string };
  };
}

const snap = ref<SubscriptionSnapshot | null>(null);
let lastFetch = 0;
let inflight: Promise<void> | null = null;
const TTL_MS = 60_000;

export function useSubscription() {
  async function refresh(force = false): Promise<void> {
    if (!force && Date.now() - lastFetch < TTL_MS && snap.value) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch("/api/subscription");
        if (!r.ok) return;
        snap.value = (await r.json()) as SubscriptionSnapshot;
        lastFetch = Date.now();
      } catch {
        // offline
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function exhaustedClaude(): ClaudeUsageWindowView[] {
    return (snap.value?.claudeWindows ?? []).filter((w) => w.exhausted || w.hot);
  }

  return { snap, refresh, exhaustedClaude };
}
