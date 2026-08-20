/**
 * Validates the simulator against the published Ascended Heroes pull rates.
 *
 * Run with: npm test
 *
 * The statistical tests use a fixed PRNG seed so they are deterministic and
 * cannot flake; the tolerances below are still wide enough that any real
 * change to the odds model will trip them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PackEngine, mulberry32 } from '../src/shared/pack-engine.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cards = JSON.parse(fs.readFileSync(path.join(root, 'data/cards.me2pt5.json'), 'utf8')).cards;
const model = JSON.parse(fs.readFileSync(path.join(root, 'data/pack-model.me2pt5.json'), 'utf8'));

const engine = (seed = 1) => new PackEngine({ cards, model, random: mulberry32(seed) });

/** Published rates, from the TCGplayer 2,000+ pack study. */
const PUBLISHED = {
  'Double Rare': 1 / 5,
  'Illustration Rare': 1 / 9,
  'Ultra Rare': 1 / 21,
  MEGA_ATTACK_RARE: 1 / 29,
  'Special Illustration Rare': 1 / 70,
  'Mega Hyper Rare': 1 / 540,
};

const SAMPLE = 1_000_000;

/** Open a lot of packs once and reuse the tally across the statistical tests. */
const survey = (() => {
  const e = engine(20260130);
  const packsWith = {};      // tallied over normal packs only
  const packsWithAny = {};   // tallied over every pack, god packs included
  const cardCount = {};
  let god = 0;
  let totalCards = 0;
  let dupPacks = 0;
  let sizeErrors = 0;

  for (let i = 0; i < SAMPLE; i += 1) {
    const pack = e.openPack();
    if (pack.godPack) god += 1;
    if (pack.cards.length !== 10) sizeErrors += 1;
    totalCards += pack.cards.length;

    const seen = new Set();
    const rarities = new Set();
    for (const c of pack.cards) {
      if (seen.has(c.n)) dupPacks += 1;
      seen.add(c.n);
      cardCount[c.rarity] = (cardCount[c.rarity] || 0) + 1;
      // A reverse-holo Rare is not a "Rare pull" in pull-rate terms - the
      // published rates count the holo slot, so only count non-reverse cards.
      if (!c.isReverse) rarities.add(c.rarity);
    }
    for (const r of rarities) {
      packsWithAny[r] = (packsWithAny[r] || 0) + 1;
      if (!pack.godPack) packsWith[r] = (packsWith[r] || 0) + 1;
    }
  }
  return { packsWith, packsWithAny, cardCount, god, totalCards, dupPacks, sizeErrors, normalPacks: SAMPLE - god };
})();

test('every pack contains exactly 10 cards', () => {
  assert.equal(survey.sizeErrors, 0);
  assert.equal(survey.totalCards, SAMPLE * 10);
});

test('no pack ever contains the same card twice', () => {
  assert.equal(survey.dupPacks, 0);
});

test('pack structure matches the Scarlet & Violet configuration', () => {
  const e = engine(7);
  for (let i = 0; i < 5000; i += 1) {
    const pack = e.openPack();
    if (pack.godPack) continue;
    const slots = pack.cards.map((c) => c.slot);
    assert.deepEqual(slots, ['c1', 'c2', 'c3', 'c4', 'u1', 'u2', 'u3', 'rh1', 'rh2', 'hit']);

    // 4 commons then 3 uncommons, all non-foil.
    for (const c of pack.cards.slice(0, 4)) {
      assert.equal(c.rarity, 'Common');
      assert.equal(c.printing, 'normal');
    }
    for (const c of pack.cards.slice(4, 7)) {
      assert.equal(c.rarity, 'Uncommon');
      assert.equal(c.printing, 'normal');
    }
    // First reverse slot is always a reverse holo.
    assert.equal(pack.cards[7].isReverse, true);
    // Second reverse slot is a reverse holo unless an IR/SIR displaced it.
    const rh2 = pack.cards[8];
    assert.ok(rh2.isReverse || ['Illustration Rare', 'Special Illustration Rare'].includes(rh2.rarity));
    // The holo slot is always Rare or better, never a reverse.
    const hit = pack.cards[9];
    assert.equal(hit.isReverse, false);
    assert.ok(['Rare', 'Double Rare', 'Ultra Rare', 'MEGA_ATTACK_RARE', 'Mega Hyper Rare'].includes(hit.rarity));
  }
});

test('reverse-holo slots only draw cards that have a reverse printing', () => {
  const e = engine(99);
  for (let i = 0; i < 20000; i += 1) {
    const pack = e.openPack();
    if (pack.godPack) continue;
    for (const c of pack.cards) {
      if (!c.isReverse) continue;
      assert.ok(['Common', 'Uncommon', 'Rare'].includes(c.rarity),
        `${c.name} (${c.rarity}) has no reverse-holo printing in this set`);
      assert.ok(c.reverseStyles.includes(c.reverseStyle));
    }
  }
});

