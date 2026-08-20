/**
 * PRO Link tracker: does tailing a log folder actually award packs?
 *
 * Uses a temp directory laid out the way PROShine writes its logs
 * (Logs/<account>-<server>/YYYY-MM-DD.txt).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Store, DEFAULT_RULES } from '../src/main/store.js';
import { ProTracker } from '../src/main/tracker.js';

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proline-'));
  const logs = path.join(dir, 'Logs', 'Ash-Silver');
  fs.mkdirSync(logs, { recursive: true });
  const store = new Store(path.join(dir, 'collection.json'));
  store.state.tracker.enabled = true;
  store.state.tracker.logDir = path.join(dir, 'Logs');
  return { dir, logs, store };
}

const append = (file, ...lines) => fs.appendFileSync(file, lines.join('\n') + '\n');

test('a matching log line awards packs', () => {
  const { logs, store } = scratch();
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  fs.writeFileSync(file, 'existing history that must not pay out\n');

  tracker.start();     // seeds offsets to end-of-file
  const before = store.state.wallet.packs;

  append(file, 'You have earned the Boulder Badge!');
  tracker.poll();

  assert.equal(store.state.wallet.packs, before + 10, 'badge rule pays 10 packs');
  tracker.stop();
});

test('history present before enabling is not paid out', () => {
  const { logs, store } = scratch();
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  // A month of back-log, full of things that would otherwise all match.
  fs.writeFileSync(file, Array.from({ length: 500 },
    (_, i) => `Your Pikachu grew to level ${i}!`).join('\n') + '\n');

  const before = store.state.wallet.packs;
  tracker.start();
  tracker.poll();

  assert.equal(store.state.wallet.packs, before, 'existing lines are skipped');
  tracker.stop();
});

test('a log file created after startup is read from its first line', () => {
  const { logs, store } = scratch();
  store.state.tracker.rules = [{
    id: 'badge', label: 'Badge', pattern: 'badge',
    packs: 1, everyN: 1, cooldownSec: 0, dailyCap: 10, enabled: true,
  }];
  const tracker = new ProTracker(store, () => {});
  tracker.start();

  const file = path.join(logs, '2026-08-21.txt');
  fs.writeFileSync(file, 'You have earned the Boulder Badge!\n');
  const before = store.state.wallet.packs;

  tracker.poll();
  assert.equal(store.state.wallet.packs, before + 1, 'the first event in a new daily log is paid');
  assert.equal(store.state.tracker.offsets[file], fs.statSync(file).size, 'the read offset is persisted');

  append(file, 'You have earned the Cascade Badge!');
  tracker.poll();
  assert.equal(store.state.wallet.packs, before + 2, 'later lines in that file are tailed');
  tracker.stop();
});

test('everyN means only every Nth match pays', () => {
  const { logs, store } = scratch();
  // Catch rule: 1 pack every 10 matches, no cooldown for this test.
  store.state.tracker.rules = [{
    id: 'catch', label: 'Pokemon caught', pattern: 'caught',
    packs: 1, everyN: 10, cooldownSec: 0, dailyCap: 99, enabled: true,
  }];
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  fs.writeFileSync(file, '');
  tracker.start();

  const before = store.state.wallet.packs;
  for (let i = 0; i < 25; i += 1) append(file, `You caught a Rattata (${i})`);
  tracker.poll();

  assert.equal(store.state.wallet.packs, before + 2, '25 catches at every-10 = 2 packs');
  tracker.stop();
});

test('the daily cap holds', () => {
  const { logs, store } = scratch();
  store.state.tracker.rules = [{
    id: 'shiny', label: 'Shiny', pattern: 'shiny',
    packs: 5, everyN: 1, cooldownSec: 0, dailyCap: 12, enabled: true,
  }];
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  fs.writeFileSync(file, '');
  tracker.start();

  const before = store.state.wallet.packs;
  for (let i = 0; i < 20; i += 1) append(file, 'A wild shiny Gyarados appeared!');
  tracker.poll();

  const gained = store.state.wallet.packs - before;
  assert.equal(gained, 12, 'the last award is clamped to the remaining daily allowance');
  assert.equal(store.state.tracker.progress.shiny.dayCount, 12);
  tracker.stop();
});

test('a disabled rule never fires', () => {
  const { logs, store } = scratch();
  store.state.tracker.rules = store.state.tracker.rules.map((r) => ({ ...r, enabled: false }));
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  fs.writeFileSync(file, '');
  tracker.start();

  const before = store.state.wallet.packs;
  append(file, 'You have earned the Boulder Badge!', 'A wild shiny Gyarados appeared!');
  tracker.poll();

  assert.equal(store.state.wallet.packs, before);
  tracker.stop();
});

test('logs in nested per-account folders are all watched', () => {
  const { dir, store } = scratch();
  const a = path.join(dir, 'Logs', 'Ash-Silver');
  const b = path.join(dir, 'Logs', 'Misty-Gold');
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(a, '2026-08-20.txt'), '');
  fs.writeFileSync(path.join(b, '2026-08-20.txt'), '');

  const tracker = new ProTracker(store, () => {});
  tracker.start();
  const before = store.state.wallet.packs;

  append(path.join(b, '2026-08-20.txt'), 'You have earned the Cascade Badge!');
  tracker.poll();

  assert.equal(store.state.wallet.packs, before + 10, 'second account folder is watched too');
  tracker.stop();
});

test('a truncated or rotated log is re-read from the start, not skipped', () => {
  const { logs, store } = scratch();
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  fs.writeFileSync(file, 'a'.repeat(4000) + '\n');
  tracker.start();

  const before = store.state.wallet.packs;
  fs.writeFileSync(file, 'You have earned the Thunder Badge!\n');  // shorter than before
  tracker.poll();

  assert.equal(store.state.wallet.packs, before + 10);
  tracker.stop();
});

test('an equal-size rewritten log is detected and read from the start', () => {
  const { logs, store } = scratch();
  store.state.tracker.rules = [{
    id: 'badge', label: 'Badge', pattern: 'badge',
    packs: 1, everyN: 1, cooldownSec: 0, dailyCap: 10, enabled: true,
  }];
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  const original = `${'x'.repeat(100)}\n`;
  fs.writeFileSync(file, original);
  tracker.start();

  const replacement = 'You have earned the Boulder Badge!'.padEnd(original.length - 1, ' ') + '\n';
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
  const before = store.state.wallet.packs;
  fs.writeFileSync(file, replacement);
  tracker.poll();

  assert.equal(store.state.wallet.packs, before + 1);
  tracker.stop();
});

test('a malformed regex in a rule does not crash the watcher', () => {
  const { logs, store } = scratch();
  store.state.tracker.rules = [
    { id: 'bad', label: 'Broken', pattern: '([unclosed', packs: 1, everyN: 1, enabled: true },
    ...DEFAULT_RULES,
  ];
  const tracker = new ProTracker(store, () => {});
  const file = path.join(logs, '2026-08-20.txt');
  fs.writeFileSync(file, '');
  tracker.start();

  const before = store.state.wallet.packs;
  assert.doesNotThrow(() => {
    append(file, 'You have earned the Boulder Badge!');
    tracker.poll();
  });
  assert.equal(store.state.wallet.packs, before + 10, 'valid rules still fire');
  tracker.stop();
});

test('the rule tester reports matches without awarding anything', () => {
  const { store } = scratch();
  const tracker = new ProTracker(store, () => {});
  const before = store.state.wallet.packs;

  const results = tracker.test([
    'You have earned the Boulder Badge!',
    'nothing interesting happened',
  ]);

  assert.equal(results[0].ruleId, 'badge');
  assert.equal(results[1].ruleId, null);
  assert.equal(store.state.wallet.packs, before, 'the tester must not pay out');
});

test('the collection survives a save and reload', () => {
  const { dir, store } = scratch();
  store.recordPack({
    godPack: false,
    cards: [{ n: 1, printing: 'normal', rarity: 'Common' },
            { n: 295, printing: 'holo', rarity: 'Mega Hyper Rare' }],
  });
  store.flush();

  const reloaded = new Store(path.join(dir, 'collection.json'));
  assert.equal(reloaded.state.collection['1|normal'].count, 1);
  assert.equal(reloaded.state.collection['295|holo'].count, 1);
  assert.equal(reloaded.state.stats.byRarity['Mega Hyper Rare'], 1);
  assert.equal(reloaded.state.wallet.lifetimeOpened, 1);
});
