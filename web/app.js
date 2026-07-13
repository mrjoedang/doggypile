import { makeRpc } from './rpc.js?v=20260712-ui';
import { createProjection } from './projection.js?v=20260712-ui';
import { renderMarkdown } from './markdown.js?v=20260712-ui';

// `?mock` swaps the iroh transport for a scripted in-page daemon (mock.js) so
// the whole UI can be developed in a plain browser tab.
const wantMock = new URLSearchParams(location.search).has('mock');
const mockMod = wantMock ? await import('./mock.js').catch(() => null) : null; // daemon builds don't ship mock.js
const MOCK = !!mockMod;
const { connect, installAgent, NoSupportedAgentError } = mockMod || await import('./transport.js?v=20260712-ui');

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Static, trusted SVG markup only — never message content.
const ICONS = {
  paw: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="10.2" r="2.1"/><circle cx="9.3" cy="6.5" r="2.3"/><circle cx="14.7" cy="6.5" r="2.3"/><circle cx="18.6" cy="10.2" r="2.1"/><path d="M12 10.5c-2.6 0-5.4 2.5-5.4 5.1 0 1.6 1.2 2.7 2.8 2.7 1 0 1.7-.4 2.6-.4s1.6.4 2.6.4c1.6 0 2.8-1.1 2.8-2.7 0-2.6-2.8-5.1-5.4-5.1z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13.5"/><circle cx="12" cy="16.8" r="0.4" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.5 0-2.9-.3-4.1-.9L3 20l1.1-5.2a8 8 0 0 1-.6-3.3A8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 5 8 12 15 19"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="6"/><polyline points="6 12 12 6 18 12"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="18"/><polyline points="6 12 12 18 18 12"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5.5" x2="12" y2="18.5"/><line x1="5.5" y1="12" x2="18.5" y2="12"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.7 5.4L19 10l-5.3 1.6L12 17l-1.7-5.4L5 10l5.3-1.6z"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 10 12 5 17"/><line x1="12" y1="17" x2="19" y2="17"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg>',
};
const icon = (name, cls = 'icon') => {
  const s = el('span', cls);
  s.innerHTML = ICONS[name];
  return s;
};

const state = {
  devices: [],
  conns: new Map(), // device id -> connection (see connectDevice)
  filter: 'all', // 'all' | device id — a view scope, never a connection switch
  threadId: null,
  threadTitle: '',
  threadDeviceId: null,
  projection: null,
  turnActive: false,
  creatingThread: false,
};

const connFor = (id) => state.conns.get(id);
const activeConn = () => (state.threadDeviceId ? connFor(state.threadDeviceId) : null);
const inChat = () => !!state.threadId;

// --- haptics ---
// iOS Safari has no vibration API. The one thing that ticks (iOS 18+) is
// toggling a native switch control — Safari 17.4's <input type="checkbox"
// switch> — during a real user gesture, which fires the system switch
// haptic. That's an undocumented side effect: if Apple removes it, this
// silently becomes a no-op, which is the intended failure mode. Android
// gets navigator.vibrate. Call sites are deliberately few — commitments
// and state changes, never mere touches — so keep it that way.
let hapticSwitch = null;
function haptic() {
  if (navigator.vibrate) { navigator.vibrate(10); return; }
  if (!hapticSwitch) {
    hapticSwitch = document.createElement('input');
    hapticSwitch.type = 'checkbox';
    hapticSwitch.setAttribute('switch', '');
    hapticSwitch.tabIndex = -1;
    hapticSwitch.setAttribute('aria-hidden', 'true');
    // Must be rendered (display:none suppresses the haptic), just not visible.
    hapticSwitch.style.cssText = 'position:fixed;top:-100px;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.append(hapticSwitch);
  }
  hapticSwitch.click(); // only ticks when called inside a user gesture
}

// --- view transitions ---
// Navigation-level swaps only (sessions <-> chat, filter changes), and only
// a plain crossfade — shared-element morphs proved too distracting for an
// action performed dozens of times a day. Streaming ticks and reconnect
// repaints never go through here: transitions capture snapshots and briefly
// intercept input, which would jank a live turn.
const VT = !!document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (VT) document.documentElement.classList.add('vt');
function navigate(update) {
  if (!VT) { update(); return; }
  document.startViewTransition(() => { update(); });
}

// --- device registry ---
// One phone can hold pairings to many daemons. Persisted as
// `doggypile:devices` { v: 1, devices: [{ id, name, token, relay, addrs,
// addedAt, lastConnectedAt, lastError }] }, keyed by iroh node id. The old
// single-slot `doggypile:creds` key migrates on first load and is left in
// place so a rollback to an older build still reconnects.
const DEVICES_KEY = 'doggypile:devices';
const LEGACY_CREDS_KEY = 'doggypile:creds';

function loadDevices() {
  if (MOCK) return [{ id: 'mock', name: 'mock', token: 'mock', relay: null, addrs: [] }];
  let devices = [];
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICES_KEY) || 'null');
    if (saved?.v === 1 && Array.isArray(saved.devices)) devices = saved.devices.filter((d) => d?.id && d?.token);
  } catch { /* corrupted registry: fall through to migration */ }
  if (!devices.length) {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_CREDS_KEY) || 'null');
      if (legacy?.node && legacy?.token) {
        devices = [{ id: legacy.node, name: null, token: legacy.token, relay: legacy.relay ?? null, addrs: legacy.addrs || [], addedAt: Date.now() }];
        persistDevices(devices);
      }
    } catch { /* no legacy creds either */ }
  }
  return devices;
}

function persistDevices(devices) {
  if (MOCK) return;
  localStorage.setItem(DEVICES_KEY, JSON.stringify({ v: 1, devices }));
}

function updateDevice(id, patch) {
  const dev = state.devices.find((d) => d.id === id);
  if (!dev) return;
  Object.assign(dev, patch);
  persistDevices(state.devices);
}

