import { deviceLabel } from './devices.js?v=20260716-modules';
import { relativeTime as relativeTimeDefault, short as shortDefault } from './utils.js?v=20260716-modules';

const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/mrjoedang/doggypile/main/install.sh | sh';
const PAW_LOGO = '<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><ellipse cx="145" cy="228" rx="38" ry="46" transform="rotate(-18 145 228)"/><ellipse cx="216" cy="168" rx="40" ry="49" transform="rotate(-7 216 168)"/><ellipse cx="296" cy="168" rx="40" ry="49" transform="rotate(7 296 168)"/><ellipse cx="367" cy="228" rx="38" ry="46" transform="rotate(18 367 228)"/><path d="M256 250c-52 0-104 47-104 96 0 30 22 50 52 50 19 0 33-8 52-8s33 8 52 8c30 0 52-20 52-50 0-49-52-96-104-96z"/></svg>';
const QR_GLYPH = '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="#716e68" stroke-width="1.6"/><rect x="6.5" y="6.5" width="3" height="3" fill="#f0b35e"/><rect x="23" y="3" width="10" height="10" rx="1.5" stroke="#716e68" stroke-width="1.6"/><rect x="26.5" y="6.5" width="3" height="3" fill="#f0b35e"/><rect x="3" y="23" width="10" height="10" rx="1.5" stroke="#716e68" stroke-width="1.6"/><rect x="6.5" y="26.5" width="3" height="3" fill="#f0b35e"/><rect x="23" y="23" width="3.5" height="3.5" fill="#716e68"/><rect x="29.5" y="23" width="3.5" height="3.5" fill="#f0b35e"/><rect x="23" y="29.5" width="3.5" height="3.5" fill="#f0b35e"/><rect x="29.5" y="29.5" width="3.5" height="3.5" fill="#716e68"/><rect x="16" y="16" width="4" height="4" fill="#716e68"/></svg>';

export function sessionTimestamp(thread) {
  const raw = thread.updatedAt || thread.recencyAt;
  if (!raw) return 0;
  const value = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(value) ? (value < 10_000_000_000 ? value * 1000 : value) : 0;
}

export function parsePairLink(text) {
  const hash = text.trim().indexOf('#');
  const params = new URLSearchParams(hash >= 0 ? text.trim().slice(hash + 1) : text.trim());
  const id = params.get('node');
  const token = params.get('token');
  if (!id || !token) return null;
  return { id, token, name: params.get('name') || undefined, relay: params.get('relay'), addrs: params.getAll('addr') };
}

/**
 * Deep application-shell factory.
 *
 * Responsibility: boot/restore orchestration, single-tab pool ownership,
 * follower takeover, Home/session switching and history, onboarding, retry,
 * and the merged Home session list.
 *
 * Owned state: Web Lock release callback, BroadcastChannel, copy timer,
 * listener lifetime, and shell mode/screen fields in `state`.
 *
 * Dependencies: `machine` owns paired-device persistence/connections;
 * `workspace` owns tabs/strip/session chrome and ordinary resize rendering;
 * `context` owns context teardown; `chat` owns draft/projection reset. `ui`
 * supplies existing DOM primitives.
 *
 * Returned interface: boot, dispose, renderHome, showHome, showUnpaired,
 * showScreen, pairFromLink, retry/copy helpers, and isLeader.
 *
 * Invariants: at most one non-mock tab runs the pool when Web Locks work;
 * yielding closes every connection before releasing; follower mode never dials;
 * Home rows retain their original classes, status semantics and accessible names;
 * history restoration happens before the first connection is opened.
 *
 * Non-responsibilities: protocol/RPC implementation, chat rendering, tab chrome,
 * machine menus and install flow, context contents, resize rendering, and
 * connection backoff policy.
 */
