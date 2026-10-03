import fs from "node:fs";
import path from "node:path";
import { isSafeJobId, jobs } from "@threadle/core/jobs.js";
import { threadleConfigDir } from "@threadle/core/paths.js";

// ---- per-job node output cache (runs/<jobId>/outputs.json) ----

/** Serializable node output for replay / scoped seed. */
export interface CachedNodeOutput {
  text?: string;
  items?: string[];
  session?: { provider: string; sessionId: string };
  ports?: Record<string, string>;
}

function jobOutputsPath(jobId: string): string {
  return path.join(threadleConfigDir(), "runs", jobId, "outputs.json");
}

export async function readJobOutputs(
  jobId: string,
): Promise<Record<string, CachedNodeOutput>> {
  if (!isSafeJobId(jobId)) return {};
  try {
    const raw = await fs.promises.readFile(jobOutputsPath(jobId), "utf8");
    const parsed = JSON.parse(raw) as Record<string, CachedNodeOutput>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeJobOutputs(
  jobId: string,
  outputs: Record<string, CachedNodeOutput>,
): Promise<void> {
  if (!isSafeJobId(jobId)) return;
  try {
    const dir = path.dirname(jobOutputsPath(jobId));
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      jobOutputsPath(jobId),
      JSON.stringify(outputs),
      "utf8",
    );
  } catch {
    // best-effort cache
  }
}

/** Merge one node into the on-disk cache (read-modify-write). */
export async function mergeJobNodeOutput(
  jobId: string,
  nodeId: string,
  output: CachedNodeOutput,
): Promise<void> {
  if (!isSafeJobId(jobId) || !nodeId) return;
  jobs.touch(jobId);
  const cur = await readJobOutputs(jobId);
  cur[nodeId] = output;
  await writeJobOutputs(jobId, cur);
}

/**
 * Latest finished workflow job for `graphId` that has an outputs.json.
 * Used when seeding a scoped / replay run.
 */
export async function findLatestGraphOutputs(
  graphId: string,
  excludeJobId?: string,
): Promise<{ jobId: string; outputs: Record<string, CachedNodeOutput> } | undefined> {
  if (!graphId) return undefined;
  const history = await jobs.listWithHistory(500);
  const candidates = history
    .filter(
      (j) =>
        j.kind === "workflow" &&
        j.graphId === graphId &&
        j.status === "done" &&
        j.id !== excludeJobId,
    )
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt));
  for (const j of candidates) {
    const outputs = await readJobOutputs(j.id);
    if (Object.keys(outputs).length) return { jobId: j.id, outputs };
  }
  return undefined;
}
