import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCliBin } from "../../platform-bin.js";

/** Codex home: `$CODEX_HOME` or `~/.codex`. */
export function codexHome(): string {
  const env = process.env.CODEX_HOME?.trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".codex");
}

export function sessionsDir(): string {
  return path.join(codexHome(), "sessions");
}

export function archivedSessionsDir(): string {
  return path.join(codexHome(), "archived_sessions");
}

let cachedBin: string | undefined;

/** Resolve the `codex` CLI binary. */
export function codexBin(): string {
  if (cachedBin) return cachedBin;
  const fromEnv = process.env.CODEX_PATH?.trim();
  if (fromEnv) {
    cachedBin = fromEnv;
    return cachedBin;
  }
  const codexHomeBin = path.join(codexHome(), "bin", "codex");
  cachedBin = resolveCliBin("codex", {
    extraUnix: [codexHomeBin],
    extraWin: [
      path.join(codexHome(), "bin", "codex.cmd"),
      path.join(codexHome(), "bin", "codex.exe"),
      codexHomeBin,
    ],
  });
  if (cachedBin === "codex") {
    try {
      fs.accessSync(codexHomeBin, fs.constants.F_OK);
      cachedBin = codexHomeBin;
    } catch {
      /* PATH */
    }
  }
  return cachedBin;
}
