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
  function connectAllDevices() {
    for (const device of state.devices) {
      if (!state.conns.has(device.id)) connectDevice(device);
    }
  }

  function connectDevice(device, { resetBackoff = false } = {}) {
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
          if (connection.attempt !== attempt) return;
          mark(connection, 'offline', 'connection closed');
          scheduleReconnect(connection);
        },
      });
      if (connection.attempt !== attempt) { transport.close(); return; }
      connection.transport = transport;
      connection.agent = transport.agent || connection.agent;
      connection.rpc = makeRpc(transport, { onNotify: (message) => onNotify(connection, message) });
      await connection.rpc.initialize();
      if (connection.attempt !== attempt) return;
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
      if (connection.attempt !== attempt) return;
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
    if (connection.retryTimer || !state.conns.has(connection.dev.id)) return;
    const jitter = 0.7 + Math.random() * 0.6;
    const delay = delayMs ?? Math.round(connection.backoffMs * jitter);
    connection.backoffMs = Math.min(connection.backoffMs * 2, BACKOFF_MAX_MS);
    connection.retryTimer = setTimeout(() => {
      connection.retryTimer = null;
      dial(connection);
    }, delay);
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
    try { connection.transport?.close(); } catch { /* already closed */ }
    state.conns.delete(id);
  }

  return {
    connectAllDevices,
    connectDevice,
    dropConnection,
    scheduleReconnect,
    markConnection: mark,
  };
}
