#!/usr/bin/env bash
# Local smoke: build, pack, install tarball, run --help / templates / check.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build
npm pack -w threadle
TGZ="$(ls -1 threadle-*.tgz | head -1)"
test -n "$TGZ"
SMOKE="$(mktemp -d)"
cleanup() { rm -rf "$SMOKE"; rm -f "$ROOT/$TGZ"; }
trap cleanup EXIT

cd "$SMOKE"
npm install "$ROOT/$TGZ"
npx threadle --help | grep -q threadle
npx threadle templates | grep -q hello-wire
npx threadle check || true
echo "ok — pack smoke passed ($TGZ)"
