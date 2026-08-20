/**
 * Ascended Heroes pack simulation.
 *
 * Pure and dependency-free so it can run in the renderer, in the main process,
 * and under `node --test` without any of them.  Every probability comes from
 * data/pack-model.me2pt5.json - nothing is hardcoded here.
 */

/** Deterministic PRNG (mulberry32) so tests and "seeded rips" are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REVERSE_PRINTING = {
  standard: 'reverse',
  pokeball: 'reverse_pokeball',
  energy: 'reverse_energy',
};

export class PackEngine {
  /**
   * @param {object}   opts
   * @param {object[]} opts.cards  card records from data/cards.me2pt5.json
   * @param {object}   opts.model  the pack model from data/pack-model.me2pt5.json
   * @param {Function} [opts.random] () => [0,1)
   */
  constructor({ cards, model, random = Math.random }) {
    this.cards = cards;
    this.model = model;
    this.random = random;

    this.byRarity = new Map();
    for (const card of cards) {
      if (!this.byRarity.has(card.rarity)) this.byRarity.set(card.rarity, []);
      this.byRarity.get(card.rarity).push(card);
    }
    // The reverse-holo slot draws from every card that has a reverse printing:
    // in this set that is the 178 Commons/Uncommons/Rares.  Double Rares and
    // all secret rares have no reverse-holo version.
    this.reversePool = cards.filter((c) => c.reverseStyles && c.reverseStyles.length > 0);

    for (const slot of model.slots) {
      if (slot.kind === 'pool' && !this.byRarity.has(slot.rarity)) {
        throw new Error(`pack model wants rarity "${slot.rarity}" but the set has none`);
      }
    }
    if (this.reversePool.length === 0) {
      throw new Error('no cards in this set have a reverse-holo printing');
    }
  }

  #pick(pool, used) {
    // Real packs never contain the same card twice.  Pools are far larger than
    // the number of draws, so rejection sampling terminates immediately.
    for (let i = 0; i < 64; i += 1) {
      const card = pool[Math.floor(this.random() * pool.length)];
      if (!used.has(card.n)) return card;
    }
    const free = pool.filter((c) => !used.has(c.n));
    if (free.length === 0) return pool[Math.floor(this.random() * pool.length)];
    return free[Math.floor(this.random() * free.length)];
  }

  #draw(rarity, used, { printing = 'holo', slot, label } = {}) {
    const pool = this.byRarity.get(rarity) || [];
    const card = this.#pick(pool, used);
    used.add(card.n);
    return this.#pulled(card, printing, slot, label);
  }

  #pulled(card, printing, slot, label, reverseStyle = null) {
    const isReverse = printing.startsWith('reverse');
    return {
      ...card,
      printing,
      reverseStyle,
      // A Rare pulled in the reverse slot wears the reverse-holo foil, not the
      // holo-rare one, exactly as the physical card does.
      foilStyle: isReverse ? 'reverse-holo' : card.foil,
      slot,
      slotLabel: label,
      isReverse,
      isHit: !isReverse && card.foil !== 'none' && card.rarity !== 'Rare',
    };
  }

  #drawReverse(used, slot, label) {
    const card = this.#pick(this.reversePool, used);
    used.add(card.n);
    const styles = card.reverseStyles;
    const style = styles[Math.floor(this.random() * styles.length)];
    return this.#pulled(card, REVERSE_PRINTING[style] || 'reverse', slot, label, style);
  }

  /** Roll a weighted outcome list; entries with p === 'remainder' catch the rest. */
  #rollOutcome(outcomes) {
    const roll = this.random();
    let acc = 0;
    let fallback = null;
    for (const o of outcomes) {
      if (o.p === 'remainder') { fallback = o; continue; }
      acc += o.p;
      if (roll < acc) return o;
    }
    return fallback;
  }

  #openGodPack() {
    const used = new Set();
    const cards = [];
    for (const entry of this.model.godPack.contents) {
      for (let i = 0; i < entry.count; i += 1) {
        cards.push(this.#draw(entry.rarity, used, {
          printing: 'holo',
          slot: `god${cards.length + 1}`,
          label: 'God Pack',
        }));
      }
    }
    return { godPack: true, cards };
  }

  /** Open one pack. Returns { godPack, cards[] } in physical pack order. */
  openPack() {
    const god = this.model.godPack;
    if (god && god.enabled && this.random() < god.rate) return this.#openGodPack();

    const used = new Set();
    const cards = [];

    for (const slot of this.model.slots) {
      if (slot.kind === 'pool') {
        cards.push(this.#draw(slot.rarity, used, {
          printing: slot.printing === 'normal' ? 'normal' : 'holo',
          slot: slot.id,
          label: slot.rarity,
        }));
      } else if (slot.kind === 'reverse') {
        const upgrade = slot.upgrades ? this.#rollOutcome([...slot.upgrades, { p: 'remainder', reverse: true }]) : null;
        if (upgrade && !upgrade.reverse) {
          cards.push(this.#draw(upgrade.rarity, used, { printing: 'holo', slot: slot.id, label: slot.label }));
        } else {
          cards.push(this.#drawReverse(used, slot.id, slot.label || 'Reverse Holo'));
        }
      } else if (slot.kind === 'hit') {
        const outcome = this.#rollOutcome(slot.outcomes);
        cards.push(this.#draw(outcome.rarity, used, { printing: 'holo', slot: slot.id, label: slot.label }));
      }
    }

    return { godPack: false, cards };
  }

  /**
   * The per-pack probability of seeing at least one card of each rarity,
   * derived from the model itself.  The odds screen shows this next to
   * measured results so the two can be compared.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.excludeGodPacks] Report rates conditional on a
   *   normal (non-god) pack. This is how the published TCGplayer figures were
   *   measured, so it is the right mode for comparing against them.
   */
  theoreticalRates({ excludeGodPacks = false } = {}) {
    const rates = {};
    const add = (rarity, p) => { rates[rarity] = (rates[rarity] || 0) + p; };
    const god = this.model.godPack;
    const godRate = excludeGodPacks || !god || !god.enabled ? 0 : god.rate;
    const normal = 1 - godRate;

    for (const slot of this.model.slots) {
      if (slot.kind === 'reverse' && slot.upgrades) {
        for (const u of slot.upgrades) add(u.rarity, u.p * normal);
      } else if (slot.kind === 'hit') {
        let used = 0;
        for (const o of slot.outcomes) if (o.p !== 'remainder') used += o.p;
        for (const o of slot.outcomes) {
          add(o.rarity, (o.p === 'remainder' ? 1 - used : o.p) * normal);
        }
      }
    }
    if (godRate > 0) for (const e of god.contents) add(e.rarity, godRate);
    return rates;
  }
}

export default PackEngine;
