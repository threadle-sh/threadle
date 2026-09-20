import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSession } from "../src/providers/claude-code/jsonl.js";
import { readTouchedFiles } from "../src/providers/claude-code/files.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-claude-plan-"));
const planPath = path.join(tmp, ".claude", "plans", "demo-plan.md");
const transcriptPath = path.join(tmp, "session.jsonl");

beforeAll(() => {
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, "# demo plan\n\n- step one\n");
  const lines = [
    {
      type: "permission-mode",
      permissionMode: "plan",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    {
      type: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        model: "claude-test",
        content: [
          {
            type: "tool_use",
            name: "ExitPlanMode",
            input: { plan: "# demo", planFilePath: planPath },
          },
        ],
      },
    },
  ];
  fs.writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("claude plan artifacts", () => {
  it("scanSession captures planFilePath + permissionMode", async () => {
    const scan = await scanSession(transcriptPath);
    expect(scan.permissionMode).toBe("plan");
    expect(scan.planFilePath).toBe(planPath);
  });

  it("touched files include ExitPlanMode planFilePath", async () => {
    const files = await readTouchedFiles(transcriptPath);
    expect(files.some((f) => f.path === planPath)).toBe(true);
  });
});
