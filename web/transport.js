// Transport: dial the alleycat daemon over iroh (wasm), do the alleycat
// handshake, then speak the agent's WebSocket wire over the QUIC stream. Codex
// uses websocket wire, so after the handshake we run a minimal RFC 6455 client
// over the raw byte channel and surface each text frame as a JSON-RPC line.
//
// Interface is unchanged from the old transport: connect(...) -> { sendLine, close }.
import init, { Channel } from './vendor/iroh/doggypile_transport.js';

const ALPN = new TextEncoder().encode('alleycat/1');
const enc = new TextEncoder();
const dec = new TextDecoder();

let ready;
const ensureInit = () => (ready ??= init());

export async function connect({ nodeId, token, relay, agent = 'codex', onLine, onClose }) {
  await ensureInit();
  const ch = await Channel.connect(nodeId, ALPN, relay ?? undefined);

  // --- buffered byte reader over the iroh recv stream ---
  const reader = ch.readable().getReader();
  let buf = new Uint8Array(0);
  let closed = false;
  async function pull() {
    const { value, done } = await reader.read();
    if (done) { closed = true; throw new Error('stream closed'); }
    const n = new Uint8Array(buf.length + value.length);
    n.set(buf); n.set(value, buf.length); buf = n;
  }
  const need = async (n) => { while (buf.length < n) await pull(); };
  const take = (n) => { const out = buf.slice(0, n); buf = buf.slice(n); return out; };

  // --- alleycat length-prefixed JSON handshake ---
  const reqBody = enc.encode(JSON.stringify({ op: 'connect', v: 1, token, agent }));
  const reqFrame = new Uint8Array(4 + reqBody.length);
  new DataView(reqFrame.buffer).setUint32(0, reqBody.length, false);
  reqFrame.set(reqBody, 4);
  await ch.send(reqFrame);

  await need(4);
  const respLen = new DataView(take(4).buffer).getUint32(0, false);
  await need(respLen);
  const resp = JSON.parse(dec.decode(take(respLen)));
  if (!resp.ok) throw new Error(resp.error || 'alleycat handshake rejected');

  // --- WebSocket client handshake (RFC 6455) over the stream ---
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const secKey = btoa(String.fromCharCode(...keyBytes));
  await ch.send(enc.encode(
    `GET /${agent} HTTP/1.1\r\nHost: alleycat\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${secKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  ));
  const findHeaderEnd = () => {
    for (let i = 3; i < buf.length; i++)
      if (buf[i - 3] === 13 && buf[i - 2] === 10 && buf[i - 1] === 13 && buf[i] === 10) return i + 1;
    return -1;
  };
  let he; while ((he = findHeaderEnd()) < 0) await pull();
  const statusLine = dec.decode(take(he)).split('\r\n')[0];
  if (!/\b101\b/.test(statusLine)) throw new Error('ws upgrade failed: ' + statusLine);

  // --- ws frame codec ---
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

  const sendLine = (str) => sendFrame(0x1, enc.encode(str)).catch(() => {});

  // --- read loop: reassemble frames, deliver text messages as lines ---
  (async () => {
    let assembled = new Uint8Array(0);
    try {
      for (;;) {
        await need(2);
        const b0 = buf[0], b1 = buf[1];
        const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { await need(4); len = (buf[2] << 8) | buf[3]; off = 4; }
        else if (len === 127) { await need(10); len = Number(new DataView(buf.buffer, buf.byteOffset + 2, 8).getBigUint64(0)); off = 10; }
        await need(off + len);
        take(off);
        const payload = take(len);
        if (opcode === 0x8) break;                       // close
        if (opcode === 0x9) { await sendFrame(0xA, payload); continue; } // ping -> pong
        if (opcode === 0xA) continue;                    // pong
        // text/binary/continuation: reassemble across fragments
        const merged = new Uint8Array(assembled.length + payload.length);
        merged.set(assembled); merged.set(payload, assembled.length);
        assembled = merged;
        if (fin) { const line = dec.decode(assembled); assembled = new Uint8Array(0); if (line) onLine(line); }
      }
    } catch { /* stream ended */ }
    finally { onClose?.(); }
  })();

  return { sendLine, close: () => { closed = true; ch.close(); } };
}
