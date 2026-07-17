import { $, el } from './platform.js?v=20260716-modules';

export function createViewPrimitives({ icon }) {
  let toastTimer = null;

  function stateBox({ icon: iconName, spinner, title, body, action }) {
    const box = el('div', 'state view');
    if (spinner) box.append(el('div', 'spinner'));
    if (iconName) box.append(icon(iconName, 'state-icon'));
    if (title) box.append(el('div', 'state-title', title));
    if (body) {
      const paragraph = el('p', 'state-body');
      if (typeof body === 'string') paragraph.textContent = body;
      else paragraph.append(...body);
      box.append(paragraph);
    }
    if (action) box.append(action);
    return box;
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.hidden = false;
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
  }

  return { stateBox, toast };
}
