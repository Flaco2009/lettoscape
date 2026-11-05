// Secure bridge between main process and windows (wallpaper + panel).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lettoscape', {
  // Wallpaper
  ready: () => ipcRenderer.send('wallpaper-ready'),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onPause: (cb) => ipcRenderer.on('pause', (_e, p) => cb(p)),
  sceneStatus: (st) => ipcRenderer.send('scene-status', st),
  renderStats: (st) => ipcRenderer.send('render-stats', st),
  onRenderStats: (cb) => ipcRenderer.on('render-stats', (_e, st) => cb(st)),
  onPower: (cb) => ipcRenderer.on('power', (_e, p) => cb(p)),
  onSceneStatus: (cb) => ipcRenderer.on('scene-status', (_e, st) => cb(st)),
  // both
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  // Panel
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  hidePanel: () => ipcRenderer.send('hide-panel'),
  openPanel: (anchor) => ipcRenderer.send('open-panel', anchor),
  quit: () => ipcRenderer.send('quit'),
});
