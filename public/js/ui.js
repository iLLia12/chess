// Small shared helpers: element building, flags, dates, piece glyphs.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function flag(country) {
  if (!country || country.length !== 2) return '';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function fmtDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ago(value) {
  if (!value) return '';
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  const steps = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
    [Infinity, 'year', 31557600],
  ];
  for (const [limit, unit, div] of steps) {
    if (seconds < limit) {
      const n = Math.max(1, Math.floor(seconds / div));
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return '';
}

export const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

export function confirmDialog(message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    const overlay = el('div', { class: 'overlay', onclick: (e) => e.target === overlay && close(false) }, [
      el('div', { class: 'modal' }, [
        el('p', { class: 'modal-text', text: message }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', onclick: () => close(false), text: 'Cancel' }),
          el('button', { class: 'btn primary', onclick: () => close(true), text: confirmLabel }),
        ]),
      ]),
    ]);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
  });
}

export function toast(message, kind = 'info') {
  const node = el('div', { class: `toast ${kind}`, text: message });
  document.body.append(node);
  setTimeout(() => node.classList.add('show'), 10);
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  }, 3200);
}
