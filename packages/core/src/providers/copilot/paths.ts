import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCliBin } from "../../platform-bin.js";

/** Copilot home: `$COPILOT_HOME` or `~/.copilot`. */
export function copilotHome(): string {
  const env = process.env.COPILOT_HOME?.trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".copilot");
}

export function sessionStateDir(): string {
  return path.join(copilotHome(), "session-state");
}

export function sessionStoreDbPath(): string {
  return path.join(copilotHome(), "session-store.db");
}

let cachedBin: string | undefined;

/** Resolve the `copilot` CLI binary. */
export function copilotBin(): string {
  if (cachedBin) return cachedBin;
  const fromEnv = process.env.COPILOT_PATH?.trim();
  if (fromEnv) {
    cachedBin = fromEnv;
    return cachedBin;
  }
  const homeBin = path.join(copilotHome(), "bin", "copilot");
  cachedBin = resolveCliBin("copilot", {
    extraUnix: [
      homeBin,
      path.join(os.homedir(), ".local", "bin", "copilot"),
    ],
    extraWin: [
      path.join(copilotHome(), "bin", "copilot.cmd"),
      path.join(copilotHome(), "bin", "copilot.exe"),
      homeBin,
    ],
  });
  if (cachedBin === "copilot") {
    try {
      fs.accessSync(homeBin, fs.constants.F_OK);
      cachedBin = homeBin;
    } catch {
      /* PATH */
    }
  }
  return cachedBin;
}
