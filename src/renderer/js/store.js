/**
 * Renderer-side view of the app state.
 *
 * The main process owns the file on disk; this keeps a live copy, exposes
 * derived numbers the views need (collection value, set completion), and
 * notifies subscribers when anything changes.
 */
import { PackEngine, mulberry32 } from '../../shared/pack-engine.js';

const listeners = new Set();

export const app = {
  data: null,       // { cards, model, prices }
  cardsByNumber: new Map(),
  state: null,      // persisted state from the main process
  engine: null,
  prices: {},
  session: { packs: 0, byRarity: {}, value: 0 },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn();
}

export async function boot() {
  const data = await window.api.loadData();
  app.data = data;
  app.prices = data.prices.prices || {};
  app.pricesMeta = { source: data.prices.source, updatedAt: data.prices.updatedAt };

  for (const card of data.cards.cards) app.cardsByNumber.set(card.n, card);

  app.engine = new PackEngine({
    cards: data.cards.cards,
    model: data.model,
    random: Math.random,
  });

  app.state = await window.api.getState();
  return app;
}

/** Market price for one printing of one card, with a sensible fallback. */
export function priceOf(cardNumber, printing) {
  const p = app.prices;
  const direct = p[`${cardNumber}|${printing}`];
  if (direct && direct.market != null) return direct.market;

  // The price mirror does not carry every printing for every card (a handful
  // of commons have no non-foil row, for instance). Fall back to whatever
  // printing of the same card it does know about rather than showing nothing.
  const order = printing.startsWith('reverse')
    ? ['reverse', 'reverse_energy', 'reverse_pokeball', 'holo', 'normal']
    : ['normal', 'holo', 'reverse', 'reverse_energy', 'reverse_pokeball'];
  for (const alt of order) {
    const row = p[`${cardNumber}|${alt}`];
    if (row && row.market != null) return row.market;
  }
  return null;
}

export function priceRow(cardNumber, printing) {
  return app.prices[`${cardNumber}|${printing}`] || null;
}

/** Every printing the collection holds, as a flat list. */
export function ownedEntries() {
  return Object.entries(app.state.collection).map(([key, entry]) => {
    const [n, printing] = key.split('|');
    return { key, n: Number(n), printing, ...entry };
  });
}

export function collectionValue() {
  let total = 0;
  for (const e of ownedEntries()) {
    const price = priceOf(e.n, e.printing);
    if (price) total += price * e.count;
  }
  return total;
}

/** Distinct cards owned in any printing, for set completion. */
export function uniqueCardsOwned() {
  const set = new Set();
  for (const e of ownedEntries()) set.add(e.n);
  return set;
}

export async function openOnePack() {
  const spend = await window.api.spendPack();
  if (!spend.ok) return null;
  app.state.wallet = spend.wallet;

  const pack = app.engine.openPack();
  const result = await window.api.recordPack({
    godPack: pack.godPack,
    cards: pack.cards.map((c) => ({
      n: c.n, printing: c.printing, rarity: c.rarity,
    })),
  });

  app.state.wallet = result.wallet;
  app.state.stats = result.stats;
  const newKeys = new Set(result.added);
  for (const card of pack.cards) {
    card.isNew = newKeys.has(`${card.n}|${card.printing}`);
    card.price = priceOf(card.n, card.printing);
  }

  app.session.packs += 1;
  for (const card of pack.cards) {
    app.session.byRarity[card.rarity] = (app.session.byRarity[card.rarity] || 0) + 1;
    if (card.price) app.session.value += card.price;
  }
  // Keep the local collection copy in step so the binder is instantly right.
  for (const card of pack.cards) {
    const key = `${card.n}|${card.printing}`;
    const existing = app.state.collection[key];
    if (existing) existing.count += 1;
    else app.state.collection[key] = { count: 1, firstAt: Date.now() };
  }

  notify();
  return pack;
}

export { mulberry32 };
