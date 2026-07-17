import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadSync, planThreadReconciliation, timestampOf } from './thread-sync.js';

test('reconciliation follows tab order and always carries metadata', () => {
  const tabs = [
    { key: 'd:b', deviceId: 'd', threadId: 'b', title: 'Session', lifecycleRevision: 1 },
    { key: 'other:x', deviceId: 'other', threadId: 'x' },
    { key: 'd:a', deviceId: 'd', threadId: 'a', title: 'Kept', lifecycleRevision: 2 },
  ];
  const threads = [
    { id: 'a', preview: 'Ignored', updatedAt: 10 },
    { id: 'b', name: 'Named', updatedAt: 20 },
  ];
  const plan = planThreadReconciliation(tabs, threads, 'd', new Map([['d:b', 1], ['d:a', 2]]));
  assert.deepEqual(plan.map((item) => item.tab.key), ['d:b', 'd:a']);
  assert.equal(plan[0].title, 'Named');
  assert.equal(plan[0].updated, 20_000);
  assert.equal(plan[1].title, undefined);
});

test('changed lifecycle and stale idle suppress status but not metadata', () => {
  const changed = { key: 'd:a', deviceId: 'd', threadId: 'a', title: 'Session', lifecycleRevision: 2 };
  const live = { key: 'd:b', deviceId: 'd', threadId: 'b', title: 'Session', lifecycleRevision: 1, lastTurnActive: true };
  const plan = planThreadReconciliation(
    [changed, live],
    [{ id: 'a', name: 'A', status: { type: 'active' } }, { id: 'b', name: 'B', status: { type: 'idle' } }],
    'd',
    new Map([['d:a', 1], ['d:b', 1]]),
  );
  assert.deepEqual(plan.map(({ title, applyLifecycle }) => ({ title, applyLifecycle })), [
    { title: 'A', applyLifecycle: false },
    { title: 'B', applyLifecycle: false },
  ]);
});

test('load coalesces requests and persists before ordered view fanout', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let requests = 0;
  const state = { tabs: [], devices: [{ id: 'd' }], screen: 'home', conns: new Map() };
  const events = [];
  const sync = createThreadSync({ state, cache: { put() {} } });
  sync.bindAdapters({
    workspace: { persistTabs: () => events.push('persist') },
    views: { renderChips: () => events.push('chips'), renderRail: () => events.push('rail'), renderHome: () => events.push('home') },
  });
  const connection = { dev: state.devices[0], rpc: { request: () => { requests++; return pending; } }, threads: null };
  const first = sync.loadThreads(connection);
  await sync.loadThreads(connection);
  assert.equal(requests, 1);
  release({ data: [] });
  await first;
  assert.deepEqual(events, ['persist', 'chips', 'rail', 'home']);
});

test('timestamp accepts seconds, milliseconds, dates, and invalid values', () => {
  assert.equal(timestampOf({ updatedAt: 42 }), 42_000);
  assert.equal(timestampOf({ recencyAt: 12_000_000_000 }), 12_000_000_000);
  // Preserve the app backup's timestamp normalization, including its treatment
  // of very early parsed dates as second-valued daemon timestamps.
  assert.equal(timestampOf({ updatedAt: '1970-01-01T00:00:01Z' }), 1_000_000);
  assert.equal(timestampOf({ updatedAt: 'bad' }), 0);
});
