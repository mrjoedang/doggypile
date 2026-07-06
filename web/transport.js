// Transport: dial the doggypile daemon over iroh (wasm), do the doggypile
// handshake, then speak the selected agent wire over the QUIC stream. Codex
// uses WebSocket frames; JSONL agents such as opencode use newline-delimited
// JSON-RPC directly on the doggypile stream.
//
// Interface is unchanged from the old transport: connect(...) -> { sendLine, close }.
import init, { Channel } from './vendor/iroh/doggypile_transport.js?v=20260705-paths';

const ALPN = new TextEncoder().encode('doggypile/1');
const enc = new TextEncoder();
const dec = new TextDecoder();

let ready;
const ensureInit = () => (ready ??= init());

export async function connect(options) {
  const { agent = 'auto' } = options;
  let token = options.token;
  const onToken = (nextToken) => {
    if (!nextToken) return;
    token = nextToken;
    options.onToken?.(nextToken);
  };

  if (agent !== 'auto') {
    const wire = agent === 'codex' ? 'websocket' : await discoverWire(options, token, agent, onToken);
    return connectAgent({ ...options, token, agent, wire, onToken });
  }

  const agents = await listAgents(options, token, onToken);
  const codex = agents.find((candidate) => candidate.name === 'codex');
  const opencode = agents.find((candidate) => candidate.name === 'opencode');

  if (codex?.available !== false) {
    try {
      return await connectAgent({
        ...options,
        token,
        agent: 'codex',
        wire: codex?.wire || 'websocket',
        onToken,
      });
    } catch (error) {
      if (!opencode?.available) throw error;
      console.warn('[doggypile] codex unavailable; falling back to opencode', error);
      return connectAgent({
        ...options,
        token,
        agent: 'opencode',
        wire: opencode.wire || 'jsonl',
        fallbackFrom: 'codex',
        onToken,
      });
    }
  }

  if (opencode?.available) {
    return connectAgent({
      ...options,
      token,
      agent: 'opencode',
      wire: opencode.wire || 'jsonl',
      fallbackFrom: 'codex',
      onToken,
    });
  }

  const codexStatus = codex ? 'reported unavailable' : 'not advertised';
  const opencodeStatus = opencode ? 'reported unavailable' : 'not advertised';
  throw new Error(`No supported agent is available: codex ${codexStatus}; opencode ${opencodeStatus}`);
}

async function discoverWire(options, token, agent, onToken) {
  const agents = await listAgents(options, token, onToken);
  const info = agents.find((candidate) => candidate.name === agent);
  if (!info) throw new Error(`agent \`${agent}\` is not advertised by the daemon`);
  return info.wire || 'jsonl';
}

async function listAgents({ nodeId, relay, directAddrs = [] }, token, onToken) {
  await ensureInit();
  const ch = await Channel.connect(nodeId, ALPN, relay ?? undefined, directAddrs);
  const io = bufferedIo(ch);
  try {
    await sendJsonFrame(ch, { op: 'list_agents', v: 1, token });
    const resp = await readJsonFrame(io);
    if (!resp.ok) throw new Error(resp.error || 'doggypile list_agents rejected');
    if (resp.auth_token) onToken(resp.auth_token);
    return resp.agents || [];
  } finally {
    ch.close();
  }
}

async function connectAgent({
  nodeId,
  token,
  relay,
  directAddrs = [],
  agent,
  wire,
  fallbackFrom,
  onToken,
  onMetrics,
  onLine,
  onClose,
}) {
  const timings = {};
  const mark = (name, start) => { timings[name] = performance.now() - start; };
  const startedAt = performance.now();
  let t = performance.now();
  await ensureInit();
  mark('wasm', t);
  t = performance.now();
  const ch = await Channel.connect(nodeId, ALPN, relay ?? undefined, directAddrs);
  mark('iroh', t);
  const reportMetrics = () => {
    let path = null;
    try { path = JSON.parse(ch.path_summary()); } catch {}
    onMetrics?.({ total_ms: performance.now() - startedAt, timings: { ...timings }, path, agent, wire, fallbackFrom });
  };
  reportMetrics();
  const pathTimer = setInterval(reportMetrics, 1500);
  const io = bufferedIo(ch);

  try {
    await sendJsonFrame(ch, { op: 'connect', v: 1, token, agent });

    t = performance.now();
    const resp = await readJsonFrame(io);
    mark('auth', t);
    if (!resp.ok) throw new Error(resp.error || 'doggypile handshake rejected');
    if (resp.auth_token) onToken?.(resp.auth_token);

    const normalizedWire = wire || 'websocket';
    if (normalizedWire === 'jsonl') {
      mark('jsonl', performance.now());
      reportMetrics();
      return startJsonlTransport(ch, io, pathTimer, { agent, wire: normalizedWire, fallbackFrom, onLine, onClose });
    }

    return await startWebSocketTransport(ch, io, pathTimer, {
      agent,
      wire: normalizedWire,
      fallbackFrom,
      onLine,
      onClose,
      mark,
      reportMetrics,
    });
  } catch (e) {
    clearInterval(pathTimer);
    ch.close();
    throw e;
  }
}

function bufferedIo(ch) {
  const reader = ch.readable().getReader();
  let buf = new Uint8Array(0);

  async function pull() {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream closed');
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
  }

  async function need(n) {
    while (buf.length < n) await pull();
  }

  function take(n) {
    const out = buf.slice(0, n);
    buf = buf.slice(n);
    return out;
  }

  function takeAll() {
    return take(buf.length);
  }

  function peek(n) {
    return buf[n];
  }

  function view(offset, len) {
    return new DataView(buf.buffer, buf.byteOffset + offset, len);
  }

  function bufferedLength() {
    return buf.length;
  }

  function headerEnd() {
    return findCrlfCrlf(buf);
  }

  return { reader, pull, need, take, takeAll, peek, view, bufferedLength, headerEnd };
}

