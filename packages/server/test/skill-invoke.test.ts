import { describe, expect, it, vi, beforeEach } from "vitest";

const runClaudeAgent = vi.fn();
const runCursorAgent = vi.fn();
const runOpencodeAgent = vi.fn();
const runCodexAgent = vi.fn();
const runCopilotAgent = vi.fn();
const runGrokAgent = vi.fn();
const runMuseAgent = vi.fn();
const runAntigravityAgent = vi.fn();

vi.mock("../src/providers/claude-code/inject.js", () => ({
  runClaudeAgent: (...a: unknown[]) => runClaudeAgent(...a),
}));
vi.mock("../src/providers/cursor/inject.js", () => ({
  runCursorAgent: (...a: unknown[]) => runCursorAgent(...a),
}));
vi.mock("../src/providers/opencode/inject.js", () => ({
  runOpencodeAgent: (...a: unknown[]) => runOpencodeAgent(...a),
}));
vi.mock("../src/providers/codex/inject.js", () => ({
  runCodexAgent: (...a: unknown[]) => runCodexAgent(...a),
}));
vi.mock("../src/providers/copilot/inject.js", () => ({
  runCopilotAgent: (...a: unknown[]) => runCopilotAgent(...a),
}));
vi.mock("../src/providers/grok/inject.js", () => ({
  runGrokAgent: (...a: unknown[]) => runGrokAgent(...a),
}));
vi.mock("../src/providers/muse/inject.js", () => ({
  runMuseAgent: (...a: unknown[]) => runMuseAgent(...a),
}));
vi.mock("../src/providers/antigravity/inject.js", () => ({
  runAntigravityAgent: (...a: unknown[]) => runAntigravityAgent(...a),
}));

import {
  runSkillInvoke,
  skillInvokePrompt,
} from "../src/workflows/skill-invoke.js";

beforeEach(() => {
  for (const fn of [
    runClaudeAgent,
    runCursorAgent,
    runOpencodeAgent,
    runCodexAgent,
    runCopilotAgent,
    runGrokAgent,
    runMuseAgent,
    runAntigravityAgent,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue({
      newSessionId: "s1",
      provider: "claude-code",
      resultText: "ok",
    });
  }
});

describe("skillInvokePrompt", () => {
  it("builds slash prompt with optional extra", () => {
    expect(skillInvokePrompt("pdf-fill")).toBe("/pdf-fill");
    expect(skillInvokePrompt("/pdf-fill", " go")).toBe("/pdf-fill\n\ngo");
  });
});

describe("runSkillInvoke providers", () => {
  const base = {
    skillName: "demo",
    projectDir: "/tmp",
  };

  it.each([
    ["claude-code", runClaudeAgent],
    ["cursor", runCursorAgent],
    ["opencode", runOpencodeAgent],
    ["codex", runCodexAgent],
    ["copilot", runCopilotAgent],
    ["grok", runGrokAgent],
    ["muse", runMuseAgent],
    ["antigravity", runAntigravityAgent],
  ] as const)("dispatches %s", async (provider, fn) => {
    await runSkillInvoke({ ...base, provider, extra: "ctx" });
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0]![0]).toMatchObject({
      prompt: "/demo\n\nctx",
      projectDir: "/tmp",
    });
  });
});
