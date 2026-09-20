#!/usr/bin/env bash
# Launcher for a portable threadle install (node + app next to this script's parent).
# Layout:
#   <prefix>/bin/threadle   (this file — may be symlinked from ~/.local/bin)
#   <prefix>/node/bin/node
#   <prefix>/app/dist/cli.js
#   <prefix>/app/web-dist/
set -euo pipefail

# Resolve symlinks so PATH links (e.g. ~/.local/bin/threadle) still find the tree.
SOURCE="${BASH_SOURCE[0]:-$0}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  LINK="$(readlink "$SOURCE")"
  if [[ "$LINK" == /* ]]; then
    SOURCE="$LINK"
  else
    SOURCE="$DIR/$LINK"
  fi
done
HERE="$(cd "$(dirname "$SOURCE")" && pwd)"
PREFIX="$(cd "$HERE/.." && pwd)"
NODE="$PREFIX/node/bin/node"
CLI="$PREFIX/app/dist/cli.js"

if [[ ! -x "$NODE" ]]; then
  echo "threadle: bundled Node missing at $NODE" >&2
  echo "Re-run the installer: curl -fsSL https://threadle.sh/install.sh | bash" >&2
  exit 1
fi
if [[ ! -f "$CLI" ]]; then
  echo "threadle: app missing at $CLI" >&2
  echo "Re-run the installer: curl -fsSL https://threadle.sh/install.sh | bash" >&2
  exit 1
fi

exec "$NODE" "$CLI" "$@"
