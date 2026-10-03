import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentBin,
  isGrokAgentBinary,
  resetAgentBinCache,
} from "../src/providers/cursor/agent-bin.js";

const prevPath = process.env.CURSOR_AGENT_PATH;
const prevHome = process.env.HOME;
const prevUserProfile = process.env.USERPROFILE;

function stubHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

function restoreHome(): void {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
}

/** Symlink if possible; copy on Windows without Developer Mode. */
function linkOrCopy(target: string, linkPath: string): void {
  try {
    fs.symlinkSync(target, linkPath);
  } catch {
    fs.copyFileSync(target, linkPath);
  }
}

afterEach(() => {
  resetAgentBinCache();
  if (prevPath === undefined) delete process.env.CURSOR_AGENT_PATH;
  else process.env.CURSOR_AGENT_PATH = prevPath;
  restoreHome();
});

describe("cursor agentBin", () => {
  it("honors CURSOR_AGENT_PATH", () => {
    process.env.CURSOR_AGENT_PATH = path.join(os.tmpdir(), "fake-cursor-agent");
    resetAgentBinCache();
    expect(agentBin()).toBe(process.env.CURSOR_AGENT_PATH);
  });

  it("detects Grok agent paths", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-agent-bin-"));
    const grokBin = path.join(tmp, ".grok", "bin", "agent");
    fs.mkdirSync(path.dirname(grokBin), { recursive: true });
    fs.writeFileSync(grokBin, "#!/bin/sh\necho grok\n", { mode: 0o755 });
    const link = path.join(tmp, "agent");
    linkOrCopy(grokBin, link);
    expect(isGrokAgentBinary(link)).toBe(true);
    expect(isGrokAgentBinary(grokBin)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("prefers cursor-agent over Grok's agent shim in HOME", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-home-"));
    stubHome(home);
    resetAgentBinCache();
    delete process.env.CURSOR_AGENT_PATH;

    const localBin = path.join(home, ".local", "bin");
    fs.mkdirSync(localBin, { recursive: true });
    const grokReal = path.join(home, ".grok", "bin", "agent");
    fs.mkdirSync(path.dirname(grokReal), { recursive: true });
    fs.writeFileSync(grokReal, "#!/bin/sh\necho grok\n", { mode: 0o755 });
    linkOrCopy(grokReal, path.join(localBin, "agent"));

    const cursorAgent = path.join(localBin, "cursor-agent");
    fs.writeFileSync(cursorAgent, "#!/bin/sh\necho cursor\n", { mode: 0o755 });

    // agentBin uses os.homedir() — stubbing USERPROFILE+HOME covers win32 + Unix
    expect(agentBin()).toBe(cursorAgent);
    expect(isGrokAgentBinary(agentBin())).toBe(false);

    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
});
