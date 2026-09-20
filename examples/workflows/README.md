# Workflow templates

Portable graphs (`threadle/graph@1`) matching the in-app **Workflows → examples** catalog and the bundled CLI templates. These *teach* one mechanic each.

For graphs that *do a job* (diff review, handover, repo brief), see [`../recipes/`](../recipes/).

```bash
threadle --list-templates
threadle run <id> [--approve-all] [--detach] [--param k=v]
threadle run examples/workflows/<id>.json --approve-all
```

CLI reference: [`docs/cli/`](../../docs/cli/). Hide the Examples table anytime in **Settings → show workflow examples**.

Examples marked **agent** call a provider CLI and cost tokens; everything else is free local computation.

CLI ids (`content-tripwire`, `ply-fan-knot`, …) keep stable historical slugs; the **Name** column is what the UI shows.

---

## Beginner

| File / `threadle run` id | Name | Teaches | Agent |
|---|---|---|---|
| [`hello-wire.json`](hello-wire.json) | Hello wire | Prompt → output | — |
| [`splice-gate.json`](splice-gate.json) | Approval gate | Approval + splice | — |
| [`one-shot-agent.json`](one-shot-agent.json) | One-shot agent | Prompt → agent → output | agent |
| [`param-prompt.json`](param-prompt.json) | Workflow params | `{{param:topic}}` | — |
| [`mcp-brief.json`](mcp-brief.json) | MCP brief | Params + output for `threadle mcp` / `wf_*` | — |
| [`prompt-convert.json`](prompt-convert.json) | Text → Prompt | Converter template | — |

```bash
threadle run hello-wire
threadle run examples/workflows/mcp-brief.json   # then expose via threadle mcp — see docs/mcp.md
```

MCP connect / canvas client demos: [`../mcp/`](../mcp/).

---

## Intermediate

All agent-free.

| File / id | Name | Teaches |
|---|---|---|
| [`detached-delay.json`](detached-delay.json) | Detached delay | ◷ Delay (~60s); `jobs` / `logs` |
| [`hello-mcp.json`](hello-mcp.json) | Hello MCP | ◈ MCP tool → echo via **argPort** (needs `.mcp.json`) |
| [`hello-mcp-params.json`](hello-mcp-params.json) | Hello MCP params | ◈ MCP echo via **inspector params** (no wire) |
| [`knot-concat.json`](knot-concat.json) | Merge concat | ⋈ concat fan-in |
| [`knot-first.json`](knot-first.json) | Merge first-wins | ⋈ `first` |
| [`iterator-lines.json`](iterator-lines.json) | Iterator lines | ∀ split checklist |
| [`mute-bypass.json`](mute-bypass.json) | Mute & bypass | Mute / bypass |
| [`content-tripwire.json`](content-tripwire.json) | Content breaker | ‡ park on `ERROR` |
| [`judge-branch.json`](judge-branch.json) | Judge branch | ? route pass / fail / unsure |
| [`until-reenter.json`](until-reenter.json) | Until re-entry | ↻ counted loop · exhausted out |
| [`wait-idle-gate.json`](wait-idle-gate.json) | Wait for idle | ◌ park until session not generating |
| [`min-chars-tripwire.json`](min-chars-tripwire.json) | Min-chars breaker | ‡ park when too short |
| [`spend-tripwire.json`](spend-tripwire.json) | Spend ceiling | Branch breaker + graph spend ceiling |

### Hello MCP (agent-free; needs echo server)

```bash
# copy examples/mcp/mcp.json.echo.example → repo-root .mcp.json
threadle run hello-mcp
threadle run hello-mcp-params   # inspector params instead of argPort
# or clone from Workflows → examples → Hello MCP / Hello MCP params
```

See [`../mcp/`](../mcp/) for the echo server and host configs.

### Detached delay (agent-free, ~60s)

```bash
threadle --no-open   # terminal A
threadle run detached-delay --detach
threadle jobs
threadle attach <jobId>
```

```bash
threadle run knot-concat
threadle run iterator-lines
threadle run judge-branch
threadle run until-reenter
threadle run wait-idle-gate
```

---

## Advanced

