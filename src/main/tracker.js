/**
 * Pokemon Revolution Online progress tracker.
 *
 * PRO has no public API for a player's own progress - the only documented API
 * is the server-side map scripting one, and the client keeps its settings in
 * the Windows registry.  What is reliably readable from outside is the log
 * file, so that is what this watches.
 *
 * PROShine writes one plain-text line per event to
 *     <PROShine>/Logs/<account>-<server>/YYYY-MM-DD.txt
 * (see PROShine/FileLogger.cs), appending as it goes.  Point the tracker at
 * that folder - or any folder whose .txt/.log files carry game events - and it
 * tails every file, matches new lines against the rules, and pays out packs.
 *
 * Because the exact wording depends on which client and which Lua script the
 * player runs, the rules are plain regexes the user can edit and test in the
 * UI rather than something baked into the binary.
 */
import fs from 'node:fs';
import path from 'node:path';

const WATCH_EXTENSIONS = new Set(['.txt', '.log']);
const POLL_MS = 2000;
const MAX_CHUNK = 512 * 1024; // don't try to swallow a huge file in one go

export class ProTracker {
  /**
   * @param {import('./store.js').Store} store
   * @param {(payload: object) => void} onAward called when packs are earned
   */
  constructor(store, onAward) {
    this.store = store;
    this.onAward = onAward;
    this.timer = null;
    this.watcher = null;
  }

  get config() { return this.store.state.tracker; }

  start() {
    this.stop();
    const cfg = this.config;
    if (!cfg.enabled || !cfg.logDir) return { ok: false, reason: 'disabled' };
    if (!fs.existsSync(cfg.logDir)) return { ok: false, reason: 'folder not found' };

    // Seed offsets to end-of-file on first sight so enabling the tracker does
    // not pay out for a month of history the player already played.
    for (const file of this.#logFiles()) {
      if (cfg.offsets[file] === undefined) {
        try { cfg.offsets[file] = fs.statSync(file).size; } catch { /* ignore */ }
      }
    }
    this.store.saveSoon();

    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
    return { ok: true, files: this.#logFiles().length };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  #logFiles() {
    const dir = this.config.logDir;
    const out = [];
    const walk = (d, depth) => {
      if (depth > 3) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (WATCH_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
      }
    };
    walk(dir, 0);
    return out;
  }

  /** Read whatever is new in each log file and run it through the rules. */
  poll() {
    const cfg = this.config;
    if (!cfg.enabled) return;
    const lines = [];

    for (const file of this.#logFiles()) {
      let stat;
      try { stat = fs.statSync(file); } catch { continue; }
      let from = cfg.offsets[file];
      if (from === undefined) from = stat.size;      // new file: start at its end
      if (stat.size < from) from = 0;                // file was rotated/truncated
      if (stat.size === from) continue;

      const start = Math.max(from, stat.size - MAX_CHUNK);
      let text = '';
      try {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        text = buf.toString('utf8');
      } catch { continue; }

      cfg.offsets[file] = stat.size;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }
    }

    if (lines.length) this.consume(lines);
    else this.store.saveSoon();
  }

  /** Match lines against the rules and award packs. Exposed for the UI tester. */
  consume(lines) {
    const cfg = this.config;
    const awards = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const line of lines) {
      for (const rule of cfg.rules) {
        if (!rule.enabled) continue;
        let re;
        try { re = new RegExp(rule.pattern, 'i'); } catch { continue; }
        if (!re.test(line)) continue;

        const p = cfg.progress[rule.id] || { hits: 0, awarded: 0, lastAwardAt: 0, day: today, dayCount: 0 };
        if (p.day !== today) { p.day = today; p.dayCount = 0; }

        p.hits += 1;

        const now = Date.now();
        const everyN = Math.max(1, rule.everyN || 1);
        const readyByCount = p.hits % everyN === 0;
        const offCooldown = now - (p.lastAwardAt || 0) >= (rule.cooldownSec || 0) * 1000;
        const underCap = p.dayCount < (rule.dailyCap ?? Infinity);

        if (readyByCount && offCooldown && underCap) {
          const packs = Math.max(1, rule.packs || 1);
          p.awarded += packs;
          p.lastAwardAt = now;
          p.dayCount += packs;
          this.store.addPacks(packs, `${rule.label} - ${line.slice(0, 120)}`);
          awards.push({ ruleId: rule.id, label: rule.label, packs, line });
        }
        cfg.progress[rule.id] = p;
        break; // one rule per line, first match wins
      }
    }

    this.store.saveSoon();
    if (awards.length && this.onAward) this.onAward(awards);
    return awards;
  }

  /**
   * Dry-run for the settings screen: which rule would each line hit?
   * Does not award anything or touch stored progress.
   */
  test(lines) {
    return lines.map((line) => {
      for (const rule of this.config.rules) {
        if (!rule.enabled) continue;
        let re;
        try { re = new RegExp(rule.pattern, 'i'); } catch { return { line, error: 'bad regex', ruleId: rule.id }; }
        const m = line.match(re);
        if (m) return { line, ruleId: rule.id, label: rule.label, packs: rule.packs, everyN: rule.everyN, matched: m[0] };
      }
      return { line, ruleId: null };
    });
  }

  /** Best-effort guess at where PROShine keeps its logs. */
  static guessLogDirs(home) {
    const candidates = [
      path.join(home, 'PROShine', 'Logs'),
      path.join(home, 'Documents', 'PROShine', 'Logs'),
      path.join(home, 'Desktop', 'PROShine', 'Logs'),
      path.join(home, 'Downloads', 'PROShine', 'Logs'),
      path.join(home, 'AppData', 'Roaming', 'PROShine', 'Logs'),
    ];
    return candidates.filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
  }
}

export default ProTracker;
