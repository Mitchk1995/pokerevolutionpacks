/**
 * Headless smoke test: boots the real app, drives it, and writes screenshots.
 * Run with:  xvfb-run -a npx electron tools/smoke.js
 */
import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_RULES } from '../src/main/store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SHOT_DIR || path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const errors = [];

// Minimal in-memory stand-ins for the real IPC handlers.
let wallet = { packs: 25, lifetimeEarned: 25, lifetimeOpened: 0 };
const collection = {};
ipcMain.handle('data:load', () => ({
  cards: readJson(path.join(ROOT, 'data/cards.me2pt5.json')),
  model: readJson(path.join(ROOT, 'data/pack-model.me2pt5.json')),
  prices: readJson(path.join(ROOT, 'data/prices.json')),
}));
ipcMain.handle('state:get', () => ({
  wallet, collection, stats: { byRarity: {}, godPacks: 0, packsOpened: 0 },
  history: [],
  tracker: { enabled: false, logDir: '', rules: [], progress: {}, feed: [] },
}));
ipcMain.handle('pack:spend', () => { wallet.packs -= 1; return { ok: true, wallet }; });
ipcMain.handle('pack:record', (_e, pack) => {
  const added = [];
  for (const c of pack.cards) {
    const k = `${c.n}|${c.printing}`;
    if (collection[k]) collection[k].count += 1;
    else { collection[k] = { count: 1, firstAt: Date.now() }; added.push(k); }
  }
  return { added, wallet, stats: { byRarity: {}, godPacks: 0, packsOpened: 0 } };
});
ipcMain.handle('packs:add', () => wallet);
ipcMain.handle('tracker:get', () => ({
  enabled: false, logDir: '', rules: DEFAULT_RULES,
  progress: {}, feed: [], suggestions: [],
}));
ipcMain.handle('tracker:set', () => ({ tracker: {}, status: { ok: false, reason: 'disabled' } }));
ipcMain.handle('tracker:test', (_e, lines) => lines.map((l) => ({ line: l, ruleId: null })));
ipcMain.handle('tracker:browse', () => null);
ipcMain.handle('prices:refresh', () => ({ ok: false, error: 'offline in smoke test' }));
ipcMain.handle('shell:open', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const target = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });

  const win = new BrowserWindow({
    // The window must actually be shown: Chromium freezes CSS animations and
    // requestAnimationFrame for hidden windows, which would leave every card
    // stuck on the first frame of its reveal animation.
    width: 1360, height: 900, show: true,
    webPreferences: {
      preload: path.join(ROOT, 'src/main/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) errors.push(`[console] ${message} (${source}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`[load-fail] ${code} ${desc} ${url}`);
  });

  await win.loadURL('app://local/src/renderer/index.html');
  await sleep(2500);

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    console.log(`  shot: ${name}.png`);
  };

  const click = async (js) => { await win.webContents.executeJavaScript(js); await sleep(700); };

  await shot('01-open-idle');

  // Rip a pack and step through the reveal.
  await click(`document.querySelector('.booster').click()`);
  await sleep(1200);
  await shot('02-reveal-first');

  // Advance to a hit (the holo slot is card 10).
  for (let i = 0; i < 8; i += 1) {
    await win.webContents.executeJavaScript(
      `document.querySelectorAll('.reveal-hud .btn')[0].click()`);
    await sleep(260);
  }
  await sleep(800);
  await shot('03-reveal-hit');

  await click(`document.querySelectorAll('.reveal-hud .btn')[0].click()`);
  await sleep(900);
  await shot('04-results');

  // Open a bunch more so the binder has something in it.
  await win.webContents.executeJavaScript(`(async () => {
    const m = await import('./js/store.js');
    for (let i = 0; i < 20; i++) await m.openOnePack();
  })()`);
  await sleep(2000);

  await click(`document.querySelector('[data-view="binder"]').click()`);
  await sleep(1200);
  await shot('05-binder');

  await click(`document.querySelectorAll('.binder .slot')[2].click()`);
  await sleep(1200);
  await shot('06-inspect');
  await click(`document.querySelector('.modal .close').click()`);

  await click(`document.querySelector('[data-view="odds"]').click()`);
  await sleep(900);
  await shot('07-odds');

  await click(`document.querySelector('[data-view="progress"]').click()`);
  await sleep(1200);
  await shot('08-pro-link');

  // Render one card of every foil style, mid-sweep, so all nine holo
  // treatments can be eyeballed in a single frame.
  await win.webContents.executeJavaScript(`(async () => {
    const { createCard } = await import('./js/card.js');
    const { app } = await import('./js/store.js');
    const view = document.getElementById('view');
    view.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:18px;padding:26px';
    const want = ['Common','Rare','Double Rare','Ultra Rare','Illustration Rare',
                  'Special Illustration Rare','MEGA_ATTACK_RARE','Mega Hyper Rare'];
    for (const rarity of want) {
      const card = app.data.cards.cards.find(c => c.rarity === rarity);
      const cell = document.createElement('div');
      const node = createCard({ ...card, foilStyle: card.foil, printing: 'holo' }, { assetBase: '../../assets' });
      const cap = document.createElement('div');
      cap.style.cssText = 'font-family:var(--pixel);font-size:7px;color:#a29dbd;margin-top:8px;text-align:center';
      cap.textContent = rarity;
      cell.append(node, cap);
      wrap.append(cell);
      node.showcase(9000);
    }
    // and a reverse holo
    const rev = app.data.cards.cards.find(c => c.reverseStyles.length);
    const cell = document.createElement('div');
    const node = createCard({ ...rev, foilStyle: 'reverse-holo', printing: 'reverse' }, { assetBase: '../../assets' });
    const cap = document.createElement('div');
    cap.style.cssText = 'font-family:var(--pixel);font-size:7px;color:#a29dbd;margin-top:8px;text-align:center';
    cap.textContent = 'Reverse Holo';
    cell.append(node, cap);
    wrap.append(cell);
    node.showcase(9000);
    view.append(wrap);
  })()`);
  await sleep(2600);
  await shot('09-foil-gallery');
  await sleep(1400);
  await shot('10-foil-gallery-b');

  const info = await win.webContents.executeJavaScript(`({
    cards: document.querySelectorAll('.binder .slot').length,
    imagesBroken: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src).slice(0, 8),
    font: getComputedStyle(document.querySelector('.brand')).fontFamily,
    activeTabs: [...document.querySelectorAll('nav.tabs button.active')].map(b => b.dataset.view),
    shineOpacity: (() => {
      const s = document.querySelector('.card__shine');
      return s ? getComputedStyle(s).opacity : null;
    })(),
  })`);
  console.log('\nrenderer report:', JSON.stringify(info, null, 2));

  if (errors.length) {
    console.log('\nERRORS:');
    for (const e of errors) console.log('  ' + e);
  } else {
    console.log('\nno console errors');
  }
  app.quit();
  process.exit(errors.length ? 1 : 0);
});