| File / id | Name | Teaches | Agent |
|---|---|---|---|
| [`agent-err-fallback.json`](agent-err-fallback.json) | Agent err fallback | Red **err** connector vs happy-path `out` → fallback convert | agent |
| [`skill-invoke-judge.json`](skill-invoke-judge.json) | Skill invoke + Judge | ✦ `mode: invoke` (`/{name}` on any provider) → ? Judge | agent |
| [`iterator-agent.json`](iterator-agent.json) | Iterator → agent | ∀ + agent per item (serial) | agent |
| [`iterator-parallel.json`](iterator-parallel.json) | Iterator parallel map | ∀ `mode: parallel` + ply + ⋈ Merge | agent |
| [`mcp-then-agent.json`](mcp-then-agent.json) | MCP then agent | ◈ echo → convert → agent (needs `.mcp.json` + CLI) | agent |
| [`token-tripwire.json`](token-tripwire.json) | Token breaker | ‡ skip oversized branch | — |
| [`plan-implement-review.json`](plan-implement-review.json) | Starter workflow | Plan → implement → review | agent |
| [`cross-tool-distill.json`](cross-tool-distill.json) | Cross-tool distill | Cursor → brief → Claude | agent |
| [`session-autopsy.json`](session-autopsy.json) | Session autopsy | Autopsy narrative + approval | agent |
| [`ply-fan-knot.json`](ply-fan-knot.json) | Parallel fan + majority merge | ǁ parallelism=2, majority, duration fuse | agent |

### Plan → Implement → Review

```bash
threadle run plan-implement-review \
  --param task="fix the flaky auth test" \
  --approve-all
```

Also seeded in the UI as graph id `starter`.

### Agent err fallback

```bash
threadle run agent-err-fallback
```

Prompt → agent: happy-path **out** (upper) vs red **err** connector (lower, `out:err`) → wrap convert → output. Pick a model; to exercise the err arm use a bad model id or stop the CLI mid-run. Unwired err still aborts (or continue-on-error starves).

### Cross-tool distill

```bash
threadle run cross-tool-distill \
  --param topic="cross-tool context handoff"
```

### Session autopsy

```bash
threadle run session-autopsy --approve-all \
  --param focus="wasted motion and the smallest unblock"
```

Swap the sample prompt for a materialized ❝ context node when autopsying a real session.

### MCP then agent

```bash
# copy examples/mcp/mcp.json.echo.example → repo-root .mcp.json
# pick a model on the agent node (◇) before ▶ / ≫
threadle run mcp-then-agent --approve-all
```

Chain: MCP tool payload → Text→Prompt (“summarize…”) → agent → output. Swap the MCP server/tool once a real MCP is configured; swap the agent node for Claude/opencode from the palette if needed.

---

## Optional · needs MongoDB

Not seeded in the in-app examples catalog — run from the JSON file after configuring the Mongo MCP server.

| File | Name | Teaches |
|---|---|---|
| [`mcp-mongo-find.json`](mcp-mongo-find.json) | MCP Mongo find | Data → ◈ `find` (`argPort` = filter) → output |

```bash
# copy examples/mcp/servers.json.mongodb.example → ~/.config/threadle/mcp/servers.json
# start local mongod; seed a test.userprofiles collection if you want non-empty results
threadle run examples/workflows/mcp-mongo-find.json
```

See [`../mcp/`](../mcp/) for the registry snippet and [`docs/mcp.md`](../../docs/mcp.md#optional-mongodb-find).

---

## Expert

| File / id | Name | Teaches | Agent |
|---|---|---|---|
| [`expert-guarded-fan.json`](expert-guarded-fan.json) | Guarded parallel | Parallel fan, merge, circuit breaker, splice, spend ceiling | agent |
| [`complex-delay-pipeline.json`](complex-delay-pipeline.json) | Complex delay pipeline | **5 subgraphs**, delays, parallelism, merge, circuit breaker, approval | — |

```bash
threadle run expert-guarded-fan --param task="…" --approve-all
# no agents — ~20s simulated pipeline across 5 subgraph stages
threadle run complex-delay-pipeline --approve-all
```

In the app, **use** on `complex-delay-pipeline` seeds **linked** editable subgraphs (not just the flattened portable copy).

---

## Notes

- Source of truth for the graphs is `packages/server/src/templates/workflows.ts`; these JSON files are the portable exports for reading, sharing, and `threadle run ./file.json`.
- Import in the UI: **Workflows → examples** (clone) or drop a `.json` onto the canvas / use import.
- Job recipes: [`../recipes/`](../recipes/) — **Workflows → recipes**, `threadle recipes`.
- Cron / path-watch triggers: [`../triggers/`](../triggers/) — `triggers.json` + `threadle daemon`.
- Starlight: [Examples](https://threadle.sh/workflows/examples/) · [Recipes](https://threadle.sh/workflows/recipes/) (when published).
