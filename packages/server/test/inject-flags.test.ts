import { describe, expect, it } from "vitest";
import { INJECT_FLAG_PROBES } from "../src/providers/freshness/inject-flags.js";
import { probeInjectFlags } from "../src/providers/freshness/probe.js";

describe("inject flag probes", () => {
  it("lists a probe for every provider inject surface", () => {
    const bins = new Set(INJECT_FLAG_PROBES.map((p) => p.bin));
    expect(bins).toEqual(
      new Set(["claude", "opencode", "cursor-agent", "agy", "codex", "copilot", "grok"]),
    );
    expect(
      INJECT_FLAG_PROBES.every((p) => p.match.length > 0 && p.why.length > 0),
    ).toBe(true);
  });

  it("skips missing binaries without failing", async () => {
    const results = await probeInjectFlags([
      {
        id: "fake:missing",
        bin: "claude",
        match: ["--definitely-not-a-real-flag-zzzz"],
        why: "test",
      },
    ]);
    // Either skipped (no claude) or ran (claude present) — never throws
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("flag:fake:missing");
    if (results[0]?.skipped) {
      expect(results[0].ok).toBe(true);
    }
  });
});
