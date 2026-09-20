# Custom nodes

threadle is built to grow with your needs: any developer can add workflow nodes
without touching threadle's source. A node is a directory under
`~/.config/threadle/nodes/` with two files:

```
my-node/
├── node.json    ← identity + metadata (the descriptor)
└── node.ts      ← the logic (a TypeScript class)
```

**Contract**: text in, text out. That's the whole API — until you opt into
[params](#params-widgets-on-the-node) (inspector-editable
widgets) or [named ports](#named-ports-more-than-one-lane) (multiple
inputs/outputs), both declared in `node.json`.

See also [NodeDefinition](./node-definition.md) / [Adding a built-in node](./add-builtin-node.md)
if you need a first-party type in threadle's own graph vocabulary.

## Your first node, in 60 seconds

**Fastest import:** clone or open this repo and **Settings → custom nodes → ⇣ Import**
the absolute path to [`examples/nodes/hello-world`](../examples/nodes/hello-world/)
(greets the input, or `Hello, world!` when empty). See
[`examples/nodes/README.md`](../examples/nodes/README.md) for **demos** (typed
lanes, `sort-unique`, `head-tail`, …) and the curated
[**stdlib pack**](../examples/nodes/stdlib/PACK.md) (`jq`, `extract-json`,
`split-md`, `diff`, `rg`, …) — utilities you import instead of growing built-ins.
Wire a **◇ Data** node between typed custom nodes when you need coercion.

Or scaffold from scratch: **Settings → custom nodes → ＋ Create node**. threadle
writes both files and opens them in your editor. What it creates:

```json
// node.json — the descriptor
{
  "id": "shout",
  "label": "Shout",
  "glyph": "!",
  "description": "uppercases and adds enthusiasm",
  "entry": "node.ts",
  "input": "text",
  "output": "text"
}
```

```ts
// node.ts — the signature node.json points at: a default-exported
// class implementing run(input)
export default class Shout {
  async run(input: string): Promise<string> {
    return input.toUpperCase() + "!!!";
  }
}
```

Reload threadle. The node appears in the palette's **nodes tab** under
*custom*, in the right-click add menu, and in the wire-drop menu. Wire
`prompt → Shout → output`, press Run, done.

The class is pure logic; identity and metadata live in the descriptor. No
imports, no build step, no dependency on threadle — Node's native type
stripping loads the `.ts` directly, and the node runs as its **own child
process**: crash away, threadle survives. Need npm packages? `npm install`
inside the node's folder — imports resolve against its own `node_modules`.

## node.json fields

