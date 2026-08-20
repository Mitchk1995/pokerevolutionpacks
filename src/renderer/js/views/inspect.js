/** Full-screen card inspector: the holo card at size, plus every printing's price. */
import { el, money, label, PRINTING_LABEL } from '../util.js';
import { createCard } from '../card.js';
import { app, priceRow, priceOf } from '../store.js';

const ASSETS = '../../assets';

export function showCard(cardNumber, printing = null) {
  const card = app.cardsByNumber.get(Number(cardNumber));
  if (!card) return;

  // Which printings does this card actually have?
  const printings = ['normal', 'holo', 'reverse', 'reverse_pokeball', 'reverse_energy']
    .filter((p) => priceRow(card.n, p));
  const shown = printing && printings.includes(printing) ? printing : (printings[0] || 'holo');

  const overlay = el('div', { class: 'modal' });
  const close = () => { overlay.querySelector('.card')?.destroy?.(); overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const holder = el('div', {});
  const render = (p) => {
    holder.querySelector('.card')?.destroy?.();
    holder.innerHTML = '';
    const node = createCard({
      ...card,
      printing: p,
      foilStyle: p.startsWith('reverse') ? 'reverse-holo' : card.foil,
    }, { assetBase: ASSETS });
    holder.append(node);
    if (card.foil !== 'none' || p.startsWith('reverse')) {
      setTimeout(() => node.showcase(4200), 120);
    }
  };
  render(shown);

  const owned = app.state.collection;
  const rows = printings.map((p) => {
    const row = priceRow(card.n, p);
    const held = owned[`${card.n}|${p}`];
    return el('tr', { class: held ? 'owned' : '', style: 'cursor:pointer', onclick: () => render(p) },
      el('td', {}, PRINTING_LABEL[p] || p),
      el('td', {}, held ? `x${held.count}` : '--'),
      el('td', {}, money(row?.market)),
      el('td', {}, money(row?.low)),
      el('td', {}, money(row?.high)));
  });

  const meta = el('div', { class: 'meta' },
    el('h3', {}, card.name),
    el('div', {},
      el('span', { class: 'badge', dataset: { r: card.rarity } }, label(card.rarity)),
      ' ',
      el('span', { class: 'mono faint' }, `#${card.n} / ${app.data.cards.printedTotal}`)),
    el('dl', { class: 'spec' },
      el('dt', {}, 'Type'), el('dd', {}, [card.supertype, ...(card.subtypes || [])].filter(Boolean).join(' - ')),
      card.hp ? el('dt', {}, 'HP') : null, card.hp ? el('dd', {}, card.hp) : null,
      card.types?.length ? el('dt', {}, 'Energy') : null,
      card.types?.length ? el('dd', {}, card.types.join(', ')) : null,
      el('dt', {}, 'Artist'), el('dd', {}, card.artist || 'Unknown'),
      el('dt', {}, 'Reverses'), el('dd', {}, card.reverseStyles?.length ? card.reverseStyles.join(', ') : 'none printed'),
    ),
    card.flavorText ? el('p', { class: 'muted', style: 'font-style:italic' }, card.flavorText) : null,
    el('h3', { style: 'font-family:var(--pixel);font-size:9px;color:var(--gold);margin-top:20px' }, 'MARKET VALUE'),
    el('table', { class: 'price-table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Printing'), el('th', {}, 'Owned'),
        el('th', {}, 'Market'), el('th', {}, 'Low'), el('th', {}, 'High'))),
      el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colspan: 5 }, 'No price data')))),
    el('p', { class: 'faint', style: 'font-size:11px;margin-top:10px' },
      `${app.pricesMeta.source}${app.pricesMeta.updatedAt ? ` - updated ${new Date(app.pricesMeta.updatedAt).toLocaleDateString()}` : ''}`),
    card.tcgplayerUrl
      ? el('button', {
        class: 'btn', style: 'margin-top:12px',
        onclick: () => window.api.openExternal(card.tcgplayerUrl),
      }, 'VIEW ON TCGPLAYER')
      : null,
  );

  overlay.append(
    el('button', { class: 'btn close', onclick: close }, 'CLOSE (ESC)'),
    el('div', { class: 'modal-body' }, holder, meta),
  );
  document.body.append(overlay);
}

export default showCard;
