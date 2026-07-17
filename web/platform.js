export const $ = (sel) => document.querySelector(sel);

export const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const mqDesk = matchMedia('(min-width: 1100px)');
const mqTab = matchMedia('(min-width: 700px)');
export const layout = () => (mqDesk.matches ? 'desktop' : mqTab.matches ? 'tablet' : 'mobile');

// iOS Safari has no vibration API. An invisible native switch lets physical
// taps retain the system haptic on controls where hapticize is applied.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function hapticize(btn) {
  if (!IS_IOS || !btn || btn.querySelector('.hswitch')) return;
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.className = 'hswitch';
  sw.tabIndex = -1;
  sw.setAttribute('aria-hidden', 'true');
  btn.append(sw);
}

export function haptic() {
  navigator.vibrate?.(10);
}

const VT = !!document.startViewTransition
  && !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (VT) document.documentElement.classList.add('vt');

export function navigate(update) {
  if (!VT) { update(); return; }
  document.startViewTransition(() => { update(); });
}
