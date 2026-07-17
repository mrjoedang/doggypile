// Session Workspace tabs own the registry and every lifecycle fact displayed by
// the desktop strip, mobile session rail, and Home session list.
//
// Owned state (on the injected app state): tabs, active, newN, and each tab's
// draft, unread counters, activity tail/timestamps, turn identity/status/error,
// and lifecycleRevision. The module also owns its coalescing activity timer and
// persistence ordering.
//
// Dependencies are adapters: connection lookup, clock/timers, persistence,
// draft I/O, visibility, and shell/chat/history callbacks. createWorkspaceTabs
// returns the complete tab/lifecycle interface; callers should not mutate owned
// fields directly.
//
// Invariants:
// - one durable tab per device/thread and at most one ephemeral tab;
// - active is null or the key of a registered tab;
// - delayed/duplicate terminal events cannot finish a newer turn or double-count;
// - unread is capped at 99 and cleared only when a tab is actually viewable;
// - lifecycle revisions make stale thread/list and thread/read snapshots harmless;
// - mutations persist before dependent strip/rail/Home repaint callbacks.
//
// Non-responsibilities: this module never renders chat/thread/context, labels a
// machine, talks RPC, chooses a transport, or implements Home/history. Those
// remain behind injected callbacks.

const ERROR_CONNECTION_STATES = new Set(['offline', 'expired', 'noagent']);
const LIVE_STATUS_TYPES = new Set(['active', 'busy', 'working', 'needs-you']);

