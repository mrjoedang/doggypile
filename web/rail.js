// Mobile session rail. Dots keep stable vertical slots, then shift inward as
// a group during scrubbing so the user's finger cannot cover the targets.
// App-specific navigation and chat previewing are injected so this module
// never talks to the transport.

const GRID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>';
const PITCH = 26;
const MAX_DOTS = 8;
const TAP_DISTANCE = 7;
const TAP_MS = 350;
const CANCEL_X = 34;
const PEEK_DEBOUNCE_MS = 90;
const CONTENT_THROTTLE_MS = 70;
const COMPAT_CLICK_GUARD_MS = 700;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function createSessionRail({ mount, getStatus, getMachine, getActivity, getExcerpt, onPreviewStart, onPreview, onCommit, onCancel, onTap, onHome, onTick }) {
  const layer = document.createElement('div');
  layer.className = 'session-rail';
  layer.hidden = true;
  layer.setAttribute('role', 'tablist');
  layer.setAttribute('aria-label', 'Open sessions');
  layer.setAttribute('aria-orientation', 'vertical');

  const idleBack = document.createElement('div');
  idleBack.className = 'session-rail-back session-rail-glass';
  const lane = document.createElement('div');
  lane.className = 'session-rail-lane session-rail-glass';
  const items = document.createElement('div');
  items.className = 'session-rail-items';
  const pill = document.createElement('div');
  pill.className = 'session-rail-pill session-rail-glass';
  const notch = document.createElement('div');
  notch.className = 'session-rail-notch';
  const grid = document.createElement('button');
  grid.type = 'button';
  grid.className = 'session-rail-grid';
  grid.setAttribute('aria-label', 'Show all sessions');
  grid.innerHTML = GRID_SVG;
  const strip = document.createElement('div');
  strip.className = 'session-rail-strip';
  strip.setAttribute('aria-hidden', 'true');
  const vignette = document.createElement('div');
  vignette.className = 'session-rail-vignette';

  layer.append(idleBack, lane, items, pill, notch, grid, strip);
  mount.append(vignette, layer);

  let tabs = [];
  let visible = false;
  let activeKey = null;
  let frozenKeys = null;
  let gesture = null;
  let focusIndex = -1;
  let focusKey = null;
  let peekTimer = null;
  let pillTimer = null;
  let lastPillAt = 0;
  let lastPillTab = null;
  let lastDirection = 1;
  let suppressClickUntil = 0;

  // A touch tap is committed from pointerup so the rail can distinguish it
  // from a scrub. iOS follows that with a compatibility click; by then a Home
  // tap may already have hidden the rail and revealed a session Close button
  // under the same finger. Swallow only that follow-on pointer click. Keyboard
  // activation has detail === 0 and remains handled by the buttons below.
  const suppressCompatibilityClick = (event) => {
    if (event.detail === 0 || !suppressClickUntil) return;
    if (performance.now() > suppressClickUntil) {
      suppressClickUntil = 0;
      return;
    }
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // If the browser suppresses the compatibility click entirely, do not let
  // the stale guard consume a deliberate fast tap on the newly shown Home UI.
  // A real second tap always has its own pointerdown; a compatibility click
  // does not.
  const releaseCompatibilityClickGuard = (event) => {
    if (event.target !== strip) suppressClickUntil = 0;
  };
  document.addEventListener('click', suppressCompatibilityClick, true);
  document.addEventListener('pointerdown', releaseCompatibilityClickGuard, true);

  const statusOf = (tab) => getStatus(tab);
  const sorted = (input) => {
    // Preserve registry order: status changes update a dot in place instead
    // of moving the user's session target under their thumb.
    const ordered = input.slice();
    if (ordered.length <= MAX_DOTS) return ordered;
    const visibleTabs = ordered.slice(0, MAX_DOTS);
    const active = ordered.find((tab) => tab.key === activeKey);
    if (active && !visibleTabs.includes(active)) visibleTabs[MAX_DOTS - 1] = active;
    return visibleTabs;
  };
  const displayedTabs = () => {
    if (!frozenKeys) return sorted(tabs);
    return frozenKeys.map((key) => tabs.find((tab) => tab.key === key)).filter(Boolean);
  };

  function geometry(list = displayedTabs()) {
    const n = list.length;
    const gridGap = 12;
    const gridHeight = 24;
    const total = n * PITCH + gridGap + gridHeight;
    const height = layer.clientHeight || window.innerHeight;
    const startY = Math.max(12, height / 2 - total / 2);
    return {
      list,
      n,
      total,
      startY,
      cy: (i) => startY + 13 + i * PITCH,
      gridCy: startY + n * PITCH + gridGap + gridHeight / 2,
    };
  }

  function ariaLabel(tab) {
    const status = statusOf(tab);
    const statusText = status === 'needs-you' ? 'needs your reply' : status === 'working' ? 'working' : status;
    const unread = tab.unread ? `, ${tab.unread} unread` : '';
    const machine = getMachine(tab);
    return `${tab.title || 'Session'}, ${statusText}${unread}${machine ? `, on ${machine}` : ''}`;
  }

  function dotInner(tab) {
    const dot = document.createElement('span');
    const status = statusOf(tab);
    dot.className = `session-rail-dot status-${status}`;
    dot.dataset.dot = tab.key;
    if (tab.key === activeKey) dot.classList.add('current');
    if (tab.key === focusKey) dot.classList.add('focused');
    if (status === 'needs-you') dot.textContent = tab.unread > 9 ? '9+' : String(tab.unread || '!');
    return dot;
  }

  function render({ animate = true } = {}) {
    const list = displayedTabs();
    const g = geometry(list);
    const oldTops = new Map([...items.children].map((node) => [node.dataset.key, node.getBoundingClientRect().top]));
    const keep = new Set(list.map((tab) => tab.key));
    for (const node of [...items.children]) if (!keep.has(node.dataset.key)) node.remove();

    list.forEach((tab, index) => {
      let button = [...items.children].find((node) => node.dataset.key === tab.key);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'session-rail-item';
        button.dataset.key = tab.key;
        button.setAttribute('role', 'tab');
        button.addEventListener('click', (event) => {
          if (event.detail !== 0) return; // pointer taps are interpreted by the fixed slot map
          onTick?.();
          onTap(tab);
        });
        items.append(button);
      }
      items.append(button); // DOM/keyboard order follows the visual priority order
      button._index = index;
      button.style.top = `${g.cy(index) - 10}px`;
      button.setAttribute('aria-label', ariaLabel(tab));
      button.setAttribute('aria-selected', String(tab.key === activeKey));
      button.tabIndex = tab.key === activeKey || (!activeKey && index === 0) ? 0 : -1;
      button.replaceChildren(dotInner(tab));
    });

    idleBack.style.top = `${g.startY - 9}px`;
    idleBack.style.height = `${g.total + 18}px`;
    lane.style.top = `${g.startY - 4}px`;
    lane.style.height = `${g.n * PITCH + 8}px`;
    grid.style.top = `${g.gridCy - 12}px`;
    strip.style.top = `${g.startY - 26}px`;
    strip.style.height = `${g.total + 52}px`;

    if (animate && !reduceMotion && !gesture) {
      for (const button of items.children) {
        const oldTop = oldTops.get(button.dataset.key);
        if (oldTop == null) continue;
        const newTop = button.getBoundingClientRect().top;
        const delta = oldTop - newTop;
        if (Math.abs(delta) < 0.5) continue;
        button.style.transition = 'none';
        button.style.setProperty('--rail-flip-y', `${delta}px`);
        void button.offsetWidth;
        requestAnimationFrame(() => {
          button.style.transition = '';
          void button.offsetWidth;
          button.style.setProperty('--rail-flip-y', '0px');
        });
      }
    }
  }

  function setFocus(index, pointerY, direction) {
    const g = geometry();
    if (!g.n) return;
    index = clamp(index, 0, g.n - 1);
    const tab = g.list[index];
    const changed = tab.key !== focusKey;
    focusIndex = index;
    focusKey = tab.key;
    lastDirection = direction || lastDirection;
    notch.style.top = `${clamp(pointerY, 8, (layer.clientHeight || innerHeight) - 8)}px`;
    for (const button of items.children) {
      button.querySelector('.session-rail-dot')?.classList.toggle('focused', button.dataset.key === focusKey);
    }
    placePill(index);
    if (!changed) return;
    onTick?.();
    queuePill(tab);
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => onPreview(tab, lastDirection), PEEK_DEBOUNCE_MS);
  }

  function pillActivity(tab) {
    const status = statusOf(tab);
    let text = getActivity(tab) || (status === 'working' ? 'Working…' : status === 'needs-you' ? 'Waiting for your reply' : status === 'error' ? 'Connection error' : 'Done');
    if (status === 'working' && tab.turnStartedAt) text = `${formatElapsed(Date.now() - tab.turnStartedAt)} · ${text}`;
    return text;
  }

  function fillPill(tab) {
    if (!tab || tab.key !== focusKey) return;
    lastPillTab = tab;
    lastPillAt = performance.now();
    const status = statusOf(tab);
    const head = document.createElement('span');
    head.className = 'session-rail-pill-row';
    const dot = document.createElement('span');
    dot.className = `session-rail-pill-dot status-${status}`;
    const statusLabel = document.createElement('span');
    statusLabel.className = `session-rail-pill-status status-${status}`;
    statusLabel.textContent = status === 'needs-you' ? 'needs you' : status;
    const machine = document.createElement('span');
    machine.className = 'session-rail-pill-machine';
    machine.textContent = getMachine(tab) || '';
    head.append(dot, statusLabel, machine);
    const title = document.createElement('span');
    title.className = 'session-rail-pill-title';
    title.textContent = tab.title || 'Session';
    const excerpt = document.createElement('div');
    excerpt.className = 'session-rail-pill-excerpt';
    const messages = getExcerpt?.(tab) || [];
    if (messages.length) {
      for (const message of messages) {
        const line = document.createElement('div');
        line.className = `session-rail-pill-msg role-${message.role}`;
        line.textContent = message.text;
        excerpt.append(line);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'session-rail-pill-empty';
      empty.textContent = 'No conversation preview yet.';
      excerpt.append(empty);
    }
    const activity = document.createElement('span');
    activity.className = `session-rail-pill-activity status-${status}`;
    activity.textContent = pillActivity(tab);
    pill.replaceChildren(head, title, excerpt, activity);
    if (!reduceMotion && pill.classList.contains('show')) {
      pill.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 130, easing: 'ease-out' });
    }
    placePill(focusIndex);
  }

  function queuePill(tab) {
    clearTimeout(pillTimer);
    const wait = Math.max(0, CONTENT_THROTTLE_MS - (performance.now() - lastPillAt));
    if (!lastPillTab || !pill.classList.contains('show') || wait === 0) fillPill(tab);
    else pillTimer = setTimeout(() => fillPill(tab), wait);
  }

  function safeInset(name) {
    const value = getComputedStyle(layer).getPropertyValue(name);
    return parseFloat(value) || 0;
  }

  function placePill(index) {
    if (index < 0) return;
    const height = pill.offsetHeight || 82;
    const viewportHeight = layer.clientHeight || innerHeight;
    const top = clamp((viewportHeight - height) / 2, safeInset('--rail-safe-top') + 12, viewportHeight - safeInset('--rail-safe-bottom') - height - 12);
    pill.style.top = `${top.toFixed(1)}px`;
  }

  function scrubTo(clientY, direction) {
    const g = geometry();
    if (!g.n) return;
    const rect = layer.getBoundingClientRect();
    const y = clientY - rect.top;
    const index = clamp(Math.round((y - g.startY - 13) / PITCH), 0, g.n - 1);
    setFocus(index, y, direction);
  }

  function beginScrub(event) {
    if (!gesture || gesture.scrubbing) return;
    gesture.scrubbing = true;
    frozenKeys = sorted(tabs).map((tab) => tab.key);
    layer.classList.add('scrubbing');
    mount.classList.add('rail-scrubbing');
    pill.classList.add('show');
    vignette.classList.add('show');
    onPreviewStart();
    render({ animate: false });
    scrubTo(event.clientY, event.clientY >= gesture.lastY ? 1 : -1);
  }

  function clearGestureVisuals() {
    layer.classList.remove('scrubbing');
    mount.classList.remove('rail-scrubbing');
    vignette.classList.remove('show');
    pill.classList.remove('show');
    focusKey = null;
    focusIndex = -1;
    lastPillTab = null;
    clearTimeout(peekTimer);
    clearTimeout(pillTimer);
    for (const dot of items.querySelectorAll('.focused')) dot.classList.remove('focused');
  }

  function finishGesture(commit) {
    const current = gesture;
    if (!current || current.done) return;
    current.done = true;
    const tab = displayedTabs()[focusIndex];
    clearGestureVisuals();
    gesture = null;
    frozenKeys = null;
    if (commit && tab) {
      onTick?.();
      onCommit(tab);
      requestAnimationFrame(() => pulse(tab.key));
    } else {
      onCancel();
    }
    render();
  }

  function pulse(key) {
    const dot = items.querySelector(`[data-dot="${CSS.escape(key)}"]`);
    if (!dot || reduceMotion) return;
    dot.animate([{ boxShadow: '0 0 0 0 rgba(240,179,94,.55)' }, { boxShadow: '0 0 0 12px rgba(240,179,94,0)' }], { duration: 480, easing: 'ease-out' });
  }

  strip.addEventListener('pointerdown', (event) => {
    if (!visible || gesture || event.button > 0) return;
    if (event.pointerType !== 'mouse') {
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = performance.now() + COMPAT_CLICK_GUARD_MS;
    }
    try { strip.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      lastY: event.clientY,
      scrubbing: false,
      done: false,
    };
  });

  strip.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId || gesture.done) return;
    const dy = event.clientY - gesture.startY;
    if (!gesture.scrubbing) {
      if (Math.abs(dy) > TAP_DISTANCE) beginScrub(event);
      else return;
    }
    const dx = event.clientX - gesture.startX;
    const rightEdge = layer.getBoundingClientRect().right;
    if (dx >= CANCEL_X || (dx > 10 && event.clientX >= rightEdge - 2)) {
      finishGesture(false);
      return;
    }
    const direction = event.clientY === gesture.lastY ? lastDirection : event.clientY > gesture.lastY ? 1 : -1;
    scrubTo(event.clientY, direction);
    gesture.lastY = event.clientY;
  });

  strip.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId || gesture.done) return;
    if (event.pointerType !== 'mouse' && event.cancelable) event.preventDefault();
    if (gesture.scrubbing) {
      finishGesture(true);
      return;
    }
    const tap = gesture;
    gesture = null;
    if (performance.now() - tap.startedAt > TAP_MS || Math.hypot(event.clientX - tap.startX, event.clientY - tap.startY) > TAP_DISTANCE) return;
    const g = geometry();
    const y = tap.startY - layer.getBoundingClientRect().top;
    if (Math.abs(y - g.gridCy) <= 16) {
      onTick?.();
      onHome();
      return;
    }
    if (!g.n) return;
    const index = clamp(Math.round((y - g.startY - 13) / PITCH), 0, g.n - 1);
    if (Math.abs(y - g.cy(index)) <= 15) {
      onTick?.();
      onTap(g.list[index]);
      pulse(g.list[index].key);
    }
  });

  strip.addEventListener('pointercancel', (event) => {
    if (gesture?.pointerId === event.pointerId) {
      suppressClickUntil = 0;
      finishGesture(false);
    }
  });

  grid.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    onTick?.();
    onHome();
  });

  layer.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const buttons = [...items.children];
    const current = buttons.indexOf(document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') {
      if (current < 0) return;
      event.preventDefault();
      onTick?.();
      onTap(displayedTabs()[current]);
      return;
    }
    if (!buttons.length) return;
    event.preventDefault();
    let next = current < 0 ? 0 : current;
    if (event.key === 'ArrowUp') next = (next - 1 + buttons.length) % buttons.length;
    else if (event.key === 'ArrowDown') next = (next + 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else next = buttons.length - 1;
    buttons[next].focus();
  });

  const dimOnFocus = (event) => {
    if (event.target.matches?.('#input, #input *')) layer.classList.add('composer-focused');
  };
  const undimOnFocus = (event) => {
    if (event.target.matches?.('#input, #input *')) layer.classList.remove('composer-focused');
  };
  document.addEventListener('focusin', dimOnFocus);
  document.addEventListener('focusout', undimOnFocus);

  const clock = setInterval(() => {
    if (lastPillTab && pill.classList.contains('show')) {
      const activity = pill.querySelector('.session-rail-pill-activity');
      if (activity) activity.textContent = pillActivity(lastPillTab);
    }
  }, 1000);

  return {
    update(next) {
      tabs = next.tabs || [];
      activeKey = next.activeKey || null;
      visible = !!next.visible && tabs.length > 0;
      layer.hidden = !visible;
      vignette.hidden = !visible;
      if (!visible && gesture) finishGesture(false);
      if (visible) render();
    },
    relayout() {
      if (visible) render({ animate: false });
    },
    get scrubbing() { return !!gesture?.scrubbing; },
    destroy() {
      clearInterval(clock);
      clearTimeout(peekTimer);
      clearTimeout(pillTimer);
      document.removeEventListener('click', suppressCompatibilityClick, true);
      document.removeEventListener('pointerdown', releaseCompatibilityClickGuard, true);
      document.removeEventListener('focusin', dimOnFocus);
      document.removeEventListener('focusout', undimOnFocus);
      mount.classList.remove('rail-scrubbing');
      layer.remove();
      vignette.remove();
    },
  };
}

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
