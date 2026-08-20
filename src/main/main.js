/**
 * Electron main process: window, IPC surface, and the background services
 * (progress tracker + price refresh).
 */
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Store, DEFAULT_RULES } from './store.js';
import { ProTracker } from './tracker.js';
import { refreshPrices } from './prices.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

let win = null;
let store = null;
let tracker = null;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// The renderer is served over app:// rather than file://. ES module imports
// and a meaningful CSP both need a real origin, and file:// has none.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

function serveAppProtocol() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const target = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    // Never serve anything outside the app directory.
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

/** Where refreshed prices are written. The app directory is read-only once
 *  packaged, so updates live alongside the save file instead. */
function livePricesFile() {
  return path.join(app.getPath('userData'), 'prices.json');
}

function loadPrices() {
  // Prefer a refreshed copy, but never let a corrupt one break startup.
  try {
    const live = readJson(livePricesFile());
    if (live && live.prices && Object.keys(live.prices).length) return live;
  } catch { /* fall through to the bundled snapshot */ }
  return readJson(path.join(ROOT, 'data', 'prices.json'));
}

function loadStaticData() {
  return {
    cards: readJson(path.join(ROOT, 'data', 'cards.me2pt5.json')),
    model: readJson(path.join(ROOT, 'data', 'pack-model.me2pt5.json')),
    prices: loadPrices(),
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#12101c',
    show: false,
    autoHideMenuBar: true,
    title: 'PokeRevolution Packs',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL('app://local/src/renderer/index.html');

  // External links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  serveAppProtocol();
  store = new Store(path.join(app.getPath('userData'), 'collection.json'));
  tracker = new ProTracker(store, (awards) => {
    if (win && !win.isDestroyed()) win.webContents.send('tracker:award', awards);
  });
  if (store.state.tracker.enabled) tracker.start();

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  tracker?.stop();
  store?.flush();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => store?.flush());

/* ------------------------------------------------------------------ IPC */

ipcMain.handle('data:load', () => loadStaticData());
ipcMain.handle('state:get', () => store.state);

ipcMain.handle('pack:spend', () => ({ ok: store.spendPack(), wallet: store.state.wallet }));

ipcMain.handle('pack:record', (_e, pack) => {
  const result = store.recordPack(pack);
  return { ...result, wallet: store.state.wallet, stats: store.state.stats };
});

ipcMain.handle('packs:add', (_e, { count, reason }) => {
  store.addPacks(Math.max(1, Number(count) || 1), reason || 'Manually added');
  return store.state.wallet;
});

ipcMain.handle('tracker:get', () => ({
  ...store.state.tracker,
  suggestions: ProTracker.guessLogDirs(os.homedir()),
  defaults: DEFAULT_RULES,
}));

ipcMain.handle('tracker:set', (_e, patch) => {
  const cfg = store.state.tracker;
  if (patch.logDir !== undefined && patch.logDir !== cfg.logDir) {
    cfg.logDir = patch.logDir;
    cfg.offsets = {};   // new folder, start fresh at its current end
  }
  if (patch.enabled !== undefined) cfg.enabled = !!patch.enabled;
  if (patch.rules !== undefined) cfg.rules = patch.rules;
  store.saveSoon();

  const status = cfg.enabled ? tracker.start() : (tracker.stop(), { ok: false, reason: 'disabled' });
  return { tracker: cfg, status };
});

ipcMain.handle('tracker:test', (_e, lines) => tracker.test(lines || []));

ipcMain.handle('tracker:browse', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select your PROShine "Logs" folder',
    properties: ['openDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('prices:refresh', async () => {
  try {
    const result = await refreshPrices(livePricesFile());
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});
