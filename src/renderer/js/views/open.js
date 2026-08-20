/**
 * The pack opener: an unopened booster, a one-card-at-a-time reveal, then the
 * pack summary.  Cards come out in physical pack order, so the four commons
 * land first and the holo slot is always the last thing you see.
 */
import { el, money, label, BURST, toast } from '../util.js';
import { createCard } from '../card.js';
import { app, openOnePack } from '../store.js';
import { showCard } from './inspect.js';

const ASSETS = '../../assets';

/** Cards used for the drifting art bed behind the stage. */
function artBed() {
  const chase = app.data.cards.cards.filter(
    (c) => ['Special Illustration Rare', 'Illustration Rare', 'MEGA_ATTACK_RARE'].includes(c.rarity),
  );
  const picks = [];
  for (let i = 0; i < 24; i += 1) picks.push(chase[(i * 7) % chase.length]);
  return el('div', { class: 'art-bed' },
    picks.map((c) => el('img', { src: `${ASSETS}/${c.image}`, alt: '', loading: 'lazy' })));
}

export function renderOpen(root) {
  root.innerHTML = '';
  const wrap = el('div', { id: 'opener' });
  const stage = el('div', { class: 'stage' });
  const hud = el('div', { class: 'reveal-hud' });
  wrap.append(artBed(), stage, hud);
  root.append(wrap);

  showIdle(stage, hud, root);
}

/* ------------------------------------------------------------- idle state */

function showIdle(stage, hud, root) {
  stage.innerHTML = '';
  hud.innerHTML = '';

  const featured = app.data.cards.cards.find((c) => c.rarity === 'Mega Hyper Rare')
    || app.data.cards.cards[app.data.cards.cards.length - 1];

  const booster = el('div', { class: 'booster', title: 'Rip it open' },
    el('div', { class: 'b-top' }, 'MEGA EVOLUTION'),
    el('div', { class: 'b-art' }, el('img', { src: `${ASSETS}/${featured.image}`, alt: '' })),
    el('div', {},
      el('div', { class: 'b-name' }, 'ASCENDED\nHEROES'),
      el('div', { class: 'b-foot' }, '10 CARDS PER PACK')),
  );
  booster.querySelector('.b-name').style.whiteSpace = 'pre-line';

  const packs = app.state.wallet.packs;
  const btn = el('button', { class: 'btn primary', disabled: packs <= 0 },
    packs > 0 ? 'RIP PACK' : 'NO PACKS LEFT');

  const start = async () => {
    if (app.state.wallet.packs <= 0) return;
    btn.disabled = true;
    const pack = await openOnePack();
    if (!pack) {
      btn.disabled = app.state.wallet.packs <= 0;
      toast('PACK NOT OPENED', 'Nothing was spent. Try again, or restart the app if the problem continues.');
      return;
    }
    runReveal(stage, hud, root, pack);
  };

  booster.addEventListener('click', start);
  btn.addEventListener('click', start);

  const note = packs > 0
    ? el('p', { class: 'pack-note' },
      `${packs} pack${packs === 1 ? '' : 's'} ready. Real Ascended Heroes odds - `,
      el('span', { class: 'gold' }, '1 in 5'), ' for a Double Rare, ',
      el('span', { class: 'gold' }, '1 in 540'), ' for a Mega Hyper Rare.')
    : el('p', { class: 'pack-note' },
      'You are out of packs. Earn more by playing Pokemon Revolution Online - set that up under ',
      el('span', { class: 'gold' }, 'PRO Link'), ' - or add some by hand there.');

  stage.append(el('div', { class: 'pack-wrap' }, booster, el('div', { class: 'pack-cta' }, btn), note));
}

/* ---------------------------------------------------------------- reveal */

