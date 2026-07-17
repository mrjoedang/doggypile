import { createSessionRail } from './rail.js?v=20260716-workspace-view';

/**
 * Session Workspace view adapter.
 *
 * Responsibility: owns the DOM presentation of the open-session workspace:
 * desktop strip/overflow/tab nodes and status dots, the composed mobile rail
 * and its scrub navigation, ephemeral-session canvas, the intentionally quiet
 * machine status pill, tab viewability, and live projection activity text.
 *
 * Owned state: hidden desktop tabs, the lazily-created rail, and the current
 * late-bound adapter table. `destroy()` releases the rail and owned listeners.
 * Shared app/tab/chat/context/machine state remains owned by their modules.
 *
 * Dependencies: `state`; DOM helpers (`$`, `el`, `icon`); layout/navigation and
 * haptic effects; device/connection readers; and late-bound `tabs`, `chat`,
 * `machine`, `shell`, and `surface` adapters. Call `bind()` after circular
 * factories exist. Every callback is looked up at invocation time.
 *
 * Returned interface: bind(), render(), renderRail(), renderEphemeral(),
 * renderMachinePill(), isTabViewed(), activeProjectionActivity(),
 * hiddenTabs(), relayout(), and destroy().
 *
 * Invariants: mobile uses only the rail; desktop registry order is stable and
 * the active tab remains visible; tab ARIA/focus semantics and Home history
 * replacement match the integrated app; scrub cancellation restores the exact
 * chat preview; this module asks the tabs adapter for visibility and lifecycle
 * actions rather than reproducing tab policy.
 *
 * Non-responsibilities: creating/selecting/closing/materializing tabs,
 * unread/status/lifecycle policy, chat hydration/rendering, machine menus,
 * context panes, persistence, transport, and Home session-list rendering.
 */
