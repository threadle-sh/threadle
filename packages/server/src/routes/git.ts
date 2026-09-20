import { execa } from "execa";
import { Hono } from "hono";
import path from "node:path";
import { registry } from "../providers/registry.js";
import {
  correlateCommitSessions,
  type GitCommitMeta,
  type SessionCandidateInput,
} from "../git/correlate.js";
import { resolveCommitQuery } from "../git/rev.js";
import { pathSameOrNested } from "../path-safe.js";
import { isKnownProjectDir } from "../readable-paths.js";

export const gitRoutes = new Hono();

/** @deprecated Prefer PossibleSessionMatch from correlate — kept for tests. */
export interface GitSessionMatch {
  provider: string;
  sessionId: string;
  title?: string;
  score: number;
  reasons: string[];
}

async function loadCommitMeta(
  dir: string,
  query: string,
): Promise<GitCommitMeta & { matchedBy: "rev" | "message"; matchCount?: number }> {
  const cwd = path.resolve(dir);
  const resolved = await resolveCommitQuery(cwd, query);
  const hash = resolved.sha;

  const { stdout: metaOut } = await execa(
    "git",
    ["show", "-s", "--format=%H%n%ct%n%s", hash],
    { cwd, timeout: 15_000 },
  );
  const metaLines = metaOut.trim().split("\n");
  const commitTs = Number(metaLines[1]) * 1000;
  const subject = metaLines.slice(2).join("\n");

  const { stdout: nameOut } = await execa(
    "git",
    ["show", "--name-only", "--format=", hash],
    { cwd, timeout: 15_000 },
  );
  const files = nameOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let branch: string | undefined;
  try {
    const { stdout: br } = await execa(
      "git",
      ["name-rev", "--name-only", "--refs=refs/heads/*", hash],
      { cwd, timeout: 10_000 },
    );
    const name = br.trim();
    if (name && name !== "undefined") branch = name.replace(/~\d+$/, "");
  } catch {
    // optional
  }

  return {
    hash,
    commitTs,
    subject,
    branch,
    files,
    matchedBy: resolved.matchedBy,
    matchCount: resolved.matchedBy === "message" ? resolved.matchCount : undefined,
  };
}

/**
 * GET /api/git/sessions?dir=&commit=
 * Possible sessions for a commit — ranked heuristics, never certain.
 */
gitRoutes.get("/sessions", async (c) => {
  const dir = c.req.query("dir");
  const commit = c.req.query("commit");
  if (!dir || !commit) {
    return c.json({ error: "dir and commit query params required" }, 400);
  }
  // Running git with an arbitrary cwd is code execution in practice
  // (core.fsmonitor / pager / aliases in that repo's .git/config) — only
  // accept directories the user demonstrably works in.
  if (!(await isKnownProjectDir(dir))) {
    return c.json({ error: `dir is not a known project directory: ${dir}` }, 403);
  }
  try {
    const meta = await loadCommitMeta(dir, commit);
    const cwd = path.resolve(dir);
    const sessions: SessionCandidateInput[] = [];
    for (const p of registry.providers.values()) {
      let list;
      try {
        list = await p.listSessions();
      } catch {
        continue;
      }
      for (const s of list) {
        if (!s.projectDir) continue;
        const proj = path.resolve(s.projectDir);
        const sameRoot = pathSameOrNested(proj, cwd);
        if (!sameRoot) continue;
        let touchedFiles: string[] = [];
        try {
          const touched = await p.getTouchedFiles(s.id);
          touchedFiles = touched.map((f) => f.path);
        } catch {
          touchedFiles = [];
        }
        const gitBranch =
          typeof s.meta?.gitBranch === "string"
            ? s.meta.gitBranch
            : typeof s.meta?.branch === "string"
              ? s.meta.branch
              : undefined;
        sessions.push({
          provider: s.provider,
          sessionId: s.id,
          title: s.title,
          projectDir: s.projectDir,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          gitBranch,
          touchedFiles,
        });
      }
    }
    const candidates = correlateCommitSessions(meta, sessions);
    return c.json({
      label: "possible",
      note: "possible sessions only — heuristic match on time / branch / files; never certain",
      commit: {
        sha: meta.hash,
        subject: meta.subject,
        authorDate: meta.commitTs,
        files: meta.files,
        branch: meta.branch,
        matchedBy: meta.matchedBy,
        matchCount: meta.matchCount,
      },
      candidates: candidates.slice(0, 20).map((m) => ({
        provider: m.provider,
        sessionId: m.sessionId,
        title: m.title,
        projectDir: m.projectDir,
        updatedAt: m.updatedAt,
        score: m.score,
        matchReasons: m.matchReasons,
        overlapFiles: m.overlapFiles,
        label: m.label,
      })),
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});
