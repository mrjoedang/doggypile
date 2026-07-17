const LIVE_SNAPSHOT_TYPES = new Set(['active', 'busy', 'working', 'needs-you']);

/**
 * Daemon thread-list synchronization and connection-to-view coordinator.
 *
 * Responsibility: own `thread/list` request semantics, lifecycle-baseline
 * reconciliation, one-time rail-mock tab/cache seeding, connection render
 * fanout, and the thread-refresh callbacks consumed by connections and chat.
 *
 * Owned state: whether rail mock data has been seeded and the late-bound
 * adapter registry. Connection thread/loading/detail fields and synchronized
 * tab fields live in the injected app state but are mutated only by the rules
 * here (lifecycle transitions remain delegated to workspace-tabs).
 *
 * Dependencies: `state`, `tabKeyFor`, cache `put`, clock/history effects, and
 * late-bound `workspace`/`views` adapters. Late binding intentionally permits
 * connections, chat, workspace, and view factories to be composed without an
 * import or construction cycle.
 *
 * Returned interface: `loadThreads`, its `refreshThreads` alias,
 * `renderConnection`, `bindAdapters`, and `isRailMockSeeded`.
 *
 * Invariants:
 * - at most one thread/list request is in flight per connection;
 * - lifecycle changes observed during a list request beat its snapshot;
 * - a list snapshot reporting idle never ends a tab already known live;
 * - names/timestamps still reconcile when lifecycle data is stale;
 * - rail mock seeds once, in daemon order, and seeds matching cache entries;
 * - persistence precedes render fanout.
 *
 * Non-responsibilities: dialing/backoff/transport (connections.js), tab
 * creation/selection and lifecycle policy (workspace-tabs), chat hydration or
 * notifications (chat-controller), and actual DOM/view rendering (adapters).
 */
