#!/usr/bin/env bash
# Build a portable threadle release tree:
#   <out>/node/     — official Node.js binary for PLATFORM
#   <out>/app/      — dist/, web-dist/, production node_modules
#   <out>/bin/threadle — wrapper
#
# Usage:
#   scripts/pack-portable.sh [--platform darwin-arm64] [--version 0.1.0] [--out dist/portable]
#   scripts/pack-portable.sh --tarball   # also write threadle-${VERSION}-${PLATFORM}.tar.gz + .sha256
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${THREADLE_NODE_VERSION:-26.9.0}"
PLATFORM=""
VERSION=""
OUT=""
MAKE_TARBALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="${2:?}"; shift 2 ;;
    --version) VERSION="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --node-version) NODE_VERSION="${2:?}"; shift 2 ;;
    --tarball) MAKE_TARBALL=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    darwin) os="darwin" ;;
    linux) os="linux" ;;
    *) echo "unsupported OS: $os" >&2; exit 1 ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "unsupported arch: $arch" >&2; exit 1 ;;
  esac
  echo "${os}-${arch}"
}

HOST_PLATFORM="$(detect_platform)"
if [[ -z "$PLATFORM" ]]; then
  PLATFORM="$HOST_PLATFORM"
fi

case "$PLATFORM" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64) ;;
  *)
    echo "unsupported platform: $PLATFORM (want darwin-arm64|darwin-x64|linux-x64|linux-arm64)" >&2
    exit 1
    ;;
esac

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT/packages/server/package.json').version")"
fi

if [[ -z "$OUT" ]]; then
  OUT="$ROOT/dist/portable/threadle-${VERSION}-${PLATFORM}"
fi

NODE_OS="${PLATFORM%-*}"
NODE_ARCH="${PLATFORM#*-}"
NODE_NAME="node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_NAME}.tar.gz"

echo "packing threadle ${VERSION} for ${PLATFORM} (node ${NODE_VERSION})"
echo "  out: $OUT"

rm -rf "$OUT"
mkdir -p "$OUT/app" "$OUT/bin" "$OUT/node"

# --- app (JS is platform-independent) ---
cd "$ROOT"
if [[ ! -f packages/server/dist/cli.js ]] || [[ ! -f packages/server/web-dist/index.html ]]; then
  echo "building web + server…"
  npm run build
fi

cp -R packages/server/dist "$OUT/app/dist"
cp -R packages/server/web-dist "$OUT/app/web-dist"
# Minimal package.json for resolving production deps
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const out = {
  name: "threadle",
  version: pkg.version,
  type: "module",
  private: true,
  dependencies: pkg.dependencies,
};
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + "\n");
' "$ROOT/packages/server/package.json" "$OUT/app/package.json"
echo "installing production dependencies…"
(
  cd "$OUT/app"
  npm install --omit=dev --ignore-scripts --no-package-lock --no-fund --no-audit
)

# Drop npm metadata noise
rm -rf "$OUT/app/node_modules/.package-lock.json" 2>/dev/null || true

# --- portable Node ---
CACHE="${THREADLE_NODE_CACHE:-$ROOT/dist/portable/.node-cache}"
mkdir -p "$CACHE"
TGZ="$CACHE/${NODE_NAME}.tar.gz"
if [[ ! -f "$TGZ" ]]; then
  echo "downloading $NODE_URL"
  curl -fsSL "$NODE_URL" -o "$TGZ"
fi

TMP_NODE="$(mktemp -d)"
trap 'rm -rf "$TMP_NODE"' EXIT
tar -xzf "$TGZ" -C "$TMP_NODE"
# Official tarball is a single top-level dir
NODE_SRC="$(echo "$TMP_NODE"/$NODE_NAME)"
if [[ ! -x "$NODE_SRC/bin/node" ]]; then
  echo "node binary missing in $NODE_SRC" >&2
  exit 1
fi
# Keep a slim node tree (bin + lib for npm-less runtime; we only need bin/node + shared libs)
cp -R "$NODE_SRC/bin" "$OUT/node/bin"
cp -R "$NODE_SRC/lib" "$OUT/node/lib"
cp -R "$NODE_SRC/share" "$OUT/node/share" 2>/dev/null || true
# LICENSE
cp "$NODE_SRC/LICENSE" "$OUT/node/LICENSE" 2>/dev/null || true

# --- wrapper ---
cp "$ROOT/scripts/threadle-wrapper.sh" "$OUT/bin/threadle"
chmod +x "$OUT/bin/threadle" "$OUT/node/bin/node"

# Sanity: bundled node can load the CLI — only runnable when we packed for the
# host platform. release-artifacts.sh cross-packs all four platforms from one
# runner; a foreign-arch node binary can't exec here, so skip the check then
# (smoke-portable.sh covers the host build).
if [[ "$PLATFORM" == "$HOST_PLATFORM" ]]; then
  "$OUT/node/bin/node" --version >/dev/null
  "$OUT/bin/threadle" --help >/dev/null
else
  echo "  (cross-pack for $PLATFORM on host $HOST_PLATFORM — skipping run sanity check)"
fi

echo "ok — portable tree at $OUT"

if [[ "$MAKE_TARBALL" -eq 1 ]]; then
  PARENT="$(dirname "$OUT")"
  BASE="$(basename "$OUT")"
  ARCHIVE="$PARENT/${BASE}.tar.gz"
  (
    cd "$PARENT"
    tar -czf "$ARCHIVE" "$BASE"
  )
  (
    cd "$PARENT"
    if command -v shasum >/dev/null 2>&1; then
      shasum -a 256 "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256"
    else
      sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256"
    fi
  )
  echo "ok — archive $ARCHIVE"
  echo "     checksum ${ARCHIVE}.sha256"
fi
