import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { SessionRef } from "@threadle/shared";
import { formatTokCompact } from "@threadle/shared";
import { registry } from "../providers/registry.js";
import { toolInvocationBody, toolSummary } from "../providers/stream.js";
import { renderTranscript } from "../context/extract.js";
import { buildContextGrowth, buildContextTimeline } from "../context/timeline.js";
import { buildSessionBundle } from "./bundle.js";
import { FILE_PREVIEW_MAX_BYTES } from "./files.js";
import { globalArtifacts, projectArtifacts } from "./rules.js";
import { readInjects, readPayloadMetas } from "./lineage.js";
import { threadleConfigDir, sameProjectDir } from "../paths.js";
import { readPilotSessionMap, type PilotSessionEntry } from "../pilot-sessions/store.js";
import { ensureBareWorkspace } from "../providers/bare-workspace.js";
import { SESSION_CONTEXT_CONFIG } from "../context/session-context.js";
import {
  renderInvocationsMarkdown,
  type InvocationKind,
} from "../context/invocations.js";

async function enrichPilotMeta(ref: SessionRef): Promise<SessionRef> {
  try {
    const [pilotMap, bareDir] = await Promise.all([
      readPilotSessionMap(),
      ensureBareWorkspace(),
    ]);
    return applyPilotEntry(ref, pilotMap.get(`${ref.provider}:${ref.id}`), bareDir);
  } catch {
    return ref;
  }
}

function applyPilotEntry(
  r: SessionRef,
  entry: PilotSessionEntry | undefined,
  bareDir: string,
): SessionRef {
  const marked = Boolean(entry) || sameProjectDir(r.projectDir, bareDir);
  if (!marked) return r;
  const meta: Record<string, unknown> = { ...r.meta, pilot: true };
  if (entry?.caseId) meta.pilotCaseId = entry.caseId;
  if (entry?.ignoreLocalMarkdown != null) {
    meta.ignoreLocalMarkdown = entry.ignoreLocalMarkdown;
  }
  if (entry?.baselineEst != null) {
    meta.tokenBaselineEst = entry.baselineEst;
    meta.tokenPromptEst = entry.promptEst;
    meta.tokenBaselineNote = entry.baselineNote;
    if (entry.tokensIn != null) meta.pilotTokensIn = entry.tokensIn;
    if (entry.tokensOut != null) meta.pilotTokensOut = entry.tokensOut;
    meta.tokenBaselineLabel = `~${formatTokCompact(entry.baselineEst)}${
      entry.baselineNote ? ` · ${entry.baselineNote}` : ""
    }`;
  }
  return { ...r, meta };
}

export const sessionRoutes = new Hono();

// Session ids legitimately contain "/" (composite subagent ids), so the
// `:id{.+}` routes cannot pin a charset — but they DO feed path joins in the
// providers (`<store>/<slug>/<id>.jsonl`). Kill traversal at the router:
// no `..` segments, backslashes, or NULs anywhere in the decoded path.
sessionRoutes.use("*", async (c, next) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(c.req.path);
  } catch {
    return c.json({ error: "malformed path" }, 400);
  }
  if (/(^|\/)\.\.(\/|$)/.test(decoded) || decoded.includes("\\") || decoded.includes("\0")) {
    return c.json({ error: "invalid session path" }, 400);
  }
  return next();
});

sessionRoutes.get("/", async (c) => {
  const provider = c.req.query("provider");
  const projectDir = c.req.query("projectDir");
  const q = c.req.query("q")?.toLowerCase();

  const targets = provider
    ? [registry.get(provider)]
    : [...registry.providers.values()];

  const lists = await Promise.all(
    targets.map(async (p) => {
      try {
        if (!(await p.available())) return [];
        return await p.listSessions({ projectDir: projectDir || undefined });
      } catch (err) {
        console.warn(`threadle: listSessions failed for ${p.id}: ${String(err)}`);
        return [];
      }
    }),
  );

  let refs: SessionRef[] = lists.flat();
  if (q) {
    refs = refs.filter(
      (r) =>
        r.title?.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.projectDir.toLowerCase().includes(q),
    );
  }
  refs.sort((a, b) => b.updatedAt - a.updatedAt);

  // Tag Settings → test pilot smokes (sidecar mark and/or bare pilot cwd).
  try {
    const [pilotMap, bareDir] = await Promise.all([
      readPilotSessionMap(),
      ensureBareWorkspace(),
    ]);
    refs = refs.map((r) =>
      applyPilotEntry(r, pilotMap.get(`${r.provider}:${r.id}`), bareDir),
    );
  } catch {
    // best-effort — list still works without marks
  }

  return c.json(refs);
});

