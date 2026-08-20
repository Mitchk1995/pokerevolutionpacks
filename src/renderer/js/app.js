/** App shell: boot, tab routing, and the header readout. */
import { el, money, toast } from './util.js';
import { app, boot, subscribe, notify, collectionValue, uniqueCardsOwned } from './store.js';
import { renderOpen } from './views/open.js';
import { renderBinder } from './views/binder.js';
import { renderOdds } from './views/odds.js';
import { renderProgress } from './views/progress.js';

const VIEWS = {
  open: renderOpen,
  binder: renderBinder,
  odds: renderOdds,
  progress: renderProgress,
};

const root = document.getElementById('view');
const tabs = document.getElementById('tabs');
let currentView = 'open';

function go(name) {
  currentView = name;
  for (const b of tabs.children) b.classList.toggle('active', b.dataset.view === name);
  root._cleanup?.();
  root._cleanup = null;
  root.scrollTop = 0;
  VIEWS[name](root);
}

function paintReadout() {
  document.getElementById('rd-packs').textContent = String(app.state.wallet.packs);
  document.getElementById('rd-cards').textContent =
    `${uniqueCardsOwned().size}/${app.data.cards.total}`;
  document.getElementById('rd-value').textContent = money(collectionValue());
}

async function main() {
  try {
    await boot();
  } catch (err) {
    root.innerHTML = '';
    root.append(el('div', { class: 'empty' },
      el('div', { class: 'big' }, 'COULD NOT LOAD CARD DATA'),
      el('p', {}, String(err.message || err)),
      el('p', { class: 'faint' }, 'Run "npm run build:data" to regenerate data/cards.me2pt5.json.')));
    return;
  }

  subscribe(paintReadout);
  paintReadout();

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) go(btn.dataset.view);
  });

  // Packs earned from PRO progress can arrive at any moment.
  window.api.tracker.onAward((awards) => {
    const total = awards.reduce((n, a) => n + a.packs, 0);
    app.state.wallet.packs += total;
    notify();
    toast(`+${total} PACK${total === 1 ? '' : 'S'}`,
      awards.map((a) => a.label).join(', '));
    if (currentView === 'open') go('open');
  });

  go('open');
}

main();
