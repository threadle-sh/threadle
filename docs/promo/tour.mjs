import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4599";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = dirname(fileURLToPath(import.meta.url));

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: DIR + "/rec", size: { width: 1600, height: 900 } },
});
const page = await ctx.newPage();

// fake cursor + caption bar survive navigations
await page.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cur";
    c.style.cssText = "position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;border:2px solid #fafafa;background:rgba(250,250,250,.25);pointer-events:none;transform:translate(-50%,-50%);transition:left .05s linear,top .05s linear;left:-40px;top:-40px";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    const cap = document.createElement("div");
    cap.id = "__cap";
    cap.style.cssText = "position:fixed;z-index:99998;left:50%;bottom:46px;transform:translateX(-50%);background:rgba(10,10,12,.92);border:1px solid #2d2e34;border-radius:8px;padding:10px 22px;color:#f2f2f3;font:600 17px ui-monospace,Menlo,monospace;letter-spacing:.03em;opacity:0;transition:opacity .4s";
    document.body.appendChild(cap);
  });
});
async function caption(text) {
  await page.evaluate((t) => {
    const el = document.getElementById("__cap");
    if (!el) return;
    if (!t) { el.style.opacity = "0"; return; }
    el.textContent = t;
    el.style.opacity = "1";
  }, text);
}
const glide = async (x, y, steps = 25) => page.mouse.move(x, y, { steps });
const pause = (ms) => page.waitForTimeout(ms);

// ---- intro
await page.goto("file://" + DIR + "/intro.html");
await pause(3500);

// ---- workflows canvas
await page.goto(BASE + "/graph/784d1dbe", { waitUntil: "domcontentloaded" });
await pause(2200);
await caption("Wire agents, sessions and context on one canvas");
await glide(900, 400); await pause(600);
await glide(1180, 550, 35); await pause(900);
// hover a node
await glide(1210, 548); await pause(1200);
await caption("Sub-workflows collapse into linked frames");
const grp = await page.locator(".vue-flow__node-group").boundingBox();
if (grp) { await glide(grp.x + 120, grp.y + 14, 30); await pause(1400); }
// right-click add menu
await caption("Right-click: every node, agent, session and saved context");
await page.mouse.click(760, 660, { button: "right" });
await pause(2100);
await page.keyboard.press("Escape");
await pause(400);

// ---- sessions
await page.goto(BASE + "/?view=sessions", { waitUntil: "domcontentloaded" });
await pause(1500);
await caption("Every Claude Code, opencode, Cursor, and Antigravity session — live");
const row = await page.locator(".sess-row").first().boundingBox();
await glide(row.x + 200, row.y + 20, 30);
await page.locator(".sess-row").first().click();
await pause(2600);
await caption("Tokens, cache economics, context window, compactions");
await glide(1380, 700, 30);
await pause(2200);

// ---- blueprint
await page.locator(".vsc-btn", { hasText: "blueprint" }).first().click();
await pause(2600);
await caption("Session blueprints: tools, skills, files, reasoning, subagents");
await glide(1000, 450, 40); await pause(2400);

// ---- lineage
await page.goto(BASE + "/lineage", { waitUntil: "domcontentloaded" });
await pause(2000);
await caption("Context lineage — watch context flow between tools");
await pause(1200);
await page.locator(".lin-search").fill("finding");
await pause(1600);
const pl = await page.locator(".lin-payload").first().boundingBox();
if (pl) { await glide(pl.x + 100, pl.y + 20, 25); await page.locator(".lin-payload").first().click(); }
await pause(2300);

// ---- timeline
await page.goto(BASE + "/timeline", { waitUntil: "domcontentloaded" });
await pause(2200);
await caption("Your whole agent history on one clock");
await glide(900, 400, 30);
await pause(1000);
// drag back in time
await page.mouse.move(900, 600); await page.mouse.down();
await glide(1250, 600, 30); await page.mouse.up();
await pause(1600);

// ---- library
await page.goto(BASE + "/?view=library", { waitUntil: "domcontentloaded" });
await pause(1800);
await caption("A library of reusable context — tag it, drag it into any pipeline");
const lr = await page.locator(".lib-row").first().boundingBox();
if (lr) { await glide(lr.x + 200, lr.y + 20, 25); await page.locator(".lib-row").first().click(); }
await pause(2400);

// ---- statistics
await page.goto(BASE + "/?view=usage", { waitUntil: "domcontentloaded" });
await pause(2000);
await caption("Spend, cache hit-rates and real model prices");
await glide(800, 500, 30);
await pause(1400);
await page.mouse.wheel(0, 700);
await pause(2000);

// ---- outro
await caption("");
await page.goto("file://" + DIR + "/outro.html");
await pause(4000);

await ctx.close();
await b.close();
console.log("recorded");
