export function short(path) {
  return path ? path.split('/').slice(-1)[0] : '';
}

export function truncate(value, length) {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function relativeTime(timestamp, now = Date.now()) {
  if (!timestamp) return '';
  const raw = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  const milliseconds = raw < 10_000_000_000 ? raw * 1000 : raw;
  if (!Number.isFinite(milliseconds)) return '';
  const seconds = (now - milliseconds) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
