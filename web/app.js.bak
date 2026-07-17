import { makeRpc } from './rpc.js?v=20260714-tabs';
import { createProjection } from './projection.js?v=20260714-tabs';
import { renderMarkdown } from './markdown.js?v=20260714-tabs';
import { createSessionRail } from './rail.js?v=20260716-preview-card';
import { $, el, haptic, hapticize, layout, navigate } from './platform.js?v=20260716-modules';
import { createDeviceRegistry, deviceLabel } from './devices.js?v=20260716-modules';
import { createThreadCache, THREAD_CACHE_MAX } from './thread-cache.js?v=20260716-modules';
import { relativeTime as rel, short, truncate } from './utils.js?v=20260716-modules';
import { createAppState, tabKeyFor } from './state.js?v=20260716-modules';
import { createTabStore } from './tab-store.js?v=20260716-modules';
import { createConnectionPool } from './connections.js?v=20260716-modules';
import { createViewPrimitives } from './view-primitives.js?v=20260716-modules';

// `?mock` swaps the iroh transport for a scripted in-page daemon (mock.js) so
// the whole UI can be developed in a plain browser tab.
const searchParams = new URLSearchParams(location.search);
const wantMock = searchParams.has('mock');
const requestedRailMock = wantMock && searchParams.has('rail');
const mockMod = wantMock ? await import('./mock.js').catch(() => null) : null; // daemon builds don't ship mock.js
const MOCK = !!mockMod;
const RAIL_MOCK = MOCK && requestedRailMock;
const { connect, installAgent, NoSupportedAgentError } = mockMod || await import('./transport.js?v=20260714-tabs');


// Static, trusted SVG markup only — never message content.
const ICONS = {
  paw: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.4" cy="10.2" r="2.1"/><circle cx="9.3" cy="6.5" r="2.3"/><circle cx="14.7" cy="6.5" r="2.3"/><circle cx="18.6" cy="10.2" r="2.1"/><path d="M12 10.5c-2.6 0-5.4 2.5-5.4 5.1 0 1.6 1.2 2.7 2.8 2.7 1 0 1.7-.4 2.6-.4s1.6.4 2.6.4c1.6 0 2.8-1.1 2.8-2.7 0-2.6-2.8-5.1-5.4-5.1z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13.5"/><circle cx="12" cy="16.8" r="0.4" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.5 0-2.9-.3-4.1-.9L3 20l1.1-5.2a8 8 0 0 1-.6-3.3A8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5.5" x2="12" y2="18.5"/><line x1="5.5" y1="12" x2="18.5" y2="12"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  compose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12 15l-4 1 1-4z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.7 5.4L19 10l-5.3 1.6L12 17l-1.7-5.4L5 10l5.3-1.6z"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 10 12 5 17"/><line x1="12" y1="17" x2="19" y2="17"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L7 20l-4 1 1-4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 3 21 9 15 9"/><path d="M20.5 13a8.5 8.5 0 1 1-2-7.5L21 9"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7"/></svg>',
  github: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
};

// Onboarding artwork (static, trusted): the icon.svg paw geometry and the
// decorative QR glyph for the pairing hint chip.
const PAW_LOGO = '<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><ellipse cx="145" cy="228" rx="38" ry="46" transform="rotate(-18 145 228)"/><ellipse cx="216" cy="168" rx="40" ry="49" transform="rotate(-7 216 168)"/><ellipse cx="296" cy="168" rx="40" ry="49" transform="rotate(7 296 168)"/><ellipse cx="367" cy="228" rx="38" ry="46" transform="rotate(18 367 228)"/><path d="M256 250c-52 0-104 47-104 96 0 30 22 50 52 50 19 0 33-8 52-8s33 8 52 8c30 0 52-20 52-50 0-49-52-96-104-96z"/></svg>';
const QR_GLYPH = '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="#716e68" stroke-width="1.6"/><rect x="6.5" y="6.5" width="3" height="3" fill="#f0b35e"/><rect x="23" y="3" width="10" height="10" rx="1.5" stroke="#716e68" stroke-width="1.6"/><rect x="26.5" y="6.5" width="3" height="3" fill="#f0b35e"/><rect x="3" y="23" width="10" height="10" rx="1.5" stroke="#716e68" stroke-width="1.6"/><rect x="6.5" y="26.5" width="3" height="3" fill="#f0b35e"/><rect x="23" y="23" width="3.5" height="3.5" fill="#716e68"/><rect x="29.5" y="23" width="3.5" height="3.5" fill="#f0b35e"/><rect x="23" y="29.5" width="3.5" height="3.5" fill="#f0b35e"/><rect x="29.5" y="29.5" width="3.5" height="3.5" fill="#716e68"/><rect x="16" y="16" width="4" height="4" fill="#716e68"/></svg>';
const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/mrjoedang/doggypile/main/install.sh | sh';
const icon = (name, cls = 'icon') => {
  const s = el('span', cls);
  s.innerHTML = ICONS[name];
  return s;
};
const viewPrimitives = createViewPrimitives({ icon });
const stateBox = viewPrimitives.stateBox;
const toast = viewPrimitives.toast;

const state = createAppState();
const { loadDevices, persistDevices, updateDevice, upsertFromFragment } = createDeviceRegistry({
  mock: MOCK,
  state,
});
const threadCacheStore = createThreadCache({ mock: MOCK });
const threadCache = threadCacheStore.entries;
const loadThreadCache = threadCacheStore.load;
const persistThreadCache = threadCacheStore.persist;
const cacheThread = threadCacheStore.put;
const purgeThreadCache = threadCacheStore.purgeDevice;
const tabStore = createTabStore({ state, tabKeyFor });
const persistTabs = tabStore.persist;
const restoreTabs = tabStore.restore;

const connFor = (id) => state.conns.get(id);
const activeConn = () => (state.threadDeviceId ? connFor(state.threadDeviceId) : null);
const inChat = () => !!state.threadId;
const activeTab = () => state.tabs.find((t) => t.key === state.active) || null;
function renderConnection(conn) {
  renderChips();
  renderStrip();
  if (state.screen === 'home') renderSessions();
  if (state.screen !== 'session') return;
  const tab = activeTab();
  if (tab?.deviceId !== conn.dev.id) return;
  renderMachinePill();
  if (tab.ephemeral) renderEphemeral(tab);
  renderCtxBodySoon();
}

const connectionPool = createConnectionPool({
  state, connect, makeRpc, NoSupportedAgentError, updateDevice, onNotify, loadThreads, openThread, inChat, renderConnection,
});
const connectAllDevices = connectionPool.connectAllDevices;
const connectDevice = connectionPool.connectDevice;
const dropConn = connectionPool.dropConnection;
const scheduleReconnect = connectionPool.scheduleReconnect;
const markConn = connectionPool.markConnection;
let tabLifecycleRevision = 0;
const touchTabLifecycle = (tab) => { tab.lifecycleRevision = ++tabLifecycleRevision; };


const ERROR_CONN_STATES = new Set(['offline', 'expired', 'noagent']);

function tabStatus(tab) {
  const connectionStatus = connFor(tab.deviceId)?.status;
  if (tab.turnError || ERROR_CONN_STATES.has(connectionStatus)) return 'error';
  if (tab.waitingForUser || (tab.unread || 0) > 0) return 'needs-you';
  if (connectionStatus === 'connecting') return 'connecting';
  if (tab.lastTurnActive) return 'working';
  return 'idle';
}

