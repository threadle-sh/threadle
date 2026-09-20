import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Prefer THREADLE_CONFIG_DIR; otherwise ~/.config/threadle (migrating ~/.config/weft once). */
export function threadleConfigDir(): string {
  if (process.env.THREADLE_CONFIG_DIR) return process.env.THREADLE_CONFIG_DIR;
  const next = path.join(os.homedir(), ".config", "threadle");
  const legacy = path.join(os.homedir(), ".config", "weft");
  try {
    if (!fs.existsSync(next) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, next);
      console.error(`[threadle] migrated config ${legacy} → ${next}`);
    }
  } catch {
    // if rename fails (cross-device, permissions), fall back to legacy path
    if (fs.existsSync(legacy)) return legacy;
  }
  return next;
}

/** Threadle-managed skill libraries: custom (authored) and imported packs. */
export function threadleSkillsDir(kind: "custom" | "imported"): string {
  return path.join(threadleConfigDir(), "skills", kind);
}

/** Resolve + realpath when possible so symlink/cwd variants still match. */
export function normalizeProjectDir(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) return trimmed;
  const resolved = path.resolve(trimmed);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** True when two project dirs refer to the same folder (===, then normalized). */
export function sameProjectDir(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return normalizeProjectDir(a) === normalizeProjectDir(b);
}
