import { $, el, haptic, hapticize, layout, navigate } from './platform.js?v=20260716-modules';
import { deviceLabel } from './devices.js?v=20260716-modules';
import { relativeTime as rel } from './utils.js?v=20260716-modules';

/**
 * Machine UI factory.
 *
 * Responsibility: owns machine chips and destination menus, machine gestures,
 * machine action/detail surfaces, rename/forget/pair flows, and remote-agent
 * installation confirmation and progress UI.
 *
 * Owned state: the current overlay surface (including focus restoration and
 * modality) and all per-node long-press gesture state/timers. `destroy()`
 * releases both. Device, connection, tab, filter, and history state remain in
 * the host and are read through `model` or changed through adapters.
 *
 * Injected dependencies:
 * - model: getState(), connFor(id), activeTab()
 * - persistence: updateDevice, persistDevices, persistTabs, purgeThreadCache
 * - connection: connectDevice, dropConnection, reconnect, markConnection,
 *   installAgent
 * - workspace: renderSessions, renderStrip, renderSessionChrome, showHome,
 *   showUnpaired, openDetailsContext (optional; returns true when handled)
 * - view: icon, toast
 *
 * Returned interface: renderChips(), renderMachineSelect(tab),
 * openMachineSelect(tab, anchor), openMachineActions(dev, anchor),
 * machineDetails(dev), pairDialog(), installOnConnection(conn),
 * closeSurface(), hasSurface(), handleKeydown(event), destroy().
 *
 * Invariants: only one surface exists; chained surfaces retain the original
 * trigger; modal focus cannot escape; disconnected machines cannot be send
 * destinations; a long press suppresses its compatibility click; persistence
 * and transport changes happen only through injected adapters.
 *
 * Non-responsibilities: transport/retry policy, durable storage, workspace or
 * tab lifecycle, context rendering, chat/send behavior, and history routing.
 */