export function createThreadSync({
  state,
  tabKeyFor = (deviceId, threadId) => `${deviceId}:${threadId}`,
  cache,
  railMock = false,
  now = () => Date.now(),
  history = globalThis.history,
  workspace: initialWorkspace,
  views: initialViews,
} = {}) {
  if (!state?.tabs || !state?.devices) throw new TypeError('thread sync requires app state');
  if (!cache?.put) throw new TypeError('thread sync requires cache.put');

  const adapters = { workspace: initialWorkspace || {}, views: initialViews || {} };
  let railMockSeeded = false;

  function bindAdapters({ workspace, views } = {}) {
    if (workspace) Object.assign(adapters.workspace, workspace);
    if (views) Object.assign(adapters.views, views);
    return api;
  }

  function renderConnection(connection) {
    const views = adapters.views;
    views.renderChips?.();
    views.renderRail?.();
    if (state.screen === 'home') views.renderHome?.();
    if (state.screen !== 'session') return;
    const tab = activeTab();
    if (tab?.deviceId !== connection.dev.id) return;
    views.renderMachinePill?.();
    if (tab.ephemeral) views.renderEphemeral?.(tab);
    views.renderContextSoon?.();
  }

  async function loadThreads(connection) {
    if (connection.threadsLoading || !connection.rpc) return;
    connection.threadsLoading = true;
    const baseline = new Map(state.tabs.map((tab) => [tab.key, tab.lifecycleRevision || 0]));
    try {
      const response = await connection.rpc.request('thread/list', {});
      connection.threads = response?.data || [];
    } catch (error) {
      connection.threads = connection.threads || [];
      connection.lastDetail = `couldn’t list sessions: ${error?.message || error}`;
    } finally {
      connection.threadsLoading = false;
    }

    reconcile(connection, baseline);
    seedRailMock(connection);
    adapters.workspace.persistTabs?.();
    renderThreadRefresh(connection);
  }

  function reconcile(connection, baseline) {
    const workspace = adapters.workspace;
    for (const operation of planThreadReconciliation(state.tabs, connection.threads || [], connection.dev.id, baseline, timestampOf)) {
      const { tab, thread } = operation;
      if (operation.title !== undefined) tab.title = operation.title;
      if (operation.updated) tab.lastActivityAt = Math.max(tab.lastActivityAt || 0, operation.updated);
      if (!operation.applyLifecycle) continue;
      workspace.applyStatus?.(tab, operation.status, { detail: thread.mockActivity });
      if (tab.lastTurnActive && LIVE_SNAPSHOT_TYPES.has(operation.status?.type)) {
        workspace.touchLifecycle?.(tab, connection.attempt);
      }
      if (thread.mockUnread != null) tab.unread = Number(thread.mockUnread) || 0;
    }
  }

  function seedRailMock(connection) {
    if (!railMock || railMockSeeded || connection.dev.id !== state.devices[0]?.id || !connection.threads?.length) return;
    railMockSeeded = true;
    const at = now();
    for (const [index, thread] of connection.threads.slice(0, 6).entries()) {
      const deviceId = index === 3 && state.devices[1] ? state.devices[1].id : connection.dev.id;
      const key = tabKeyFor(deviceId, thread.id);
      if (state.tabs.some((tab) => tab.key === key)) continue;
      const mockStatus = thread.mockStatus || (index === 0 ? 'working' : index === 2 ? 'needs-you' : 'idle');
      state.tabs.push({
        key, deviceId, threadId: thread.id, title: thread.name || thread.preview || 'Session', ephemeral: false,
        lastTurnActive: mockStatus === 'working', unread: thread.mockUnread ?? (mockStatus === 'needs-you' ? 2 : 0),
        waitingForUser: mockStatus === 'needs-you',
        turnStartedAt: mockStatus === 'working' ? at - (index + 2) * 60_000 : null,
        lastActivityAt: timestampOf(thread) || at - index * 60_000,
        lastActivityTail: thread.mockActivity || (mockStatus === 'working' ? 'Running checks…' : ''), draft: '',
        turnError: mockStatus === 'error' ? (thread.mockActivity || 'Mock turn failed') : '',
      });
      cache.put(key, { id: thread.id, turns: [{ items: [
        { type: 'userMessage', id: `mock-user-${thread.id}`, content: [{ type: 'text', text: 'Where did we leave off?' }] },
        { type: 'agentMessage', id: `mock-agent-${thread.id}`, text: thread.mockActivity || thread.preview || 'This session is ready to continue.' },
      ] }] });
    }
    if (!state.active && state.tabs.length) {
      const tab = state.tabs[0];
      state.active = tab.key;
      history?.replaceState?.({ deviceId: tab.deviceId, threadId: tab.threadId, title: tab.title }, '');
      adapters.workspace.selectTab?.(tab.key, { history: 'none' });
    }
  }

  function renderThreadRefresh(connection) {
    const views = adapters.views;
    views.renderChips?.();
    views.renderRail?.();
    if (state.screen === 'home') { views.renderHome?.(); return; }
    const tab = activeTab();
    if (!tab || tab.deviceId !== connection.dev.id || tab.threadId !== state.threadId) return;
    state.threadTitle = tab.title;
    state.turnActive = !!tab.lastTurnActive;
    views.renderThreadTitle?.(state.threadTitle || 'Session');
    views.updateComposer?.();
    views.scheduleChat?.();
    views.renderContextSoon?.();
  }

  const activeTab = () => adapters.workspace.activeTab?.()
    || state.tabs.find((tab) => tab.key === state.active) || null;
  const api = {
    bindAdapters,
    loadThreads,
    refreshThreads: loadThreads,
    renderConnection,
    get isRailMockSeeded() { return railMockSeeded; },
  };
  return api;
}

/** Convert daemon timestamps to sortable milliseconds. */
export function timestampOf(thread) {
  const raw = thread.updatedAt || thread.recencyAt;
  if (!raw) return 0;
  const value = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(value) ? (value < 10_000_000_000 ? value * 1000 : value) : 0;
}

/**
 * Pure, tab-ordered reconciliation plan. Metadata is always planned; lifecycle
 * application is suppressed by a changed baseline or stale-idle protection.
 */
export function planThreadReconciliation(tabs, threads, deviceId, baseline, timestamp = timestampOf) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const operations = [];
  for (const tab of tabs) {
    if (tab.deviceId !== deviceId || !tab.threadId) continue;
    const thread = byId.get(tab.threadId);
    if (!thread) continue;
    const title = thread.name || (thread.preview && (!tab.title || tab.title === 'Session') ? thread.preview : undefined);
    const status = thread.status || (thread.mockStatus ? { type: thread.mockStatus } : null);
    const lifecycleUnchanged = baseline.get(tab.key) === (tab.lifecycleRevision || 0);
    const staleIdleDuringLiveTurn = status?.type === 'idle' && tab.lastTurnActive;
    operations.push({ tab, thread, title, updated: timestamp(thread), status,
      applyLifecycle: lifecycleUnchanged && !staleIdleDuringLiveTurn });
  }
  return operations;
}
