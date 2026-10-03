import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

const HOST = { Host: "127.0.0.1:4570" };

afterEach(() => {
  delete process.env.THREADLE_VIEWER_URL;
  delete process.env.THREADLE_WORKFLOWS_URL;
});

describe("viewer / workflows apps", () => {
  it("health reports the ui mode and where both apps live", async () => {
    process.env.THREADLE_WORKFLOWS_URL = "http://localhost:5174/";
    const viewer = createApp({ projectDir: process.cwd() });
    const v = (await (await viewer.request("/api/health", { headers: HOST })).json()) as Record<string, unknown>;
    expect(v.ui).toBe("viewer");
    expect(v.viewerUrl).toBe("http://127.0.0.1:4570");
    expect(v.workflowsUrl).toBe("http://localhost:5174");

    const editor = createApp({ projectDir: process.cwd(), ui: "workflows" });
    const w = (await (await editor.request("/api/health", { headers: HOST })).json()) as Record<string, unknown>;
    expect(w.ui).toBe("workflows");
  });

  it("/api/apps marks itself up and probes the other app", async () => {
    // nothing listens on this port → the workflows app is reported down
    process.env.THREADLE_WORKFLOWS_URL = "http://127.0.0.1:9";
    const viewer = createApp({ projectDir: process.cwd() });
    const res = await viewer.request("/api/apps", { headers: HOST });
    const body = (await res.json()) as { viewer: { up: boolean }; workflows: { up: boolean; url: string } };
    expect(body.viewer.up).toBe(true);
    expect(body.workflows).toEqual({ url: "http://127.0.0.1:9", up: false });
  });

  it("unknown API paths 404 instead of falling through to the SPA", async () => {
    const app = createApp({ projectDir: process.cwd(), workflows: false });
    const res = await app.request("/api/graphs", { headers: HOST });
    expect(res.status).toBe(404);
  });
});
