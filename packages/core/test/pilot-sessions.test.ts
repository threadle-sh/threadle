import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("pilot-sessions store", () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-pilot-"));
    prev = process.env.THREADLE_CONFIG_DIR;
    process.env.THREADLE_CONFIG_DIR = tmp;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.THREADLE_CONFIG_DIR;
    else process.env.THREADLE_CONFIG_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("marks and lists pilot sessions idempotently", async () => {
    const { markPilotSession, readPilotSessionKeys, listPilotSessions } =
      await import("../src/pilot-sessions/store.js");

    await markPilotSession({
      provider: "muse",
      sessionId: "sess-1",
      caseId: "muse:default",
    });
    await markPilotSession({
      provider: "muse",
      sessionId: "sess-1",
      caseId: "muse:default",
    });
    await markPilotSession({ provider: "cursor", sessionId: "sess-2" });

    const keys = await readPilotSessionKeys();
    expect(keys.has("muse:sess-1")).toBe(true);
    expect(keys.has("cursor:sess-2")).toBe(true);
    expect(keys.size).toBe(2);

    const list = await listPilotSessions();
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.sessionId === "sess-1")?.caseId).toBe("muse:default");
  });
});
