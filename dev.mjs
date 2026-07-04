#!/usr/bin/env bun
// One-command local dev: build the daemon, serve the PWA on the LAN, ensure the
// daemon is running, and print a QR that opens the PWA already paired.
// The daemon persists in the background (like kittylitter); this process only
// holds the static web server open. Ctrl-C stops serving (daemon keeps running;
// `bun run stop` to stop it).
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = join(ROOT, 'web');
const DAEMON_DIR = join(ROOT, 'daemon');
const BIN = join(DAEMON_DIR, 'target', 'debug', 'alleycat');
const PORT = Number(process.env.PORT || 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function lanIp() {
  if (process.env.DOGGYPILE_HOST) return process.env.DOGGYPILE_HOST;

  const nets = networkInterfaces();
  const ipv4 = (name) => (nets[name] || []).find((a) => a.family === 'IPv4' && !a.internal)?.address;

  // On macOS, Object.values(networkInterfaces()) may list bridge/vpn interfaces
  // before Wi‑Fi. QR URLs must use the LAN address the phone can actually reach.
  for (const name of ['en0', 'en1']) {
    const addr = ipv4(name);
    if (addr) return addr;
  }

  const bad = /^(bridge|utun|awdl|llw|lo)/;
  for (const [name, addrs] of Object.entries(nets)) {
    if (bad.test(name)) continue;
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }

  for (const addrs of Object.values(nets))
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}

// 1. build the daemon (fast no-op once built)
console.log('doggypile: building daemon…');
if (spawnSync('cargo', ['build', '-p', 'alleycat', '--bin', 'alleycat'], { cwd: DAEMON_DIR, stdio: 'inherit' }).status !== 0) {
  console.error('doggypile: daemon build failed'); process.exit(1);
}

// 2. serve web/ on the LAN (browsers need correct wasm/module content types)
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    const file = normalize(join(WEB, path));
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(PORT, '0.0.0.0', r));

// 3. ensure the daemon is up and print the pairing QR pointed at this server
const url = `http://${lanIp()}:${PORT}`;
console.log('');
if (spawnSync(BIN, ['pair', '--url', url, '--qr'], { stdio: 'inherit' }).status !== 0) {
  console.error('doggypile: pairing failed (is `codex` on PATH?)'); process.exit(1);
}
console.log(`\n  📡 PWA served at ${url}  —  scan the QR above (phone on same wifi).`);
console.log('  Ctrl-C stops serving. The daemon keeps running; `bun run stop` to stop it.\n');

process.on('SIGINT', () => { server.close(); process.exit(0); });
