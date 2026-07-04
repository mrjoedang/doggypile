// Minimal JSON-RPC 2.0 client over a line transport, plus codex's
// initialize handshake. Requests resolve on their matching {id,result}.
// Server notifications (streaming items) are delivered to onNotify.
export function makeRpc(transport, { onNotify } = {}) {
  let nextId = 1;
  const pending = new Map();

  function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    } else if (msg.method) {
      onNotify?.(msg); // notification or server-initiated request
    }
  }

  function request(method, params = {}) {
    const id = nextId++;
    transport.sendLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function notify(method, params = {}) {
    transport.sendLine(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  async function initialize() {
    const res = await request('initialize', {
      clientInfo: { name: 'doggypile', title: 'doggypile', version: '0.1.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    notify('initialized');
    return res;
  }

  return { handleLine, request, notify, initialize };
}
