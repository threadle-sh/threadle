import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const executeWorkflow = vi.fn(async () => ({ outputs: 0, outputTexts: [] }));

vi.mock("../src/workflows/executor.js", () => ({
  executeWorkflow: (...args: unknown[]) => executeWorkflow(...args),
}));

vi.mock("../src/graphs/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/graphs/store.js")>();
  return {
    ...actual,
    readGraph: async (id: string) =>
      id === "g-ok"
        ? {
            id: "g-ok",
            name: "ok",
            schemaVersion: 1 as const,
            kind: "workflow" as const,
            createdAt: 0,
            updatedAt: 0,
            nodes: [
              {
                id: "p1",
                type: "prompt" as const,
                position: { x: 0, y: 0 },
                data: { type: "prompt" as const, text: "hi" },
              },
            ],
            edges: [],
          }
        : undefined,
  };
});

import {
  cronMatches,
  parseTriggersJson,
  validateCron,
} from "../src/triggers/schema.js";
import {
  __setTriggersForTest,
  __tickCronForTest,
} from "../src/triggers/index.js";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-trig-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("parseTriggersJson", () => {
  it("accepts cron + watch triggers", () => {
    const file = parseTriggersJson({
      triggers: [
        {
          id: "nightly",
          graphId: "g1",
          kind: "cron",
          cron: "0 2 * * *",
          approveAll: true,
        },
        {
          id: "watch-src",
          graphId: "g2",
          kind: "watch",
          paths: ["src/**"],
          projectDir: "/tmp/proj",
        },
      ],
    });
    expect(file.triggers).toHaveLength(2);
    expect(file.triggers[0]!.cron).toBe("0 2 * * *");
    expect(file.triggers[1]!.paths).toEqual(["src/**"]);
  });

  it("rejects bad kind / missing cron", () => {
    expect(() =>
      parseTriggersJson({
        triggers: [{ id: "x", graphId: "g", kind: "cron" }],
      }),
    ).toThrow(/cron/);
    expect(() =>
      parseTriggersJson({
        triggers: [{ id: "x", graphId: "g", kind: "nope" }],
      }),
    ).toThrow(/kind/);
  });

  it("validateCron requires 5 fields", () => {
    expect(() => validateCron("* * *")).toThrow(/5 fields/);
    expect(() => validateCron("*/5 * * * *")).not.toThrow();
  });
});

describe("cronMatches", () => {
  it("matches every-minute star", () => {
    expect(cronMatches("* * * * *", new Date("2024-01-15T10:30:00"))).toBe(true);
  });

  it("matches minute step", () => {
    expect(cronMatches("*/5 * * * *", new Date("2024-01-15T10:30:00"))).toBe(true);
    expect(cronMatches("*/5 * * * *", new Date("2024-01-15T10:31:00"))).toBe(false);
  });

  it("matches fixed hour", () => {
    expect(cronMatches("0 2 * * *", new Date("2024-01-15T02:00:00"))).toBe(true);
    expect(cronMatches("0 2 * * *", new Date("2024-01-15T03:00:00"))).toBe(false);
  });
});

describe("cron tick fires once", () => {
  beforeEach(() => {
    executeWorkflow.mockClear();
    __setTriggersForTest({
      triggers: [
        {
          id: "once",
          graphId: "g-ok",
          kind: "cron",
          cron: "* * * * *",
          approveAll: true,
          projectDir: dir,
        },
      ],
    });
  });

  afterEach(() => {
    __setTriggersForTest({ triggers: [] });
  });

  it("fires executeWorkflow once per minute key", async () => {
    const now = new Date("2024-06-01T12:00:00");
    __tickCronForTest(now);
    __tickCronForTest(now);
    await vi.waitFor(() => expect(executeWorkflow).toHaveBeenCalledTimes(1));
    expect(executeWorkflow.mock.calls[0]![0]).toMatchObject({
      graphId: "g-ok",
      approveAll: true,
    });
  });
});
