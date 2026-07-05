import { connect } from './transport.js?v=20260705-paths';
import { makeRpc } from './rpc.js?v=20260705-paths';
import { createProjection } from './projection.js?v=20260705-paths';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const state = {
  creds: null,
  transport: null,
  rpc: null,
  threadId: null,
  threadTitle: '',
  projection: null,
  turnActive: false,
  status: 'connecting',
  connectAttempt: 0,
  reconnectTimer: null,
  lastMetrics: null,
  everConnected: false,
  creatingThread: false,
};

function readCreds() {
  const frag = new URLSearchParams(location.hash.slice(1));
  const node = frag.get('node');
  const token = frag.get('token');
  const relay = frag.get('relay'); // URLSearchParams decodes it
  const addrs = frag.getAll('addr');
  if (node && token) {
    // Persist so a re-open (from home screen) reconnects without the QR.
    const creds = { node, token, relay, addrs };
    localStorage.setItem('doggypile:creds', JSON.stringify(creds));
    history.replaceState(null, '', location.pathname + location.search);
    return creds;
  }
  const saved = localStorage.getItem('doggypile:creds');
  return saved ? JSON.parse(saved) : null;
}

function saveToken(token) {
  if (!token || !state.creds) return;
  state.creds = { ...state.creds, token };
  localStorage.setItem('doggypile:creds', JSON.stringify(state.creds));
}

function setStatus(key, label, detail) {
  state.status = key;
  const pill = $('#status');
  pill.textContent = label || key;
  pill.dataset.state = key.split(' ')[0];
  pill.title = detail || '';
}

function onMetrics(metrics) {
  state.lastMetrics = metrics;
  const phases = metrics.timings
    ? Object.entries(metrics.timings).map(([k, v]) => `${k}=${Math.round(v)}ms`).join(' ')
    : '';
  const path = metrics.path?.selected && metrics.path.selected !== 'unknown'
    ? `${metrics.path.selected}${metrics.path.rtt_ms != null ? ` ${metrics.path.rtt_ms}ms` : ''}`
    : '';
  const detail = [path, phases].filter(Boolean).join(' | ');
  if (state.status.startsWith('connected') && path) setStatus(`connected ${metrics.path.selected}`, null, detail);
  else if (detail) $('#status').title = detail;
  if (detail) console.info('[doggypile] connection', metrics);
}

// --- header / composer chrome ---
function setHeader(...nodes) {
  $('#header-left').replaceChildren(...nodes);
}
function brandEl() {
  return el('span', 'brand', 'doggypile');
}
function backBtn() {
  const b = el('button', 'back-btn', '‹ Sessions');
  b.setAttribute('aria-label', 'Back to sessions');
  b.onclick = showSessions;
  return b;
}
function showComposer(show) {
  $('#composer').hidden = !show;
  updateComposer();
}
function updateComposer() {
  $('#stop').hidden = !state.turnActive;
  $('#send').disabled = !$('#input').value.trim() || !state.threadId;
}

