# Viewer dogfood notes

Product loop: open threadle to **check sessions and spend**, not to draw graphs. Use Sessions, Projects, Statistics, Search daily; file issues when something hurts.

## How

```sh
npm run dev   # or `npx threadle` after install
```

Walk: **Sessions** → open a recent run → Blueprint / Growth → **Statistics** → **Projects** (group dirs) → **Search**. Skip Wire unless you are fixing a break.

## Pain points (seed — update as you dogfood)

Logged while landing viewer-first / Projects v1 (2026-09-24). Promote to issues when they bite again.

| Area | Note |
|---|---|
| Projects | Multi-repo bags only; no CLI “list projects” APIs — dirs come from session `projectDir` aggregation + manual attach. |
| Projects | Unassigned dirs can be large (15+ locally); no bulk-assign / suggest-by-prefix yet. |
| Projects | Empty pinned projects (name only, no dirs) still appear in the gallery with zero sessions — easy demo residue. |
| Projects | Workflow attach is optional beta surface on the project detail — easy to confuse with “orchestration OS”. Keep it secondary. |
| Sessions | Default home is still easy to lose under Library / Wire beta if nav habits drift — keep Build→Projects and Review→Sessions as the main road. |
| Statistics | Spend is the wedge; keep weft-style spend folded here (no second product). `/api/usage` OK in smoke. |
| Providers | Parser / CLI flag drift is the real maintenance job — see [provider-freshness.md](provider-freshness.md). |

## Launch signal

After others use it:

- Issues are spend / sessions / search → stay viewer-first.
- Canvas ignored → freeze Wire harder.
- Canvas hot → then revisit extract (not before).
