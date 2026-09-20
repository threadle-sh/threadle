/**
 * Path allowlist for in-app file reads (`/api/files/read`, `/exists`).
 * Only project dirs, threadle config, and discovered provider stores.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathContained } from "./path-safe.js";
import { threadleConfigDir } from "./paths.js";
import { defaultProjectDir } from "./routes/agents.js";
import { claudeHome } from "./providers/claude-code/discover.js";
import { cursorHome } from "./providers/cursor/paths.js";
import { antigravityHome } from "./providers/antigravity/paths.js";
import { opencodeDataDir } from "./providers/opencode/db.js";
import { codexHome } from "./providers/codex/paths.js";
import { copilotHome } from "./providers/copilot/paths.js";
import { grokHome } from "./providers/grok/paths.js";
import { registry } from "./providers/registry.js";

/** Sensitive trees — never readable even if somehow nested under an allowed root. */
const SENSITIVE_SEGMENTS = [
  `${path.sep}.ssh${path.sep}`,
  `${path.sep}.gnupg${path.sep}`,
  `${path.sep}.aws${path.sep}`,
  `${path.sep}.kube${path.sep}`,
  `${path.sep}.docker${path.sep}`,
  `${path.sep}Library${path.sep}Keychains${path.sep}`,
];

const SENSITIVE_PREFIXES = [
  path.sep + "etc",
  path.sep + "private" + path.sep + "etc",
  path.sep + "var" + path.sep + "root",
  path.sep + "root",
  path.sep + "System",
];

function endsWithSep(p: string): string {
  return p.endsWith(path.sep) ? p : p + path.sep;
}

/** Case-fold for comparisons on case-insensitive filesystems (darwin/win32). */
const FOLD_CASE = process.platform === "win32" || process.platform === "darwin";
const fold = (s: string): string => (FOLD_CASE ? s.toLowerCase() : s);

export function isSensitivePath(target: string): boolean {
  const n = fold(path.resolve(target));
  const withSep = endsWithSep(n);
  for (const seg of SENSITIVE_SEGMENTS) {
    const s = fold(seg);
    if (withSep.includes(s) || n.endsWith(s.slice(0, -1))) return true;
  }
  const home = os.homedir();
  const ssh = path.join(home, ".ssh");
  if (pathContained(n, ssh) || n === fold(ssh)) return true;
  for (const pref of SENSITIVE_PREFIXES) {
    const p = fold(pref);
    if (n === p || n.startsWith(p + path.sep)) return true;
  }
  return false;
}

function pushRoot(out: string[], root: string | undefined): void {
  if (!root) return;
  try {
    out.push(path.resolve(root));
  } catch {
    /* ignore */
  }
}

/**
 * Provider store roots. Readable for transcripts/session data, but these
 * trees also hold LIVE CREDENTIALS (`~/.codex/auth.json`,
 * `~/.claude/.credentials.json`, `~/.gemini/oauth_creds.json`, …) — reads
 * inside them additionally pass a credential-basename denylist.
 */
export function providerStoreRoots(): string[] {
  const roots: string[] = [];
  pushRoot(roots, claudeHome());
  pushRoot(roots, cursorHome());
  pushRoot(roots, antigravityHome());
  pushRoot(roots, path.join(os.homedir(), ".gemini"));
  pushRoot(roots, opencodeDataDir());
  pushRoot(roots, codexHome());
  pushRoot(roots, copilotHome());
  pushRoot(roots, grokHome());
  return [...new Set(roots)];
}

/**
 * Credential-shaped basenames denied inside provider store roots. Scoped to
 * those roots (not project dirs) so test fixtures like `dummy.pem` in a repo
 * stay readable.
 */
const CREDENTIAL_BASENAME =
  /^(auth\.json|\.?credentials(\..+)?|oauth[^/\\]*|api_?key[^/\\]*|tokens?(\..+)?|.+\.(pem|key))$/i;

