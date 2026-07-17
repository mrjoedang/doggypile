import { createProjection } from './projection.js';
import { THREAD_CACHE_MAX } from './thread-cache.js';
import { truncate } from './utils.js';

/**
 * Chat controller
 *
 * Responsibility: own one app's conversation surface end-to-end: cached and
 * remote hydration, scrub previews, keyed chat-node reconciliation, daemon
 * event routing, ephemeral-thread materialization, send/interrupt, composer
 * state/size, and scroll scheduling.
 *
 * Owned state: rendered node registry and trailing chrome, rail-preview
 * snapshot/memo, one-shot stickiness, hydration/render RAFs, and the slow-read
 * timer. Domain state (tabs, active thread, projection, connection records)
 * remains in the injected `state` object.
 *
 * Dependencies: DOM primitives and selectors, projection/cache adapters,
 * connection lookup, presentation helpers, and a workspace adapter. Workspace
 * tabs is the sole tab registry/lifecycle owner: notifications, read-status
 * reconciliation, local-turn begin/failure, and materialization cross that seam.
 * Navigation, history, and presentation remain separate workspace callbacks.
 *
 * Returned interface: `openThread`, `onNotify`, `materializeEphemeral`, `send`,
 * `interrupt`, `render`, `scheduleRender`, composer/scroll methods, rail
 * excerpt and preview hooks, and `dispose`.
 *
 * Lifecycle invariants:
 * - stale reads never replace the active conversation;
 * - a read snapshot cannot overwrite lifecycle changes observed while reading;
 * - only notifications for the visible device/thread reach its projection;
 * - every owned RAF is retained and cancelled on dispose;
 * - preview rendering never mutates the live projection and can restore the
 *   exact live DOM/node registry/scroll position;
 * - dispose cancels owned asynchronous UI work and removes DOM listeners.
 *
 * Non-responsibilities: creating/selecting/closing tabs, history navigation
 * policy, connection/reconnect policy, thread-list semantics, unread/status
 * policy, context-pane content, markdown policy, and protocol projection.
 */