function threadSnapshotStatus(thread, conn) {
  const status = thread?.status || (thread?.mockStatus ? { type: thread.mockStatus } : null);
  const type = typeof status === 'string' ? status : status?.type;
  const flags = typeof status === 'object' && Array.isArray(status?.activeFlags) ? status.activeFlags : [];
  if (ERROR_CONN_STATES.has(conn?.status) || type === 'systemError' || type === 'error') return 'error';
  if (type === 'needs-you' || flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')) return 'needs-you';
  if (conn?.status === 'connecting') return 'connecting';
  if (type === 'active' || type === 'busy' || type === 'working') return 'working';
  return 'idle';
}

function applyThreadStatus(tab, status, { markUnread = false, detail = '' } = {}) {
  if (!status) return false;
  const type = typeof status === 'string' ? status : status.type;
  const flags = typeof status === 'object' && Array.isArray(status.activeFlags) ? status.activeFlags : [];
  const waitingForApproval = flags.includes('waitingOnApproval');
  const waitingForInput = flags.includes('waitingOnUserInput');
  // This is deliberately status-only: doggypile starts turns with approvals
  // disabled. An inherited interactive request can still be interrupted here;
  // rendering full request/response forms is separate protocol/UI work. Do not
  // mislabel a blocked inherited turn as ordinary background work meanwhile.
  const waiting = type === 'needs-you' || waitingForApproval || waitingForInput;

  if (type === 'active' || type === 'busy' || type === 'working' || type === 'needs-you') {
    if (waiting) {
      if (markUnread && !tab.waitingForUser && !tab.unreadForTurn && !tabIsViewed(tab)) {
        tab.unread = Math.min(99, (tab.unread || 0) + 1);
        tab.unreadForTurn = true;
      }
      tab.waitingForUser = true;
      // Waiting is a rail/presentation state; the protocol turn is still
      // active and must retain its Stop/interrupt path.
      tab.lastTurnActive = true;
      tab.turnStartedAt ||= Date.now();
      tab.turnError = '';
      if (waitingForApproval) tab.lastActivityTail = 'Waiting for approval';
      else if (!tab.unreadForTurn) tab.lastActivityTail = 'Waiting for your reply';
    } else {
      tab.waitingForUser = false;
      tab.lastTurnActive = true;
      tab.turnStartedAt ||= Date.now();
      tab.turnError = '';
    }
    return true;
  }
  // `notLoaded` is unknown, not terminal; preserve live/restored state until
  // an authoritative active/idle notification arrives.
  if (type === 'notLoaded') return false;
  if (type === 'idle') {
    tab.waitingForUser = false;
    tab.lastTurnActive = false;
    tab.turnStartedAt = null;
    // Preserve the last failed-turn error through the trailing idle status;
    // a new active turn is the acknowledgment that clears it.
    return true;
  }
  if (type === 'systemError' || type === 'error') {
    tab.waitingForUser = false;
    tab.lastTurnActive = false;
    tab.turnStartedAt = null;
    tab.turnError = detail || status?.error?.message || status?.message || 'Thread error';
    return true;
  }
  return false;
}

function projectionActivity(projection) {
  const messages = projection?.toRenderList?.() || [];
  const message = messages.slice().reverse().find((m) =>
    (m.kind === 'command' && (m.status || 'running') === 'running')
    || (m.role === 'assistant' && m.text));
  if (!message) return '';
  if (message.kind === 'command') return message.command ? `$ ${message.command}` : 'Running a command…';
  const tail = (message.text || '').trim().split('\n').pop()?.replace(/\s+/g, ' ') || '';
  return tail.length > 72 ? `…${tail.slice(-72)}` : tail;
}

function tabActivity(tab) {
  const status = tabStatus(tab);
  const conn = connFor(tab.deviceId);
  if (status === 'error') return tab.turnError || conn?.lastDetail || 'Machine unavailable';
  if (status === 'connecting') return conn?.lastDetail || 'Connecting…';
  if (tab.waitingForUser) return tab.lastActivityTail || 'Waiting for your reply';
  if (tab.key === state.active) {
    const live = projectionActivity(state.projection);
    if (live) return live;
  }
  if (tab.lastActivityTail) return tab.lastActivityTail;
  const meta = conn?.threads?.find((thread) => thread.id === tab.threadId);
  if (status === 'needs-you') return 'Waiting for your reply';
  if (status === 'working') return 'Working…';
  return meta?.preview || 'Done';
}

function tabIsViewed(tab) {
  return state.screen === 'session' && state.active === tab.key && !document.hidden
    && (layout() !== 'mobile' || state.mobilePane === 'session');
}

function markTabViewed(tab) {
  if (!tab) return;
  tab.unread = 0;
  tab.unreadForTurn = false;
  tab.lastViewedAt = Date.now();
}

function finishTabTurn(tab, { failed = false, detail = '', turnId = null } = {}) {
  const effectiveTurnId = turnId || tab.activeTurnId || null;
  // A delayed completion for turn A must never terminate a newer turn B.
  if (turnId && tab.activeTurnId && turnId !== tab.activeTurnId) return false;
  const duplicate = effectiveTurnId
    ? tab.lastFinishedTurnId === effectiveTurnId || tab.terminalWithoutId
    : !!tab.terminalWithoutId;
  if (duplicate) {
    if (failed && !tab.lastTurnActive) tab.turnError = detail || 'Turn failed';
    if (effectiveTurnId && tab.terminalWithoutId) {
      tab.lastFinishedTurnId = effectiveTurnId;
      tab.terminalWithoutId = false;
    }
    return false;
  }
  const now = Date.now();
  tab.lastTurnActive = false;
  tab.waitingForUser = false;
  tab.turnStartedAt = null;
  tab.lastActivityAt = now;
  tab.lastTurnEndedAt = now;
  touchTabLifecycle(tab);
  if (failed) tab.turnError = detail || 'Turn failed';
  if (!duplicate && !tabIsViewed(tab) && !tab.unreadForTurn) tab.unread = Math.min(99, (tab.unread || 0) + 1);
  tab.unreadForTurn = false;
  if (effectiveTurnId) tab.lastFinishedTurnId = effectiveTurnId;
  tab.terminalWithoutId = !effectiveTurnId;
  tab.activeTurnId = null;
  return true;
}

function recordTabActivity(tab, msg) {
  const p = msg.params || {};
  const method = msg.method;
  if (tab.waitingForUser && (method.endsWith('/delta') || method.endsWith('TextDelta'))) return false;
  let text = '';
  if (method === 'item/agentMessage/delta' || method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
    text = `${tab.lastActivityTail || ''}${p.delta || ''}`;
  } else if ((method === 'item/started' || method === 'item/completed') && p.item) {
    if (p.item.type === 'commandExecution') text = p.item.command ? `$ ${p.item.command}` : 'Running a command…';
    else if (p.item.type === 'agentMessage') text = p.item.text || '';
    else if (p.item.type === 'reasoning') {
      const parts = p.item.summary?.length ? p.item.summary : p.item.content || [];
      text = Array.isArray(parts) ? parts.join(' ') : String(parts);
    } else if (p.item.type === 'fileChange') text = 'Editing files…';
  }
  if (!text) return false;
  const clean = text.replace(/\s+/g, ' ').trim();
  const next = clean.length > 100 ? `…${clean.slice(-100)}` : clean;
  if (!next || next === tab.lastActivityTail) return false;
  tab.lastActivityTail = next;
  tab.lastActivityAt = Date.now();
  return true;
}

let activityFlushTimer = null;
function scheduleTabActivityFlush() {
  if (activityFlushTimer) return;
  activityFlushTimer = setTimeout(() => {
    activityFlushTimer = null;
    persistTabs();
    renderStrip();
    if (state.screen === 'home') renderSessions();
  }, 300);
}





let railMockSeeded = false;
async function loadThreads(conn) {
  if (conn.threadsLoading || !conn.rpc) return;
  conn.threadsLoading = true;
  const lifecycleBaseline = new Map(state.tabs.map((tab) => [tab.key, tab.lifecycleRevision || 0]));
  try {
    const res = await conn.rpc.request('thread/list', {});
    conn.threads = res?.data || [];
  } catch (e) {
    conn.threads = conn.threads || [];
    conn.lastDetail = `couldn’t list sessions: ${e?.message || e}`;
  } finally {
    conn.threadsLoading = false;
  }
  // Session names can arrive/refresh here — sync any open tabs. A real name
  // always wins; a preview only fills in when the tab has no better title
  // (e.g. it was restored from history without one).
  for (const tab of state.tabs) {
    if (tab.deviceId !== conn.dev.id || !tab.threadId) continue;
    const t = (conn.threads || []).find((x) => x.id === tab.threadId);
    if (!t) continue;
    if (t.name) tab.title = t.name;
    else if (t.preview && (!tab.title || tab.title === 'Session')) tab.title = t.preview;
    const updated = tsVal(t);
    if (updated) tab.lastActivityAt = Math.max(tab.lastActivityAt || 0, updated);
    const lifecycleUnchanged = lifecycleBaseline.get(tab.key) === (tab.lifecycleRevision || 0);
    const threadStatus = t.status || (t.mockStatus ? { type: t.mockStatus } : null);
    const terminalSnapshot = threadStatus?.type === 'idle';
    // Several bridges publish static idle list snapshots even for a live
    // process. A lifecycle notification, not thread/list, must end known work.
    const staleIdleDuringLiveTurn = terminalSnapshot && tab.lastTurnActive;
    if (lifecycleUnchanged && !staleIdleDuringLiveTurn) {
      applyThreadStatus(tab, threadStatus, { detail: t.mockActivity });
      if (tab.lastTurnActive && ['active', 'busy', 'working', 'needs-you'].includes(threadStatus?.type)) {
        touchTabLifecycle(tab, conn.attempt);
      }
      if (t.mockUnread != null) tab.unread = Number(t.mockUnread) || 0;
    }
  }
  if (RAIL_MOCK && !railMockSeeded && conn.dev.id === state.devices[0]?.id && conn.threads?.length) {
    railMockSeeded = true;
    const now = Date.now();
    for (const [index, thread] of conn.threads.slice(0, 6).entries()) {
      const deviceId = index === 3 && state.devices[1] ? state.devices[1].id : conn.dev.id;
      const key = tabKeyFor(deviceId, thread.id);
      if (state.tabs.some((tab) => tab.key === key)) continue;
      const mockStatus = thread.mockStatus || (index === 0 ? 'working' : index === 2 ? 'needs-you' : 'idle');
      state.tabs.push({
        key, deviceId, threadId: thread.id, title: thread.name || thread.preview || 'Session', ephemeral: false,
        lastTurnActive: mockStatus === 'working', unread: thread.mockUnread ?? (mockStatus === 'needs-you' ? 2 : 0),
        waitingForUser: mockStatus === 'needs-you',
        turnStartedAt: mockStatus === 'working' ? now - (index + 2) * 60_000 : null,
        lastActivityAt: tsVal(thread) || now - index * 60_000,
        lastActivityTail: thread.mockActivity || (mockStatus === 'working' ? 'Running checks…' : ''), draft: '',
        turnError: mockStatus === 'error' ? (thread.mockActivity || 'Mock turn failed') : '',
      });
      cacheThread(key, {
        id: thread.id,
        turns: [{ items: [
          { type: 'userMessage', id: `mock-user-${thread.id}`, content: [{ type: 'text', text: 'Where did we leave off?' }] },
          { type: 'agentMessage', id: `mock-agent-${thread.id}`, text: thread.mockActivity || thread.preview || 'This session is ready to continue.' },
        ] }],
      });
    }
    if (!state.active && state.tabs.length) {
      state.active = state.tabs[0].key;
      history.replaceState({ deviceId: state.tabs[0].deviceId, threadId: state.tabs[0].threadId, title: state.tabs[0].title }, '');
      selectTab(state.active, { history: 'none' });
    }
  }
  persistTabs();
  renderChips(); // session counts live on the chips
  renderStrip();
  if (state.screen === 'home') renderSessions();
  else {
    const tab = activeTab();
    if (tab && tab.deviceId === conn.dev.id && tab.threadId === state.threadId) {
      state.threadTitle = tab.title;
      $('#chat-title').textContent = state.threadTitle || 'Session';
      state.turnActive = !!tab.lastTurnActive;
      updateComposer();
      scheduleRenderChat();
      renderCtxBodySoon();
    }
  }
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  retryAllStale();
  const tab = activeTab();
  if (tab?.unread && tabIsViewed(tab)) {
    markTabViewed(tab);
    persistTabs();
    renderStrip();
  }
});
window.addEventListener('online', retryAllStale);

// --- composer chrome ---
function updateComposer() {
  const tab = activeTab();
  const ephemeralReady = !!(tab?.ephemeral && tab.deviceId && connFor(tab.deviceId)?.status === 'connected');
  $('#stop').hidden = !state.turnActive;
  $('#send').disabled = !$('#input').value.trim() || !(state.threadId || ephemeralReady);
}


async function boot() {
  try { state.ctxOpen = localStorage.getItem('doggypile:ctxOpen') !== '0'; } catch { /* default open */ }
  state.devices = loadDevices();
  loadThreadCache();
  upsertFromFragment(state.devices);
  restoreTabs();
  // Restore the thread from the history entry so a reload lands back in it.
  if (history.state?.threadId) {
    const deviceId = history.state.deviceId || state.devices[0]?.id || null;
    if (deviceId) {
      const key = tabKeyFor(deviceId, history.state.threadId);
      if (!state.tabs.some((t) => t.key === key)) {
        state.tabs.push({ key, deviceId, threadId: history.state.threadId, title: history.state.title || 'Session', ephemeral: false, lastTurnActive: false, unread: 0, turnStartedAt: null, lastActivityAt: Date.now(), lastActivityTail: '', draft: '' });
      }
      state.active = key;
      state.screen = 'session';
      state.threadId = history.state.threadId;
      state.threadDeviceId = deviceId;
      state.threadTitle = history.state.title || '';
    }
  }
  if (!state.devices.length) {
    showUnpaired();
    return;
  }
  await ensureLeadership();
  startPool();
}

