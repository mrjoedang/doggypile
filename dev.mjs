#!/usr/bin/env bun
// Local PWA dev server with three explicit modes:
//   --mock: serve UI with scripted in-browser data; no daemon work.
//   --web: serve local web, pair via installed doggypile on PATH; no local build.
//   --full: build this checkout's daemon, pair via target/debug/doggypile.
// Ctrl-C stops serving. In connected modes, the daemon keeps running.
import { spawn, spawnSync } from 'node:child_process';
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
const modes = ['--mock', '--web', '--full'].filter((arg) => process.argv.includes(arg));
if (modes.length !== 1) {
  console.error('usage: bun dev.mjs --mock | --web | --full');
  process.exit(1);
}
const MODE = modes[0].slice(2);

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

function openBrowser(target) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  const child = spawn(opener, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function pairUrl(bin, baseUrl) {
  const result = spawnSync(bin, ['pair', '--no-qr', '--url', baseUrl], { encoding: 'utf8' });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    console.error(`doggypile: pairing failed via ${bin}`);
    process.exit(1);
  }
  const out = result.stdout.trim();
  const match = out.match(/https?:\/\/\S+#\S+/);
  if (!match) {
    if (out) process.stdout.write(`${out}\n`);
    console.error(`doggypile: could not find pair URL in ${bin} output`);
    process.exit(1);
  }
  return match[0];
}

// 1. in full mode, build the daemon (fast no-op once built)
if (MODE === 'full') {
  console.log('doggypile: building daemon…');
  if (spawnSync('cargo', ['build', '-p', 'doggypile', '--bin', 'doggypile'], { cwd: DAEMON_DIR, stdio: 'inherit' }).status !== 0) {
    console.error('doggypile: daemon build failed'); process.exit(1);
  }
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

// 3. open the right local URL for this mode.
const url = `http://${lanIp()}:${port}`;
const browserUrl = MODE === 'mock' ? `${url}/?mock` : pairUrl(MODE === 'full' ? BIN : 'doggypile', url);
openBrowser(browserUrl);

console.log(`\n  PWA served at ${url}`);
if (MODE === 'mock') {
  console.log(`  Opened mock UI: ${browserUrl}`);
  console.log('  Skipped daemon build/restart/pairing.');
} else {
  console.log(`  Opened paired UI: ${browserUrl}`);
  console.log(MODE === 'web' ? '  Paired via installed `doggypile` on PATH; skipped local daemon build.' : '  Built and paired via this checkout\'s debug daemon.');
}
console.log('  Edits under web/ live-reload connected browsers.');
console.log(MODE === 'mock' ? '  Ctrl-C stops serving.\n' : '  Ctrl-C stops serving. The daemon keeps running; `bun run stop` to stop it.\n');

process.on('SIGINT', () => { server.close(); process.exit(0); });
