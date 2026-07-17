import { makeRpc } from './rpc.js';
import { renderMarkdown } from './markdown.js';
import { $, el, haptic, hapticize, layout, navigate } from './platform.js';
import { createDeviceRegistry, deviceLabel } from './devices.js';
import { createThreadCache } from './thread-cache.js';
import { relativeTime, short } from './utils.js';
import { createAppState, tabKeyFor } from './state.js';
import { createTabStore } from './tab-store.js';
import { createConnectionPool } from './connections.js';
import { createViewPrimitives } from './view-primitives.js';
import { createWorkspaceTabs } from './workspace-tabs.js';
import { createWorkspaceView } from './workspace-view.js';
import { createThreadSync, timestampOf } from './thread-sync.js';
import { createMachineUI } from './machine-ui.js';
import { createChatController } from './chat-controller.js';
import { createContextPanel } from './context-panel.js';
import { createHomeShell } from './home-shell.js';
import { ICONS, icon } from './icons.js';

const params = new URLSearchParams(location.search);
const requestedMock = params.has('mock');
const mockTransport = requestedMock ? await import('./mock.js').catch(() => null) : null;
const mock = !!mockTransport;
const railMock = mock && params.has('rail');
const { connect, installAgent, NoSupportedAgentError } = mockTransport || await import('./transport.js');

const state = createAppState();
const views = createViewPrimitives({ icon });
const devices = createDeviceRegistry({ mock, state });
const cache = createThreadCache({ mock });
const tabsStore = createTabStore({ state, tabKeyFor });
const connFor = (id) => state.conns.get(id);

// Controllers are late-bound because transport, workspace, and shell callbacks
// form real runtime cycles. Forwarders keep every callback stable while factories
// are constructed in ownership order.
const slots = {
  pool: null, tabs: null, workspaceView: null, threadSync: null,
  machine: null, chat: null, context: null, home: null,
};
const call = (slot, method, ...args) => slots[slot]?.[method]?.(...args);

const connectionPool = slots.pool = createConnectionPool({
  state, connect, makeRpc, NoSupportedAgentError,
  updateDevice: devices.updateDevice,
  onNotify: (...args) => call('chat', 'onNotify', ...args),
  loadThreads: (...args) => call('threadSync', 'loadThreads', ...args),
  openThread: (...args) => call('chat', 'openThread', ...args),
  inChat: () => !!state.threadId,
  renderConnection: (...args) => call('threadSync', 'renderConnection', ...args),
});

const workspaceTabs = slots.tabs = createWorkspaceTabs({
  state,
  tabKeyFor,
  connectionFor: connFor,
  persistence: { persist: tabsStore.persist, restore: tabsStore.restore },
  draft: {
    read: () => $('#input')?.value || '',
    write: (value) => { if ($('#input')) $('#input').value = value; },
    resize: () => call('chat', 'autoResize'),
  },
  view: {
    isTabViewed: (tab) => call('workspaceView', 'isTabViewed', tab),
    isSession: () => state.screen === 'session',
    isHome: () => state.screen === 'home',
    renderStripAndRail: () => call('workspaceView', 'render'),
    renderHome: () => call('home', 'renderHome'),
    activeProjectionActivity: () => call('workspaceView', 'activeProjectionActivity'),
    timestampOf,
  },
  shell: {
    closeSurface: (...args) => call('machine', 'closeSurface', ...args),
    writeHistory: (tab, kind) => {
      const entry = tab.ephemeral
        ? { ephemeral: true, tabKey: tab.key }
        : { deviceId: tab.deviceId, threadId: tab.threadId, title: tab.title };
      history[kind === 'replace' ? 'replaceState' : 'pushState'](entry, '');
    },
    clearHistory: () => history.replaceState(null, ''),
    openThread: (...args) => call('chat', 'openThread', ...args),
    openEphemeral: (tab) => {
      Object.assign(state, { threadId: null, threadDeviceId: tab.deviceId, threadTitle: '', projection: null, turnActive: false });
      call('home', 'showScreen', 'session');
      call('workspaceView', 'renderEphemeral', tab);
      call('context', 'render');
    },
    showHome: () => call('home', 'showHome'),
    showUnpaired: () => call('home', 'showUnpaired'),
    navigate,
    focusComposerSoon: () => setTimeout(() => $('#input')?.focus(), 60),
    focusSelectedTab: () => document.querySelector('.wtab-main[aria-selected="true"]')?.focus(),
    focusHome: () => $('#home-btn')?.focus(),
  },
});