export function createWorkspaceTabs({
  state,
  tabKeyFor = (deviceId, threadId) => `${deviceId}:${threadId}`,
  connectionFor = () => null,
  now = () => Date.now(),
  timers = { setTimeout, clearTimeout },
  persistence = {},
  draft = {},
  view = {},
  shell = {},
} = {}) {
  if (!state || !Array.isArray(state.tabs)) throw new TypeError('workspace tabs require state.tabs');

  let lifecycleRevision = Math.max(0, ...state.tabs.map((tab) => Number(tab.lifecycleRevision) || 0));
  let activityFlushTimer = null;

  const activeTab = () => state.tabs.find((tab) => tab.key === state.active) || null;
  const isViewed = (tab) => view.isTabViewed?.(tab) ?? false;
  const touch = (tab, attempt) => {
    tab.lifecycleRevision = ++lifecycleRevision;
    if (attempt !== undefined) tab.lifecycleAttempt = attempt;
  };
  const repaint = (reason) => {
    view.renderStripAndRail?.(reason);
    if (view.isHome?.()) view.renderHome?.(reason);
  };
  const persist = () => persistence.persist?.();
  const commit = (reason) => { persist(); repaint(reason); };

  function normalizeTab(tab) {
    return Object.assign(tab, {
      title: tab.title || (tab.ephemeral ? 'New session' : 'Session'),
      lastTurnActive: !!tab.lastTurnActive,
      unread: Math.max(0, Math.min(99, Number(tab.unread) || 0)),
      turnStartedAt: tab.turnStartedAt || null,
      lastActivityAt: Number(tab.lastActivityAt) || 0,
      lastActivityTail: tab.lastActivityTail || '',
      lastViewedAt: Number(tab.lastViewedAt) || 0,
      turnError: tab.turnError || '',
      waitingForUser: !!tab.waitingForUser,
      unreadForTurn: !!tab.unreadForTurn,
      draft: tab.draft || '',
    });
  }

  function restore() {
    persistence.restore?.();
    for (const tab of state.tabs) normalizeTab(tab);
    if (state.active && !activeTab()) state.active = null;
    lifecycleRevision = Math.max(lifecycleRevision, ...state.tabs.map((tab) => Number(tab.lifecycleRevision) || 0));
    return activeTab();
  }

  function status(tab) {
    const connectionStatus = connectionFor(tab.deviceId)?.status;
    if (tab.turnError || ERROR_CONNECTION_STATES.has(connectionStatus)) return 'error';
    if (tab.waitingForUser || (tab.unread || 0) > 0) return 'needs-you';
    if (connectionStatus === 'connecting') return 'connecting';
    if (tab.lastTurnActive) return 'working';
    return 'idle';
  }

  function snapshotStatus(thread, connection) {
    const value = thread?.status || (thread?.mockStatus ? { type: thread.mockStatus } : null);
    const type = typeof value === 'string' ? value : value?.type;
    const flags = typeof value === 'object' && Array.isArray(value?.activeFlags) ? value.activeFlags : [];
    if (ERROR_CONNECTION_STATES.has(connection?.status) || type === 'systemError' || type === 'error') return 'error';
    if (type === 'needs-you' || flags.includes('waitingOnApproval') || flags.includes('waitingOnUserInput')) return 'needs-you';
    if (connection?.status === 'connecting') return 'connecting';
    if (LIVE_STATUS_TYPES.has(type)) return 'working';
    return 'idle';
  }

  function activity(tab) {
    const current = status(tab);
    const connection = connectionFor(tab.deviceId);
    if (current === 'error') return tab.turnError || connection?.lastDetail || 'Machine unavailable';
    if (current === 'connecting') return connection?.lastDetail || 'Connecting…';
    if (tab.waitingForUser) return tab.lastActivityTail || 'Waiting for your reply';
    if (tab.key === state.active) {
      const live = view.activeProjectionActivity?.() || '';
      if (live) return live;
    }
    if (tab.lastActivityTail) return tab.lastActivityTail;
    const meta = connection?.threads?.find((thread) => thread.id === tab.threadId);
    if (current === 'needs-you') return 'Waiting for your reply';
    if (current === 'working') return 'Working…';
    return meta?.preview || 'Done';
  }

  function markViewed(tab) {
    if (!tab) return;
    tab.unread = 0;
    tab.unreadForTurn = false;
    tab.lastViewedAt = now();
  }

  function applyStatus(tab, value, { markUnread = false, detail = '' } = {}) {
    if (!value) return false;
    const type = typeof value === 'string' ? value : value.type;
    const flags = typeof value === 'object' && Array.isArray(value.activeFlags) ? value.activeFlags : [];
    const approval = flags.includes('waitingOnApproval');
    const input = flags.includes('waitingOnUserInput');
    const waiting = type === 'needs-you' || approval || input;
    if (LIVE_STATUS_TYPES.has(type)) {
      if (waiting) {
        if (markUnread && !tab.waitingForUser && !tab.unreadForTurn && !isViewed(tab)) {
          tab.unread = Math.min(99, (tab.unread || 0) + 1);
          tab.unreadForTurn = true;
        }
        tab.waitingForUser = true;
        tab.lastTurnActive = true;
        tab.turnStartedAt ||= now();
        tab.turnError = '';
        if (approval) tab.lastActivityTail = 'Waiting for approval';
        else if (!tab.unreadForTurn) tab.lastActivityTail = 'Waiting for your reply';
      } else {
        tab.waitingForUser = false;
        tab.lastTurnActive = true;
        tab.turnStartedAt ||= now();
        tab.turnError = '';
      }
      return true;
    }
    if (type === 'notLoaded') return false;
    if (type === 'idle') {
      tab.waitingForUser = false;
      tab.lastTurnActive = false;
      tab.turnStartedAt = null;
      return true;
    }
    if (type === 'systemError' || type === 'error') {
      tab.waitingForUser = false;
      tab.lastTurnActive = false;
      tab.turnStartedAt = null;
      tab.turnError = detail || value?.error?.message || value?.message || 'Thread error';
      return true;
    }
    return false;
  }

  function finishTurn(tab, { failed = false, detail = '', turnId = null } = {}) {
    const effectiveTurnId = turnId || tab.activeTurnId || null;
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
    const at = now();
    tab.lastTurnActive = false;
    tab.waitingForUser = false;
    tab.turnStartedAt = null;
    tab.lastActivityAt = at;
    tab.lastTurnEndedAt = at;
    if (failed) tab.turnError = detail || 'Turn failed';
    if (!isViewed(tab) && !tab.unreadForTurn) tab.unread = Math.min(99, (tab.unread || 0) + 1);
    tab.unreadForTurn = false;
    if (effectiveTurnId) tab.lastFinishedTurnId = effectiveTurnId;
    tab.terminalWithoutId = !effectiveTurnId;
    tab.activeTurnId = null;
    return true;
  }

  function recordActivity(tab, message) {
    const params = message.params || {};
    const method = message.method || '';
    if (tab.waitingForUser && (method.endsWith('/delta') || method.endsWith('TextDelta'))) return false;
    let text = '';
    if (method === 'item/agentMessage/delta' || method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
      text = `${tab.lastActivityTail || ''}${params.delta || ''}`;
    } else if ((method === 'item/started' || method === 'item/completed') && params.item) {
      const item = params.item;
      if (item.type === 'commandExecution') text = item.command ? `$ ${item.command}` : 'Running a command…';
      else if (item.type === 'agentMessage') text = item.text || '';
      else if (item.type === 'reasoning') {
        const parts = item.summary?.length ? item.summary : item.content || [];
        text = Array.isArray(parts) ? parts.join(' ') : String(parts);
      } else if (item.type === 'fileChange') text = 'Editing files…';
    }
    if (!text) return false;
    const clean = text.replace(/\s+/g, ' ').trim();
    const next = clean.length > 100 ? `…${clean.slice(-100)}` : clean;
    if (!next || next === tab.lastActivityTail) return false;
    tab.lastActivityTail = next;
    tab.lastActivityAt = now();
    return true;
  }

  function scheduleActivityFlush() {
    if (activityFlushTimer) return;
    activityFlushTimer = timers.setTimeout(() => {
      activityFlushTimer = null;
      commit('activity');
    }, 300);
  }

  function notify(connection, message) {
    const threadId = message.params?.threadId;
    const tab = threadId ? state.tabs.find((candidate) => candidate.deviceId === connection.dev.id && candidate.threadId === threadId) : null;
    if (!tab) return { tab: null, lifecycleChanged: false, activityChanged: false };
    const activityChanged = recordActivity(tab, message);
    let lifecycleChanged = false;
    if (message.method === 'turn/started') {
      const turnId = message.params?.turn?.id || message.params?.turnId || null;
      const duplicate = tab.lastTurnActive && tab.activeTurnId === turnId && !tab.waitingForUser && !tab.turnError;
      if (!duplicate) {
        if (!tab.lastTurnActive) tab.turnStartedAt = now();
        tab.waitingForUser = false;
        tab.lastTurnActive = true;
        tab.turnError = '';
        tab.unreadForTurn = false;
        tab.activeTurnId = turnId;
        tab.terminalWithoutId = false;
        tab.lastActivityAt = now();
        lifecycleChanged = true;
      }
    } else if (message.method === 'thread/status/changed') {
      const next = message.params?.status;
      lifecycleChanged = next?.type === 'idle' && tab.lastTurnActive
        ? finishTurn(tab)
        : applyStatus(tab, next, { markUnread: true, detail: message.params?.message });
      if (lifecycleChanged) tab.lastActivityAt = now();
    }
    if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage' && !isViewed(tab) && !tab.unreadForTurn) {
      tab.unread = Math.min(99, (tab.unread || 0) + 1);
      tab.unreadForTurn = true;
      lifecycleChanged = true;
    }
    if (message.method === 'turn/completed') {
      const failed = message.params?.turn?.status === 'failed';
      lifecycleChanged = finishTurn(tab, { failed, detail: failed ? message.params?.turn?.error?.message || 'Turn failed' : '', turnId: message.params?.turn?.id || null });
    } else if (message.method === 'turn/failed') {
      const error = message.params?.error;
      lifecycleChanged = finishTurn(tab, { failed: true, detail: typeof error === 'string' ? error : error?.message || message.params?.message || 'Turn failed', turnId: message.params?.turnId || null });
    }
    if (lifecycleChanged) {
      touch(tab, connection.attempt);
      commit('lifecycle');
    } else if (activityChanged) {
      touch(tab, connection.attempt);
      scheduleActivityFlush();
    }
    return { tab, lifecycleChanged, activityChanged };
  }

  function stashDraft() {
    const tab = activeTab();
    if (tab && view.isSession?.()) tab.draft = draft.read?.() || '';
  }

  function select(key, options = {}) {
    const tab = state.tabs.find((candidate) => candidate.key === key);
    if (!tab) return null;
    stashDraft();
    markViewed(tab);
    const wasSession = !!view.isSession?.();
    state.active = key;
    state.mobilePane = 'session';
    shell.closeSurface?.(false);
    if (options.history !== 'none') shell.writeHistory?.(tab, wasSession || options.history === 'replace' ? 'replace' : 'push');
    if (tab.ephemeral) shell.openEphemeral?.(tab);
    else shell.openThread?.(tab.deviceId, tab.threadId, tab.title);
    draft.write?.(tab.draft || '');
    draft.resize?.();
    commit('select');
    return tab;
  }

  function openThreadTab(deviceId, threadId, title, options = {}) {
    const key = tabKeyFor(deviceId, threadId);
    let tab = state.tabs.find((candidate) => candidate.key === key);
    if (!tab) {
      tab = normalizeTab({ key, deviceId, threadId, title: title || 'Session', ephemeral: false, lastActivityAt: now() });
      const connection = connectionFor(deviceId);
      const snapshot = connection?.threads?.find((thread) => thread.id === threadId);
      if (snapshot) {
        applyStatus(tab, snapshot.status || (snapshot.mockStatus ? { type: snapshot.mockStatus } : null), { detail: snapshot.mockActivity });
        tab.lastActivityAt = view.timestampOf?.(snapshot) || tab.lastActivityAt;
        tab.lastActivityTail = snapshot.mockActivity || snapshot.preview || tab.lastActivityTail;
        if (snapshot.mockUnread != null) tab.unread = Number(snapshot.mockUnread) || 0;
      }
      state.tabs.push(tab);
    } else if (title) tab.title = title;
    return select(key, options);
  }

  function newTab() {
    if (state.mode !== 'normal') return null;
    if (!state.devices.length) { shell.showUnpaired?.(); return null; }
    const existing = state.tabs.find((tab) => tab.ephemeral);
    if (existing) { shell.navigate?.(() => select(existing.key)); shell.focusComposerSoon?.(); return existing; }
    const connected = state.devices.filter((device) => connectionFor(device.id)?.status === 'connected');
    const deviceId = state.devices.length === 1 ? state.devices[0].id : connected.length === 1 ? connected[0].id : null;
    const tab = normalizeTab({ key: `new-${++state.newN}`, deviceId, threadId: null, title: 'New session', ephemeral: true, lastActivityAt: now() });
    state.tabs.push(tab);
    shell.navigate?.(() => select(tab.key));
    shell.focusComposerSoon?.();
    return tab;
  }

  function close(key) {
    const index = state.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return false;
    const wasActive = state.active === key;
    state.tabs.splice(index, 1);
    if (wasActive) {
      state.active = null;
      if (view.isSession?.()) {
        if (state.tabs.length) {
          select(state.tabs[Math.min(index, state.tabs.length - 1)].key, { history: 'replace' });
          shell.focusSelectedTab?.();
          return true;
        }
        shell.clearHistory?.();
        shell.showHome?.();
        commit('close-last');
        shell.focusHome?.();
        return true;
      }
      state.active = state.tabs[Math.min(index, state.tabs.length - 1)]?.key || null;
    }
    commit('close');
    return true;
  }

  function beginLocalTurn(tab, attempt) {
    tab.lastTurnActive = true;
    tab.waitingForUser = false;
    tab.turnStartedAt = now();
    tab.lastActivityAt = now();
    tab.lastActivityTail = 'Starting turn…';
    tab.turnError = '';
    tab.unreadForTurn = false;
    tab.activeTurnId = null;
    tab.terminalWithoutId = false;
    tab.draft = '';
    touch(tab, attempt);
    commit('turn-start');
  }

  function acknowledgeLocalTurn(tab, turnId) {
    if (!turnId || !tab.lastTurnActive || tab.activeTurnId) return false;
    tab.activeTurnId = turnId;
    touch(tab);
    commit('turn-acknowledged');
    return true;
  }

  function failLocalTurn(tab, error, attempt) {
    tab.lastTurnActive = false;
    tab.turnStartedAt = null;
    tab.turnError = error?.message || String(error);
    tab.lastActivityAt = now();
    touch(tab, attempt);
    commit('turn-failed');
  }

  function materialized(tab, { deviceId = tab.deviceId, threadId, title }) {
    tab.deviceId = deviceId;
    tab.threadId = threadId;
    tab.ephemeral = false;
    tab.title = title || 'New session';
    tab.key = tabKeyFor(deviceId, threadId);
    state.active = tab.key;
    commit('materialized');
    return tab;
  }

  function reconcileReadStatus(tab, value, { baselineRevision, attempt } = {}) {
    if ((tab.lifecycleRevision || 0) !== baselineRevision) return false;
    if (value?.type === 'idle' && tab.lastTurnActive) return false;
    if (!applyStatus(tab, value)) return false;
    touch(tab, attempt);
    commit('read-status');
    return true;
  }

  function syncSnapshots(connection, threads, baseline = new Map(state.tabs.map((tab) => [tab.key, tab.lifecycleRevision || 0]))) {
    for (const tab of state.tabs) {
      if (tab.deviceId !== connection.dev.id || !tab.threadId) continue;
      const thread = threads.find((candidate) => candidate.id === tab.threadId);
      if (!thread) continue;
      if (thread.name) tab.title = thread.name;
      else if (thread.preview && (!tab.title || tab.title === 'Session')) tab.title = thread.preview;
      const updated = view.timestampOf?.(thread) || 0;
      if (updated) tab.lastActivityAt = Math.max(tab.lastActivityAt || 0, updated);
      const value = thread.status || (thread.mockStatus ? { type: thread.mockStatus } : null);
      const staleIdle = value?.type === 'idle' && tab.lastTurnActive;
      if (baseline.get(tab.key) === (tab.lifecycleRevision || 0) && !staleIdle) {
        applyStatus(tab, value, { detail: thread.mockActivity });
        if (tab.lastTurnActive && LIVE_STATUS_TYPES.has(value?.type)) touch(tab, connection.attempt);
        if (thread.mockUnread != null) tab.unread = Number(thread.mockUnread) || 0;
      }
    }
    commit('snapshot');
  }

  function forgetDevice(deviceId) {
    const activeGone = activeTab()?.deviceId === deviceId;
    state.tabs = state.tabs.filter((tab) => tab.deviceId !== deviceId);
    if (activeGone) state.active = null;
    commit('forget-device');
    return activeGone;
  }

  function visibleTabs(capacity) {
    if (capacity >= state.tabs.length) return { visible: state.tabs.slice(), hidden: [] };
    const visible = state.tabs.slice(0, Math.max(1, capacity));
    if (view.isSession?.()) {
      const active = activeTab();
      if (active && !visible.includes(active)) visible[visible.length - 1] = active;
    }
    return { visible, hidden: state.tabs.filter((tab) => !visible.includes(tab)) };
  }

  function destroy() {
    if (activityFlushTimer) timers.clearTimeout(activityFlushTimer);
    activityFlushTimer = null;
  }

  return {
    activeTab, restore, persist, status, snapshotStatus, activity, markViewed,
    notify, stashDraft, select, openThreadTab, newTab, close, beginLocalTurn,
    acknowledgeLocalTurn, failLocalTurn, materialized, reconcileReadStatus,
    syncSnapshots, forgetDevice,
    visibleTabs, destroy,
  };
}
