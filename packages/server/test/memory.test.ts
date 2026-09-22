import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let prevClaude: string | undefined;
let prevGrok: string | undefined;
let prevCodex: string | undefined;

function openWritableDb(dbPath: string): import("node:sqlite").DatabaseSync {
  const sqlite = process.getBuiltinModule(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(dbPath);
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-memory-"));
  prevClaude = process.env.CLAUDE_CONFIG_DIR;
  prevGrok = process.env.GROK_HOME;
  prevCodex = process.env.CODEX_HOME;

  process.env.CLAUDE_CONFIG_DIR = path.join(dir, "claude");
  process.env.GROK_HOME = path.join(dir, "grok");
  process.env.CODEX_HOME = path.join(dir, "codex");

  // Claude
  const mem = path.join(dir, "claude", "projects", "-Users-demo-app", "memory");
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(path.join(mem, "MEMORY.md"), "# Memory index\n\n- [topic](topic-a.md)\n");
  fs.writeFileSync(path.join(mem, "topic-a.md"), "# topic a\n\nnotes\n");
  fs.mkdirSync(path.join(dir, "claude", "projects", "-Users-demo-empty"), {
    recursive: true,
  });

  // Grok
  const globalMem = path.join(dir, "grok", "memory-v2", "global");
  fs.mkdirSync(path.join(globalMem, "topics"), { recursive: true });
  fs.writeFileSync(path.join(globalMem, "MEMORY.md"), "# Global\n");
  const ws = path.join(dir, "grok", "memory-v2", "workspaces", "demo-ws-abc12345");
  fs.mkdirSync(path.join(ws, "topics"), { recursive: true });
  fs.mkdirSync(path.join(ws, "archive", "dream_1"), { recursive: true });
  fs.writeFileSync(path.join(ws, "MEMORY.md"), "# WS\n");
  fs.writeFileSync(path.join(ws, "topics", "alpha.md"), "# alpha\n");
  fs.writeFileSync(path.join(ws, "archive", "dream_1", "note.md"), "# archived\n");
  // session prompt_context → scope
  const sess = path.join(
    dir,
    "grok",
    "sessions",
    encodeURIComponent("/Users/demo/proj"),
    "sess-1",
  );
  fs.mkdirSync(sess, { recursive: true });
  fs.writeFileSync(
    path.join(sess, "prompt_context.json"),
    JSON.stringify({
      memory_workspace_path: ws,
    }),
  );

  // Codex FS
  const codexMem = path.join(dir, "codex", "memories");
  fs.mkdirSync(path.join(codexMem, "rollout_summaries"), { recursive: true });
  fs.writeFileSync(path.join(codexMem, "MEMORY.md"), "# Codex memory\n");
  fs.writeFileSync(
    path.join(codexMem, "rollout_summaries", "r1.md"),
    "# rollout\n",
  );

  // Codex stage1 sqlite
  const dbPath = path.join(dir, "codex", "memories_1.sqlite");
  const db = openWritableDb(dbPath);
  db.exec(`
    CREATE TABLE stage1_outputs (
      thread_id TEXT PRIMARY KEY,
      source_updated_at INTEGER NOT NULL,
      raw_memory TEXT NOT NULL,
      rollout_summary TEXT NOT NULL,
      rollout_slug TEXT,
      generated_at INTEGER NOT NULL,
      usage_count INTEGER,
      last_usage INTEGER,
      selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
      selected_for_phase2_source_updated_at INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO stage1_outputs
     (thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "thread-aaa-111",
    1_700_000_000,
    "Remember to use vitest.",
    "Session did tests.",
    "my-rollout",
    1_700_000_100,
  );
  db.close();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (prevClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevClaude;
  if (prevGrok === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = prevGrok;
  if (prevCodex === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevCodex;
});

describe("listClaudeMemory", () => {
  it("lists MEMORY.md + topic files; skips projects without memory/", async () => {
    const { listClaudeMemory } = await import("../src/routes/memory.js");
    const items = await listClaudeMemory();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.provider === "claude-code")).toBe(true);
    expect(items.map((i) => i.name).sort()).toEqual(["MEMORY.md", "topic-a.md"]);
    const index = items.find((i) => i.kind === "index");
    expect(index?.slug).toBe("-Users-demo-app");
    expect(index?.scope).toBe("/Users/demo/app");
    expect(index?.bytes).toBeGreaterThan(0);
    expect(items.find((i) => i.name === "topic-a.md")?.kind).toBe("topic");
  });

  it("returns [] when projects dir is missing", async () => {
    const missing = path.join(dir, "no-such-claude");
    process.env.CLAUDE_CONFIG_DIR = missing;
    try {
      const { listClaudeMemory } = await import("../src/routes/memory.js");
      expect(await listClaudeMemory()).toEqual([]);
    } finally {
      process.env.CLAUDE_CONFIG_DIR = path.join(dir, "claude");
    }
  });
});

describe("listGrokMemory", () => {
  it("lists global + workspace md with kinds and resolved scope", async () => {
    const { listGrokMemory } = await import("../src/routes/memory.js");
    const items = await listGrokMemory();
    expect(items.some((i) => i.slug === "global" && i.kind === "index")).toBe(true);
    const topic = items.find((i) => i.name === "topics/alpha.md");
    expect(topic?.provider).toBe("grok");
    expect(topic?.kind).toBe("topic");
    expect(topic?.scope).toBe("/Users/demo/proj");
    const arch = items.find((i) => i.kind === "archive");
    expect(arch?.name).toMatch(/^archive\//);
  });
});

describe("listCodexMemory", () => {
  it("lists FS memories and stage1 rows", async () => {
    const { listCodexMemory, CODEX_MEMORY_PREFIX } = await import(
      "../src/routes/memory.js"
    );
    const items = await listCodexMemory();
    expect(items.some((i) => i.name === "MEMORY.md" && i.slug === "memories")).toBe(
      true,
    );
    expect(
      items.some((i) => i.name === "rollout_summaries/r1.md" && i.kind === "topic"),
    ).toBe(true);
    const stage1 = items.find((i) => i.kind === "stage1");
    expect(stage1?.slug).toBe("thread-aaa-111");
    expect(stage1?.path).toBe(`${CODEX_MEMORY_PREFIX}thread-aaa-111`);
    expect(stage1?.name).toBe("my-rollout.stage1.md");
    expect(stage1?.mtime).toBe(1_700_000_100 * 1000);
  });
});

describe("listAllMemory + content", () => {
  it("merges all providers", async () => {
    const { listAllMemory } = await import("../src/routes/memory.js");
    const items = await listAllMemory();
    const providers = new Set(items.map((i) => i.provider));
    expect(providers.has("claude-code")).toBe(true);
    expect(providers.has("grok")).toBe(true);
    expect(providers.has("codex")).toBe(true);
  });

  it("reads stage1 content", async () => {
    const { readCodexStage1Content } = await import("../src/routes/memory.js");
    const body = readCodexStage1Content("thread-aaa-111");
    expect(body?.content).toMatch(/Remember to use vitest/);
    expect(body?.content).toMatch(/Rollout summary/);
    expect(body?.content).toMatch(/Session did tests/);
    expect(readCodexStage1Content("missing")).toBeUndefined();
  });
});
