import { describe, expect, it } from "vitest";
import { buildClaudeAgentArgv } from "../src/providers/claude-code/inject.js";
import { execArgs, safetyArgs } from "../src/providers/codex/inject.js";

describe("claude agent argv", () => {
  it("defaults Plan agent to --permission-mode plan", () => {
    const args = buildClaudeAgentArgv({
      agent: "Plan",
      prompt: "hi",
      freshSessionId: "abc",
    });
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode")! + 1]).toBe("plan");
  });

  it("honors explicit permissionMode over Plan default", () => {
    const args = buildClaudeAgentArgv({
      agent: "Plan",
      prompt: "hi",
      freshSessionId: "abc",
      permissionMode: "bypassPermissions",
    });
    expect(args[args.indexOf("--permission-mode")! + 1]).toBe("bypassPermissions");
  });

  it("passes permissionMode for ordinary agents", () => {
    const args = buildClaudeAgentArgv({
      agent: "build",
      prompt: "x",
      freshSessionId: "s1",
      permissionMode: "acceptEdits",
    });
    expect(args).toEqual(
      expect.arrayContaining(["--permission-mode", "acceptEdits"]),
    );
  });

  it("uses --resume when sessionId is set", () => {
    const args = buildClaudeAgentArgv({
      prompt: "cont",
      sessionId: "old-ses",
      permissionMode: "plan",
    });
    expect(args.slice(0, 3)).toEqual(["--resume", "old-ses", "-p"]);
  });
});

describe("codex safety argv", () => {
  it("defaults sandbox and ask-for-approval", () => {
    expect(safetyArgs()).toEqual([
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
    ]);
  });

  it("uses opts.sandbox / askForApproval when set", () => {
    expect(
      safetyArgs({ sandbox: "read-only", askForApproval: "on-request" }),
    ).toEqual(["--sandbox", "read-only", "--ask-for-approval", "on-request"]);
  });

  it("threads safety into execArgs", () => {
    const args = execArgs({
      prompt: "do it",
      sandbox: "danger-full-access",
      askForApproval: "never",
      model: "gpt-5",
    });
    expect(args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
      "--model",
      "gpt-5",
      "do it",
    ]);
  });
});
