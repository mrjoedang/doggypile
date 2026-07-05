# doggypile

Chat with a Codex agent from your phone using a browser PWA. doggypile runs a local daemon on your computer, pairs your phone with a QR code, and streams sessions over iroh.

## Install

Requirements:

- Bun
- Rust/Cargo
- `codex` CLI on your PATH

Clone and install dependencies:

```sh
git clone https://github.com/mrjoedang/doggypile.git
cd doggypile
bun install
```

## Usage

Start everything for local testing:

```sh
bun run dev
```

Scan the printed QR code with your phone, or open the printed URL. The daemon keeps running in the background; Ctrl-C only stops the local web server.

Useful commands:

```sh
bun run pair      # print a fresh pairing URL + QR
bun run daemon    # run the daemon
bun run web       # serve the PWA locally on :8123
bun run stop      # stop the daemon
```

Pairing URLs are one-time use. Anyone who pairs gets code execution through the local Codex agent, so only share pairing links with devices you trust.
