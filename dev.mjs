#!/usr/bin/env bun
// One-command local dev: build the daemon, serve the PWA on the LAN, ensure the
// daemon is running, and print a QR that opens the PWA already paired.
// The daemon persists in the background (in the background); this process only
// holds the static web server open. Ctrl-C stops serving (daemon keeps running;
// `bun run stop` to stop it).
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = join(ROOT, 'web');
const DAEMON_DIR = join(ROOT, 'daemon');
const BIN = join(DAEMON_DIR, 'target', 'debug', 'doggypile');
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
if (spawnSync('cargo', ['build', '-p', 'doggypile', '--bin', 'doggypile'], { cwd: DAEMON_DIR, stdio: 'inherit' }).status !== 0) {
  console.error('doggypile: daemon build failed'); process.exit(1);
}

// 2. serve web/ on the LAN (browsers need correct wasm/module content types).
// Live reload is injected server-side so the files on disk stay identical to
// what ships; `cache-control: no-store` because phones cache aggressively.
const RELOAD_SCRIPT = '<script>new EventSource("/__reload").addEventListener("reload", () => location.reload());</script>';
const reloadClients = new Set();

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(':ok\n\n');
      reloadClients.add(res);
      req.on('close', () => reloadClients.delete(res));
      return;
    }
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    const file = normalize(join(WEB, path));
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = body.toString().replace('</html>', `${RELOAD_SCRIPT}\n</html>`);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});

let reloadTimer = null;
watch(WEB, { recursive: true }, () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const res of reloadClients) res.write('event: reload\ndata: 1\n\n');
  }, 100);
});

// :8123 is also `doggypile web`'s port, so fall through to the next free one.
let port = PORT;
for (;;) {
  try {
    await new Promise((resolve, reject) => {
      const onError = (e) => reject(e);
      server.once('error', onError);
      server.listen(port, '0.0.0.0', () => { server.off('error', onError); resolve(); });
    });
    break;
  } catch (e) {
    if (e.code !== 'EADDRINUSE' || port >= PORT + 9) {
      console.error(`doggypile: can’t listen on ${port}: ${e.message}`);
      process.exit(1);
    }
    port++;
  }
}
if (port !== PORT) console.log(`doggypile: port ${PORT} busy (another bun dev, or \`doggypile web\`?) — using ${port}`);

// 3. ensure the daemon is up and print the pairing URL + QR pointed at this server
const url = `http://${lanIp()}:${port}`;
console.log('');
if (spawnSync(BIN, ['pair', '--url', url], { stdio: 'inherit' }).status !== 0) {
  console.error('doggypile: pairing failed (is `codex` on PATH?)'); process.exit(1);
}
console.log(`\n  PWA served at ${url}  —  open the URL above or scan the QR (phone on same wifi).`);
console.log(`  UI-only mode (no daemon needed): ${url}/?mock`);
console.log('  Edits under web/ live-reload connected browsers.');
console.log('  Ctrl-C stops serving. The daemon keeps running; `bun run stop` to stop it.\n');

process.on('SIGINT', () => { server.close(); process.exit(0); });
