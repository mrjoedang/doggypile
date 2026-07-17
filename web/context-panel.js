import { $, el, layout, subscribeLayoutChanges } from './platform.js?v=20260716-context-panel';
import { deviceLabel } from './devices.js?v=20260716-context-panel';
import { relativeTime, truncate } from './utils.js?v=20260716-context-panel';

/**
 * Deep module for responsive session chrome and the session context panel.
 *
 * Responsibility: coordinate session/context pane visibility, persisted context
 * preference, context tabs and content, passive refreshes, and breakpoint/mobile
 * pane transitions while preserving the existing DOM and ARIA contract.
 *
 * Owned state: state.ctxOpen, state.ctxTab, state.mobilePane; the persisted
 * `doggypile:ctxOpen` preference; context-delay, details-refresh, activity-flush,
 * and resize-animation timers; DOM listeners installed by this factory.
 *
 * Dependencies: shared app state and session/connection readers, icon rendering,
 * machine-action and ephemeral-machine adapters, and small integration callbacks
 * for composer, jump control, strip/session list persistence, and tab viewing.
 * Machine dialogs and selectors remain behind callbacks at this seam.
 *
 * Returned interface: render(), renderBody(), renderBodySoon(),
 * scheduleActivityFlush(), and destroy(). Calls are idempotent; destroy() cancels
 * timers, breakpoint subscription, and all listeners.
 *
 * Invariants: ephemeral sessions never expose context; phones remain on the
 * full-bleed session pane while the segmented context UI is disabled; tablet
 * context uses the scrim; passive body refresh never replaces focused content;
 * context preference applies to non-mobile layouts and survives reloads.
 *
 * Non-responsibilities: chat/message rendering, machine surfaces, transport,
 * thread lifecycle, rail rendering, or application navigation/history.
 */
