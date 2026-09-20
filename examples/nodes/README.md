# Example custom nodes

Two catalogs under this folder:

| Catalog | Path | Role |
|---|---|---|
| **Demos** | this directory | Tutorial / typed-lane flavors (`hello-world`, `char-stats`, `head-tail`, …) |
| **Stdlib pack** | [`stdlib/`](stdlib/) | Curated utilities (`jq`, `extract-json`, `split-md`, `diff`, `rg`, …) — prefer these over growing core |

Install either kind with **Settings → custom nodes → ⇣ Import** using an absolute
path to **one node folder** (e.g. `…/examples/nodes/hello-world` or
`…/examples/nodes/stdlib/jq`), the ⌸ folder picker, or copy into
`~/.config/threadle/nodes/` yourself.

See [`stdlib/PACK.md`](stdlib/PACK.md) for the full stdlib catalog and wire patterns.
Docs site: **Extend → Stdlib pack**.

---

## Demos

| node | flavor | ports | shows off |
|---|---|---|---|
| `hello-world` | class | text → text | smallest importable starter — greets the input |
| `shout` | class | text → text | minimal two-file transform |
| `extract-urls` | class | text → text | practical text munging |
| `char-stats` | class | text → json | typed **output** (feeds json-typed nodes) |
| `fibonacci` | class | int → text | typed **input** (wire an int-typed prompt / **Data** node in) |
| `sum-numbers` | class | json → float | json in, float out — chain after char-stats or a **Data** (json) node |
| `sort-unique` | class | text → text | sorts lines + unique (portable JS) |
| `head-tail` | class | named ports | params + multi-port example (covers head / slug-style splits) |

**Platform notes:** stdlib command nodes (`jq`, `rg`, `git-*`, …) need those binaries on `PATH`. On Windows, install them yourself (e.g. Git for Windows, scoop, or WSL) or prefer class-flavor demos (`hello-world`, `shout`, `sort-unique`, …).

**First import:** paste into Settings → custom nodes → Import (adjust to your clone):

```
/path/to/threadle/examples/nodes/hello-world
```

**Stdlib first cut** (after demos):

```
/path/to/threadle/examples/nodes/stdlib/jq
/path/to/threadle/examples/nodes/stdlib/extract-json
/path/to/threadle/examples/nodes/stdlib/split-md
/path/to/threadle/examples/nodes/stdlib/diff
```

**Typed lanes** are a built-in: drop a **◇ Data** node from the palette (string · int · float · bool · json), then wire e.g. `agent → Data(json) → sum-numbers → output`. Data accepts any text-lane writer and coerces to its type at run time — so `char-stats (json) → Data (json)` works too.

A longer demo chain: `prompt → char-stats → Data(json) → sum-numbers → output`, or
`prompt(int: 12) → fibonacci → output`.