function startPool() {
  state.mode = 'normal';
  document.body.classList.remove('unpaired');
  if (state.screen === 'session' && activeTab()) selectTab(state.active, { history: 'none' });
  else showHome();
  connectAllDevices();
  document.body.classList.add('ready'); // first paint: fade the built UI in
}

// --- multi-tab coordination ---
// Exactly one browser tab owns the connection pool: iroh endpoints,
// reconnect timers, and auth-token rotation must not race across tabs.
// Leadership is a Web Lock held for the tab's lifetime; other tabs park on
// the lock queue and take over automatically when the leader goes away, or
// on request via BroadcastChannel.
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
  state.mode = 'follower';
  document.body.classList.remove('unpaired');
  state.screen = 'home';
  showScreen('home');
  $('#home-bar').hidden = true;
  renderChips();
  const use = el('button', 'btn btn-accent', 'Use this tab');
  use.onclick = () => {
    tabChannel?.postMessage('takeover');
    use.disabled = true;
    use.textContent = 'Taking over…';
  };
  $('#homelist').replaceChildren(stateBox({
    icon: 'paw',
    title: 'Open in another tab',
    body: 'doggypile is already connected from another tab or window. Close it and this one takes over automatically.',
    action: use,
  }));
  document.body.classList.add('ready'); // first paint: fade the built UI in
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

function copyText(text) {
  const fallback = () => {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* best effort */ }
    ta.remove();
  };
  if (!navigator.clipboard?.writeText) { fallback(); return Promise.resolve(); }
  return navigator.clipboard.writeText(text).catch(fallback);
}

// First-visit onboarding: pure-black page owned by body.unpaired (the strip is
// hidden; the centered logo + wordmark stand in for it).
function showUnpaired() {
  state.mode = 'unpaired';
  state.screen = 'home';
  showScreen('home');
  document.body.classList.add('unpaired');
  $('#home-bar').hidden = true;
  renderChips();

  const head = el('header', 'pair-head');
  const paw = el('span', 'pair-paw');
  paw.innerHTML = PAW_LOGO;
  head.append(paw, el('h1', 'pair-wordmark', 'doggypile'), el('p', 'pair-tagline', 'Control your agents from anywhere'));

  const step1 = el('li', 'pair-step');
  const body1 = el('div', 'pair-step-body');
  body1.append(
    el('h2', 'pair-step-title', 'Install on your computer'),
    el('p', 'pair-step-desc', 'Run this in the terminal where your agents live'),
  );
  const pre = el('pre');
  pre.append(
    el('span', 'pair-prompt', '$ '),
    'curl -fsSL https://raw.githubusercontent.com/mrjoedang/doggypile/main/install.sh | sh',
  );
  const scroll = el('div', 'pair-cmd-scroll');
  scroll.append(pre);
  const chip = el('div', 'pair-cmd');
  chip.append(scroll);
  const copyBtn = el('button', 'pair-copy');
  copyBtn.type = 'button';
  copyBtn.setAttribute('aria-label', 'Copy install command');
  copyBtn.title = 'Copy install command';
  const copyIcon = icon('copy');
  copyBtn.append(copyIcon);
  let copiedTimer = null;
  copyBtn.onclick = () => copyText(INSTALL_CMD).then(() => {
    copyBtn.classList.add('copied');
    copyIcon.innerHTML = ICONS.check;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyIcon.innerHTML = ICONS.copy;
    }, 2000);
  });
  const cmdRow = el('div', 'pair-cmd-row');
  cmdRow.append(chip, copyBtn);
  const note = el('p', 'pair-note');
  note.append('Already installed? Run ', el('code', null, 'doggypile'), ' again for a fresh QR.');
  body1.append(cmdRow, note);
  step1.append(el('div', 'pair-badge', '1'), body1);

  const step2 = el('li', 'pair-step');
  const body2 = el('div', 'pair-step-body');
  const hint = el('div', 'pair-hint');
  const qr = el('span', 'pair-qr');
  qr.innerHTML = QR_GLYPH;
  hint.append(qr, el('p', null, 'Scan the QR code and start chatting right away'));
  body2.append(el('h2', 'pair-step-title', 'Pair with your phone'), hint);
  step2.append(el('div', 'pair-badge', '2'), body2);

  const steps = el('ol', 'pair-steps');
  steps.append(step1, step2);
  const card = el('section', 'pair-card');
  card.append(steps);

  const gh = el('a', 'pair-github');
  gh.href = 'https://github.com/mrjoedang/doggypile';
  gh.target = '_blank';
  gh.rel = 'noopener noreferrer';
  gh.setAttribute('aria-label', 'doggypile on GitHub');
  gh.title = 'doggypile on GitHub';
  gh.innerHTML = ICONS.github;
  const foot = el('footer', 'pair-foot');
  foot.append(gh);

  const view = el('div', 'pair-onboard view');
  view.append(head, card, foot);
  $('#homelist').replaceChildren(view);
  document.body.classList.add('ready'); // first paint: fade the built UI in
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

// --- screens ---
function showScreen(name) {
  state.screen = name;
  $('#home').hidden = name !== 'home';
  $('#sessionview').hidden = name !== 'session';
  renderStrip();
  if (name === 'session') renderSessionChrome();
}

function showHome() {
  stashDraft();
  state.screen = 'home';
  state.threadId = null;
  state.threadTitle = '';
  state.threadDeviceId = null;
  state.projection = null;
  state.turnActive = false;
  showScreen('home');
  $('#search').value = state.query;
  renderChips();
  renderSessions();
}

// --- workspace strip ---
let hiddenTabs = [];
let sessionRail = null;

function renderSessionRail() {
  if (!sessionRail) {
    sessionRail = createSessionRail({
      mount: $('#sessionview'),
      getStatus: tabStatus,
      getMachine: (tab) => deviceLabel(state.devices.find((device) => device.id === tab.deviceId)),
      getActivity: tabActivity,
      getExcerpt: railExcerpt,
      onPreviewStart: beginRailPreview,
      onPreview: previewRailTab,
      onCommit: (tab) => {
        if (tab.key === state.active) {
          endRailPreview(true);
          markTabViewed(tab);
          persistTabs();
          renderStrip();
          return;
        }
        endRailPreview(false);
        selectTab(tab.key);
      },
      onCancel: () => endRailPreview(true),
      onTap: (tab) => {
        if (tab.key === state.active) return;
        endRailPreview(false);
        navigate(() => selectTab(tab.key));
      },
      onHome: () => {
        endRailPreview(false);
        navigate(() => {
          showHome();
          if (history.state?.threadId || history.state?.ephemeral) history.replaceState(null, '');
        });
      },
      onTick: haptic,
    });
  }
  sessionRail.update({
    visible: state.mode === 'normal' && state.screen === 'session' && layout() === 'mobile' && state.mobilePane === 'session',
    tabs: state.tabs,
    activeKey: state.active,
  });
}

function renderStrip() {
  const home = $('#home-btn');
  if (state.screen === 'home') home.setAttribute('aria-current', 'page');
  else home.removeAttribute('aria-current');
  $('#tab-new').hidden = state.mode !== 'normal';
  const ctxT = $('#ctx-toggle');
  const showToggle = state.screen === 'session' && layout() !== 'mobile' && !activeTab()?.ephemeral;
  ctxT.hidden = !showToggle;
  ctxT.setAttribute('aria-pressed', String(state.ctxOpen));

  const tabsEl = $('#wtabs');
  const newBtn = $('#tab-new');
  tabsEl.replaceChildren(newBtn);
  hiddenTabs = [];
  renderSessionRail();
  // On phones the edge rail is the open-session switcher. Keep only the
  // existing New Session button in the top strip; wider layouts are unchanged.
  if (layout() === 'mobile') return;
  if (!state.tabs.length || state.mode !== 'normal') return;
  // Tabs have a fixed flex basis; measure how many fit and spill the rest
  // into an overflow menu, always keeping the active tab visible. Reserve
  // room for the adjacent New Session control inside this same tab row.
  const avail = Math.max(0, tabsEl.clientWidth - newBtn.offsetWidth - 4);
  const tabW = (layout() === 'mobile' ? 128 : 180) + 4;
  let fit = Math.max(1, Math.floor((avail + 4) / tabW));
  let visible = state.tabs;
  if (fit < state.tabs.length) {
    fit = Math.max(1, Math.floor((avail - 48 + 4) / tabW)); // reserve room for the "+N" button
    visible = state.tabs.slice(0, fit);
    if (state.screen === 'session') {
      const active = state.tabs.find((t) => t.key === state.active);
      if (active && !visible.includes(active)) visible[visible.length - 1] = active;
    }
    hiddenTabs = state.tabs.filter((t) => !visible.includes(t));
  }
  for (const tab of visible) tabsEl.insertBefore(tabEl(tab), newBtn);
  if (hiddenTabs.length) {
    const more = el('button', 'wtab-more');
    more.id = 'tabmore';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', `${hiddenTabs.length} more open session${hiddenTabs.length > 1 ? 's' : ''}`);
    more.append(icon('dots', 'icon tabicon'), document.createTextNode(`+${hiddenTabs.length}`));
    more.onclick = () => openTabOverflow(more);
    tabsEl.insertBefore(more, newBtn);
  }
}

function tabDot(tab) {
  const status = tabStatus(tab);
  const dot = el('span', `sdot tab-${status}`);
  dot.dataset.s = connFor(tab.deviceId)?.status || 'connecting';
  dot.dataset.tabStatus = status;
  return dot;
}

function tabEl(tab) {
  const active = state.screen === 'session' && state.active === tab.key;
  const wrap = el('div', 'wtab');
  wrap.setAttribute('role', 'presentation');
  wrap.dataset.active = String(active);
  if (tab.ephemeral) wrap.dataset.eph = 'true';
  const main = el('button', 'wtab-main');
  main.setAttribute('role', 'tab');
  main.setAttribute('aria-selected', String(active));
  main.tabIndex = active || (state.screen === 'home' && state.tabs[0] === tab) ? 0 : -1;
  if (tab.ephemeral) main.append(icon('compose', 'icon tabicon'));
  else main.append(tabDot(tab));
  main.append(el('span', 'wtab-title', tab.title || 'Session'));
  main.onclick = () => {
    if (state.screen === 'session' && state.active === tab.key) return;
    navigate(() => selectTab(tab.key));
  };
  const close = el('button', 'wtab-close');
  close.setAttribute('aria-label', `Close ${tab.title || 'session'}`);
  close.tabIndex = -1;
  close.innerHTML = ICONS.close;
  close.onclick = (e) => { e.stopPropagation(); closeTab(tab.key); };
  wrap.append(main, close);
  return wrap;
}

