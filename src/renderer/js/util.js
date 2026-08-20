/** Small shared helpers for the renderer. */

export const RARITY_ORDER = [
  'Common', 'Uncommon', 'Rare', 'Double Rare', 'Ultra Rare',
  'Illustration Rare', 'Special Illustration Rare', 'MEGA_ATTACK_RARE', 'Mega Hyper Rare',
];

export const RARITY_LABEL = {
  MEGA_ATTACK_RARE: 'Mega Attack Rare',
};

export const PRINTING_LABEL = {
  normal: 'Normal',
  holo: 'Holofoil',
  reverse: 'Reverse Holo',
  reverse_pokeball: 'Reverse Holo (Poke Ball)',
  reverse_energy: 'Reverse Holo (Energy Pattern)',
};

/** Colours used for the hit burst behind a revealed card. */
export const BURST = {
  Rare: '#57a5e8',
  'Double Rare': '#f0a63c',
  'Ultra Rare': '#c77bf0',
  'Illustration Rare': '#46d2c0',
  'Special Illustration Rare': '#ff7ab8',
  MEGA_ATTACK_RARE: '#ff5b5b',
  'Mega Hyper Rare': '#ffd75e',
};

export const label = (rarity) => RARITY_LABEL[rarity] || rarity;

export function money(v) {
  if (v == null || Number.isNaN(v)) return '--';
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function toast(title, body) {
  const host = document.getElementById('toasts');
  const node = el('div', { class: 'toast' },
    el('div', { class: 't-title' }, title),
    el('div', {}, body));
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .35s, transform .35s';
    node.style.opacity = '0';
    node.style.transform = 'translateX(24px)';
    setTimeout(() => node.remove(), 380);
  }, 5200);
}