// A scanned QR lands here as a URL fragment. Upsert by node id: re-scanning a
// known machine refreshes its token/addresses, a new machine joins the list.
function upsertFromFragment(devices) {
  if (MOCK) return null;
  const frag = new URLSearchParams(location.hash.slice(1));
  const node = frag.get('node');
  const token = frag.get('token');
  if (!node || !token) return null;
  const relay = frag.get('relay'); // URLSearchParams decodes it
  const addrs = frag.getAll('addr');
  const name = frag.get('name');
  let dev = devices.find((d) => d.id === node);
  if (dev) {
    Object.assign(dev, { token, relay, addrs });
    if (name) dev.name = name;
  } else {
    dev = { id: node, name, token, relay, addrs, addedAt: Date.now() };
    devices.push(dev);
  }
  persistDevices(devices);
  // Preserve any thread-restore state the history entry carries.
  history.replaceState(history.state, '', location.pathname + location.search);
  return dev;
}

function deviceLabel(d) {
  return d?.name || (d ? `${d.id.slice(0, 8)}…` : '');
}

// --- connection pool ---
// Every remembered machine keeps its own live connection; the chip row is a
// view filter, never a connection switch. Each connection reconnects
// independently with jittered exponential backoff, and a soft display
// timeout marks slow dials offline long before iroh's 30s give-up.

const SOFT_DIAL_TIMEOUT_MS = 6000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

function connectAllDevices() {
  for (const dev of state.devices) {
    if (!state.conns.has(dev.id)) connectDevice(dev);
  }
}

function connectDevice(dev, { resetBackoff = false } = {}) {
  let conn = state.conns.get(dev.id);
  if (!conn) {
    conn = {
      dev,
      status: 'connecting',
      attempt: 0,
      backoffMs: BACKOFF_BASE_MS,
      transport: null,
      rpc: null,
      agent: null,
      metrics: null,
      retryTimer: null,
      softTimer: null,
      threads: null, // null = never loaded; [] = loaded empty
      threadsLoading: false,
      lastDetail: '',
      everConnected: false,
    };
    state.conns.set(dev.id, conn);
  }
  if (resetBackoff) conn.backoffMs = BACKOFF_BASE_MS;
  clearTimeout(conn.retryTimer);
  conn.retryTimer = null;
  dialConn(conn);
  return conn;
}

async function dialConn(conn) {
  const attempt = ++conn.attempt;
  const dev = conn.dev;
  markConn(conn, 'connecting');
  clearTimeout(conn.softTimer);
  // Iroh only gives up after ~30s; show "offline" much sooner while the dial
  // keeps trying underneath, so a dead machine reads as dead quickly.
  conn.softTimer = setTimeout(() => {
    if (conn.attempt === attempt && conn.status === 'connecting') markConn(conn, 'offline', 'not responding');
  }, SOFT_DIAL_TIMEOUT_MS);

  try {
    const transport = await connect({
      nodeId: dev.id,
      token: dev.token,
      relay: dev.relay,
      directAddrs: dev.addrs || [],
      onToken: (token) => updateDevice(dev.id, { token }),
      onMetrics: (metrics) => {
        conn.metrics = metrics;
        if (metrics.agent) conn.agent = metrics.agent;
      },
      onLine: (line) => conn.rpc?.handleLine(line),
      onClose: () => {
        if (conn.attempt !== attempt) return;
        markConn(conn, 'offline', 'connection closed');
        scheduleReconnect(conn);
      },
    });
    if (conn.attempt !== attempt) { transport.close(); return; }
    conn.transport = transport;
    conn.agent = transport.agent || conn.agent;
    conn.rpc = makeRpc(transport, { onNotify: (msg) => onNotify(conn, msg) });
    await conn.rpc.initialize();
    if (conn.attempt !== attempt) return;
    clearTimeout(conn.softTimer);
    conn.backoffMs = BACKOFF_BASE_MS;
    conn.everConnected = true;
    updateDevice(dev.id, { lastConnectedAt: Date.now(), lastError: null });
    markConn(conn, 'connected');
    loadThreads(conn);
    if (inChat() && state.threadDeviceId === dev.id) {
      // The chat we're looking at lives on this machine: re-subscribe.
      openThread(dev.id, state.threadId, state.threadTitle);
    }
  } catch (e) {
    if (conn.attempt !== attempt) return;
    clearTimeout(conn.softTimer);
    const detail = e instanceof Error ? e.message : String(e);
    if (/already-used|invalid/i.test(detail)) {
      // This machine's pairing is dead. Keep the entry (name, history) so a
      // re-scan upserts back into place, but stop retrying.
      updateDevice(dev.id, { lastError: 'pairing expired' });
      markConn(conn, 'expired', 'pairing expired — re-scan its QR');
      return;
    }
    if (e instanceof NoSupportedAgentError) {
      conn.installable = !!e.hostCapabilities?.includes('install_agent');
      markConn(conn, 'noagent', detail);
      return;
    }
    updateDevice(dev.id, { lastError: detail, lastErrorAt: Date.now() });
    markConn(conn, 'offline', detail);
    scheduleReconnect(conn);
  }
}

function scheduleReconnect(conn, delayMs) {
  if (conn.retryTimer || !state.conns.has(conn.dev.id)) return;
  const jitter = 0.7 + Math.random() * 0.6; // ±30%
  const delay = delayMs ?? Math.round(conn.backoffMs * jitter);
  conn.backoffMs = Math.min(conn.backoffMs * 2, BACKOFF_MAX_MS);
  conn.retryTimer = setTimeout(() => {
    conn.retryTimer = null;
    dialConn(conn);
  }, delay);
}

function markConn(conn, status, detail) {
  conn.status = status;
  if (detail !== undefined) conn.lastDetail = detail || '';
  renderChips();
  if (!inChat() && (status === 'connected' || conn.threads === null)) renderSessions();
}

function dropConn(id) {
  const conn = state.conns.get(id);
  if (!conn) return;
  conn.attempt++; // invalidate in-flight dials and close callbacks
  clearTimeout(conn.retryTimer);
  clearTimeout(conn.softTimer);
  try { conn.transport?.close(); } catch { /* already closed */ }
  state.conns.delete(id);
}

