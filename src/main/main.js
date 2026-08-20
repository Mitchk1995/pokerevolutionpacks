/**
 * Electron main process: window, IPC surface, and the background services
 * (progress tracker + price refresh).
 */
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Store, DEFAULT_RULES, MAX_PACK_GRANT, normalizeRules } from './store.js';
import { ProTracker } from './tracker.js';
import { refreshPrices } from './prices.js';
import { PackEngine } from '../shared/pack-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');

let win = null;
let store = null;
let tracker = null;
let packEngine = null;

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

function getPackEngine() {
  if (!packEngine) {
    const data = loadStaticData();
    packEngine = new PackEngine({ cards: data.cards.cards, model: data.model });
  }
  return packEngine;
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

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
}

app.on('window-all-closed', () => {
  tracker?.stop();
  store?.flush();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => store?.flush());

/* ------------------------------------------------------------------ IPC */

ipcMain.handle('data:load', () => loadStaticData());
ipcMain.handle('state:get', () => ({ ...store.state, recovery: store.recovery }));

ipcMain.handle('pack:open', () => {
  const before = structuredClone(store.state);
  if (!store.spendPack()) return { ok: false, wallet: store.state.wallet };
  try {
    const pack = getPackEngine().openPack();
    const result = store.recordPack(pack);
    return { ok: true, pack, ...result, wallet: store.state.wallet, stats: store.state.stats };
  } catch (error) {
    store.state = before;
    store.saveSoon();
    console.error('Could not open pack:', error);
    return { ok: false, error: 'The pack could not be generated. Your pack was restored.', wallet: store.state.wallet };
  }
});

ipcMain.handle('packs:add', (_e, payload) => {
  const { count, reason } = payload && typeof payload === 'object' ? payload : {};
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PACK_GRANT) {
    return { ok: false, error: `Enter a whole number from 1 to ${MAX_PACK_GRANT}.`, wallet: store.state.wallet };
  }
  store.addPacks(count, reason || 'Manually added');
  return { ok: true, wallet: store.state.wallet };
});

ipcMain.handle('tracker:get', () => ({
  ...store.state.tracker,
  suggestions: ProTracker.guessLogDirs(os.homedir()),
  defaults: DEFAULT_RULES,
}));

ipcMain.handle('tracker:set', (_e, patch) => {
  patch = patch && typeof patch === 'object' ? patch : {};
  const cfg = store.state.tracker;
  if (patch.logDir !== undefined && patch.logDir !== cfg.logDir) {
    cfg.logDir = typeof patch.logDir === 'string' ? patch.logDir.slice(0, 32_767) : '';
    cfg.offsets = {};   // new folder, start fresh at its current end
    cfg.fileState = {};
  }
  if (patch.enabled !== undefined) cfg.enabled = !!patch.enabled;
  if (patch.rules !== undefined) cfg.rules = normalizeRules(patch.rules);
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
