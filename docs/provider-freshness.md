# Keeping providers fresh

Agent CLIs (Claude Code, Cursor `agent`, opencode, Antigravity `agy`, Codex, GitHub Copilot, Grok Build, Muse Code) store transcripts in **undocumented** formats and rename flags without notice. threadle does **not** mirror their configs/APIs with a daily diff bot.

## Strategy

| Layer | What |
|---|---|
| Defensive parsers | Skip unknown JSONL / part types; never throw (`AGENTS.md`) |
| Golden fixtures | [`packages/server/test/fixtures/providers/`](../packages/server/test/fixtures/providers/) + `provider-fixtures.test.ts` |
| Local probe | `threadle check --providers` — golden fixtures (repo/CI) + inject-critical tokens in CLI help when the binary exists |
| Weekly CLI install + flag probe | [`.github/workflows/provider-smoke.yml`](../.github/workflows/provider-smoke.yml) installs npm-published CLIs and fails on `!! flag:` |
| Weekly version watch | [`.github/workflows/provider-watch.yml`](../.github/workflows/provider-watch.yml) compares npm / GitHub latest to pins in [`upstream.ts`](../packages/server/src/providers/freshness/upstream.ts) |
| Dependabot | [`.github/dependabot.yml`](../.github/dependabot.yml) — threadle's own npm + Actions, not agent CLIs |
| Human triage | When a `provider-drift` issue opens, walk [CONTRIBUTING.md](../CONTRIBUTING.md#when-upstream-agent-clis-move) |

## Commands

```sh
threadle check                 # readiness (Node, config, CLI PATH, storage)
threadle check --providers     # + inject flag presence for installed CLIs
threadle check --upstream      # npm/GitHub latest vs pins in upstream.ts
npm run check:upstream -w threadle   # same pins, exit 1 on drift (CI)
```

Use two dashes: `--providers`. (`-providers` is parsed as short `-p` and fails.)

### What plain `check` does

Readiness only: Node ≥ 22.12, writable config dir, baked `web-dist`, templates, each agent CLI on PATH / known path + `--version`, each provider “available” (storage and/or CLI per adapter), `$HOME`. Exit `0` if critical rows pass and at least one CLI or provider store is present.

It does **not** parse transcripts or prove schemas (that’s fixture CI).

### What `--providers` adds

1. **Golden fixtures** (when `packages/server/test/fixtures/providers` is on disk — repo checkout / CI): parse one sample per provider (`fixture:claude-code`, `fixture:cursor`, … `fixture:grok`, `fixture:muse`). Published installs skip these rows.
2. **Inject flag probes** for each **installed** CLI — run help and look for inject-critical tokens listed in [`packages/server/src/providers/freshness/inject-flags.ts`](../packages/server/src/providers/freshness/inject-flags.ts):

| Detail | Behavior |
|---|---|
| Missing binary | Skip (`ok`) |
| Help text contains any `match` string | `ok` |
| No match | `!!` and non-zero exit |
| Subcommand help | Some probes use e.g. `opencode run --help` or `muse exec --help` (not only top-level `--help`) |
| Bracket notation | Claude documents `--append-system-prompt[-file]` — both that form and the long flag count |
| Fixture missing | Skip (`ok`) |
| Fixture parse / shape fail | `!!` and non-zero exit |

A `!! flag:` row means “help no longer mentions a string we rely on for inject/run” — confirm with the real CLI before changing adapters (help text and the live flag can diverge). A `!! fixture:` row means a golden sample stopped normalizing.

**Muse models.** Upstream has no `muse models` list yet. threadle’s model picker scrapes Spark ids from `muse exec --help` / `muse --help`, keeps hardcoded fallbacks, and honors `MUSE_MODELS`. That catalog is soft — expand fallbacks or env when Meta renames Spark ids.

## Adding a fixture

1. Anonymize one real transcript line (paths → `/tmp/…`, strip secrets).
2. Drop it into the matching folder under `test/fixtures/providers/`.
3. Assert known types still normalize and the new type is skipped or mapped.
4. Prefer a one-line sample over a full session dump.

## Updating a flag probe

If help moved (new subcommand, bracket alias) but inject still works: edit `match` / `helpArgs` in `inject-flags.ts`, not the inject argv, until the CLI truly renames the flag.