/**
 * Agent instances across all providers: top-level sessions spawned from an
 * agent definition, plus claude-code subagent runs (which only exist as
 * children and never appear in the main session list).
 */
let instCache: { at: number; refs: SessionRef[] } | undefined;

sessionRoutes.get("/instances", async (c) => {
  if (instCache && Date.now() - instCache.at < 15_000) {
    return c.json(instCache.refs);
  }
  const providers = [...registry.providers.values()];
  const lists = await Promise.all(
    providers.map(async (p) => {
      try {
        if (!(await p.available())) return [];
        return await p.listSessions({});
      } catch {
        return [];
      }
    }),
  );
  const all = lists.flat();
  const refs: SessionRef[] = all.filter((s) => s.agent);

  // Fan out children (subagent runs / Task tools / opencode child sessions).
  // Top-level listSessions already excludes children for every provider.
  const withChildren = all.filter((s) => s.kind === "session");
  const childLists = await Promise.all(
    withChildren.map(async (s) => {
      const p = registry.providers.get(s.provider);
      if (!p) return [];
      return p.listChildren(s.id).catch(() => []);
    }),
  );
  refs.push(...childLists.flat().filter((r) => r.agent));
  refs.sort((a, b) => b.updatedAt - a.updatedAt);
  instCache = { at: Date.now(), refs };
  return c.json(refs);
});

// action comes before the id because composite subagent ids contain "/"
sessionRoutes.get("/:provider/children/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  return c.json(await p.listChildren(c.req.param("id")));
});

sessionRoutes.get("/:provider/transcript/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  const limit = Number(c.req.query("limit") ?? 500);
  const full = c.req.query("full") === "1";
  const around = c.req.query("around") || undefined;
  const aroundTsRaw = c.req.query("aroundTs");
  const aroundTs = aroundTsRaw != null && aroundTsRaw !== "" ? Number(aroundTsRaw) : undefined;
  const aroundRole = c.req.query("aroundRole") || undefined;
  const messages =
    full && p.getTranscriptFull
      ? await p.getTranscriptFull(c.req.param("id"))
      : await p.getTranscript(c.req.param("id"));

  let focusIndex = -1;
  if (around) {
    focusIndex = messages.findIndex((m) => m.id === around);
  }
  if (focusIndex < 0 && aroundTs != null && Number.isFinite(aroundTs)) {
    if (aroundRole) {
      focusIndex = messages.findIndex(
        (m) => m.timestamp === aroundTs && m.role === aroundRole,
      );
    }
    if (focusIndex < 0) {
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < messages.length; i++) {
        const ts = messages[i]!.timestamp;
        if (ts == null) continue;
        const d = Math.abs(ts - aroundTs);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      focusIndex = best;
    }
  }

  const offset =
    focusIndex >= 0
      ? Math.max(0, focusIndex - Math.floor(limit / 2))
      : Number(c.req.query("offset") ?? 0);

  return c.json({
    total: messages.length,
    offset,
    messages: messages.slice(offset, offset + limit),
    focusIndex: focusIndex >= 0 ? focusIndex : undefined,
  });
});

sessionRoutes.get("/:provider/files/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  return c.json(await p.getTouchedFiles(c.req.param("id")));
});

sessionRoutes.get("/:provider/detail/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  const ref = await p.getSession(c.req.param("id"));
  if (!ref) return c.json({ error: "session not found" }, 404);
  return c.json(await enrichPilotMeta(ref));
});

