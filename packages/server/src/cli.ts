#!/usr/bin/env node
import { serve } from "@hono/node-server";
import fs from "node:fs";
import path from "node:path";
import readlinePromises from "node:readline/promises";
import { parseArgs } from "node:util";
import { validatePortableGraphImport, toPortableGraph, summarizeGraphExecution, type ManifestItem, type PortableGraph } from "@threadle/shared";
import { createApp } from "./server.js";
import { startWatchers } from "./watch.js";
import { shutdownManagedServer } from "./providers/opencode/inject.js";
import { importGraph, readGraph, saveGraph, deleteGraph, listGraphs as listLocalGraphs, replaceGraphFromPortable } from "./graphs/store.js";
import { executeWorkflow } from "./workflows/executor.js";
import { getRecipe, listRecipes } from "./templates/recipes.js";
import { getWorkflowTemplate, WORKFLOW_TEMPLATES } from "./templates/workflows.js";
import { printCheck, runCheck } from "./check.js";
import { setDefaultProjectDir } from "./routes/agents.js";
import {
  resolveGraphSourceFile,
  startRunWatch,
  type RunWatchReason,
} from "./cli-run-watch.js";
import { openUrl, resolveOpenTarget } from "./cli-open.js";
import {
  allLogs,
  apiFetch,
  cancelJob,
  getHealth,
  getJob,
  getProcess,
  jobLogs,
  listAgents,
  listCustomNodes,
  listGraphs,
  listJobs,
  listModels,
  listProviders,
  listRecipes as listRecipesRemote,
  listSessions,
  listSkills,
  listTemplates,
  printAgents,
  printGraphs,
  printJobs,
  printLogLines,
  printModels,
  printNodes,
  printProviders,
  printServices,
  printSessions,
  printSkills,
  printTable,
  resolveSkill,
  exportSkillMarkdown,
  importSkillMarkdown,
  toggleSkill,
  serverBase,
  startDetachedWorkflow,
  type RemoteLogLine,
} from "./cli-remote.js";

