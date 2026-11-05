// Sichere Bruecke zwischen Hauptprozess und Fenstern (Wallpaper + Panel).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lettoscape', {
  // Wallpaper
  ready: () => ipcRenderer.send('wallpaper-ready'),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onPause: (cb) => ipcRenderer.on('pause', (_e, p) => cb(p)),
  sceneStatus: (st) => ipcRenderer.send('scene-status', st),
  onSceneStatus: (cb) => ipcRenderer.on('scene-status', (_e, st) => cb(st)),
  // beide
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  // Panel
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  hidePanel: () => ipcRenderer.send('hide-panel'),
  openPanel: (anchor) => ipcRenderer.send('open-panel', anchor),
  quit: () => ipcRenderer.send('quit'),
});
