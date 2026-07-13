# doggypile

Chat with local coding agents from your phone using a browser PWA. doggypile runs a local daemon on your computer, pairs your phone with a QR code, and streams sessions over iroh.

doggypile is a PWA-focused version of [`litter`](https://github.com/dnakov/litter).

## Install

Requires at least one supported local coding-agent CLI to be installed and authenticated.

```sh
curl -fsSL https://raw.githubusercontent.com/mrjoedang/doggypile/main/install.sh | sh
```

One command does everything: installs the binary, registers the daemon to start automatically at login (launchd on macOS, systemd on Linux), starts it, and prints a pairing QR. Scan the QR with your phone, or open the printed URL.

To pair another device later, run `doggypile` again.

## Commands

```sh
doggypile            # make sure the daemon is running + print a pairing QR
doggypile status     # show daemon status
doggypile pair       # print a fresh pairing URL + QR
doggypile web        # serve the embedded PWA locally on :8123
doggypile stop       # stop the daemon (autostart will respawn it)
doggypile uninstall  # remove the login autostart and stop the supervised daemon
```

The daemon stays in the background and comes back on its own after crashes and reboots. To actually get rid of it, use `doggypile uninstall`.

Pairing URLs are one-time use. Anyone who pairs gets code execution through the local agent, so only share pairing links with devices you trust.

## Development

`bun dev` builds the daemon, serves `web/` on the LAN, and prints a pairing QR.

For UI work, serve `web/` statically and open `/?mock` for the scripted demo.
