import { reactive } from "vue";
import type { ContextPayload } from "@threadle/shared";
import { api } from "@/api/client";

const PAYLOAD_CACHE_MAX = 30;

/**
 * LRU cache of materialized context payloads (full transcripts), keyed by
 * content hash. Payloads are large and GraphEditor stays mounted across every
 * workflow tab switch, so the cache is bounded to the most recent
 * PAYLOAD_CACHE_MAX and cleared on graph switch (loadGraph → clearPayloadCache).
 */
export function useContextPayloads(): {
  payloadCache: Record<string, ContextPayload>;
  cachePayload: (hash: string, payload: ContextPayload) => void;
  clearPayloadCache: () => void;
  ensurePayload: (hash?: string) => Promise<void>;
} {
  const payloadCacheOrder: string[] = [];
  const payloadCache = reactive<Record<string, ContextPayload>>({});

  function cachePayload(hash: string, payload: ContextPayload): void {
    if (!(hash in payloadCache)) {
      payloadCacheOrder.push(hash);
      while (payloadCacheOrder.length > PAYLOAD_CACHE_MAX) {
        const evict = payloadCacheOrder.shift();
        if (evict) delete payloadCache[evict];
      }
    }
    payloadCache[hash] = payload;
  }

  function clearPayloadCache(): void {
    payloadCacheOrder.length = 0;
    for (const k of Object.keys(payloadCache)) delete payloadCache[k];
  }

  async function ensurePayload(hash?: string): Promise<void> {
    if (!hash || payloadCache[hash]) return;
    try {
      cachePayload(hash, await api.payload(hash));
    } catch {
      // payload file missing — node shows "not materialized"
    }
  }

  return { payloadCache, cachePayload, clearPayloadCache, ensurePayload };
}
