/**
 * When the repo's golden fixtures are on disk (dev checkout / CI),
 * `threadle check --providers` parses one sample per provider so known
 * record types still normalize and unknown types skip without throwing.
 *
 * Published `threadle` packages omit `test/fixtures` — those rows skip.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSession } from "../claude-code/jsonl.js";
import { readCursorTranscript } from "../cursor/jsonl.js";
import { readCodexTranscript } from "../codex/jsonl.js";
import { readAntigravityTranscript } from "../antigravity/jsonl.js";
import { _resetDbForTests } from "../opencode/db.js";
import { readOpencodeTranscript } from "../opencode/normalize.js";
import { discoverSessions } from "../grok/discover.js";
import { readGrokTranscript } from "../grok/transcript.js";
import {
  discoverSessions as discoverMuseSessions,
} from "../muse/discover.js";
import { readMuseTranscript } from "../muse/transcript.js";

export interface FixtureProbeResult {
  id: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
}

/** Resolve `packages/server/test/fixtures/providers` from dist/ or src/. */
export function goldenFixturesRoot(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // tsup bundle: dist/cli.js
    path.resolve(here, "../test/fixtures/providers"),
    // src/providers/freshness/fixtures.ts (tsx)
    path.resolve(here, "../../../test/fixtures/providers"),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function fixture(root: string, ...parts: string[]): string {
  return path.join(root, ...parts);
}

async function probeClaude(root: string): Promise<FixtureProbeResult> {
  const file = fixture(root, "claude-code", "session.jsonl");
  const scan = await scanSession(file);
  if (scan.messageCount < 3) {
    return {
      id: "fixture:claude-code",
      ok: false,
      skipped: false,
      detail: `${file} — expected ≥3 messages, got ${scan.messageCount}`,
    };
  }
  return {
    id: "fixture:claude-code",
    ok: true,
    skipped: false,
    detail: `${file} · ${scan.messageCount} msgs · model ${scan.model ?? "?"}`,
  };
}

async function probeCursor(root: string): Promise<FixtureProbeResult> {
  const file = fixture(root, "cursor", "transcript.jsonl");
  const msgs = await readCursorTranscript(file);
  if (msgs.length < 2) {
    return {
      id: "fixture:cursor",
      ok: false,
      skipped: false,
      detail: `${file} — expected ≥2 messages, got ${msgs.length}`,
    };
  }
  return {
    id: "fixture:cursor",
    ok: true,
    skipped: false,
    detail: `${file} · ${msgs.length} msgs`,
  };
}

async function probeCodex(root: string): Promise<FixtureProbeResult> {
  const file = fixture(root, "codex", "rollout.jsonl");
  const msgs = await readCodexTranscript(file);
  if (msgs.length < 2) {
    return {
      id: "fixture:codex",
      ok: false,
      skipped: false,
      detail: `${file} — expected ≥2 messages, got ${msgs.length}`,
    };
  }
  return {
    id: "fixture:codex",
    ok: true,
    skipped: false,
    detail: `${file} · ${msgs.length} msgs`,
  };
}

async function probeAntigravity(root: string): Promise<FixtureProbeResult> {
  const file = fixture(root, "antigravity", "transcript_full.jsonl");
  const msgs = await readAntigravityTranscript(file);
  if (msgs.length < 2) {
    return {
      id: "fixture:antigravity",
      ok: false,
      skipped: false,
      detail: `${file} — expected ≥2 messages, got ${msgs.length}`,
    };
  }
  return {
    id: "fixture:antigravity",
    ok: true,
    skipped: false,
    detail: `${file} · ${msgs.length} msgs`,
  };
}

async function probeOpencode(root: string): Promise<FixtureProbeResult> {
  const rawPath = fixture(root, "opencode", "session.json");
  const prev = process.env.OPENCODE_DATA_DIR;
  let tmpDir: string | undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(rawPath, "utf8")) as {
      sessionId: string;
      directory: string;
      title: string;
      messages: Array<{
        id: string;
        data: Record<string, unknown>;
        parts: Array<Record<string, unknown>>;
      }>;
    };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-oc-check-"));
    process.env.OPENCODE_DATA_DIR = tmpDir;
    _resetDbForTests();

    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
    const dbPath = path.join(tmpDir, "opencode.db");
    const db = new sqlite.DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, slug TEXT, title TEXT, directory TEXT, parent_id TEXT,
        agent TEXT, model TEXT, cost REAL, version TEXT, share_url TEXT,
        summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
        tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
        tokens_cache_read INTEGER, tokens_cache_write INTEGER,
        time_created INTEGER, time_updated INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER
      );
      CREATE TABLE part (
        id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, session_id TEXT, data TEXT
      );
    `);
    db.prepare(
      `INSERT INTO session (id, title, directory, parent_id, agent, time_created, time_updated)
       VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
    ).run(raw.sessionId, raw.title, raw.directory, 1726400000000, 1726400001000);
    for (const m of raw.messages) {
      db.prepare(
        `INSERT INTO message (id, session_id, data, time_created) VALUES (?, ?, ?, ?)`,
      ).run(
        m.id,
        raw.sessionId,
        JSON.stringify(m.data),
        (m.data.time as { created?: number } | undefined)?.created ?? 0,
      );
      for (const p of m.parts) {
        db.prepare(
          `INSERT INTO part (message_id, session_id, data) VALUES (?, ?, ?)`,
        ).run(m.id, raw.sessionId, JSON.stringify(p));
      }
    }
    db.close();

    const msgs = await readOpencodeTranscript(raw.sessionId);
    if (msgs.length < 2) {
      return {
        id: "fixture:opencode",
        ok: false,
        skipped: false,
        detail: `${rawPath} — expected ≥2 messages, got ${msgs.length}`,
      };
    }
    return {
      id: "fixture:opencode",
      ok: true,
      skipped: false,
      detail: `${rawPath} · ${msgs.length} msgs`,
    };
  } finally {
    _resetDbForTests();
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function probeGrok(root: string): Promise<FixtureProbeResult> {
  const grokHome = fixture(root, "grok");
  const planId = "01a0b4cb-89b1-7272-9175-a4b4e5ebd857";
  const prev = process.env.GROK_HOME;
  try {
    process.env.GROK_HOME = grokHome;
    const refs = await discoverSessions();
    if (refs.length < 3) {
      return {
        id: "fixture:grok",
        ok: false,
        skipped: false,
        detail: `${grokHome} — expected ≥3 sessions, got ${refs.length}`,
      };
    }
    const msgs = await readGrokTranscript(planId);
    const plan = refs.find((r) => r.id === planId);
    if (!plan?.meta?.planPath) {
      return {
        id: "fixture:grok",
        ok: false,
        skipped: false,
        detail: `${grokHome} — plan session missing meta.planPath`,
      };
    }
    if (msgs.length < 4) {
      return {
        id: "fixture:grok",
        ok: false,
        skipped: false,
        detail: `${grokHome} — expected ≥4 transcript msgs, got ${msgs.length}`,
      };
    }
    return {
      id: "fixture:grok",
      ok: true,
      skipped: false,
      detail: `${grokHome} · ${refs.length} sessions · plan.md · ${msgs.length} msgs`,
    };
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
  }
}

async function probeMuse(root: string): Promise<FixtureProbeResult> {
  const museShare = fixture(root, "muse");
  const sessionId = "01a0ce3e-daea-76f0-99fc-d53076374955";
  const prev = process.env.MUSE_DATA_DIR;
  try {
    process.env.MUSE_DATA_DIR = museShare;
    const refs = await discoverMuseSessions();
    if (refs.length < 1) {
      return {
        id: "fixture:muse",
        ok: false,
        skipped: false,
        detail: `${museShare} — expected ≥1 session, got ${refs.length}`,
      };
    }
    const msgs = await readMuseTranscript(sessionId);
    if (msgs.length < 2) {
      return {
        id: "fixture:muse",
        ok: false,
        skipped: false,
        detail: `${museShare} — expected ≥2 transcript msgs, got ${msgs.length}`,
      };
    }
    return {
      id: "fixture:muse",
      ok: true,
      skipped: false,
      detail: `${museShare} · ${refs.length} sessions · ${msgs.length} msgs`,
    };
  } finally {
    if (prev === undefined) delete process.env.MUSE_DATA_DIR;
    else process.env.MUSE_DATA_DIR = prev;
  }
}

/**
 * Parse every golden provider fixture. Missing fixture tree → all skipped.
 * Failures (parse/shape) set ok=false (not skipped).
 */
export async function probeGoldenFixtures(): Promise<FixtureProbeResult[]> {
  const root = goldenFixturesRoot();
  if (!root) {
    return [
      {
        id: "fixture:all",
        ok: true,
        skipped: true,
        detail: "golden fixtures not shipped in this install — skip",
      },
    ];
  }

  const probes: Array<() => Promise<FixtureProbeResult>> = [
    () => probeClaude(root),
    () => probeCursor(root),
    () => probeCodex(root),
    () => probeAntigravity(root),
    () => probeOpencode(root),
    () => probeGrok(root),
    () => probeMuse(root),
  ];

  const out: FixtureProbeResult[] = [];
  for (const run of probes) {
    try {
      out.push(await run());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.push({
        id: "fixture:error",
        ok: false,
        skipped: false,
        detail: msg,
      });
    }
  }
  return out;
}
