#!/usr/bin/env bash
# Install threadle from GitHub Releases (portable Node + app — no npm required).
#
#   curl -fsSL https://threadle.sh/install.sh | bash
#
# Env:
#   THREADLE_VERSION     — release version or tag (0.9.0 or v0.9.0; default: latest)
#   THREADLE_INSTALL_DIR — default ~/.local/share/threadle
#   THREADLE_BIN_DIR     — default ~/.local/bin
#   THREADLE_REPO        — default threadle-sh/threadle
#   THREADLE_PLATFORM    — override darwin-arm64|darwin-x64|linux-x64|linux-arm64
set -euo pipefail

REPO="${THREADLE_REPO:-threadle-sh/threadle}"
INSTALL_DIR="${THREADLE_INSTALL_DIR:-${HOME}/.local/share/threadle}"
BIN_DIR="${THREADLE_BIN_DIR:-${HOME}/.local/bin}"
VERSION="${THREADLE_VERSION:-}"
# GitHub release tag as published (may include leading v). Used for asset URLs.
TAG=""

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die() { printf 'threadle install: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "need '$1' on PATH"
}

need_cmd curl
need_cmd tar
need_cmd uname
need_cmd mktemp

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    darwin) os="darwin" ;;
    linux) os="linux" ;;
    *) die "unsupported OS: $(uname -s) (macOS/Linux only for now)" ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) die "unsupported arch: $arch" ;;
  esac
  echo "${os}-${arch}"
}

PLATFORM="${THREADLE_PLATFORM:-$(detect_platform)}"

# Probe which tag form has the release assets (bare X.Y.Z or vX.Y.Z).
resolve_tag_for_version() {
  local ver="$1" candidate
  for candidate in "$ver" "v${ver}"; do
    if curl -fsSI "https://github.com/${REPO}/releases/download/${candidate}/SHA256SUMS" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
  # Fall back to bare version — download step will surface the real error.
  echo "$ver"
}

resolve_version() {
  if [[ -n "$VERSION" ]]; then
    VERSION="${VERSION#v}"
    TAG="$(resolve_tag_for_version "$VERSION")"
    return
  fi
  # latest release tag via GitHub API (no jq required)
  local json tag
  json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")" || die "could not fetch latest release for ${REPO}"
  tag="$(printf '%s' "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [[ -n "$tag" ]] || die "no releases found for ${REPO}"
  TAG="$tag"
  VERSION="${tag#v}"
}

resolve_version
ASSET="threadle-${VERSION}-${PLATFORM}.tar.gz"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
ASSET_URL="${BASE_URL}/${ASSET}"
SUMS_URL="${BASE_URL}/SHA256SUMS"

bold "threadle install"
info "version   ${VERSION} (tag ${TAG})"
info "platform  ${PLATFORM}"
info "prefix    ${INSTALL_DIR}"
info "bin       ${BIN_DIR}/threadle"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

info "downloading ${ASSET}…"
curl -fsSL "$ASSET_URL" -o "$TMP/$ASSET" || die "download failed: $ASSET_URL"

info "verifying checksum…"
curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS" || die "checksum file missing: $SUMS_URL"
EXPECTED="$(grep -E "[[:space:]]${ASSET}\$" "$TMP/SHA256SUMS" | awk '{print $1}' | head -1)"
[[ -n "$EXPECTED" ]] || die "no checksum entry for ${ASSET} in SHA256SUMS"
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
else
  ACTUAL="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
fi
[[ "$ACTUAL" == "$EXPECTED" ]] || die "checksum mismatch (got $ACTUAL, want $EXPECTED)"

info "extracting…"
mkdir -p "$INSTALL_DIR"
# Replace previous install atomically-ish
STAGE="$INSTALL_DIR/.stage-$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf "$TMP/$ASSET" -C "$STAGE"
# Tarball contains a single top-level dir threadle-VERSION-PLATFORM
INNER="$(echo "$STAGE"/threadle-*)"
[[ -d "$INNER" ]] || die "unexpected archive layout"
# Move contents to INSTALL_DIR
rm -rf "$INSTALL_DIR/node" "$INSTALL_DIR/app" "$INSTALL_DIR/bin"
mv "$INNER/node" "$INNER/app" "$INNER/bin" "$INSTALL_DIR/"
rm -rf "$STAGE"
chmod +x "$INSTALL_DIR/bin/threadle" "$INSTALL_DIR/node/bin/node"

mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/threadle" "$BIN_DIR/threadle"

if ! "$BIN_DIR/threadle" --help >/dev/null 2>&1; then
  die "installed binary failed --help"
fi

bold "installed"
info "run:  threadle"
info "ui:   http://127.0.0.1:4570 (after start)"
info "check: threadle check"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    bold "PATH note"
    info "$BIN_DIR is not on your PATH. Add:"
    info "  export PATH=\"$BIN_DIR:\$PATH\""
    info "to your shell rc, then re-open the terminal."
    ;;
esac
