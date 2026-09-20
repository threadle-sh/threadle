# Recipes

**Clone → fill the contract → run against your work.**

A **workflow** is any runnable portable graph. A **recipe** is a workflow packaged as a *job*: outcome first, contract explicit, guards on by default. Teaching graphs that demonstrate one mechanic live in [`../workflows/`](../workflows/).

```sh
threadle recipes
threadle run repo-brief --dir ~/code/some-repo
```

Or **Workflows → recipes → use** in the app (same catalog), then pick models / wire slots on the canvas.

Docs site: `/workflows/recipes/`.

---

## Catalog

| Id | Outcome | You must supply |
|---|---|---|
| `diff-review-panel` | Three-lens diff review → one verdict | **model** ×3 · **`--dir`** · param `scope` |
| `second-opinion` | Cross-provider review of a finished session | **model** · **`--dir`** · **session slot** · param `concern` |
| `handover-brief` | Actionable brief into the context library | **session slot** · param `audience` *(no agent node — distill is the model call)* |
| `test-triage` | Failures → root causes in one accumulating session | **model** · **`--dir`** · param `failures` |
| `repo-brief` | One onboarding page for a repo | **model** ×3 · **`--dir`** · param `focus` |
| `best-of-n` | Same task × 3 providers → one synthesized pick | **model** ×3 · **`--dir`** · param `task` |

Machine-readable: [`catalog.json`](catalog.json). API: `GET /api/graphs/recipes`, `POST /api/graphs/recipes/:id`.

---

## Run snippets

```sh
# Diff panel (agents run git themselves)
threadle run diff-review-panel \
  --dir ~/code/my-project \
  --param scope="the staged changes (git diff --staged)" \
  --approve-all

# Second opinion — wire the session on the canvas first
threadle run second-opinion --dir ~/code/my-project

# Handover — wire session on canvas
threadle run handover-brief \
  --param audience="a teammate picking this up tomorrow morning with no context"

# Test triage
threadle run test-triage \
  --dir ~/code/my-project \
  --param failures="$(npm test 2>&1 | tail -60)" \
  --approve-all

# Repo brief
threadle run repo-brief \
  --dir ~/code/unfamiliar-project \
  --param focus="the whole repository" \
  --approve-all
```

Session-slot recipes (`second-opinion`, `handover-brief`) need the empty ❝ context node wired on the canvas before ▶ / `run` can succeed.

---

## Product rules

1. **Outcome first.** Notes lead with what you get, then the contract — not with ∀ / parallelism / merge vocabulary (examples own that).
2. **Explicit contracts.** Every recipe declares model / `--dir` / session slot up front. Empty context slots are intentional prompts, not broken graphs.
3. **Guards by default.** Spend ceiling, approval before accept, content circuit breaker when thin output means “agent found nothing”, parallelism only when branches are truly parallel.
4. **Named roles.** Parallel agent nodes carry canvas labels (`correctness`, `architecture`, …) so the graph reads as a panel, not three anonymous asks.
5. **Cross-provider is deliberate.** Most agents default to Cursor ask. `second-opinion` defaults to Claude — swap if the session under review was already Claude.

Adapt freely. Keep the habits.