export function createContextPanel({
  state,
  activeTab,
  connFor,
  icon,
  openMachineActions,
  renderMachinePill = () => {},
  renderMachineSelect = () => {},
  renderEphemeral = () => {},
  updateComposer = () => {},
  updateJump = () => {},
  renderStrip = () => {},
  renderSessions = () => {},
  persistTabs = () => {},
  tabIsViewed = () => false,
  markTabViewed = () => {},
} = {}) {
  if (!state || !activeTab || !connFor || !icon || !openMachineActions) {
    throw new TypeError('createContextPanel requires state, activeTab, connFor, icon, and openMachineActions');
  }

  const disposers = [];
  let ctxTimer = null;
  let activityFlushTimer = null;
  let resizeRaf = 0;

  try { state.ctxOpen = localStorage.getItem('doggypile:ctxOpen') !== '0'; } catch { /* storage is optional */ }

  const listen = (node, type, handler, options) => {
    node?.addEventListener(type, handler, options);
    if (node) disposers.push(() => node.removeEventListener(type, handler, options));
  };
  const secEl = (text) => el('span', 'section-title', text);
  const quietEl = (text) => el('div', 'panel-quiet', text);

  function persistOpen() {
    try { localStorage.setItem('doggypile:ctxOpen', state.ctxOpen ? '1' : '0'); } catch { /* storage is optional */ }
  }

  function kvEl(key, value) {
    const row = el('div', 'kv');
    row.append(el('span', 'k', key));
    const val = el('span', 'v');
    if (value instanceof Node) val.append(value);
    else val.textContent = value;
    row.append(val);
    return row;
  }

  function detailsContent(tab) {
    const out = [];
    const dev = state.devices.find((item) => item.id === tab.deviceId);
    if (!dev) return [quietEl('Pick a machine in the chat to start this session.')];
    const conn = connFor(dev.id);
    const meta = conn?.threads?.find((thread) => thread.id === tab.threadId);
    out.push(secEl('Session'));
    const machine = el('span');
    const dot = el('span', 'sdot');
    dot.dataset.s = conn?.status || 'connecting';
    machine.append(dot, document.createTextNode(deviceLabel(dev)));
    out.push(kvEl('machine', machine));
    out.push(kvEl('agent', conn?.agent || '—'));
    out.push(kvEl('directory', meta?.cwd || '—'));
    out.push(kvEl('updated', relativeTime(meta?.updatedAt || meta?.recencyAt) || '—'));
    out.push(secEl('Connection'));
    out.push(kvEl('status', state.turnActive ? 'turn active' : (conn?.status || 'connecting')));
    const path = conn?.metrics?.path?.selected;
    const rtt = conn?.metrics?.path?.rtt_ms;
    out.push(kvEl('path', path && path !== 'unknown' ? `${path}${rtt != null ? ` · ${rtt}ms` : ''}` : '—'));
    out.push(kvEl('relay', dev.relay || '—'));
    out.push(kvEl('node id', dev.id));
    out.push(kvEl('last connected', dev.lastConnectedAt ? relativeTime(dev.lastConnectedAt) : '—'));
    const error = (conn?.status !== 'connected' && conn?.lastDetail) || dev.lastError;
    if (error) out.push(kvEl('last error', error));
    const actions = el('button', 'btn btn-small', 'Machine actions…');
    actions.setAttribute('aria-haspopup', 'dialog');
    actions.onclick = () => openMachineActions(dev, actions);
    out.push(actions);
    return out;
  }

  function commandRow(message) {
    const row = el('div', 'prow');
    const dot = el('span', 'dot');
    dot.dataset.status = message.status || 'running';
    const main = el('span', 'prow-main');
    main.append(el('span', 'mono', `$ ${message.command || ''}`));
    row.append(dot, main);
    return row;
  }

  function activityContent(tab) {
    if (tab.ephemeral) return [quietEl('Start the session to see its activity here.')];
    const out = [];
    const messages = state.projection ? state.projection.toRenderList() : null;
    if (state.turnActive) {
      const working = el('div', 'working');
      working.append(el('span', 'working-label', 'Working'));
      out.push(working);
      const running = messages?.slice().reverse().find((message) => message.kind === 'command' && (message.status || 'running') === 'running');
      if (running) out.push(commandRow(running));
    } else out.push(quietEl('Nothing running right now.'));
    out.push(secEl('Commands'));
    const commands = (messages || []).filter((message) => message.kind === 'command');
    if (!messages || !messages.length) out.push(quietEl('Nothing in this conversation yet.'));
    else if (!commands.length) out.push(quietEl('No commands run in this session.'));
    else {
      const recent = commands.slice(-10);
      if (commands.length > recent.length) out.push(quietEl(`Showing the last ${recent.length} of ${commands.length} commands.`));
      for (const message of recent) out.push(commandRow(message));
    }
    out.push(secEl('Latest'));
    const reply = (messages || []).slice().reverse().find((message) => message.role === 'assistant' && message.kind === 'text' && message.text);
    out.push(reply ? quietEl(truncate(reply.text.trim().replace(/\s+/g, ' '), 220)) : quietEl('No assistant reply yet.'));
    return out;
  }

  function changesContent(tab) {
    if (tab.ephemeral) return [quietEl('Start the session to see file changes here.')];
    const out = [el('div', 'note', 'File paths reported by the agent in this session. doggypile doesn’t expose Git status or diffs yet, so there’s no live diff here.')];
    const messages = state.projection ? state.projection.toRenderList() : null;
    if (!messages) return [...out, quietEl('Conversation not loaded yet.')];
    const events = messages.filter((message) => message.kind === 'fileChange');
    if (!events.length) return [...out, quietEl('No file changes reported in this session.')];
    const files = [];
    for (const event of events) for (const path of event.files || []) if (!files.includes(path)) files.push(path);
    if (!files.length) return [...out, el('div', 'changes-sum', `${events.length} file-change event${events.length > 1 ? 's' : ''} · paths not reported`)];
    out.push(el('div', 'changes-sum', `${files.length} file${files.length > 1 ? 's' : ''} touched`));
    for (const path of files) {
      const row = el('div', 'frow');
      row.append(icon('file', 'icon chip-icon'), el('span', 'fname', path));
      out.push(row);
    }
    return out;
  }

  function renderTabs() {
    for (const button of document.querySelectorAll('[data-ctxtab]')) {
      const selected = button.dataset.ctxtab === state.ctxTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  function content() {
    const tab = activeTab();
    if (!tab) return [quietEl('No session selected.')];
    if (state.ctxTab === 'details') return detailsContent(tab);
    if (state.ctxTab === 'activity') return activityContent(tab);
    return changesContent(tab);
  }

  function renderBody(force = false) {
    const pane = $('#ctxpane');
    if (state.screen !== 'session' || !pane || pane.hidden) return;
    const body = $('#ctx-body');
    if (!force && body.contains(document.activeElement)) return;
    const scroll = body.scrollTop;
    body.replaceChildren(...content());
    body.setAttribute('aria-labelledby', `ctxtab-${state.ctxTab}`);
    body.scrollTop = scroll;
  }

  function renderBodySoon() {
    if (ctxTimer) return;
    ctxTimer = setTimeout(() => { ctxTimer = null; renderBody(); }, 250);
  }

  function render() {
    const tab = activeTab();
    if (state.screen !== 'session' || !tab) return;
    const currentLayout = layout();
    const ephemeral = !!tab.ephemeral;
    const pane = $('#chatpane');
    if (ephemeral) pane.dataset.eph = 'true';
    else delete pane.dataset.eph;
    $('#chat-title').textContent = ephemeral ? 'New session' : (state.threadTitle || tab.title || 'Session');
    renderMachinePill();

    const segmentBar = $('#segbar');
    segmentBar.hidden = true;
    state.mobilePane = 'session';
    for (const button of segmentBar.querySelectorAll('[data-seg]')) {
      const selected = button.dataset.seg === state.mobilePane;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const showContext = !ephemeral && (currentLayout === 'mobile' ? state.mobilePane === 'context' : state.ctxOpen);
    pane.hidden = currentLayout === 'mobile' && state.mobilePane !== 'session';
    $('#ctxpane').hidden = !showContext;
    $('#ctx-close').hidden = currentLayout === 'mobile';
    $('#drawer-scrim').hidden = !(currentLayout === 'tablet' && showContext);
    const toggle = $('#ctx-toggle');
    toggle.hidden = currentLayout === 'mobile' || ephemeral;
    toggle.setAttribute('aria-pressed', String(state.ctxOpen));

    const conn = connFor(tab.deviceId);
    const dev = state.devices.find((item) => item.id === tab.deviceId);
    $('#input').placeholder = ephemeral
      ? 'What are we working on?'
      : tab.deviceId ? `Message ${conn?.agent || 'the agent'} on ${deviceLabel(dev) || 'your computer'}`
        : 'Pick a machine, then message the agent…';
    if (ephemeral) renderMachineSelect(tab);
    renderTabs();
    if (showContext) renderBody(true);
    updateComposer();
    updateJump();
  }

  function close() {
    state.ctxOpen = false;
    persistOpen();
    render();
    renderStrip();
    $('#ctx-toggle')?.focus();
  }

  function scheduleActivityFlush() {
    if (activityFlushTimer) return;
    activityFlushTimer = setTimeout(() => {
      activityFlushTimer = null;
      persistTabs();
      renderStrip();
      if (state.screen === 'home') renderSessions();
    }, 300);
  }

  listen($('#ctx-toggle'), 'click', () => {
    state.ctxOpen = !state.ctxOpen;
    persistOpen();
    render();
    renderStrip();
  });
  listen($('#ctx-close'), 'click', close);
  listen($('#drawer-scrim'), 'click', close);
  for (const button of document.querySelectorAll('[data-ctxtab]')) listen(button, 'click', () => {
    state.ctxTab = button.dataset.ctxtab;
    renderTabs();
    renderBody(true);
  });
  for (const button of document.querySelectorAll('[data-seg]')) listen(button, 'click', () => {
    state.mobilePane = button.dataset.seg;
    const tab = activeTab();
    if (tab?.unread && tabIsViewed(tab)) { markTabViewed(tab); persistTabs(); }
    render();
    renderStrip();
  });
  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && state.screen === 'session' && state.ctxOpen && layout() === 'tablet') close();
  });
  listen(window, 'resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(renderStrip);
  });

  const unsubscribeLayout = subscribeLayoutChanges(() => {
    renderStrip();
    if (state.screen !== 'session') return;
    render();
    const tab = activeTab();
    if (tab?.ephemeral) renderEphemeral(tab);
  });
  const detailsTimer = setInterval(() => {
    if (state.screen === 'session' && !$('#ctxpane').hidden && state.ctxTab === 'details' && !document.hidden) renderBodySoon();
  }, 3000);

  function destroy() {
    clearTimeout(ctxTimer);
    clearTimeout(activityFlushTimer);
    clearInterval(detailsTimer);
    cancelAnimationFrame(resizeRaf);
    unsubscribeLayout();
    for (const dispose of disposers.splice(0)) dispose();
  }

  return { render, renderBody, renderBodySoon, scheduleActivityFlush, destroy };
}
