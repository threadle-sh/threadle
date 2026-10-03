import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCliBin } from "../../platform-bin.js";

let cached: string | undefined;

/**
 * Resolve the Antigravity `agy` CLI. GUI-launched threadle often lacks
 * `~/.local/bin` on PATH even when the binary is installed there.
 */
export function agyBin(): string {
  if (cached) return cached;
  const fromEnv = process.env.ANTIGRAVITY_CLI_PATH?.trim() || process.env.AGY_PATH?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }
  const geminiBin = path.join(os.homedir(), ".gemini", "bin", "agy");
  cached = resolveCliBin("agy", {
    extraUnix: [geminiBin],
    extraWin: [
      path.join(os.homedir(), ".gemini", "bin", "agy.cmd"),
      path.join(os.homedir(), ".gemini", "bin", "agy.exe"),
      geminiBin,
    ],
  });
  if (cached === "agy") {
    try {
      fs.accessSync(geminiBin, fs.constants.F_OK);
      cached = geminiBin;
    } catch {
      /* PATH */
    }
  }
  return cached;
}
