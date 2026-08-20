import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MAX_PACK_GRANT, Store } from '../src/main/store.js';

function scratchFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prostore-'));
  return { dir, file: path.join(dir, 'collection.json') };
}

test('pack grants reject non-finite, fractional, and excessive values', () => {
  const { file } = scratchFile();
  const store = new Store(file);
  const before = { ...store.state.wallet };

  for (const value of [Infinity, NaN, 1.5, 0, -1, MAX_PACK_GRANT + 1]) {
    assert.equal(store.addPacks(value, 'invalid'), false, `reject ${String(value)}`);
  }
  assert.deepEqual(store.state.wallet, before);

  assert.equal(store.addPacks(2, 'valid'), true);
  assert.equal(store.state.wallet.packs, before.packs + 2);
});

test('a corrupt save is preserved before the store starts clean', () => {
  const { dir, file } = scratchFile();
  fs.writeFileSync(file, '{ definitely not json');

  const store = new Store(file);
  assert.equal(store.state.wallet.packs, 3);
  assert.ok(store.recovery?.backup, 'recovery metadata names the preserved backup');

  const backup = path.join(dir, store.recovery.backup);
  assert.equal(fs.readFileSync(backup, 'utf8'), '{ definitely not json');
});

test('loaded numeric state and reward rules are normalized', () => {
  const { file } = scratchFile();
  fs.writeFileSync(file, JSON.stringify({
    wallet: { packs: null, lifetimeEarned: Infinity, lifetimeOpened: -5 },
    tracker: {
      rules: [{
        id: 'custom', label: 'Custom', pattern: 'win', enabled: true,
        packs: 2.5, everyN: 0, cooldownSec: -1, dailyCap: MAX_PACK_GRANT + 1,
      }],
    },
  }));

  const store = new Store(file);
  assert.deepEqual(store.state.wallet, { packs: 3, lifetimeEarned: 3, lifetimeOpened: 0 });
  assert.deepEqual(store.state.tracker.rules[0], {
    id: 'custom', label: 'Custom', pattern: 'win', enabled: true,
    packs: 1, everyN: 1, cooldownSec: 0, dailyCap: MAX_PACK_GRANT,
  });
});
