import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRpc } from './rpc.js';

test('close rejects pending requests and prevents later transport writes', async () => {
  const lines = [];
  const rpc = makeRpc({ sendLine: (line) => lines.push(line) });
  const pending = rpc.request('threads/list');
  const reason = new Error('pool disposed');

  rpc.close(reason);
  rpc.notify('ignored');

  await assert.rejects(pending, reason);
  await assert.rejects(rpc.request('ignored'), reason);
  assert.equal(lines.length, 1);
  rpc.close();
});