function runReveal(stage, hud, root, pack) {
  stage.innerHTML = '';
  hud.innerHTML = '';

  const reveal = el('div', { class: 'reveal' });
  const deck = el('div', { class: 'reveal-stack' });
  reveal.append(deck);
  stage.append(reveal);

  const pips = el('div', { class: 'pips' });
  const caption = el('div', { class: 'card-caption' });
  const next = el('button', { class: 'btn primary' }, 'NEXT');
  const skip = el('button', { class: 'btn' }, 'SKIP');
  hud.append(pips, caption, next, skip);

  for (let i = 0; i < pack.cards.length; i += 1) pips.append(el('i', { class: 'pip' }));

  let index = 0;
  let current = null;

  const paint = () => {
    [...pips.children].forEach((p, i) => {
      p.className = 'pip' + (i < index ? ' done' : i === index ? ' now' : '');
    });
  };

  const show = () => {
    const pull = pack.cards[index];
    if (current) {
      current.classList.add('gone');
      const dying = current;
      setTimeout(() => { dying.destroy?.(); dying.remove(); }, 460);
    }

    const card = createCard(pull, { assetBase: ASSETS });
    card.classList.add('entering');
    deck.append(card);
    current = card;
    // Let the foil play by itself so the pull reads without touching the mouse.
    if (pull.foilStyle !== 'none') setTimeout(() => card.showcase(3600), 260);

    if (pull.foilStyle !== 'none' && pull.rarity !== 'Common' && pull.rarity !== 'Uncommon') {
      const burst = el('div', { class: 'hit-burst' });
      burst.style.setProperty('--burst', BURST[pull.rarity] || '#ffd75e');
      card.append(burst);
      setTimeout(() => burst.remove(), 1200);
    }

    caption.innerHTML = '';
    caption.append(
      el('div', { class: 'cc-name' }, pull.name),
      el('div', { class: 'cc-meta' },
        el('span', { class: 'badge', dataset: { r: pull.rarity } }, label(pull.rarity)),
        pull.isReverse ? el('span', { class: 'badge rev' }, 'REVERSE') : null,
        el('span', { class: 'mono' }, `#${pull.n}`),
        el('span', { class: 'mono gold' }, money(pull.price)),
        pull.isNew ? el('span', { class: 'badge', style: 'background:var(--green)' }, 'NEW') : null,
      ));

    paint();
    index += 1;
    next.textContent = index >= pack.cards.length ? 'SEE PACK' : 'NEXT';
  };

  const advance = () => {
    if (index >= pack.cards.length) { showResults(stage, hud, root, pack); return; }
    show();
  };

  next.addEventListener('click', advance);
  skip.addEventListener('click', () => showResults(stage, hud, root, pack));

  const onKey = (e) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') {
      e.preventDefault();
      advance();
    }
  };
  document.addEventListener('keydown', onKey);
  root._cleanup = () => document.removeEventListener('keydown', onKey);

  if (pack.godPack) {
    toast('GOD PACK', 'Every card is a hit: 3 Mega Attack Rares and 7 Special Illustration Rares.');
  }
  show();
}

/* --------------------------------------------------------------- results */

function showResults(stage, hud, root, pack) {
  root._cleanup?.();
  stage.innerHTML = '';
  hud.innerHTML = '';

  const total = pack.cards.reduce((sum, c) => sum + (c.price || 0), 0);
  const best = [...pack.cards].sort((a, b) => (b.price || 0) - (a.price || 0))[0];
  const fresh = pack.cards.filter((c) => c.isNew).length;

  const body = el('div', { class: 'pad', style: 'width:100%;max-width:1050px;margin:0 auto;' });

  if (pack.godPack) {
    body.append(el('div', { class: 'godpack-banner' }, 'GOD PACK'));
  }

  body.append(el('div', { class: 'summary-bar' },
    stat('Pack Value', money(total), 'green'),
    stat('Best Pull', best ? best.name : '--'),
    stat('New Cards', String(fresh)),
    stat('Packs Left', String(app.state.wallet.packs), 'gold'),
    el('div', { style: 'flex:1' }),
    el('button', {
      class: 'btn primary',
      disabled: app.state.wallet.packs <= 0,
      onclick: () => renderOpen(root),
    }, app.state.wallet.packs > 0 ? 'OPEN ANOTHER' : 'NO PACKS LEFT'),
  ));

  const grid = el('div', { class: 'results' });
  for (const pull of pack.cards) {
    const cell = el('div', {
      class: 'result-cell' + (pull.isNew ? ' new' : ''),
      title: `${pull.name} - ${label(pull.rarity)}`,
      onclick: () => showCard(pull.n, pull.printing),
    },
      el('img', { src: `${ASSETS}/${pull.image}`, alt: pull.name }),
      el('span', { class: 'rc-val' }, money(pull.price)));
    grid.append(cell);
  }
  body.append(grid);
  stage.style.alignItems = 'start';
  stage.append(body);
}

function stat(labelText, value, tone) {
  return el('div', { class: 'stat', style: 'align-items:flex-start' },
    el('span', { class: 'label' }, labelText),
    el('span', { class: `value ${tone || ''}` }, value));
}

export default renderOpen;