// --- centered state blocks (pairing / loading / error / empty) ---
function stateBox({ icon, spinner, title, body, action }) {
  const box = el('div', 'state');
  if (spinner) box.append(el('div', 'spinner'));
  if (icon) box.append(el('div', 'state-icon', icon));
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
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

async function boot() {
  state.creds = readCreds();
  if (!state.creds) {
    setStatus('unpaired', 'not paired');
    setHeader(brandEl());
    showComposer(false);
    $('#main').replaceChildren(stateBox({
      icon: null,
      title: 'Pair this device',
      body: [
        'Run ',
        el('code', null, 'doggypile pair'),
        ' on your computer, then scan the QR code with this phone to connect.',
      ],
    }));
    return;
  }
  await connectAndSync();
}

async function connectAndSync() {
  const attempt = ++state.connectAttempt;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  setStatus(state.everConnected ? 'reconnecting' : 'connecting');
  if (!state.everConnected) {
    setHeader(brandEl());
    showComposer(false);
    $('#main').replaceChildren(stateBox({ spinner: true, body: 'Connecting to your daemon…' }));
  }
  try {
    state.transport = await connect({
      nodeId: state.creds.node,
      token: state.creds.token,
      relay: state.creds.relay,
      directAddrs: state.creds.addrs || [],
      onToken: saveToken,
      onMetrics,
      onLine: (line) => state.rpc?.handleLine(line),
      onClose: () => {
        if (attempt !== state.connectAttempt) return;
        setStatus('reconnecting');
        state.reconnectTimer = setTimeout(connectAndSync, 1000);
      },
    });
    state.rpc = makeRpc(state.transport, { onNotify });
    await state.rpc.initialize();
  } catch (e) {
    if (attempt !== state.connectAttempt) return;
    const detail = e instanceof Error ? e.message : String(e);
    if (/already-used|invalid/i.test(detail)) {
      localStorage.removeItem('doggypile:creds');
      state.creds = null;
      setStatus('pairing expired', 'pairing expired', detail);
      showComposer(false);
      $('#main').replaceChildren(stateBox({
        icon: '⚠️',
        title: 'Pairing link expired',
        body: 'Run doggypile pair again to reconnect this device.',
      }));
      return;
    }
    setStatus('offline', null, detail);
    // Before the first successful connect there's nothing else to show; after
    // that, keep the current view readable and retry quietly via the pill.
    if (!state.everConnected) {
      const retry = el('button', 'btn', 'Retry now');
      retry.onclick = connectAndSync;
      $('#main').replaceChildren(stateBox({
        icon: '⚠️',
        title: 'Can’t reach the daemon',
        body: `${detail}. Retrying automatically…`,
        action: retry,
      }));
    }
    state.reconnectTimer = setTimeout(connectAndSync, 2000);
    return;
  }
  state.everConnected = true;
  const path = state.lastMetrics?.path?.selected;
  setStatus(path && path !== 'unknown' ? `connected ${path}` : 'connected');

  if (state.threadId) await openThread(state.threadId, state.threadTitle); // resume where we were
  else await showSessions();
}

// --- sessions list ---
function sectionHead() {
  const row = el('div', 'section-head');
  row.append(el('span', 'section-title', 'Sessions'));
  const add = el('button', 'btn', '+ New');
  add.setAttribute('aria-label', 'New session');
  add.onclick = newThread;
  row.append(add);
  return row;
}

function skeletonList(n = 4) {
  const wrap = el('div');
  for (let i = 0; i < n; i++) {
    const row = el('div', 'skeleton-row');
    row.append(el('div', 'skeleton-bar long'), el('div', 'skeleton-bar short'));
    wrap.append(row);
  }
  return wrap;
}

async function showSessions() {
  state.threadId = null;
  state.threadTitle = '';
  setHeader(brandEl());
  showComposer(false);
  $('#main').replaceChildren(sectionHead(), skeletonList());

  let res;
  try {
    res = await state.rpc.request('thread/list', {});
  } catch (e) {
    const retry = el('button', 'btn', 'Try again');
    retry.onclick = showSessions;
    $('#main').replaceChildren(sectionHead(), stateBox({
      icon: '⚠️',
      title: 'Couldn’t load sessions',
      body: e?.message || String(e),
      action: retry,
    }));
    return;
  }
  if (state.threadId) return; // user already opened something while loading

  const threads = res?.data || [];
  if (!threads.length) {
    const start = el('button', 'btn btn-primary', 'Start a session');
    start.onclick = newThread;
    $('#main').replaceChildren(sectionHead(), stateBox({
      icon: '💬',
      title: 'No sessions yet',
      body: 'Start a session to chat with the agent on your computer.',
      action: start,
    }));
    return;
  }

  const list = el('div', 'sessions');
  for (const t of threads) {
    const title = t.name || t.preview || '(untitled)';
    const row = el('button', 'session');
    const main = el('div', 'session-main');
    main.append(el('div', 'session-title', title));
    const meta = el('div', 'session-meta');
    const dir = short(t.cwd);
    if (dir) meta.append(el('span', 'dir', dir), ' · ');
    meta.append(rel(t.updatedAt || t.recencyAt) || '');
    main.append(meta);
    row.append(main, el('span', 'session-chevron', '›'));
    row.onclick = () => openThread(t.id, title);
    list.append(row);
  }
  $('#main').replaceChildren(sectionHead(), list);
}

async function newThread() {
  if (state.creatingThread) return;
  state.creatingThread = true;
  try {
    const res = await state.rpc.request('thread/start', {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    });
    const id = res?.thread?.id;
    if (id) await openThread(id, 'New session');
  } catch (e) {
    toast(`Couldn’t start a session: ${e?.message || e}`);
  } finally {
    state.creatingThread = false;
  }
}

// --- chat ---
async function openThread(id, title) {
  state.threadId = id;
  if (title) state.threadTitle = title;
  state.projection = createProjection();
  setHeader(backBtn(), el('div', 'topbar-title', state.threadTitle || 'Session'));
  showComposer(true);
  $('#main').replaceChildren(stateBox({ spinner: true, body: 'Loading conversation…' }));
  // Resume to subscribe to live turn events, then hydrate history. A freshly
  // started thread isn't materialized until its first message, so thread/read
  // can fail — that's fine, we just start with an empty log.
  await state.rpc.request('thread/resume', { threadId: id }).catch(() => {});
  const res = await state.rpc.request('thread/read', { threadId: id, includeTurns: true }).catch(() => null);
  if (state.threadId !== id) return; // navigated away while loading
  if (res?.thread) state.projection.seedFromThread(res.thread);
  renderChat();
}

function renderChat() {
  const main = $('#main');
  // Only stick to the bottom if the user hasn't scrolled up to read history.
  const hadLog = !!main.querySelector('.log');
  const stick = !hadLog || main.scrollHeight - main.scrollTop - main.clientHeight < 80;

  const log = el('div', 'log');
  const msgs = state.projection.toRenderList();
  if (!msgs.length && !state.turnActive) {
    log.append(el('div', 'chat-hint', 'Send a message to get started.'));
  }
  for (const m of msgs) log.append(renderMessage(m));
  if (state.turnActive) {
    const w = el('div', 'working');
    w.append(el('span', 'wdot'), el('span', 'wdot'), el('span', 'wdot'), el('span', null, 'working…'));
    log.append(w);
  }
  main.replaceChildren(log);
  updateComposer();
  if (stick) {
    main.scrollTop = main.scrollHeight;
    requestAnimationFrame(() => (main.scrollTop = main.scrollHeight));
  }
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

function renderMessage(m) {
  if (m.role === 'user') return bubble('user', m.text);
  if (m.kind === 'reasoning') return bubble('reasoning', m.text);
  if (m.role === 'tool') {
    if (m.kind === 'command') {
      const c = el('div', 'tool');
      const head = el('div', 'tool-head');
      const dot = el('span', 'dot');
      dot.dataset.status = m.status || 'running';
      head.append(dot, el('span', 'tool-cmd', `$ ${m.command || ''}`));
      c.append(head);
      if (m.text) c.append(el('pre', 'tool-out', m.text));
      return c;
    }
    return el('div', 'chip', m.text);
  }
  return bubble('assistant', m.text);
}

function bubble(role, text) {
  const b = el('div', `msg ${role}`);
  b.append(el('div', 'msg-body', text || ''));
  return b;
}

function onNotify(msg) {
  if (msg.method === 'turn/started') { state.turnActive = true; scheduleRenderChat(); return; }
  if (msg.method === 'turn/completed' || msg.method === 'turn/failed') { state.turnActive = false; scheduleRenderChat(); return; }
  if (!state.projection) return;
  // Only react to events for the open thread.
  if (msg.params?.threadId && msg.params.threadId !== state.threadId) return;
  if (state.projection.applyNotification(msg)) scheduleRenderChat();
}

async function send() {
  const box = $('#input');
  const text = box.value.trim();
  if (!text || !state.threadId) return;
  box.value = '';
  autoResize();
  state.turnActive = true;
  scheduleRenderChat();
  try {
    await state.rpc.request('turn/start', {
      threadId: state.threadId,
      input: [{ type: 'text', text, text_elements: [] }],
    });
  } catch (e) {
    state.turnActive = false;
    if (!box.value) { box.value = text; autoResize(); } // let the user retry
    toast(`Send failed: ${e?.message || e}`);
    scheduleRenderChat();
  }
}

function interrupt() {
  if (state.threadId) state.rpc.request('turn/interrupt', { threadId: state.threadId }).catch(() => {});
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
$('#input').addEventListener('input', autoResize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

boot();
