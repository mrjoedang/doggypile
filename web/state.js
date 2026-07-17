export function createAppState() {
  return {
    devices: [],
    conns: new Map(),
    filter: 'all',
    mode: 'normal',
    screen: 'home',
    tabs: [],
    active: null,
    ctxOpen: true,
    ctxTab: 'details',
    mobilePane: 'session',
    query: '',
    newN: 0,
    threadId: null,
    threadTitle: '',
    threadDeviceId: null,
    projection: null,
    turnActive: false,
    creatingThread: false,
  };
}

export function tabKeyFor(deviceId, threadId) {
  return `${deviceId}:${threadId}`;
}
