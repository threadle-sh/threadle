import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { registry } from "./providers/registry.js";
import { WORKFLOW_TEMPLATES } from "./templates/workflows.js";
import { threadleConfigDir } from "./graphs/store.js";
import { agentBin } from "./providers/cursor/agent-bin.js";
import { agyBin } from "./providers/antigravity/agy-bin.js";
import { probeInjectFlags } from "./providers/freshness/probe.js";
import { probeGoldenFixtures } from "./providers/freshness/fixtures.js";
import { probeUpstream } from "./providers/freshness/upstream.js";
import { grokBin } from "./providers/grok/paths.js";
import { museBin } from "./providers/muse/paths.js";
import { codexBin } from "./providers/codex/paths.js";
import { copilotBin } from "./providers/copilot/paths.js";

export interface EnvCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface RunCheckOptions {
  /**
   * When true, probe installed agent CLIs' `--help` for inject-critical flags
   * and parse golden fixtures for every provider (when the fixture tree is
   * present — repo checkout / CI; skipped in published installs).
   * Missing binaries are skipped; missing flags or fixture parse failures
   * set `ok` false.
   */
  providers?: boolean;
  /**
   * When true, compare pinned npm / GitHub release versions in
   * `providers/freshness/upstream.ts` to live latest. Drift is a check
   * failure (adapters may be behind).
   */
  upstream?: boolean;
}

async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa(process.platform === "win32" ? "where" : "which", [cmd], {
      timeout: 2_500,
      reject: false,
    });
    const line = stdout.trim().split("\n")[0]?.trim();
    return line || undefined;
  } catch {
    return undefined;
  }
}

async function binReachable(bin: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout, exitCode } = await execa(bin, args, {
      timeout: 3_000,
      reject: false,
    });
    if (exitCode !== 0 && !stdout.trim()) return undefined;
    return stdout.trim().split("\n")[0]?.trim() || "ok";
  } catch {
    return undefined;
  }
}

async function checkPathCli(id: string, cmd: string): Promise<EnvCheck> {
  const found = await which(cmd);
  if (!found) return { id, ok: false, detail: `${cmd} not on PATH` };
  const ver = await binReachable(found, ["--version"]);
  return { id, ok: true, detail: ver ? `${found} (${ver})` : found };
}

async function checkPreferredOrPath(
  id: string,
  preferred: string,
  pathCmd: string,
): Promise<EnvCheck> {
  try {
    await fs.promises.access(preferred, fs.constants.F_OK);
    const ver = await binReachable(preferred, ["--version"]);
    return { id, ok: true, detail: ver ? `${preferred} (${ver})` : preferred };
  } catch {
    const onPath = await which(pathCmd);
    if (onPath) return { id, ok: true, detail: onPath };
    return { id, ok: false, detail: `${pathCmd} not found` };
  }
}

function webDistPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../web-dist");
}

/**
 * First-run / support diagnostics — PATH, providers, config, UI assets, templates.
 * Exit code should be 0 if all critical checks pass; non-zero if any fail.
 * Pass `{ providers: true }` (CLI: `threadle check --providers`) to also parse
 * golden fixtures (when present) and probe inject-critical CLI flags.
 */
