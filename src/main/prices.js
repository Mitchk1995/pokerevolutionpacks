/**
 * Refreshes TCGplayer market prices from tcgcsv.com, a free daily mirror of
 * the TCGplayer price feed (no API key needed).
 *
 * Keys match the ones the app already uses: "<cardNumber>|<printing>", where
 * printing is normal | holo | reverse | reverse_pokeball | reverse_energy.
 */
import fs from 'node:fs';

const CATEGORY = 3;     // Pokemon
const GROUP = 24541;    // ME: Ascended Heroes

const PRODUCTS_URL = `https://tcgcsv.com/tcgplayer/${CATEGORY}/${GROUP}/products`;
const PRICES_URL = `https://tcgcsv.com/tcgplayer/${CATEGORY}/${GROUP}/prices`;

function variantOf(name) {
  if (name.includes('(Poke Ball)')) return 'pokeball';
  if (name.includes('(Energy Symbol Pattern)')) return 'energy';
  return 'base';
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pokerevolutionpacks/1.0' } });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}

export async function refreshPrices(file) {
  const [products, prices] = await Promise.all([
    getJson(PRODUCTS_URL).then((d) => d.results),
    getJson(PRICES_URL).then((d) => d.results),
  ]);

  const bySubtype = new Map();
  for (const row of prices) {
    if (!bySubtype.has(row.productId)) bySubtype.set(row.productId, {});
    bySubtype.get(row.productId)[row.subTypeName] = row;
  }

  const money = (row) => (row ? {
    market: row.marketPrice, low: row.lowPrice, mid: row.midPrice, high: row.highPrice,
  } : null);

  const book = {};
  for (const p of products) {
    const ext = Object.fromEntries((p.extendedData || []).map((e) => [e.name, e.value]));
    if (!ext.Number) continue;                       // sealed product
    const num = String(parseInt(ext.Number.split('/')[0], 10));
    const variant = variantOf(p.name);
    const subs = bySubtype.get(p.productId) || {};

    if (variant === 'base') {
      if (subs.Normal) book[`${num}|normal`] = money(subs.Normal);
      if (subs.Holofoil) book[`${num}|holo`] = money(subs.Holofoil);
      if (subs['Reverse Holofoil']) book[`${num}|reverse`] = money(subs['Reverse Holofoil']);
    } else if (subs['Reverse Holofoil']) {
      book[`${num}|reverse_${variant}`] = money(subs['Reverse Holofoil']);
    }
  }

  if (Object.keys(book).length === 0) throw new Error('price feed returned no card prices');

  const payload = {
    source: 'TCGplayer via tcgcsv.com',
    updatedAt: new Date().toISOString(),
    currency: 'USD',
    prices: book,
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  return { count: Object.keys(book).length, updatedAt: payload.updatedAt, prices: book };
}
