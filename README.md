# doggypile

Chat with local coding agents from your phone using a browser PWA. doggypile runs a local daemon on your computer, pairs your phone with a QR code, and streams sessions over iroh.

doggypile is a PWA-focused version of [`litter`](https://github.com/dnakov/litter).

## Install

Requires at least one supported local coding-agent CLI to be installed and authenticated.

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

## Development

`bun dev` builds the daemon, serves `web/` on the LAN, and prints a pairing QR.

For UI work, serve `web/` statically and open `/?mock` for the scripted demo.
