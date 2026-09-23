import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { threadleConfigDir } from "../graphs/store.js";
import { clearIndex } from "../search.js";
import { activeCustomRuns } from "./custom-nodes.js";
import { jobs } from "../jobs.js";

export interface InternalItem {
  id: string;
  label: string;
  path: string;
  kind: "file" | "dir";
  description: string;
  /** whether POST /clear accepts this id */
  clearable: boolean;
  /** clearable but destroys user-created data — UI must double-confirm */
  danger?: boolean;
  exists: boolean;
  bytes: number;
  files: number;
}

interface ItemSpec {
  id: string;
  label: string;
  rel: string;
  kind: "file" | "dir";
  description: string;
  clearable: boolean;
  danger?: boolean;
}

/**
 * Everything threadle writes to disk, in one whitelisted list. `clearable`
 * marks state that is safe to throw away (caches, logs, history);
 * graphs, favorites, and settings are listed for transparency but never bulk-cleared.
 */
const ITEMS: ItemSpec[] = [
  {
    id: "settings", label: "Settings", rel: "settings.json", kind: "file",
    description: "Editor, pricing source and other preferences.",
    clearable: false,
  },
  {
    id: "graphs", label: "Workflows", rel: "graphs", kind: "dir",
    description: "Your saved workflows and sub-workflows — one JSON file each.",
    clearable: false,
  },
  {
    id: "favorites", label: "Favorites", rel: "favorites.json", kind: "file",
    description: "Jump-list bookmarks for workflows, sessions, library payloads, skills, rules, and files.",
    clearable: false,
  },
  {
    id: "pilot-sessions",
    label: "Test pilot sessions",
    rel: "pilot-sessions.json",
    kind: "file",
    description: "Session ids spawned by Settings → test pilot (show/hide in Sessions).",
    clearable: false,
  },
  {
    id: "payloads", label: "Context payloads", rel: "payloads", kind: "dir",
    description: "Extracted summaries, transcript excerpts and their tags (content-addressed).",
    clearable: true, danger: true,
  },
  {
    id: "search-db", label: "Search index", rel: "search.db", kind: "file",
    description: "SQLite full-text index over transcripts and payloads. Rebuilds automatically on the next search.",
    clearable: true,
  },
  {
    id: "run-history", label: "Run history", rel: "runs/jobs.jsonl", kind: "file",
    description: "The record of every workflow/agent run shown in the Runs view.",
    clearable: true,
  },
  {
    id: "run-logs", label: "Run logs", rel: "runs/logs", kind: "dir",
    description: "Per-run execution logs (one file per job).",
    clearable: true,
  },
  {
    id: "lineage", label: "Lineage records", rel: "runs/injects.jsonl", kind: "file",
    description: "Which context was injected where — powers the Lineage view.",
    clearable: true, danger: true,
  },
  {
    id: "pricing-cache", label: "Model prices cache (legacy)", rel: "models-pricing.json", kind: "file",
    description: "Leftover from older threadle versions. Prices now ship bundled; safe to clear.",
    clearable: true,
  },
  {
    id: "custom-nodes", label: "Custom nodes", rel: "nodes", kind: "dir",
    description: "User-authored workflow nodes — node.json manifests plus their executables.",
    clearable: false,
  },
  {
    id: "skills-custom", label: "Custom skills", rel: "skills/custom", kind: "dir",
    description: "Skillsets you create in threadle (~/.config/threadle/skills/custom).",
    clearable: false,
  },
  {
    id: "skills-imported", label: "Imported skills", rel: "skills/imported", kind: "dir",
    description: "Skillsets imported into threadle (~/.config/threadle/skills/imported). Project-repo skills override these on name clash.",
    clearable: true,
  },
  {
    id: "tmp", label: "Temp files", rel: "tmp", kind: "dir",
    description: "Scratch files written while injecting context into sessions.",
    clearable: true,
  },
];

function statOf(p: string): { exists: boolean; bytes: number; files: number } {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return { exists: true, bytes: st.size, files: 1 };
    let bytes = 0;
    let files = 0;
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else {
          try {
            bytes += fs.statSync(full).size;
            files += 1;
          } catch { /* raced delete */ }
        }
      }
    };
    walk(p);
    return { exists: true, bytes, files };
  } catch {
    return { exists: false, bytes: 0, files: 0 };
  }
}

/** Delete a directory's contents but keep the directory itself. */
async function emptyDir(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    await fs.promises.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

export const internalsRoutes = new Hono();

let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();

/**
 * Live process/system status. Agent-less workflows (custom nodes) execute
 * as child processes of this server on the user's own hardware — this is
 * where that footprint becomes visible.
 */
internalsRoutes.get("/process", (c) => {
  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  const elapsedMs = Math.max(1, now - lastCpuAt);
  // % of one core over the window since the last poll
  const cpuPct = Math.min(999, ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100);
  lastCpu = process.cpuUsage();
  lastCpuAt = now;

  const mem = process.memoryUsage();
  return c.json({
    pid: process.pid,
    node: process.version,
    uptime: Math.round(process.uptime()),
    cpuPct: Math.round(cpuPct * 10) / 10,
    mem: { rss: mem.rss, heapUsed: mem.heapUsed, external: mem.external },
    threadpool: Number(process.env.UV_THREADPOOL_SIZE ?? 4),
    activeCustomRuns: activeCustomRuns(),
    runningJobs: jobs.list(200).filter((j) => j.status === "running").length,
    system: {
      cores: os.cpus().length,
      loadavg: os.loadavg().map((v) => Math.round(v * 100) / 100),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    },
  });
});

internalsRoutes.get("/", (c) => {
  const root = threadleConfigDir();
  const items: InternalItem[] = ITEMS.map((it) => {
    const abs = path.join(root, it.rel);
    return {
      id: it.id,
      label: it.label,
      path: abs,
      kind: it.kind,
      description: it.description,
      clearable: it.clearable,
      danger: it.danger,
      ...statOf(abs),
    };
  });
  return c.json({ root, items });
});

internalsRoutes.post("/clear", async (c) => {
  const { id } = (await c.req.json()) as { id?: string };
  const spec = ITEMS.find((it) => it.id === id);
  if (!spec) return c.json({ error: "unknown item" }, 400);
  if (!spec.clearable) return c.json({ error: "this item cannot be cleared" }, 400);

  const abs = path.join(threadleConfigDir(), spec.rel);
  try {
    if (spec.id === "search-db") {
      // the server holds the sqlite file open — empty it in place instead of unlinking
      clearIndex();
    } else if (spec.kind === "dir") {
      await emptyDir(abs);
    } else {
      await fs.promises.rm(abs, { force: true });
    }
    return c.json({ ok: true, ...statOf(abs) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
