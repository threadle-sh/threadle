import fs from "node:fs";
import type {
  ContextConfig,
  ContextKind,
  ContextPayload,
  DistillConfig,
  ExtractConfig,
  FilesConfig,
  ProviderId,
  TouchedFile,
} from "@threadle/shared";
import { DEFAULT_EXTRACT_CONFIG } from "@threadle/shared";
import { registry } from "../providers/registry.js";
import type { LogSink } from "../providers/stream.js";
import { distill } from "./distill.js";
import { estimateTokens, renderTranscript } from "./extract.js";
import { storePayload } from "./store.js";
import { isReadablePath } from "../readable-paths.js";

const SNAPSHOT_MAX_BYTES = 256 * 1024;

export interface MaterializeContextOpts {
  kind: ContextKind;
  config: ContextConfig;
  source: { provider: ProviderId; sessionId: string };
  projectDir: string;
  onLog?: LogSink;
  signal?: AbortSignal;
}

async function sourceTitle(
  provider: string,
  sessionId: string,
): Promise<string | undefined> {
  try {
    const ref = await registry.get(provider).getSession(sessionId);
    return ref?.title;
  } catch {
    return undefined;
  }
}

/** Render touched-files manifest (+ optional content snapshots). */
export async function renderFilesManifest(
  files: TouchedFile[],
  config: FilesConfig,
): Promise<string> {
  const lines = [
    "# Files touched by source session",
    "",
    "| operation | path |",
    "|---|---|",
    ...files.map((f) => `| ${f.op} | \`${f.path}\` |`),
    "",
  ];
  if (config.snapshotContents) {
    for (const f of files) {
      if (f.op === "read") continue;
      try {
        // f.path comes straight out of the transcript — UNTRUSTED. Without
        // this gate a hostile transcript entry naming ~/.aws/credentials
        // would embed the file into a payload that later flows to a model
        // provider. Same allowlist as /api/files/read.
        if (!(await isReadablePath(f.path))) continue;
        const stat = await fs.promises.stat(f.path);
        if (!stat.isFile() || stat.size > SNAPSHOT_MAX_BYTES) continue;
        const text = await fs.promises.readFile(f.path, "utf8");
        if (text.includes("\0")) continue;
        lines.push(`## ${f.path}`, "", "```", text, "```", "");
      } catch {
        // file gone or unreadable — manifest row still stands
      }
    }
  }
  return lines.join("\n");
}

/**
 * Extract / distill / files → store a library payload.
 * Used by HTTP routes and the detached workflow executor.
 */
export async function materializeContextPayload(
  opts: MaterializeContextOpts,
): Promise<ContextPayload> {
  const { kind, source, projectDir, onLog, signal } = opts;
  const provider = registry.get(source.provider);
  const title = await sourceTitle(source.provider, source.sessionId);

  if (kind === "distilled-summary") {
    const config = opts.config as DistillConfig;
    onLog?.(
      "raw",
      `❝ distill ${source.provider}:${source.sessionId.slice(0, 8)}… via ${config.provider ?? "claude-code"}`,
    );
    const messages = await provider.getTranscript(source.sessionId);
    const rendered = renderTranscript(messages, {
      ...DEFAULT_EXTRACT_CONFIG,
      maxChars: 400_000,
    });
    const result = await distill({
      renderedTranscript: rendered,
      config,
      projectDir,
      onLog,
      signal,
    });
    return storePayload({
      kind: "distilled-summary",
      createdAt: Date.now(),
      source,
      content: result.summary,
      meta: {
        model: result.model,
        tokenEstimate: estimateTokens(result.summary),
        sourceTitle: title,
      },
    });
  }

  if (kind === "files") {
    const config = opts.config as FilesConfig;
    onLog?.(
      "raw",
      `❝ files ${source.provider}:${source.sessionId.slice(0, 8)}…`,
    );
    const files = await provider.getTouchedFiles(source.sessionId);
    const content = await renderFilesManifest(files, config);
    return storePayload({
      kind: "files",
      createdAt: Date.now(),
      source,
      content,
      meta: {
        tokenEstimate: estimateTokens(content),
        sourceTitle: title,
      },
    });
  }

  const config = opts.config as ExtractConfig;
  onLog?.(
    "raw",
    `❝ extract ${source.provider}:${source.sessionId.slice(0, 8)}…`,
  );
  const messages = await provider.getTranscript(source.sessionId);
  const content = renderTranscript(messages, config);
  return storePayload({
    kind: "transcript-excerpt",
    createdAt: Date.now(),
    source,
    content,
    meta: {
      messageRange: config.range,
      tokenEstimate: estimateTokens(content),
      sourceTitle: title,
    },
  });
}
