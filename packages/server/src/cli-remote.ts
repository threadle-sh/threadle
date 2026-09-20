/** HTTP client + table printers for CLI commands against a running threadle server. */

export interface RemoteJob {
  id: string;
  kind: string;
  label?: string;
  graphId?: string;
  status: string;
  createdAt: number;
  finishedAt?: number;
  error?: string;
}

export interface RemoteLogLine {
  ts: number;
  lane: string;
  line: string;
  jobId?: string;
  kind?: string;
  label?: string;
  status?: string;
}

export function serverBase(port: number | string): string {
  const env = process.env.THREADLE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return `http://127.0.0.1:${port}`;
}

export class ServerUnreachableError extends Error {
  constructor(url: string, cause?: unknown) {
    super(
      `threadle server not reachable at ${url} — start it with: threadle --no-open`,
    );
    this.name = "ServerUnreachableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export async function apiFetch(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${base}${path}`;
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ServerUnreachableError(base, err);
  }
}

async function apiJson<T>(base: string, path: string): Promise<T> {
  const res = await apiFetch(base, path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function listJobs(base: string): Promise<RemoteJob[]> {
  return apiJson(base, "/api/jobs");
}

export async function getJob(base: string, jobId: string): Promise<RemoteJob> {
  const res = await apiFetch(base, `/api/jobs/${encodeURIComponent(jobId)}`);
  if (res.status === 404) throw new Error(`job not found: ${jobId}`);
  if (!res.ok) throw new Error(`GET /api/jobs/${jobId} → ${res.status}`);
  return (await res.json()) as RemoteJob;
}

export async function jobLogs(
  base: string,
  jobId: string,
): Promise<RemoteLogLine[]> {
  const res = await apiFetch(base, `/api/jobs/${encodeURIComponent(jobId)}/logs`);
  if (!res.ok) throw new Error(`GET /api/jobs/${jobId}/logs → ${res.status}`);
  const body = (await res.json()) as { lines: RemoteLogLine[] };
  return body.lines ?? [];
}

export async function allLogs(
  base: string,
  limit = 200,
): Promise<RemoteLogLine[]> {
  return apiJson(base, `/api/jobs/logs/all?limit=${limit}`);
}

export async function cancelJob(base: string, jobId: string): Promise<void> {
  const res = await apiFetch(base, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  if (res.status === 404) throw new Error(`job not found or not running: ${jobId}`);
  if (!res.ok) throw new Error(`DELETE /api/jobs/${jobId} → ${res.status}`);
}

export async function startDetachedWorkflow(
  base: string,
  body: {
    graphId: string;
    params?: Record<string, string>;
    approveAll?: boolean;
    projectDir?: string;
  },
): Promise<{ jobId: string }> {
  const res = await apiFetch(base, "/api/run/workflow", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/run/workflow → ${res.status}`);
  }
  return (await res.json()) as { jobId: string };
}

export interface RemoteHealth {
  ok: boolean;
  projectDir: string;
  serverStale: boolean;
  webMtime?: number;
  mem: number;
  uptime: number;
}

export interface RemoteProcess {
  pid: number;
  node: string;
  uptime: number;
  cpuPct: number;
  mem: { rss: number; heapUsed: number };
  threadpool: number;
  activeCustomRuns: number;
  runningJobs: number;
  system: {
    cores: number;
    loadavg: number[];
    totalmem: number;
    freemem: number;
    platform: string;
  };
}

export interface RemoteProvider {
  id: string;
  available: boolean;
  version?: string;
  storage?: { path: string; bytes: number; files: number };
}

export interface RemoteAgent {
  provider: string;
  name: string;
  description?: string;
  source: string;
  scope: string;
  kind?: string;
  model?: string;
}

export interface RemoteSession {
  provider: string;
  id: string;
  title?: string;
  agent?: string;
  projectDir: string;
  updatedAt?: number;
  status?: string;
}

export interface RemoteGraph {
  id: string;
  name: string;
  kind: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt: number;
  usedBy?: number;
}

export interface RemoteModel {
  provider: string;
  id: string;
}

export interface RemoteCustomNode {
  name: string;
  kind?: string;
  description?: string;
  entry?: string;
}

export function getHealth(base: string): Promise<RemoteHealth> {
  return apiJson(base, "/api/health");
}

export function getProcess(base: string): Promise<RemoteProcess> {
  return apiJson(base, "/api/internals/process");
}

export function listProviders(base: string): Promise<RemoteProvider[]> {
  return apiJson(base, "/api/providers");
}

export function listAgents(
  base: string,
  projectDir?: string,
): Promise<RemoteAgent[]> {
  const qs = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : "";
  return apiJson(base, `/api/agents${qs}`);
}

export function listSessions(
  base: string,
  opts: { provider?: string; projectDir?: string; q?: string } = {},
): Promise<RemoteSession[]> {
  const qs = new URLSearchParams();
  if (opts.provider) qs.set("provider", opts.provider);
  if (opts.projectDir) qs.set("projectDir", opts.projectDir);
  if (opts.q) qs.set("q", opts.q);
  const s = qs.toString();
  return apiJson(base, `/api/sessions${s ? `?${s}` : ""}`);
}

export function listGraphs(base: string): Promise<RemoteGraph[]> {
  return apiJson(base, "/api/graphs");
}

export function listModels(base: string): Promise<RemoteModel[]> {
  return apiJson(base, "/api/models");
}

export function listCustomNodes(base: string): Promise<RemoteCustomNode[]> {
  return apiJson(base, "/api/custom-nodes");
}

export interface RemoteSkill {
  path: string;
  name: string;
  kind: string;
  source: string;
  size: number;
  mtime: number;
  description?: string;
  autoInvoke?: boolean;
  origin?: string;
  layer?: number;
  shadowedBy?: string;
  scope?: string;
}

export interface RemoteRuleGroup {
  scope: string;
  artifacts: RemoteSkill[];
}

/** Flatten skill artifacts from GET /api/rules (all scopes). */
export async function listSkills(base: string): Promise<RemoteSkill[]> {
  const groups = await apiJson<RemoteRuleGroup[]>(base, "/api/rules");
  const out: RemoteSkill[] = [];
  for (const g of groups) {
    for (const a of g.artifacts) {
      if (a.kind !== "skill") continue;
      out.push({ ...a, scope: g.scope });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return out;
}

export function printSkills(skills: RemoteSkill[]): void {
  printTable(
    skills.map((s) => ({
      name: s.name,
      mode: s.autoInvoke === false ? "manual" : "auto",
      origin: s.origin ?? "—",
      scope: s.scope === "global" ? "global" : "project",
      shadowed: s.shadowedBy ? "yes" : "—",
      description: (s.description ?? "—").slice(0, 40),
    })),
    ["name", "mode", "origin", "scope", "shadowed", "description"],
    "(no skills)",
  );
}

/** Resolve a skill by exact path or by name (prefer non-shadowed). */
export function resolveSkill(
  skills: RemoteSkill[],
  nameOrPath: string,
): RemoteSkill | undefined {
  const byPath = skills.find((s) => s.path === nameOrPath);
  if (byPath) return byPath;
  const matches = skills.filter((s) => s.name === nameOrPath);
  if (!matches.length) return undefined;
  return matches.find((s) => !s.shadowedBy) ?? matches[0];
}

export async function toggleSkill(
  base: string,
  skillPath: string,
  autoInvoke: boolean,
): Promise<RemoteSkill> {
  const res = await apiFetch(base, "/api/rules/skill/toggle", {
    method: "POST",
    body: JSON.stringify({ path: skillPath, autoInvoke }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/rules/skill/toggle → ${res.status}`);
  }
  const body = (await res.json()) as { artifact: RemoteSkill };
  return body.artifact;
}

export async function exportSkillMarkdown(
  base: string,
  skillPath: string,
): Promise<{ filename: string; content: string }> {
  const res = await apiFetch(
    base,
    `/api/rules/skill/export?path=${encodeURIComponent(skillPath)}`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `GET /api/rules/skill/export → ${res.status}`);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(cd);
  return {
    filename: m?.[1] ?? "skill.SKILL.md",
    content: await res.text(),
  };
}

export async function importSkillMarkdown(
  base: string,
  opts: {
    content: string;
    filename?: string;
    name?: string;
    scope?: string;
    location?: string;
  },
): Promise<RemoteSkill> {
  const res = await apiFetch(base, "/api/rules/skill/import", {
    method: "POST",
    body: JSON.stringify({
      scope: opts.scope ?? "global",
      location: opts.location ?? "threadle-imported",
      content: opts.content,
      filename: opts.filename,
      name: opts.name,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/rules/skill/import → ${res.status}`);
  }
  const body = (await res.json()) as { artifact: RemoteSkill };
  return body.artifact;
}

export function listTemplates(
  base: string,
): Promise<
  Array<{ id: string; name: string; description: string; level?: string; teaches?: string[] }>
> {
  return apiJson(base, "/api/graphs/templates");
}

export function listRecipes(
  base: string,
): Promise<
  Array<{
    id: string;
    name: string;
    outcome: string;
    needs: { model: boolean; dir: boolean; session: boolean };
    agents: number | string;
    params: string[];
    note?: string;
  }>
> {
  return apiJson(base, "/api/graphs/recipes");
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? `${s % 60}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
}

export function fmtTs(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}G`;
}

export function printTable(
  rows: Array<Record<string, string>>,
  cols: string[],
  empty = "(none)",
): void {
  if (!rows.length) {
    console.log(empty);
    return;
  }
  const widths = Object.fromEntries(
    cols.map((c) => [
      c,
      Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
    ]),
  );
  const line = (r: Record<string, string>): string =>
    cols.map((c) => String(r[c] ?? "").padEnd(widths[c]!)).join("  ");
  console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
  for (const r of rows) console.log(line(r));
}

export function printJobs(jobs: RemoteJob[], now = Date.now()): void {
  printTable(
    jobs.map((j) => {
      const age =
        j.status === "running"
          ? fmtAge(now - j.createdAt)
          : j.finishedAt
            ? fmtAge(j.finishedAt - j.createdAt)
            : "—";
      return {
        status: j.status,
        kind: j.kind,
        age,
        label: (j.label ?? "—").slice(0, 40),
        graph: j.graphId?.slice(0, 12) ?? "—",
        id: j.id,
      };
    }),
    ["status", "kind", "age", "label", "graph", "id"],
    "(no jobs)",
  );
}

export function printLogLines(lines: RemoteLogLine[]): void {
  if (!lines.length) {
    console.log("(no log lines)");
    return;
  }
  for (const l of lines) {
    const tag = l.lane === "stderr" ? "!" : l.lane === "meta" ? "·" : " ";
    const who = l.jobId && l.jobId !== "app" ? ` ${l.jobId}` : "";
    console.log(`${fmtTs(l.ts)}${who} ${tag} ${l.line}`);
  }
}

export function printProviders(providers: RemoteProvider[]): void {
  printTable(
    providers.map((p) => ({
      id: p.id,
      avail: p.available ? "yes" : "no",
      version: p.version ?? "—",
      storage: p.storage
        ? `${fmtBytes(p.storage.bytes)} / ${p.storage.files} files`
        : "—",
    })),
    ["id", "avail", "version", "storage"],
  );
}

export function printAgents(agents: RemoteAgent[]): void {
  printTable(
    agents.map((a) => ({
      provider: a.provider,
      name: a.name,
      scope: a.scope,
      kind: a.kind ?? "—",
      model: a.model ?? "—",
      source: a.source.slice(0, 48),
    })),
    ["provider", "name", "scope", "kind", "model", "source"],
    "(no agents)",
  );
}

export function printSessions(sessions: RemoteSession[], limit = 40): void {
  const slice = sessions.slice(0, limit);
  printTable(
    slice.map((s) => ({
      provider: s.provider,
      title: (s.title ?? s.id).slice(0, 36),
      agent: (s.agent ?? "—").slice(0, 16),
      status: s.status ?? "—",
      id: s.id.slice(0, 18),
      project: s.projectDir.split("/").slice(-2).join("/").slice(0, 28),
    })),
    ["provider", "title", "agent", "status", "id", "project"],
    "(no sessions)",
  );
  if (sessions.length > limit) {
    console.log(`· showing ${limit}/${sessions.length} — pass --limit or -q to filter`);
  }
}

export function printGraphs(graphs: RemoteGraph[]): void {
  printTable(
    graphs.map((g) => ({
      kind: g.kind,
      name: g.name.slice(0, 36),
      nodes: String(g.nodeCount),
      edges: String(g.edgeCount),
      updated: new Date(g.updatedAt).toISOString().slice(0, 16).replace("T", " "),
      id: g.id,
    })),
    ["kind", "name", "nodes", "edges", "updated", "id"],
    "(no graphs)",
  );
}

export function printModels(models: RemoteModel[]): void {
  printTable(
    models.map((m) => ({ provider: m.provider, id: m.id })),
    ["provider", "id"],
    "(no models)",
  );
}

export function printNodes(nodes: RemoteCustomNode[]): void {
  printTable(
    nodes.map((n) => ({
      name: n.name,
      kind: n.kind ?? "—",
      description: (n.description ?? "—").slice(0, 48),
    })),
    ["name", "kind", "description"],
    "(no custom nodes)",
  );
}

export function printServices(
  health: RemoteHealth,
  proc: RemoteProcess,
  providers: RemoteProvider[],
): void {
  console.log("server");
  printTable(
    [
      {
        ok: health.ok ? "yes" : "no",
        stale: health.serverStale ? "YES" : "no",
        pid: String(proc.pid),
        uptime: fmtAge(health.uptime * 1000),
        rss: fmtBytes(health.mem),
        cpu: `${proc.cpuPct}%`,
        jobs: String(proc.runningJobs),
        custom: String(proc.activeCustomRuns),
        project: health.projectDir,
      },
    ],
    ["ok", "stale", "pid", "uptime", "rss", "cpu", "jobs", "custom", "project"],
  );
  console.log(`host  ${proc.system.platform}  cores=${proc.system.cores}  load=${proc.system.loadavg.join("/")}  mem=${fmtBytes(proc.system.freemem)} free / ${fmtBytes(proc.system.totalmem)}`);
  console.log("providers");
  printProviders(providers);
}