| field | | |
|---|---|---|
| `id` | recommended | the stable identity graphs reference — survives folder renames and imports. Defaults to the directory name. a-z, 0-9, dashes. |
| `entry` | class flavor | the file whose default export implements `run(input)` (must live inside the node's directory) |
| `command` | command flavor | argv array for any-language nodes — never a shell string; relative `./script` resolves against the node's directory |
| `label`, `glyph`, `description` | optional | how the node presents itself |
| `input`, `output` | optional | value types: `text` (default), `int`, `float`, `bool`, `json` — enforced at wire time and run time |
| `inputs`, `outputs` | optional | **named ports** — arrays of `{ name, type?, required?, maxConnections? }` superseding the single `input`/`output` (declaring both forms on one side is invalid) |
| `params` | optional | **inspector-editable params** — widgets rendered on the node card, see below |
| `timeoutMs` | optional | per-run timeout, default 60 000, capped at 300 000 |

Exactly one of `entry` or `command` decides the flavor. (A bare `node.ts`
without a descriptor also works — metadata is then read from class fields
via the sandboxed runner, and the directory name becomes the id.)

## Params: widgets on the node

```json
"params": [
  { "name": "mode", "type": "choice", "options": ["fold", "strip"], "default": "fold" },
  { "name": "width", "type": "int", "label": "max width", "default": 72, "min": 10, "max": 200 },
  { "name": "strict", "type": "bool", "default": true }
]
```

Each param renders as a widget on the node card (text input, number,
checkbox, dropdown for `choice`, textarea for `json` or `"multiline": true`
text) and its value is saved per node in the graph. Types are the value
types plus `choice` (which needs `options`); `min`/`max` bound int/float
params; `label` and `description` polish the widget.

At run time the resolved values (defaults filled in, everything validated)
reach the process as environment variables:

- `THREADLE_PARAMS` — one JSON object, e.g. `{"mode":"fold","width":"72"}`
  (values are always strings)
- `THREADLE_PARAM_<NAME>` — one variable per param, name uppercased with
  dashes → underscores (`keep-blank` → `THREADLE_PARAM_KEEP_BLANK`)

Class nodes additionally get them as the second argument:
`run(input, ctx)` with `ctx.params`.

## Named ports: more than one lane

```json
"inputs":  [ { "name": "text" }, { "name": "pattern", "required": false } ],
"outputs": [ { "name": "head" }, { "name": "tail" } ]
```

Each named port is a single-wire slot by default (`maxConnections: 1`). Raise it for
fan-in / fan-out — e.g. `{ "name": "parts", "maxConnections": 8 }` accepts up to
eight inbound wires on that handle (the card shows `×8`). Built-in nodes have
fixed capacities too (Delay is 1/1; Merge is multi-in / 1-out; Prompt fans out
freely).

Declaring `inputs`/`outputs` gives the node card one labeled handle per
port instead of the single text lane — wire different upstream nodes into
different inputs, and route each output to a different consumer. Each port
takes a value type (`text` by default); required inputs (the default) are
red-flagged by pre-run validation when unwired.

Declaring named ports also switches the process protocol from plain text
to JSON:

- **stdin** becomes a JSON object keyed by input port —
  `{"text": "...", "pattern": "..."}` (optional unwired ports are absent;
  multiple wires into one port are joined with blank lines first). The
  env var `THREADLE_INPUTS_JSON=1` marks the switch; class nodes also get the
  parsed object as `ctx.inputs`.
- **stdout** must be a JSON object keyed by output port —
  `{"head": "...", "tail": "..."}`. Every declared port must be present
  and type-conformant, otherwise the node fails loudly. Non-string values
  are carried onward as JSON. Class nodes may simply return the object.
- The **first declared output** is the node's primary lane value — it's
  what untyped consumers and the run log see.

See `examples/nodes/head-tail/` for a complete node using both features.

## Stdlib pack

Curated **utility** custom nodes live under
[`examples/nodes/stdlib/`](../examples/nodes/stdlib/PACK.md) — import them instead
of growing built-ins for `jq` / `rg` / `diff` / …:

| Node | Job |
|---|---|
| `jq` | JSON path / transform (`filter` param; needs `jq` on PATH) |
| `extract-json` | First fenced JSON block from agent text |
| `split-md` | `##` chunks → JSON array (∀ iterator food) |
| `diff` | Unified diff of named ports `a` / `b` → Judge |
| `rg` | Search absolute `dir`; paths on stdout |
| `token-estimate` | chars÷4; pair with a tokens breaker |
| `test-run` | argv in `dir`; `ok:` / `err:` from exit |
| `git-status` / `git-diff` | Thin git wrappers (`dir` absolute) |

Import **one folder at a time** (Settings → custom nodes), e.g.
`/path/to/threadle/examples/nodes/stdlib/jq`. Tutorial demos stay in
[`examples/nodes/`](../examples/nodes/README.md). Docs site: **Extend → Stdlib pack**.

## Any other language: the command flavor

```json
{
  "id": "uppercase",
  "label": "UPPERCASE",
  "glyph": "⇧",
  "description": "shouts the incoming text",
  "command": ["node", "./run.js"]
}
```

Prefer `["node", "./run.js"]` (portable). Unix-only tools like `tr` / `sort -u` work on macOS/Linux when installed, but fail on stock Windows.

Input arrives on **stdin**, output leaves on **stdout** — `jq`, Python,
a compiled binary, anything.

## Semantics on the canvas

- Custom nodes live on the **text lane**: they accept input from prompts,
  converters, agents, outputs, gates and iterators — and feed all of those,
  including other custom nodes chained back to back.
- Multiple inbound wires on one port are joined with blank lines before
  hitting stdin — **only up to `maxConnections`** (default 1 per named
  port; a new wire on a full slot replaces the oldest).
- **Typed ports**: prompt nodes have a type selector and
  descriptors declare `input`/`output`. Incompatible wires are refused
  while you drag (int fits float, anything fits text); values are validated
  again at run time — a node that claims `int` output but prints prose
  fails loudly instead of poisoning downstream nodes.
- They respect **mute** (skipped), **bypass** (input passed through
  unexecuted), pre-run validation (an unwired custom node blocks the run),
  and partial execution ("run from this node").
- stderr is surfaced in the run log; a non-zero exit fails the node with the
  stderr excerpt as the error.

## Sharing & importing nodes

Publishing a node = pushing its folder to a git repo. Installing:

- **Settings → custom nodes → ⇣ Import** with a **git URL** — shallow clone —
  or a **local path** (`~/projects/my-node`, an already-cloned repo, any
  project directory) — copied in, `.git` excluded.
- The imported directory is renamed to the descriptor's `id`, so graphs
  referencing the node keep working no matter what the repo was called.
- Or plain `git clone` into `~/.config/threadle/nodes/` yourself.

Folder-based distribution, no registry — and importing never executes
anything. Metadata comes from
`node.json` (or via a sandboxed child for bare class files), and the node's
code runs only when you wire it into a graph and press Run. Still: imported
nodes run as *you* — read before you trust.

Every import is **validated** against the same rules as a reload (JSON shape,
id, entry/command, ports, params). Broken packages stay on disk and show under
**Settings → custom nodes** with status **error** and the reason. Valid nodes
show as **enabled** (in the palette) or **disabled** (hidden from the palette /
runner, folder kept). Toggle with enable / disable next to each row; state is
stored in `nodes/.disabled.json` and does not rewrite the author's `node.json`.

## Trust model

Custom nodes run **your** local files with **your** user — threadle never
downloads or auto-installs nodes on its own. Each run gets a **minimal
environment** (PATH, HOME, LANG, TMPDIR, TERM, SHELL — never the threadle
server's API keys); a node that genuinely needs your full environment must
declare `"env": "inherit"` in its descriptor, which makes that trust
decision visible.
Commands are argv arrays (no shell interpolation), class nodes execute in
an isolated child process (metadata extraction included — user code never
runs inside the threadle server), the working directory is the node's own
folder, runs are bounded by the timeout and a 4 MB output cap, and the
`nodes/` directory is listed under *Settings → threadle internals* so nothing
is hidden.