export function createChatController({
  state,
  dom: { $, el, icon, renderMarkdown, stateBox },
  connections: { connFor, deviceLabel },
  cache: threadCacheStore,
  workspace,
  effects = {},
  projectionFactory = createProjection,
  clock = globalThis,
}) {
  const requestFrame = effects.requestAnimationFrame || clock.requestAnimationFrame?.bind(clock) || ((fn) => clock.setTimeout(fn, 0));
  const cancelFrame = effects.cancelAnimationFrame || clock.cancelAnimationFrame?.bind(clock) || clock.clearTimeout?.bind(clock);
  const setTimer = effects.setTimeout || clock.setTimeout.bind(clock);
  const clearTimer = effects.clearTimeout || clock.clearTimeout.bind(clock);
  const haptic = effects.haptic || (() => {});
  const toast = effects.toast || (() => {});
  const prefersReducedMotion = effects.prefersReducedMotion || (() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const cacheEntries = threadCacheStore.entries;

  let chat = emptyRenderState();
  const railExcerptMemo = new Map();
  const railPreview = { active: false, originKey: null, shownKey: null, originRender: null };
  let renderFrame = null;
  let slowReadTimer = null;
  const frames = new Set();
  const listeners = [];
  function queueFrame(callback) {
    let frame;
    frame = requestFrame(() => { frames.delete(frame); callback(); });
    frames.add(frame);
    return frame;
  }

  const activeTab = () => workspace.activeTab();
  const activeConn = () => state.threadDeviceId ? connFor(state.threadDeviceId) : null;

  function updateComposer() {
    const tab = activeTab();
    const ephemeralReady = !!(tab?.ephemeral && tab.deviceId && connFor(tab.deviceId)?.status === 'connected');
    $('#stop').hidden = !state.turnActive;
    $('#send').disabled = !$('#input').value.trim() || !(state.threadId || ephemeralReady);
  }

  function autoResize() {
    const box = $('#input');
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 144)}px`;
    updateComposer();
  }

  function updateJump() {
    const main = $('#main');
    const showing = !!chat.log?.isConnected && state.screen === 'session';
    const away = main.scrollHeight - main.scrollTop - main.clientHeight > 240;
    $('#jump').hidden = !(showing && away);
  }

  function scrollToLatest({ smooth = false } = {}) {
    const main = $('#main');
    if (smooth) main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
    else main.scrollTop = main.scrollHeight;
  }

  function flattenMarkdown(text) {
    return truncate(text.replace(/```[\s\S]*?```/g, ' [code] ')
      .replace(/`([^`]*)`/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*|\*|~~/g, '')
      .replace(/\s+/g, ' ').trim(), 200);
  }

  function excerptFromMessages(messages) {
    const items = [];
    for (let i = messages.length - 1; i >= 0 && items.length < 4; i--) {
      const message = messages[i];
      if (message.kind !== 'text' || !message.text || !['user', 'assistant'].includes(message.role)) continue;
      items.unshift({ role: message.role, text: flattenMarkdown(message.text) });
    }
    return items;
  }

  function railExcerpt(tab) {
    if (tab.ephemeral) return [];
    if (tab.key === state.active && state.projection) return excerptFromMessages(state.projection.toRenderList());
    const entry = cacheEntries.get(tab.key);
    if (!entry?.thread) return [];
    const memo = railExcerptMemo.get(tab.key);
    if (memo?.at === entry.at) return memo.items;
    const projection = projectionFactory();
    projection.seedFromThread(entry.thread);
    const items = excerptFromMessages(projection.toRenderList());
    railExcerptMemo.set(tab.key, { at: entry.at, items });
    if (railExcerptMemo.size > THREAD_CACHE_MAX) {
      for (const key of railExcerptMemo.keys()) if (!cacheEntries.has(key)) railExcerptMemo.delete(key);
    }
    return items;
  }

  function animateRailPeek(direction = 0) {
    const main = $('#main');
    if (!main || prefersReducedMotion()) return;
    main.getAnimations().forEach((animation) => animation.cancel());
    main.animate([{ transform: `translateY(${direction * 22}px)`, opacity: 0.25 }, { transform: 'none', opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(.25,.8,.3,1)' });
  }

  function beginRailPreview() {
    railPreview.active = true;
    railPreview.originKey = state.active;
    railPreview.shownKey = state.active;
    const main = $('#main');
    railPreview.originRender = { children: [...main.childNodes], scrollTop: main.scrollTop, nodes: new Map(chat.nodes),
      log: chat.log, hintEl: chat.hintEl, workingEl: chat.workingEl, renderTurnActive: chat.renderTurnActive };
  }

  function previewRailTab(tab, direction = 0) {
    if (!railPreview.active || !tab || tab.key === railPreview.shownKey) return;
    railPreview.shownKey = tab.key;
    $('#chat-title').textContent = tab.title || 'Session';
    chat.nodes.clear(); chat.log = null;
    if (tab.key === railPreview.originKey && state.projection) {
      chat.forceStick = true;
      render({ projection: state.projection, turnActive: state.turnActive, preview: true });
    } else {
      const cached = !tab.ephemeral && cacheEntries.get(tab.key)?.thread;
      if (cached) {
        const projection = projectionFactory(); projection.seedFromThread(cached); chat.forceStick = true;
        render({ projection, turnActive: !!tab.lastTurnActive, preview: true });
      } else {
        $('#main').replaceChildren(stateBox({ spinner: true, body: tab.ephemeral ? 'New session' : 'Conversation preview not cached yet' }));
        $('#jump').hidden = true;
      }
    }
    animateRailPeek(direction);
  }

  function endRailPreview(restoreOrigin) {
    if (!railPreview.active) return;
    const origin = railPreview.originRender;
    const shouldRestore = restoreOrigin && !!origin;
    Object.assign(railPreview, { active: false, shownKey: null, originKey: null, originRender: null });
    if (!shouldRestore) return;
    const tab = activeTab(); if (!tab) return;
    $('#chat-title').textContent = state.threadTitle || tab.title || 'Session';
    const main = $('#main'); main.replaceChildren(...origin.children);
    chat.nodes = origin.nodes; chat.log = origin.log; chat.hintEl = origin.hintEl;
    chat.workingEl = origin.workingEl; chat.renderTurnActive = origin.renderTurnActive;
    main.scrollTop = origin.scrollTop;
    if (tab.ephemeral) workspace.renderEphemeral(tab);
    else if (state.projection && (chat.log?.isConnected || cacheEntries.has(tab.key) || connFor(tab.deviceId)?.status === 'connected')) render();
    else { updateComposer(); updateJump(); }
    animateRailPeek();
  }

  async function openThread(deviceId, id, title) {
    state.threadDeviceId = deviceId; state.threadId = id;
    if (title) state.threadTitle = title;
    const tab = activeTab();
    state.turnActive = tab && tab.key === workspace.tabKeyFor(deviceId, id) ? !!tab.lastTurnActive : false;
    state.projection = projectionFactory(); resetNodes();
    const conn = connFor(deviceId);
    const dev = conn?.dev || state.devices.find((device) => device.id === deviceId);
    workspace.showSession();
    const cacheKey = workspace.tabKeyFor(deviceId, id);
    const cached = cacheEntries.get(cacheKey)?.thread;
    if (cached) { state.projection.seedFromThread(cached); chat.forceStick = true; render(); }
    if (conn?.status !== 'connected' || !conn.rpc) {
      if (!cached) $('#main').replaceChildren(stateBox({ spinner: true, body: `Connecting to ${deviceLabel(dev) || 'your computer'}…` }));
      return;
    }
    if (!cached) {
      $('#main').replaceChildren(el('div', 'log view'));
      clearSlowRead();
      slowReadTimer = setTimer(() => {
        slowReadTimer = null;
        if (state.threadId === id && state.threadDeviceId === deviceId && !chat.log?.isConnected)
          $('#main').replaceChildren(stateBox({ spinner: true, body: 'Loading conversation…' }));
      }, 200);
    }
    const lifecycleBeforeRead = tab?.lifecycleRevision || 0;
    const [, response] = await Promise.all([
      conn.rpc.request('thread/resume', { threadId: id }).catch(() => {}),
      conn.rpc.request('thread/read', { threadId: id, includeTurns: true }).catch(() => null),
    ]);
    clearSlowRead();
    if (state.threadId !== id || state.threadDeviceId !== deviceId) return;
    if (response?.thread) {
      threadCacheStore.put(cacheKey, response.thread);
      const fresh = projectionFactory(); fresh.seedFromThread(response.thread); state.projection = fresh;
      const currentTab = activeTab();
      if (response.thread.status && currentTab?.key === cacheKey) {
        workspace.reconcileReadStatus(currentTab, response.thread.status, { baselineRevision: lifecycleBeforeRead, attempt: conn.attempt });
        state.turnActive = !!currentTab.lastTurnActive;
      }
    }
    render();
  }

  function resetNodes() { chat.nodes.clear(); chat.log = null; }

  function nodeKindOf(message) { return chatNodeKind(message); }
  function createNode(message) {
    const kind = nodeKindOf(message);
    if (kind === 'user') return textNode('user');
    if (kind === 'assistant') return textNode('assistant');
    if (kind === 'reasoning') return reasoningNode();
    if (kind === 'command') return commandNode();
    return chipNode(message);
  }
  function textNode(kind) {
    const root = el('div', `msg ${kind}`), body = el('div', kind === 'assistant' ? 'msg-body md' : 'msg-body'); root.append(body);
    let last = null;
    return { el: root, kind, update(message) { if (message.text === last) return; last = message.text;
      if (kind === 'assistant') body.replaceChildren(renderMarkdown(message.text || '')); else body.textContent = message.text || ''; } };
  }
  function reasoningNode() {
    const root = el('div', 'reasoning'), head = el('button', 'reasoning-head'), label = el('span', 'reasoning-label', 'Thinking');
    const preview = el('span', 'reasoning-preview'), body = el('div', 'reasoning-body'); head.type = 'button';
    head.append(icon('spark', 'icon reasoning-icon'), label, preview, icon('chevronDown', 'icon reasoning-chevron')); root.append(head, body);
    let open = false, last = null; root.dataset.open = 'false'; head.onclick = () => { open = !open; root.dataset.open = String(open); };
    return { el: root, kind: 'reasoning', update(message) { root.dataset.live = String(!!message.streamed && chat.renderTurnActive);
      if (message.text === last) return; last = message.text; body.textContent = message.text || '';
      const tail = (message.text || '').trim().split('\n').pop() || ''; preview.textContent = tail.length > 90 ? `…${tail.slice(-90)}` : tail; } };
  }
  function commandNode() {
    const root = el('div', 'tool'), head = el('button', 'tool-head'), dot = el('span', 'dot'), cmd = el('code', 'tool-cmd');
    const out = el('pre', 'tool-out'); head.type = 'button'; head.append(dot, cmd, icon('chevronDown', 'icon tool-chevron')); root.append(head, out);
    let open = null, lastText = null, lastStatus = null; head.onclick = () => { open = root.dataset.open !== 'true'; root.dataset.open = String(open); };
    return { el: root, kind: 'command', update(message) { const status = message.status || 'running';
      if (status !== lastStatus) { lastStatus = status; dot.dataset.status = status; root.dataset.open = String(open === null ? status === 'running' : open); }
      cmd.textContent = message.command || ''; const text = (message.text || '').replace(/\s+$/, '');
      if (text !== lastText) { lastText = text; out.textContent = text; root.dataset.hasOutput = String(!!text); if (root.dataset.open === 'true') out.scrollTop = out.scrollHeight; } } };
  }
  function chipNode(message) {
    const root = el('div', 'chip'), label = el('span', 'chip-label'); root.append(icon(message.kind === 'fileChange' ? 'file' : 'terminal', 'icon chip-icon'), label);
    let last = null; return { el: root, kind: 'chip', update(next) { if (next.text !== last) { last = next.text; label.textContent = next.text || ''; } } };
  }
  function ensureLog() {
    if (chat.log?.isConnected) return chat.log;
    chat.nodes.clear(); chat.log = el('div', 'log view'); chat.hintEl = el('div', 'chat-hint');
    chat.hintEl.append(icon('paw', 'icon chat-hint-icon'), el('div', null, 'Send a message to get started.'));
    chat.workingEl = el('div', 'working'); chat.workingEl.append(el('span', 'working-label', 'Working'));
    $('#main').replaceChildren(chat.log); return chat.log;
  }

  function render({ projection = state.projection, turnActive = state.turnActive, preview = false } = {}) {
    if ((railPreview.active && !preview) || !projection) return;
    chat.renderTurnActive = turnActive;
    const main = $('#main'), hadLog = !!chat.log?.isConnected;
    const stick = chat.forceStick || !hadLog || main.scrollHeight - main.scrollTop - main.clientHeight < 80; chat.forceStick = false;
    const log = ensureLog(), messages = projection.toRenderList();
    const operations = planChatReconciliation([...chat.nodes].map(([id, node]) => ({ id, kind: node.kind })), messages);
    for (const operation of operations) {
      if (operation.type === 'remove' || operation.type === 'replace') { chat.nodes.get(operation.id)?.el.remove(); chat.nodes.delete(operation.id); }
      if (operation.type === 'insert' || operation.type === 'replace') chat.nodes.set(operation.id, createNode(operation.message));
      if (operation.type !== 'remove') {
        const node = chat.nodes.get(operation.id); node.update(operation.message);
        if (log.children[operation.index] !== node.el) log.insertBefore(node.el, log.children[operation.index] || null);
      }
    }
    chat.hintEl.remove(); chat.workingEl.remove();
    if (!messages.length && !turnActive) log.append(chat.hintEl); if (turnActive) log.append(chat.workingEl);
    if (!preview) updateComposer();
    if (stick) { scrollToLatest(); queueFrame(() => scrollToLatest()); }
    if (preview) $('#jump').hidden = true; else updateJump();
    if (!preview) workspace.renderContextSoon();
  }

  function scheduleRender() {
    if (renderFrame !== null) return;
    renderFrame = queueFrame(() => { renderFrame = null; if (!state.threadId) return;
      if (railPreview.active) { if (railPreview.shownKey === railPreview.originKey) render({ projection: state.projection, turnActive: state.turnActive, preview: true }); }
      else render(); });
  }

  function onNotify(conn, message) {
    const route = routeChatNotification(message, { deviceId: conn.dev.id, activeDeviceId: state.threadDeviceId, activeThreadId: state.threadId });
    const { tab } = workspace.notify(conn, message);
    if (!route.visible) return;
    if (route.kind === 'turn-started') { state.turnActive = tab ? !!tab.lastTurnActive : true; scheduleRender(); return; }
    if (['turn-completed', 'turn-failed'].includes(route.kind)) { state.turnActive = tab ? !!tab.lastTurnActive : false; scheduleRender(); return; }
    if (route.kind === 'status') { state.turnActive = tab ? !!tab.lastTurnActive : message.params?.status?.type === 'active'; scheduleRender(); return; }
    if (state.projection?.applyNotification(message)) scheduleRender();
  }

  async function materializeEphemeral(tab, firstText) {
    const conn = connFor(tab.deviceId);
    if (conn?.status !== 'connected' || !conn.rpc) { toast(`${deviceLabel(conn?.dev) || 'That machine'} isn’t connected — hang on.`); return false; }
    if (state.creatingThread) return false; state.creatingThread = true;
    let id;
    try { const response = await conn.rpc.request('thread/start', { approvalPolicy: 'never', sandbox: 'danger-full-access' });
      id = response?.thread?.id; if (!id) throw new Error('the daemon returned no thread id');
    } catch (error) { toast(`Couldn’t start a session: ${error?.message || error}`); return false; }
    finally { state.creatingThread = false; }
    const title = truncate(firstText, 44) || 'New session';
    workspace.materialized(tab, { deviceId: tab.deviceId, threadId: id, title });
    state.threadId = id; state.threadDeviceId = tab.deviceId; state.threadTitle = tab.title; state.projection = projectionFactory(); resetNodes();
    workspace.replaceThreadHistory(tab); conn.rpc.request('thread/resume', { threadId: id }).catch(() => {});
    workspace.refreshThreads(conn); workspace.renderSessionChrome(); return true;
  }

  async function send() {
    const box = $('#input'), text = box.value.trim(); if (!text) return;
    const tab = activeTab();
    if (tab?.ephemeral) { if (!tab.deviceId) { toast('Pick a machine for this session first.'); return; } if (!(await materializeEphemeral(tab, text))) return; }
    const conn = activeConn(); if (!state.threadId) return;
    if (!conn?.rpc || conn.status !== 'connected') { toast(`${deviceLabel(conn?.dev) || 'This machine'} isn’t connected — hang on.`); return; }
    haptic(); box.value = ''; autoResize();
    const localMessageId = state.projection?.addLocalUserMessage(text); state.turnActive = true;
    if (tab) workspace.beginLocalTurn(tab, conn.attempt);
    chat.forceStick = true; scheduleRender();
    try { const response = await conn.rpc.request('turn/start', { threadId: state.threadId, input: [{ type: 'text', text, text_elements: [] }] });
      if (tab && response?.turn?.id) workspace.acknowledgeLocalTurn(tab, response.turn.id);
    } catch (error) { state.turnActive = false; if (tab) workspace.failLocalTurn(tab, error, conn.attempt);
      if (localMessageId) state.projection?.removeLocalMessage(localMessageId); if (!box.value) { box.value = text; autoResize(); }
      toast(`Send failed: ${error?.message || error}`); scheduleRender(); }
  }

  function interrupt() { const conn = activeConn(); if (state.threadId && conn?.rpc) { haptic(); conn.rpc.request('turn/interrupt', { threadId: state.threadId }).catch(() => {}); } }

  function bind() {
    on($('#send'), 'click', send); on($('#stop'), 'click', interrupt); effects.hapticize?.($('#send')); effects.hapticize?.($('#stop'));
    on($('#jump'), 'click', () => scrollToLatest({ smooth: true })); on($('#main'), 'scroll', updateJump, { passive: true }); on($('#input'), 'input', autoResize);
    on($('#input'), 'keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });
  }
  function on(target, type, listener, options) { target.addEventListener(type, listener, options); listeners.push(() => target.removeEventListener(type, listener, options)); }
  function clearSlowRead() { if (slowReadTimer !== null) { clearTimer(slowReadTimer); slowReadTimer = null; } }
  function dispose() { listeners.splice(0).forEach((remove) => remove()); clearSlowRead(); for (const frame of frames) cancelFrame(frame); frames.clear(); renderFrame = null; }

  return { bind, dispose, openThread, onNotify, materializeEphemeral, send, interrupt, render, scheduleRender,
    updateComposer, autoResize, updateJump, scrollToLatest, railExcerpt, beginRailPreview, previewRailTab, endRailPreview };
}

function emptyRenderState() { return { nodes: new Map(), log: null, hintEl: null, workingEl: null, forceStick: false, renderTurnActive: false }; }

/** Pure mapping used by keyed DOM reconciliation. */
export function chatNodeKind(message) {
  if (message.role === 'user') return 'user';
  if (message.kind === 'reasoning') return 'reasoning';
  if (message.role === 'tool') return message.kind === 'command' ? 'command' : 'chip';
  return 'assistant';
}

/**
 * Return ordered mutations needed to reconcile keyed nodes. Existing entries
 * are `{id, kind}`; messages retain projection order. Replacements are explicit
 * so a reused id can never retain the wrong node implementation.
 */
export function planChatReconciliation(existing, messages) {
  const byId = new Map(existing.map((node) => [node.id, node]));
  const operations = [];
  messages.forEach((message, index) => {
    const old = byId.get(message.id), kind = chatNodeKind(message);
    operations.push({ type: !old ? 'insert' : old.kind !== kind ? 'replace' : 'update', id: message.id, index, kind, message });
    byId.delete(message.id);
  });
  for (const id of byId.keys()) operations.push({ type: 'remove', id });
  return operations;
}

/** Pure notification routing; lifecycle effects remain injected policy. */
export function routeChatNotification(message, { deviceId, activeDeviceId, activeThreadId }) {
  const threadId = message.params?.threadId || null;
  const kinds = { 'turn/started': 'turn-started', 'turn/completed': 'turn-completed', 'turn/failed': 'turn-failed',
    'thread/status/changed': 'status', 'item/completed': 'item-completed' };
  return { kind: kinds[message.method] || 'projection', threadId,
    visible: deviceId === activeDeviceId && (!threadId || threadId === activeThreadId) };
}
