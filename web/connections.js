/**
 * Owns the connection records in `state.conns`, their transports, dial/soft
 * timeout timers, and reconnect backoff. `reconnect(connection)` immediately
 * redials the same record; `destroy()` permanently stops the pool and releases
 * every owned timer and transport. Both teardown operations tolerate late dial
 * completions and transport close callbacks.
 *
 * Non-responsibilities: device persistence, RPC protocol details, thread
 * storage/rendering, and remote-agent installation UI.
 */
const SOFT_DIAL_TIMEOUT_MS = 6000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export function createConnectionPool({
  state,
  connect,
  makeRpc,
  NoSupportedAgentError,
  updateDevice,
  onNotify,
  loadThreads,
  openThread,
  inChat,
  renderConnection,
}) {
  let disposed = false;
  function connectAllDevices() {
    if (disposed) return;
    for (const device of state.devices) {
      if (!state.conns.has(device.id)) connectDevice(device);
    }
  }

  function connectDevice(device, { resetBackoff = false } = {}) {
    if (disposed) return null;
    let connection = state.conns.get(device.id);
    if (!connection) {
      connection = {
        dev: device,
        status: 'connecting',
        attempt: 0,
        backoffMs: BACKOFF_BASE_MS,
        transport: null,
        rpc: null,
        agent: null,
        metrics: null,
        retryTimer: null,
        softTimer: null,
        threads: null,
        threadsLoading: false,
        lastDetail: '',
        everConnected: false,
      };
      state.conns.set(device.id, connection);
    }
    if (resetBackoff) connection.backoffMs = BACKOFF_BASE_MS;
    clearTimeout(connection.retryTimer);
    connection.retryTimer = null;
    dial(connection);
    return connection;
  }

  async function dial(connection) {
    if (disposed || state.conns.get(connection.dev.id) !== connection) return;
    const attempt = ++connection.attempt;
    const device = connection.dev;
    mark(connection, 'connecting');
    clearTimeout(connection.softTimer);
    connection.softTimer = setTimeout(() => {
      if (connection.attempt === attempt && connection.status === 'connecting') {
        mark(connection, 'offline', 'not responding');
      }
    }, SOFT_DIAL_TIMEOUT_MS);

    try {
      const transport = await connect({
        nodeId: device.id,
        token: device.token,
        relay: device.relay,
        directAddrs: device.addrs || [],
        onToken: (token) => updateDevice(device.id, { token }),
        onMetrics: (metrics) => {
          connection.metrics = metrics;
          if (metrics.agent) connection.agent = metrics.agent;
        },
        onLine: (line) => connection.rpc?.handleLine(line),
        onClose: () => {
          if (disposed || connection.attempt !== attempt || state.conns.get(device.id) !== connection) return;
          mark(connection, 'offline', 'connection closed');
          scheduleReconnect(connection);
        },
      });
      if (disposed || connection.attempt !== attempt || state.conns.get(device.id) !== connection) { transport.close(); return; }
      connection.transport = transport;
      connection.agent = transport.agent || connection.agent;
      connection.rpc = makeRpc(transport, { onNotify: (message) => onNotify(connection, message) });
      await connection.rpc.initialize();
      if (disposed || connection.attempt !== attempt || state.conns.get(device.id) !== connection) return;
      clearTimeout(connection.softTimer);
      connection.backoffMs = BACKOFF_BASE_MS;
      connection.everConnected = true;
      updateDevice(device.id, { lastConnectedAt: Date.now(), lastError: null });
      mark(connection, 'connected');
      loadThreads(connection);
      if (inChat() && state.threadDeviceId === device.id) {
        openThread(device.id, state.threadId, state.threadTitle);
      }
    } catch (error) {
      if (disposed || connection.attempt !== attempt || state.conns.get(device.id) !== connection) return;
      clearTimeout(connection.softTimer);
      const detail = error instanceof Error ? error.message : String(error);
      if (/already-used|invalid/i.test(detail)) {
        updateDevice(device.id, { lastError: 'pairing expired' });
        mark(connection, 'expired', 'pairing expired — re-scan its QR');
        return;
      }
      if (error instanceof NoSupportedAgentError) {
        connection.installable = !!error.hostCapabilities?.includes('install_agent');
        mark(connection, 'noagent', detail);
        return;
      }
      updateDevice(device.id, { lastError: detail, lastErrorAt: Date.now() });
      mark(connection, 'offline', detail);
      scheduleReconnect(connection);
    }
  }

  function scheduleReconnect(connection, delayMs) {
    if (disposed || connection.retryTimer || state.conns.get(connection.dev.id) !== connection) return;
    const jitter = 0.7 + Math.random() * 0.6;
    const delay = delayMs ?? Math.round(connection.backoffMs * jitter);
    connection.backoffMs = Math.min(connection.backoffMs * 2, BACKOFF_MAX_MS);
    connection.retryTimer = setTimeout(() => {
      connection.retryTimer = null;
      if (!disposed && state.conns.get(connection.dev.id) === connection) dial(connection);
    }, delay);
  }

  function reconnect(connection, { resetBackoff = true } = {}) {
    if (disposed || !connection || state.conns.get(connection.dev.id) !== connection) return connection || null;
    connection.attempt++;
    clearTimeout(connection.retryTimer);
    clearTimeout(connection.softTimer);
    connection.retryTimer = null;
    connection.softTimer = null;
    if (resetBackoff) connection.backoffMs = BACKOFF_BASE_MS;
    const transport = connection.transport;
    const rpc = connection.rpc;
    connection.transport = null;
    connection.rpc = null;
    rpc?.close?.();
    try { transport?.close(); } catch { /* already closed */ }
    dial(connection);
    return connection;
  }

  function mark(connection, status, detail) {
    connection.status = status;
    if (detail !== undefined) connection.lastDetail = detail || '';
    renderConnection(connection);
  }

  function dropConnection(id) {
    const connection = state.conns.get(id);
    if (!connection) return;
    connection.attempt++;
    clearTimeout(connection.retryTimer);
    clearTimeout(connection.softTimer);
    connection.retryTimer = null;
    connection.softTimer = null;
    const transport = connection.transport;
    const rpc = connection.rpc;
    connection.transport = null;
    connection.rpc = null;
    state.conns.delete(id);
    rpc?.close?.();
    try { transport?.close(); } catch { /* already closed */ }
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    for (const id of [...state.conns.keys()]) dropConnection(id);
  }

  return {
    connectAllDevices,
    connectDevice,
    reconnect,
    dropConnection,
    scheduleReconnect,
    markConnection: mark,
    destroy,
  };
}
