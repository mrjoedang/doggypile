#!/usr/bin/env sh
set -eu

REPO="${DOGGYPILE_REPO:-mrjoedang/doggypile}"
INSTALL_DIR="${DOGGYPILE_INSTALL_DIR:-$HOME/.local/bin}"
BIN="$INSTALL_DIR/doggypile"

# Quiet-ledger output: each step prints a pending line that is rewritten in
# place to a ✓/✗ when it resolves. Rewrites and color only happen on an
# interactive stderr without NO_COLOR; pipes and CI get plain lines.
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && command -v tput >/dev/null 2>&1 && tput setaf 2 >/dev/null 2>&1; then
  live=1
  green="$(tput setaf 2)" red="$(tput setaf 1)" yellow="$(tput setaf 3)"
  bold="$(tput bold)" dim="$(tput dim)" reset="$(tput sgr0)"
else
  live=""
  green="" red="" yellow="" bold="" dim="" reset=""
fi

step() {
  if [ -n "$live" ]; then printf '%s⠿ %s…%s' "$dim" "$1" "$reset" >&2; fi
}
clr() {
  if [ -n "$live" ]; then printf '\r\033[2K' >&2; fi
}
ok() {
  clr
  printf '%s✓%s %s\n' "$green" "$reset" "$1" >&2
}
warn() {
  clr
  printf '%s!%s %s\n' "$yellow" "$reset" "$1" >&2
}
fail() {
  clr
  printf '%s✗%s %s\n' "$red" "$reset" "$1" >&2
  shift
  for hint; do printf '  %s%s%s\n' "$dim" "$hint" "$reset" >&2; done
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "doggypile installer requires '$1'"
}

need curl
need tar

printf '%sdoggypile%s %sinstaller ─────────────────────────────────%s\n\n' "$bold" "$reset" "$dim" "$reset" >&2

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os:$arch" in
  darwin:arm64|darwin:aarch64) label="darwin-arm64" ;;
  linux:x86_64|linux:amd64) label="linux-x64" ;;
  linux:arm64|linux:aarch64) label="linux-arm64" ;;
  *)
    fail "unsupported platform: $(uname -s) $arch" \
      "doggypile ships prebuilt binaries for: darwin-arm64 · linux-x64 · linux-arm64" \
      "build from source: https://github.com/$REPO#from-source"
    ;;
esac
ok "platform ${bold}${label}${reset}"

# Probe any existing install so the release line can say whether this is a
# fresh install, an upgrade, or a reinstall. clap's --version prints
# "doggypile 0.3.0" and exits; release tags carry a leading v.
have=""
if [ -x "$BIN" ]; then
  have="$("$BIN" --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -n 1 || true)"
  if [ -n "$have" ]; then have="v$have"; fi
fi
strip_v() { printf '%s' "$1" | sed 's/^v//'; }

step "resolving latest release"
api="https://api.github.com/repos/$REPO/releases/latest"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  body="$(curl -sSL -H "Authorization: Bearer $GITHUB_TOKEN" "$api" 2>/dev/null || true)"
else
  body="$(curl -sSL "$api" 2>/dev/null || true)"
fi
tag="$(printf '%s\n' "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
if [ -z "$tag" ]; then
  case "$body" in
    *"rate limit"*)
      fail "GitHub API rate limit reached" \
        "this is temporary — retry in a few minutes, or set GITHUB_TOKEN to authenticate"
      ;;
    "")
      fail "could not reach the GitHub API" \
        "check your network connection, then retry" \
        "releases: https://github.com/$REPO/releases"
      ;;
    *)
      fail "could not find the latest release for $REPO" \
        "check https://github.com/$REPO/releases"
      ;;
  esac
fi
if [ -z "$have" ]; then
  rel_note="(fresh install)"
elif [ "$(strip_v "$have")" = "$(strip_v "$tag")" ]; then
  rel_note="(you have $have — reinstalling)"
else
  rel_note="(you have $have — upgrading)"
fi
ok "latest release ${bold}${tag}${reset}  ${dim}${rel_note}${reset}"

asset="doggypile-${tag}-${label}.tar.gz"
url="https://github.com/$REPO/releases/download/$tag/$asset"
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