const workspaceView = slots.workspaceView = createWorkspaceView({
  state,
  dom: { $, el, icon },
  layout,
  navigate,
  haptic,
  deviceLabel,
  connectionFor: connFor,
});

const threadSync = slots.threadSync = createThreadSync({
  state, tabKeyFor, cache, railMock,
});

const machineUI = slots.machine = createMachineUI({
  model: { getState: () => state, connFor, activeTab: workspaceTabs.activeTab },
  persistence: {
    updateDevice: devices.updateDevice,
    persistDevices: devices.persistDevices,
    persistTabs: tabsStore.persist,
    purgeThreadCache: cache.purgeDevice,
  },
  connection: {
    connectDevice: connectionPool.connectDevice,
    dropConnection: connectionPool.dropConnection,
    reconnect: connectionPool.reconnect,
    markConnection: connectionPool.markConnection,
    installAgent,
  },
  workspace: {
    renderSessions: () => call('home', 'renderHome'),
    renderStrip: workspaceView.render,
    renderSessionChrome: () => call('context', 'render'),
    showHome: () => call('home', 'showHome'),
    showUnpaired: () => call('home', 'showUnpaired'),
    renderEphemeral: workspaceView.renderEphemeral,
    forgetDevice: workspaceTabs.forgetDevice,
    openDetailsContext: (dev) => {
      const tab = workspaceTabs.activeTab();
      if (state.screen !== 'session' || tab?.ephemeral || tab?.deviceId !== dev.id) return false;
      state.ctxTab = 'details'; state.ctxOpen = true; call('context', 'render'); return true;
    },
  },
  view: { icon, toast: views.toast },
});

const chatController = slots.chat = createChatController({
  state,
  dom: { $, el, icon, renderMarkdown, stateBox: views.stateBox },
  connections: { connFor, deviceLabel },
  cache,
  workspace: {
    activeTab: workspaceTabs.activeTab,
    notify: workspaceTabs.notify,
    beginLocalTurn: workspaceTabs.beginLocalTurn,
    acknowledgeLocalTurn: workspaceTabs.acknowledgeLocalTurn,
    failLocalTurn: workspaceTabs.failLocalTurn,
    materialized: workspaceTabs.materialized,
    reconcileReadStatus: workspaceTabs.reconcileReadStatus,
    tabKeyFor,
    showSession: () => call('home', 'showScreen', 'session'),
    renderEphemeral: workspaceView.renderEphemeral,
    renderContextSoon: () => call('context', 'renderBodySoon'),
    replaceThreadHistory: (tab) => history.replaceState({ deviceId: tab.deviceId, threadId: tab.threadId, title: tab.title }, ''),
    refreshThreads: threadSync.refreshThreads,
    renderSessionChrome: () => call('context', 'render'),
  },
  effects: { haptic, hapticize, toast: views.toast },
});

const contextPanel = slots.context = createContextPanel({
  state,
  activeTab: workspaceTabs.activeTab,
  connFor,
  icon,
  openMachineActions: machineUI.openMachineActions,
  renderMachinePill: workspaceView.renderMachinePill,
  renderMachineSelect: machineUI.renderMachineSelect,
  renderEphemeral: workspaceView.renderEphemeral,
  updateComposer: chatController.updateComposer,
  updateJump: chatController.updateJump,
  renderStrip: workspaceView.render,
  tabIsViewed: workspaceView.isTabViewed,
  markTabViewed: workspaceTabs.markViewed,
  persistTabs: tabsStore.persist,
});