/** Auto-assembled "blueprint" of everything a session used. */
sessionRoutes.get("/:provider/blueprint/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  const id = c.req.param("id");
  const [ref, transcript, files, children] = await Promise.all([
    p.getSession(id),
    (p.getTranscriptFull ?? p.getTranscript).call(p, id).catch(() => []),
    p.getTouchedFiles(id).catch(() => []),
    p.listChildren(id).catch(() => []),
  ]);

  interface Invocation {
    summary: string;
    /** Fuller body for the floating viewer (optional). */
    body?: string;
    ts?: number;
  }
  interface Usage {
    count: number;
    calls: Invocation[];
  }
  const MAX_CALLS = 60;
  const toolUsage = new Map<string, Usage>();
  const skillUsage = new Map<string, Usage>();
  let userTurns = 0;
  let assistantTurns = 0;

  const record = (
    map: Map<string, Usage>,
    key: string,
    summary: string,
    ts?: number,
    body?: string,
  ) => {
    if (!map.has(key)) map.set(key, { count: 0, calls: [] });
    const u = map.get(key)!;
    u.count += 1;
    if (u.calls.length < MAX_CALLS) u.calls.push({ summary, body, ts });
  };

  for (const m of transcript) {
    if (m.role === "user") {
      for (const pt of m.parts) {
        if (pt.type !== "text" || !pt.text) continue;
        userTurns++;
        // slash-command invocations recorded in the prompt envelope
        const cmd = /<command-name>\/?([\w:-]+)<\/command-name>/.exec(pt.text);
        if (cmd?.[1]) {
          const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(pt.text)?.[1]?.trim();
          record(skillUsage, cmd[1], args ? `/${cmd[1]} ${args}` : `/${cmd[1]}`, m.timestamp);
        }
        break;
      }
    }
    if (m.role === "assistant") assistantTurns++;
    for (const part of m.parts) {
      if (part.type !== "tool_use" || !part.toolName) continue;
      record(
        toolUsage,
        part.toolName,
        toolSummary(part.toolName, part.toolInput),
        m.timestamp,
        toolInvocationBody(part.toolName, part.toolInput),
      );
      if (part.toolName === "Skill" && part.toolInput && typeof part.toolInput === "object") {
        const input = part.toolInput as { skill?: unknown; args?: unknown };
        if (typeof input.skill === "string") {
          const skillBody =
            typeof input.args === "string" && input.args
              ? `Skill: ${input.skill}\n\nargs:\n${input.args}`
              : `Skill: ${input.skill}\n\ninvoked via Skill tool`;
          record(
            skillUsage,
            input.skill,
            typeof input.args === "string" && input.args
              ? `args: ${input.args}`
              : "invoked via Skill tool",
            m.timestamp,
            skillBody,
          );
        }
      }
    }
  }

  // ---- internals: context growth, compactions, thinking, errors ----
  const thinkingSamples: Invocation[] = [];
  let thinkingBlocks = 0;
  let thinkingChars = 0;
  let toolErrors = 0;
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  for (const m of transcript) {
    if (m.timestamp) {
      firstTs ??= m.timestamp;
      lastTs = m.timestamp;
    }
    for (const part of m.parts) {
      if (part.type === "thinking") {
        thinkingBlocks++;
        thinkingChars += part.text?.length ?? 0;
        if (thinkingSamples.length < MAX_CALLS && part.text) {
          const oneLine = part.text.replace(/\s+/g, " ").trim();
          thinkingSamples.push({
            summary: oneLine.length > 220 ? `${oneLine.slice(0, 220)}…` : oneLine,
            ts: m.timestamp,
          });
        }
      }
      if (part.type === "tool_result" && part.isError) toolErrors++;
    }
  }
  const { timeline, estimated: contextEstimated } = buildContextTimeline(transcript);
  let compactions = 0;
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1]!.context;
    const cur = timeline[i]!.context;
    if (prev > 20_000 && cur < prev * 0.55) compactions++;
  }
  const peakContext = timeline.reduce((a, t) => Math.max(a, t.context), 0);
  const lastContext = timeline.at(-1)?.context ?? 0;
  const MAX_POINTS = 120;
  const stride = Math.max(1, Math.ceil(timeline.length / MAX_POINTS));
  const sampled = timeline.filter((_, i) => i % stride === 0 || i === timeline.length - 1);

  // context payloads this session produced (extracted) or received (injected)
  const [allPayloads, allInjects] = await Promise.all([
    readPayloadMetas(),
    readInjects(),
  ]);
  const extractedContexts = allPayloads.filter(
    (p) => p.source.sessionId === id,
  );
  const injectedHashes = new Set(
    allInjects
      .filter((i) => (i.result?.sessionId ?? i.target.sessionId) === id)
      .map((i) => i.payloadHash),
  );
  const injectedContexts = allPayloads.filter((p) => injectedHashes.has(p.hash));

  const rulesFiles = [
    ...(await globalArtifacts()).map((a) => ({ ...a, scope: "global" })),
    ...(ref?.projectDir
      ? (await projectArtifacts(ref.projectDir)).map((a) => ({
          ...a,
          scope: "project",
        }))
      : []),
  ];

  return c.json({
    ref,
    rulesFiles,
    contexts: { extracted: extractedContexts, injected: injectedContexts },
    reasoning: {
      count: thinkingBlocks,
      chars: thinkingChars,
      samples: thinkingSamples,
    },
    internals: {
      timeline: sampled,
      peakContext,
      lastContext,
      contextEstimated,
      compactions,
      thinkingBlocks,
      thinkingChars,
      toolErrors,
      durationMs: firstTs && lastTs ? lastTs - firstTs : undefined,
    },
    stats: { userTurns, assistantTurns, messages: transcript.length },
    tools: [...toolUsage.entries()]
      .map(([name, u]) => ({ name, count: u.count, calls: u.calls }))
      .sort((a, b) => b.count - a.count),
    skills: [...skillUsage.entries()]
      .map(([name, u]) => ({ name, count: u.count, calls: u.calls }))
      .sort((a, b) => b.count - a.count),
    files,
    children,
  });
});

