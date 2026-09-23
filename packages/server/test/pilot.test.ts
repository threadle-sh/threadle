import { describe, expect, it, vi } from "vitest";
import { allPilotCases, pilotCasesFor } from "../src/providers/pilot-defaults.js";
import { PROVIDER_HARNESS_EXTRAS } from "@threadle/shared";

vi.mock("../src/providers/registry.js", () => ({
  registry: {
    info: async () => [
      { id: "claude-code", available: true },
      { id: "opencode", available: false },
      { id: "cursor", available: true },
      { id: "antigravity", available: false },
      { id: "codex", available: false },
      { id: "copilot", available: false },
      { id: "grok", available: false },
      { id: "muse", available: true },
    ],
  },
}));

describe("pilot case catalog", () => {
  it("base mode is one case per provider; extras add flag variants", () => {
    const base = pilotCasesFor(false);
    expect(base.every((c) => !c.extra)).toBe(true);
    expect(new Set(base.map((c) => c.provider)).size).toBe(8);

    const all = pilotCasesFor(true);
    expect(all.length).toBeGreaterThan(base.length);
    expect(all.some((c) => c.id === "codex:sandbox-ro")).toBe(true);
    expect(all.some((c) => c.id === "claude-code:permission-plan")).toBe(true);
    expect(allPilotCases().filter((c) => c.extra).length).toBeGreaterThan(0);
  });

  it("includes extras:off / extras:on pairs for harness providers", () => {
    const all = pilotCasesFor(true);
    const harnessProviders = Object.keys(PROVIDER_HARNESS_EXTRAS);
    expect(harnessProviders.length).toBeGreaterThan(0);
    for (const p of harnessProviders) {
      const off = all.find((c) => c.id === `${p}:extras-off`);
      const on = all.find((c) => c.id === `${p}:extras-on`);
      expect(off, `${p}:extras-off`).toBeDefined();
      expect(on, `${p}:extras-on`).toBeDefined();
      expect(off?.harnessExtras).toBe(false);
      expect(on?.harnessExtras).toBe(true);
      expect(off?.extra).toBe(true);
      expect(on?.extra).toBe(true);
      expect(off?.variant).toBe("extras:off");
      expect(on?.variant).toBe("extras:on");
    }
    // Base smoke stays extras-off; pairs are only under extra tests.
    expect(pilotCasesFor(false).some((c) => c.variant.startsWith("extras:"))).toBe(
      false,
    );
  });
});

describe("GET /api/run/pilot", () => {
  it("returns base cases without ?extra", async () => {
    const { runRoutes } = await import("../src/routes/run.js");
    const res = await runRoutes.request("/pilot");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prompt: string;
      extraTests: boolean;
      extraCaseCount: number;
      cases: Array<{
        id: string;
        provider: string;
        variant: string;
        available: boolean;
        extra?: boolean;
        model?: string;
        skipReason?: string;
      }>;
    };
    expect(body.extraTests).toBe(false);
    expect(body.extraCaseCount).toBeGreaterThan(0);
    expect(body.prompt.toLowerCase()).toContain("ok");
    expect(body.cases).toHaveLength(8);
    expect(body.cases.every((c) => !c.extra)).toBe(true);

    const byId = Object.fromEntries(body.cases.map((c) => [c.id, c]));
    expect(byId["claude-code"]?.available).toBe(true);
    expect(byId["claude-code"]?.model).toBe("haiku");
    expect(byId.cursor?.variant).toBe("default");
    expect(byId.opencode?.available).toBe(false);
    expect(byId.opencode?.skipReason).toMatch(/not available/i);
  });

  it("includes flag variants with ?extra=1", async () => {
    const { runRoutes } = await import("../src/routes/run.js");
    const res = await runRoutes.request("/pilot?extra=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      extraTests: boolean;
      cases: Array<{
        id: string;
        sandbox?: string;
        permissionMode?: string;
        harnessExtras?: boolean;
        extra?: boolean;
        note?: string;
      }>;
    };
    expect(body.extraTests).toBe(true);
    expect(body.cases.length).toBeGreaterThan(8);
    const sand = body.cases.find((c) => c.id === "codex:sandbox-ro");
    expect(sand?.sandbox).toBe("read-only");
    expect(sand?.extra).toBe(true);
    const perm = body.cases.find((c) => c.id === "claude-code:permission-plan");
    expect(perm?.permissionMode).toBe("plan");

    const museOff = body.cases.find((c) => c.id === "muse:extras-off");
    const museOn = body.cases.find((c) => c.id === "muse:extras-on");
    expect(museOff?.harnessExtras).toBe(false);
    expect(museOn?.harnessExtras).toBe(true);
    expect(museOff?.note).toMatch(/skill-reminder/i);
    expect(museOn?.note).toMatch(/skill-reminder/i);
  });
});