function printHelp(): void {
  console.log(`threadle — local node-graph patchbay for Claude Code / opencode / Cursor / Antigravity / Codex / Copilot / Grok Build

USAGE
  threadle [server-options]                 Start the UI + API (default)
  threadle <command> [args] [options]

SERVER
  threadle [--port 4570] [--no-open] [--dir <project>]
  threadle daemon [--port 4570] [--dir <project>]   Long-lived serve (no browser) + triggers.json
  threadle run <id|file|recipe> [options]           Detached/foreground workflow
  threadle jobs|status|attach|logs|stop             Job control
  threadle check [--providers] [--upstream]         First-run / support diagnostics
  threadle mcp                                      Stdio MCP server (workflows as tools)
  threadle export <graphId|file|recipe> [out.json]  Portable workflow (threadle/graph@1)
  threadle export --backup [file]                   Config pack (threadle/backup@1)
  threadle import <file>                            Import graph@1 or restore backup@1
  threadle serve …                          Same as bare threadle
  threadle check                            PATH + providers + config + UI assets
  threadle check --providers                Also golden fixtures + inject CLI flags
  threadle check --upstream                 Also npm/GitHub latest vs adapter pins
  threadle mcp                              Stdio MCP server (workflows as tools)

JOBS  (need a running server)
  threadle run <file|recipe|template|graphId>  Run a workflow (foreground)
  threadle run <target> --detach            Start a server job; print jobId
  threadle jobs                             List recent jobs (all statuses)
  threadle status [--all]                   List running jobs (--all = history)
  threadle attach <jobId>                   Follow a job's logs until it ends
  threadle logs [jobId] [-f|--follow]       Print logs (follow = same as attach)
  threadle stop <jobId>                     Cancel a running job

INVENTORY  (need a running server; templates / check / recipes / mcp work offline)
  threadle services|health                  Process + providers + health
  threadle providers                        Provider adapters
  threadle agents [--dir <path>]            Discovered agents
  threadle sessions [-q <text>] [--provider p] [--limit n]
  threadle graphs|workflows                 Saved graphs
  threadle models                           Known models
  threadle nodes                            Custom nodes
  threadle skills [list]                    Skill libraries (SKILL.md packs)
  threadle skills import <file.md>          Import into threadle-imported
  threadle skills export <name|path> [out]  Download SKILL.md
  threadle skills toggle <name|path> --auto|--manual
  threadle open [target…]                   Open UI (session, workflow, skill, …)
  threadle templates                        Bundled teaching examples
  threadle recipes                          Job recipes (examples/recipes)
  threadle --list-templates                 Same as templates
  threadle export <graphId|file|recipe> [out.json]  Portable workflow (threadle/graph@1)
  threadle export --backup [file]                   Config pack (threadle/backup@1)
  threadle import <file>                            Import graph@1 or restore backup@1

OPTIONS
  --port <n>         Port (default 4570). Also used by client commands.
  --no-open          Don't open a browser when starting the server
  --dir <path>       Project directory (agents / discovery / agent runs)
  -h, --help         Show this help
  threadle help      Same as --help

  Run:     --param k=v  --approve-all  --accept-imported  --detach  --keep  --ephemeral  --watch
  Jobs:    --all  --follow / -f
  Export:  --backup
  Skills:  --auto  --manual  (--scope / --location on import)
  Open:    --print (URL only, no browser)
  List:    --provider  -q/--query  --limit
  Env:     THREADLE_URL   Override server base (default http://127.0.0.1:<port>)

DETACHED / CLI LIMITS  (≫ and threadle run)
  • Approval / live-handoff gates need --approve-all (no TTY splice)
  • Context nodes extract/distill mid-run when a session/agent is wired (or use a Library payload)
  • Prefer canvas ▶ when you need the approval dock
  • Daemon loads ~/.config/threadle/triggers.json (cron + path watch)

EXAMPLES
  threadle --no-open
  threadle daemon
  threadle check
  threadle check --providers                # fixtures + inject flags when present
  threadle check --upstream                 # npm/GitHub latest vs pins
  threadle mcp                              # add to .mcp.json — see docs/cli
  threadle services
  threadle run detached-delay --detach
  threadle run hello-wire --watch           # re-run on graph mtime / git changes
  threadle attach job_….…
  threadle jobs
  threadle export hello-wire ./hello.json
  threadle import ./hello.json
  threadle export --backup
  threadle skills
  threadle skills import ./review.SKILL.md
  threadle skills toggle review-diff --manual
  threadle open skills
  threadle open workflow hello-wire
  threadle open session cursor:abc123
  threadle run plan-implement-review --param task="…" --approve-all

Docs: docs/cli/README.md · docs/cli/manual.md
`);
}

function printTemplatesLocal(): void {
  printTable(
    WORKFLOW_TEMPLATES.map((t) => ({
      id: t.id,
      level: t.level,
      name: t.name,
      description: t.description.slice(0, 56),
    })),
    ["id", "level", "name", "description"],
  );
}

function printRecipesLocal(): void {
  printTable(
    listRecipes().map((r) => ({
      id: r.id,
      outcome: r.outcome.slice(0, 56),
      needs: [
        r.needs.model ? "model" : null,
        r.needs.dir ? "dir" : null,
        r.needs.session ? "session" : null,
      ]
        .filter(Boolean)
        .join("+") || "—",
      params: r.params.join(",") || "—",
    })),
    ["id", "outcome", "needs", "params"],
  );
}

async function cmdExit(fn: () => Promise<void>): Promise<never> {
  try {
    await fn();
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function parseParams(raw: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of raw ?? []) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new Error(`invalid --param "${entry}" (expected name=value)`);
    }
    const k = entry.slice(0, eq);
    const v = entry.slice(eq + 1);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(k)) {
      throw new Error(`invalid param name "${k}"`);
    }
    if (v.length > 100_000) throw new Error(`param "${k}" too large`);
    out[k] = v;
  }
  return out;
}