export function createMachineUI({ model, persistence, connection, workspace, view }) {
  const { icon, toast } = view;
  let surface = null;
  const gestureCleanups = new Set();
  const state = () => model.getState();
  const connFor = (id) => model.connFor(id);
  const repaint = () => {
    renderChips();
    workspace.renderSessions();
    workspace.renderStrip();
    if (state().screen === 'session') workspace.renderSessionChrome();
  };

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
      box = el('div', `modal-dialog${kind === 'alert' ? ' modal-action' : ''}`);
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
    (box.querySelector('[autofocus]') || box.querySelector('input, textarea') || box.querySelector('button'))?.focus();
  }

  function attachLongPress(node, fn) {
    let timer = null, fired = false, dragged = false, startX = 0, startY = 0, pointerId = null;
    const cancel = () => clearTimeout(timer);
    const start = (e) => {
      fired = dragged = false;
      startX = e.clientX; startY = e.clientY; pointerId = e.pointerId;
      timer = setTimeout(() => { fired = true; haptic(); fn(); }, 480);
    };
    const move = (e) => {
      if (e.pointerId !== pointerId || dragged || Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
      dragged = true; cancel();
    };
    const pointerCancel = () => { dragged = true; cancel(); };
    const contextmenu = (e) => { e.preventDefault(); if (!fired && !dragged) fn(); };
    const click = (e) => {
      if (fired || dragged) { e.stopImmediatePropagation(); e.preventDefault(); }
      fired = dragged = false; pointerId = null;
    };
    const listeners = [['pointerdown', start], ['pointermove', move], ['pointerup', cancel], ['pointerleave', cancel], ['pointercancel', pointerCancel], ['contextmenu', contextmenu]];
    for (const [type, listener] of listeners) node.addEventListener(type, listener);
    node.addEventListener('click', click, true);
    const cleanup = () => {
      cancel();
      for (const [type, listener] of listeners) node.removeEventListener(type, listener);
      node.removeEventListener('click', click, true);
      gestureCleanups.delete(cleanup);
    };
    gestureCleanups.add(cleanup);
    return cleanup;
  }

  function renderChips() {
    const bar = $('#chips');
    if (!bar) return;
    for (const cleanup of [...gestureCleanups]) cleanup();
    const s = state();
    if (!s.devices.length || s.mode !== 'normal') { bar.hidden = true; return; }
    bar.hidden = false; bar.replaceChildren();
    const total = [...s.conns.values()].reduce((n, c) => n + (c.threads?.length || 0), 0);
    const all = el('button', 'chip-btn', 'All');
    all.setAttribute('aria-pressed', String(s.filter === 'all'));
    if (total) all.append(el('span', 'cnt', String(total)));
    all.onclick = () => {
      if (s.filter !== 'all') haptic();
      navigate(() => { s.filter = 'all'; renderChips(); workspace.renderSessions(); });
    };
    bar.append(all);
    for (const dev of s.devices) {
      const conn = connFor(dev.id), status = conn?.status || 'connecting';
      const chip = el('button', 'chip-btn');
      chip.setAttribute('aria-pressed', String(s.filter === dev.id));
      chip.dataset.offline = String(status === 'offline' || status === 'expired');
      const dot = el('span', 'sdot'); dot.dataset.s = status;
      chip.append(dot, document.createTextNode(deviceLabel(dev)));
      if (conn?.threads?.length) chip.append(el('span', 'cnt', String(conn.threads.length)));
      chip.onclick = () => chipTap(dev);
      attachLongPress(chip, () => openMachineActions(dev, chip));
      bar.append(chip);
    }
    const add = el('button', 'chip-btn chip-add');
    add.setAttribute('aria-label', 'Pair another machine'); add.append(icon('plus')); add.onclick = pairDialog;
    bar.append(add);
  }

  function chipTap(dev) {
    const conn = connFor(dev.id), status = conn?.status;
    if (status === 'offline') return reconnect(dev);
    if (status === 'expired') return toast(`Pairing with ${deviceLabel(dev)} expired — run doggypile pair there and re-scan the QR.`);
    if (status === 'noagent') return installOnConnection(conn);
    haptic();
    navigate(() => { const s = state(); s.filter = s.filter === dev.id ? 'all' : dev.id; renderChips(); workspace.renderSessions(); });
  }

  function reconnect(dev) {
    const conn = connFor(dev.id) || connection.connectDevice(dev);
    connection.reconnect(conn);
    toast(`Reconnecting to ${deviceLabel(dev)}…`);
  }

  function renderMachineSelect(tab) {
    const btn = $('#machine-btn');
    const dev = state().devices.find((d) => d.id === tab.deviceId);
    const conn = dev ? connFor(dev.id) : null, status = dev ? conn?.status || 'connecting' : 'none';
    const label = dev ? deviceLabel(dev) : 'Choose machine';
    const dot = el('span', 'sdot'); dot.dataset.s = status;
    btn.replaceChildren(dot, el('span', 'machine-name', label), icon('chevronDown', 'icon machine-chev'));
    btn.setAttribute('aria-label', dev ? `Machine ${label}: ${status}. Change machine` : 'Choose a machine for this session');
    btn.setAttribute('aria-expanded', 'false'); btn.onclick = () => openMachineSelect(tab, btn);
  }

  function openMachineSelect(tab, anchor) {
    anchor.setAttribute('aria-expanded', 'true');
    openSurface('menu', (box) => {
      for (const dev of state().devices) {
        const conn = connFor(dev.id), status = conn?.status || 'connecting', ok = status === 'connected';
        const item = el('button', 'menu-item');
        item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(tab.deviceId === dev.id));
        const dot = el('span', 'sdot'); dot.dataset.s = status;
        item.append(dot, el('span', 'mi-title', deviceLabel(dev)));
        const side = ok ? conn?.agent || 'connected' : status === 'connecting' ? 'connecting…' : status === 'expired' ? 'pairing expired' : status === 'noagent' ? 'no agent' : 'offline';
        item.append(el('span', 'mi-side', side));
        if (!ok) item.disabled = true;
        else {
          hapticize(item);
          item.onclick = () => { haptic(); closeSurface(false); tab.deviceId = dev.id; state().threadDeviceId = dev.id; workspace.renderSessionChrome(); workspace.renderEphemeral(tab); $('#input')?.focus(); };
        }
        box.append(item);
      }
    }, { anchor, label: 'Choose machine for this session' });
  }

  const subtitle = (conn) => {
    if (!conn) return 'connecting…';
    if (conn.status !== 'connected') return conn.lastDetail || conn.status;
    const path = conn.metrics?.path?.selected, rtt = conn.metrics?.path?.rtt_ms;
    return [conn.agent, path && path !== 'unknown' ? `${path}${rtt != null ? ` · ${rtt}ms` : ''}` : null].filter(Boolean).join(' · ') || 'connected';
  };
  const titleRow = (dev, conn) => {
    const title = el('div', 'sheet-title'), dot = el('span', 'sdot'); dot.dataset.s = conn?.status || 'connecting';
    title.append(dot, document.createTextNode(deviceLabel(dev))); return title;
  };
  const kv = (k, v) => { const row = el('div', 'kv'); row.append(el('span', 'k', k), el('span', 'v', v)); return row; };

  function openMachineActions(dev, anchor) {
    const conn = connFor(dev.id);
    openSurface('menu', (box) => {
      const head = el('div', 'popover-head'); head.append(titleRow(dev, conn), el('div', 'sheet-sub', subtitle(conn))); box.append(head);
      const add = (ic, label, fn, { danger = false, disabled = false, sub = null } = {}) => {
        const row = el('button', `action-row${danger ? ' danger' : ''}`), main = el('div', 'action-main');
        row.append(icon(ic)); main.append(document.createTextNode(label)); if (sub) main.append(el('span', 'action-sub', sub)); row.append(main);
        if (disabled) row.disabled = true; else row.onclick = fn; box.append(row);
      };
      add('info', 'Connection details', () => machineDetails(dev));
      add('pencil', 'Rename machine…', () => renameDialog(dev));
      add('copy', 'Copy node ID', () => { closeSurface(true); copyNodeId(dev); }, { sub: `${dev.id.slice(0, 16)}…` });
      add('refresh', 'Reconnect', () => { closeSurface(true); reconnect(dev); }, { disabled: conn?.status === 'connected' });
      if (conn?.status === 'noagent') add('refresh', 'Install opencode…', () => { closeSurface(true); installOnConnection(conn); });
      add('trash', 'Forget machine…', () => forgetDialog(dev), { danger: true });
    }, { anchor, label: `Machine ${deviceLabel(dev)}` });
  }

  function copyNodeId(dev) {
    const write = navigator.clipboard?.writeText(dev.id);
    if (!write) return toast(`Node ID: ${dev.id}`);
    write.then(() => toast('Node ID copied.'), () => toast(`Node ID: ${dev.id}`));
  }

  function machineDetails(dev) {
    if (workspace.openDetailsContext?.(dev)) { closeSurface(false); return; }
    const conn = connFor(dev.id);
    openSurface('dialog', (box) => {
      box.append(titleRow(dev, conn), el('div', 'sheet-sub', subtitle(conn)));
      for (const [k, v] of [['status', conn?.status || 'connecting'], ['agent', conn?.agent || '—'], ['node id', dev.id], ['relay', dev.relay || '—'], ['sessions', conn?.threads ? String(conn.threads.length) : '—'], ['last connected', dev.lastConnectedAt ? rel(dev.lastConnectedAt) : '—'], ['last error', dev.lastError || '—']]) box.append(kv(k, v));
      const btns = el('div', 'sheet-btns'), done = el('button', 'btn', 'Close'); done.onclick = () => closeSurface(true); btns.append(done); box.append(btns);
    }, { label: `Details for ${deviceLabel(dev)}` });
  }

  function renameDialog(dev) {
    openSurface('dialog', (box) => {
      box.append(el('div', 'sheet-title', `Rename ${deviceLabel(dev)}`), el('div', 'sheet-sub', 'Local nickname only — the computer keeps its hostname.'));
      const input = el('input', 'field'); input.value = dev.name || ''; input.placeholder = dev.id.slice(0, 8); input.maxLength = 24; input.setAttribute('aria-label', 'Machine name');
      const btns = el('div', 'sheet-btns'), cancel = el('button', 'btn', 'Cancel'), save = el('button', 'btn btn-accent', 'Save');
      cancel.onclick = () => closeSurface(true);
      save.onclick = () => { persistence.updateDevice(dev.id, { name: input.value.trim() || null }); closeSurface(true); repaint(); };
      input.onkeydown = (e) => { if (e.key === 'Enter') save.onclick(); };
      btns.append(cancel, save); box.append(input, btns); setTimeout(() => input.select(), 60);
    }, { label: `Rename ${deviceLabel(dev)}` });
  }

  function forgetDialog(dev) {
    openSurface('alert', (box) => {
      box.append(el('div', 'sheet-title', `Forget ${deviceLabel(dev)}?`), el('div', 'sheet-sub', 'Removes the pairing and its sessions from this phone. Nothing is deleted on the computer — re-pair any time with a new QR.'));
      const btns = el('div', 'sheet-btns'), cancel = el('button', 'btn', 'Cancel'), doit = el('button', 'btn btn-danger', 'Forget machine');
      cancel.setAttribute('autofocus', ''); cancel.onclick = () => closeSurface(true); hapticize(doit);
      doit.onclick = () => { haptic(); closeSurface(false); forgetMachine(dev); }; btns.append(cancel, doit); box.append(btns);
    }, { label: `Forget ${deviceLabel(dev)}` });
  }

  function forgetMachine(dev) {
    const s = state();
    connection.dropConnection(dev.id); persistence.purgeThreadCache(dev.id);
    s.devices = s.devices.filter((d) => d.id !== dev.id); persistence.persistDevices(s.devices);
    if (s.filter === dev.id) s.filter = 'all';
    const activeGone = model.activeTab()?.deviceId === dev.id;
    s.tabs = s.tabs.filter((t) => t.deviceId !== dev.id); persistence.persistTabs();
    if (!s.devices.length) { history.replaceState(null, ''); workspace.showUnpaired(); return; }
    if (activeGone && s.screen === 'session') { history.replaceState(null, ''); workspace.showHome(); }
    else { renderChips(); workspace.renderSessions(); workspace.renderStrip(); }
    toast(`Forgot ${deviceLabel(dev)}. Scan its QR again to re-pair.`);
  }

  function pairDialog() {
    openSurface('dialog', (box) => {
      box.append(el('div', 'sheet-title', 'Pair another machine'));
      const sub = el('div', 'sheet-sub'); sub.append('Run ', el('code', null, 'doggypile pair'), ' on the other computer, then scan its QR code with this phone. It joins the list — nothing here is replaced.'); box.append(sub);
      const input = el('input', 'field'); input.placeholder = 'or paste a pair link…'; input.autocapitalize = 'off'; input.spellcheck = false; input.setAttribute('aria-label', 'Pair link');
      const btns = el('div', 'sheet-btns'), cancel = el('button', 'btn', 'Close'), add = el('button', 'btn btn-accent', 'Add from link'); cancel.onclick = () => closeSurface(true);
      add.onclick = () => {
        const text = input.value.trim(), hashIdx = text.indexOf('#'), frag = new URLSearchParams(hashIdx >= 0 ? text.slice(hashIdx + 1) : text), node = frag.get('node'), token = frag.get('token');
        if (!node || !token) return toast('That doesn’t look like a pair link.');
        const s = state(); let dev = s.devices.find((d) => d.id === node);
        if (dev) { Object.assign(dev, { token, relay: frag.get('relay'), addrs: frag.getAll('addr') }); if (frag.get('name')) dev.name = frag.get('name'); connection.dropConnection(dev.id); }
        else { dev = { id: node, name: frag.get('name'), token, relay: frag.get('relay'), addrs: frag.getAll('addr'), addedAt: Date.now() }; s.devices.push(dev); }
        persistence.persistDevices(s.devices); closeSurface(true); connection.connectDevice(dev, { resetBackoff: true }); renderChips(); workspace.renderSessions(); toast(`Pairing ${deviceLabel(dev)}…`);
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') add.onclick(); }; btns.append(cancel, add); box.append(input, btns);
    }, { label: 'Pair another machine' });
  }

  async function installOnConnection(conn) {
    if (!conn.installable) return toast('No supported agent on this machine, and its daemon is too old for remote install. Restart doggypile there from a newer build.');
    if (!confirm(`No supported agent on ${deviceLabel(conn.dev)}. Install opencode there now?\n\nThis will run:\ncurl -fsSL https://opencode.ai/install | bash`)) return;
    connection.markConnection(conn, 'connecting', 'installing opencode'); toast(`Installing opencode on ${deviceLabel(conn.dev)}…`);
    try {
      await connection.installAgent({ nodeId: conn.dev.id, token: conn.dev.token, relay: conn.dev.relay, directAddrs: conn.dev.addrs || [], agent: 'opencode', onToken: (token) => persistence.updateDevice(conn.dev.id, { token }) });
    } catch (error) {
      let detail = error instanceof Error ? error.message : String(error);
      if (/stream closed/i.test(detail)) detail = 'the daemon closed the install request — it may be too old';
      connection.markConnection(conn, 'noagent', detail); toast(`opencode install failed on ${deviceLabel(conn.dev)}: ${detail}`); return;
    }
    connection.reconnect(conn);
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && surface) { closeSurface(true); return true; }
    if (event.key !== 'Tab' || !surface?.modal) return false;
    const box = $('#overlay-root').lastElementChild;
    if (!box) return false;
    const focusables = [...box.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter((n) => !n.disabled);
    if (!focusables.length) return false;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    return true;
  }

  function destroy() { closeSurface(false); for (const cleanup of [...gestureCleanups]) cleanup(); }
  return { renderChips, renderMachineSelect, openMachineSelect, openMachineActions, machineDetails, pairDialog, installOnConnection, closeSurface, hasSurface: () => !!surface, handleKeydown, destroy };
}
