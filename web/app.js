import { connect } from './transport.js';
import { makeRpc } from './rpc.js';
import { createProjection } from './projection.js';

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
  projection: null,
  turnActive: false,
  status: 'connecting',
};

function readCreds() {
  const frag = new URLSearchParams(location.hash.slice(1));
  const node = frag.get('node');
  const token = frag.get('token');
  const relay = frag.get('relay'); // URLSearchParams decodes it
  if (node && token) {
    // Persist so a re-open (from home screen) reconnects without the QR.
    const creds = { node, token, relay };
    localStorage.setItem('doggypile:creds', JSON.stringify(creds));
    history.replaceState(null, '', location.pathname + location.search);
    return creds;
  }
  const saved = localStorage.getItem('doggypile:creds');
  return saved ? JSON.parse(saved) : null;
}

function setStatus(s) {
  state.status = s;
  const pill = $('#status');
  pill.textContent = s;
  pill.dataset.state = s;
}

async function boot() {
  state.creds = readCreds();
  if (!state.creds) {
    setStatus('no pairing');
    $('#main').replaceChildren(el('div', 'empty', 'Open the QR link from `doggypile connect` to pair.'));
    return;
  }
  await connectAndSync();
}

async function connectAndSync() {
  setStatus('connecting');
  try {
    state.transport = await connect({
      nodeId: state.creds.node,
      token: state.creds.token,
      relay: state.creds.relay,
      onLine: (line) => state.rpc?.handleLine(line),
      onClose: () => {
        setStatus('reconnecting');
        setTimeout(connectAndSync, 1000);
      },
    });
  } catch (e) {
    setStatus('offline');
    setTimeout(connectAndSync, 2000);
    return;
  }

  state.rpc = makeRpc(state.transport, { onNotify: onNotify });
  await state.rpc.initialize();
  setStatus('connected');

  if (state.threadId) await openThread(state.threadId); // resume where we were
  else await showSessions();
}

async function showSessions() {
  state.threadId = null;
  const res = await state.rpc.request('thread/list', {});
  const threads = res?.data || [];
  const list = el('div', 'sessions');
  list.append(headerRow('sessions', el('button', 'btn', '+ new')));
  list.querySelector('button').onclick = newThread;
  for (const t of threads) {
    const row = el('button', 'session');
    row.append(
      el('div', 'session-title', t.name || t.preview || '(untitled)'),
      el('div', 'session-meta', `${short(t.cwd)} · ${rel(t.updatedAt || t.recencyAt)}`),
    );
    row.onclick = () => openThread(t.id);
    list.append(row);
  }
  if (!threads.length) list.append(el('div', 'empty', 'No sessions yet. Tap + new.'));
  $('#main').replaceChildren(list);
  $('#composer').style.display = 'none';
}

async function newThread() {
  const res = await state.rpc.request('thread/start', {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
  });
  const id = res?.thread?.id;
  if (id) await openThread(id);
}

async function openThread(id) {
  state.threadId = id;
  state.projection = createProjection();
  // Resume to subscribe to live turn events, then hydrate history. A freshly
  // started thread isn't materialized until its first message, so thread/read
  // can fail — that's fine, we just start with an empty log.
  await state.rpc.request('thread/resume', { threadId: id }).catch(() => {});
  const res = await state.rpc.request('thread/read', { threadId: id, includeTurns: true }).catch(() => null);
  if (res?.thread) state.projection.seedFromThread(res.thread);
  renderChat();
}

function renderChat() {
  const wrap = el('div', 'chat');
  wrap.append(headerRow(null, backBtn()));
  const log = el('div', 'log');
  for (const m of state.projection.toRenderList()) log.append(renderMessage(m));
  if (state.turnActive) log.append(el('div', 'working', '● agent working…'));
  wrap.append(log);
  $('#main').replaceChildren(wrap);
  $('#composer').style.display = 'flex';
  log.scrollTop = log.scrollHeight;
  requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
}

let renderPending = false;
function scheduleRenderChat() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderChat();
  });
}

function renderMessage(m) {
  if (m.role === 'user') return bubble('user', m.text);
  if (m.kind === 'reasoning') return bubble('reasoning', m.text);
  if (m.role === 'tool') {
    const c = el('div', 'tool');
    c.append(el('div', 'tool-head', m.kind === 'command' ? `$ ${m.command || ''}` : m.text));
    if (m.kind === 'command' && m.text) c.append(el('pre', 'tool-out', m.text));
    return c;
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
  state.turnActive = true;
  await state.rpc.request('turn/start', {
    threadId: state.threadId,
    input: [{ type: 'text', text, text_elements: [] }],
  }).catch(() => {});
}

function interrupt() {
  if (state.threadId) state.rpc.request('turn/interrupt', { threadId: state.threadId }).catch(() => {});
}

// --- small UI helpers ---
function headerRow(title, action) {
  const row = el('div', 'row');
  if (title) row.append(el('div', 'row-title', title));
  if (action) row.append(action);
  return row;
}
function backBtn() {
  const b = el('button', 'btn', '‹ sessions');
  b.onclick = showSessions;
  return b;
}
function short(p) { return p ? p.split('/').slice(-1)[0] : ''; }
function rel(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? ts : Date.parse(ts);
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

$('#send').onclick = send;
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('#stop').onclick = interrupt;

boot();
