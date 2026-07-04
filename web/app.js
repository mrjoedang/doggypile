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
  creds: null,
  transport: null,
  rpc: null,
  threadId: null,
  threadTitle: '',
  projection: null,
  turnActive: false,
  status: 'connecting',
  statusDetail: '',
  connectAttempt: 0,
  reconnectTimer: null,
  lastMetrics: null,
  activeAgent: null,
  everConnected: false,
  creatingThread: false,
};

function readCreds() {
  if (MOCK) return { node: 'mock', token: 'mock', relay: null, addrs: [] };
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
  if (!token || !state.creds || MOCK) return;
  state.creds = { ...state.creds, token };
  localStorage.setItem('doggypile:creds', JSON.stringify(state.creds));
}

// --- status pill ---
function setStatus(key, label, detail) {
  state.status = key;
  state.statusDetail = detail || '';
  const pill = $('#status');
  pill.textContent = label || key;
  pill.dataset.state = key.split(' ')[0];
  pill.title = detail || '';
}

function connectedStatusLabel() {
  return state.activeAgent || 'connected';
}

function onMetrics(metrics) {
  state.lastMetrics = metrics;
  if (metrics.agent) state.activeAgent = metrics.agent;
  const phases = metrics.timings
    ? Object.entries(metrics.timings).map(([k, v]) => `${k} ${Math.round(v)}ms`).join(' · ')
    : '';
  const path = metrics.path?.selected && metrics.path.selected !== 'unknown'
    ? `${metrics.path.selected}${metrics.path.rtt_ms != null ? ` · ${metrics.path.rtt_ms}ms` : ''}`
    : '';
  const detail = [path, phases].filter(Boolean).join('\n');
  if (state.status.startsWith('connected') || state.status === state.activeAgent) {
    setStatus(connectedStatusLabel(), null, detail);
    $('#status').dataset.state = 'connected';
  } else if (detail) {
    state.statusDetail = detail;
    $('#status').title = detail;
  }
}

function setConnectedStatus() {
  setStatus(connectedStatusLabel(), null, state.statusDetail);
  $('#status').dataset.state = 'connected';
}

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
  b.onclick = showSessions;
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
  state.creds = readCreds();
  if (!state.creds) {
    setStatus('unpaired', 'not paired');
    setHeader(brandEl());
    showComposer(false);
    $('#main').replaceChildren(stateBox({
      icon: 'paw',
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

function showDaemonTooOldForInstall(detail) {
  setStatus('offline', null, detail);
  setHeader(brandEl());
  showComposer(false);
  const retry = el('button', 'btn', 'Retry after restart');
  retry.onclick = connectAndSync;
  $('#main').replaceChildren(stateBox({
    icon: 'warn',
    title: 'Daemon needs a restart',
    body: 'This web UI can install opencode, but the running doggypile daemon is too old to understand install requests. Restart doggypile from the latest build, then retry.',
    action: retry,
  }));
}

async function installOpencodeAndReconnect(attempt) {
  if (!confirm('No supported agent is available. Install opencode on your computer now?\n\nThis will run:\ncurl -fsSL https://opencode.ai/install | bash')) return false;
  setStatus('installing', 'installing');
  setHeader(brandEl());
  showComposer(false);
  $('#main').replaceChildren(stateBox({ spinner: true, title: 'Installing opencode…', body: 'Running the official opencode installer on your computer.' }));
  try {
    await installAgent({
      nodeId: state.creds.node,
      token: state.creds.token,
      relay: state.creds.relay,
      directAddrs: state.creds.addrs || [],
      agent: 'opencode',
      onToken: saveToken,
    });
  } catch (e) {
    if (attempt !== state.connectAttempt) return true;
    let detail = e instanceof Error ? e.message : String(e);
    if (/stream closed/i.test(detail)) {
      detail = 'The daemon closed the install request. This usually means the running doggypile daemon is too old; restart doggypile from the latest build and try again.';
    }
    setStatus('offline', null, detail);
    const retry = el('button', 'btn', 'Try install again');
    retry.onclick = () => installOpencodeAndReconnect(++state.connectAttempt);
    $('#main').replaceChildren(stateBox({
      icon: 'warn',
      title: 'opencode install failed',
      body: detail,
      action: retry,
    }));
    return true;
  }
  if (attempt === state.connectAttempt) await connectAndSync();
  return true;
}

async function connectAndSync() {
  const attempt = ++state.connectAttempt;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  setStatus(state.everConnected ? 'reconnecting' : 'connecting', state.everConnected ? 'reconnecting' : 'connecting');
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
        setStatus('reconnecting', 'reconnecting');
        state.reconnectTimer = setTimeout(connectAndSync, 1000);
      },
    });
    state.activeAgent = state.transport.agent || null;
    state.rpc = makeRpc(state.transport, { onNotify });
    await state.rpc.initialize();
  } catch (e) {
    if (attempt !== state.connectAttempt) return;
    const detail = e instanceof Error ? e.message : String(e);
    if (/already-used|invalid/i.test(detail)) {
      localStorage.removeItem('doggypile:creds');
      state.creds = null;
      setStatus('expired', 'pairing expired', detail);
      showComposer(false);
      $('#main').replaceChildren(stateBox({
        icon: 'warn',
        title: 'Pairing link expired',
        body: [
          'Run ',
          el('code', null, 'doggypile pair'),
          ' again to reconnect this device.',
        ],
      }));
      return;
    }
    if (e instanceof NoSupportedAgentError && !state.everConnected) {
      if (!e.hostCapabilities?.includes('install_agent')) {
        showDaemonTooOldForInstall(detail);
        return;
      }
      const handled = await installOpencodeAndReconnect(attempt);
      if (handled) return;
    }
    setStatus('offline', null, detail);
    // Before the first successful connect there's nothing else to show; after
    // that, keep the current view readable and retry quietly via the pill.
    if (!state.everConnected) {
      const retry = el('button', 'btn', 'Retry now');
      retry.onclick = connectAndSync;
      $('#main').replaceChildren(stateBox({
        icon: 'warn',
        title: 'Can’t reach the daemon',
        body: `${detail}. Retrying automatically…`,
        action: retry,
      }));
    }
    state.reconnectTimer = setTimeout(connectAndSync, 2000);
    return;
  }
  state.everConnected = true;
  setConnectedStatus();

  if (state.threadId) await openThread(state.threadId, state.threadTitle); // resume where we were
  else await showSessions();
}

