import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionPool } from './connections.js';

class NoSupportedAgentError extends Error {}

function harness(connect) {
  const state = { devices: [{ id: 'dev', token: 'token' }], conns: new Map(), threadDeviceId: null };
  const pool = createConnectionPool({
    state,
    connect,
    makeRpc: () => ({ initialize: async () => {} }),
    NoSupportedAgentError,
    updateDevice() {},
    onNotify() {},
    loadThreads() {},
    openThread() {},
    inChat: () => false,
    renderConnection() {},
  });
  return { state, pool };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('reconnect redials immediately while preserving connection identity', async () => {
  const transports = [];
  const h = harness(async () => {
    const transport = { closeCalls: 0, close() { this.closeCalls++; } };
    transports.push(transport);
    return transport;
  });

  const connection = h.pool.connectDevice(h.state.devices[0]);
  await flush();
  const reconnected = h.pool.reconnect(connection);
  await flush();

  assert.equal(reconnected, connection);
  assert.equal(h.state.conns.get('dev'), connection);
  assert.equal(transports.length, 2);
  assert.equal(transports[0].closeCalls, 1);
  assert.equal(connection.transport, transports[1]);
  h.pool.destroy();
});

test('destroy closes active transports and permanently disables dialing', async () => {
  let dialCount = 0;
  const transport = { closeCalls: 0, close() { this.closeCalls++; } };
  const h = harness(async () => { dialCount++; return transport; });
  const connection = h.pool.connectDevice(h.state.devices[0]);
  await flush();
  h.pool.scheduleReconnect(connection, 0);

  h.pool.destroy();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(transport.closeCalls, 1);
  assert.equal(h.state.conns.size, 0);
  assert.equal(dialCount, 1);
  assert.equal(h.pool.connectDevice(h.state.devices[0]), null);
  assert.equal(h.pool.reconnect(connection), connection);
});

test('destroy closes a transport returned by an in-flight dial', async () => {
  let resolveDial;
  const transport = { closeCalls: 0, close() { this.closeCalls++; } };
  const h = harness(() => new Promise((resolve) => { resolveDial = resolve; }));
  h.pool.connectDevice(h.state.devices[0]);

  h.pool.destroy();
  resolveDial(transport);
  await flush();

  assert.equal(transport.closeCalls, 1);
  assert.equal(h.state.conns.size, 0);
});
