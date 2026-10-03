import { describe, expect, it } from "vitest";
import {
  UPSTREAM_CATALOG,
  formatUpstreamReport,
  probeUpstream,
  upstreamHasDrift,
  type UpstreamFetch,
} from "../src/providers/freshness/upstream.js";

function mockFetch(table: Record<string, { status: number; body: unknown }>): UpstreamFetch {
  return async (url) => {
    const hit = Object.entries(table).find(([k]) => url.includes(k));
    if (!hit) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const { status, body } = hit[1];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

describe("probeUpstream", () => {
  it("pins every catalog entry on at least one channel", () => {
    expect(UPSTREAM_CATALOG.length).toBeGreaterThanOrEqual(4);
    for (const e of UPSTREAM_CATALOG) {
      expect(e.npm || e.github, e.id).toBeTruthy();
      expect(e.seen.npm || e.seen.github, e.id).toBeTruthy();
    }
  });

  it("matches pins as ok", async () => {
    const claude = UPSTREAM_CATALOG.find((e) => e.id === "claude-code")!;
    const rows = await probeUpstream(
      [claude],
      mockFetch({
        "@anthropic-ai%2Fclaude-code": { status: 200, body: { version: claude.seen.npm } },
        "anthropics/claude-code": { status: 200, body: { tag_name: claude.seen.github } },
      }),
    );
    expect(rows.every((r) => !r.newer && !r.skipped)).toBe(true);
    expect(upstreamHasDrift(rows)).toBe(false);
  });

  it("flags npm newer than pin", async () => {
    const claude = UPSTREAM_CATALOG.find((e) => e.id === "claude-code")!;
    const rows = await probeUpstream(
      [{ ...claude, github: undefined }],
      mockFetch({
        "@anthropic-ai%2Fclaude-code": { status: 200, body: { version: "9.9.9" } },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.newer).toBe(true);
    expect(rows[0]?.latest).toBe("9.9.9");
    expect(upstreamHasDrift(rows)).toBe(true);
    expect(formatUpstreamReport(rows)).toMatch(/!!/);
  });

  it("skips failed fetches without claiming drift", async () => {
    const claude = UPSTREAM_CATALOG.find((e) => e.id === "claude-code")!;
    const rows = await probeUpstream(
      [{ ...claude, github: undefined }],
      mockFetch({}),
    );
    expect(rows[0]?.skipped).toBe(true);
    expect(rows[0]?.newer).toBe(false);
    expect(upstreamHasDrift(rows)).toBe(false);
  });
});