function isProviderCredentialPath(target: string): boolean {
  const base = path.basename(target);
  if (!CREDENTIAL_BASENAME.test(base)) return false;
  return providerStoreRoots().some(
    (root) => pathContained(target, root) || path.resolve(target) === root,
  );
}

/** Static roots always allowed (provider stores + threadle + cwd). */
export function staticReadableRoots(projectDir?: string): string[] {
  const roots: string[] = [];
  pushRoot(roots, projectDir ?? defaultProjectDir ?? process.cwd());
  pushRoot(roots, threadleConfigDir());
  pushRoot(roots, path.join(os.homedir(), ".config", "weft"));
  for (const r of providerStoreRoots()) pushRoot(roots, r);
  // Inject/agent temps live under threadle config — not the whole OS tmp tree.
  pushRoot(roots, path.join(threadleConfigDir(), "tmp"));
  // de-dupe
  return [...new Set(roots)];
}

async function sessionProjectRoots(): Promise<string[]> {
  const out: string[] = [];
  try {
    for (const p of registry.providers.values()) {
      try {
        if (!(await p.available())) continue;
        const sessions = await p.listSessions();
        for (const s of sessions) {
          if (s.projectDir) pushRoot(out, s.projectDir);
        }
      } catch {
        /* skip provider */
      }
    }
  } catch {
    /* registry not ready */
  }
  return [...new Set(out)];
}

async function real(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    // Dangling / unreadable symlink: realpath fails. Resolve the link text
    // so we never treat the symlink's own path (inside an allowed root) as
    // the file — that would let `root/notes.md → ~/.ssh/id_rsa` pass.
    try {
      const st = await fs.promises.lstat(p);
      if (st.isSymbolicLink()) {
        const target = await fs.promises.readlink(p);
        return path.resolve(path.dirname(p), target);
      }
    } catch {
      /* ignore */
    }
    return path.resolve(p);
  }
}

/**
 * True when `dir` is a directory the user demonstrably works in: the default
 * project dir or a project dir of a discovered session (or nested inside one).
 * Gate for query-supplied `dir`/`projectDir` params on routes that spawn
 * processes or walk configs relative to that directory (MCP discovery, git).
 */
export async function isKnownProjectDir(dir: string): Promise<boolean> {
  const resolved = path.resolve(dir);
  if (isSensitivePath(resolved)) return false;
  const roots: string[] = [];
  pushRoot(roots, defaultProjectDir ?? process.cwd());
  for (const r of await sessionProjectRoots()) pushRoot(roots, r);
  const realTarget = await real(resolved);
  for (const root of roots) {
    const realRoot = await real(root);
    if (pathContained(realTarget, realRoot) || realTarget === realRoot) return true;
  }
  return false;
}

/**
 * True when `target` resolves inside an allowlisted root and is not sensitive.
 */
export async function isReadablePath(
  target: string,
  projectDir?: string,
): Promise<boolean> {
  const resolved = path.resolve(target);
  if (isSensitivePath(resolved)) return false;

  const roots = [
    ...staticReadableRoots(projectDir),
    ...(await sessionProjectRoots()),
  ];
  const realTarget = await real(resolved);
  if (isSensitivePath(realTarget)) return false;
  if (isProviderCredentialPath(realTarget) || isProviderCredentialPath(resolved)) {
    return false;
  }

  // Containment is decided on REALPATHS only — a lexical check here would let
  // a symlink inside an allowed root grant its out-of-root target.
  for (const root of roots) {
    const realRoot = await real(root);
    if (pathContained(realTarget, realRoot) || realTarget === realRoot) {
      return true;
    }
  }

  // Not-yet-created files (`/exists` probes, editor targets): the leaf has no
  // realpath, so containment-check the nearest existing ancestor's realpath
  // instead of trusting the lexical path.
  const exists = await fs.promises.lstat(resolved).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const parentReal = await real(path.dirname(resolved));
    if (isSensitivePath(parentReal)) return false;
    for (const root of roots) {
      const realRoot = await real(root);
      if (pathContained(parentReal, realRoot) || parentReal === realRoot) {
        return true;
      }
    }
  }
  return false;
}
