#!/usr/bin/env bash
# Build the browser iroh transport wasm into web/vendor/iroh/.
# One-time-ish: rerun only when wasm/src changes. Output is committed so the
# PWA (and GitHub Pages) needs no toolchain.
set -euo pipefail
cd "$(dirname "$0")"
source "$HOME/.cargo/env" 2>/dev/null || true

# ring (via iroh's tls-ring) compiles C for wasm32; macOS system clang can't
# target wasm, so use Homebrew LLVM's clang/llvm-ar.
LLVM="$(brew --prefix llvm 2>/dev/null)"
if [ -n "$LLVM" ] && [ -x "$LLVM/bin/clang" ]; then
  export CC_wasm32_unknown_unknown="$LLVM/bin/clang"
  export AR_wasm32_unknown_unknown="$LLVM/bin/llvm-ar"
fi

OUT="../web/vendor/iroh"
wasm-pack build --release --target web --out-dir "$OUT" --out-name doggypile_transport
# wasm-pack writes a package.json/.gitignore we don't want in the web tree.
rm -f "$OUT/package.json" "$OUT/.gitignore" "$OUT/README.md"
echo "built -> web/vendor/iroh/"
