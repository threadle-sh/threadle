# In-app Open (file viewer)

threadle can show local text files, reconstructed session context, interactive
transcripts, tool / skill / reasoning **invocation dumps**, and library
**context payloads** in **floating windows** without leaving the UI. Use
**open** / **view** when you want a quick read; use **open in ⟨editor⟩**
(`⟨/⟩`) when you want to edit; use **❐** to copy the text; use **⇓** for the full file.

## Where it appears

| Place | How |
|---|---|
| **Sessions** detail | **≡ transcript** → **⌗ blueprint** → **→ workflow** (transcript only when the session has messages / a known path) |
| **Files** / **Activity** (Sessions dashboard) | **open** next to **open in editor** on text paths |
| **Session blueprint** | Detail panel / right-click — see [Blueprint actions](#blueprint-actions). Topbar: **≡ transcript** → **↗ urls** → **→ workflow** / **⇓ bundle** |
| **Canvas** (skill, rules, agent-def with a source path) | **Right-click** the node → **open** / **open in …** / **copy path** / **copy content** |
| **Canvas** (**⇤ Output**) | **❐** on the card header or inspector copies captured result text |
| **Inspector** (session files) | Same **open** / **open in editor** pair |
| **Artifact panel** (skill / rules selection) | Same pair on the path |

**open** only shows for paths that look like text (`.md`, `.ts`, `.json`,
`.yaml`, Makefiles, `.env*`, and similar). Binaries stay editor-only.

## Blueprint actions

| Node | Floating viewers / downloads |
|---|---|
| **Session root** | **view transcript**, **open context** (+ materialize / download / reference) |
| **Subagent (⎇)** | Same as root for the *child* session: **view transcript**, **open context**, **view reasoning** / download, plus **⌗ open blueprint** |
| **Reasoning (∴)** | **view reasoning** / **⇓ download reasoning** (invocation dump of every thinking block) |
| **Tool / skill** | **view invocations** / **⇓ download invocations** |
| **Context payload (❝)** | **view context** (payload body) / **⇓ download payload** (raw JSON) |
| **File / rules / skillset** | **open** / **open in …** / copy path / copy content |

Detail-panel buttons sit under the side list (invocations, transcript preview,
edited lines) — same place as rule-file **open** / **open in …**.

### view transcript

Opens the interactive message list (roles, tools, thinking) in a floating
window — the same `TranscriptView` used in Search and the canvas inspector.
Works for every provider that can return a transcript, including **Codex**
rollouts under `~/.codex/sessions`. Title-bar ⇓ downloads the reconstructed
context markdown; ⟨/⟩ materializes it for the editor. **transcript file**
(session info) still opens the raw on-disk JSONL when the provider exposes a
path.

On the blueprint topbar and Sessions detail, **≡ transcript** leads the action
row when available. Blueprint topbar order: `transcript` → `urls` → `workflow`
→ `bundle`. **↗ urls** opens a modal of outbound http(s) URLs from tool calls
(domain / tool / text filters; results bodies are not scanned).

**Live follow.** The viewer opens pinned to the latest page. While you stay near
the bottom, new messages from `sessions.changed` / `live.status` (and a ~1 s
poll while the session is `running` or `waiting`) merge into the tail. Scroll
up to unpin; **↓ latest** jumps back, or **↓ N new** when unread messages
accumulated off-screen. **Load previous** / **Load more** do not cancel follow.
While busy, the footer shows **thinking** (`running`) or **waiting**.

### open context

Shows the session's reconstructed model context (the same markdown as
**download context**) in a floating window. Large threads are almost always
preview-capped — see [Size cap](#size-cap-preview).

### view invocations / view reasoning

Opens every call for a selected tool, skill, or reasoning stream as markdown
in the same floating viewer. Reasoning nodes (and subagent detail) label the
action **view reasoning**; tools / skills keep **view invocations**.

The blueprint side list is capped at 60 rows (`+N more not shown · download for
full`); the viewer loads the full dump and applies the same 1.5 MB preview cap
as context. Use **⇓ download … (.md)** (detail panel, context menu, or the
window title bar) for the uncapped file.

### view context (❝ payload)

Opens the stored library payload body (`GET /api/payloads/:hash`) as markdown
in a floating window. **⇓ download payload** saves the raw JSON.

## Window controls

- **Drag** the title bar to move; **resize** from any edge or corner (min ≈ 320×200).
- Several windows can be open at once; click a window to bring it forward.
- **Esc** closes the frontmost window (again for the next one).
- Opening a disk path that is gone shows a **File missing** alert (no empty viewer). Blueprint file nodes and the session **≡ plan.md** control gray out with a **missing** badge after a failed open or an existence probe.
- **Title-bar ❐** copies the same text **⇓** would download (disk preview, full context / transcript / invocations via API).
- **Title-bar ⇓** downloads when possible:
  - disk files → loaded text
  - context → full context via API
  - transcript → full context via API (same as open context)
  - invocations / reasoning → full dump via API (every call, not the 60-row side list)
- Title-bar **⟨/⟩** opens in your editor (disk files directly; context is written to
  `~/.config/threadle/tmp` first). Invocations / reasoning are download-only (no materialize path yet).
- **✕** closes.

## Format / highlighting

The title-bar dropdown picks how the body is rendered:

| Mode | Behavior |
|---|---|
| **auto** | From the file extension, then a light content sniff for `.txt` / unknown |
| **markdown** | Rendered markdown (fenced code highlighted) |
| **json** | Pretty-printed when valid, then syntax-highlighted |
| **txt** | Plain text |
| language modes | `typescript`, `python`, `shell`, `yaml`, … — highlight.js |

When the dropdown is **auto**, a small chip shows the resolved format
(e.g. `typescript`).

## Size cap (preview)

Reads are capped at **1.5 MB**. Larger files, session contexts, **and invocation
dumps** still open, but only the first 1.5 MB is shown, with a banner:

> preview — showing first 1.5 MB of … · open in editor / download for the full …

- Files: `GET /api/files/read` → `{ content, size, truncated, previewMaxBytes }`
- Context: `GET /api/sessions/:provider/context/:id?preview=1` → same shape  
  (without `?preview=1` the route still returns a full `.md` download)
- Invocations: `GET /api/sessions/:provider/invocations/:id?kind=tool|skill|reasoning&name=…&preview=1` → same shape  
  (`name` required for tool/skill; omit for reasoning. Without `?preview=1` → full `.md` attachment)
- Payload: `GET /api/payloads/:hash` → full `ContextPayload` JSON (viewer shows `content`)

## Context menu actions

On session / subagent blueprint nodes:

| Action | What it does |
|---|---|
| **view transcript** | Floating interactive transcript for that session (or child) |
| **open context** | Floating viewer for reconstructed session context (preview-capped when large) |
| **open context in …** | Materialize full context to `~/.config/threadle/tmp/*.md` and open in your editor |
| **copy path** | Absolute project / file path to the clipboard |
| **download context** | Full context markdown download |
| **→ workflow · reference** | Store context in the library tagged `reference`, seed a new workflow with that context node |
| **library · reference** | Store + tag only — find it under Library / palette › library (filter `reference`) and drag onto any graph |
| **view reasoning** | Floating dump of every thinking block (subagent / reasoning node) |
| **⌗ open blueprint** | Push the child blueprint (subagent only) |

On tool / skill / reasoning blueprint nodes:

| Action | What it does |
|---|---|
| **view invocations** / **view reasoning** | Floating viewer for the full dump (preview-capped at 1.5 MB when large) |
| **⇓ download invocations** / **⇓ download reasoning** | Uncapped markdown of every call (same as title-bar ⇓) |

On ❝ context-payload nodes:

| Action | What it does |
|---|---|
| **view context** | Floating viewer for the payload body |
| **⇓ download payload** | Raw payload JSON |

On file-backed nodes: **open** / **open in …** / **copy path** / **copy content**.

### Context → workflow (reference)

1. On a session (or subagent) blueprint node: **→ workflow · reference**.
2. threadle snapshots the same markdown as **open context**, stores it as a
   `transcript-excerpt` payload, and tags it **`reference`**.
3. A new graph opens with one pre-materialized **context** node — wire it into
   agents / converters as usual.
4. To reuse later in *another* graph: Library or palette › library, search
   `reference`, drag onto the canvas.

Canvas run actions (**run from this node**, mute, …) stay below those file
actions when a path is present.

## Trust / limits

- Paths must be absolute local files. The server never writes them; it only
  reads for the viewer / clipboard.
- Content that fails the text heuristic (NUL bytes, non-text extensions) is
  rejected — open in your editor instead.
- Highlighting / markdown render skips very large bodies (~200 k chars) and
  falls back to plain text so the UI stays responsive.
- Invocation / reasoning dumps are rebuilt from the session transcript on each
  request (read-only); tool inputs are pretty-printed and capped per call
  (~8 KB) so a single giant Write/Edit payload cannot blow the dump unboundedly.
