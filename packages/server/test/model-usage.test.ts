import { describe, expect, it } from "vitest";
import {
  classifyUsageExhaustion,
  claudeExhaustedForModel,
  claudeWindowViews,
  enrichUsageExhaustionError,
} from "@threadle/shared";

describe("classifyUsageExhaustion", () => {
  it("detects Cursor Other Models pool", () => {
    const hit = classifyUsageExhaustion(
      "Other Models usage limit reached. Switched to grok-4.6",
    );
    expect(hit?.kind).toBe("cursor-other-models");
    expect(hit?.message).toMatch(/pick another model/);
  });

  it("detects slow pool / switch to Auto", () => {
    const hit = classifyUsageExhaustion(
      "Claude Opus 4.5 is not available in the slow pool. Please switch to Auto.",
    );
    expect(hit?.kind).toBe("cursor-slow-pool");
  });

  it("detects generic usage limit", () => {
    const hit = classifyUsageExhaustion("You've hit your usage limit for this model");
    expect(hit?.kind).toBe("generic");
  });

  it("returns null for unrelated errors", () => {
    expect(classifyUsageExhaustion("ENOENT: no such file")).toBeNull();
  });

  it("enriches Error messages", () => {
    const e = enrichUsageExhaustionError(
      new Error("cursor agent run failed: rate limit exceeded"),
    );
    expect(e.message).toMatch(/model usage exhausted/);
  });
});

describe("claudeWindowViews / claudeExhaustedForModel", () => {
  it("flags 100% windows as exhausted", () => {
    const views = claudeWindowViews({
      fiveHour: { utilization: 100 },
      sevenDay: { utilization: 61 },
    });
    expect(views.find((v) => v.id === "fiveHour")?.exhausted).toBe(true);
    expect(views.find((v) => v.id === "sevenDay")?.exhausted).toBe(false);
  });

  it("opus model includes opus weekly window", () => {
    const blocked = claudeExhaustedForModel("claude-opus-4", {
      sevenDayOpus: { utilization: 100 },
      sevenDay: { utilization: 10 },
    });
    expect(blocked.some((b) => b.id === "sevenDayOpus")).toBe(true);
  });

  it("non-opus ignores opus-only exhaustion", () => {
    const blocked = claudeExhaustedForModel("sonnet", {
      sevenDayOpus: { utilization: 100 },
      sevenDay: { utilization: 10 },
    });
    expect(blocked).toEqual([]);
  });
});
