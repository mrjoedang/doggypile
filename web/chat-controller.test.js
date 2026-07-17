import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatController, chatNodeKind, planChatReconciliation, routeChatNotification } from './chat-controller.js';

test('chatNodeKind preserves the renderer categories', () => {
  assert.equal(chatNodeKind({ role: 'user', kind: 'text' }), 'user');
  assert.equal(chatNodeKind({ role: 'assistant', kind: 'reasoning' }), 'reasoning');
  assert.equal(chatNodeKind({ role: 'tool', kind: 'command' }), 'command');
  assert.equal(chatNodeKind({ role: 'tool', kind: 'fileChange' }), 'chip');
  assert.equal(chatNodeKind({ role: 'assistant', kind: 'plan' }), 'assistant');
});

test('reconciliation updates, replaces, inserts, reorders, and removes by id', () => {
  const existing = [{ id: 'a', kind: 'assistant' }, { id: 'gone', kind: 'chip' }, { id: 'move', kind: 'user' }];
  const messages = [
    { id: 'move', role: 'user', kind: 'text', text: 'first now' },
    { id: 'a', role: 'tool', kind: 'command', text: 'changed implementation' },
    { id: 'new', role: 'assistant', kind: 'text', text: 'new' },
  ];
  const plan = planChatReconciliation(existing, messages);
  assert.deepEqual(plan.map(({ type, id, index }) => ({ type, id, index })), [
    { type: 'update', id: 'move', index: 0 },
    { type: 'replace', id: 'a', index: 1 },
    { type: 'insert', id: 'new', index: 2 },
    { type: 'remove', id: 'gone', index: undefined },
  ]);
});

test('notification routing excludes other devices and threads', () => {
  const context = { deviceId: 'mac', activeDeviceId: 'mac', activeThreadId: 't1' };
  assert.deepEqual(routeChatNotification({ method: 'turn/started', params: { threadId: 't1' } }, context),
    { kind: 'turn-started', threadId: 't1', visible: true });
  assert.equal(routeChatNotification({ method: 'item/agentMessage/delta', params: { threadId: 't2' } }, context).visible, false);
  assert.equal(routeChatNotification({ method: 'turn/failed', params: { threadId: 't1' } }, { ...context, deviceId: 'linux' }).visible, false);
});

test('threadless connection notification routes only by device', () => {
  assert.deepEqual(routeChatNotification({ method: 'thread/status/changed', params: {} },
    { deviceId: 'mac', activeDeviceId: 'mac', activeThreadId: 't1' }),
  { kind: 'status', threadId: null, visible: true });
});

function controllerHarness({ rpcRequest, workspace: workspacePatch = {} } = {}) {
  const input = { value: 'hello', style: {}, scrollHeight: 20 };
  const elements = { input, stop: {}, send: {}, main: {}, jump: {} };
  const tab = { key: 'dev:thread', deviceId: 'dev', threadId: 'thread', ephemeral: false, draft: 'hello' };
  const calls = [];
  const projection = {
    addLocalUserMessage: () => 'local-1',
    removeLocalMessage: (id) => calls.push(['removeLocalMessage', id]),
    applyNotification: () => false,
    toRenderList: () => [],
  };
  const state = { active: tab.key, tabs: [tab], devices: [{ id: 'dev' }], threadDeviceId: 'dev', threadId: 'thread', threadTitle: '', projection, turnActive: false };
  const conn = { dev: { id: 'dev' }, status: 'connected', attempt: 4, rpc: { request: rpcRequest || (async () => ({ turn: { id: 'turn-1' } })) } };
  const workspace = {
    activeTab: () => tab,
    notify: (...args) => { calls.push(['notify', ...args]); return { tab, lifecycleChanged: true, activityChanged: false }; },
    beginLocalTurn: (...args) => calls.push(['beginLocalTurn', ...args]),
    acknowledgeLocalTurn: (...args) => calls.push(['acknowledgeLocalTurn', ...args]),
    failLocalTurn: (...args) => calls.push(['failLocalTurn', ...args]),
    materialized: (target, values) => { calls.push(['materialized', target, values]); Object.assign(target, values, { ephemeral: false, key: `dev:${values.threadId}` }); state.active = target.key; },
    tabKeyFor: (deviceId, threadId) => `${deviceId}:${threadId}`,
    replaceThreadHistory() {}, refreshThreads() {}, renderSessionChrome() {}, renderContextSoon() {},
    ...workspacePatch,
  };
  let nextFrame = 0; const cancelled = [];
  const controller = createChatController({
    state, dom: { $: (id) => elements[id.slice(1)], el() {}, icon() {}, renderMarkdown() {}, stateBox() {} },
    connections: { connFor: () => conn, deviceLabel: () => 'machine' },
    cache: { entries: new Map(), put() {} }, workspace, projectionFactory: () => projection,
    effects: { requestAnimationFrame: () => ++nextFrame, cancelAnimationFrame: (id) => cancelled.push(id), toast() {} },
  });
  return { controller, state, tab, conn, calls, input, cancelled };
}

test('one chat notification delegates exactly once to workspace lifecycle', () => {
  const h = controllerHarness();
  const message = { method: 'item/completed', params: { threadId: 'other', item: { type: 'agentMessage', text: 'done' } } };
  h.controller.onNotify(h.conn, message);
  assert.equal(h.calls.filter(([name]) => name === 'notify').length, 1);
  assert.equal(h.calls.some(([name]) => ['beginLocalTurn', 'failLocalTurn', 'materialized'].includes(name)), false);
});

test('send begins and failed send fails through workspace lifecycle owner', async () => {
  const error = new Error('offline');
  const h = controllerHarness({ rpcRequest: async (method) => { if (method === 'turn/start') throw error; return {}; } });
  await h.controller.send();
  assert.deepEqual(h.calls.filter(([name]) => name === 'beginLocalTurn').map(([, tab, attempt]) => [tab, attempt]), [[h.tab, 4]]);
  assert.deepEqual(h.calls.filter(([name]) => name === 'failLocalTurn').map(([, tab, value, attempt]) => [tab, value, attempt]), [[h.tab, error, 4]]);
});

test('ephemeral materialization routes registry mutation through workspace owner', async () => {
  const tab = { key: 'new-1', deviceId: 'dev', threadId: null, ephemeral: true, draft: '' };
  const h = controllerHarness({
    rpcRequest: async (method) => method === 'thread/start' ? { thread: { id: 'created' } } : {},
    workspace: { activeTab: () => tab },
  });
  h.state.tabs = [tab]; h.state.active = tab.key;
  assert.equal(await h.controller.materializeEphemeral(tab, 'First message'), true);
  const call = h.calls.find(([name]) => name === 'materialized');
  assert.deepEqual(call.slice(2), [{ deviceId: 'dev', threadId: 'created', title: 'First message' }]);
  assert.equal(tab.key, 'dev:created');
});

test('dispose cancels every retained chat RAF', () => {
  const h = controllerHarness();
  h.controller.scheduleRender();
  h.controller.dispose();
  assert.deepEqual(h.cancelled, [1]);
});