async function loadThreads(conn) {
  if (conn.threadsLoading || !conn.rpc) return;
  conn.threadsLoading = true;
  try {
    const res = await conn.rpc.request('thread/list', {});
    conn.threads = res?.data || [];
  } catch (e) {
    conn.threads = conn.threads || [];
    conn.lastDetail = `couldn’t list sessions: ${e?.message || e}`;
  } finally {
    conn.threadsLoading = false;
  }
  renderChips(); // session counts live on the chips
  if (!inChat()) renderSessions();
}

// Retry every non-connected machine immediately when the app comes back to
// the foreground or the network returns.
function retryAllStale() {
  for (const conn of state.conns.values()) {
    if (conn.status === 'offline') {
      clearTimeout(conn.retryTimer);
      conn.retryTimer = null;
      conn.backoffMs = BACKOFF_BASE_MS;
      dialConn(conn);
    }
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) retryAllStale(); });
window.addEventListener('online', retryAllStale);

// --- header / composer chrome ---
function setHeader(...nodes) {
  $('#header-left').replaceChildren(...nodes);
}
function brandEl() {
  const wrap = el('span', 'brand');
  wrap.append(icon('paw', 'icon brand-paw'), el('span', 'brand-name', 'doggypile'));
  return wrap;
}
function backBtn() {
  const b = el('button', 'back-btn');
  b.append(icon('chevronLeft', 'icon back-icon'), el('span', null, 'Sessions'));
  b.setAttribute('aria-label', 'Back to sessions');
  b.onclick = () => history.back();
  return b;
}
function showComposer(show) {
  $('#composer').hidden = !show;
  $('#jump').hidden = true;
  updateComposer();
}
function updateComposer() {
  $('#stop').hidden = !state.turnActive;
  $('#send').disabled = !$('#input').value.trim() || !state.threadId;
}

// --- centered state blocks (pairing / loading / error / empty) ---
function stateBox({ icon: iconName, spinner, title, body, action }) {
  const box = el('div', 'state view');
  if (spinner) box.append(el('div', 'spinner'));
  if (iconName) box.append(icon(iconName, 'state-icon'));
  if (title) box.append(el('div', 'state-title', title));
  if (body) {
    const p = el('p', 'state-body');
    typeof body === 'string' ? (p.textContent = body) : p.append(...body);
    box.append(p);
  }
  if (action) box.append(action);
  return box;
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth; // restart the slide-in animation
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

async function boot() {
  // Restore the thread from the history entry so a reload lands back in it.
  if (history.state?.threadId) {
    state.threadId = history.state.threadId;
    state.threadTitle = history.state.title || '';
    state.threadDeviceId = history.state.deviceId || null;
  }
  state.devices = loadDevices();
  loadThreadCache();
  upsertFromFragment(state.devices);
  if (!state.devices.length) {
    showUnpaired();
    return;
  }
  // History entries from the single-device era carry no deviceId.
  if (state.threadId && !state.threadDeviceId) state.threadDeviceId = state.devices[0].id;

  await ensureLeadership();
  startPool();
}

function startPool() {
  if (inChat()) openThread(state.threadDeviceId, state.threadId, state.threadTitle);
  else showSessions();
  connectAllDevices();
}

// --- multi-tab coordination ---
// Exactly one tab owns the connection pool: iroh endpoints, reconnect
// timers, and auth-token rotation must not race across tabs. Leadership is a
// Web Lock held for the tab's lifetime; other tabs park on the lock queue
// and take over automatically when the leader goes away, or on request via
// BroadcastChannel.
let releaseLeadership = null;
const tabChannel = !MOCK && 'BroadcastChannel' in window ? new BroadcastChannel('doggypile:tabs') : null;

async function ensureLeadership() {
  if (MOCK || !navigator.locks) return; // mock is a dev tool; let tabs multiply
  const got = await new Promise((resolve) => {
    navigator.locks.request('doggypile:pool', { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise((release) => { releaseLeadership = release; });
    }).catch(() => resolve(true)); // Locks API misbehaving: act alone rather than brick the app
  });
  if (got) return;
  showFollowerBox();
  await new Promise((resolve) => {
    navigator.locks.request('doggypile:pool', () => {
      resolve();
      return new Promise((release) => { releaseLeadership = release; });
    }).catch(() => resolve());
  });
}

function showFollowerBox() {
  setHeader(brandEl());
  showComposer(false);
  $('#chips').hidden = true;
  const use = el('button', 'btn btn-accent', 'Use this tab');
  use.onclick = () => {
    tabChannel?.postMessage('takeover');
    use.disabled = true;
    use.textContent = 'Taking over…';
  };
  $('#main').replaceChildren(stateBox({
    icon: 'paw',
    title: 'Open in another tab',
    body: 'doggypile is already connected from another tab or window. Close it and this one takes over automatically.',
    action: use,
  }));
}

tabChannel?.addEventListener('message', async (e) => {
  if (e.data !== 'takeover' || !releaseLeadership) return;
  // Another tab asked for the pool: tear ours down and yield the lock.
  for (const id of [...state.conns.keys()]) dropConn(id);
  releaseLeadership();
  releaseLeadership = null;
  await ensureLeadership(); // parks this tab as a follower
  startPool(); // and resumes if leadership ever comes back
});

function showUnpaired() {
  setHeader(brandEl());
  showComposer(false);
  renderChips();
  $('#main').replaceChildren(stateBox({
    icon: 'paw',
    title: 'Pair this device',
    body: [
      'Run ',
      el('code', null, 'doggypile pair'),
      ' on your computer, then scan the QR code with this phone to connect.',
    ],
  }));
}

async function installOnConn(conn) {
  if (!conn.installable) {
    toast('No supported agent on this machine, and its daemon is too old for remote install. Restart doggypile there from a newer build.');
    return;
  }
  if (!confirm(`No supported agent on ${deviceLabel(conn.dev)}. Install opencode there now?\n\nThis will run:\ncurl -fsSL https://opencode.ai/install | bash`)) return;
  markConn(conn, 'connecting', 'installing opencode');
  toast(`Installing opencode on ${deviceLabel(conn.dev)}…`);
  try {
    await installAgent({
      nodeId: conn.dev.id,
      token: conn.dev.token,
      relay: conn.dev.relay,
      directAddrs: conn.dev.addrs || [],
      agent: 'opencode',
      onToken: (token) => updateDevice(conn.dev.id, { token }),
    });
  } catch (e) {
    let detail = e instanceof Error ? e.message : String(e);
    if (/stream closed/i.test(detail)) detail = 'the daemon closed the install request — it may be too old';
    markConn(conn, 'noagent', detail);
    toast(`opencode install failed on ${deviceLabel(conn.dev)}: ${detail}`);
    return;
  }
  dialConn(conn);
}

// --- machine chips ---
function renderChips() {
  const bar = $('#chips');
  if (!bar) return;
  if (!state.devices.length || inChat()) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.replaceChildren();

  const totalCount = [...state.conns.values()].reduce((n, c) => n + (c.threads?.length || 0), 0);
  const all = el('button', 'chip-btn', 'All');
  all.setAttribute('aria-pressed', String(state.filter === 'all'));
  if (totalCount) all.append(el('span', 'cnt', String(totalCount)));
  all.onclick = () => { if (state.filter !== 'all') haptic(); navigate(() => { state.filter = 'all'; renderChips(); renderSessions(); }); };
  bar.append(all);

  for (const dev of state.devices) {
    const conn = connFor(dev.id);
    const status = conn?.status || 'connecting';
    const chip = el('button', 'chip-btn');
    chip.setAttribute('aria-pressed', String(state.filter === dev.id));
    chip.dataset.offline = String(status === 'offline' || status === 'expired');
    const dot = el('span', 'sdot');
    dot.dataset.s = status;
    chip.append(dot, document.createTextNode(deviceLabel(dev)));
    const n = conn?.threads?.length;
    if (n) chip.append(el('span', 'cnt', String(n)));
    chip.onclick = () => chipTap(dev);
    attachLongPress(chip, () => machineMenu(dev));
    bar.append(chip);
  }

  const add = el('button', 'chip-btn chip-add');
  add.setAttribute('aria-label', 'Pair another machine');
  add.append(icon('plus'));
  add.onclick = addMachineSheet;
  bar.append(add);
}

function chipTap(dev) {
  const conn = connFor(dev.id);
  const status = conn?.status;
  if (status === 'offline') {
    toast(`Reconnecting to ${deviceLabel(dev)}…`);
    clearTimeout(conn.retryTimer);
    conn.retryTimer = null;
    conn.backoffMs = BACKOFF_BASE_MS;
    dialConn(conn);
    return;
  }
  if (status === 'expired') {
    toast(`Pairing with ${deviceLabel(dev)} expired — run doggypile pair there and re-scan the QR.`);
    return;
  }
  if (status === 'noagent') {
    installOnConn(conn);
    return;
  }
  haptic();
  navigate(() => {
    state.filter = state.filter === dev.id ? 'all' : dev.id; // same-tap clears
    renderChips();
    renderSessions();
  });
}

function attachLongPress(node, fn) {
  let timer = null;
  let fired = false;
  const start = () => { fired = false; timer = setTimeout(() => { fired = true; haptic(); fn(); }, 480); };
  const cancel = () => clearTimeout(timer);
  node.addEventListener('pointerdown', start);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) fn(); });
  node.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