function openTabOverflow(anchor) {
  anchor.setAttribute('aria-expanded', 'true');
  openSurface('menu', (box) => {
    for (const tab of hiddenTabs) {
      const item = el('button', 'menu-item');
      item.setAttribute('role', 'menuitem');
      if (tab.ephemeral) item.append(icon('compose', 'icon tabicon'));
      item.append(el('span', 'mi-title', tab.title || 'Session'));
      const dev = state.devices.find((d) => d.id === tab.deviceId);
      if (dev) item.append(el('span', 'mi-side', deviceLabel(dev)));
      item.onclick = () => { closeSurface(false); navigate(() => selectTab(tab.key)); };
      box.append(item);
    }
  }, { anchor, label: 'More open sessions' });
}

// --- tab lifecycle ---
function stashDraft() {
  const tab = activeTab();
  const box = $('#input');
  if (tab && box && state.screen === 'session') tab.draft = box.value;
}

function openTabForThread(deviceId, threadId, title, opts = {}) {
  const key = tabKeyFor(deviceId, threadId);
  let tab = state.tabs.find((t) => t.key === key);
  if (!tab) {
    tab = {
      key, deviceId, threadId, title: title || 'Session', ephemeral: false,
      lastTurnActive: false, unread: 0, turnStartedAt: null, lastActivityAt: Date.now(), lastActivityTail: '', draft: '',
    };
    const conn = connFor(deviceId);
    const snapshot = conn?.threads?.find((thread) => thread.id === threadId);
    if (snapshot) {
      applyThreadStatus(tab, snapshot.status || (snapshot.mockStatus ? { type: snapshot.mockStatus } : null), { detail: snapshot.mockActivity });
      tab.lastActivityAt = tsVal(snapshot) || tab.lastActivityAt;
      tab.lastActivityTail = snapshot.mockActivity || snapshot.preview || tab.lastActivityTail;
      if (snapshot.mockUnread != null) tab.unread = Number(snapshot.mockUnread) || 0;
    }
    state.tabs.push(tab);
  } else if (title) {
    tab.title = title;
  }
  selectTab(key, opts);
}

function selectTab(key, opts = {}) {
  const tab = state.tabs.find((t) => t.key === key);
  if (!tab) return;
  stashDraft();
  markTabViewed(tab);
  const wasSession = state.screen === 'session';
  state.active = key;
  state.mobilePane = 'session';
  closeSurface(false);
  if (opts.history !== 'none') {
    // Home -> session pushes one entry (platform back returns Home);
    // switching between tabs replaces it so history never stacks up.
    const entry = tab.ephemeral
      ? { ephemeral: true, tabKey: key }
      : { deviceId: tab.deviceId, threadId: tab.threadId, title: tab.title || '' };
    if (wasSession || opts.history === 'replace') history.replaceState(entry, '');
    else history.pushState(entry, '');
  }
  if (tab.ephemeral) {
    state.threadId = null;
    state.threadDeviceId = tab.deviceId || null;
    state.threadTitle = tab.title;
    state.projection = null;
    state.turnActive = false;
    chat.nodes.clear();
    chat.log = null;
    showScreen('session');
    renderEphemeral(tab);
  } else {
    openThread(tab.deviceId, tab.threadId, tab.title);
  }
  const box = $('#input');
  box.value = tab.draft || '';
  autoResize();
  persistTabs();
  renderStrip();
}

function closeTab(key) {
  const i = state.tabs.findIndex((t) => t.key === key);
  if (i < 0) return;
  const wasActive = state.active === key;
  state.tabs.splice(i, 1);
  if (wasActive) {
    state.active = null;
    if (state.screen === 'session') {
      if (state.tabs.length) {
        selectTab(state.tabs[Math.min(i, state.tabs.length - 1)].key, { history: 'replace' });
        persistTabs();
        $('#wtabs [role="tab"][aria-selected="true"]')?.focus();
        return;
      }
      // Last tab closed: land on Home without leaving a dead entry behind.
      history.replaceState(null, '');
      showHome();
      persistTabs();
      $('#home-btn')?.focus();
      return;
    }
    state.active = state.tabs[Math.min(i, state.tabs.length - 1)]?.key || null;
  }
  persistTabs();
  renderStrip();
}

function newSessionTab() {
  if (state.mode !== 'normal') return;
  if (!state.devices.length) { showUnpaired(); return; }
  const existing = state.tabs.find((t) => t.ephemeral);
  if (existing) {
    navigate(() => selectTab(existing.key));
    setTimeout(() => $('#input')?.focus(), 60);
    return;
  }
  const connected = state.devices.filter((d) => connFor(d.id)?.status === 'connected');
  const preselect = state.devices.length === 1 ? state.devices[0].id
    : connected.length === 1 ? connected[0].id : null;
  const tab = {
    key: `new-${++state.newN}`,
    deviceId: preselect,
    threadId: null,
    title: 'New session',
    ephemeral: true,
    lastTurnActive: false,
    unread: 0,
    turnStartedAt: null,
    lastActivityAt: Date.now(),
    lastActivityTail: '',
    draft: '',
  };
  state.tabs.push(tab);
  navigate(() => selectTab(tab.key));
  setTimeout(() => $('#input')?.focus(), 60);
}

// The unstarted-session canvas: a quiet brand mark above the centered
// composer card. Machine choice lives in the composer's control row.
function renderEphemeral(tab) {
  if (state.screen !== 'session' || activeTab() !== tab) return;
  const hero = el('div', 'newsess view');
  hero.append(icon('paw', 'icon newsess-paw'));
  hero.append(el('div', 'newsess-word', 'doggypile'));
  $('#main').replaceChildren(hero);
  renderMachineSelect(tab);
  updateComposer();
}

// Compact destination selector in the new-session composer. Always shown so
// the machine the first message will land on stays explicit, even with a
// single paired machine.
function renderMachineSelect(tab) {
  const btn = $('#machine-btn');
  const dev = state.devices.find((d) => d.id === tab.deviceId);
  const conn = dev ? connFor(dev.id) : null;
  const status = dev ? (conn?.status || 'connecting') : 'none';
  const label = dev ? deviceLabel(dev) : 'Choose machine';
  const dot = el('span', 'sdot');
  dot.dataset.s = status;
  btn.replaceChildren(dot, el('span', 'machine-name', label), icon('chevronDown', 'icon machine-chev'));
  btn.setAttribute('aria-label', dev
    ? `Machine ${label}: ${status}. Change machine`
    : 'Choose a machine for this session');
  btn.setAttribute('aria-expanded', 'false');
  btn.onclick = () => openMachineSelect(tab, btn);
}

function openMachineSelect(tab, anchor) {
  anchor.setAttribute('aria-expanded', 'true');
  openSurface('menu', (box) => {
    for (const dev of state.devices) {
      const conn = connFor(dev.id);
      const status = conn?.status || 'connecting';
      const ok = status === 'connected';
      const item = el('button', 'menu-item');
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(tab.deviceId === dev.id));
      const dot = el('span', 'sdot');
      dot.dataset.s = status;
      item.append(dot, el('span', 'mi-title', deviceLabel(dev)));
      const side = ok ? (conn?.agent || 'connected')
        : status === 'connecting' ? 'connecting…'
        : status === 'expired' ? 'pairing expired'
        : status === 'noagent' ? 'no agent'
        : 'offline';
      item.append(el('span', 'mi-side', side));
      if (!ok) {
        item.disabled = true; // honest: not a valid destination for send
      } else {
        hapticize(item);
        item.onclick = () => {
          haptic();
          closeSurface(false);
          tab.deviceId = dev.id;
          state.threadDeviceId = dev.id;
          renderSessionChrome();
          renderEphemeral(tab);
          $('#input')?.focus();
        };
      }
      box.append(item);
    }
  }, { anchor, label: 'Choose machine for this session' });
}

// --- session chrome (title, panes, breakpoints) ---
function renderMachinePill() {
  // The active machine is already available from context/actions; keep the
  // session header clean by not showing the machine/agent pill here.
  $('#chat-machine').hidden = true;
}

function renderSessionChrome() {
  const tab = activeTab();
  if (state.screen !== 'session' || !tab) return;
  const L = layout();
  // Unstarted sessions get the full workspace: no context surface, no
  // segmented control — just the centered new-session canvas.
  const eph = !!tab.ephemeral;
  const pane = $('#chatpane');
  if (eph) pane.dataset.eph = 'true';
  else delete pane.dataset.eph;
  $('#chat-title').textContent = eph ? 'New session' : (state.threadTitle || tab.title || 'Session');
  renderMachinePill();

  const segbar = $('#segbar');
  // Mobile is now a single full-bleed chat surface; the rail/Home replace both
  // top chrome rows, so there is no segmented Context surface on phones.
  segbar.hidden = true;
  state.mobilePane = 'session';
  for (const b of segbar.querySelectorAll('[data-seg]')) {
    const sel = b.dataset.seg === state.mobilePane;
    b.setAttribute('aria-selected', String(sel));
    b.tabIndex = sel ? 0 : -1;
  }

  const showCtx = !eph && (L === 'mobile' ? state.mobilePane === 'context' : state.ctxOpen);
  $('#chatpane').hidden = L === 'mobile' && state.mobilePane !== 'session';
  $('#ctxpane').hidden = !showCtx;
  $('#ctx-close').hidden = L === 'mobile'; // the segmented control owns it there
  $('#drawer-scrim').hidden = !(L === 'tablet' && showCtx);

  const ctxT = $('#ctx-toggle');
  ctxT.hidden = L === 'mobile' || eph;
  ctxT.setAttribute('aria-pressed', String(state.ctxOpen));

  const conn = connFor(tab.deviceId);
  const dev = state.devices.find((d) => d.id === tab.deviceId);
  $('#input').placeholder = eph
    ? 'What are we working on?'
    : tab.deviceId
      ? `Message ${conn?.agent || 'the agent'} on ${deviceLabel(dev) || 'your computer'}`
      : 'Pick a machine, then message the agent…';
  if (eph) renderMachineSelect(tab);

  renderCtxTabs();
  if (showCtx) renderCtxBody(true);
  updateComposer();
  updateJump();
}

function persistCtxOpen() {
  try { localStorage.setItem('doggypile:ctxOpen', state.ctxOpen ? '1' : '0'); } catch { /* fine */ }
}

// --- context pane ---
function renderCtxTabs() {
  for (const b of document.querySelectorAll('[data-ctxtab]')) {
    const sel = b.dataset.ctxtab === state.ctxTab;
    b.setAttribute('aria-selected', String(sel));
    b.tabIndex = sel ? 0 : -1;
  }
}

