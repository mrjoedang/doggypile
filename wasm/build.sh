#!/usr/bin/env bash
# Build and content-address the browser iroh transport wasm.
# One-time-ish: rerun only when wasm/src changes. Output is committed so the
# PWA (and GitHub Pages) needs no toolchain.
set -euo pipefail
cd "$(dirname "$0")"
source "$HOME/.cargo/env" 2>/dev/null || true
if [ -x "$HOME/.cargo/bin/rustup" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

# ring (via iroh's tls-ring) compiles C for wasm32; macOS system clang can't
# target wasm, so use Homebrew LLVM's clang/llvm-ar.
LLVM="$(brew --prefix llvm 2>/dev/null || true)"
if [ -n "$LLVM" ] && [ -x "$LLVM/bin/clang" ]; then
  export CC_wasm32_unknown_unknown="$LLVM/bin/clang"
  export AR_wasm32_unknown_unknown="$LLVM/bin/llvm-ar"
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/doggypile-wasm.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

wasm-pack build --release --target web --out-dir "$STAGE" --out-name doggypile_transport
node ../scripts/package-wasm.mjs package "$STAGE"
echo "built and packaged -> web/vendor/iroh/"
