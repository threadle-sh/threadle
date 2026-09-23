# Golden fixtures for provider parsers.
# Add anonymized one-line samples when upstream adds record types.
# See docs/provider-freshness.md and CONTRIBUTING.md.
#
# grok/ — full `~/.grok` home layout (set GROK_HOME to this folder in tests):
#   sessions/project/<id>/{summary,chat_history,updates,usage,plan*}  (+ .cwd → /tmp/grok-fx)
#   Three sessions: plan-mode, no-plan, updates-only (no chat_history).
#
# muse/ — `MUSE_DATA_DIR` share layout:
#   sessions/<uuid>/session.jsonl  (MSP; unknown payload types must skip)
#   sessions/<uuid>/subagent/<child-uuid>/session.jsonl  (parent→child lineage)