// --- sheets ---
let sheetEls = null;
function openSheet(build) {
  closeSheet();
  const scrim = el('div', 'scrim');
  scrim.onclick = closeSheet;
  const sheet = el('div', 'sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.append(el('div', 'sheet-grab'));
  build(sheet);
  document.body.append(scrim, sheet);
  sheetEls = [scrim, sheet];
}
function closeSheet() {
  sheetEls?.forEach((n) => n.remove());
  sheetEls = null;
}

function sheetTitleRow(dev, conn) {
  const title = el('div', 'sheet-title');
  const dot = el('span', 'sdot');
  dot.dataset.s = conn?.status || 'connecting';
  title.append(dot, document.createTextNode(deviceLabel(dev)));
  return title;
}

function connSubtitle(conn) {
  if (!conn) return 'connecting…';
  if (conn.status === 'connected') {
    const path = conn.metrics?.path?.selected;
    const rtt = conn.metrics?.path?.rtt_ms;
    return [conn.agent, path && path !== 'unknown' ? `${path}${rtt != null ? ` · ${rtt}ms` : ''}` : null]
      .filter(Boolean).join(' · ') || 'connected';
  }
  return conn.lastDetail || conn.status;
}

function machineMenu(dev) {
  const conn = connFor(dev.id);
  openSheet((sheet) => {
    sheet.append(sheetTitleRow(dev, conn), el('div', 'sheet-sub', connSubtitle(conn)));
    const actions = [
      ['Reconnect', () => { closeSheet(); chipTapReconnect(dev); }, conn?.status === 'connected'],
      ['Rename', () => renameSheet(dev)],
      ['Details', () => detailsSheet(dev)],
      ['Forget machine', () => forgetSheet(dev), false, true],
    ];
    for (const [label, fn, disabled, danger] of actions) {
      const row = el('button', 'action-row' + (danger ? ' danger' : ''), label);
      if (disabled) row.setAttribute('disabled', '');
      else row.onclick = fn;
      sheet.append(row);
    }
  });
}

function chipTapReconnect(dev) {
  const conn = connFor(dev.id) || connectDevice(dev);
  clearTimeout(conn.retryTimer);
  conn.retryTimer = null;
  conn.backoffMs = BACKOFF_BASE_MS;
  dialConn(conn);
  toast(`Reconnecting to ${deviceLabel(dev)}…`);
}

function renameSheet(dev) {
  openSheet((sheet) => {
    sheet.append(el('div', 'sheet-title', `Rename ${deviceLabel(dev)}`));
    sheet.append(el('div', 'sheet-sub', 'Local nickname only — the computer keeps its hostname.'));
    const input = el('input', 'field');
    input.value = dev.name || '';
    input.placeholder = dev.id.slice(0, 8);
    input.maxLength = 24;
    const btns = el('div', 'sheet-btns');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = closeSheet;
    const save = el('button', 'btn btn-accent', 'Save');
    save.onclick = () => {
      const v = input.value.trim();
      updateDevice(dev.id, { name: v || null });
      closeSheet();
      renderChips();
      renderSessions();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') save.onclick(); };
    btns.append(cancel, save);
    sheet.append(input, btns);
    setTimeout(() => input.select(), 60);
  });
}

function detailsSheet(dev) {
  const conn = connFor(dev.id);
  openSheet((sheet) => {
    sheet.append(sheetTitleRow(dev, conn), el('div', 'sheet-sub', connSubtitle(conn)));
    const rows = [
      ['status', conn?.status || 'connecting'],
      ['agent', conn?.agent || '—'],
      ['node id', dev.id],
      ['relay', dev.relay || '—'],
      ['sessions', conn?.threads ? String(conn.threads.length) : '—'],
      ['last connected', dev.lastConnectedAt ? rel(dev.lastConnectedAt) : '—'],
      ['last error', dev.lastError || '—'],
    ];
    for (const [k, v] of rows) {
      const kv = el('div', 'kv');
      kv.append(el('span', 'k', k), el('span', 'v', v));
      sheet.append(kv);
    }
  });
}

function forgetSheet(dev) {
  openSheet((sheet) => {
    sheet.append(el('div', 'sheet-title', `Forget ${deviceLabel(dev)}?`));
    sheet.append(el('div', 'sheet-sub', 'Removes the pairing and its sessions from this phone. Nothing is deleted on the computer — re-pair any time with a new QR.'));
    const btns = el('div', 'sheet-btns');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = closeSheet;
    const doit = el('button', 'btn btn-danger', 'Forget machine');
    doit.onclick = () => {
      haptic();
      closeSheet();
      dropConn(dev.id);
      purgeThreadCache(dev.id);
      state.devices = state.devices.filter((d) => d.id !== dev.id);
      persistDevices(state.devices);
      if (state.filter === dev.id) state.filter = 'all';
      if (!state.devices.length) { showUnpaired(); return; }
      renderChips();
      renderSessions();
      toast(`Forgot ${deviceLabel(dev)}. Scan its QR again to re-pair.`);
    };
    btns.append(cancel, doit);
    sheet.append(btns);
  });
}

function addMachineSheet() {
  openSheet((sheet) => {
    sheet.append(el('div', 'sheet-title', 'Pair another machine'));
    const sub = el('div', 'sheet-sub');
    sub.append('Run ', el('code', null, 'doggypile pair'), ' on the other computer, then scan its QR code with this phone. It joins the list — nothing here is replaced.');
    sheet.append(sub);
    const input = el('input', 'field');
    input.placeholder = 'or paste a pair link…';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    const btns = el('div', 'sheet-btns');
    const cancel = el('button', 'btn', 'Close');
    cancel.onclick = closeSheet;
    const add = el('button', 'btn btn-accent', 'Add from link');
    add.onclick = () => {
      const text = input.value.trim();
      const hashIdx = text.indexOf('#');
      const frag = new URLSearchParams(hashIdx >= 0 ? text.slice(hashIdx + 1) : text);
      const node = frag.get('node');
      const token = frag.get('token');
      if (!node || !token) { toast('That doesn’t look like a pair link.'); return; }
      let dev = state.devices.find((d) => d.id === node);
      if (dev) {
        Object.assign(dev, { token, relay: frag.get('relay'), addrs: frag.getAll('addr') });
        if (frag.get('name')) dev.name = frag.get('name');
        dropConn(dev.id); // stale transport used the old token
      } else {
        dev = { id: node, name: frag.get('name'), token, relay: frag.get('relay'), addrs: frag.getAll('addr'), addedAt: Date.now() };
        state.devices.push(dev);
      }
      persistDevices(state.devices);
      closeSheet();
      connectDevice(dev, { resetBackoff: true });
      renderChips();
      renderSessions();
      toast(`Pairing ${deviceLabel(dev)}…`);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') add.onclick(); };
    btns.append(cancel, add);
    sheet.append(input, btns);
  });
}

// --- sessions list ---
function sectionHead() {
  const row = el('div', 'section-head');
  const scope = state.filter === 'all' ? 'Sessions' : `Sessions · ${deviceLabel(state.devices.find((d) => d.id === state.filter))}`;
  row.append(el('span', 'section-title', scope));
  const add = el('button', 'btn btn-accent btn-small');
  add.append(icon('plus', 'icon btn-icon'), el('span', null, 'New'));
  add.setAttribute('aria-label', 'New session');
  add.onclick = newThreadFlow;
  row.append(add);
  return row;
}

function skeletonList(n = 5) {
  const wrap = el('div', 'view');
  for (let i = 0; i < n; i++) {
    const row = el('div', 'skeleton-row');
    row.append(el('div', 'skeleton-bar long'), el('div', 'skeleton-bar short'));
    wrap.append(row);
  }
  return wrap;
}

// Navigation-level entry: leave any chat, then paint whatever the pool has.
function showSessions() {
  state.threadId = null;
  state.threadTitle = '';
  state.threadDeviceId = null;
  setHeader(brandEl());
  showComposer(false);
  renderChips();
  renderSessions();
}

const tsVal = (t) => {
  const raw = t.updatedAt || t.recencyAt;
  if (!raw) return 0;
  const n = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(n) ? (n < 10_000_000_000 ? n * 1000 : n) : 0;
};

// Data-level (re)paint of the merged list. Called whenever any machine's
// connection state or thread list changes while the list is on screen.
function renderSessions() {
  if (inChat()) return;
  const conns = [...state.conns.values()].filter((c) => state.filter === 'all' || c.dev.id === state.filter);
  const merged = [];
  for (const conn of conns) {
    for (const t of conn.threads || []) merged.push({ t, conn });
  }
  merged.sort((a, b) => tsVal(b.t) - tsVal(a.t));

  if (!merged.length) {
    const waiting = conns.some((c) => c.status === 'connecting' || (c.status === 'connected' && c.threads === null));
    if (waiting) {
      $('#main').replaceChildren(sectionHead(), skeletonList());
      return;
    }
    const allDead = conns.length && conns.every((c) => c.status === 'offline' || c.status === 'expired' || c.status === 'noagent');
    if (allDead) {
      const retry = el('button', 'btn', 'Retry now');
      retry.onclick = retryAllStale;
      const which = state.filter === 'all' && state.devices.length > 1 ? 'any of your machines' : 'this machine';
      $('#main').replaceChildren(sectionHead(), stateBox({
        icon: 'warn',
        title: `Can’t reach ${which}`,
        body: conns.map((c) => `${deviceLabel(c.dev)}: ${c.lastDetail || c.status}`).join('\n'),
        action: retry,
      }));
      return;
    }
    const start = el('button', 'btn btn-accent', 'Start a session');
    start.onclick = newThreadFlow;
    $('#main').replaceChildren(sectionHead(), stateBox({
      icon: 'chat',
      title: 'No sessions yet',
      body: 'Start a session to chat with the agent on your computer.',
      action: start,
    }));
    return;
  }

  const list = el('div', 'sessions view');
  const showMachine = state.devices.length > 1;
  for (const { t, conn } of merged) {
    const title = t.name || t.preview || 'Untitled session';
    const row = el('button', 'session');
    const main = el('div', 'session-main');
    main.append(el('div', 'session-title', title));
    const meta = el('div', 'session-meta');
    if (showMachine) {
      const chip = el('span', 'mchip');
      const dot = el('span', 'sdot');
      dot.dataset.s = conn.status;
      chip.append(dot, document.createTextNode(deviceLabel(conn.dev)));
      meta.append(chip);
    }
    const dir = short(t.cwd);
    if (dir) meta.append(el('span', 'session-dir', dir));
    const when = rel(t.updatedAt || t.recencyAt);
    if (when) meta.append(el('span', 'session-time', when));
    main.append(meta);
    row.append(main, icon('chevronRight', 'icon session-chevron'));
    row.onclick = () => navigate(() => navigateToThread(conn.dev.id, t.id, title));
    list.append(row);
  }
  $('#main').replaceChildren(sectionHead(), list);
}

// Every session lives on one machine, so creating one needs a target:
// the active filter if it's a machine, the only machine, or a picker.
function newThreadFlow() {
  if (state.filter !== 'all') return newThread(state.filter);
  const connected = state.devices.filter((d) => connFor(d.id)?.status === 'connected');
  if (state.devices.length === 1) return newThread(state.devices[0].id);
  if (connected.length === 1) return newThread(connected[0].id);
  openSheet((sheet) => {
    sheet.append(el('div', 'sheet-title', 'New session on…'));
    for (const dev of state.devices) {
      const conn = connFor(dev.id);
      const ok = conn?.status === 'connected';
      const row = el('button', 'action-row');
      if (!ok) row.setAttribute('disabled', '');
      const dot = el('span', 'sdot');
      dot.dataset.s = conn?.status || 'connecting';
      const main = el('div', 'action-main');
      main.append(document.createTextNode(deviceLabel(dev)), el('span', 'action-sub', connSubtitle(conn)));
      row.append(dot, main);
      if (ok) row.onclick = () => { closeSheet(); newThread(dev.id); };
      sheet.append(row);
    }
  });
}

async function newThread(deviceId) {
  const conn = connFor(deviceId);
  if (conn?.status !== 'connected') {
    toast(`${deviceLabel(conn?.dev || { id: deviceId })} isn’t connected.`);
    return;
  }
  if (state.creatingThread) return;
  state.creatingThread = true;
  try {
    const res = await conn.rpc.request('thread/start', {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    const id = res?.thread?.id;
    if (id) await navigateToThread(deviceId, id, 'New session');
  } catch (e) {
    toast(`Couldn’t start a session: ${e?.message || e}`);
  } finally {
    state.creatingThread = false;
  }
}

// --- chat ---
const chat = {
  nodes: new Map(), // item id -> { el, kind, update(m), ... }
  log: null,
  hintEl: null,
  workingEl: null,
  forceStick: false, // one-shot: scroll to bottom regardless of position (e.g. after send)
};

// --- thread cache (stale-while-revalidate) ---
// Last hydrated state of recently opened threads, keyed `deviceId:threadId`.
// Opening a cached thread paints instantly from here while a fresh
// thread/read runs behind it; renderChat reconciles by item id, so the
// refresh diffs in without a flash. Persisted so cold launches (and offline
// machines) still show the last known conversation.
const THREADS_KEY = 'doggypile:threads';
const THREAD_CACHE_MAX = 12;
const threadCache = new Map(); // key -> { thread, at }

function loadThreadCache() {
  if (MOCK) return;
  try {
    const saved = JSON.parse(localStorage.getItem(THREADS_KEY) || 'null');
    if (saved?.v === 1) {
      for (const [k, e] of Object.entries(saved.entries || {})) {
        if (e?.thread) threadCache.set(k, e);
      }
    }
  } catch { /* corrupted cache: start empty */ }
}

function persistThreadCache() {
  if (MOCK) return;
  try {
    const entries = Object.fromEntries(threadCache);
    const json = JSON.stringify({ v: 1, entries });
    if (json.length < 2_000_000) localStorage.setItem(THREADS_KEY, json);
  } catch { /* quota exceeded: cache stays in-memory only */ }
}

function cacheThread(key, thread) {
  threadCache.set(key, { thread, at: Date.now() });
  while (threadCache.size > THREAD_CACHE_MAX) {
    const oldest = [...threadCache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0];
    threadCache.delete(oldest);
  }
  persistThreadCache();
}

function purgeThreadCache(deviceId) {
  for (const k of [...threadCache.keys()]) {
    if (k.startsWith(`${deviceId}:`)) threadCache.delete(k);
  }
  persistThreadCache();
}

// User-initiated navigation into a thread: records a history entry so the
// platform back gesture/button returns to the session list. Reconnect-resume
// and popstate call openThread directly to avoid stacking duplicate entries.
function navigateToThread(deviceId, id, title) {
  history.pushState({ deviceId, threadId: id, title: title || '' }, '');
  return openThread(deviceId, id, title);
}

async function openThread(deviceId, id, title) {
  state.threadDeviceId = deviceId;
  state.threadId = id;
  if (title) state.threadTitle = title;
  state.projection = createProjection();
  chat.nodes.clear();
  chat.log = null;
  const conn = connFor(deviceId);
  const dev = conn?.dev || state.devices.find((d) => d.id === deviceId);
  setHeader(backBtn(), el('div', 'topbar-title', state.threadTitle || 'Session'));
  renderChips(); // hides the row while in chat
  showComposer(true);
  $('#input').placeholder = `Message ${conn?.agent || 'the agent'} on ${deviceLabel(dev) || 'your computer'}`;
  const cacheKey = `${deviceId}:${id}`;
  const cached = threadCache.get(cacheKey)?.thread;
  if (cached) {
    // Instant paint from the last known state; a fresh read diffs in below.
    state.projection.seedFromThread(cached);
    chat.forceStick = true;
    renderChat();
  }

  if (conn?.status !== 'connected' || !conn.rpc) {
    // Not connected (yet). dialConn re-enters openThread when this machine
    // comes up; a cached conversation stays readable in the meantime.
    if (!cached) $('#main').replaceChildren(stateBox({ spinner: true, body: `Connecting to ${deviceLabel(dev) || 'your computer'}…` }));
    return;
  }

  if (!cached) {
    // Blank pane now; a spinner only if the read turns out to be slow.
    // Fast opens never flash, slow ones still communicate.
    $('#main').replaceChildren(el('div', 'log view'));
    setTimeout(() => {
      if (state.threadId === id && state.threadDeviceId === deviceId && !chat.log?.isConnected) {
        $('#main').replaceChildren(stateBox({ spinner: true, body: 'Loading conversation…' }));
      }
    }, 200);
  }

  // Resume (subscribes to live turn events) and read (hydrates history) are
  // independent requests — run them concurrently. A freshly started thread
  // isn't materialized until its first message, so thread/read can fail —
  // that's fine, we just start with an empty log.
  const [, res] = await Promise.all([
    conn.rpc.request('thread/resume', { threadId: id }).catch(() => {}),
    conn.rpc.request('thread/read', { threadId: id, includeTurns: true }).catch(() => null),
  ]);
  if (state.threadId !== id || state.threadDeviceId !== deviceId) return; // navigated away while loading
  if (res?.thread) {
    cacheThread(cacheKey, res.thread);
    // Reseed from the fresh read; renderChat diffs by item id into whatever
    // the cached paint already put on screen.
    const fresh = createProjection();
    fresh.seedFromThread(res.thread);
    state.projection = fresh;
  }
  renderChat();
}

function nodeKindOf(m) {
  if (m.role === 'user') return 'user';
  if (m.kind === 'reasoning') return 'reasoning';
  if (m.role === 'tool') return m.kind === 'command' ? 'command' : 'chip';
  return 'assistant';
}

function createNode(m) {
  switch (nodeKindOf(m)) {
    case 'user': return userNode();
    case 'reasoning': return reasoningNode();
    case 'command': return commandNode();
    case 'chip': return chipNode(m);
    default: return assistantNode();
  }
}

function userNode() {
  const root = el('div', 'msg user');
  const body = el('div', 'msg-body');
  root.append(body);
  let last = null;
  return {
    el: root,
    kind: 'user',
    update(m) {
      if (m.text !== last) { last = m.text; body.textContent = m.text || ''; }
    },
  };
}

function assistantNode() {
  const root = el('div', 'msg assistant');
  const body = el('div', 'msg-body md');
  root.append(body);
  let last = null;
  return {
    el: root,
    kind: 'assistant',
    update(m) {
      if (m.text !== last) { last = m.text; body.replaceChildren(renderMarkdown(m.text || '')); }
    },
  };
}

function reasoningNode() {
  const root = el('div', 'reasoning');
  const head = el('button', 'reasoning-head');
  head.type = 'button';
  const label = el('span', 'reasoning-label', 'Thinking');
  const preview = el('span', 'reasoning-preview');
  head.append(icon('spark', 'icon reasoning-icon'), label, preview, icon('chevronDown', 'icon reasoning-chevron'));
  const body = el('div', 'reasoning-body');
  root.append(head, body);
  let open = false;
  head.onclick = () => {
    open = !open;
    root.dataset.open = String(open);
  };
  root.dataset.open = 'false';
  let last = null;
  return {
    el: root,
    kind: 'reasoning',
    update(m) {
      const live = !!m.streamed && state.turnActive;
      root.dataset.live = String(live);
      if (m.text !== last) {
        last = m.text;
        body.textContent = m.text || '';
        const tail = (m.text || '').trim().split('\n').pop() || '';
        preview.textContent = tail.length > 90 ? `…${tail.slice(-90)}` : tail;
      }
    },
  };
}

function commandNode() {
  const root = el('div', 'tool');
  const head = el('button', 'tool-head');
  head.type = 'button';
  const dot = el('span', 'dot');
  const cmd = el('code', 'tool-cmd');
  const chev = icon('chevronDown', 'icon tool-chevron');
  head.append(dot, cmd, chev);
  const out = el('pre', 'tool-out');
  root.append(head, out);

  let open = null; // null = automatic (open while running), boolean = user choice
  const isOpen = (status) => (open === null ? status === 'running' : open);
  head.onclick = () => {
    open = !(root.dataset.open === 'true');
    root.dataset.open = String(open);
  };

  let lastText = null;
  let lastStatus = null;
  return {
    el: root,
    kind: 'command',
    update(m) {
      const status = m.status || 'running';
      if (status !== lastStatus) {
        lastStatus = status;
        dot.dataset.status = status;
        root.dataset.open = String(isOpen(status));
      }
      cmd.textContent = m.command || '';
      const text = (m.text || '').replace(/\s+$/, '');
      if (text !== lastText) {
        lastText = text;
        out.textContent = text;
        root.dataset.hasOutput = String(!!text);
        if (root.dataset.open === 'true') out.scrollTop = out.scrollHeight;
      }
    },
  };
}

function chipNode(m) {
  const root = el('div', 'chip');
  root.append(icon(m.kind === 'fileChange' ? 'file' : 'terminal', 'icon chip-icon'));
  const label = el('span', 'chip-label');
  root.append(label);
  let last = null;
  return {
    el: root,
    kind: 'chip',
    update(mm) {
      if (mm.text !== last) { last = mm.text; label.textContent = mm.text || ''; }
    },
  };
}

function ensureLog() {
  const main = $('#main');
  if (chat.log?.isConnected) return chat.log;
  chat.nodes.clear();
  chat.log = el('div', 'log view');
  chat.hintEl = el('div', 'chat-hint');
  chat.hintEl.append(icon('paw', 'icon chat-hint-icon'), el('div', null, 'Send a message to get started.'));
  chat.workingEl = el('div', 'working');
  chat.workingEl.append(el('span', 'working-label', 'Working'));
  main.replaceChildren(chat.log);
  return chat.log;
}

function renderChat() {
  const main = $('#main');
  const hadLog = !!chat.log?.isConnected;
  // Only stick to the bottom if the user hasn't scrolled up to read history.
  const stick = chat.forceStick || !hadLog || main.scrollHeight - main.scrollTop - main.clientHeight < 80;
  chat.forceStick = false;

  const log = ensureLog();
  const msgs = state.projection.toRenderList();

  const seen = new Set();
  let index = 0;
  for (const m of msgs) {
    let node = chat.nodes.get(m.id);
    if (node && node.kind !== nodeKindOf(m)) { node.el.remove(); node = null; }
    if (!node) { node = createNode(m); chat.nodes.set(m.id, node); }
    node.update(m);
    seen.add(m.id);
    if (log.children[index] !== node.el) log.insertBefore(node.el, log.children[index] || null);
    index++;
  }
  for (const [id, node] of chat.nodes) {
    if (!seen.has(id)) { node.el.remove(); chat.nodes.delete(id); }
  }

  // trailing chrome: empty hint / working indicator
  chat.hintEl.remove();
  chat.workingEl.remove();
  if (!msgs.length && !state.turnActive) log.append(chat.hintEl);
  if (state.turnActive) log.append(chat.workingEl);

  updateComposer();
  if (stick) {
    main.scrollTop = main.scrollHeight;
    requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
  }
  updateJump();
}

let renderPending = false;
function scheduleRenderChat() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    if (state.threadId) renderChat();
  });
}

// --- scroll-to-bottom button ---
function updateJump() {
  const main = $('#main');
  const inChat = !!chat.log?.isConnected;
  const away = main.scrollHeight - main.scrollTop - main.clientHeight > 240;
  $('#jump').hidden = !(inChat && away);
}

function onNotify(conn, msg) {
  if (conn.dev.id !== state.threadDeviceId) return; // event from a machine we're not looking at
  if (msg.params?.threadId && msg.params.threadId !== state.threadId) return;
  if (msg.method === 'turn/started') { state.turnActive = true; scheduleRenderChat(); return; }
  if (msg.method === 'turn/completed' || msg.method === 'turn/failed') { state.turnActive = false; scheduleRenderChat(); return; }
  if (msg.method === 'thread/status/changed') {
    const status = msg.params?.status?.type;
    if (status === 'active' || status === 'busy') state.turnActive = true;
    if (status === 'idle') state.turnActive = false;
    scheduleRenderChat();
    return;
  }
  if (!state.projection) return;
  if (state.projection.applyNotification(msg)) scheduleRenderChat();
}

async function send() {
  const box = $('#input');
  const text = box.value.trim();
  const conn = activeConn();
  if (!text || !state.threadId) return;
  if (!conn?.rpc || conn.status !== 'connected') {
    toast(`${deviceLabel(conn?.dev) || 'This machine'} isn’t connected — hang on.`);
    return;
  }
  haptic();
  box.value = '';
  autoResize();
  const localMessageId = state.projection?.addLocalUserMessage(text);
  state.turnActive = true;
  chat.forceStick = true;
  scheduleRenderChat();
  try {
    await conn.rpc.request('turn/start', {
      threadId: state.threadId,
      input: [{ type: 'text', text, text_elements: [] }],
    });
  } catch (e) {
    state.turnActive = false;
    if (localMessageId) state.projection?.removeLocalMessage(localMessageId);
    if (!box.value) { box.value = text; autoResize(); } // let the user retry
    toast(`Send failed: ${e?.message || e}`);
    scheduleRenderChat();
  }
}

function interrupt() {
  const conn = activeConn();
  if (state.threadId && conn?.rpc) {
    haptic();
    conn.rpc.request('turn/interrupt', { threadId: state.threadId }).catch(() => {});
  }
}

// --- small helpers ---
function autoResize() {
  const box = $('#input');
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 144) + 'px';
  updateComposer();
}
function short(p) { return p ? p.split('/').slice(-1)[0] : ''; }
function rel(ts) {
  if (!ts) return '';
  const raw = typeof ts === 'number' ? ts : Date.parse(ts);
  const d = raw < 10_000_000_000 ? raw * 1000 : raw;
  if (!Number.isFinite(d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

$('#send').onclick = send;
$('#stop').onclick = interrupt;
$('#jump').onclick = () => {
  const main = $('#main');
  main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
};
$('#main').addEventListener('scroll', updateJump, { passive: true });
$('#input').addEventListener('input', autoResize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
window.addEventListener('popstate', (e) => {
  state.threadId = e.state?.threadId || null;
  state.threadTitle = e.state?.title || '';
  state.threadDeviceId = e.state?.deviceId || (state.threadId ? state.devices[0]?.id : null);
  if (!state.devices.length) return;
  if (state.threadId) navigate(() => openThread(state.threadDeviceId, state.threadId, state.threadTitle));
  else navigate(() => showSessions());
});

boot();