export function createHomeShell({
  state,
  mock = false,
  tabKeyFor,
  machine,
  workspace,
  context = {},
  chat,
  ui,
  env = {},
}) {
  const win = env.window || window;
  const doc = env.document || document;
  const nav = env.navigator || navigator;
  const hist = env.history || history;
  const storage = env.localStorage || localStorage;
  const now = env.now || Date.now;
  const setTimer = env.setTimeout || setTimeout;
  const clearTimer = env.clearTimeout || clearTimeout;
  const { $, el, icon, icons, stateBox, toast, navigate, haptic, hapticize } = ui;
  const rel = ui.relativeTime || relativeTimeDefault;
  const short = ui.short || shortDefault;
  const label = machine.deviceLabel || deviceLabel;
  const listeners = [];
  let releaseLeadership = null;
  let disposed = false;
  let copiedTimer = null;
  const channel = !mock && win.BroadcastChannel ? new win.BroadcastChannel('doggypile:tabs') : null;

  const listen = (target, type, fn, options) => {
    target?.addEventListener(type, fn, options);
    listeners.push(() => target?.removeEventListener(type, fn, options));
  };
  const connFor = (id) => state.conns.get(id);
  const activeTab = () => state.tabs.find((tab) => tab.key === state.active) || null;

  function showScreen(name) {
    state.screen = name;
    $('#home').hidden = name !== 'home';
    $('#sessionview').hidden = name !== 'session';
    workspace.renderStrip();
    if (name === 'session') workspace.renderSessionChrome();
  }

  function showHome() {
    chat.stashDraft();
    Object.assign(state, { screen: 'home', threadId: null, threadTitle: '', threadDeviceId: null, projection: null, turnActive: false });
    showScreen('home');
    $('#search').value = state.query;
    workspace.renderChips();
    renderHome();
  }

  function copyText(text) {
    const fallback = () => {
      const area = el('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      Object.assign(area.style, { position: 'fixed', opacity: '0' });
      doc.body.append(area);
      area.select();
      try { doc.execCommand('copy'); } catch { /* best effort */ }
      area.remove();
    };
    if (!nav.clipboard?.writeText) { fallback(); return Promise.resolve(); }
    return nav.clipboard.writeText(text).catch(fallback);
  }

  function showUnpaired() {
    state.mode = 'unpaired';
    state.screen = 'home';
    showScreen('home');
    doc.body.classList.add('unpaired');
    $('#home-bar').hidden = true;
    workspace.renderChips();
    const head = el('header', 'pair-head');
    const paw = el('span', 'pair-paw');
    paw.innerHTML = PAW_LOGO;
    head.append(paw, el('h1', 'pair-wordmark', 'doggypile'), el('p', 'pair-tagline', 'Control your agents from anywhere'));
    const step1 = el('li', 'pair-step');
    const body1 = el('div', 'pair-step-body');
    body1.append(el('h2', 'pair-step-title', 'Install on your computer'), el('p', 'pair-step-desc', 'Run this in the terminal where your agents live'));
    const pre = el('pre'); pre.append(el('span', 'pair-prompt', '$ '), INSTALL_CMD);
    const scroll = el('div', 'pair-cmd-scroll'); scroll.append(pre);
    const chip = el('div', 'pair-cmd'); chip.append(scroll);
    const copy = el('button', 'pair-copy'); copy.type = 'button'; copy.setAttribute('aria-label', 'Copy install command'); copy.title = 'Copy install command';
    const copyIcon = icon('copy'); copy.append(copyIcon);
    copy.onclick = () => copyText(INSTALL_CMD).then(() => {
      copy.classList.add('copied'); copyIcon.innerHTML = icons.check; clearTimer(copiedTimer);
      copiedTimer = setTimer(() => { copy.classList.remove('copied'); copyIcon.innerHTML = icons.copy; }, 2000);
    });
    const row = el('div', 'pair-cmd-row'); row.append(chip, copy);
    const note = el('p', 'pair-note'); note.append('Already installed? Run ', el('code', null, 'doggypile'), ' again for a fresh QR.');
    body1.append(row, note); step1.append(el('div', 'pair-badge', '1'), body1);
    const step2 = el('li', 'pair-step'); const body2 = el('div', 'pair-step-body'); const hint = el('div', 'pair-hint'); const qr = el('span', 'pair-qr');
    qr.innerHTML = QR_GLYPH; hint.append(qr, el('p', null, 'Scan the QR code and start chatting right away')); body2.append(el('h2', 'pair-step-title', 'Pair with your phone'), hint); step2.append(el('div', 'pair-badge', '2'), body2);
    const steps = el('ol', 'pair-steps'); steps.append(step1, step2); const card = el('section', 'pair-card'); card.append(steps);
    const github = el('a', 'pair-github'); github.href = 'https://github.com/mrjoedang/doggypile'; github.target = '_blank'; github.rel = 'noopener noreferrer'; github.setAttribute('aria-label', 'doggypile on GitHub'); github.title = 'doggypile on GitHub'; github.innerHTML = icons.github;
    const foot = el('footer', 'pair-foot'); foot.append(github); const view = el('div', 'pair-onboard view'); view.append(head, card, foot);
    $('#homelist').replaceChildren(view); doc.body.classList.add('ready');
  }

  function retryAllStale() {
    for (const connection of state.conns.values()) {
      if (connection.status === 'offline') machine.reconnect(connection);
    }
  }
  function skeletonList(count = 5) { const wrap = el('div', 'view'); for (let i = 0; i < count; i++) { const row = el('div', 'skeleton-row'); row.append(el('div', 'skeleton-bar long'), el('div', 'skeleton-bar short')); wrap.append(row); } return wrap; }

  function sessionRow(thread, connection) {
    const title = thread.name || thread.preview || 'Untitled session'; const row = el('div', 'session'); const open = el('button', 'session-open');
    const tab = state.tabs.find((item) => item.deviceId === connection.dev.id && item.threadId === thread.id); const status = tab ? workspace.tabStatus(tab) : workspace.threadSnapshotStatus(thread, connection);
    row.dataset.tabStatus = status; if (status === 'working') row.dataset.live = 'true';
    const dot = el('span', `session-dot status-${status}`); dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', status === 'needs-you' ? 'Needs your reply' : status); open.append(dot);
    const main = el('div', 'session-main'); main.append(el('div', 'session-title', title)); const bits = [];
    if (tab && status !== 'idle') bits.push(workspace.tabActivity(tab));
    else if (!tab && status !== 'idle') bits.push(status === 'error' ? (thread.status?.message || connection.lastDetail || 'Machine unavailable') : status === 'needs-you' ? (thread.preview || 'Waiting for your reply') : status === 'connecting' ? 'Connecting…' : (thread.preview || 'Working…'));
    if (state.devices.length > 1) bits.push(label(connection.dev)); const dir = short(thread.cwd); if (dir) bits.push(dir);
    main.append(el('div', 'session-sub', bits.join(' · ') || (thread.cachedTab ? 'Cached conversation' : '—'))); open.append(main);
    if (tab?.unread) open.append(el('span', 'session-unread', String(tab.unread))); const when = rel(thread.updatedAt || thread.recencyAt); if (when) open.append(el('span', 'session-side', when));
    open.onclick = () => navigate(() => workspace.openTabForThread(connection.dev.id, thread.id, title)); row.append(open);
    if (tab) { const close = el('button', 'session-close'); close.type = 'button'; close.setAttribute('aria-label', `Close ${title}`); close.innerHTML = icons.close; hapticize(close); close.onclick = () => { haptic(); workspace.closeTab(tab.key); renderHome(); }; row.append(close); }
    return row;
  }

  function renderHome() {
    if (state.screen !== 'home' || state.mode !== 'normal') return;
    $('#home-bar').hidden = false; const listEl = $('#homelist'); const connections = [...state.conns.values()].filter((connection) => state.filter === 'all' || connection.dev.id === state.filter); const query = state.query.trim().toLowerCase();
    const matches = (thread, connection) => !query || (thread.name || thread.preview || '').toLowerCase().includes(query) || (thread.cwd || '').toLowerCase().includes(query) || label(connection.dev).toLowerCase().includes(query);
    const merged = []; const keys = new Set();
    for (const connection of connections) for (const thread of connection.threads || []) if (matches(thread, connection)) { merged.push({ thread, connection }); keys.add(tabKeyFor(connection.dev.id, thread.id)); }
    for (const tab of state.tabs) { if (tab.ephemeral || keys.has(tab.key)) continue; const connection = connFor(tab.deviceId); if (!connection || !connections.includes(connection)) continue; const thread = { id: tab.threadId, name: tab.title, preview: tab.lastActivityTail, updatedAt: tab.lastActivityAt, cachedTab: true }; if (matches(thread, connection)) merged.push({ thread, connection }); }
    const priority = ({ thread, connection }) => { const tab = state.tabs.find((item) => item.deviceId === connection.dev.id && item.threadId === thread.id); const status = tab ? workspace.tabStatus(tab) : workspace.threadSnapshotStatus(thread, connection); return { 'needs-you': 0, working: 1, error: 2, connecting: 3, idle: 4 }[status]; };
    merged.sort((a, b) => priority(a) - priority(b) || sessionTimestamp(b.thread) - sessionTimestamp(a.thread));
    if (!merged.length) {
      if (connections.some((connection) => connection.status === 'connecting' || (connection.status === 'connected' && connection.threads === null))) { listEl.replaceChildren(skeletonList()); return; }
      if (query) { listEl.replaceChildren(el('div', 'home-empty', `No sessions match “${state.query.trim()}”.`)); return; }
      if (connections.length && connections.every((connection) => ['offline', 'expired', 'noagent'].includes(connection.status))) { const retry = el('button', 'btn', 'Retry now'); retry.onclick = retryAllStale; const which = state.filter === 'all' && state.devices.length > 1 ? 'any of your machines' : 'this machine'; listEl.replaceChildren(stateBox({ icon: 'warn', title: `Can’t reach ${which}`, body: connections.map((connection) => `${label(connection.dev)}: ${connection.lastDetail || connection.status}`).join('\n'), action: retry })); return; }
      const start = el('button', 'btn btn-accent', 'Start a session'); start.onclick = workspace.newSessionTab; listEl.replaceChildren(stateBox({ icon: 'chat', title: 'No sessions yet', body: 'Start a session to chat with the agent on your computer.', action: start })); return;
    }
    const list = el('div', 'view'); const dayAgo = now() - 86_400_000; let lastGroup = null;
    for (const { thread, connection } of merged) { const tab = state.tabs.find((item) => item.deviceId === connection.dev.id && item.threadId === thread.id); const status = tab ? workspace.tabStatus(tab) : workspace.threadSnapshotStatus(thread, connection); const group = status === 'needs-you' ? 'Needs you' : status === 'working' ? 'Working' : status === 'error' ? 'Attention' : status === 'connecting' ? 'Connecting' : sessionTimestamp(thread) >= dayAgo ? 'Today' : 'Earlier'; if (group !== lastGroup) { list.append(el('span', 'section-title', group)); lastGroup = group; } list.append(sessionRow(thread, connection)); }
    listEl.replaceChildren(list);
  }

  function showFollower() {
    state.mode = 'follower'; doc.body.classList.remove('unpaired'); state.screen = 'home'; showScreen('home'); $('#home-bar').hidden = true; workspace.renderChips();
    const use = el('button', 'btn btn-accent', 'Use this tab'); use.onclick = () => { channel?.postMessage('takeover'); use.disabled = true; use.textContent = 'Taking over…'; };
    $('#homelist').replaceChildren(stateBox({ icon: 'paw', title: 'Open in another tab', body: 'doggypile is already connected from another tab or window. Close it and this one takes over automatically.', action: use })); doc.body.classList.add('ready');
  }

  async function ensureLeadership() {
    if (mock || !nav.locks) return true;
    const got = await new Promise((resolve) => nav.locks.request('doggypile:pool', { ifAvailable: true }, (lock) => { if (!lock) { resolve(false); return; } resolve(true); return new Promise((release) => { releaseLeadership = release; }); }).catch(() => resolve(true)));
    if (got) return true; showFollower();
    await new Promise((resolve) => nav.locks.request('doggypile:pool', () => { resolve(); return new Promise((release) => { releaseLeadership = release; }); }).catch(() => resolve())); return true;
  }

  function pairFromLink(text) {
    const pairing = parsePairLink(text);
    if (!pairing) { toast('That doesn’t look like a pair link.'); return null; }
    let device = state.devices.find((candidate) => candidate.id === pairing.id);
    if (device) {
      Object.assign(device, pairing);
      machine.dropConnection(device.id); // the old transport used the old token
    } else {
      device = { ...pairing, addedAt: now() };
      state.devices.push(device);
    }
    machine.persistDevices(state.devices);
    machine.connectDevice(device, { resetBackoff: true });
    workspace.renderChips();
    renderHome();
    toast(`Pairing ${label(device)}…`);
    return device;
  }
  function startPool() { if (disposed) return; state.mode = 'normal'; doc.body.classList.remove('unpaired'); if (state.screen === 'session' && activeTab()) workspace.selectTab(state.active, { history: 'none' }); else showHome(); machine.connectAllDevices(); doc.body.classList.add('ready'); }

  async function boot() {
    try { state.ctxOpen = storage.getItem('doggypile:ctxOpen') !== '0'; } catch { /* default open */ }
    state.devices = machine.loadDevices(); machine.loadThreadCache(); machine.upsertFromFragment(state.devices); workspace.restoreTabs();
    if (hist.state?.threadId) { const deviceId = hist.state.deviceId || state.devices[0]?.id || null; if (deviceId) { const key = tabKeyFor(deviceId, hist.state.threadId); if (!state.tabs.some((tab) => tab.key === key)) state.tabs.push({ key, deviceId, threadId: hist.state.threadId, title: hist.state.title || 'Session', ephemeral: false, lastTurnActive: false, unread: 0, turnStartedAt: null, lastActivityAt: now(), lastActivityTail: '', draft: '' }); Object.assign(state, { active: key, screen: 'session', threadId: hist.state.threadId, threadDeviceId: deviceId, threadTitle: hist.state.title || '' }); } }
    if (!state.devices.length) { showUnpaired(); return; } await ensureLeadership(); startPool();
  }

  async function onChannel(event) { if (event.data !== 'takeover' || !releaseLeadership) return; for (const id of [...state.conns.keys()]) machine.dropConnection(id); releaseLeadership(); releaseLeadership = null; await ensureLeadership(); startPool(); }
  function onVisibility() { if (doc.hidden) return; retryAllStale(); const tab = activeTab(); if (tab?.unread && workspace.tabIsViewed(tab)) { workspace.markTabViewed(tab); workspace.persistTabs(); workspace.renderStrip(); } }
  function onPopState(event) { context.closeSurface?.(false); if (!state.devices.length || state.mode !== 'normal') return; chat.stashDraft(); const entry = event.state; if (entry?.threadId) { const deviceId = entry.deviceId || state.devices[0]?.id; navigate(() => workspace.openTabForThread(deviceId, entry.threadId, entry.title || '', { history: 'none' })); } else if (entry?.ephemeral && state.tabs.some((tab) => tab.key === entry.tabKey)) navigate(() => workspace.selectTab(entry.tabKey, { history: 'none' })); else navigate(showHome); }
  listen(channel, 'message', onChannel); listen(doc, 'visibilitychange', onVisibility); listen(win, 'online', retryAllStale); listen(win, 'popstate', onPopState);
  listen($('#search'), 'input', (event) => { state.query = event.target.value; renderHome(); });
  listen($('#home-btn'), 'click', () => { if (state.screen === 'home' || state.mode !== 'normal') return; navigate(() => { showHome(); if (hist.state?.threadId || hist.state?.ephemeral) hist.replaceState(null, ''); }); });
  listen($('#tab-new'), 'click', workspace.newSessionTab);
  listen($('#home-new'), 'click', workspace.newSessionTab);

  function dispose() { disposed = true; listeners.splice(0).forEach((remove) => remove()); clearTimer(copiedTimer); channel?.close(); for (const id of [...state.conns.keys()]) machine.dropConnection(id); releaseLeadership?.(); releaseLeadership = null; }
  return { boot, dispose, renderHome, showHome, showUnpaired, showScreen, pairFromLink, retryAllStale, copyText, get isLeader() { return mock || !nav.locks || !!releaseLeadership; } };
}
