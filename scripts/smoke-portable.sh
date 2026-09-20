#!/usr/bin/env bash
# Smoke-test the portable (curl-install) layout without GitHub Releases.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PLATFORM="${1:-}"
if [[ -z "$PLATFORM" ]]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in darwin) os=darwin ;; linux) os=linux ;; *) echo "unsupported OS"; exit 1 ;; esac
  case "$arch" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "unsupported arch"; exit 1 ;; esac
  PLATFORM="${os}-${arch}"
fi

VERSION="$(node -p "require('./packages/server/package.json').version")"
OUT="$ROOT/dist/portable/smoke-threadle-${VERSION}-${PLATFORM}"

bash "$ROOT/scripts/pack-portable.sh" --platform "$PLATFORM" --version "$VERSION" --out "$OUT"

"$OUT/bin/threadle" --help | grep -q threadle
"$OUT/bin/threadle" templates | grep -q hello-wire
"$OUT/bin/threadle" check || true

# Simulate install layout: symlink into a temp bin dir
BIN="$(mktemp -d)"
ln -sfn "$OUT/bin/threadle" "$BIN/threadle"
"$BIN/threadle" --help | grep -q threadle

echo "ok — portable smoke passed ($PLATFORM)"