async function loadPortableTarget(
  target: string,
): Promise<{ graphId: string; imported: boolean; name: string }> {
  const recipe = getRecipe(target);
  if (recipe) {
    const g = await importGraph(recipe.graph, { trusted: true });
    return { graphId: g.id, imported: true, name: g.name };
  }

  const tpl = getWorkflowTemplate(target);
  if (tpl) {
    const g = await importGraph(tpl.graph, { trusted: true });
    return { graphId: g.id, imported: true, name: g.name };
  }

  const asFile = path.resolve(target);
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
    const text = await fs.promises.readFile(asFile, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `invalid portable graph JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const parsed = validatePortableGraphImport(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const g = await importGraph(parsed.data);
    return { graphId: g.id, imported: true, name: g.name };
  }

  const exampleCandidates = [
    path.resolve("examples/recipes", `${target}.json`),
    path.resolve("examples/recipes", target),
    path.resolve("examples/workflows", `${target}.json`),
    path.resolve("examples/workflows", target),
  ];
  for (const cand of exampleCandidates) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      let raw: unknown;
      try {
        raw = JSON.parse(await fs.promises.readFile(cand, "utf8"));
      } catch {
        continue;
      }
      const parsed = validatePortableGraphImport(raw);
      if (!parsed.ok) continue;
      // repo-bundled examples are first-party — no first-run confirmation
      const g = await importGraph(parsed.data, { trusted: true });
      return { graphId: g.id, imported: true, name: g.name };
    }
  }

  const existing = await readGraph(target);
  if (existing) {
    return { graphId: existing.id, imported: false, name: existing.name };
  }

  const known = [
    ...listRecipes().map((r) => r.id),
    ...WORKFLOW_TEMPLATES.map((t) => t.id),
  ].join(", ");
  throw new Error(
    `nothing to run for "${target}" — pass a .json file, graph id, recipe, or template (${known})`,
  );
}

/** Resolve a saved graph / template / recipe / portable file to shareable JSON. */
async function loadGraphForExport(
  target: string,
): Promise<{ portable: PortableGraph; label: string; id?: string }> {
  const recipe = getRecipe(target);
  if (recipe) {
    return {
      portable: { ...recipe.graph, $schema: "threadle/graph@1" },
      label: recipe.graph.name,
    };
  }
  const tpl = getWorkflowTemplate(target);
  if (tpl) {
    return {
      portable: { ...tpl.graph, $schema: "threadle/graph@1" },
      label: tpl.graph.name,
    };
  }

  const existing = await readGraph(target);
  if (existing) {
    return { portable: toPortableGraph(existing), label: existing.name, id: existing.id };
  }

  // Match by display name (local disk only — do not use the remote inventory API)
  const summaries = await listLocalGraphs();
  const hit = summaries.find(
    (g) => g.name === target || g.name.toLowerCase() === target.toLowerCase(),
  );
  if (hit) {
    const g = await readGraph(hit.id);
    if (g) return { portable: toPortableGraph(g), label: g.name, id: g.id };
  }

  const asFile = path.resolve(target);
  if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.promises.readFile(asFile, "utf8"));
    } catch (err) {
      throw new Error(
        `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const parsed = validatePortableGraphImport(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    return {
      portable: { ...parsed.data, $schema: "threadle/graph@1" },
      label: parsed.data.name,
    };
  }

  const exampleCandidates = [
    path.resolve("examples/recipes", `${target}.json`),
    path.resolve("examples/workflows", `${target}.json`),
  ];
  for (const cand of exampleCandidates) {
    if (!fs.existsSync(cand) || !fs.statSync(cand).isFile()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.promises.readFile(cand, "utf8"));
    } catch {
      continue;
    }
    const parsed = validatePortableGraphImport(raw);
    if (!parsed.ok) continue;
    return {
      portable: { ...parsed.data, $schema: "threadle/graph@1" },
      label: parsed.data.name,
    };
  }

  throw new Error(
    `nothing to export for "${target}" — pass a graph id/name, recipe, template, or portable .json`,
  );
}

function defaultPortableOutName(label: string): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "workflow";
  return path.resolve(`threadle-${slug}.json`);
}

/**
 * First-run gate for imported graphs on the CLI: print what the workflow
 * executes, then require an interactive yes or --accept-imported. Mirrors
 * the web ImportRunModal / server 428.
 */
