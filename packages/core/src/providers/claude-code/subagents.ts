import fs from "node:fs";
import path from "node:path";
import type { SessionRef } from "@threadle/shared";
import { scanSessionCached } from "./jsonl.js";
import { findTranscriptPath } from "./discover.js";
import { claudeUsageRows } from "../../routes/pricing.js";
import { readSettings } from "../../routes/settings.js";

interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
}

/** Subagent transcripts live at <project>/<sessionId>/subagents/agent-*.jsonl */
export async function listSubagentRuns(sessionId: string): Promise<SessionRef[]> {
  const transcript = await findTranscriptPath(sessionId);
  if (!transcript) return [];
  const subDir = path.join(
    path.dirname(transcript),
    sessionId,
    "subagents",
  );
  let files: string[];
  try {
    files = await fs.promises.readdir(subDir);
  } catch {
    return [];
  }
  const out: SessionRef[] = [];
  const billing = (await readSettings()).claudeBilling ?? "subscription";
  for (const name of files) {
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    const agentId = name.slice(0, -".jsonl".length);
    const jsonlPath = path.join(subDir, name);
    let meta: SubagentMeta = {};
    try {
      meta = JSON.parse(
        await fs.promises.readFile(
          path.join(subDir, `${agentId}.meta.json`),
          "utf8",
        ),
      ) as SubagentMeta;
    } catch {
      // meta file optional
    }
    try {
      const scan = await scanSessionCached(jsonlPath);
      const stat = await fs.promises.stat(jsonlPath);
      const usage = await claudeUsageRows(scan.usageByModel);
      const actualCost =
        usage.total === undefined ? undefined : billing === "api" ? usage.total : 0;
      out.push({
        provider: "claude-code",
        id: `${sessionId}/${agentId}`,
        parentId: sessionId,
        projectDir: scan.cwd ?? "",
        title: meta.description ?? scan.title ?? agentId,
        agent: meta.agentType,
        model: scan.model,
        createdAt: scan.firstTimestamp,
        updatedAt: scan.lastTimestamp ?? stat.mtimeMs,
        status: "idle",
        kind: "subagent-run",
        messageCount: scan.messageCount,
        tokensIn: scan.tokensIn,
        tokensOut: scan.tokensOut,
        tokensCacheRead: scan.tokensCacheRead,
        tokensCacheWrite: scan.tokensCacheWrite,
        cost: usage.total,
        actualCost,
        meta: {
          toolUseId: meta.toolUseId,
          spawnDepth: meta.spawnDepth,
          usageByModel: usage.rows.length ? usage.rows : undefined,
          apiDurationMs: scan.apiDurationMs || undefined,
          linesAdded: scan.linesAdded || undefined,
          linesRemoved: scan.linesRemoved || undefined,
        },
      });
    } catch {
      // unreadable — skip
    }
  }
  out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return out;
}

/** Resolve a subagent-run composite id ("<sessionId>/agent-<hex>") to its jsonl path. */
export async function findSubagentTranscript(
  compositeId: string,
): Promise<string | undefined> {
  const [sessionId, agentId] = compositeId.split("/");
  if (!sessionId || !agentId) return undefined;
  const transcript = await findTranscriptPath(sessionId);
  if (!transcript) return undefined;
  const p = path.join(
    path.dirname(transcript),
    sessionId,
    "subagents",
    `${agentId}.jsonl`,
  );
  try {
    await fs.promises.access(p);
    return p;
  } catch {
    return undefined;
  }
}
