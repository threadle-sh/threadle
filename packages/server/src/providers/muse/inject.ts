import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { ContextPayload, InjectResult, InjectTarget } from "@threadle/shared";
import { forEachLine, type LogLane, type LogSink } from "../stream.js";
import { museBin } from "./paths.js";

const INJECT_TIMEOUT_MS = 10 * 60_000;

const FALLBACK_MODELS = [
  "muse-spark-1.3",
  "muse-spark-1.3-contributor",
  "muse-spark-1.2",
];

/** Pull Spark model ids from muse help text (soft catalog until upstream ships `muse models`). */
export function parseMuseSparkIds(helpText: string): string[] {
  const ids = new Set<string>();
  for (const m of helpText.matchAll(/muse-spark-[\w.-]+/g)) {
    ids.add(m[0]!);
  }
  return [...ids];
}

async function helpText(args: string[]): Promise<string> {
  const { stdout, stderr } = await execa(museBin(), args, {
    timeout: 8_000,
    reject: false,
  });
  return `${stdout}\n${stderr}`;
}

export async function listMuseModels(): Promise<string[]> {
  // Prefer env override for labs. Upstream has no stable `muse models` yet.
  const env = process.env.MUSE_MODELS?.trim();
  if (env) {
    return env
      .split(/[,:\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const ids = new Set<string>(FALLBACK_MODELS);
  try {
    // Prefer exec help (inject surface); fall back to top-level help.
    for (const args of [["exec", "--help"], ["--help"]] as string[][]) {
      const text = await helpText(args);
      for (const id of parseMuseSparkIds(text)) ids.add(id);
      if (ids.size > FALLBACK_MODELS.length) break;
    }
  } catch {
    /* keep fallbacks */
  }
  return [...ids];
}

function contextText(payload: ContextPayload, kickoff?: string): string {
  const parts = [
    "# Context handed off from another agent session",
    "",
    `(source: ${payload.source.provider} session ${payload.source.sessionId}${payload.meta.sourceTitle ? ` — "${payload.meta.sourceTitle}"` : ""}, payload kind: ${payload.kind})`,
    "",
    payload.content,
  ];
  if (kickoff?.trim()) parts.push("", "---", "", kickoff.trim());
  return parts.join("\n");
}

function execArgs(opts: {
  sessionId?: string;
  model?: string;
  promptFile: string;
}): string[] {
  const args = [
    "exec",
    "--json",
    "--prompt-file",
    opts.promptFile,
    "--approval-mode",
    "never",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.sessionId) args.push("--session-id", opts.sessionId);
  return args;
}

async function withPromptFile(
  prompt: string,
  fn: (file: string) => Promise<{ sessionId?: string; resultText?: string; isError: boolean }>,
): Promise<{ sessionId?: string; resultText?: string; isError: boolean }> {
  const file = path.join(os.tmpdir(), `threadle-muse-${randomUUID()}.txt`);
  await fs.promises.writeFile(file, prompt, "utf8");
  try {
    return await fn(file);
  } finally {
    await fs.promises.unlink(file).catch(() => undefined);
  }
}

async function runMuseStreaming(
  args: string[],
  cwd: string,
  onLog?: LogSink,
  signal?: AbortSignal,
): Promise<{ sessionId?: string; resultText?: string; isError: boolean }> {
  const child = execa(museBin(), args, {
    cwd,
    timeout: INJECT_TIMEOUT_MS,
    stdin: "ignore",
    cancelSignal: signal,
    reject: false,
    env: { ...process.env },
  });
  const chunks: string[] = [];
  let sessionId: string | undefined;
  forEachLine(child.stdout, (line) => {
    chunks.push(line);
    if (onLog) onLog("text" as LogLane, line);
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const sid =
        (typeof row.session_id === "string" && row.session_id) ||
        (typeof row.sessionId === "string" && row.sessionId) ||
        undefined;
      if (sid) sessionId = sid;
    } catch {
      /* plain text */
    }
  });
  forEachLine(child.stderr, (line) => {
    if (onLog) onLog("raw" as LogLane, line);
  });
  const result = await child;
  const sidIdx = args.indexOf("--session-id");
  if (sidIdx >= 0 && args[sidIdx + 1]) sessionId = sessionId ?? args[sidIdx + 1];
  return {
    sessionId,
    resultText: chunks.join("\n").trim() || result.stdout?.trim() || undefined,
    isError: result.exitCode !== 0 && result.exitCode !== undefined,
  };
}

export async function injectMuse(
  target: InjectTarget,
  payload: ContextPayload,
  kickoff?: string,
): Promise<InjectResult> {
  const prompt = contextText(payload, kickoff);
  const cwd = target.projectDir || process.cwd();

  if (target.mode === "continue") {
    if (!target.sessionId) throw new Error("continue inject requires a sessionId");
    const r = await withPromptFile(prompt, (file) =>
      runMuseStreaming(
        execArgs({ promptFile: file, model: target.model, sessionId: target.sessionId }),
        cwd,
      ),
    );
    if (r.isError) throw new Error("muse continue inject failed");
    return {
      newSessionId: r.sessionId ?? target.sessionId,
      provider: "muse",
      resultText: r.resultText,
    };
  }

  if (target.mode === "new-session") {
    const r = await withPromptFile(prompt, (file) =>
      runMuseStreaming(execArgs({ promptFile: file, model: target.model }), cwd),
    );
    if (r.isError) throw new Error("muse new-session inject failed");
    const id = r.sessionId ?? randomUUID();
    return {
      newSessionId: id,
      provider: "muse",
      resultText: r.resultText,
    };
  }

  throw new Error(`unsupported inject mode for muse: ${target.mode}`);
}

export async function runMuseAgent(opts: {
  agent?: string;
  model?: string;
  prompt: string;
  projectDir: string;
  sessionId?: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}): Promise<InjectResult> {
  const r = await withPromptFile(opts.prompt, (file) =>
    runMuseStreaming(
      execArgs({
        promptFile: file,
        model: opts.model,
        sessionId: opts.sessionId,
      }),
      opts.projectDir,
      opts.onLog,
      opts.signal,
    ),
  );
  if (r.isError) throw new Error("muse agent run failed");
  const id = r.sessionId ?? opts.sessionId;
  if (!id) throw new Error("muse agent run returned no session id");
  return {
    newSessionId: id,
    provider: "muse",
    resultText: r.resultText,
  };
}