async function ensureImportConfirmed(graphId: string, acceptFlag: boolean): Promise<boolean> {
  const g = await readGraph(graphId);
  if (!g || g.origin !== "imported" || g.confirmedAt) return true;
  const items: ManifestItem[] = summarizeGraphExecution(g);
  console.log(`\u26a0 imported workflow "${g.name}" \u2014 on \u25b6 it will execute:`);
  if (!items.length) console.log("  (no executing nodes \u2014 prompts/outputs only)");
  for (const it of items) {
    console.log(`  \u2022 [${it.kind}] ${it.label} \u2014 ${it.detail}${it.muted ? " (muted)" : ""}`);
    for (const fl of it.flags ?? []) console.log(`      ${fl}`);
  }
  const confirmAndSave = async (): Promise<boolean> => {
    await saveGraph({ ...g, confirmedAt: Date.now() });
    return true;
  };
  if (acceptFlag) return confirmAndSave();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      "\u2717 refusing to run an unconfirmed imported workflow non-interactively \u2014 review the list above, then pass --accept-imported",
    );
    return false;
  }
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("run it? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log("aborted \u2014 workflow kept unconfirmed");
    return false;
  }
  return confirmAndSave();
}

async function runWorkflowForeground(opts: {
  target: string;
  params: Record<string, string>;
  approveAll: boolean;
  acceptImported: boolean;
  projectDir: string;
  ephemeral: boolean;
}): Promise<number> {
  const { graphId, imported, name } = await loadPortableTarget(opts.target);
  if (!(await ensureImportConfirmed(graphId, opts.acceptImported))) {
    if (imported) await deleteGraph(graphId).catch(() => undefined);
    return 1;
  }
  return runWorkflowById({
    graphId,
    name,
    imported,
    params: opts.params,
    approveAll: opts.approveAll,
    projectDir: opts.projectDir,
    ephemeral: opts.ephemeral,
  });
}

async function runWorkflowById(opts: {
  graphId: string;
  name: string;
  imported: boolean;
  params: Record<string, string>;
  approveAll: boolean;
  projectDir: string;
  ephemeral: boolean;
}): Promise<number> {
  setDefaultProjectDir(opts.projectDir);
  console.log(
    `❯ running "${opts.name}" (${opts.graphId})${opts.imported ? " [imported]" : ""}`,
  );

  const ac = new AbortController();
  // ONE process-level handler pair for the whole process, aborting whichever
  // run is currently live — registering per run leaked 2 listeners (and the
  // prior run's AbortController) on every `--watch` kick.
  activeRunController = ac;
  installRunSignalHandlers();

  try {
    const res = await executeWorkflow({
      graphId: opts.graphId,
      params: opts.params,
      approveAll: opts.approveAll,
      projectDir: opts.projectDir,
      log: (lane, line) => {
        const tag = lane === "stderr" ? "!" : lane === "meta" ? "·" : " ";
        console.log(`${tag} ${line}`);
      },
      signal: ac.signal,
    });
    console.log(`✓ done — ${res.outputs} output node(s) updated`);
    if (opts.imported && opts.ephemeral) {
      await deleteGraph(opts.graphId);
      console.log(`· ephemeral graph ${opts.graphId} removed`);
    } else if (opts.imported) {
      console.log(`· graph kept as ${opts.graphId} — open with: threadle`);
    }
    return 0;
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    if (opts.imported && opts.ephemeral) {
      await deleteGraph(opts.graphId).catch(() => undefined);
    }
    return 1;
  } finally {
    if (activeRunController === ac) activeRunController = undefined;
    shutdownManagedServer();
  }
}

/** current foreground run — the once-installed signal handlers abort it */
let activeRunController: AbortController | undefined;
let runSignalHandlersInstalled = false;

function installRunSignalHandlers(): void {
  if (runSignalHandlersInstalled) return;
  runSignalHandlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      activeRunController?.abort();
      shutdownManagedServer();
    });
  }
}

