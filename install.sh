#!/usr/bin/env sh
set -eu

REPO="${DOGGYPILE_REPO:-mrjoedang/doggypile}"
INSTALL_DIR="${DOGGYPILE_INSTALL_DIR:-$HOME/.local/bin}"
BIN="$INSTALL_DIR/doggypile"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "doggypile installer requires '$1'" >&2
    exit 1
  }
}

need curl
need tar

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os:$arch" in
  darwin:arm64|darwin:aarch64) label="darwin-arm64" ;;
  linux:x86_64|linux:amd64) label="linux-x64" ;;
  linux:arm64|linux:aarch64) label="linux-arm64" ;;
  *)
    echo "Unsupported platform: $(uname -s) $arch" >&2
    exit 1
    ;;
esac

api="https://api.github.com/repos/$REPO/releases/latest"
tag="$(curl -fsSL "$api" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
if [ -z "$tag" ]; then
  echo "Could not find latest doggypile release for $REPO" >&2
  exit 1
fi

asset="doggypile-${tag}-${label}.tar.gz"
url="https://github.com/$REPO/releases/download/$tag/$asset"
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

echo "Installing doggypile $tag ($label)"
curl -fL "$url" -o "$tmp/$asset"
tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$INSTALL_DIR"
cp "$tmp/doggypile" "$BIN"
chmod 755 "$BIN"

if [ "$(uname -s)" = "Darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
fi

agent_status="missing"
for agent in codex opencode; do
  if command -v "$agent" >/dev/null 2>&1; then
    agent_status="found"
    break
  fi
done

echo "Installed: $BIN"
if [ "$agent_status" = "missing" ]; then
  echo "note: no supported coding-agent CLI found on PATH — install one, or pick one from the phone UI."
fi

# When we have a terminal, finish setup right here: doggypile's bare
# invocation registers the login autostart, starts the daemon, and prints
# the pairing QR. Set DOGGYPILE_NO_START=1 to skip (e.g. in scripts/CI).
if [ -t 1 ] && [ -z "${DOGGYPILE_NO_START:-}" ]; then
  echo ""
  "$BIN"
  exit $?
fi

cat <<MSG

To finish setup (autostart + daemon + pairing QR), run:
  $BIN

If '$INSTALL_DIR' is not on your PATH, add it to your shell profile.
MSG
