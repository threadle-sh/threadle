#!/usr/bin/env bash
# GitHub Actions: build portable archives for all platforms and upload.
# Also usable locally: PLATFORM=linux-x64 scripts/release-artifacts.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./packages/server/package.json').version")"
OUT_DIR="$ROOT/dist/portable"
PLATFORMS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64)

if [[ -n "${PLATFORM:-}" ]]; then
  PLATFORMS=("$PLATFORM")
fi

echo "building threadle ${VERSION}…"
npm ci
npm run build

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/SHA256SUMS "$OUT_DIR"/threadle-*.tar.gz "$OUT_DIR"/threadle-*.sha256 2>/dev/null || true

for p in "${PLATFORMS[@]}"; do
  echo "=== packing $p ==="
  bash "$ROOT/scripts/pack-portable.sh" \
    --platform "$p" \
    --version "$VERSION" \
    --out "$OUT_DIR/threadle-${VERSION}-${p}" \
    --tarball
done

# Combined checksum file for install.sh
: >"$OUT_DIR/SHA256SUMS"
for f in "$OUT_DIR"/threadle-*.tar.gz; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  if command -v shasum >/dev/null 2>&1; then
    sum="$(shasum -a 256 "$f" | awk '{print $1}')"
  else
    sum="$(sha256sum "$f" | awk '{print $1}')"
  fi
  echo "${sum}  ${base}" >>"$OUT_DIR/SHA256SUMS"
done

echo "artifacts:"
ls -lh "$OUT_DIR"/threadle-*.tar.gz "$OUT_DIR"/SHA256SUMS
