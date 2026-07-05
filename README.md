# 🐕 doggypile

Chat with a [codex](https://github.com/openai/codex) agent from your phone —
from anywhere, over [iroh](https://www.iroh.computer). No app store, no VPN, no
same-network requirement.

doggypile is a **browser PWA client** for a forked [alleycat](https://github.com/dnakov/alleycat)
daemon. alleycat already does the hard part — an iroh-backed daemon that
multiplexes local coding agents for paired clients — it just never had a browser
client. doggypile is that client.

## Architecture

```
 phone browser ──iroh (relay, e2e-encrypted)──▶ alleycat daemon ──▶ codex app-server (loopback)
   hosted PWA        dial NodeId + token            (our fork)          agent=codex, ws wire
```

- **daemon/** — our fork of alleycat (GPL-3.0), pinned to **iroh 1.0.0** so it
  rides n0's **production** relays (upstream tracks a pre-release iroh on the
  *canary* relays). Owns the iroh endpoint, identity, pairing, and the
  codex app-server transport. `pair` prints a PWA URL and matching QR that
  opens this PWA already paired.
- **web/** — the PWA (static, hosted once on GitHub Pages). Dials the daemon's
  NodeId via a wasm iroh transport, does the alleycat handshake, then speaks
  codex's **WebSocket wire** over the QUIC stream (`web/transport.js`), and drives
  codex JSON-RPC directly (`web/rpc.js`, `web/projection.js`).
- **wasm/** — a small Rust crate exposing an iroh duplex byte channel to the
  browser (dial by NodeId + relay). Built once into `web/vendor/iroh/` (committed).

The initial page load must come from a public HTTPS origin (the browser can't
reach the remote daemon before it has code to dial with) — so the PWA is hosted
on Pages, deployed once, and every pairing just points that page at a NodeId.

## Usage

Local testing is one command:

```
bun run dev        # build daemon + serve PWA on the LAN + ensure daemon + print URL + QR
```

Open the printed URL or scan the QR (phone on the same wifi) and the PWA opens
connected. The daemon runs in the background and persists; Ctrl-C only stops
serving. `bun run stop` stops the daemon.

Individual pieces, if you want them:

```
bun run daemon                         # just run the forked daemon (owns codex + iroh)
bun run pair                           # print the hosted PWA URL + matching QR
bun run web                            # just serve web/ on :8123
bun run stop                           # stop the daemon
DOGGYPILE_WEB=http://192.168.1.5:8123 bun run pair   # URL + QR for a local dev PWA
```

Or drive the daemon binary directly (from `daemon/`):

```
cargo run -p alleycat --bin alleycat -- serve         # run the daemon
cargo run -p alleycat --bin alleycat -- pair          # PWA URL + QR
cargo run -p alleycat --bin alleycat -- pair --no-qr  # PWA URL only
cargo run -p alleycat --bin alleycat -- pair --raw    # raw alleycat pair payload + QR
cargo run -p alleycat --bin alleycat -- rotate        # mint a fresh token (revoke paired phones)
cargo run -p alleycat --bin alleycat -- status
```

The daemon needs the `codex` CLI on PATH. Identity + token live in the daemon's
config dir (`~/Library/Application Support/dev.Alleycat.alleycat` on macOS).

Open the URL from `pair` or scan its QR and the PWA opens connected — sessions,
streaming, send/steer, all over iroh.

## ⚡ yolo mode

The PWA drives codex without approval prompts (approving from a phone mid-turn
isn't the experience). Anyone with the pairing URL has code execution on the
host. Use it in trusted environments; `rotate` the token if a URL leaks.

## Build

```
wasm/build.sh                          # rebuild the browser transport (needs rust + Homebrew llvm)
bun run build:daemon                   # build the daemon (release)
```

The PWA itself needs no build step — `web/` is static, with the wasm committed
under `web/vendor/iroh/`.

## Licensing note

doggypile is distributed under **GPL-3.0-only**; see [LICENSE](LICENSE) and
[daemon/LICENSE](daemon/LICENSE). `daemon/` is a fork of alleycat/kittylitter
lineage code, which is GPL-3.0-only. The referenced `litter` project is also
GPL-3.0, with an additional GPLv3 section 7 permission for Apple App Store and
Google Play distribution.

The PWA (`web/`) and wasm crate (`wasm/`) are not separately licensed for reuse
outside this repository at this time. If we want a permissive client later, keep
it clearly separated from the GPL daemon and add an explicit license for that
client package.

## Follow-ups

- **Strip the daemon to codex-only.** The fork still carries all of alleycat's
  agent bridges (claude, pi, opencode, amp, grok, …). codex works and is
  handled in alleycat core (not a bridge), so the others are dead weight for our
  use case — removable from `daemon/Cargo.toml` workspace members, the
  `alleycat` crate deps, and `crates/alleycat/src/agents.rs`.
- Sequence-based resume (`resume:{last_seq}`) is available in the alleycat
  protocol; the PWA currently reseeds via `thread/read` on reconnect instead.

## Reference

`.references/litter` — the mobile codex client this is modeled on; alleycat is
its connectivity substrate.
