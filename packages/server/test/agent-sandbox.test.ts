import { describe, expect, it } from "vitest";
import { buildClaudeAgentArgv } from "../src/providers/claude-code/inject.js";
import { safetyArgs, execArgs } from "../src/providers/codex/inject.js";

describe("agent permission / sandbox argv", () => {
  it("claude: Plan agent still forces --permission-mode plan", () => {
    const args = buildClaudeAgentArgv({
      agent: "Plan",
      prompt: "hi",
      freshSessionId: "sess-1",
    });
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
  });

  it("claude: explicit permissionMode is passed", () => {
    const args = buildClaudeAgentArgv({
      prompt: "hi",
      freshSessionId: "sess-2",
      permissionMode: "bypassPermissions",
    });
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  it("codex: safetyArgs defaults and overrides", () => {
    expect(safetyArgs()).toEqual([
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
    ]);
    expect(
      safetyArgs({ sandbox: "read-only", askForApproval: "on-request" }),
    ).toEqual([
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "on-request",
    ]);
  });

  it("codex: execArgs includes sandbox from opts", () => {
    const args = execArgs({
      prompt: "do it",
      sandbox: "danger-full-access",
      askForApproval: "on-failure",
    });
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("danger-full-access");
    expect(args[args.indexOf("--ask-for-approval") + 1]).toBe("on-failure");
  });
});
