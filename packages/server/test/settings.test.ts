import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "threadle-settings-"));
  process.env.THREADLE_CONFIG_DIR = dir;
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.THREADLE_CONFIG_DIR;
});

describe("settings appearance", () => {
  it("defaults to system and round-trips light/dark", async () => {
    const { readSettings } = await import("../src/routes/settings.js");
    const fresh = await readSettings();
    expect(fresh.appearance).toBe("system");

    const file = path.join(dir, "settings.json");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        editor: { mode: "vscode" },
        appearance: "light",
      }),
      "utf8",
    );
    expect((await readSettings()).appearance).toBe("light");

    await fs.promises.writeFile(
      file,
      JSON.stringify({
        editor: { mode: "vscode" },
        appearance: "dark",
      }),
      "utf8",
    );
    expect((await readSettings()).appearance).toBe("dark");

    await fs.promises.writeFile(
      file,
      JSON.stringify({
        editor: { mode: "vscode" },
        appearance: "nope",
      }),
      "utf8",
    );
    expect((await readSettings()).appearance).toBe("system");
  });

  it("PUT persists appearance via settings routes", async () => {
    const { settingsRoutes } = await import("../src/routes/settings.js");
    const put = await settingsRoutes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editor: { mode: "vscode" },
        appearance: "light",
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { appearance?: string };
    expect(body.appearance).toBe("light");

    const get = await settingsRoutes.request("/");
    const again = (await get.json()) as { appearance?: string };
    expect(again.appearance).toBe("light");
  });
});

describe("settings showExamples", () => {
  it("defaults to true and round-trips false", async () => {
    const { readSettings } = await import("../src/routes/settings.js");
    const fresh = await readSettings();
    expect(fresh.showExamples).not.toBe(false);

    const file = path.join(dir, "settings.json");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      file,
      JSON.stringify({
        editor: { mode: "vscode" },
        claudeBilling: "subscription",
        showExamples: false,
      }),
      "utf8",
    );
    const off = await readSettings();
    expect(off.showExamples).toBe(false);

    await fs.promises.writeFile(
      file,
      JSON.stringify({
        editor: { mode: "cursor" },
        showExamples: true,
      }),
      "utf8",
    );
    const on = await readSettings();
    expect(on.showExamples).toBe(true);
    expect(on.editor.mode).toBe("cursor");
  });

  it("PUT persists showExamples via settings routes", async () => {
    const { settingsRoutes } = await import("../src/routes/settings.js");
    const put = await settingsRoutes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editor: { mode: "zed" },
        showExamples: false,
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { showExamples?: boolean; editor: { mode: string } };
    expect(body.showExamples).toBe(false);
    expect(body.editor.mode).toBe("zed");

    const get = await settingsRoutes.request("/");
    const again = (await get.json()) as { showExamples?: boolean };
    expect(again.showExamples).toBe(false);
  });
});

describe("settings notifications", () => {
  it("defaults all notify kinds on and migrates desktopNotify:false", async () => {
    const { readSettings, parseNotifySettings } = await import("../src/routes/settings.js");
    const fresh = await readSettings();
    expect(fresh.notifications).toEqual({
      enabled: true,
      runFinished: true,
      approval: true,
      handoff: true,
    });

    expect(parseNotifySettings({ desktopNotify: false })).toMatchObject({ enabled: false });
    expect(
      parseNotifySettings({
        notifications: { enabled: true, runFinished: false, approval: true, handoff: false },
      }),
    ).toEqual({
      enabled: true,
      runFinished: false,
      approval: true,
      handoff: false,
    });
  });

  it("PUT persists per-kind notify prefs", async () => {
    const { settingsRoutes } = await import("../src/routes/settings.js");
    const put = await settingsRoutes.request("/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editor: { mode: "vscode" },
        notifications: {
          enabled: true,
          runFinished: false,
          approval: true,
          handoff: false,
        },
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as {
      notifications?: {
        enabled: boolean;
        runFinished: boolean;
        approval: boolean;
        handoff: boolean;
      };
    };
    expect(body.notifications).toEqual({
      enabled: true,
      runFinished: false,
      approval: true,
      handoff: false,
    });

    const get = await settingsRoutes.request("/");
    const again = (await get.json()) as typeof body;
    expect(again.notifications?.runFinished).toBe(false);
    expect(again.notifications?.handoff).toBe(false);
  });
});
