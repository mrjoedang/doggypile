const TABS_KEY = 'doggypile:tabs';

export function createTabStore({ state, tabKeyFor }) {
  function persist() {
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify({
        v: 1,
        active: state.active,
        tabs: state.tabs
          .filter((tab) => !tab.ephemeral)
          .map(({ deviceId, threadId, title, unread, turnStartedAt, lastActivityAt, lastActivityTail, lastViewedAt, turnError, unreadForTurn }) => ({
            deviceId,
            threadId,
            title,
            unread: unread || 0,
            turnStartedAt: turnStartedAt || null,
            lastActivityAt: lastActivityAt || 0,
            lastActivityTail: lastActivityTail || '',
            lastViewedAt: lastViewedAt || 0,
            turnError: turnError || '',
            unreadForTurn: !!unreadForTurn,
          })),
      }));
    } catch { /* storage full or unavailable */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TABS_KEY) || 'null');
      if (saved?.v !== 1) return;
      for (const tab of saved.tabs || []) {
        if (!tab?.deviceId || !tab?.threadId) continue;
        if (!state.devices.some((device) => device.id === tab.deviceId)) continue;
        const key = tabKeyFor(tab.deviceId, tab.threadId);
        if (state.tabs.some((existing) => existing.key === key)) continue;
        state.tabs.push({
          key,
          deviceId: tab.deviceId,
          threadId: tab.threadId,
          title: tab.title || 'Session',
          ephemeral: false,
          lastTurnActive: false,
          unread: Math.max(0, Number(tab.unread) || 0),
          turnStartedAt: tab.turnStartedAt || null,
          lastActivityAt: tab.lastActivityAt || 0,
          lastActivityTail: tab.lastActivityTail || '',
          lastViewedAt: tab.lastViewedAt || 0,
          turnError: tab.turnError || '',
          waitingForUser: false,
          unreadForTurn: !!tab.unreadForTurn,
          draft: '',
        });
      }
      if (saved.active && state.tabs.some((tab) => tab.key === saved.active)) state.active = saved.active;
    } catch { /* corrupted storage: start empty */ }
  }

  return { persist, restore };
}