if [ -n "$live" ]; then
  # curl's single-line bar draws on stderr; once it finishes, replace its
  # completed bar with the ✓ line.
  if ! curl -fL --progress-bar "$url" -o "$tmp/$asset"; then
    fail "download failed" "$url"
  fi
  printf '\033[1A\033[2K\r' >&2
else
  if ! curl -fsSL "$url" -o "$tmp/$asset"; then
    fail "download failed" "$url"
  fi
fi
size="$(du -h "$tmp/$asset" | cut -f1 | tr -d ' ')"
ok "downloaded ${dim}${asset} · ${size}${reset}"

# Verify the asset when the release publishes a .sha256 beside it; skip
# quietly when it doesn't (older releases) or no sha tool exists.
if curl -fsSL "$url.sha256" -o "$tmp/$asset.sha256" 2>/dev/null; then
  step "verifying checksum"
  want="$(awk '{print $1; exit}' "$tmp/$asset.sha256")"
  if command -v sha256sum >/dev/null 2>&1; then
    got="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    got="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
  else
    got=""
  fi
  if [ -z "$got" ]; then
    clr
  elif [ "$got" = "$want" ]; then
    ok "checksum verified"
  else
    fail "checksum mismatch for $asset" \
      "the download was corrupted or tampered with — nothing was installed" \
      "try again; if it persists, open an issue: https://github.com/$REPO/issues"
  fi
fi

step "installing"
tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$INSTALL_DIR"
# Swap the binary in with an atomic rename, never an in-place copy. On macOS,
# overwriting a Mach-O at a path a process is already running from (the
# daemon, during an upgrade) poisons the kernel's per-vnode code-signature
# cache, and every subsequent exec of that path dies with SIGKILL. A rename
# installs a fresh inode; the running daemon keeps the old one until restart.
chmod 755 "$tmp/doggypile"
if [ "$(uname -s)" = "Darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$tmp/doggypile" 2>/dev/null || true
fi
mv -f "$tmp/doggypile" "$BIN"
disp="$BIN"
case "$BIN" in "$HOME"/*) disp="~${BIN#"$HOME"}" ;; esac
ok "installed ${dim}→${reset} $disp"

agents_line="agents"
agents_found=""
for agent in codex opencode; do
  if command -v "$agent" >/dev/null 2>&1; then
    agents_line="$agents_line ${dim}·${reset} $agent ${green}✓${reset}"
    agents_found=1
  else
    agents_line="$agents_line ${dim}· $agent —${reset}"
  fi
done
ok "$agents_line"
if [ -z "$agents_found" ]; then
  warn "no agent CLI found ${dim}(looked for codex, opencode)${reset} — install one, or pick one from the phone UI"
fi

echo "" >&2
if [ -z "$have" ]; then
  printf '%sInstalled doggypile %s%s\n' "$bold" "$tag" "$reset" >&2
elif [ "$(strip_v "$have")" = "$(strip_v "$tag")" ]; then
  printf '%sReinstalled doggypile %s%s\n' "$bold" "$tag" "$reset" >&2
else
  printf '%sUpgraded %s → %s%s\n' "$bold" "$have" "$tag" "$reset" >&2
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    case "${SHELL:-}" in
      */zsh)  rc="~/.zshrc";  add="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
      */fish) rc="~/.config/fish/config.fish"; add="fish_add_path $INSTALL_DIR" ;;
      *)      rc="~/.bashrc"; add="export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
    esac
    echo "" >&2
    warn "${bold}$INSTALL_DIR${reset} is not on your PATH — add it ${dim}($rc)${reset}:"
    printf '\n    %s\n' "$add" >&2
    ;;
esac

# When we have a terminal, finish setup right here: doggypile's bare
# invocation registers the login autostart, starts the daemon, and prints
# the pairing QR. Set DOGGYPILE_NO_START=1 to skip (e.g. in scripts/CI).
if [ -t 1 ] && [ -z "${DOGGYPILE_NO_START:-}" ]; then
  echo "" >&2
  printf '%sstarting doggypile — autostart + pairing QR below%s\n\n' "$dim" "$reset" >&2
  "$BIN"
  exit $?
fi

cat >&2 <<MSG

To finish setup (autostart + daemon + pairing QR), run:
  $disp
MSG