async function reloadPortableGraphFile(
  graphId: string,
  graphFile: string,
): Promise<{ name: string }> {
  const text = await fs.promises.readFile(graphFile, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `invalid portable graph JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = validatePortableGraphImport(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const g = await replaceGraphFromPortable(graphId, parsed.data);
  return { name: g.name };
}

/** Resolve a graph id or display name for `threadle open workflow …`. */
async function resolveWorkflowOpenId(raw: string): Promise<string> {
  const byId = await readGraph(raw);
  if (byId) return byId.id;
  const summaries = await listLocalGraphs();
  const hit = summaries.find(
    (g) => g.name === raw || g.name.toLowerCase() === raw.toLowerCase(),
  );
  if (hit) return hit.id;
  return raw;
}

async function runWorkflowDetached(opts: {
  target: string;
  params: Record<string, string>;
  approveAll: boolean;
  acceptImported: boolean;
  projectDir: string;
  base: string;
}): Promise<number> {
  // probe server first so import isn't orphaned on a missing daemon
  const probe = await apiFetch(opts.base, "/api/jobs");
  if (!probe.ok) throw new Error(`server at ${opts.base} returned ${probe.status}`);

  const { graphId, imported, name } = await loadPortableTarget(opts.target);
  if (!(await ensureImportConfirmed(graphId, opts.acceptImported))) {
    if (imported) await deleteGraph(graphId).catch(() => undefined);
    return 1;
  }
  const { jobId } = await startDetachedWorkflow(opts.base, {
    graphId,
    params: opts.params,
    approveAll: opts.approveAll,
    projectDir: opts.projectDir,
  });
  console.log(`≫ detached "${name}" (${graphId})${imported ? " [imported]" : ""}`);
  console.log(`· job ${jobId}`);
  console.log(`· attach: threadle attach ${jobId}`);
  console.log(`· jobs:   threadle jobs`);
  return 0;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function followJobLogs(base: string, jobId: string): Promise<number> {
  let seen = 0;
  let stop = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stop = true;
    });
  }
  while (!stop) {
    const lines = await jobLogs(base, jobId);
    if (lines.length > seen) {
      printLogLines(lines.slice(seen));
      seen = lines.length;
    }
    let job;
    try {
      job = await getJob(base, jobId);
    } catch {
      // finished jobs drop from the in-memory map; history still has logs
      return 0;
    }
    if (job.status !== "running") {
      if (job.error) console.log(`· ${job.status}: ${job.error}`);
      else console.log(`· ${job.status}`);
      return job.status === "done" ? 0 : 1;
    }
    await sleep(800);
  }
  return 0;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "4570" },
    "no-open": { type: "boolean", default: false },
    dir: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
    param: { type: "string", multiple: true },
    "approve-all": { type: "boolean", default: false },
    "accept-imported": { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    ephemeral: { type: "boolean", default: false },
    detach: { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    follow: { type: "boolean", short: "f", default: false },
    "list-templates": { type: "boolean", default: false },
    providers: { type: "boolean", default: false },
    upstream: { type: "boolean", default: false },
    provider: { type: "string" },
    query: { type: "string", short: "q" },
    limit: { type: "string", default: "40" },
    backup: { type: "boolean", default: false },
    auto: { type: "boolean", default: false },
    manual: { type: "boolean", default: false },
    scope: { type: "string", default: "global" },
    location: { type: "string", default: "threadle-imported" },
    print: { type: "boolean", default: false },
  },
});

if (values.help) {
  printHelp();
  process.exit(0);
}

if (values["list-templates"]) {
  printTemplatesLocal();
  process.exit(0);
}

const [cmd, arg, arg2, arg3] = positionals;
const base = serverBase(values.port ?? "4570");
const projectDirOpt = values.dir ? path.resolve(values.dir) : undefined;
const sessionLimit = Math.max(1, Math.min(500, Number(values.limit) || 40));

const KNOWN = new Set([
  "serve",
  "run",
  "jobs",
  "status",
  "attach",
  "logs",
  "stop",
  "services",
  "health",
  "providers",
  "agents",
  "sessions",
  "graphs",
  "workflows",
  "models",
  "nodes",
  "skills",
  "open",
  "templates",
  "recipes",
  "check",
  "mcp",
  "daemon",
  "export",
  "import",
  "help",
]);

if (cmd === "check") {
  const result = await runCheck({
    providers: Boolean(values.providers),
    upstream: Boolean(values.upstream),
  });
  printCheck(result);
  process.exit(result.ok ? 0 : 1);
}

if (cmd === "mcp") {
  const { startMcpStdio } = await import("./mcp/stdio.js");
  startMcpStdio();
  // transport owns the process — never start Hono/browser
  await new Promise(() => undefined);
}

async function showJobs(runningOnly: boolean): Promise<void> {
  const jobs = await listJobs(base);
  const shown = (runningOnly ? jobs.filter((j) => j.status === "running") : jobs)
    // chronological: oldest first, latest at the bottom (log-style)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
  if (runningOnly && !shown.length) {
    console.log("(no running jobs — pass --all for recent history)");
    return;
  }
  printJobs(shown);
}

if (cmd === "help") {
  printHelp();
  process.exit(0);
}

if (cmd === "status" || cmd === "jobs") {
  await cmdExit(() => showJobs(cmd === "status" && !values.all));
}

if (cmd === "attach") {
  if (!arg) {
    console.error("threadle attach: missing <jobId>");
    console.error("usage: threadle attach <jobId>");
    process.exit(2);
  }
  await cmdExit(async () => {
    const code = await followJobLogs(base, arg);
    process.exit(code);
  });
}

if (cmd === "logs") {
  await cmdExit(async () => {
    if (arg) {
      if (values.follow) {
        const code = await followJobLogs(base, arg);
        process.exit(code);
      }
      printLogLines(await jobLogs(base, arg));
      return;
    }
    const lines: RemoteLogLine[] = await allLogs(base, 120);
    printLogLines(lines);
  });
}

if (cmd === "stop") {
  if (!arg) {
    console.error("threadle stop: missing <jobId>");
    process.exit(2);
  }
  await cmdExit(async () => {
    await cancelJob(base, arg);
    console.log(`■ cancelled ${arg}`);
  });
}

if (cmd === "services" || cmd === "health") {
  await cmdExit(async () => {
    const [health, proc, providers] = await Promise.all([
      getHealth(base),
      getProcess(base),
      listProviders(base),
    ]);
    printServices(health, proc, providers);
  });
}

if (cmd === "providers") {
  await cmdExit(async () => printProviders(await listProviders(base)));
}

if (cmd === "agents") {
  await cmdExit(async () =>
    printAgents(await listAgents(base, projectDirOpt ?? path.resolve(process.cwd()))),
  );
}

if (cmd === "sessions") {
  await cmdExit(async () => {
    const sessions = await listSessions(base, {
      provider: values.provider,
      projectDir: projectDirOpt,
      q: values.query,
    });
    printSessions(sessions, sessionLimit);
  });
}

if (cmd === "graphs" || cmd === "workflows") {
  await cmdExit(async () => printGraphs(await listGraphs(base)));
}

if (cmd === "models") {
  await cmdExit(async () => printModels(await listModels(base)));
}

if (cmd === "nodes") {
  await cmdExit(async () => printNodes(await listCustomNodes(base)));
}

if (cmd === "skills") {
  const sub = arg ?? "list";
  await cmdExit(async () => {
    if (sub === "list" || sub === "ls") {
      printSkills(await listSkills(base));
      return;
    }

    if (sub === "import") {
      const file = arg2;
      if (!file) {
        throw new Error("usage: threadle skills import <file.md> [--scope global] [--location threadle-imported]");
      }
      const abs = path.resolve(file);
      const content = await fs.promises.readFile(abs, "utf8");
      const art = await importSkillMarkdown(base, {
        content,
        filename: path.basename(abs),
        scope: values.scope ?? "global",
        location: values.location ?? "threadle-imported",
      });
      console.log(
        `✓ imported skill "${art.name}" (${art.autoInvoke === false ? "manual" : "auto"}) → ${art.path}`,
      );
      return;
    }

    if (sub === "export") {
      const target = arg2;
      if (!target) {
        throw new Error("usage: threadle skills export <name|path> [out.md]");
      }
      const skills = await listSkills(base);
      const hit = resolveSkill(skills, target);
      if (!hit) throw new Error(`skill not found: ${target}`);
      const { filename, content } = await exportSkillMarkdown(base, hit.path);
      const out = arg3 ? path.resolve(arg3) : path.resolve(filename);
      await fs.promises.writeFile(out, content, "utf8");
      console.log(`✓ exported skill "${hit.name}" → ${out}`);
      return;
    }

    if (sub === "toggle") {
      const target = arg2;
      if (!target) {
        throw new Error("usage: threadle skills toggle <name|path> --auto|--manual");
      }
      const wantAuto = Boolean(values.auto);
      const wantManual = Boolean(values.manual);
      if (wantAuto === wantManual) {
        throw new Error("pass exactly one of --auto or --manual");
      }
      const skills = await listSkills(base);
      const hit = resolveSkill(skills, target);
      if (!hit) throw new Error(`skill not found: ${target}`);
      const art = await toggleSkill(base, hit.path, wantAuto);
      console.log(
        `✓ skill "${art.name}" → ${art.autoInvoke === false ? "manual" : "auto"}`,
      );
      return;
    }

    throw new Error(
      `unknown skills subcommand "${sub}" — try list | import | export | toggle`,
    );
  });
}

if (cmd === "open") {
  await cmdExit(async () => {
    const openArgs = positionals.slice(1);
    let target = resolveOpenTarget(openArgs);

    // Resolve workflow id/name against local graphs when opening /graph/…
    const graphMatch = /^\/graph\/([^/?#]+)/.exec(target.path);
    if (graphMatch) {
      const raw = decodeURIComponent(graphMatch[1]!);
      const id = await resolveWorkflowOpenId(raw);
      if (id !== raw) {
        target = { path: `/graph/${encodeURIComponent(id)}`, label: `workflow ${id} (${raw})` };
      }
    }

    const url = openUrl(base, target);
    if (values.print) {
      console.log(url);
      return;
    }

    try {
      await getHealth(base);
    } catch {
      throw new Error(
        `threadle server not reachable at ${base} — start it with: threadle --no-open`,
      );
    }

    const { default: open } = await import("open");
    await open(url).catch(() => {
      throw new Error(`could not open browser — visit ${url}`);
    });
    console.log(`↗ ${target.label} → ${url}`);
  });
}

if (cmd === "templates") {
  // Prefer local catalog (works without a server); fall back to API.
  try {
    printTemplatesLocal();
    process.exit(0);
  } catch {
    await cmdExit(async () => {
      const tpls = await listTemplates(base);
      printTable(
        tpls.map((t) => ({
          id: t.id,
          level: t.level ?? "—",
          name: t.name,
          description: t.description.slice(0, 56),
        })),
        ["id", "level", "name", "description"],
      );
    });
  }
}

if (cmd === "recipes") {
  try {
    printRecipesLocal();
    process.exit(0);
  } catch {
    await cmdExit(async () => {
      const rows = await listRecipesRemote(base);
      printTable(
        rows.map((r) => ({
          id: r.id,
          outcome: r.outcome.slice(0, 56),
          needs: [
            r.needs.model ? "model" : null,
            r.needs.dir ? "dir" : null,
            r.needs.session ? "session" : null,
          ]
            .filter(Boolean)
            .join("+") || "—",
          params: (r.params ?? []).join(",") || "—",
        })),
        ["id", "outcome", "needs", "params"],
      );
    });
  }
}

if (cmd === "export") {
  await cmdExit(async () => {
    const wantBackup = Boolean(values.backup);

    // Backup: `export --backup [file]` or legacy bare `export` / `export out.json`
    // when the first arg is not a resolvable graph source.
    let backupOut: string | undefined;
    if (wantBackup) {
      backupOut = arg;
    } else if (!arg) {
      backupOut = undefined; // default stamped name
    } else {
      try {
        const { portable, label, id } = await loadGraphForExport(arg);
        const out = arg2 ? path.resolve(arg2) : defaultPortableOutName(label);
        await fs.promises.writeFile(out, JSON.stringify(portable, null, 2) + "\n", "utf8");
        console.log(
          `✓ exported portable graph "${label}"${id ? ` (${id})` : ""} → ${out}`,
        );
        return;
      } catch (err) {
        // Legacy: single .json path that isn't a graph → backup destination
        if (!arg2 && /\.json$/i.test(arg)) {
          backupOut = arg;
        } else {
          throw err;
        }
      }
    }

    const { packBackup } = await import("./routes/backup.js");
    const bundle = await packBackup();
    const out =
      backupOut ??
      path.resolve(`threadle-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.promises.writeFile(out, JSON.stringify(bundle, null, 2), "utf8");
    console.log(`✓ exported backup ${bundle.files.length} file(s) → ${out}`);
  });
}