let ctxTimer = null;
function renderCtxBodySoon() {
  if (ctxTimer) return;
  ctxTimer = setTimeout(() => { ctxTimer = null; renderCtxBody(); }, 250);
}

function renderCtxBody(force = false) {
  if (state.screen !== 'session' || $('#ctxpane').hidden) return;
  const body = $('#ctx-body');
  // Passive refreshes must not yank focus or selection out from under the
  // user; explicit tab switches always repaint.
  if (!force && body.contains(document.activeElement)) return;
  const scroll = body.scrollTop;
  body.replaceChildren(...ctxContent());
  body.setAttribute('aria-labelledby', `ctxtab-${state.ctxTab}`);
  body.scrollTop = scroll;
}

function ctxContent() {
  const tab = activeTab();
  if (!tab) return [quietEl('No session selected.')];
  if (state.ctxTab === 'details') return detailsContent(tab);
  if (state.ctxTab === 'activity') return activityContent(tab);
  return changesContent(tab);
}

const secEl = (t) => el('span', 'section-title', t);
const quietEl = (t) => el('div', 'panel-quiet', t);
function kvEl(k, v) {
  const kv = el('div', 'kv');
  kv.append(el('span', 'k', k));
  const val = el('span', 'v');
  if (v instanceof Node) val.append(v);
  else val.textContent = v;
  kv.append(val);
  return kv;
}

function detailsContent(tab) {
  const out = [];
  const dev = state.devices.find((d) => d.id === tab.deviceId);
  if (!dev) {
    out.push(quietEl('Pick a machine in the chat to start this session.'));
    return out;
  }
  const conn = connFor(dev.id);
  const meta = conn?.threads?.find((t) => t.id === tab.threadId);
  out.push(secEl('Session'));
  const mval = el('span');
  const dot = el('span', 'sdot');
  dot.dataset.s = conn?.status || 'connecting';
  mval.append(dot, document.createTextNode(deviceLabel(dev)));
  out.push(kvEl('machine', mval));
  out.push(kvEl('agent', conn?.agent || '—'));
  out.push(kvEl('directory', meta?.cwd || '—'));
  out.push(kvEl('updated', rel(meta?.updatedAt || meta?.recencyAt) || '—'));
  out.push(secEl('Connection'));
  out.push(kvEl('status', state.turnActive ? 'turn active' : (conn?.status || 'connecting')));
  const path = conn?.metrics?.path?.selected;
  const rtt = conn?.metrics?.path?.rtt_ms;
  out.push(kvEl('path', path && path !== 'unknown' ? `${path}${rtt != null ? ` · ${rtt}ms` : ''}` : '—'));
  out.push(kvEl('relay', dev.relay || '—'));
  out.push(kvEl('node id', dev.id));
  out.push(kvEl('last connected', dev.lastConnectedAt ? rel(dev.lastConnectedAt) : '—'));
  const err = (conn?.status !== 'connected' && conn?.lastDetail) || dev.lastError;
  if (err) out.push(kvEl('last error', err));
  const actions = el('button', 'btn btn-small', 'Machine actions…');
  actions.setAttribute('aria-haspopup', 'dialog');
  actions.onclick = () => openMachineActions(dev, actions);
  out.push(actions);
  return out;
}

function prowEl(m) {
  const row = el('div', 'prow');
  const dot = el('span', 'dot');
  dot.dataset.status = m.status || 'running';
  const main = el('span', 'prow-main');
  main.append(el('span', 'mono', `$ ${m.command || ''}`));
  row.append(dot, main);
  return row;
}

// Activity is derived from the same projection the chat renders — commands,
// file events, and the latest reply. No extra daemon API, so a thread that
// hasn't loaded shows an honest empty state.
function activityContent(tab) {
  const out = [];
  if (tab.ephemeral) {
    out.push(quietEl('Start the session to see its activity here.'));
    return out;
  }
  const msgs = state.projection ? state.projection.toRenderList() : null;
  if (state.turnActive) {
    const w = el('div', 'working');
    w.append(el('span', 'working-label', 'Working'));
    out.push(w);
    const running = msgs?.slice().reverse().find((m) => m.kind === 'command' && (m.status || 'running') === 'running');
    if (running) out.push(prowEl(running));
  } else {
    out.push(quietEl('Nothing running right now.'));
  }
  out.push(secEl('Commands'));
  const cmds = (msgs || []).filter((m) => m.kind === 'command');
  if (!msgs || !msgs.length) out.push(quietEl('Nothing in this conversation yet.'));
  else if (!cmds.length) out.push(quietEl('No commands run in this session.'));
  else {
    const recent = cmds.slice(-10);
    if (cmds.length > recent.length) out.push(quietEl(`Showing the last ${recent.length} of ${cmds.length} commands.`));
    for (const m of recent) out.push(prowEl(m));
  }
  out.push(secEl('Latest'));
  const lastReply = (msgs || []).slice().reverse().find((m) => m.role === 'assistant' && m.kind === 'text' && m.text);
  out.push(lastReply
    ? quietEl(truncate(lastReply.text.trim().replace(/\s+/g, ' '), 220))
    : quietEl('No assistant reply yet.'));
  return out;
}

// Changes only surfaces what the projection really carries: agent-reported
// file-change events (and their paths, when the agent includes them). There
// is no Git API in the daemon, so no diffs and no invented status.
function changesContent(tab) {
  const out = [];
  if (tab.ephemeral) {
    out.push(quietEl('Start the session to see file changes here.'));
    return out;
  }
  out.push(el('div', 'note', 'File paths reported by the agent in this session. doggypile doesn’t expose Git status or diffs yet, so there’s no live diff here.'));
  const msgs = state.projection ? state.projection.toRenderList() : null;
  if (!msgs) {
    out.push(quietEl('Conversation not loaded yet.'));
    return out;
  }
  const events = msgs.filter((m) => m.kind === 'fileChange');
  if (!events.length) {
    out.push(quietEl('No file changes reported in this session.'));
    return out;
  }
  const files = [];
  for (const evt of events) {
    for (const p of evt.files || []) if (!files.includes(p)) files.push(p);
  }
  if (!files.length) {
    out.push(el('div', 'changes-sum', `${events.length} file-change event${events.length > 1 ? 's' : ''} · paths not reported`));
    return out;
  }
  out.push(el('div', 'changes-sum', `${files.length} file${files.length > 1 ? 's' : ''} touched`));
  for (const p of files) {
    const row = el('div', 'frow');
    row.append(icon('file', 'icon chip-icon'), el('span', 'fname', p));
    out.push(row);
  }
  return out;
}

// Path/RTT in Details drift while the pane sits open; refresh gently.
setInterval(() => {
  if (state.screen === 'session' && !$('#ctxpane').hidden && state.ctxTab === 'details' && !document.hidden) {
    renderCtxBodySoon();
  }
}, 3000);

// --- machine chips ---
function renderChips() {
  const bar = $('#chips');
  if (!bar) return;
  if (!state.devices.length || state.mode !== 'normal') { bar.hidden = true; return; }
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
    attachLongPress(chip, () => openMachineActions(dev, chip));
    bar.append(chip);
  }

  const add = el('button', 'chip-btn chip-add');
  add.setAttribute('aria-label', 'Pair another machine');
  add.append(icon('plus'));
  add.onclick = pairDialog;
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
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  const start = (e) => {
    fired = false;
    dragged = false;
    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;
    timer = setTimeout(() => { fired = true; haptic(); fn(); }, 480);
  };
  const cancel = () => clearTimeout(timer);
  const move = (e) => {
    if (e.pointerId !== pointerId || dragged) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
    dragged = true;
    cancel();
  };
  node.addEventListener('pointerdown', start);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('pointercancel', () => { dragged = true; cancel(); });
  node.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired && !dragged) fn(); });
  node.addEventListener('click', (e) => {
    if (fired || dragged) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
    fired = false;
    dragged = false;
    pointerId = null;
  }, true);
}

// --- overlays: anchored popover (desktop/tablet), sheet (mobile), dialog ---
// kind: 'menu' (anchored list) | 'dialog' (form) | 'alert' (confirm). On
// mobile every kind becomes a bottom sheet; on desktop/tablet menus anchor
// to their trigger and forms/confirms center as dialogs.
let surface = null; // { restore, modal }

function closeSurface(restore = true) {
  if (!surface) return;
  const prev = surface.restore;
  surface = null;
  $('#overlay-root').replaceChildren();
  $('#tabmore')?.setAttribute('aria-expanded', 'false');
  $('#machine-btn')?.setAttribute('aria-expanded', 'false');
  if (restore && prev && document.contains(prev)) prev.focus();
}

