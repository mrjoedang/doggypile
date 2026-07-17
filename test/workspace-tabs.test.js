import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTabs } from '../web/workspace-tabs.js';

function harness(overrides = {}) {
  let time = 1_000;
  const persisted = [];
  const rendered = [];
  const state = { tabs: [], active: null, devices: [{ id: 'dev' }], mode: 'normal', newN: 0, mobilePane: 'session' };
  const connections = new Map([['dev', { dev: { id: 'dev' }, status: 'connected', attempt: 1, threads: [] }]]);
  const workspace = createWorkspaceTabs({
    state,
    connectionFor: (id) => connections.get(id),
    now: () => ++time,
    persistence: { persist: () => persisted.push(time) },
    view: {
      isTabViewed: () => false,
      isSession: () => true,
      isHome: () => false,
      renderStripAndRail: (reason) => rendered.push(reason),
      ...overrides.view,
    },
    shell: { openThread() {}, openEphemeral() {}, ...overrides.shell },
    draft: { read: () => '', write() {}, resize() {} },
  });
  return { state, connections, workspace, persisted, rendered };
}

function addTab(h, patch = {}) {
  const tab = { key: 'dev:thread', deviceId: 'dev', threadId: 'thread', title: 'Session', ephemeral: false, lastTurnActive: false, unread: 0, draft: '', ...patch };
  h.state.tabs.push(tab);
  h.state.active = tab.key;
  return tab;
}

test('waiting status marks one unread and preserves active interrupt lifecycle', () => {
  const h = harness();
  const tab = addTab(h);
  h.workspace.notify(h.connections.get('dev'), { method: 'thread/status/changed', params: { threadId: 'thread', status: { type: 'active', activeFlags: ['waitingOnApproval'] } } });
  assert.equal(tab.unread, 1);
  assert.equal(tab.unreadForTurn, true);
  assert.equal(tab.waitingForUser, true);
  assert.equal(tab.lastTurnActive, true);
  assert.equal(tab.lastActivityTail, 'Waiting for approval');
  h.workspace.notify(h.connections.get('dev'), { method: 'thread/status/changed', params: { threadId: 'thread', status: { type: 'needs-you' } } });
  assert.equal(tab.unread, 1, 'same turn is counted once');
});

test('delayed completion cannot terminate a newer turn', () => {
  const h = harness();
  const tab = addTab(h, { lastTurnActive: true, activeTurnId: 'turn-b' });
  assert.equal(h.workspace.notify(h.connections.get('dev'), { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn-a' } } }).lifecycleChanged, false);
  assert.equal(tab.lastTurnActive, true);
  assert.equal(tab.activeTurnId, 'turn-b');
});

test('terminal notifications are idempotent and unread is capped', () => {
  const h = harness();
  const tab = addTab(h, { lastTurnActive: true, activeTurnId: 'turn-a', unread: 99 });
  const connection = h.connections.get('dev');
  const message = { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn-a', status: 'completed' } } };
  const beforeRevision = tab.lifecycleRevision || 0;
  const first = h.workspace.notify(connection, message);
  const afterFirstRevision = tab.lifecycleRevision;
  const duplicate = h.workspace.notify(connection, message);
  assert.equal(tab.unread, 99);
  assert.equal(tab.lastFinishedTurnId, 'turn-a');
  assert.equal(tab.lastTurnActive, false);
  assert.equal(first.lifecycleChanged, true);
  assert.equal(duplicate.lifecycleChanged, false);
  assert.equal(afterFirstRevision, beforeRevision + 1, 'one notification makes one lifecycle transition');
  assert.equal(tab.lifecycleRevision, afterFirstRevision, 'duplicate terminal does not transition again');
});

test('select stashes old draft, marks target viewed, and replaces session history', () => {
  let input = 'old draft';
  const history = [];
  const h = harness({ shell: { writeHistory: (tab, kind) => history.push([tab.key, kind]) } });
  h.workspace.destroy();
  const first = addTab(h);
  const second = { ...first, key: 'dev:other', threadId: 'other', unread: 4, unreadForTurn: true, draft: 'new draft' };
  h.state.tabs.push(second);
  const workspace = createWorkspaceTabs({
    state: h.state,
    connectionFor: (id) => h.connections.get(id),
    persistence: { persist() {} },
    view: { isTabViewed: () => false, isSession: () => true, renderStripAndRail() {} },
    shell: { writeHistory: (tab, kind) => history.push([tab.key, kind]), openThread() {}, closeSurface() {} },
    draft: { read: () => input, write: (value) => { input = value; }, resize() {} },
  });
  workspace.select(second.key);
  assert.equal(first.draft, 'old draft');
  assert.equal(second.unread, 0);
  assert.equal(input, 'new draft');
  assert.deepEqual(history, [['dev:other', 'replace']]);
});

test('close active chooses the tab occupying its slot', () => {
  const opened = [];
  const h = harness({ shell: { openThread: (_d, id) => opened.push(id) } });
  const a = addTab(h);
  const b = { ...a, key: 'dev:b', threadId: 'b' };
  const c = { ...a, key: 'dev:c', threadId: 'c' };
  h.state.tabs.push(b, c);
  h.state.active = b.key;
  h.workspace.close(b.key);
  assert.equal(h.state.active, c.key);
  assert.deepEqual(opened, ['c']);
});

test('stale idle snapshot does not end known live work', () => {
  const h = harness();
  const tab = addTab(h, { lastTurnActive: true, lifecycleRevision: 7 });
  h.workspace.syncSnapshots(h.connections.get('dev'), [{ id: 'thread', status: { type: 'idle' } }], new Map([[tab.key, 7]]));
  assert.equal(tab.lastTurnActive, true);
});

test('new tab reuses the sole ephemeral and preselects sole connected device', () => {
  let navigations = 0;
  const h = harness({ shell: { navigate: (fn) => { navigations++; fn(); } } });
  const first = h.workspace.newTab();
  const second = h.workspace.newTab();
  assert.equal(first, second);
  assert.equal(first.deviceId, 'dev');
  assert.equal(h.state.tabs.length, 1);
  assert.equal(navigations, 2);
});
