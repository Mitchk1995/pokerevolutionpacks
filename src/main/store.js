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
export const MAX_PACK_GRANT = 10_000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function boundedInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === '' || typeof value === 'boolean') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

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

const freshRules = () => DEFAULT_RULES.map((rule) => ({ ...rule }));

/** Keep persisted/user-edited rules finite and safe to apply to the wallet. */
export function normalizeRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return freshRules();

  return rules.slice(0, 100).map((raw, index) => {
    const rule = isObject(raw) ? raw : {};
    const fallback = DEFAULT_RULES.find((candidate) => candidate.id === rule.id) || {};
    const id = String(rule.id || fallback.id || `rule-${index + 1}`).slice(0, 64);
    return {
      id,
      label: String(rule.label || fallback.label || id).slice(0, 120),
      pattern: String(rule.pattern ?? fallback.pattern ?? '(?!)').slice(0, 2_000),
      packs: boundedInteger(rule.packs, fallback.packs || 1, 1, MAX_PACK_GRANT),
      everyN: boundedInteger(rule.everyN, fallback.everyN || 1, 1, 1_000_000),
      cooldownSec: boundedInteger(rule.cooldownSec, fallback.cooldownSec || 0, 0, 31_536_000),
      dailyCap: boundedInteger(rule.dailyCap, fallback.dailyCap ?? MAX_PACK_GRANT, 0, MAX_PACK_GRANT),
      enabled: rule.enabled !== false,
    };
  });
}

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
      rules: freshRules(),
      progress: {},   // ruleId -> { hits, awarded, lastAwardAt, day, dayCount }
      offsets: {},    // filePath -> bytes already read
      fileState: {},  // filePath -> identity + tail checkpoint for rotation detection
      feed: [],
    },
  };
}

function normalizeState(raw) {
  const parsed = isObject(raw) ? raw : {};
  const base = emptyState();
  const wallet = isObject(parsed.wallet) ? parsed.wallet : {};
  const stats = isObject(parsed.stats) ? parsed.stats : {};
  const tracker = isObject(parsed.tracker) ? parsed.tracker : {};

  const state = {
    ...base,
    ...parsed,
    version: CURRENT_VERSION,
    wallet: {
      packs: boundedInteger(wallet.packs, base.wallet.packs),
      lifetimeEarned: boundedInteger(wallet.lifetimeEarned, base.wallet.lifetimeEarned),
      lifetimeOpened: boundedInteger(wallet.lifetimeOpened, base.wallet.lifetimeOpened),
    },
    collection: isObject(parsed.collection) ? parsed.collection : {},
    stats: {
      byRarity: isObject(stats.byRarity) ? stats.byRarity : {},
      godPacks: boundedInteger(stats.godPacks, 0),
      packsOpened: boundedInteger(stats.packsOpened, 0),
    },
    history: Array.isArray(parsed.history) ? parsed.history.slice(0, 500) : [],
    tracker: {
      ...base.tracker,
      ...tracker,
      enabled: tracker.enabled === true,
      logDir: typeof tracker.logDir === 'string' ? tracker.logDir : '',
      rules: normalizeRules(tracker.rules),
      progress: isObject(tracker.progress) ? tracker.progress : {},
      offsets: isObject(tracker.offsets) ? tracker.offsets : {},
      fileState: isObject(tracker.fileState) ? tracker.fileState : {},
      feed: Array.isArray(tracker.feed) ? tracker.feed.slice(0, 200) : [],
    },
  };

  for (const [key, entry] of Object.entries(state.collection)) {
    if (!isObject(entry)) {
      delete state.collection[key];
      continue;
    }
    entry.count = boundedInteger(entry.count, 1, 1);
    entry.firstAt = boundedInteger(entry.firstAt, Date.now(), 0);
  }

  for (const [file, offset] of Object.entries(state.tracker.offsets)) {
    const clean = boundedInteger(offset, -1, 0);
    if (clean < 0) delete state.tracker.offsets[file];
    else state.tracker.offsets[file] = clean;
  }

  return state;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.state = emptyState();
    this.recovery = null;
    this._timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = normalizeState(parsed);
    } catch (error) {
      // Missing is a normal first launch. Preserve any unreadable/corrupt save
      // before starting clean so a later save cannot destroy the only copy.
      if (error?.code !== 'ENOENT') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backup = `${this.file}.corrupt-${stamp}.bak`;
        try {
          fs.mkdirSync(path.dirname(this.file), { recursive: true });
          fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL);
          this.recovery = { backup: path.basename(backup) };
        } catch {
          this.recovery = { backup: null };
        }
      }
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
    if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PACK_GRANT) return false;
    this.state.wallet.packs += n;
    this.state.wallet.lifetimeEarned += n;
    if (reason) {
      this.state.tracker.feed.unshift({ at: Date.now(), packs: n, reason: String(reason).slice(0, 240) });
      if (this.state.tracker.feed.length > 200) this.state.tracker.feed.length = 200;
    }
    this.saveSoon();
    return true;
  }

  spendPack() {
    if (this.state.wallet.packs <= 0) return false;
    this.state.wallet.packs -= 1;
    this.saveSoon();
    return true;
  }
}

export default Store;
