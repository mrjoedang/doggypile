import test from 'node:test';
import assert from 'node:assert/strict';

// rail.js reads this preference when the module is evaluated.
globalThis.matchMedia ||= () => ({ matches: false });
const { formatProjectionActivity } = await import('../web/workspace-view.js');

const projection = (items) => ({ toRenderList: () => items });

test('projection activity prefers the latest running command', () => {
  assert.equal(formatProjectionActivity(projection([
    { role: 'assistant', text: 'Earlier reply' },
    { kind: 'command', status: 'running', command: 'npm test' },
  ])), '$ npm test');
});

test('projection activity ignores completed commands and formats an assistant tail', () => {
  assert.equal(formatProjectionActivity(projection([
    { kind: 'command', status: 'completed', command: 'npm test' },
    { role: 'assistant', text: 'first line\n  compact   latest line  ' },
  ])), ' compact latest line');
});

test('projection activity truncates from the tail and handles empty projections', () => {
  const text = 'x'.repeat(80);
  assert.equal(formatProjectionActivity(projection([{ role: 'assistant', text }])), `…${'x'.repeat(72)}`);
  assert.equal(formatProjectionActivity(null), '');
});
