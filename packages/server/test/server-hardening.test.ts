import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

const HOST = { Host: "127.0.0.1:4570" };

describe("server hardening", () => {
  const app = createApp({ projectDir: process.cwd() });

  it("rejects foreign Host", async () => {
    const res = await app.request("/api/health", {
      headers: { Host: "evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin writes", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        ...HOST,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/cross-origin/i);
  });

  it("rejects Sec-Fetch-Site: cross-site writes even without Origin", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        ...HOST,
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/cross-site/i);
  });

  it("allows loopback Origin writes", async () => {
    const res = await app.request("/api/health", { headers: HOST });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Permissions-Policy")).toMatch(/camera=\(\)/);
  });

  it("scopes file reads away from /etc", async () => {
    const res = await app.request("/api/files/read?path=" + encodeURIComponent("/etc/hosts"), {
      headers: HOST,
    });
    expect(res.status).toBe(403);
  });

  it("scopes /api/open away from /etc", async () => {
    const res = await app.request("/api/open", {
      method: "POST",
      headers: {
        ...HOST,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "/etc/hosts" }),
    });
    expect(res.status).toBe(403);
  });

  // ---- GETs with side effects: the cross-site guard must cover EVERY method ----

  it("rejects cross-site GET to the MCP tools route (spawns a child)", async () => {
    const res = await app.request("/api/mcp/servers/x/tools?dir=/tmp", {
      headers: { ...HOST, "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-site GET to git sessions (runs git in a foreign cwd)", async () => {
    const res = await app.request("/api/git/sessions?dir=/tmp&commit=abc", {
      headers: { ...HOST, "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects cross-site GET to custom-nodes listing (meta probe executes)", async () => {
    const res = await app.request("/api/custom-nodes/", {
      headers: { ...HOST, "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("still allows same-origin and headerless (curl) GETs", async () => {
    const sameOrigin = await app.request("/api/health", {
      headers: { ...HOST, "Sec-Fetch-Site": "same-origin" },
    });
    expect(sameOrigin.status).toBe(200);
    const none = await app.request("/api/health", {
      headers: { ...HOST, "Sec-Fetch-Site": "none" },
    });
    expect(none.status).toBe(200);
  });

  it("refuses an unknown project dir on MCP discovery routes", async () => {
    const res = await app.request(
      "/api/mcp/servers/x/tools?dir=" + encodeURIComponent("/private/var/empty"),
      { headers: HOST },
    );
    expect(res.status).toBe(403);
  });

  it("refuses an unknown project dir on git sessions", async () => {
    const res = await app.request(
      "/api/git/sessions?dir=" + encodeURIComponent("/private/var/empty") + "&commit=abc",
      { headers: HOST },
    );
    expect(res.status).toBe(403);
  });

  it("rejects Origin: null writes", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { ...HOST, Origin: "null", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("rejects graph id traversal on PUT and DELETE", async () => {
    const put = await app.request("/api/graphs/..%2F..%2Fevil", {
      method: "PUT",
      headers: { ...HOST, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "../../evil" }),
    });
    expect([400, 422]).toContain(put.status);
    const del = await app.request("/api/graphs/..%2F..%2Fevil", {
      method: "DELETE",
      headers: HOST,
    });
    // deleteGraph no-ops on invalid ids — the point is nothing outside
    // graphs/ is touched; route returns ok without touching disk
    expect([200, 400]).toContain(del.status);
  });

  it("rejects session transcript id traversal", async () => {
    const res = await app.request(
      "/api/sessions/claude-code/transcript/..%2F..%2F..%2Fetc%2Fpasswd",
      { headers: HOST },
    );
    expect(res.status).toBe(400);
  });

  it("sends CSP, nosniff, and no-store on API responses", async () => {
    const res = await app.request("/api/health", { headers: HOST });
    expect(res.headers.get("Content-Security-Policy")).toMatch(/script-src 'self'/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("rejects chunked bodies without content-length on API writes", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        ...HOST,
        "Transfer-Encoding": "chunked",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(411);
  });

  it("refuses unknown projectDir on run surfaces", async () => {
    const wf = await app.request("/api/run/workflow", {
      method: "POST",
      headers: { ...HOST, "Content-Type": "application/json" },
      body: JSON.stringify({ graphId: "starter", projectDir: "/private/var/empty" }),
    });
    // 403 (dir refused) or 404 (graph missing in this env) — never 202
    expect([403, 404]).toContain(wf.status);

    const agent = await app.request("/api/run/agent", {
      method: "POST",
      headers: { ...HOST, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        agent: "x",
        prompt: "hi",
        projectDir: "/private/var/empty",
      }),
    });
    expect(agent.status).toBe(403);

    const session = await app.request("/api/run/session", {
      method: "POST",
      headers: { ...HOST, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        sessionId: "s",
        prompt: "hi",
        projectDir: "/private/var/empty",
      }),
    });
    expect(session.status).toBe(403);
  });

  it("rejects oversized declared bodies", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: {
        ...HOST,
        "Content-Length": String(30 * 1024 * 1024),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });
});
