/**
 * Persistent state, written as JSON into Electron's per-user data directory.
 *
 * Everything the app remembers lives here: the binder, the pack wallet, the
 * lifetime stats and the tracker configuration.  Writes are debounced and go
 * through a temp file so a crash mid-save cannot corrupt a collection.
 */
import fs from 'node:fs';
import path from 'node:path';

const CURRENT_VERSION = 1;

export const DEFAULT_RULES = [
  {
    id: 'levelup',
    label: 'Pokemon levelled up',
    pattern: 'grew to level (\\d+)|leveled up to (\\d+)|Level up',
    packs: 1,
    everyN: 5,
    cooldownSec: 30,
    dailyCap: 12,
    enabled: true,
  },
  {
    id: 'catch',
    label: 'Pokemon caught',
    pattern: "caught (a |an |the )?[A-Z][\\w'-]+|Pokemon caught",
    packs: 1,
    everyN: 10,
    cooldownSec: 20,
    dailyCap: 10,
    enabled: true,
  },
  {
    id: 'shiny',
    label: 'Shiny encountered',
    pattern: 'shiny',
    packs: 5,
    everyN: 1,
    cooldownSec: 60,
    dailyCap: 20,
    enabled: true,
  },
  {
    id: 'badge',
    label: 'Gym badge earned',
    pattern: 'badge',
    packs: 10,
    everyN: 1,
    cooldownSec: 300,
    dailyCap: 20,
    enabled: true,
  },
  {
    id: 'boss',
    label: 'Boss or Elite Four defeated',
    pattern: 'defeated (the )?(boss|Elite Four|Champion)|You won against',
    packs: 5,
    everyN: 1,
    cooldownSec: 120,
    dailyCap: 20,
    enabled: true,
  },
  {
    id: 'quest',
    label: 'Quest completed',
    pattern: 'quest (completed|finished)|completed the quest',
    packs: 3,
    everyN: 1,
    cooldownSec: 120,
    dailyCap: 15,
    enabled: true,
  },
];

function emptyState() {
  return {
    version: CURRENT_VERSION,
    createdAt: new Date().toISOString(),
    wallet: { packs: 3, lifetimeEarned: 3, lifetimeOpened: 0 },
    // key is "<cardNumber>|<printing>"
    collection: {},
    stats: { byRarity: {}, godPacks: 0, packsOpened: 0 },
    history: [],
    tracker: {
      enabled: false,
      logDir: '',
      rules: DEFAULT_RULES,
      progress: {},   // ruleId -> { hits, awarded, lastAwardAt, day, dayCount }
      offsets: {},    // filePath -> bytes already read
      feed: [],
    },
  };
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = emptyState();
    this._timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = { ...emptyState(), ...parsed };
      // Merge nested defaults so an older save picks up new fields.
      const base = emptyState();
      for (const key of ['wallet', 'stats', 'tracker']) {
        this.state[key] = { ...base[key], ...(parsed[key] || {}) };
      }
      if (!Array.isArray(this.state.tracker.rules) || this.state.tracker.rules.length === 0) {
        this.state.tracker.rules = DEFAULT_RULES;
      }
    } catch {
      // No save yet, or an unreadable one - start clean rather than crash.
      this.state = emptyState();
    }
    return this.state;
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  /** Coalesce rapid updates into one write. */
  saveSoon() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      try { this.save(); } catch { /* disk full or locked; keep running */ }
    }, 400);
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    try { this.save(); } catch { /* ignore */ }
  }

  /** Fold an opened pack into the binder and the lifetime stats. */
  recordPack(pack) {
    const s = this.state;
    s.wallet.lifetimeOpened += 1;
    s.stats.packsOpened += 1;
    if (pack.godPack) s.stats.godPacks += 1;

    const added = [];
    for (const card of pack.cards) {
      const key = `${card.n}|${card.printing}`;
      const entry = s.collection[key];
      if (entry) {
        entry.count += 1;
      } else {
        s.collection[key] = { count: 1, firstAt: Date.now() };
        added.push(key);
      }
      s.stats.byRarity[card.rarity] = (s.stats.byRarity[card.rarity] || 0) + 1;
    }

    s.history.unshift({
      at: Date.now(),
      godPack: pack.godPack,
      cards: pack.cards.map((c) => ({ n: c.n, printing: c.printing, rarity: c.rarity })),
    });
    if (s.history.length > 500) s.history.length = 500;

    this.saveSoon();
    return { added };
  }

  addPacks(n, reason) {
    this.state.wallet.packs += n;
    this.state.wallet.lifetimeEarned += n;
    if (reason) {
      this.state.tracker.feed.unshift({ at: Date.now(), packs: n, reason });
      if (this.state.tracker.feed.length > 200) this.state.tracker.feed.length = 200;
    }
    this.saveSoon();
  }

  spendPack() {
    if (this.state.wallet.packs <= 0) return false;
    this.state.wallet.packs -= 1;
    this.saveSoon();
    return true;
  }
}

export default Store;