if (cmd === "import") {
  if (!arg) {
    console.error("threadle import: missing <file>");
    console.error("usage: threadle import <portable-graph.json|backup.json>");
    process.exit(2);
  }
  await cmdExit(async () => {
    const file = path.resolve(arg);
    const text = await fs.promises.readFile(file, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const schema =
      raw && typeof raw === "object" && "$schema" in raw
        ? String((raw as { $schema?: unknown }).$schema ?? "")
        : "";

    if (schema === "threadle/backup@1") {
      const { parseBackupBundle, restoreBackup } = await import("./routes/backup.js");
      const bundle = parseBackupBundle(raw);
      const { written } = await restoreBackup(bundle);
      console.log(`✓ restored backup ${written} file(s) from ${arg} (${bundle.exportedAt})`);
      return;
    }

    const parsed = validatePortableGraphImport(raw);
    if (!parsed.ok) {
      throw new Error(
        schema
          ? `unsupported $schema "${schema}" — expected threadle/graph@1 or threadle/backup@1`
          : parsed.error,
      );
    }
    const g = await importGraph(parsed.data);
    console.log(`✓ imported workflow "${g.name}" (${g.id})`);
  });
}

if (cmd === "run") {
  if (!arg) {
    console.error("threadle run: missing <file|template|graphId>");
    printHelp();
    process.exit(2);
  }
  let params: Record<string, string>;
  try {
    params = parseParams(values.param);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  try {
    if (values.detach) {
      if (values.ephemeral) {
        console.error("threadle run --detach: --ephemeral is not supported (graph stays for the server job)");
        process.exit(2);
      }
      if (values.watch) {
        console.error("threadle run --watch: not supported with --detach (use triggers.json watch or daemon)");
        process.exit(2);
      }
      const code = await runWorkflowDetached({
        target: arg,
        params,
        approveAll: values["approve-all"] === true,
        acceptImported: values["accept-imported"] === true,
        projectDir: path.resolve(values.dir ?? process.cwd()),
        base,
      });
      process.exit(code);
    }
    if (values.watch && values.ephemeral) {
      console.error("threadle run --watch: --ephemeral is not supported (graph kept for re-runs)");
      process.exit(2);
    }
    if (values.watch) {
      const projectDir = path.resolve(values.dir ?? process.cwd());
      const loaded = await loadPortableTarget(arg);
      if (!(await ensureImportConfirmed(loaded.graphId, values["accept-imported"] === true))) {
        if (loaded.imported) await deleteGraph(loaded.graphId).catch(() => undefined);
        process.exit(1);
      }
      let name = loaded.name;
      const graphFile = resolveGraphSourceFile(arg);
      const runOnce = (imported: boolean): Promise<number> =>
        runWorkflowById({
          graphId: loaded.graphId,
          name,
          imported,
          params,
          approveAll: values["approve-all"] === true,
          projectDir,
          ephemeral: false,
        });
      const code = await runOnce(loaded.imported);
      if (code !== 0) process.exit(code);

      const handle = await startRunWatch({
        graphFile,
        projectDir,
        onKick: async (reason: RunWatchReason) => {
          try {
            if (reason === "graph" && graphFile) {
              const next = await reloadPortableGraphFile(loaded.graphId, graphFile);
              name = next.name;
              console.log(`threadle run --watch: graph file changed — reloaded "${name}"`);
            } else {
              console.log(`threadle run --watch: ${reason} change — re-running`);
            }
            await runOnce(false);
          } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
          }
        },
      });
      console.log(`threadle run --watch: ${handle.label} (Ctrl-C to stop)`);
      await new Promise(() => undefined);
    }
    const code = await runWorkflowForeground({
      target: arg,
      params,
      approveAll: values["approve-all"] === true,
      acceptImported: values["accept-imported"] === true,
      projectDir: values.dir ?? process.cwd(),
      ephemeral: values.ephemeral === true && values.keep !== true,
    });
    process.exit(code);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (cmd === "daemon") {
  // alias of serve with --no-open (long-lived runner for triggers)
  values["no-open"] = true;
}

if (cmd && cmd !== "serve" && cmd !== "daemon") {
  console.error(`unknown command "${cmd}"`);
  console.error("Try: threadle help");
  process.exit(2);
}

const port = Number(values.port);
const projectDir = values.dir ?? process.cwd();

const app = createApp({ projectDir });

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, async (info) => {
  const url = `http://127.0.0.1:${info.port}`;
  console.log(`threadle listening on ${url}${cmd === "daemon" ? " (daemon)" : ""}`);
  startWatchers();
  const { startTriggers } = await import("./triggers/index.js");
  void startTriggers();
  if (!values["no-open"]) {
    const { default: open } = await import("open");
    await open(url).catch(() => {
      console.log(`(could not open browser — visit ${url} yourself)`);
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdownManagedServer();
    process.exit(0);
  });
}