export function createWorkspaceView({
  state,
  dom: { $, el, icon },
  layout,
  navigate = (fn) => fn(),
  haptic = () => {},
  deviceLabel = () => '',
  connectionFor = () => null,
  adapters = {},
} = {}) {
  if (!state || !$ || !el || !icon || !layout) throw new TypeError('workspace view requires state, dom helpers, and layout');

  let bound = { ...adapters };
  let hidden = [];
  let rail = null;
  const call = (group, method, ...args) => bound[group]?.[method]?.(...args);
  const activeTab = () => call('tabs', 'activeTab') || state.tabs.find((tab) => tab.key === state.active) || null;

  function bind(next = {}) {
    for (const [key, value] of Object.entries(next)) {
      bound[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(bound[key] || {}), ...value } : value;
    }
    return api;
  }

  function activeProjectionActivity() {
    return formatProjectionActivity(state.projection);
  }

  function isTabViewed(tab) {
    return state.screen === 'session' && state.active === tab?.key && !document.hidden
      && (layout() !== 'mobile' || state.mobilePane === 'session');
  }

  function renderMachinePill() {
    const pill = $('#chat-machine');
    if (pill) pill.hidden = true;
  }

  function renderEphemeral(tab) {
    if (state.screen !== 'session' || activeTab() !== tab) return;
    const hero = el('div', 'newsess view');
    hero.append(icon('paw', 'icon newsess-paw'), el('div', 'newsess-word', 'doggypile'));
    $('#main').replaceChildren(hero);
    call('machine', 'renderMachineSelect', tab);
    call('chat', 'updateComposer');
  }

  function ensureRail() {
    if (rail) return rail;
    rail = createSessionRail({
      mount: $('#sessionview'),
      getStatus: (tab) => call('tabs', 'status', tab),
      getMachine: (tab) => deviceLabel(state.devices.find((device) => device.id === tab.deviceId)),
      getActivity: (tab) => call('tabs', 'activity', tab),
      getExcerpt: (tab) => call('chat', 'railExcerpt', tab) || [],
      onPreviewStart: () => call('chat', 'beginRailPreview'),
      onPreview: (tab, direction) => call('chat', 'previewRailTab', tab, direction),
      onCommit: (tab) => {
        if (tab.key === state.active) {
          call('chat', 'endRailPreview', true);
          call('tabs', 'markViewed', tab);
          call('tabs', 'persist');
          render();
          return;
        }
        call('chat', 'endRailPreview', false);
        call('tabs', 'select', tab.key);
      },
      onCancel: () => call('chat', 'endRailPreview', true),
      onTap: (tab) => {
        if (tab.key === state.active) return;
        call('chat', 'endRailPreview', false);
        navigate(() => call('tabs', 'select', tab.key));
      },
      onHome: () => {
        call('chat', 'endRailPreview', false);
        navigate(() => {
          call('shell', 'showHome');
          if (history.state?.threadId || history.state?.ephemeral) history.replaceState(null, '');
        });
      },
      onTick: haptic,
    });
    return rail;
  }

  function renderRail() {
    ensureRail().update({
      visible: state.mode === 'normal' && state.screen === 'session' && layout() === 'mobile' && state.mobilePane === 'session',
      tabs: state.tabs,
      activeKey: state.active,
    });
  }

  function tabDot(tab) {
    const status = call('tabs', 'status', tab);
    const dot = el('span', `sdot tab-${status}`);
    dot.dataset.s = connectionFor(tab.deviceId)?.status || 'connecting';
    dot.dataset.tabStatus = status;
    return dot;
  }

  function tabElement(tab) {
    const active = state.screen === 'session' && state.active === tab.key;
    const wrap = el('div', 'wtab');
    wrap.setAttribute('role', 'presentation');
    wrap.dataset.active = String(active);
    if (tab.ephemeral) wrap.dataset.eph = 'true';
    const main = el('button', 'wtab-main');
    main.setAttribute('role', 'tab');
    main.setAttribute('aria-selected', String(active));
    main.tabIndex = active || (state.screen === 'home' && state.tabs[0] === tab) ? 0 : -1;
    main.append(tab.ephemeral ? icon('compose', 'icon tabicon') : tabDot(tab), el('span', 'wtab-title', tab.title || 'Session'));
    main.onclick = () => {
      if (state.screen === 'session' && state.active === tab.key) return;
      navigate(() => call('tabs', 'select', tab.key));
    };
    const close = el('button', 'wtab-close');
    close.setAttribute('aria-label', `Close ${tab.title || 'session'}`);
    close.tabIndex = -1;
    close.innerHTML = icon('close').innerHTML;
    close.onclick = (event) => { event.stopPropagation(); call('tabs', 'close', tab.key); };
    wrap.append(main, close);
    return wrap;
  }

  function openOverflow(anchor) {
    anchor.setAttribute('aria-expanded', 'true');
    call('surface', 'openMenu', anchor, 'More open sessions', (box) => {
      for (const tab of hidden) {
        const item = el('button', 'menu-item');
        item.setAttribute('role', 'menuitem');
        if (tab.ephemeral) item.append(icon('compose', 'icon tabicon'));
        item.append(el('span', 'mi-title', tab.title || 'Session'));
        const device = state.devices.find((candidate) => candidate.id === tab.deviceId);
        if (device) item.append(el('span', 'mi-side', deviceLabel(device)));
        item.onclick = () => {
          call('surface', 'close', false);
          navigate(() => call('tabs', 'select', tab.key));
        };
        box.append(item);
      }
    });
  }

  function render() {
    const home = $('#home-btn');
    if (state.screen === 'home') home.setAttribute('aria-current', 'page');
    else home.removeAttribute('aria-current');
    $('#tab-new').hidden = state.mode !== 'normal';
    const toggle = $('#ctx-toggle');
    toggle.hidden = !(state.screen === 'session' && layout() !== 'mobile' && !activeTab()?.ephemeral);
    toggle.setAttribute('aria-pressed', String(state.ctxOpen));

    const tabsElement = $('#wtabs');
    const newButton = $('#tab-new');
    tabsElement.replaceChildren(newButton);
    hidden = [];
    renderRail();
    if (layout() === 'mobile' || !state.tabs.length || state.mode !== 'normal') return;

    const available = Math.max(0, tabsElement.clientWidth - newButton.offsetWidth - 4);
    const tabWidth = 184;
    let capacity = Math.max(1, Math.floor((available + 4) / tabWidth));
    if (capacity < state.tabs.length) capacity = Math.max(1, Math.floor((available - 48 + 4) / tabWidth));
    const partition = call('tabs', 'visibleTabs', capacity) || { visible: state.tabs.slice(0, capacity), hidden: state.tabs.slice(capacity) };
    hidden = partition.hidden;
    for (const tab of partition.visible) tabsElement.insertBefore(tabElement(tab), newButton);
    if (!hidden.length) return;
    const more = el('button', 'wtab-more');
    more.id = 'tabmore';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', `${hidden.length} more open session${hidden.length > 1 ? 's' : ''}`);
    more.append(icon('dots', 'icon tabicon'), document.createTextNode(`+${hidden.length}`));
    more.onclick = () => openOverflow(more);
    tabsElement.insertBefore(more, newButton);
  }

  function relayout() { render(); rail?.relayout(); }
  function destroy() { rail?.destroy(); rail = null; hidden = []; }

  const api = { bind, render, renderRail, renderEphemeral, renderMachinePill, isTabViewed,
    activeProjectionActivity, hiddenTabs: () => hidden.slice(), relayout, destroy };
  return api;
}

export function formatProjectionActivity(projection) {
  const messages = projection?.toRenderList?.() || [];
  const message = messages.slice().reverse().find((item) =>
    (item.kind === 'command' && (item.status || 'running') === 'running')
    || (item.role === 'assistant' && item.text));
  if (!message) return '';
  if (message.kind === 'command') return message.command ? `$ ${message.command}` : 'Running a command…';
  const tail = (message.text || '').trim().split('\n').pop()?.replace(/\s+/g, ' ') || '';
  return tail.length > 72 ? `…${tail.slice(-72)}` : tail;
}