function openSurface(kind, build, { anchor = null, label = '' } = {}) {
  // Chained surfaces (popover -> dialog) inherit the original trigger, so
  // dismissing the second one still lands focus back where the user started.
  const restore = surface?.restore && document.contains(surface.restore) ? surface.restore : document.activeElement;
  closeSurface(false);
  const root = $('#overlay-root');
  const mobile = layout() === 'mobile';
  let box;
  if (mobile) {
    const scrim = el('div', 'scrim');
    scrim.onclick = () => closeSurface(true);
    box = el('div', 'sheet');
    box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    box.append(el('div', 'sheet-grab'));
    root.append(scrim, box);
    surface = { restore, modal: true };
  } else if (kind === 'menu' && anchor) {
    const dismiss = el('div', 'popover-dismiss');
    dismiss.onclick = () => closeSurface(true);
    box = el('div', 'anchored-popover');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', label);
    root.append(dismiss, box);
    surface = { restore, modal: false };
  } else {
    const scrim = el('div', 'scrim');
    scrim.onclick = () => closeSurface(true);
    box = el('div', 'modal-dialog' + (kind === 'alert' ? ' modal-action' : ''));
    box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    root.append(scrim, box);
    surface = { restore, modal: true };
  }
  build(box);
  if (!mobile && kind === 'menu' && anchor) {
    const r = anchor.getBoundingClientRect();
    const x = Math.max(12, Math.min(r.left, innerWidth - box.offsetWidth - 12));
    let y = r.bottom + 6;
    if (y + box.offsetHeight > innerHeight - 12) y = Math.max(12, r.top - box.offsetHeight - 6);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  }
  const first = box.querySelector('[autofocus]') || box.querySelector('input, textarea') || box.querySelector('button');
  first?.focus();
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

function openMachineActions(dev, anchor) {
  const conn = connFor(dev.id);
  openSurface('menu', (box) => {
    const head = el('div', 'popover-head');
    head.append(sheetTitleRow(dev, conn), el('div', 'sheet-sub', connSubtitle(conn)));
    box.append(head);
    const add = (ic, label, fn, { danger = false, disabled = false, sub = null } = {}) => {
      const row = el('button', 'action-row' + (danger ? ' danger' : ''));
      row.append(icon(ic));
      const main = el('div', 'action-main');
      main.append(document.createTextNode(label));
      if (sub) main.append(el('span', 'action-sub', sub));
      row.append(main);
      if (disabled) row.setAttribute('disabled', '');
      else row.onclick = fn;
      box.append(row);
    };
    add('info', 'Connection details', () => machineDetails(dev));
    add('pencil', 'Rename machine…', () => renameDialog(dev));
    add('copy', 'Copy node ID', () => { closeSurface(true); copyNodeId(dev); }, { sub: `${dev.id.slice(0, 16)}…` });
    add('refresh', 'Reconnect', () => { closeSurface(true); chipTapReconnect(dev); }, { disabled: conn?.status === 'connected' });
    if (conn?.status === 'noagent') add('refresh', 'Install opencode…', () => { closeSurface(true); installOnConn(conn); });
    add('trash', 'Forget machine…', () => forgetDialog(dev), { danger: true });
  }, { anchor, label: `Machine ${deviceLabel(dev)}` });
}

function chipTapReconnect(dev) {
  const conn = connFor(dev.id) || connectDevice(dev);
  clearTimeout(conn.retryTimer);
  conn.retryTimer = null;
  conn.backoffMs = BACKOFF_BASE_MS;
  dialConn(conn);
  toast(`Reconnecting to ${deviceLabel(dev)}…`);
}

function copyNodeId(dev) {
  const write = navigator.clipboard?.writeText(dev.id);
  if (!write) { toast(`Node ID: ${dev.id}`); return; }
  write.then(() => toast('Node ID copied.'), () => toast(`Node ID: ${dev.id}`));
}

// Machine/thread details use the context pane where that surface exists;
// mobile's full-bleed single-pane layout falls back to the dialog below.
function machineDetails(dev) {
  const tab = activeTab();
  if (layout() !== 'mobile' && state.screen === 'session' && tab && !tab.ephemeral && tab.deviceId === dev.id) {
    closeSurface(false);
    state.ctxOpen = true;
    persistCtxOpen();
    state.ctxTab = 'details';
    renderSessionChrome();
    renderStrip();
    $('#ctxtab-details')?.focus();
    return;
  }
  const conn = connFor(dev.id);
  openSurface('dialog', (box) => {
    box.append(sheetTitleRow(dev, conn), el('div', 'sheet-sub', connSubtitle(conn)));
    const rows = [
      ['status', conn?.status || 'connecting'],
      ['agent', conn?.agent || '—'],
      ['node id', dev.id],
      ['relay', dev.relay || '—'],
      ['sessions', conn?.threads ? String(conn.threads.length) : '—'],
      ['last connected', dev.lastConnectedAt ? rel(dev.lastConnectedAt) : '—'],
      ['last error', dev.lastError || '—'],
    ];
    for (const [k, v] of rows) box.append(kvEl(k, v));
    const btns = el('div', 'sheet-btns');
    const done = el('button', 'btn', 'Close');
    done.onclick = () => closeSurface(true);
    btns.append(done);
    box.append(btns);
  }, { label: `Details for ${deviceLabel(dev)}` });
}

function renameDialog(dev) {
  openSurface('dialog', (box) => {
    box.append(el('div', 'sheet-title', `Rename ${deviceLabel(dev)}`));
    box.append(el('div', 'sheet-sub', 'Local nickname only — the computer keeps its hostname.'));
    const input = el('input', 'field');
    input.value = dev.name || '';
    input.placeholder = dev.id.slice(0, 8);
    input.maxLength = 24;
    input.setAttribute('aria-label', 'Machine name');
    const btns = el('div', 'sheet-btns');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => closeSurface(true);
    const save = el('button', 'btn btn-accent', 'Save');
    save.onclick = () => {
      const v = input.value.trim();
      updateDevice(dev.id, { name: v || null });
      closeSurface(true);
      renderChips();
      renderSessions();
      renderStrip();
      if (state.screen === 'session') renderSessionChrome();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') save.onclick(); };
    btns.append(cancel, save);
    box.append(input, btns);
    setTimeout(() => input.select(), 60);
  }, { label: `Rename ${deviceLabel(dev)}` });
}

function forgetDialog(dev) {
  openSurface('alert', (box) => {
    box.append(el('div', 'sheet-title', `Forget ${deviceLabel(dev)}?`));
    box.append(el('div', 'sheet-sub', 'Removes the pairing and its sessions from this phone. Nothing is deleted on the computer — re-pair any time with a new QR.'));
    const btns = el('div', 'sheet-btns');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.setAttribute('autofocus', '');
    cancel.onclick = () => closeSurface(true);
    const doit = el('button', 'btn btn-danger', 'Forget machine');
    hapticize(doit);
    doit.onclick = () => {
      haptic();
      closeSurface(false);
      forgetMachine(dev);
    };
    btns.append(cancel, doit);
    box.append(btns);
  }, { label: `Forget ${deviceLabel(dev)}` });
}

function forgetMachine(dev) {
  dropConn(dev.id);
  purgeThreadCache(dev.id);
  state.devices = state.devices.filter((d) => d.id !== dev.id);
  persistDevices(state.devices);
  if (state.filter === dev.id) state.filter = 'all';
  // Its open tabs go with it.
  const activeGone = activeTab()?.deviceId === dev.id;
  state.tabs = state.tabs.filter((t) => t.deviceId !== dev.id);
  persistTabs();
  if (!state.devices.length) {
    history.replaceState(null, '');
    showUnpaired();
    return;
  }
  if (activeGone && state.screen === 'session') {
    history.replaceState(null, '');
    showHome();
  } else {
    renderChips();
    renderSessions();
    renderStrip();
  }
  toast(`Forgot ${deviceLabel(dev)}. Scan its QR again to re-pair.`);
}

function pairDialog() {
  openSurface('dialog', (box) => {
    box.append(el('div', 'sheet-title', 'Pair another machine'));
    const sub = el('div', 'sheet-sub');
    sub.append('Run ', el('code', null, 'doggypile pair'), ' on the other computer, then scan its QR code with this phone. It joins the list — nothing here is replaced.');
    box.append(sub);
    const input = el('input', 'field');
    input.placeholder = 'or paste a pair link…';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Pair link');
    const btns = el('div', 'sheet-btns');
    const cancel = el('button', 'btn', 'Close');
    cancel.onclick = () => closeSurface(true);
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
      closeSurface(true);
      connectDevice(dev, { resetBackoff: true });
      renderChips();
      renderSessions();
      toast(`Pairing ${deviceLabel(dev)}…`);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') add.onclick(); };
    btns.append(cancel, add);
    box.append(input, btns);
  }, { label: 'Pair another machine' });
}

// --- home sessions list ---
function skeletonList(n = 5) {
  const wrap = el('div', 'view');
  for (let i = 0; i < n; i++) {
    const row = el('div', 'skeleton-row');
    row.append(el('div', 'skeleton-bar long'), el('div', 'skeleton-bar short'));
    wrap.append(row);
  }
  return wrap;
}

const tsVal = (t) => {
  const raw = t.updatedAt || t.recencyAt;
  if (!raw) return 0;
  const n = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(n) ? (n < 10_000_000_000 ? n * 1000 : n) : 0;
};

// Data-level (re)paint of the merged list. Called whenever any machine's
// connection state or thread list changes while Home is on screen.
function renderSessions() {
  if (state.screen !== 'home' || state.mode !== 'normal') return;
  $('#home-bar').hidden = false;
  const listEl = $('#homelist');
  const conns = [...state.conns.values()].filter((c) => state.filter === 'all' || c.dev.id === state.filter);
  const q = state.query.trim().toLowerCase();
  const matches = (t, conn) => !q
    || (t.name || t.preview || '').toLowerCase().includes(q)
    || (t.cwd || '').toLowerCase().includes(q)
    || deviceLabel(conn.dev).toLowerCase().includes(q);
  const merged = [];
  const mergedKeys = new Set();
  for (const conn of conns) {
    for (const t of conn.threads || []) {
      if (!matches(t, conn)) continue;
      merged.push({ t, conn });
      mergedKeys.add(tabKeyFor(conn.dev.id, t.id));
    }
  }
  // Restored tabs remain useful when their machine is offline and thread/list
  // cannot hydrate Home. Surface their cached metadata so the rail's grid
  // destination is still a complete way to access and manage open sessions.
  for (const tab of state.tabs) {
    if (tab.ephemeral || mergedKeys.has(tab.key)) continue;
    const conn = connFor(tab.deviceId);
    if (!conn || !conns.includes(conn)) continue;
    const t = {
      id: tab.threadId,
      name: tab.title,
      preview: tab.lastActivityTail,
      updatedAt: tab.lastActivityAt,
      cachedTab: true,
    };
    if (matches(t, conn)) merged.push({ t, conn });
  }
  const sessionPriority = ({ t, conn }) => {
    const tab = state.tabs.find((candidate) => candidate.deviceId === conn.dev.id && candidate.threadId === t.id);
    const status = tab ? tabStatus(tab) : threadSnapshotStatus(t, conn);
    return { 'needs-you': 0, working: 1, error: 2, connecting: 3, idle: 4 }[status];
  };
  merged.sort((a, b) => sessionPriority(a) - sessionPriority(b) || tsVal(b.t) - tsVal(a.t));

  if (!merged.length) {
    const waiting = conns.some((c) => c.status === 'connecting' || (c.status === 'connected' && c.threads === null));
    if (waiting) {
      listEl.replaceChildren(skeletonList());
      return;
    }
    if (q) {
      listEl.replaceChildren(el('div', 'home-empty', `No sessions match “${state.query.trim()}”.`));
      return;
    }
    const allDead = conns.length && conns.every((c) => c.status === 'offline' || c.status === 'expired' || c.status === 'noagent');
    if (allDead) {
      const retry = el('button', 'btn', 'Retry now');
      retry.onclick = retryAllStale;
      const which = state.filter === 'all' && state.devices.length > 1 ? 'any of your machines' : 'this machine';
      listEl.replaceChildren(stateBox({
        icon: 'warn',
        title: `Can’t reach ${which}`,
        body: conns.map((c) => `${deviceLabel(c.dev)}: ${c.lastDetail || c.status}`).join('\n'),
        action: retry,
      }));
      return;
    }
    const start = el('button', 'btn btn-accent', 'Start a session');
    start.onclick = newSessionTab;
    listEl.replaceChildren(stateBox({
      icon: 'chat',
      title: 'No sessions yet',
      body: 'Start a session to chat with the agent on your computer.',
      action: start,
    }));
    return;
  }

  const list = el('div', 'view');
  const dayAgo = Date.now() - 86_400_000;
  let lastGroup = null;
  for (const { t, conn } of merged) {
    const open = state.tabs.find((candidate) => candidate.deviceId === conn.dev.id && candidate.threadId === t.id);
    const status = open ? tabStatus(open) : threadSnapshotStatus(t, conn);
    const group = status === 'needs-you' ? 'Needs you'
      : status === 'working' ? 'Working'
      : status === 'error' ? 'Attention'
      : status === 'connecting' ? 'Connecting'
      : tsVal(t) >= dayAgo ? 'Today' : 'Earlier';
    if (group !== lastGroup) {
      list.append(el('span', 'section-title', group));
      lastGroup = group;
    }
    list.append(sessionRow(t, conn));
  }
  listEl.replaceChildren(list);
}

function sessionRow(t, conn) {
  const title = t.name || t.preview || 'Untitled session';
  const row = el('div', 'session');
  const openButton = el('button', 'session-open');
  const tab = state.tabs.find((x) => x.deviceId === conn.dev.id && x.threadId === t.id);
  const status = tab ? tabStatus(tab) : threadSnapshotStatus(t, conn);
  row.dataset.tabStatus = status;
  if (status === 'working') row.dataset.live = 'true';
  const d = el('span', `session-dot status-${status}`);
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', status === 'needs-you' ? 'Needs your reply' : status);
  openButton.append(d);
  const main = el('div', 'session-main');
  main.append(el('div', 'session-title', title));
  const subBits = [];
  if (tab && status !== 'idle') subBits.push(tabActivity(tab));
  else if (!tab && status !== 'idle') {
    const snapshotActivity = status === 'error' ? (t.status?.message || conn.lastDetail || 'Machine unavailable')
      : status === 'needs-you' ? (t.preview || 'Waiting for your reply')
      : status === 'connecting' ? 'Connecting…'
      : (t.preview || 'Working…');
    subBits.push(snapshotActivity);
  }
  if (state.devices.length > 1) subBits.push(deviceLabel(conn.dev));
  const dir = short(t.cwd);
  if (dir) subBits.push(dir);
  main.append(el('div', 'session-sub', subBits.join(' · ') || (t.cachedTab ? 'Cached conversation' : '—')));
  openButton.append(main);
  if (tab?.unread) openButton.append(el('span', 'session-unread', String(tab.unread)));
  const when = rel(t.updatedAt || t.recencyAt);
  if (when) openButton.append(el('span', 'session-side', when));
  openButton.onclick = () => navigate(() => openTabForThread(conn.dev.id, t.id, title));
  row.append(openButton);
  if (tab) {
    const close = el('button', 'session-close');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${title}`);
    close.innerHTML = ICONS.close;
    hapticize(close);
    close.onclick = () => {
      haptic();
      closeTab(tab.key);
      renderSessions();
    };
    row.append(close);
  }
  return row;
}

// --- chat ---
const chat = {
  nodes: new Map(), // item id -> { el, kind, update(m), ... }
  log: null,
  hintEl: null,
  workingEl: null,
  forceStick: false, // one-shot: scroll to bottom regardless of position (e.g. after send)
  renderTurnActive: false,
};


// The scrub preview card shows the tail of each session's conversation from
// the same sources the chat itself paints from: the live projection for the
// active tab, the thread cache for everything else. Seeding a projection on
// every scrub step would be wasteful, so cached excerpts are memoized against
// the cache entry's timestamp. Tabs with no cached thread return no excerpt
// and the card degrades to status/title/activity only.
const railExcerptMemo = new Map(); // key -> { at, items }

function flattenMarkdown(text) {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|\*|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(flat, 200);
}

function excerptFromMessages(msgs) {
  const items = [];
  for (let i = msgs.length - 1; i >= 0 && items.length < 4; i--) {
    const m = msgs[i];
    if (m.kind !== 'text' || !m.text || (m.role !== 'user' && m.role !== 'assistant')) continue;
    items.unshift({ role: m.role, text: flattenMarkdown(m.text) });
  }
  return items;
}

function railExcerpt(tab) {
  if (tab.ephemeral) return [];
  if (tab.key === state.active && state.projection) return excerptFromMessages(state.projection.toRenderList());
  const entry = threadCache.get(tab.key);
  if (!entry?.thread) return [];
  const memo = railExcerptMemo.get(tab.key);
  if (memo?.at === entry.at) return memo.items;
  const projection = createProjection();
  projection.seedFromThread(entry.thread);
  const items = excerptFromMessages(projection.toRenderList());
  railExcerptMemo.set(tab.key, { at: entry.at, items });
  if (railExcerptMemo.size > THREAD_CACHE_MAX) {
    for (const key of [...railExcerptMemo.keys()]) {
      if (!threadCache.has(key)) railExcerptMemo.delete(key);
    }
  }
  return items;
}

const railPreview = { active: false, originKey: null, shownKey: null, originRender: null };

function animateRailPeek(direction = 0) {
  const main = $('#main');
  if (!main || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  main.getAnimations().forEach((animation) => animation.cancel());
  main.animate([
    { transform: `translateY(${direction * 22}px)`, opacity: 0.25 },
    { transform: 'none', opacity: 1 },
  ], { duration: 180, easing: 'cubic-bezier(.25,.8,.3,1)' });
}

function beginRailPreview() {
  railPreview.active = true;
  railPreview.originKey = state.active;
  railPreview.shownKey = state.active;
  const main = $('#main');
  railPreview.originRender = {
    children: [...main.childNodes],
    scrollTop: main.scrollTop,
    nodes: new Map(chat.nodes),
    log: chat.log,
    hintEl: chat.hintEl,
    workingEl: chat.workingEl,
    renderTurnActive: chat.renderTurnActive,
  };
}

function previewRailTab(tab, direction = 0) {
  if (!railPreview.active || !tab || tab.key === railPreview.shownKey) return;
  railPreview.shownKey = tab.key;
  $('#chat-title').textContent = tab.title || 'Session';
  chat.nodes.clear();
  chat.log = null;
  if (tab.key === railPreview.originKey && state.projection) {
    chat.forceStick = true;
    renderChat({ projection: state.projection, turnActive: state.turnActive, preview: true });
  } else {
    const cached = !tab.ephemeral && threadCache.get(tab.key)?.thread;
    if (cached) {
      const projection = createProjection();
      projection.seedFromThread(cached);
      chat.forceStick = true;
      renderChat({ projection, turnActive: !!tab.lastTurnActive, preview: true });
    } else {
      $('#main').replaceChildren(stateBox({ spinner: true, body: tab.ephemeral ? 'New session' : 'Conversation preview not cached yet' }));
      $('#jump').hidden = true;
    }
  }
  animateRailPeek(direction);
}

function endRailPreview(restoreOrigin) {
  if (!railPreview.active) return;
  const shouldRestore = restoreOrigin && !!railPreview.originRender;
  const originRender = railPreview.originRender;
  railPreview.active = false;
  railPreview.shownKey = null;
  railPreview.originKey = null;
  railPreview.originRender = null;
  if (!shouldRestore) return;
  const tab = activeTab();
  if (!tab) return;
  $('#chat-title').textContent = state.threadTitle || tab.title || 'Session';
  const main = $('#main');
  main.replaceChildren(...originRender.children);
  chat.nodes = originRender.nodes;
  chat.log = originRender.log;
  chat.hintEl = originRender.hintEl;
  chat.workingEl = originRender.workingEl;
  chat.renderTurnActive = originRender.renderTurnActive;
  main.scrollTop = originRender.scrollTop;
  // Every open allocates a projection before hydration. Preserve an offline
  // spinner, but repaint if the read completed into cache while we previewed.
  if (tab.ephemeral) renderEphemeral(tab);
  else if (state.projection && (chat.log?.isConnected || threadCache.has(tab.key) || connFor(tab.deviceId)?.status === 'connected')) renderChat();
  else { updateComposer(); updateJump(); }
  animateRailPeek(0);
}
async function openThread(deviceId, id, title) {
  state.threadDeviceId = deviceId;
  state.threadId = id;
  if (title) state.threadTitle = title;
  const tab = activeTab();
  state.turnActive = tab && tab.key === tabKeyFor(deviceId, id) ? !!tab.lastTurnActive : false;
  state.projection = createProjection();
  chat.nodes.clear();
  chat.log = null;
  const conn = connFor(deviceId);
  const dev = conn?.dev || state.devices.find((d) => d.id === deviceId);
  showScreen('session');
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
  const lifecycleBeforeRead = tab?.lifecycleRevision || 0;
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
    const currentTab = activeTab();
    if (res.thread.status && currentTab?.key === cacheKey && (currentTab.lifecycleRevision || 0) === lifecycleBeforeRead) {
      const type = res.thread.status.type;
      // Some bridges return a static idle snapshot from thread/read even while
      // a resumed turn is live. Only use it when we do not already know better.
      if (!(type === 'idle' && currentTab.lastTurnActive)) {
        applyThreadStatus(currentTab, res.thread.status);
        if (currentTab.lastTurnActive && res.thread.status.type === 'active') touchTabLifecycle(currentTab, conn.attempt);
        state.turnActive = !!currentTab.lastTurnActive;
        persistTabs();
        renderStrip();
      }
    }
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
      const live = !!m.streamed && chat.renderTurnActive;
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

function renderChat({ projection = state.projection, turnActive = state.turnActive, preview = false } = {}) {
  if (railPreview.active && !preview) return;
  if (!projection) return;
  chat.renderTurnActive = turnActive;
  const main = $('#main');
  const hadLog = !!chat.log?.isConnected;
  // Only stick to the bottom if the user hasn't scrolled up to read history.
  const stick = chat.forceStick || !hadLog || main.scrollHeight - main.scrollTop - main.clientHeight < 80;
  chat.forceStick = false;

  const log = ensureLog();
  const msgs = projection.toRenderList();

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
  if (!msgs.length && !turnActive) log.append(chat.hintEl);
  if (turnActive) log.append(chat.workingEl);

  if (!preview) updateComposer();
  if (stick) {
    main.scrollTop = main.scrollHeight;
    requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
  }
  if (preview) $('#jump').hidden = true;
  else updateJump();
  if (!preview && state.screen === 'session' && !$('#ctxpane').hidden) renderCtxBodySoon();
}

let renderPending = false;
function scheduleRenderChat() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    if (!state.threadId) return;
    if (railPreview.active) {
      if (railPreview.shownKey === railPreview.originKey) renderChat({ projection: state.projection, turnActive: state.turnActive, preview: true });
    } else renderChat();
  });
}

// --- scroll-to-bottom button ---
function updateJump() {
  const main = $('#main');
  const showing = !!chat.log?.isConnected && state.screen === 'session';
  const away = main.scrollHeight - main.scrollTop - main.clientHeight > 240;
  $('#jump').hidden = !(showing && away);
}

function onNotify(conn, msg) {
  const tid = msg.params?.threadId;
  const tab = tid ? state.tabs.find((candidate) => candidate.deviceId === conn.dev.id && candidate.threadId === tid) : null;
  let statusChanged = false;

  if (tab) {
    const activityChanged = recordTabActivity(tab, msg);
    if (msg.method === 'turn/started') {
      if (!tab.lastTurnActive) tab.turnStartedAt = Date.now();
      tab.waitingForUser = false;
      tab.lastTurnActive = true;
      tab.turnError = '';
      tab.unreadForTurn = false;
      tab.activeTurnId = msg.params?.turn?.id || msg.params?.turnId || null;
      tab.terminalWithoutId = false;
      tab.lastActivityAt = Date.now();
      statusChanged = true;
    } else if (msg.method === 'thread/status/changed') {
      const status = msg.params?.status;
      const wasActive = tab.lastTurnActive;
      if (status?.type === 'idle' && wasActive) finishTabTurn(tab);
      else applyThreadStatus(tab, status, { markUnread: true, detail: msg.params?.message });
      tab.lastActivityAt = Date.now();
      statusChanged = true;
    }
    if (msg.method === 'item/completed' && msg.params?.item?.type === 'agentMessage' && !tabIsViewed(tab) && !tab.unreadForTurn) {
      tab.unread = Math.min(99, (tab.unread || 0) + 1);
      tab.unreadForTurn = true;
      statusChanged = true;
    }
    if (msg.method === 'turn/completed') {
      const failed = msg.params?.turn?.status === 'failed';
      const detail = msg.params?.turn?.error?.message || 'Turn failed';
      finishTabTurn(tab, { failed, detail: failed ? detail : '', turnId: msg.params?.turn?.id || null });
      statusChanged = true;
    } else if (msg.method === 'turn/failed') {
      const error = msg.params?.error;
      const detail = typeof error === 'string' ? error : error?.message || msg.params?.message || 'Turn failed';
      finishTabTurn(tab, { failed: true, detail, turnId: msg.params?.turnId || null });
      statusChanged = true;
    }
    if (statusChanged) {
      touchTabLifecycle(tab, conn.attempt);
      persistTabs();
      renderStrip();
      if (state.screen === 'home') renderSessions();
    }
    else if (activityChanged) {
      touchTabLifecycle(tab, conn.attempt);
      scheduleTabActivityFlush();
    }
  }

  if (conn.dev.id !== state.threadDeviceId) return; // event from a machine we're not looking at
  if (tid && tid !== state.threadId) return;
  if (msg.method === 'turn/started') { state.turnActive = true; scheduleRenderChat(); return; }
  if (msg.method === 'turn/completed' || msg.method === 'turn/failed') {
    state.turnActive = tab ? !!tab.lastTurnActive : false;
    scheduleRenderChat();
    return;
  }
  if (msg.method === 'thread/status/changed') {
    const status = msg.params?.status;
    if (tab) state.turnActive = !!tab.lastTurnActive;
    else state.turnActive = status?.type === 'active';
    scheduleRenderChat();
    return;
  }
  if (!state.projection) return;
  if (state.projection.applyNotification(msg)) scheduleRenderChat();
}

// First send in an ephemeral tab creates the real thread on the chosen
// machine, then the message goes out on it like any other turn.
async function materializeEphemeral(tab, firstText) {
  const conn = connFor(tab.deviceId);
  if (conn?.status !== 'connected' || !conn.rpc) {
    toast(`${deviceLabel(conn?.dev) || 'That machine'} isn’t connected — hang on.`);
    return false;
  }
  if (state.creatingThread) return false;
  state.creatingThread = true;
  let id;
  try {
    const res = await conn.rpc.request('thread/start', {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    id = res?.thread?.id;
    if (!id) throw new Error('the daemon returned no thread id');
  } catch (e) {
    toast(`Couldn’t start a session: ${e?.message || e}`);
    return false;
  } finally {
    state.creatingThread = false;
  }
  tab.threadId = id;
  tab.ephemeral = false;
  tab.title = truncate(firstText, 44) || 'New session';
  tab.key = tabKeyFor(tab.deviceId, id);
  state.active = tab.key;
  state.threadId = id;
  state.threadDeviceId = tab.deviceId;
  state.threadTitle = tab.title;
  state.projection = createProjection();
  chat.nodes.clear();
  chat.log = null;
  history.replaceState({ deviceId: tab.deviceId, threadId: id, title: tab.title }, '');
  persistTabs();
  conn.rpc.request('thread/resume', { threadId: id }).catch(() => {});
  loadThreads(conn); // the new session should appear on Home promptly
  renderStrip();
  renderSessionChrome();
  return true;
}

async function send() {
  const box = $('#input');
  const text = box.value.trim();
  if (!text) return;
  const tab = activeTab();
  if (tab?.ephemeral) {
    if (!tab.deviceId) { toast('Pick a machine for this session first.'); return; }
    if (!(await materializeEphemeral(tab, text))) return;
  }
  const conn = activeConn();
  if (!state.threadId) return;
  if (!conn?.rpc || conn.status !== 'connected') {
    toast(`${deviceLabel(conn?.dev) || 'This machine'} isn’t connected — hang on.`);
    return;
  }
  haptic();
  box.value = '';
  if (tab) tab.draft = '';
  autoResize();
  const localMessageId = state.projection?.addLocalUserMessage(text);
  state.turnActive = true;
  if (tab) {
    tab.lastTurnActive = true;
    tab.waitingForUser = false;
    tab.turnStartedAt = Date.now();
    tab.lastActivityAt = Date.now();
    tab.lastActivityTail = 'Starting turn…';
    tab.turnError = '';
    tab.unreadForTurn = false;
    tab.activeTurnId = null;
    tab.terminalWithoutId = false;
    touchTabLifecycle(tab, conn.attempt);
    persistTabs();
    renderStrip();
  }
  chat.forceStick = true;
  scheduleRenderChat();
  try {
    const res = await conn.rpc.request('turn/start', {
      threadId: state.threadId,
      input: [{ type: 'text', text, text_elements: [] }],
    });
    if (tab?.lastTurnActive && !tab.activeTurnId && res?.turn?.id) tab.activeTurnId = res.turn.id;
  } catch (e) {
    state.turnActive = false;
    if (tab) {
      tab.lastTurnActive = false;
      tab.turnStartedAt = null;
      tab.turnError = e?.message || String(e);
      tab.lastActivityAt = Date.now();
      touchTabLifecycle(tab, conn.attempt);
      persistTabs();
      renderStrip();
    }
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

// --- wiring ---
$('#send').onclick = send;
$('#stop').onclick = interrupt;
hapticize($('#send'));
hapticize($('#stop'));
$('#jump').onclick = () => {
  const main = $('#main');
  main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
};
$('#main').addEventListener('scroll', updateJump, { passive: true });
$('#input').addEventListener('input', autoResize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

$('#home-btn').onclick = () => {
  if (state.screen === 'home' || state.mode !== 'normal') return;
  navigate(() => {
    showHome();
    // Leaving a session via Home replaces the entry: platform back from Home
    // exits the app like any front page, never re-traps in a closed view.
    if (history.state?.threadId || history.state?.ephemeral) history.replaceState(null, '');
  });
};
$('#tab-new').onclick = newSessionTab;
$('#home-new').onclick = newSessionTab;
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderSessions();
});

$('#ctx-toggle').onclick = () => {
  state.ctxOpen = !state.ctxOpen;
  persistCtxOpen();
  renderSessionChrome();
  renderStrip();
};
const closeCtx = () => {
  state.ctxOpen = false;
  persistCtxOpen();
  renderSessionChrome();
  renderStrip();
  $('#ctx-toggle')?.focus();
};
$('#ctx-close').onclick = closeCtx;
$('#drawer-scrim').onclick = closeCtx;
for (const b of document.querySelectorAll('[data-ctxtab]')) {
  b.onclick = () => {
    state.ctxTab = b.dataset.ctxtab;
    renderCtxTabs();
    renderCtxBody(true);
  };
}
for (const b of document.querySelectorAll('[data-seg]')) {
  b.onclick = () => {
    state.mobilePane = b.dataset.seg;
    const tab = activeTab();
    if (tab?.unread && tabIsViewed(tab)) {
      markTabViewed(tab);
      persistTabs();
    }
    renderSessionChrome();
    renderStrip();
  };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (surface) { closeSurface(true); return; }
    if (state.screen === 'session' && state.ctxOpen && layout() === 'tablet') closeCtx();
    return;
  }
  // Focus trap for modal surfaces (sheet / dialog).
  if (e.key === 'Tab' && surface?.modal) {
    const box = $('#overlay-root').lastElementChild;
    if (!box) return;
    const focusables = [...box.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter((n) => !n.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    return;
  }
  // Roving focus inside tablists and radiogroups.
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const role = e.target.getAttribute?.('role');
    if (role !== 'tab' && role !== 'radio') return;
    const list = e.target.closest('[role="tablist"], [role="radiogroup"]');
    if (!list) return;
    const items = [...list.querySelectorAll(`[role="${role}"]`)].filter((n) => !n.disabled);
    let i = items.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') i = (i - 1 + items.length) % items.length;
    else if (e.key === 'ArrowRight') i = (i + 1) % items.length;
    else if (e.key === 'Home') i = 0;
    else i = items.length - 1;
    items[i].focus();
  }
});

window.addEventListener('popstate', (e) => {
  closeSurface(false);
  if (!state.devices.length || state.mode !== 'normal') return;
  stashDraft();
  const s = e.state;
  if (s?.threadId) {
    const deviceId = s.deviceId || state.devices[0]?.id;
    navigate(() => openTabForThread(deviceId, s.threadId, s.title || '', { history: 'none' }));
  } else if (s?.ephemeral && state.tabs.some((t) => t.key === s.tabKey)) {
    navigate(() => selectTab(s.tabKey, { history: 'none' }));
  } else {
    navigate(() => showHome());
  }
});

// Re-measure tab overflow on resize; re-layout the workspace on breakpoint
// changes (never touching the chat log itself).
let resizeRaf = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(renderStrip);
});
for (const mq of [mqDesk, mqTab]) {
  mq.addEventListener('change', () => {
    renderStrip();
    if (state.screen === 'session') {
      renderSessionChrome();
      const tab = activeTab();
      if (tab?.ephemeral) renderEphemeral(tab);
    }
  });
}

boot();
