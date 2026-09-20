import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runCheck, printCheck } from "../src/check.js";
import {
  goldenFixturesRoot,
  probeGoldenFixtures,
} from "../src/providers/freshness/fixtures.js";
import { INJECT_FLAG_PROBES } from "../src/providers/freshness/inject-flags.js";

vi.mock("../src/providers/registry.js", () => ({
  registry: {
    info: async () => [
      { id: "claude-code", available: true, version: "mock" },
      { id: "opencode", available: false },
      { id: "cursor", available: false },
      { id: "antigravity", available: false },
      { id: "codex", available: false },
      { id: "copilot", available: false },
      { id: "grok", available: false },
    ],
  },
}));

const PROVIDER_IDS = [
  "claude-code",
  "opencode",
  "cursor",
  "antigravity",
  "codex",
  "copilot",
  "grok",
] as const;

const CLI_IDS = [
  "cli:claude",
  "cli:opencode",
  "cli:cursor-agent",
  "cli:agy",
  "cli:codex",
  "cli:copilot",
  "cli:grok",
] as const;

/** `runCheck` treats baked UI as critical; unit CI may not have built yet. */
async function ensureWebDist(): Promise<void> {
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web-dist");
  await fs.promises.mkdir(webDist, { recursive: true });
  const index = path.join(webDist, "index.html");
  try {
    await fs.promises.access(index);
  } catch {
    await fs.promises.writeFile(index, "<!doctype html><title>threadle</title>\n", "utf8");
  }
}

describe("threadle check", () => {
  beforeAll(async () => {
    await ensureWebDist();
  });

  it("reports checks and stays critical-ok with mocked provider", async () => {
    const result = await runCheck();
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));

    expect(byId.node?.ok).toBe(true);
    expect(byId.config?.ok).toBe(true);
    expect(byId.templates?.ok).toBe(true);
    expect(byId["web-dist"]?.ok).toBe(true);
    expect(byId["provider:claude-code"]?.ok).toBe(true);
    expect(byId["providers-any"]?.ok).toBe(true);
    expect(result.ok).toBe(true);

    for (const id of PROVIDER_IDS) {
      expect(byId[`provider:${id}`], `missing provider:${id}`).toBeDefined();
    }
    for (const id of CLI_IDS) {
      expect(byId[id], `missing ${id}`).toBeDefined();
    }

    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      printCheck(result);
    } finally {
      console.log = log;
    }
    expect(lines.join("\n")).toMatch(/threadle check/);
    expect(lines.join("\n")).toMatch(/ready/);
  }, 15_000);

  it("with --providers parses golden fixtures for every provider", async () => {
    const result = await runCheck({ providers: true });
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));

    const fixtureIds = [
      "fixture:claude-code",
      "fixture:cursor",
      "fixture:codex",
      "fixture:antigravity",
      "fixture:opencode",
      "fixture:grok",
    ];
    for (const id of fixtureIds) {
      expect(byId[id], `missing ${id}`).toBeDefined();
      expect(byId[id]?.ok, `${id} should pass`).toBe(true);
      expect(byId[id]?.detail).not.toMatch(/skip/i);
    }

    // Every inject-flag probe id appears (ok or skipped depending on local CLIs)
    for (const p of INJECT_FLAG_PROBES) {
      expect(byId[`flag:${p.id}`], `missing flag:${p.id}`).toBeDefined();
    }
  }, 20_000);
});

describe("golden fixture probe", () => {
  it("resolves fixtures root in this checkout", () => {
    const root = goldenFixturesRoot();
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, "grok"))).toBe(true);
  });

  it("probes all provider fixtures without throwing", async () => {
    const results = await probeGoldenFixtures();
    expect(results.some((r) => r.skipped && r.id === "fixture:all")).toBe(false);
    expect(results.map((r) => r.id).sort()).toEqual(
      [
        "fixture:antigravity",
        "fixture:claude-code",
        "fixture:codex",
        "fixture:cursor",
        "fixture:grok",
        "fixture:opencode",
      ].sort(),
    );
    expect(results.every((r) => r.ok)).toBe(true);
  }, 15_000);
});
