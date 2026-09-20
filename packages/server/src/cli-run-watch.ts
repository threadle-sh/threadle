/**
 * `threadle run --watch` — re-run on portable graph file mtime and/or git
 * changes under `--dir` (poor-man's trigger; prefer daemon + triggers.json
 * for multi-graph automation).
 */
import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { isGitMissing } from "./git/rev.js";

const DEFAULT_DEBOUNCE_MS = 800;
const GIT_POLL_MS = 1000;

/** Paths under a project dir that should never kick a watch re-run. */
const DIR_IGNORED =
  /(^|[/\\])(\.git|\.threadle|node_modules|dist|build|coverage|\.next|\.turbo|web-dist)([/\\]|$)/;

/**
 * Absolute path of a portable / example graph JSON to watch, if any.
 * Saved config graphs (`~/.config/threadle/graphs/<id>.json`) are excluded —
 * the executor rewrites them every run and would loop.
 */
export function resolveGraphSourceFile(target: string): string | undefined {
  const asFile = path.resolve(target);
  try {
    if (fs.existsSync(asFile) && fs.statSync(asFile).isFile()) return asFile;
  } catch {
    // ignore
  }

  const exampleCandidates = [
    path.resolve("examples/recipes", `${target}.json`),
    path.resolve("examples/recipes", target),
    path.resolve("examples/workflows", `${target}.json`),
    path.resolve("examples/workflows", target),
  ];
  for (const cand of exampleCandidates) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    } catch {
      // ignore
    }
  }
  return undefined;
}

/** HEAD + porcelain working tree — null when dir is not a git work tree. */
export async function gitChangeFingerprint(dir: string): Promise<string | null> {
  const cwd = path.resolve(dir);
  try {
    const head = await execa("git", ["rev-parse", "HEAD"], {
      cwd,
      timeout: 8_000,
      reject: false,
    });
    if (head.exitCode !== 0) return null;
    const status = await execa("git", ["status", "--porcelain=v1", "-uall"], {
      cwd,
      timeout: 15_000,
      reject: false,
    });
    if (status.exitCode !== 0) return null;
    return `${head.stdout.trim()}\n${status.stdout}`;
  } catch (err) {
    if (isGitMissing(err)) return null;
    return null;
  }
}

export type RunWatchReason = "graph" | "git" | "fs";

export interface RunWatchHandle {
  close: () => Promise<void>;
  /** Human-readable summary of what is being watched. */
  label: string;
}

/**
 * Kick `onKick` when the graph source file changes and/or when git status
 * under `projectDir` changes. Falls back to a directory fs watch when the
 * project is not a git work tree and there is no graph file.
 */
export async function startRunWatch(opts: {
  graphFile?: string;
  projectDir: string;
  onKick: (reason: RunWatchReason) => void | Promise<void>;
  debounceMs?: number;
}): Promise<RunWatchHandle> {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const projectDir = path.resolve(opts.projectDir);
  const graphFile = opts.graphFile ? path.resolve(opts.graphFile) : undefined;

  let closed = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: RunWatchReason | undefined;
  const closers: Array<() => Promise<void>> = [];

  const flush = async (reason: RunWatchReason): Promise<void> => {
    if (closed || busy) {
      pending = reason;
      return;
    }
    busy = true;
    try {
      await opts.onKick(reason);
    } finally {
      busy = false;
      if (pending && !closed) {
        const next = pending;
        pending = undefined;
        schedule(next);
      }
    }
  };

  const schedule = (reason: RunWatchReason): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush(reason);
    }, debounceMs);
  };

  const parts: string[] = [];

  if (graphFile) {
    parts.push(`graph ${graphFile}`);
    const chokidar = (await import("chokidar")).default;
    const w = chokidar.watch(graphFile, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    });
    w.on("change", () => schedule("graph"));
    w.on("add", () => schedule("graph"));
    closers.push(async () => {
      await w.close();
    });
  }

  const gitFp0 = await gitChangeFingerprint(projectDir);
  if (gitFp0 !== null) {
    parts.push(`git ${projectDir}`);
    let last = gitFp0;
    const interval = setInterval(() => {
      void (async () => {
        if (closed || busy) return;
        const next = await gitChangeFingerprint(projectDir);
        if (next === null || next === last) return;
        last = next;
        schedule("git");
      })();
    }, GIT_POLL_MS);
    closers.push(async () => {
      clearInterval(interval);
    });
  } else if (!graphFile) {
    // Non-git project and no portable graph file — watch the tree.
    parts.push(`fs ${projectDir}`);
    const chokidar = (await import("chokidar")).default;
    const w = chokidar.watch(projectDir, {
      ignoreInitial: true,
      ignored: DIR_IGNORED,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    });
    w.on("add", () => schedule("fs"));
    w.on("change", () => schedule("fs"));
    closers.push(async () => {
      await w.close();
    });
  } else {
    parts.push(`(no git in ${projectDir} — graph file only)`);
  }

  const label = parts.join(" · ");

  return {
    label,
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await Promise.all(closers.map((c) => c()));
    },
  };
}