/** Per-prompt context growth for the interactive growth diagram */
sessionRoutes.get("/:provider/growth/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  const id = c.req.param("id");
  const [ref, transcript] = await Promise.all([
    p.getSession(id),
    (p.getTranscriptFull ?? p.getTranscript).call(p, id).catch(() => []),
  ]);
  if (!ref) return c.json({ error: "session not found" }, 404);
  const growth = buildContextGrowth(transcript);

  let thinkingBlocks = 0;
  let thinkingChars = 0;
  let toolErrors = 0;
  let userTurns = 0;
  let assistantTurns = 0;
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  for (const m of transcript) {
    if (m.timestamp) {
      firstTs ??= m.timestamp;
      lastTs = m.timestamp;
    }
    if (m.role === "user") {
      for (const pt of m.parts) {
        if (pt.type === "text" && pt.text) {
          userTurns++;
          break;
        }
      }
    }
    if (m.role === "assistant") assistantTurns++;
    for (const part of m.parts) {
      if (part.type === "thinking") {
        thinkingBlocks++;
        thinkingChars += part.text?.length ?? 0;
      }
      if (part.type === "tool_result" && part.isError) toolErrors++;
    }
  }
  const compactions = growth.steps.reduce((n, s) => n + (s.compacted ? 1 : 0), 0);

  return c.json({
    ref,
    ...growth,
    metrics: {
      messages: transcript.length,
      userTurns,
      assistantTurns,
      thinkingBlocks,
      thinkingChars,
      toolErrors,
      compactions,
      durationMs: firstTs && lastTs ? lastTs - firstTs : undefined,
    },
  });
});

