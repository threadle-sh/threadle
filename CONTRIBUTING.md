# Contributing to threadle

Thanks for helping. Keep changes local-first and honest about what the product can (and cannot) do yet.

## Setup

Requires **Node.js ≥ 22.12**.

```sh
git clone https://github.com/threadle-sh/threadle.git
cd threadle
npm install
npm run dev          # API :4570 + viewer Vite :5173 + workflows Vite :5174
```

Production-style build (UI baked into the server package):

```sh
npm run build
npm start            # http://127.0.0.1:4570
```

## Checks before a PR

```sh
npm test                           # boundary check + vitest (core, workflows-server, server, ui)
npm run typecheck                  # tsc (server packages) + vue-tsc (web packages)
npm run pack:smoke                 # build + npm pack + --help / templates
npm run pack:portable:smoke        # portable Node+app tree (curl-install layout)
```

Releases: tag `X.Y.Z` or `vX.Y.Z` matching `packages/server/package.json`. [`.github/workflows/release.yml`](.github/workflows/release.yml) uploads platform tarballs and publishes the `threadle` package (npm Trusted Publisher / OIDC, or `NPM_TOKEN` Automation token). Re-run via workflow_dispatch with the existing tag if assets/npm need a redo. See [`docs/install.md`](docs/install.md). CI runs on Ubuntu and macOS (the supported install targets).

UI chrome changes: prefer a headless screenshot over reasoning about CSS alone (see `AGENTS.md`).

## Submitting a pull request

We work by pull request. Nobody pushes straight to `main`.

1. **Fork** the repo (or branch, if you have write access) and start from an up-to-date `main`.
2. Keep it **focused**. One logical change per PR, and match the surrounding code. Don't reformat unrelated lines.
3. Run the [checks above](#checks-before-a-pr). For UI changes, attach a before/after screenshot.
4. **Open a PR against `main`** with a clear **description**: what changed, why, and anything you're unsure about. Link the issue it closes (`Closes #123`).
5. A maintainer reviews it. Address any feedback by pushing more commits. **Merging is done only by the maintainer / core team.** `main` is protected, so contributors can't self-merge. Your goal is a green, approved PR, and the team takes it from there (squash).

First PR? Something small and self-contained is the fastest way in: a docs fix, a provider fixture, a bug with a failing test. Unsure about an approach? Open a **draft PR** or an issue first and ask. Better to align before you build.

## Layout

| Package | Role |
|---|---|
| `packages/shared` | Core types + zod schemas (sessions, context, API events) |
| `packages/core` | Providers, sessions, jobs/runs, context, viewer API |
| `packages/server` | `threadle` + `threadle-workflows` bins — composition root (Hono server, CLI) |
| `packages/ui` | Shared Vue shell: nav, status bar, stores, API client, theme |
| `packages/web` | Viewer app (`threadle`) |
| `packages/workflows-shared` | Graph schema, node catalog, runner helpers |
| `packages/workflows-server` | Graph store, executor, triggers, templates, custom nodes |
| `packages/workflows-web` | Workflows addon app (`threadle-workflows`) |

Dependency direction (viewer/core never import workflows) is enforced by `npm run check:boundary`; the table in [AGENTS.md](AGENTS.md) is the reference.

Providers under `packages/core/src/providers/*` are **read-only** against agent storage. Never write into `~/.claude/projects`, opencode SQLite, `~/.cursor` chats, Antigravity brain logs, `~/.codex`, `~/.copilot`, or `~/.grok`.

## Product posture (viewer first)

threadle is a **local-first multi-provider viewer** (sessions, spend, blueprints, search). Workflows are an optional **addon** (`threadle-workflows`, UI under `/addon/workflows`) in the same install — soft-frozen. See [docs/workflows.md](docs/workflows.md).

- Prefer Sessions / Statistics work over canvas features.
- Ignore Workflows except breakage unless launch feedback says otherwise.
- Workflows live in their own packages (`workflows-*`); keep workflow code there. No product rename.

## Style / product rules

- Vocabulary: UI says *circuit breaker / merge / judge / until / error connector / parallelism / spend ceiling*. Graph JSON may keep historical ids (`tripwire`, `knot`, `judge`, `until`, `out:err`, `ply`, …).
- List UIs: mono micro-labels, right-aligned numerics, ellipsize names.
- Shared nav lives in `packages/ui/src/panels/nav-items.ts`. Do not fork it.
- Theme: true-black monochrome (`packages/ui/src/theme/theme.css`). Text glyphs only, no emoji.
- Layout: viewer in `packages/web`, editor in `packages/workflows-web`, shared shell in `packages/ui`; `npm run check:boundary`.

## Security reports

See [SECURITY.md](SECURITY.md). Do not file public issues for sensitive reports.

## When upstream agent CLIs move

Provider storage formats and CLI flags are **undocumented and churn**. Do not invent a daily schema-diff bot. Keep adapters fresh with:

1. **Golden fixtures** live in `packages/core/test/fixtures/providers/`. When a real transcript shows a new record type, add a one-line sample and assert skip-unknown (or map it). CI runs `provider-fixtures.test.ts`.
2. **`threadle check --providers`** probes help for inject-critical tokens (`--fork-session`, `--trust`, `codex exec`, …) when a CLI is installed. Missing binaries are skipped. Some probes use subcommand help, and bracket aliases in help text also count. See [docs/provider-freshness.md](docs/provider-freshness.md).
3. **Weekly CLI install + flag probe.** `.github/workflows/provider-smoke.yml` installs npm-published CLIs (`claude`, `opencode`, `codex`, `copilot`) and runs `threadle check --providers`. Missing inject flags fail the job and open a `provider-drift` issue.
4. **Weekly version watch.** `.github/workflows/provider-watch.yml` compares live npm / GitHub latest to pins in `packages/core/src/providers/freshness/upstream.ts`. Newer versions open or comment on a `provider-drift` issue. After you confirm adapters still work, bump `seen`.
5. **Dependabot.** `.github/dependabot.yml` bumps *this* repo's npm deps and Actions. It does not watch agent CLIs (they are not dependencies).
6. **Changelog triage** (human) when a drift issue fires, or Cursor / `agy` / Grok ship (those are not on npm):
   - Discovery paths still match (`~/.claude`, `~/.cursor`, …)
   - Inject argv in `packages/core/src/providers/*/inject.ts` still shows up in `--help`
   - Drop one anonymized transcript line into the fixture corpus if a new type appears
   - Bump `seen` in `upstream.ts` so the watch goes quiet

Parsers must **skip unknown record types**, not throw (`AGENTS.md`).