test('observed pull rates match the published TCGplayer figures', () => {
  // The TCGplayer study excluded god packs, so measure normal packs only.
  const n = survey.normalPacks;
  const report = [];
  for (const [rarity, expected] of Object.entries(PUBLISHED)) {
    const observed = survey.packsWith[rarity] / n;
    // Tolerance scaled to the sampling error of this rarity (6 sigma), with a
    // small floor so the very rare tiers stay meaningful.
    const sigma = Math.sqrt((expected * (1 - expected)) / n);
    const tolerance = Math.max(6 * sigma, expected * 0.02);
    report.push(`${rarity}: 1 in ${(1 / observed).toFixed(1)} (published 1 in ${(1 / expected).toFixed(0)})`);
    assert.ok(Math.abs(observed - expected) <= tolerance,
      `${rarity}: observed ${observed.toFixed(6)} vs published ${expected.toFixed(6)} (tolerance ${tolerance.toFixed(6)})`);
  }
  console.log('   ' + report.join('\n   '));
});

test('god packs appear at the configured rate and hold 3 MAR + 7 SIR', () => {
  const expected = model.godPack.rate;
  const observed = survey.god / SAMPLE;
  const sigma = Math.sqrt((expected * (1 - expected)) / SAMPLE);
  assert.ok(Math.abs(observed - expected) <= 6 * sigma,
    `god pack rate ${observed} vs expected ${expected}`);

  // Force one and check its contents.
  const forced = new PackEngine({ cards, model, random: () => 0 });
  const pack = forced.openPack();
  assert.equal(pack.godPack, true);
  assert.equal(pack.cards.length, 10);
  assert.equal(pack.cards.filter((c) => c.rarity === 'MEGA_ATTACK_RARE').length, 3);
  assert.equal(pack.cards.filter((c) => c.rarity === 'Special Illustration Rare').length, 7);
});

test('the holo slot is a Rare roughly 71.6% of the time', () => {
  // 1 - (0.2 + 1/21 + 1/29 + 1/540) = 0.716046
  const observed = survey.packsWith.Rare / survey.normalPacks;
  assert.ok(Math.abs(observed - 0.716046) < 0.004, `Rare slot share ${observed}`);
});

test('theoretical rates derived from the model agree with the published ones', () => {
  const rates = engine().theoreticalRates({ excludeGodPacks: true });
  for (const [rarity, expected] of Object.entries(PUBLISHED)) {
    assert.ok(Math.abs(rates[rarity] - expected) < 1e-9,
      `${rarity}: model says ${rates[rarity]}, published ${expected}`);
  }
});

test('god packs lift the overall MAR and SIR rates slightly above the published ones', () => {
  // Sanity-check the one place the simulator knowingly departs from the
  // published numbers: those were measured with god packs removed, so across
  // *all* packs the two rarities a god pack contains must come out higher.
  const all = engine().theoreticalRates();
  const normalOnly = engine().theoreticalRates({ excludeGodPacks: true });
  for (const rarity of ['MEGA_ATTACK_RARE', 'Special Illustration Rare']) {
    assert.ok(all[rarity] > normalOnly[rarity], `${rarity} should be lifted by god packs`);
    const observed = survey.packsWithAny[rarity] / SAMPLE;
    assert.ok(Math.abs(observed - all[rarity]) < all[rarity] * 0.05,
      `${rarity}: all-packs rate ${observed} vs model ${all[rarity]}`);
  }
  // Rarities a god pack does not contain are unaffected.
  assert.equal(all['Double Rare'] < normalOnly['Double Rare'], true);
});

test('every card drawn is a real card from the set', () => {
  const valid = new Set(cards.map((c) => c.n));
  const e = engine(5);
  for (let i = 0; i < 20000; i += 1) {
    for (const c of e.openPack().cards) assert.ok(valid.has(c.n));
  }
});

test('the whole set is reachable - every card can be pulled', () => {
  const e = engine(3);
  const seen = new Set();
  for (let i = 0; i < 400000 && seen.size < cards.length; i += 1) {
    for (const c of e.openPack().cards) seen.add(c.n);
  }
  const missing = cards.filter((c) => !seen.has(c.n)).map((c) => `${c.n} ${c.name}`);
  assert.deepEqual(missing, [], `unreachable cards: ${missing.join(', ')}`);
});

test('a seed reproduces the same packs exactly', () => {
  const a = engine(1234).openPack();
  const b = engine(1234).openPack();
  assert.deepEqual(a.cards.map((c) => [c.n, c.printing]), b.cards.map((c) => [c.n, c.printing]));
});
