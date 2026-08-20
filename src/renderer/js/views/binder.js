/** The collection binder: every card in the set, owned ones in colour. */
import { el, money, label, toast, RARITY_ORDER } from '../util.js';
import { app, uniqueCardsOwned, collectionValue, ownedEntries, priceOf, notify } from '../store.js';
import { showCard } from './inspect.js';

const ASSETS = '../../assets';

const filters = { rarity: 'all', show: 'all', sort: 'number', search: '' };

export function renderBinder(root) {
  root.innerHTML = '';
  const pad = el('div', { class: 'pad' });
  root.append(pad);

  const cards = app.data.cards.cards;
  const owned = uniqueCardsOwned();
  const pct = (owned.size / cards.length) * 100;

  pad.append(
    el('h2', { class: 'section' }, 'BINDER'),
    el('p', { class: 'sub' },
      `Mega Evolution - Ascended Heroes. ${owned.size} of ${cards.length} cards collected.`),
  );

  // completion + value
  const countsByRarity = {};
  const ownedByRarity = {};
  for (const c of cards) {
    countsByRarity[c.rarity] = (countsByRarity[c.rarity] || 0) + 1;
    if (owned.has(c.n)) ownedByRarity[c.rarity] = (ownedByRarity[c.rarity] || 0) + 1;
  }

  const dupes = ownedEntries().reduce((n, e) => n + Math.max(0, e.count - 1), 0);

  pad.append(el('div', { class: 'panel' },
    el('h3', {}, 'SET COMPLETION'),
    el('div', { class: 'progressbar' }, el('i', { style: `width:${pct.toFixed(1)}%` })),
    el('div', { style: 'display:flex;gap:26px;margin-top:14px;flex-wrap:wrap;align-items:flex-end' },
      kv('Unique', `${owned.size} / ${cards.length}`),
      kv('Complete', `${pct.toFixed(1)}%`),
      kv('Duplicates', String(dupes)),
      kv('Total Value', money(collectionValue())),
      el('div', { style: 'flex:1' }),
      priceRefresh()),
    el('div', { style: 'display:flex;gap:16px;margin-top:16px;flex-wrap:wrap' },
      RARITY_ORDER.filter((r) => countsByRarity[r]).map((r) => el('div', { style: 'font-size:12px' },
        el('span', { class: 'badge', dataset: { r } }, label(r)),
        el('span', { class: 'mono', style: 'margin-left:7px' },
          `${ownedByRarity[r] || 0}/${countsByRarity[r]}`)))),
  ));

  // toolbar
  const grid = el('div', { class: 'binder' });
  const rerender = () => paintGrid(grid);

  const toolbar = el('div', { class: 'binder-toolbar', style: 'margin-top:20px' },
    field('Search', el('input', {
      type: 'text', placeholder: 'name or number',
      oninput: (e) => { filters.search = e.target.value.trim().toLowerCase(); rerender(); },
    }), 'grow'),
    field('Rarity', select(['all', ...RARITY_ORDER], filters.rarity, (v) => { filters.rarity = v; rerender(); }, label)),
    field('Show', select(['all', 'owned', 'missing'], filters.show, (v) => { filters.show = v; rerender(); })),
    field('Sort', select(['number', 'value', 'rarity'], filters.sort, (v) => { filters.sort = v; rerender(); })),
  );

  pad.append(toolbar, grid);
  paintGrid(grid);
}

function paintGrid(grid) {
  const owned = app.state.collection;
  const ownedNums = uniqueCardsOwned();
  let list = app.data.cards.cards.filter((c) => {
    if (filters.rarity !== 'all' && c.rarity !== filters.rarity) return false;
    const has = ownedNums.has(c.n);
    if (filters.show === 'owned' && !has) return false;
    if (filters.show === 'missing' && has) return false;
    if (filters.search) {
      const q = filters.search;
      if (!c.name.toLowerCase().includes(q) && String(c.n) !== q) return false;
    }
    return true;
  });

  if (filters.sort === 'value') {
    list = list.sort((a, b) => (priceOf(b.n, 'holo') || 0) - (priceOf(a.n, 'holo') || 0));
  } else if (filters.sort === 'rarity') {
    list = list.sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.n - b.n);
  } else {
    list = list.sort((a, b) => a.n - b.n);
  }

  grid.innerHTML = '';
  if (!list.length) {
    grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' },
      el('div', { class: 'big' }, 'NOTHING HERE'), 'Try a different filter.'));
    return;
  }

  for (const c of list) {
    const count = Object.entries(owned)
      .filter(([k]) => k.startsWith(`${c.n}|`))
      .reduce((n, [, v]) => n + v.count, 0);
    grid.append(el('div', {
      class: 'slot' + (count ? '' : ' missing'),
      title: `${c.name} - ${label(c.rarity)}`,
      onclick: () => showCard(c.n),
    },
      el('img', { src: `${ASSETS}/${c.image}`, alt: c.name, loading: 'lazy' }),
      count > 1 ? el('span', { class: 'count' }, `x${count}`) : null,
      el('span', { class: 'num' }, `${c.n}`)));
  }
}

/** Pull fresh TCGplayer market prices without leaving the binder. */
function priceRefresh() {
  const meta = app.pricesMeta || {};
  const when = meta.updatedAt
    ? `updated ${new Date(meta.updatedAt).toLocaleDateString()}`
    : 'bundled snapshot';
  const note = el('div', { class: 'faint', style: 'font-size:11px;margin-bottom:6px' },
    `${meta.source || 'TCGplayer'} - ${when}`);

  const btn = el('button', { class: 'btn' }, 'REFRESH PRICES');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'FETCHING...';
    const res = await window.api.refreshPrices();
    if (res.ok) {
      app.prices = res.prices;
      app.pricesMeta = { source: 'TCGplayer via tcgcsv.com', updatedAt: res.updatedAt };
      notify();
      renderBinder(document.getElementById('view'));
      toast('PRICES UPDATED', `${res.count} prices refreshed from TCGplayer.`);
    } else {
      btn.disabled = false;
      btn.textContent = 'REFRESH PRICES';
      toast('COULD NOT REFRESH', res.error || 'The price feed was unreachable.');
    }
  });
  return el('div', {}, note, btn);
}

function kv(k, v) {
  return el('div', { class: 'stat', style: 'align-items:flex-start' },
    el('span', { class: 'label' }, k), el('span', { class: 'value' }, v));
}

function field(name, input, cls = '') {
  return el('label', { class: `field ${cls}` }, el('span', {}, name), input);
}

function select(options, value, onchange, fmt = (v) => v) {
  const s = el('select', { onchange: (e) => onchange(e.target.value) });
  for (const o of options) {
    const opt = el('option', { value: o }, o === 'all' ? 'All' : fmt(o));
    if (o === value) opt.selected = true;
    s.append(opt);
  }
  return s;
}

export default renderBinder;
