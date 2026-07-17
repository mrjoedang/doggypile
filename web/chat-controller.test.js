import test from 'node:test';
import assert from 'node:assert/strict';
import { chatNodeKind, planChatReconciliation, routeChatNotification } from './chat-controller.js';

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
