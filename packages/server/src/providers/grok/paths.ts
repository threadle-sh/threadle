import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCliBin } from "../../platform-bin.js";

/** Grok Build home: `$GROK_HOME` or `~/.grok`. */
export function grokHome(): string {
  const env = process.env.GROK_HOME?.trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".grok");
}

export function sessionsRoot(): string {
  return path.join(grokHome(), "sessions");
}

export function activeSessionsPath(): string {
  return path.join(grokHome(), "active_sessions.json");
}

let cachedBin: string | undefined;

/** Resolve the `grok` CLI binary. */
export function grokBin(): string {
  if (cachedBin) return cachedBin;
  const fromEnv = process.env.GROK_PATH?.trim();
  if (fromEnv) {
    cachedBin = fromEnv;
    return cachedBin;
  }
  const homeBin = path.join(grokHome(), "bin", "grok");
  cachedBin = resolveCliBin("grok", {
    extraUnix: [
      homeBin,
      path.join(os.homedir(), ".local", "bin", "grok"),
    ],
    extraWin: [
      path.join(grokHome(), "bin", "grok.cmd"),
      path.join(grokHome(), "bin", "grok.exe"),
      homeBin,
    ],
  });
  if (cachedBin === "grok") {
    try {
      fs.accessSync(homeBin, fs.constants.F_OK);
      cachedBin = homeBin;
    } catch {
      /* PATH */
    }
  }
  return cachedBin;
}

/** Reset cached bin (tests). */
export function resetGrokBinCache(): void {
  cachedBin = undefined;
}
