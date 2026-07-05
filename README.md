# doggypile

Chat with a Codex agent from your phone using a browser PWA. doggypile runs a local daemon on your computer, pairs your phone with a QR code, and streams sessions over iroh.

## Install

Requires the `codex` CLI to be installed and authenticated.

```sh
curl -fsSL https://raw.githubusercontent.com/mrjoedang/doggypile/main/install.sh | sh
```

## Usage

Start doggypile and print a pairing QR:

```sh
doggypile
```

Scan the QR code with your phone, or open the printed URL.

Useful commands:

```sh
doggypile pair      # print a fresh pairing URL + QR
doggypile serve     # run the daemon
doggypile web       # serve the embedded PWA locally on :8123
doggypile stop      # stop the daemon
doggypile status    # show daemon status
```

Pairing URLs are one-time use. Anyone who pairs gets code execution through the local Codex agent, so only share pairing links with devices you trust.
