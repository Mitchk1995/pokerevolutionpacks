/**
 * The only bridge between the renderer and Node. Everything is an explicit,
 * named channel - the renderer never gets `require` or raw IPC.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  getState: () => ipcRenderer.invoke('state:get'),

  openPack: () => ipcRenderer.invoke('pack:open'),
  addPacks: (count, reason) => ipcRenderer.invoke('packs:add', { count, reason }),

  tracker: {
    get: () => ipcRenderer.invoke('tracker:get'),
    set: (patch) => ipcRenderer.invoke('tracker:set', patch),
    test: (lines) => ipcRenderer.invoke('tracker:test', lines),
    browse: () => ipcRenderer.invoke('tracker:browse'),
    onAward: (fn) => ipcRenderer.on('tracker:award', (_e, awards) => fn(awards)),
  },

  refreshPrices: () => ipcRenderer.invoke('prices:refresh'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
});