/** The session's active thread rendered to markdown — the reconstructed model context. */
sessionRoutes.get("/:provider/context/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  const id = c.req.param("id");
  const messages = await p.getTranscript(id);
  const md = renderTranscript(messages, SESSION_CONTEXT_CONFIG);
  const preview = c.req.query("preview");
  if (preview === "1" || preview === "true") {
    const size = Buffer.byteLength(md, "utf8");
    const truncated = size > FILE_PREVIEW_MAX_BYTES;
    const content = truncated
      ? Buffer.from(md, "utf8").subarray(0, FILE_PREVIEW_MAX_BYTES).toString("utf8")
      : md;
    return c.json({
      name: `context-${id.replace(/[^\w.-]/g, "_").slice(0, 40)}.md`,
      size,
      truncated,
      previewMaxBytes: FILE_PREVIEW_MAX_BYTES,
      content,
    });
  }
  /** Write full context to ~/.config/threadle/tmp so the UI can open it in an editor. */
  if (c.req.query("materialize") === "1" || c.req.query("materialize") === "true") {
    const dir = path.join(threadleConfigDir(), "tmp");
    await fs.promises.mkdir(dir, { recursive: true });
    const provider = c.req.param("provider").replace(/[^\w.-]/g, "_");
    const safeId = id.replace(/[^\w.-]/g, "_").slice(0, 48);
    const file = path.join(dir, `context-${provider}-${safeId}.md`);
    await fs.promises.writeFile(file, md, "utf8");
    return c.json({ path: file, bytes: Buffer.byteLength(md, "utf8") });
  }
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="threadle-context-${id.replace(/[^\w.-]/g, "_").slice(0, 40)}.md"`,
  );
  return c.body(md);
});

/** Every thinking/reasoning block of the session, rendered to markdown. */
sessionRoutes.get("/:provider/reasoning/:id{.+}", async (c) => {
  const p = registry.get(c.req.param("provider"));
  const id = c.req.param("id");
  const messages = await (p.getTranscriptFull ?? p.getTranscript).call(p, id);
  const lines: string[] = ["# Reasoning log", ""];
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type !== "thinking" || !part.text) continue;
      const ts = m.timestamp
        ? new Date(m.timestamp).toISOString().replace("T", " ").slice(0, 19)
        : "";
      lines.push(`## thinking${ts ? ` — ${ts}` : ""}`, "", part.text, "");
    }
  }
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="threadle-reasoning-${id.replace(/[^\w.-]/g, "_").slice(0, 40)}.md"`,
  );
  return c.body(lines.join("\n"));
});

/**
 * Full tool / skill / reasoning invocation dump.
 * `?preview=1` returns a byte-capped JSON preview (same as context/files).
 * Without preview: markdown attachment of every invocation.
 *
 * Query: kind=tool|skill|reasoning · name=<tool or skill> (required except reasoning)
 */
sessionRoutes.get("/:provider/invocations/:id{.+}", async (c) => {
  const kindRaw = (c.req.query("kind") ?? "tool").toLowerCase();
  if (kindRaw !== "tool" && kindRaw !== "skill" && kindRaw !== "reasoning") {
    return c.json({ error: "kind must be tool, skill, or reasoning" }, 400);
  }
  const kind = kindRaw as InvocationKind;
  const name = (c.req.query("name") ?? "").trim();
  if (kind !== "reasoning" && !name) {
    return c.json({ error: "name is required for tool/skill invocations" }, 400);
  }

  const p = registry.get(c.req.param("provider"));
  const id = c.req.param("id");
  const messages = await (p.getTranscriptFull ?? p.getTranscript).call(p, id);
  const { md, count, title } = renderInvocationsMarkdown(
    messages,
    kind,
    kind === "reasoning" ? "reasoning" : name,
  );
  const safeTitle = title.replace(/[^\w.-]+/g, "_").slice(0, 48) || kind;
  const filename = `threadle-invocations-${kind}-${safeTitle}.md`;

  const preview = c.req.query("preview");
  if (preview === "1" || preview === "true") {
    const size = Buffer.byteLength(md, "utf8");
    const truncated = size > FILE_PREVIEW_MAX_BYTES;
    const content = truncated
      ? Buffer.from(md, "utf8").subarray(0, FILE_PREVIEW_MAX_BYTES).toString("utf8")
      : md;
    return c.json({
      name: filename,
      size,
      truncated,
      previewMaxBytes: FILE_PREVIEW_MAX_BYTES,
      count,
      content,
    });
  }

  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(md);
});

/**
 * Full observability bundle: blueprint + reconstructed context + reasoning +
 * meta for the session and every subagent run, as one JSON download.
 */
sessionRoutes.get("/:provider/bundle/:id{.+}", async (c) => {
  const providerId = c.req.param("provider");
  const id = c.req.param("id");
  const bundle = await buildSessionBundle(
    new URL(c.req.url).origin,
    providerId,
    id,
  );
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="threadle-bundle-${id.replace(/[^\w.-]/g, "_").slice(0, 40)}.json"`,
  );
  return c.body(JSON.stringify(bundle, null, 2));
});
