import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execaSync } from "execa";
import { resolveCliBin } from "../../platform-bin.js";

let cached: string | undefined;

/**
 * True when `bin` is Grok Build's `agent` shim (same name, different product).
 * Grok installs `~/.local/bin/agent` → `~/.grok/bin/agent`, which shadows Cursor.
 */
export function isGrokAgentBinary(bin: string): boolean {
  try {
    const real = fs.realpathSync(bin);
    const norm = real.replace(/\\/g, "/").toLowerCase();
    if (norm.includes("/.grok/") || norm.endsWith("/grok/bin/agent")) return true;
  } catch {
    /* missing / unreadable */
  }
  const norm = bin.replace(/\\/g, "/").toLowerCase();
  return norm.includes("/.grok/");
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string): string | undefined {
  try {
    const { stdout } = execaSync(process.platform === "win32" ? "where" : "which", [cmd], {
      timeout: 5_000,
      reject: false,
    });
    const line = stdout.trim().split("\n")[0]?.trim();
    return line || undefined;
  } catch {
    return undefined;
  }
}

/** Prefer a candidate that exists and is not Grok's agent. */
function pick(candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    if (!c) continue;
    if (!exists(c)) continue;
    if (isGrokAgentBinary(c)) continue;
    return c;
  }
  return undefined;
}

function withWinExt(p: string): string[] {
  if (process.platform !== "win32") return [p];
  if (/\.(cmd|exe|bat)$/i.test(p)) return [p];
  return [p, `${p}.cmd`, `${p}.exe`, `${p}.bat`];
}

/**
 * Resolve the Cursor Agent CLI.
 *
 * Prefer `cursor-agent` (official install name under `~/.local/bin` /
 * `~/.local/share/cursor-agent`). Bare `agent` is accepted only when it is
 * not Grok Build's conflicting shim.
 */
export function agentBin(): string {
  if (cached) return cached;
  const fromEnv = process.env.CURSOR_AGENT_PATH?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  const home = os.homedir();
  const shareVersions = path.join(home, ".local", "share", "cursor-agent", "versions");
  const versioned: string[] = [];
  try {
    const dirs = fs.readdirSync(shareVersions, { withFileTypes: true });
    const names = dirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const name of names) {
      versioned.push(...withWinExt(path.join(shareVersions, name, "cursor-agent")));
    }
  } catch {
    /* no share dir */
  }

  const localBins = [
    ...withWinExt(path.join(home, ".local", "bin", "cursor-agent")),
    ...withWinExt(path.join(home, ".cursor", "bin", "cursor-agent")),
    ...withWinExt(path.join(home, ".cursor", "bin", "agent")),
  ];

  const hit = pick([
    ...localBins,
    ...versioned,
    ...withWinExt("/usr/local/bin/cursor-agent"),
    ...withWinExt("/opt/homebrew/bin/cursor-agent"),
    which("cursor-agent"),
    // Bare `agent` last — often stolen by Grok Build
    ...withWinExt(path.join(home, ".local", "bin", "agent")),
    ...withWinExt("/usr/local/bin/agent"),
    ...withWinExt("/opt/homebrew/bin/agent"),
    which("agent"),
  ]);

  if (hit) {
    cached = hit;
    return cached;
  }

  // Fall back to platform-bin resolution (adds AppData / LOCALAPPDATA probes)
  const viaPlatform = resolveCliBin("cursor-agent", {
    envKeys: ["CURSOR_AGENT_PATH"],
  });
  if (viaPlatform !== "cursor-agent" && exists(viaPlatform) && !isGrokAgentBinary(viaPlatform)) {
    cached = viaPlatform;
    return cached;
  }

  cached = "cursor-agent";
  return cached;
}

/** Reset cached path (tests). */
export function resetAgentBinCache(): void {
  cached = undefined;
}