async function sendJsonFrame(ch, value) {
  const body = enc.encode(JSON.stringify(value));
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  await ch.send(frame);
}

async function readJsonFrame(io) {
  await io.need(4);
  const lenBytes = io.take(4);
  const len = new DataView(lenBytes.buffer, lenBytes.byteOffset, lenBytes.byteLength).getUint32(0, false);
  await io.need(len);
  return JSON.parse(dec.decode(io.take(len)));
}

function startJsonlTransport(ch, io, pathTimer, { agent, wire, fallbackFrom, onLine, onClose }) {
  let closed = false;
  const sendLine = (str) => ch.send(enc.encode(str.endsWith('\n') ? str : `${str}\n`)).catch(() => {});

  (async () => {
    let pending = '';
    const deliver = (text) => {
      pending += text;
      for (;;) {
        const idx = pending.indexOf('\n');
        if (idx < 0) break;
        const line = pending.slice(0, idx).replace(/\r$/, '');
        pending = pending.slice(idx + 1);
        if (line) onLine?.(line);
      }
    };

    try {
      if (io.bufferedLength()) deliver(dec.decode(io.takeAll(), { stream: true }));
      for (;;) {
        const { value, done } = await io.reader.read();
        if (done) break;
        deliver(dec.decode(value, { stream: true }));
      }
      deliver(dec.decode());
      if (pending.trim()) onLine?.(pending.trim());
    } catch { /* stream ended */ }
    finally { clearInterval(pathTimer); if (!closed) onClose?.(); }
  })();

  return { agent, wire, fallbackFrom, sendLine, close: () => { closed = true; clearInterval(pathTimer); ch.close(); } };
}

async function startWebSocketTransport(ch, io, pathTimer, { agent, wire, fallbackFrom, onLine, onClose, mark, reportMetrics }) {
  // --- WebSocket client handshake (RFC 6455) over the stream ---
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const secKey = btoa(String.fromCharCode(...keyBytes));
  await ch.send(enc.encode(
    `GET /${agent} HTTP/1.1\r\nHost: doggypile\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${secKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  ));
  const t = performance.now();
  let he;
  while ((he = io.headerEnd()) < 0) await io.pull();
  const headerText = dec.decode(io.take(he));
  const headerLines = headerText.split('\r\n');
  const statusLine = headerLines[0];
  if (!/\b101\b/.test(statusLine)) {
    const contentLengthLine = headerLines.find((line) => /^content-length\s*:/i.test(line));
    const contentLength = contentLengthLine ? Number(contentLengthLine.split(':').slice(1).join(':').trim()) : 0;
    let body = '';
    if (Number.isFinite(contentLength) && contentLength > 0) {
      await io.need(contentLength);
      body = dec.decode(io.take(contentLength)).trim();
    }
    throw new Error(`ws upgrade failed for ${agent}: ${body || statusLine}`);
  }
  mark('websocket', t);
  reportMetrics();

  const sendFrame = async (opcode, payload) => {
    const mask = crypto.getRandomValues(new Uint8Array(4));
    let head;
    if (payload.length < 126) head = new Uint8Array([0x80 | opcode, 0x80 | payload.length]);
    else if (payload.length < 65536) head = new Uint8Array([0x80 | opcode, 0x80 | 126, (payload.length >> 8) & 255, payload.length & 255]);
    else {
      head = new Uint8Array(10);
      head[0] = 0x80 | opcode; head[1] = 0x80 | 127;
      new DataView(head.buffer).setBigUint64(2, BigInt(payload.length));
    }
    const out = new Uint8Array(head.length + 4 + payload.length);
    out.set(head, 0); out.set(mask, head.length);
    for (let i = 0; i < payload.length; i++) out[head.length + 4 + i] = payload[i] ^ mask[i & 3];
    await ch.send(out);
  };

  let closed = false;
  const sendLine = (str) => sendFrame(0x1, enc.encode(str)).catch(() => {});

  (async () => {
    let assembled = new Uint8Array(0);
    try {
      for (;;) {
        await io.need(2);
        const b0 = io.peek(0), b1 = io.peek(1);
        const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { await io.need(4); len = (io.peek(2) << 8) | io.peek(3); off = 4; }
        else if (len === 127) { await io.need(10); len = Number(io.view(2, 8).getBigUint64(0)); off = 10; }
        await io.need(off + len);
        io.take(off);
        const payload = io.take(len);
        if (opcode === 0x8) break;                       // close
        if (opcode === 0x9) { await sendFrame(0xA, payload); continue; } // ping -> pong
        if (opcode === 0xA) continue;                    // pong
        const merged = new Uint8Array(assembled.length + payload.length);
        merged.set(assembled); merged.set(payload, assembled.length);
        assembled = merged;
        if (fin) { const line = dec.decode(assembled); assembled = new Uint8Array(0); if (line) onLine?.(line); }
      }
    } catch { /* stream ended */ }
    finally { clearInterval(pathTimer); if (!closed) onClose?.(); }
  })();

  return { agent, wire, fallbackFrom, sendLine, close: () => { closed = true; clearInterval(pathTimer); ch.close(); } };
}

function findCrlfCrlf(buf) {
  for (let i = 3; i < buf.length; i++) {
    if (buf[i - 3] === 13 && buf[i - 2] === 10 && buf[i - 1] === 13 && buf[i] === 10) return i + 1;
  }
  return -1;
}
