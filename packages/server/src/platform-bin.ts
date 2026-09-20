import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolve a CLI binary across macOS / Linux / Windows.
 * Prefer env override, then known install dirs, then bare name on PATH.
 */
export function resolveCliBin(
  bareName: string,
  opts?: {
    envKeys?: string[];
    extraUnix?: string[];
    extraWin?: string[];
  },
): string {
  for (const key of opts?.envKeys ?? []) {
    const v = process.env[key]?.trim();
    if (v) return v;
  }

  const home = os.homedir();
  const unix = [
    path.join(home, ".local", "bin", bareName),
    ...(opts?.extraUnix ?? []),
    path.join("/usr/local/bin", bareName),
    path.join("/opt/homebrew/bin", bareName),
  ];

  const winNames = [
    bareName,
    `${bareName}.cmd`,
    `${bareName}.exe`,
    `${bareName}.bat`,
  ];
  const localApp = process.env.LOCALAPPDATA?.trim();
  const win: string[] = [];
  for (const n of winNames) {
    win.push(path.join(home, ".local", "bin", n));
    win.push(path.join(home, "AppData", "Local", bareName, n));
    if (localApp) win.push(path.join(localApp, bareName, n));
  }
  for (const extra of opts?.extraWin ?? []) win.push(extra);

  const candidates = process.platform === "win32" ? [...win, ...unix] : [...unix, ...win];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.F_OK);
      return c;
    } catch {
      // try next
    }
  }
  return bareName;
}
