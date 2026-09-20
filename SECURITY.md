# Security

threadle is local-first: the server binds **127.0.0.1** by default and does not upload your code or transcripts. Agent CLIs still talk to their providers under *your* credentials when you press ▶ / ≫.

## Reporting a vulnerability

Email **info@threadle.sh**, or open a **private** security advisory on the GitHub repository. Please include:

- Impact (data exposure, RCE on the loopback server, path traversal, etc.)
- Reproduction steps against a stock `threadle` install
- Affected version / commit

Please give a reasonable window before public disclosure.

## Trust boundaries (non-exhaustive)

- **Agent storage** — discovery parsers are read-only; they must skip unknown record types, not throw.
- **Custom nodes** — executables under `~/.config/threadle/nodes/` run with the privileges of the threadle process; treat third-party node packs like any other local binary.
- **Detached / CLI runs** — approval gates require explicit `--approve-all` / UI confirm; there is no interactive TTY splice yet.
- **Pricing** — list prices ship as a vetted `models-pricing.json` snapshot
  (CI refreshes from models.dev). Runtime never fetches a pricing URL.
- **Outbound opens** — Report issue and blueprint ↗ urls confirm before leaving threadle. Report issue is for threadle bugs only, not agent/service vendor problems.
