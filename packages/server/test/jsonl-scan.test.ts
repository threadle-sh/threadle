import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scanSession } from "../src/providers/claude-code/jsonl.js";

const lines = [
  {
    type: "assistant",
    timestamp: "2026-09-13T10:00:00.000Z",
    message: {
      role: "assistant",
      model: "claude-fable-5",
      usage: {
        input_tokens: 100,
        output_tokens: 2000,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 10_000,
        cache_creation: { ephemeral_5m_input_tokens: 4_000, ephemeral_1h_input_tokens: 6_000 },
      },
    },
  },
  {
    type: "assistant",
    timestamp: "2026-09-13T10:05:00.000Z",
    message: {
      role: "assistant",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 500, output_tokens: 20 },
    },
  },
  { type: "system", subtype: "turn_duration", durationMs: 40_000 },
  { type: "system", subtype: "turn_duration", durationMs: 20_000 },
  {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result" }] },
    toolUseResult: {
      structuredPatch: [{ lines: ["+one", "+two", "-gone", " ctx"] }],
    },
  },
  {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result" }] },
    toolUseResult: { type: "create", content: "a\nb\nc" },
  },
];

const file = path.join(os.tmpdir(), `threadle-scan-${process.pid}.jsonl`);
fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));

afterAll(() => fs.rmSync(file, { force: true }));

describe("scanSession /cost-parity fields", () => {
  it("collects per-model usage with the 1h cache-write split", async () => {
    const scan = await scanSession(file);
    expect(scan.usageByModel["claude-fable-5"]).toEqual({
      input: 100,
      output: 2000,
      cacheRead: 50_000,
      cacheWrite: 10_000,
      cacheWrite1h: 6_000,
    });
    expect(scan.usageByModel["claude-haiku-4-5"]).toEqual({
      input: 500,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
    });
    // session-level totals still sum across models
    expect(scan.tokensIn).toBe(600);
    expect(scan.tokensOut).toBe(2020);
  });

  it("sums turn durations and line churn", async () => {
    const scan = await scanSession(file);
    expect(scan.apiDurationMs).toBe(60_000);
    expect(scan.linesAdded).toBe(2 + 3); // patch hunks + created file lines
    expect(scan.linesRemoved).toBe(1);
  });
});
