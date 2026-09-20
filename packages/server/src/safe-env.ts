/**
 * Minimal env for child processes (custom nodes, MCP client spawns).
 * Does not inherit API keys from the threadle server unless the caller
 * merges explicit extras (e.g. `.mcp.json` `env` or custom-node `"env": "inherit"`).
 */
export const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "PATHEXT",
  "TERM",
  "SHELL",
  "SystemRoot",
  "COMSPEC",
  // MCP recursion guard: children must INHERIT the depth counter, or a
  // wrapper script around `threadle mcp` resets to depth 0 and the
  // nested-recursion refusal never fires.
  "THREADLE_MCP_DEPTH",
  "THREADLE_MCP_STACK",
] as const;

/** Allowlisted vars from `process.env` as a plain string record. */
export function allowlistedProcessEnv(
  allowlist: readonly string[] = CHILD_ENV_ALLOWLIST,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of allowlist) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

/**
 * Child env = allowlist from the server process, then explicit `extra`
 * (manifest / `.mcp.json` env) on top so user-declared secrets still work.
 */
export function childProcessEnv(
  extra?: Record<string, string>,
  allowlist: readonly string[] = CHILD_ENV_ALLOWLIST,
): Record<string, string> {
  const env = allowlistedProcessEnv(allowlist);
  if (extra) Object.assign(env, extra);
  return env;
}
