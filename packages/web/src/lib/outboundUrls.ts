import type { NormalizedMessage } from "@threadle/shared";

/** http(s) URLs; stops before common wrappers / trailing punctuation. */
const URL_RE = /https?:\/\/[^\s)\]}>"'\\]+/gi;

export interface OutboundUrlCall {
  tool: string;
  summary: string;
  ts?: number;
}

export interface OutboundUrlHit {
  url: string;
  domain: string;
  tools: string[];
  count: number;
  firstTs?: number;
  lastTs?: number;
  /** Latest call summary that mentioned this URL */
  sample?: string;
}

export interface BlueprintToolSource {
  name: string;
  calls: Array<{ summary: string; body?: string; ts?: number }>;
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?)>\]]+$/g, "").replace(/\\+$/g, "");
}

export function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host || "(invalid)";
  } catch {
    return "(invalid)";
  }
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const found = text.match(URL_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const url = cleanUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function bump(
  map: Map<string, OutboundUrlHit>,
  url: string,
  tool: string,
  summary: string,
  ts?: number,
): void {
  let hit = map.get(url);
  if (!hit) {
    hit = {
      url,
      domain: domainOf(url),
      tools: [],
      count: 0,
    };
    map.set(url, hit);
  }
  hit.count += 1;
  if (!hit.tools.includes(tool)) hit.tools.push(tool);
  hit.sample = summary;
  if (ts != null) {
    hit.firstTs = hit.firstTs == null ? ts : Math.min(hit.firstTs, ts);
    hit.lastTs = hit.lastTs == null ? ts : Math.max(hit.lastTs, ts);
  }
}

/** Collect outbound http(s) URLs from blueprint tool invocation summaries/bodies. */
export function collectOutboundFromTools(tools: BlueprintToolSource[]): OutboundUrlHit[] {
  const map = new Map<string, OutboundUrlHit>();
  for (const tool of tools) {
    for (const call of tool.calls) {
      const blob = [call.summary, call.body].filter(Boolean).join("\n");
      for (const url of extractUrlsFromText(blob)) {
        bump(map, url, tool.name, call.summary, call.ts);
      }
    }
  }
  return sortHits([...map.values()]);
}

/**
 * Merge URLs found in tool_use parts only (not tool_result bodies — those
 * often embed every link from a fetched page).
 */
export function mergeOutboundFromMessages(
  existing: OutboundUrlHit[],
  messages: NormalizedMessage[],
): OutboundUrlHit[] {
  const map = new Map<string, OutboundUrlHit>(existing.map((h) => [h.url, { ...h, tools: [...h.tools] }]));
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== "tool_use") continue;
      const tool = p.toolName?.trim() || "tool";
      const blob =
        typeof p.toolInput === "string"
          ? p.toolInput
          : p.toolInput != null
            ? JSON.stringify(p.toolInput)
            : "";
      const summary = blob.replace(/\s+/g, " ").trim().slice(0, 160);
      for (const url of extractUrlsFromText(blob)) {
        bump(map, url, tool, summary || tool, m.timestamp);
      }
    }
  }
  return sortHits([...map.values()]);
}

function sortHits(hits: OutboundUrlHit[]): OutboundUrlHit[] {
  return hits.sort(
    (a, b) =>
      a.domain.localeCompare(b.domain) ||
      a.url.localeCompare(b.url),
  );
}

export function uniqueDomains(hits: OutboundUrlHit[]): string[] {
  return [...new Set(hits.map((h) => h.domain))].sort((a, b) => a.localeCompare(b));
}
