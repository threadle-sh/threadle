# Triggers

Example config for `~/.config/threadle/triggers.json`. Used by `threadle daemon`
(and any `threadle` / `threadle serve` process).

**`approveAll: true`** auto-passes approval / live-handoff / wait-idle park gates
with no splice. Omit it (or set `false`) to **skip** gated graphs instead of
running them unattended. Prefer graphs without gates for cron / watch.

See [`triggers.example.json`](triggers.example.json) and the CLI manual
[`docs/cli/manual.md`](../../docs/cli/manual.md) (Triggers section).

```bash
cp examples/triggers/triggers.example.json ~/.config/threadle/triggers.json
# edit graphId, projectDir, cron / paths
threadle daemon
```