// --- sessions list ---
function sectionHead() {
  const row = el('div', 'section-head');
  row.append(el('span', 'section-title', 'Sessions'));
  const add = el('button', 'btn btn-accent btn-small');
  add.append(icon('plus', 'icon btn-icon'), el('span', null, 'New'));
  add.setAttribute('aria-label', 'New session');
  add.onclick = newThread;
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
      icon: 'warn',
      title: 'Couldn’t load sessions',
      body: e?.message || String(e),
      action: retry,
    }));
    return;
  }
  if (state.threadId) return; // user already opened something while loading

  const threads = res?.data || [];
  if (!threads.length) {
    const start = el('button', 'btn btn-accent', 'Start a session');
    start.onclick = newThread;
    $('#main').replaceChildren(sectionHead(), stateBox({
      icon: 'chat',
      title: 'No sessions yet',
      body: 'Start a session to chat with the agent on your computer.',
      action: start,
    }));
    return;
  }

  const list = el('div', 'sessions view');
  for (const t of threads) {
    const title = t.name || t.preview || 'Untitled session';
    const row = el('button', 'session');
    const main = el('div', 'session-main');
    main.append(el('div', 'session-title', title));
    const meta = el('div', 'session-meta');
    const dir = short(t.cwd);
    if (dir) meta.append(el('span', 'session-dir', dir));
    const when = rel(t.updatedAt || t.recencyAt);
    if (when) meta.append(el('span', 'session-time', when));
    main.append(meta);
    row.append(main, icon('chevronRight', 'icon session-chevron'));
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
const chat = {
  nodes: new Map(), // item id -> { el, kind, update(m), ... }
  log: null,
  hintEl: null,
  workingEl: null,
  forceStick: false, // one-shot: scroll to bottom regardless of position (e.g. after send)
};

async function openThread(id, title) {
  state.threadId = id;
  if (title) state.threadTitle = title;
  state.projection = createProjection();
  chat.nodes.clear();
  chat.log = null;
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

function onNotify(msg) {
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
  if (!text || !state.threadId) return;
  box.value = '';
  autoResize();
  const localMessageId = state.projection?.addLocalUserMessage(text);
  state.turnActive = true;
  chat.forceStick = true;
  scheduleRenderChat();
  try {
    await state.rpc.request('turn/start', {
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
$('#jump').onclick = () => {
  const main = $('#main');
  main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
};
$('#main').addEventListener('scroll', updateJump, { passive: true });
$('#status').onclick = () => {
  const detail = state.statusDetail || $('#status').title;
  toast(detail ? `${state.status} — ${detail.replace(/\n/g, ' · ')}` : state.status);
};
$('#input').addEventListener('input', autoResize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

boot();
