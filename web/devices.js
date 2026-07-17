const DEVICES_KEY = 'doggypile:devices';
const LEGACY_CREDS_KEY = 'doggypile:creds';

export function createDeviceRegistry({ mock, state }) {
  function persistDevices(devices) {
    if (mock) return;
    localStorage.setItem(DEVICES_KEY, JSON.stringify({ v: 1, devices }));
  }

  function loadDevices() {
    if (mock) {
      const n = Math.max(1, Number(new URLSearchParams(location.search).get('machines')) || 1);
      return Array.from({ length: n }, (_, i) => ({
        id: i ? `mock${i + 1}` : 'mock',
        name: i ? `mock-${i + 1}` : 'mock',
        token: 'mock',
        relay: null,
        addrs: [],
      }));
    }
    let devices = [];
    try {
      const saved = JSON.parse(localStorage.getItem(DEVICES_KEY) || 'null');
      if (saved?.v === 1 && Array.isArray(saved.devices)) {
        devices = saved.devices.filter((device) => device?.id && device?.token);
      }
    } catch { /* corrupted registry: fall through to migration */ }
    if (!devices.length) {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_CREDS_KEY) || 'null');
        if (legacy?.node && legacy?.token) {
          devices = [{
            id: legacy.node,
            name: null,
            token: legacy.token,
            relay: legacy.relay ?? null,
            addrs: legacy.addrs || [],
            addedAt: Date.now(),
          }];
          persistDevices(devices);
        }
      } catch { /* no legacy credentials */ }
    }
    return devices;
  }

  function updateDevice(id, patch) {
    const device = state.devices.find((candidate) => candidate.id === id);
    if (!device) return;
    Object.assign(device, patch);
    persistDevices(state.devices);
  }

  function upsertFromFragment(devices) {
    if (mock) return null;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const node = fragment.get('node');
    const token = fragment.get('token');
    if (!node || !token) return null;
    const relay = fragment.get('relay');
    const addrs = fragment.getAll('addr');
    const name = fragment.get('name');
    let device = devices.find((candidate) => candidate.id === node);
    if (device) {
      Object.assign(device, { token, relay, addrs });
      if (name) device.name = name;
    } else {
      device = { id: node, name, token, relay, addrs, addedAt: Date.now() };
      devices.push(device);
    }
    persistDevices(devices);
    history.replaceState(history.state, '', location.pathname + location.search);
    return device;
  }

  return { loadDevices, persistDevices, updateDevice, upsertFromFragment };
}

export function deviceLabel(device) {
  return device?.name || (device ? `${device.id.slice(0, 8)}…` : '');
}