export async function runCheck(
  opts: RunCheckOptions = {},
): Promise<{ checks: EnvCheck[]; ok: boolean }> {
  const checks: EnvCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node",
    ok: nodeMajor >= 22,
    detail: `Node ${process.versions.node}${nodeMajor >= 22 ? "" : " (need ≥ 22.12)"}`,
  });

  const cfg = threadleConfigDir();
  let cfgOk = false;
  let cfgDetail = cfg;
  try {
    await fs.promises.mkdir(cfg, { recursive: true });
    const probe = path.join(cfg, ".check-write");
    await fs.promises.writeFile(probe, "ok", "utf8");
    await fs.promises.unlink(probe);
    cfgOk = true;
    cfgDetail = `${cfg} (writable)`;
  } catch (err) {
    cfgDetail = `${cfg} — ${err instanceof Error ? err.message : String(err)}`;
  }
  checks.push({ id: "config", ok: cfgOk, detail: cfgDetail });

  const webDist = webDistPath();
  const indexHtml = path.join(webDist, "index.html");
  let webOk = false;
  try {
    await fs.promises.access(indexHtml);
    webOk = true;
  } catch {
    /* missing */
  }
  checks.push({
    id: "web-dist",
    ok: webOk,
    detail: webOk ? webDist : `${webDist} missing index.html — run npm run build`,
  });

  checks.push({
    id: "templates",
    ok: WORKFLOW_TEMPLATES.length > 0,
    detail: `${WORKFLOW_TEMPLATES.length} bundled templates`,
  });

  const cliChecks = await Promise.all([
    checkPathCli("cli:claude", "claude"),
    checkPathCli("cli:opencode", "opencode"),
    checkPreferredOrPath("cli:cursor-agent", agentBin(), "agent"),
    checkPreferredOrPath("cli:agy", agyBin(), "agy"),
    checkPreferredOrPath("cli:codex", codexBin(), "codex"),
    checkPreferredOrPath("cli:copilot", copilotBin(), "copilot"),
    checkPreferredOrPath("cli:grok", grokBin(), "grok"),
    checkPreferredOrPath("cli:muse", museBin(), "muse"),
  ]);
  checks.push(...cliChecks);

  const infos = await registry.info();
  let anyProvider = false;
  for (const p of infos) {
    if (p.available) anyProvider = true;
    checks.push({
      id: `provider:${p.id}`,
      ok: p.available,
      detail: p.available
        ? `storage readable${p.version ? ` · ${p.version}` : ""}`
        : "storage not found (sessions won't list for this provider)",
    });
  }

  checks.push({
    id: "providers-any",
    ok: anyProvider,
    detail: anyProvider
      ? "at least one provider has readable session storage"
      : "no provider storage found — install Claude / opencode / Cursor / Antigravity / Codex / Copilot / Grok Build",
  });

  checks.push({
    id: "home",
    ok: Boolean(os.homedir()),
    detail: os.homedir(),
  });

  let providerProbeFailed = false;
  let upstreamFailed = false;
  if (opts.upstream) {
    const rows = await probeUpstream();
    for (const r of rows) {
      checks.push({
        id: `upstream:${r.id}`,
        ok: !r.newer,
        detail: r.detail,
      });
      if (r.newer) upstreamFailed = true;
    }
  }
  if (opts.providers) {
    const fixtures = await probeGoldenFixtures();
    for (const p of fixtures) {
      checks.push({ id: p.id, ok: p.ok, detail: p.detail });
      if (!p.ok && !p.skipped) providerProbeFailed = true;
    }
    const probes = await probeInjectFlags();
    for (const p of probes) {
      checks.push({ id: p.id, ok: p.ok, detail: p.detail });
      if (!p.ok && !p.skipped) providerProbeFailed = true;
    }
  }

  // Critical: node, config, web-dist, templates, at least one provider OR one CLI
  const criticalIds = new Set(["node", "config", "web-dist", "templates"]);
  const criticalOk = checks.filter((c) => criticalIds.has(c.id)).every((c) => c.ok);
  const softOk = anyProvider || checks.some((c) => c.id.startsWith("cli:") && c.ok);
  const ok = criticalOk && softOk && !providerProbeFailed && !upstreamFailed;

  return { checks, ok };
}

export function printCheck(result: Awaited<ReturnType<typeof runCheck>>): void {
  console.log("threadle check\n");
  for (const c of result.checks) {
    const mark = c.ok ? "ok" : "!!";
    console.log(`  ${mark.padEnd(2)}  ${c.id.padEnd(36)}  ${c.detail}`);
  }
  console.log("");
  if (result.ok) {
    console.log("· ready — start with: threadle");
  } else {
    console.log("· issues found — fix !! rows, then re-run: threadle check");
  }
}
