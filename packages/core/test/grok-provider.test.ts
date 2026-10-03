import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrokProvider } from "../src/providers/grok/index.js";
import { discoverSessions, liveStatuses } from "../src/providers/grok/discover.js";
import { readGrokTranscript } from "../src/providers/grok/transcript.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/providers/grok",
);
const planSessionId = "01a0b4cb-89b1-7272-9175-a4b4e5ebd857";
const noPlanSessionId = "b2c3d4e5-6789-4abc-def0-111111111111";
const updatesOnlyId = "c3d4e5f6-7890-4bcd-ef01-222222222222";
const projectDir = "/tmp/grok-fx";
const prevHome = process.env.GROK_HOME;

beforeAll(() => {
  process.env.GROK_HOME = fixtureRoot;
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = prevHome;
});

describe("grok provider", () => {
  it("discovers three fixture sessions from ~/.grok/sessions layout", async () => {
    const refs = await discoverSessions();
    expect(refs.map((r) => r.id).sort()).toEqual(
      [planSessionId, noPlanSessionId, updatesOnlyId].sort(),
    );
    const hit = refs.find((r) => r.id === planSessionId)!;
    expect(hit.provider).toBe("grok");
    expect(hit.projectDir).toBe(projectDir);
    expect(hit.title).toBe("Fixture Grok Hello");
    expect(hit.messageCount).toBeGreaterThan(0);
    expect(hit.tokensIn).toBe(18560);
    expect(hit.tokensOut).toBe(62);
    expect(hit.tokensReasoning).toBe(36);
    expect(hit.tokensCacheRead).toBe(768);
    expect(hit.cost).toBeCloseTo(123556000 / 1e10, 8);
    expect(hit.actualCost).toBe(0);
  });

  it("reads .cwd hint for projectDir grouping", async () => {
    const refs = await discoverSessions();
    expect(refs.every((r) => r.projectDir === projectDir)).toBe(true);
  });

  it("reads transcript from chat_history.jsonl (skips system / user_info / tools)", async () => {
    const msgs = await readGrokTranscript(planSessionId);
    expect(msgs.length).toBeGreaterThanOrEqual(4);
    const roles = msgs.map((m) => m.role);
    expect(roles.filter((r) => r === "user").length).toBe(2);
    expect(msgs.some((m) => m.parts.some((p) => p.type === "thinking"))).toBe(true);
    const user = msgs.find((m) => m.role === "user");
    expect(user?.parts.some((p) => p.type === "text" && p.text?.includes("hello grok"))).toBe(
      true,
    );
    // harness wrappers must not appear
    expect(
      msgs.every(
        (m) =>
          !m.parts.some(
            (p) =>
              p.type === "text" &&
              (p.text?.startsWith("<user_info>") || p.text?.includes("Skip this in transcript")),
          ),
      ),
    ).toBe(true);
    const assistant = msgs.find(
      (m) => m.role === "assistant" && m.parts.some((p) => p.type === "text"),
    );
    expect(assistant?.parts.some((p) => p.type === "text" && p.text?.includes("fixture"))).toBe(
      true,
    );
  });

  it("falls back to updates.jsonl when chat_history is missing", async () => {
    const msgs = await readGrokTranscript(updatesOnlyId);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.some((m) => m.role === "user" && m.parts.some((p) => p.text?.includes("updates only")))).toBe(
      true,
    );
    expect(
      msgs.some(
        (m) =>
          m.role === "assistant" &&
          m.parts.some((p) => p.type === "thinking" && p.text?.includes("thinking via updates")),
      ),
    ).toBe(true);
    expect(
      msgs.some(
        (m) =>
          m.role === "assistant" &&
          m.parts.some((p) => p.type === "text" && p.text?.includes("reply from updates.jsonl")),
      ),
    ).toBe(true);
  });

  it("lists plan.md and tool paths with ops from updates.jsonl", async () => {
    const p = new GrokProvider();
    const files = await p.getTouchedFiles(planSessionId);
    expect(files.some((f) => f.path.endsWith("plan.md") && f.op === "write")).toBe(true);
    expect(files.some((f) => f.path.endsWith("README.md") && f.op === "read")).toBe(true);
    expect(files.some((f) => f.path.endsWith("src/main.ts") && f.op === "edit")).toBe(true);
    expect(files.some((f) => f.path.endsWith("NOTES.md") && f.op === "write")).toBe(true);
    const sess = await p.getSession(planSessionId);
    expect(typeof sess?.meta?.planPath).toBe("string");
    expect(String(sess?.meta?.planPath)).toMatch(/plan\.md$/);
    expect(sess?.meta?.planMode).toBe("Active");
    expect(sess?.meta?.planAwaitingApproval).toBe(true);
  });

  it("omits plan meta when plan.md / plan_mode.json are absent", async () => {
    const p = new GrokProvider();
    const sess = await p.getSession(noPlanSessionId);
    expect(sess?.title).toBe("Fixture Grok No Plan");
    expect(sess?.meta?.planPath).toBeUndefined();
    expect(sess?.meta?.planMode).toBeUndefined();
    const files = await p.getTouchedFiles(noPlanSessionId);
    expect(files.every((f) => !f.path.endsWith("plan.md"))).toBe(true);
  });

  it("does not mark dead active_sessions pid as running", async () => {
    const live = await liveStatuses();
    expect(live.has(planSessionId)).toBe(false);
    const p = new GrokProvider();
    const sess = await p.getSession(planSessionId);
    expect(sess?.status).toBe("idle");
  });
});

describe("grok fixture files exist", () => {
  it("ships anonymized plan + no-plan + updates-only sessions", () => {
    const group = path.join(fixtureRoot, "sessions", "project");
    expect(fs.existsSync(path.join(group, ".cwd"))).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, "active_sessions.json"))).toBe(true);

    const planDir = path.join(group, planSessionId);
    for (const name of [
      "summary.json",
      "chat_history.jsonl",
      "usage.json",
      "updates.jsonl",
      "plan.md",
      "plan_mode.json",
    ]) {
      expect(fs.existsSync(path.join(planDir, name))).toBe(true);
    }

    const noPlanDir = path.join(group, noPlanSessionId);
    expect(fs.existsSync(path.join(noPlanDir, "summary.json"))).toBe(true);
    expect(fs.existsSync(path.join(noPlanDir, "plan.md"))).toBe(false);

    const updatesDir = path.join(group, updatesOnlyId);
    expect(fs.existsSync(path.join(updatesDir, "updates.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(updatesDir, "chat_history.jsonl"))).toBe(false);

    // ensure we did not leave a real home path in the fixture
    for (const file of fs.readdirSync(planDir)) {
      const text = fs.readFileSync(path.join(planDir, file), "utf8");
      expect(text).not.toContain("/Users/");
    }
  });

  it("reads inject usage from usage.json", async () => {
    const { readGrokUsageFile } = await import("../src/providers/grok/usage.js");
    const usagePath = path.join(
      fixtureRoot,
      "sessions",
      "project",
      noPlanSessionId,
      "usage.json",
    );
    expect(readGrokUsageFile(usagePath)).toEqual({
      inputTokens: 100,
      outputTokens: 20,
    });
  });
});
