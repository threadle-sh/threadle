# threadle stdlib pack

Curated **utility** custom nodes — not demos. Same import UX as any custom node;
no new built-in types. Prefer these over growing core for `jq` / `rg` / `diff`.

Tutorial / typed-lane demos stay in the parent [`../`](../) folder (`hello-world`,
`char-stats`, `head-tail`, …).

## Install

Import **one folder at a time** (Settings → custom nodes → ⇣ Import), using the
absolute path to a node directory:

```text
/path/to/threadle/examples/nodes/stdlib/jq
/path/to/threadle/examples/nodes/stdlib/extract-json
/path/to/threadle/examples/nodes/stdlib/split-md
/path/to/threadle/examples/nodes/stdlib/diff
```

Or copy/symlink each folder into `~/.config/threadle/nodes/`.

Command-flavor nodes (`jq`, `rg`, `git-*`, `test-run`) need the binary on `PATH`
and fail with stderr if missing — threadle does not bundle them. On **Windows**,
install those tools yourself or run threadle under **WSL** where they are typical.

## Catalog

### First cut

| Node | Flavor | Job |
|---|---|---|
| [`jq`](jq/) | command wrapper | JSON path / transform (`filter` param) |
| [`extract-json`](extract-json/) | class | First fenced JSON block from agent text |
| [`split-md`](split-md/) | class | Chunk on `##` headings → JSON array (∀ iterator food) |
| [`diff`](diff/) | class | Unified diff of named ports `a` / `b` → Judge |

### Second wave

| Node | Flavor | Job |
|---|---|---|
| [`rg`](rg/) | command wrapper | Search `dir` (absolute path); paths on stdout |
| [`token-estimate`](token-estimate/) | class | chars÷4 estimate; pair with a ‡ breaker |
| [`test-run`](test-run/) | command wrapper | Run argv in `dir`; exit → ok/err text |
| [`git-status`](git-status/) | command | `git status --short` in `dir` |
| [`git-diff`](git-diff/) | command wrapper | `git diff` in `dir` (optional pathspec param) |

**Folded into demos:** slug / head — use [`head-tail`](../head-tail/) instead.

## Wire patterns

```text
agent → extract-json → Data(json) → jq → …
prompt(markdown) → split-md → ∀ (json) → agent | convert
branch-a ─┐
          ├→ diff → ? Judge
branch-b ─┘
agent → token-estimate → ‡ tokens breaker
```

Docs site: **Extend → Stdlib pack** (install, catalog, wire patterns).