const homeShell = slots.home = createHomeShell({
  state, mock, tabKeyFor,
  machine: {
    deviceLabel,
    loadDevices: devices.loadDevices,
    persistDevices: devices.persistDevices,
    updateDevice: devices.updateDevice,
    upsertFromFragment: devices.upsertFromFragment,
    loadThreadCache: cache.load,
    connectAllDevices: connectionPool.connectAllDevices,
    connectDevice: connectionPool.connectDevice,
    dropConnection: connectionPool.dropConnection,
    reconnect: connectionPool.reconnect,
  },
  workspace: {
    restoreTabs: workspaceTabs.restore,
    renderStrip: workspaceView.render,
    renderSessionChrome: contextPanel.render,
    renderChips: machineUI.renderChips,
    openTabForThread: workspaceTabs.openThreadTab,
    selectTab: workspaceTabs.select,
    newSessionTab: workspaceTabs.newTab,
    closeTab: workspaceTabs.close,
    tabStatus: workspaceTabs.status,
    threadSnapshotStatus: workspaceTabs.snapshotStatus,
    tabActivity: workspaceTabs.activity,
    tabIsViewed: workspaceView.isTabViewed,
    markTabViewed: workspaceTabs.markViewed,
    persistTabs: workspaceTabs.persist,
  },
  context: { closeSurface: machineUI.closeSurface },
  chat: { stashDraft: workspaceTabs.stashDraft },
  ui: { $, el, icon, icons: ICONS, stateBox: views.stateBox, toast: views.toast, navigate, haptic, hapticize, relativeTime, short },
});

workspaceView.bind({
  tabs: workspaceTabs,
  chat: chatController,
  machine: machineUI,
  shell: { showHome: homeShell.showHome },
  surface: { openMenu: machineUI.openMenu, close: machineUI.closeSurface },
});
threadSync.bindAdapters({
  workspace: {
    activeTab: workspaceTabs.activeTab,
    syncSnapshots: workspaceTabs.syncSnapshots,
    persistTabs: workspaceTabs.persist,
    selectTab: workspaceTabs.select,
  },
  views: {
    renderChips: machineUI.renderChips,
    renderRail: workspaceView.renderRail,
    renderHome: homeShell.renderHome,
    renderMachinePill: workspaceView.renderMachinePill,
    renderEphemeral: workspaceView.renderEphemeral,
    renderContextSoon: contextPanel.renderBodySoon,
    renderThreadTitle: (title) => { $('#chat-title').textContent = title; },
    updateComposer: chatController.updateComposer,
    scheduleChat: chatController.scheduleRender,
  },
});

chatController.bind();
const onGlobalKeydown = (event) => {
  if (machineUI.handleKeydown(event)) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const role = event.target.getAttribute?.('role');
  if (role !== 'tab' && role !== 'radio') return;
  const list = event.target.closest('[role="tablist"], [role="radiogroup"]');
  const items = list ? [...list.querySelectorAll(`[role="${role}"]`)].filter((node) => !node.disabled) : [];
  let index = items.indexOf(event.target); if (index < 0) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft') index = (index - 1 + items.length) % items.length;
  else if (event.key === 'ArrowRight') index = (index + 1) % items.length;
  else index = event.key === 'Home' ? 0 : items.length - 1;
  items[index]?.focus();
};
document.addEventListener('keydown', onGlobalKeydown);

await homeShell.boot();

let cleaned = false;
window.addEventListener('pagehide', () => {
  if (cleaned) return; cleaned = true;
  document.removeEventListener('keydown', onGlobalKeydown);
  homeShell.dispose();
  contextPanel.destroy();
  chatController.dispose();
  machineUI.destroy();
  workspaceView.destroy();
  workspaceTabs.destroy();
  connectionPool.destroy();
  views.destroy();
}, { once: true });
