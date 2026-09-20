# Security model

threadle is a **local-first** tool. The server binds to `127.0.0.1` only. The threat model is same-machine misuse and hostile content already on disk (transcripts, packs, MCP configs) — not remote anonymous attackers on the public internet.

This page is the durable story. The **Security** view in the UI is a posture dashboard (elevated sessions, elevated agent-defs, live sessions), not a policy encyclopedia.

## What we do

- **Loopback only** — bind `127.0.0.1`; foreign `Host` headers are rejected (DNS-rebinding guard).
- **CSRF on writes** — state-changing requests must come from a loopback Origin when present; `Sec-Fetch-Site: cross-site` is refused even when Origin is absent. Missing Origin remains allowed for CLI/curl.
- **Browser lockdown** — responses ship CSP (`script-src 'self'`), nosniff, no-referrer, deny-framing, COOP, Permissions-Policy; request bodies are size-capped; `/api/run` and `/api/inject` are rate-limited.
- **Scoped file access** — in-app reads and `open` only under the project dir, `~/.config/threadle`, discovered provider stores, and session project dirs — not `~/.ssh`, `/etc`, or arbitrary home paths.
- **Read-only agent storage** — parsers never write Claude / opencode / Cursor / Antigravity / Codex / Copilot / Grok stores. Runs and injections go through each tool’s CLI or HTTP surface as argv arrays (no shell strings).
- **Custom nodes** — only manifests you placed under `~/.config/threadle/nodes`; argv-only, cwd-scoped, time- and output-capped, minimal env allowlist (`env: inherit` is an explicit opt-in).
- **MCP server** — publish allowlist defaults to empty (none); `*` / `null` publishes all. Gated graphs (approval / live handoff) must run in the UI with splice — MCP will not auto-approve. Nested threadle MCP recursion is refused.
- **Detached park** — tripwire / judge park auto-pass only with `--approve-all` / `approveAll`.
- **Outbound** — opening external URLs confirms first. List prices ship bundled
  (CI-refreshed from models.dev); runtime never fetches a pricing URL.
- **opencode inserts** — context injections are flagged `synthetic` and stay visible in the transcript.
- **Internals clear** — whitelist-only; workflows and settings cannot be bulk-deleted through the API.

## What we do not do

- Auth tokens, logins, or TLS on loopback (theater unless you bind beyond localhost).
- Binding to the LAN “with a password.”
- Electron solely to invent a sandbox.
- Vue custom-node plugins loaded into the SPA.
- Treating schema-diff bots as a security control.

## Practical habits

- Prefer splice in the UI for gated workflows; use `--approve-all` only when you mean unattended auto-pass.
- `threadle daemon` with triggers that set `approveAll: true`, or CLI `threadle run … --approve-all`, intentionally auto-pass parks and human gates (no splice) — that is the unattended mode, not a bypass hole.
- Treat custom-node packs and MCP server configs like binaries you chose to run.
- Avoid injecting into a session that is actively generating (green pulse).
- Report issues for *threadle* bugs (UI, graphs, CLI, wiring) — not external agent outages.

See also: [MCP](mcp.md), [custom nodes](custom-nodes.md), [CLI](cli/README.md).
