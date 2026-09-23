import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildClaudeAgentArgv } from "../src/providers/claude-code/inject.js";
import { buildAgyAgentArgv } from "../src/providers/antigravity/inject.js";
import { execArgs as codexExecArgs } from "../src/providers/codex/inject.js";
import { logHarnessExtrasLanes } from "../src/providers/harness-extras.js";
import { ensureBareWorkspace } from "../src/providers/bare-workspace.js";

describe("harnessExtras argv", () => {
  it("claude adds --disable-slash-commands when extras off", () => {
    const args = buildClaudeAgentArgv({
      agent: "build",
      prompt: "hi",
      freshSessionId: "sess",
      harnessExtras: false,
    });
    expect(args).toContain("--disable-slash-commands");
    expect(args).not.toContain("--bare");
  });

  it("claude omits skip flags when extras on", () => {
    const args = buildClaudeAgentArgv({
      agent: "build",
      prompt: "hi",
      freshSessionId: "sess",
      harnessExtras: true,
    });
    expect(args).not.toContain("--bare");
    expect(args).not.toContain("--disable-slash-commands");
  });
});

describe("ignoreLocalMarkdown argv", () => {
  it("claude uses --setting-sources user (not --bare)", () => {
    const args = buildClaudeAgentArgv({
      agent: "build",
      prompt: "hi",
      freshSessionId: "sess",
      harnessExtras: false,
      ignoreLocalMarkdown: true,
    });
    expect(args).toContain("--setting-sources");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("user");
    expect(args).not.toContain("--bare");
  });

  it("codex adds --skip-git-repo-check for bare cwd", () => {
    const args = codexExecArgs({
      prompt: "hi",
      ignoreLocalMarkdown: true,
    });
    expect(args).toContain("--skip-git-repo-check");
  });
});

describe("bare workspace", () => {
  it("creates an empty pilot-bare dir", async () => {
    const dir = await ensureBareWorkspace();
    expect(fs.existsSync(dir)).toBe(true);
    expect(path.basename(dir)).toBe("pilot-bare");
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
  });
});

describe("logHarnessExtrasLanes", () => {
  it("lists each muse lane as skipped when extras off", () => {
    const lines: Array<[string, string]> = [];
    logHarnessExtrasLanes((lane, line) => lines.push([lane, line]), "muse", false);
    expect(lines[0]).toEqual(["meta", expect.stringMatching(/extras off · \d+ lanes? skipped/)]);
    expect(lines.some(([, t]) => t.includes("⊘ skill-reminder · skipped"))).toBe(true);
    expect(lines.some(([, t]) => t.includes("⊘ verify-reminder · skipped"))).toBe(true);
    expect(lines.every(([, t]) => !t.includes(" · run") || t.startsWith("extras"))).toBe(true);
  });

  it("lists each muse lane as run when extras on", () => {
    const lines: Array<[string, string]> = [];
    logHarnessExtrasLanes((lane, line) => lines.push([lane, line]), "muse", true);
    expect(lines[0]).toEqual(["meta", expect.stringMatching(/extras on · \d+ lanes?/)]);
    expect(lines.some(([, t]) => t === "· skill-reminder · run")).toBe(true);
    expect(lines.filter(([, t]) => t.includes(" · run")).length).toBeGreaterThanOrEqual(6);
  });

  it("lists claude slash-skills lane", () => {
    const lines: Array<[string, string]> = [];
    logHarnessExtrasLanes((lane, line) => lines.push([lane, line]), "claude-code", false);
    expect(lines.some(([, t]) => t.includes("slash skills") && t.includes("skipped"))).toBe(
      true,
    );
  });
});

describe("antigravity -p prompt attachment", () => {
  it("passes the prompt as -p's value, not a trailing positional", () => {
    const args = buildAgyAgentArgv({
      prompt: "hello",
      harnessExtras: false,
    });
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("hello");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--disable-slash-commands");
    expect(args.at(-1)).not.toBe("hello");
  });
});
