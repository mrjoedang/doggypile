const THREADS_KEY = 'doggypile:threads';
const THREAD_CACHE_MAX = 12;

export function createThreadCache({ mock }) {
  const entries = new Map();

  function load() {
    if (mock) return;
    try {
      const saved = JSON.parse(localStorage.getItem(THREADS_KEY) || 'null');
      if (saved?.v !== 1) return;
      for (const [key, entry] of Object.entries(saved.entries || {})) {
        if (entry?.thread) entries.set(key, entry);
      }
    } catch { /* corrupted cache: start empty */ }
  }

  function persist() {
    if (mock) return;
    try {
      const json = JSON.stringify({ v: 1, entries: Object.fromEntries(entries) });
      if (json.length < 2_000_000) localStorage.setItem(THREADS_KEY, json);
    } catch { /* quota exceeded: cache stays in memory */ }
  }

  function put(key, thread) {
    entries.set(key, { thread, at: Date.now() });
    while (entries.size > THREAD_CACHE_MAX) {
      const oldest = [...entries.entries()].sort((a, b) => a[1].at - b[1].at)[0][0];
      entries.delete(oldest);
    }
    persist();
  }

  function purgeDevice(deviceId) {
    for (const key of [...entries.keys()]) {
      if (key.startsWith(`${deviceId}:`)) entries.delete(key);
    }
    persist();
  }

  return { entries, load, persist, put, purgeDevice };
}

export { THREAD_CACHE_MAX };
