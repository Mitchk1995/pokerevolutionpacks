/**
 * The odds screen: what the simulator is actually doing, where the numbers
 * came from, and a Monte Carlo run so you can check it yourself.
 */
import { el, label, RARITY_ORDER } from '../util.js';
import { app } from '../store.js';
import { PackEngine, mulberry32 } from '../../../shared/pack-engine.js';

const PUBLISHED = {
  'Double Rare': 5,
  'Illustration Rare': 9,
  'Ultra Rare': 21,
  MEGA_ATTACK_RARE: 29,
  'Special Illustration Rare': 70,
  'Mega Hyper Rare': 540,
};

export function renderOdds(root) {
  root.innerHTML = '';
  const pad = el('div', { class: 'pad' });
  root.append(pad);

  const model = app.data.model;

  pad.append(
    el('h2', { class: 'section' }, 'PACK ODDS'),
    el('p', { class: 'sub' },
      'Every probability the simulator uses, and where it came from. Nothing here is invented: '
      + 'the per-rarity rates are the TCGplayer study of 2,000+ packs, and the slot layout is the '
      + 'Scarlet & Violet pack configuration.'),
  );

  /* ---- structure ---- */
  const slotRows = model.slots.map((s, i) => {
    let contents;
    if (s.kind === 'pool') contents = `${label(s.rarity)}, non-foil`;
    else if (s.kind === 'reverse') {
      contents = s.upgrades
        ? `Reverse holo, unless displaced by ${s.upgrades.map((u) => `${label(u.rarity)} (${u.odds})`).join(' or ')}`
        : 'Reverse holo';
    } else {
      contents = s.outcomes.map((o) => `${label(o.rarity)} ${o.odds}`).join(' - ');
    }
    return el('tr', {},
      el('td', { class: 'mono' }, String(i + 1)),
      el('td', {}, s.label || s.rarity || s.kind),
      el('td', { class: 'muted' }, contents));
  });

  pad.append(el('div', { class: 'panel' },
    el('h3', {}, `PACK STRUCTURE - ${model.cardsPerPack} CARDS`),
    el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Slot'), el('th', {}, 'Contents'))),
      el('tbody', {}, slotRows)),
    el('p', { class: 'faint', style: 'margin:12px 0 0;font-size:12px' },
      `Plus ${model.alsoInPack.join(' and ')}, which are not simulated.`),
  ));

  /* ---- god pack ---- */
  if (model.godPack?.enabled) {
    pad.append(el('div', { class: 'panel' },
      el('h3', {}, 'GOD PACK'),
      el('p', { style: 'margin:0 0 8px' },
        `1 in ${Math.round(1 / model.godPack.rate)} packs. Contents: `,
        el('span', { class: 'gold' },
          model.godPack.contents.map((c) => `${c.count}x ${label(c.rarity)}`).join(' + '))),
      el('p', { class: 'faint', style: 'margin:0;font-size:12px' }, model.godPack.rateNote),
    ));
  }

  /* ---- rates + simulation ---- */
  const theoretical = app.engine.theoreticalRates({ excludeGodPacks: true });
  const tbody = el('tbody', {});
  const simCells = new Map();

  for (const rarity of RARITY_ORDER) {
    if (theoretical[rarity] == null) continue;
    const pub = PUBLISHED[rarity];
    const sim = el('td', { class: 'mono faint' }, '--');
    simCells.set(rarity, sim);
    tbody.append(el('tr', {},
      el('td', {}, el('span', { class: 'badge', dataset: { r: rarity } }, label(rarity))),
      el('td', { class: 'mono' }, pub ? `1 in ${pub}` : 'n/a'),
      el('td', { class: 'mono' }, `1 in ${(1 / theoretical[rarity]).toFixed(1)}`),
      sim,
      el('td', { class: 'mono muted' }, `${(theoretical[rarity] * 100).toFixed(3)}%`)));
  }

  const status = el('span', { class: 'faint', style: 'font-size:12px' });
  const runBtn = el('button', { class: 'btn primary' }, 'SIMULATE 200,000 PACKS');

  runBtn.addEventListener('click', () => {
    runBtn.disabled = true;
    status.textContent = 'opening packs...';
    // Defer so the button repaints before the loop blocks the thread.
    setTimeout(() => {
      const N = 200000;
      const engine = new PackEngine({
        cards: app.data.cards.cards,
        model: app.data.model,
        random: mulberry32(Date.now() & 0xffffffff),
      });
      const hits = {};
      let normal = 0;
      for (let i = 0; i < N; i += 1) {
        const pack = engine.openPack();
        if (pack.godPack) continue;
        normal += 1;
        const seen = new Set();
        for (const c of pack.cards) if (!c.isReverse) seen.add(c.rarity);
        for (const r of seen) hits[r] = (hits[r] || 0) + 1;
      }
      for (const [rarity, cell] of simCells) {
        const n = hits[rarity] || 0;
        cell.className = 'mono';
        cell.textContent = n ? `1 in ${(normal / n).toFixed(1)}` : 'none';
      }
      status.textContent = `${normal.toLocaleString()} normal packs opened`;
      runBtn.disabled = false;
    }, 30);
  });

  pad.append(el('div', { class: 'panel' },
    el('h3', {}, 'PULL RATES'),
    el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Rarity'),
        el('th', {}, 'Published'),
        el('th', {}, 'This Model'),
        el('th', {}, 'Simulated'),
        el('th', {}, 'Per Pack'))),
      tbody),
    el('div', { style: 'display:flex;gap:14px;align-items:center;margin-top:16px' }, runBtn, status),
  ));

  /* ---- this session ---- */
  const s = app.session;
  if (s.packs > 0) {
    const rows = RARITY_ORDER.filter((r) => s.byRarity[r]).map((r) => el('tr', {},
      el('td', {}, el('span', { class: 'badge', dataset: { r } }, label(r))),
      el('td', { class: 'mono' }, String(s.byRarity[r])),
      el('td', { class: 'mono muted' }, `1 in ${(s.packs / s.byRarity[r]).toFixed(1)} packs`)));
    pad.append(el('div', { class: 'panel' },
      el('h3', {}, `THIS SESSION - ${s.packs} PACKS`),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Rarity'), el('th', {}, 'Pulled'), el('th', {}, 'Rate'))),
        el('tbody', {}, rows))));
  }

  /* ---- assumptions + sources ---- */
  pad.append(el('div', { class: 'panel' },
    el('h3', {}, 'ASSUMPTIONS'),
    model.assumptions.map((a) => el('div', { style: 'margin-bottom:14px' },
      el('div', { class: 'gold', style: 'font-family:var(--mono);font-size:12px;margin-bottom:4px' }, a.id),
      el('div', { style: 'font-size:13px' }, a.text),
      el('div', { class: 'faint', style: 'font-size:12px;margin-top:4px' }, a.impact))),
  ));

  pad.append(el('div', { class: 'panel' },
    el('h3', {}, 'SOURCES'),
    model.sources.map((src) => el('div', { style: 'margin-bottom:10px;font-size:13px' },
      el('div', {}, src.what),
      el('a', {
        href: '#', class: 'mono faint', style: 'font-size:11px;text-decoration:none;color:var(--blue)',
        onclick: (e) => { e.preventDefault(); window.api.openExternal(src.url); },
      }, src.url))),
  ));
}

export default renderOdds;
