import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCliBin } from "../../platform-bin.js";

/** Muse Code config/auth home: `$MUSE_HOME` or `~/.muse`. Never write here. */
export function museConfigHome(): string {
  const env = process.env.MUSE_HOME?.trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".muse");
}

/**
 * Muse data share (sessions, skills, plugins, runtime).
 * `$MUSE_DATA_DIR` or `$XDG_DATA_HOME/muse` or `~/.local/share/muse`.
 */
export function museShare(): string {
  const env = process.env.MUSE_DATA_DIR?.trim();
  if (env) return path.resolve(env);
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return path.join(path.resolve(xdg), "muse");
  return path.join(os.homedir(), ".local", "share", "muse");
}

export function sessionsRoot(): string {
  return path.join(museShare(), "sessions");
}

export function sessionIndexDb(): string {
  return path.join(museShare(), "session-index.db");
}

export function runtimeSessionsDir(): string {
  return path.join(museShare(), "runtime", "muse", "sessions");
}

export function skillsRoot(): string {
  return path.join(museShare(), "skills");
}

export function pluginsRoot(): string {
  return path.join(museShare(), "plugins");
}

let cachedBin: string | undefined;

/** Resolve the `muse` CLI binary. */
export function museBin(): string {
  if (cachedBin) return cachedBin;
  const fromEnv = process.env.MUSE_PATH?.trim();
  if (fromEnv) {
    cachedBin = fromEnv;
    return cachedBin;
  }
  cachedBin = resolveCliBin("muse", {
    extraUnix: [path.join(os.homedir(), ".local", "bin", "muse")],
  });
  return cachedBin;
}

export function resetMuseBinCache(): void {
  cachedBin = undefined;
}

export function sessionsRootAvailable(): boolean {
  try {
    fs.accessSync(sessionsRoot(), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
