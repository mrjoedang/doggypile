import test from 'node:test';
import assert from 'node:assert/strict';

const elements = [];
globalThis.document = {
  createElement(tagName) {
    const node = { tagName, className: '', innerHTML: '' };
    elements.push(node);
    return node;
  },
  querySelector() {},
  documentElement: { classList: { add() {} } },
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
if (!globalThis.navigator) globalThis.navigator = {};

const { ICONS, icon } = await import('./icons.js');

test('catalog contains trusted, inert SVG fragments only', () => {
  assert.equal(Object.isFrozen(ICONS), true);
  assert.equal(Object.keys(ICONS).length, 18);
  for (const markup of Object.values(ICONS)) {
    assert.match(markup, /^<svg\b[^>]* aria-hidden="true">.*<\/svg>$/);
    assert.doesNotMatch(markup, /<script|\son\w+=|javascript:/i);
  }
});

test('icon constructs the established span and class through platform el', () => {
  const defaultIcon = icon('paw');
  const customIcon = icon('close', 'icon tabicon');

  assert.deepEqual(defaultIcon, { tagName: 'span', className: 'icon', innerHTML: ICONS.paw });
  assert.deepEqual(customIcon, { tagName: 'span', className: 'icon tabicon', innerHTML: ICONS.close });
  assert.deepEqual(elements, [defaultIcon, customIcon]);
});
