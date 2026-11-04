// Lettoscape – Hauptprozess: Wallpaper-Fenster, Tray-Icon, Einstellungs-Panel, Autostart.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULTS = require('../shared/defaults.json');
const SCENES = require('../shared/scenes.json');

const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const desktop = isWin ? require('./desktop-win') : null;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------- Einstellungen ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  }, 300);
}

// ---------- Autostart ----------
function applyAutostart(on) {
  if (!app.isPackaged) return; // im Dev-Modus nicht electron.exe registrieren
  if (isWin || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  } else if (isLinux) {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'lettoscape.desktop');
    if (on) {
      const exe = process.env.APPIMAGE || process.execPath;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Lettoscape\nExec="${exe}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

// ---------- Wallpaper-Fenster ----------
const wallpapers = new Map(); // displayId -> BrowserWindow

function virtualOrigin() {
  const ds = screen.getAllDisplays().map((d) => (isWin ? screen.dipToScreenRect(null, d.bounds) : d.bounds));
  return { x: Math.min(...ds.map((d) => d.x)), y: Math.min(...ds.map((d) => d.y)) };
}

function createWallpaper(display) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    backgroundColor: '#05070b',
    type: isLinux ? 'desktop' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'wallpaper', 'index.html'));
  win.once('ready-to-show', () => {
    if (isWin) {
      const phys = screen.dipToScreenRect(null, b);
      const o = virtualOrigin();
      win.showInactive();
      const ok = desktop.attach(win, { x: phys.x - o.x, y: phys.y - o.y, width: phys.width, height: phys.height });
      if (!ok) console.warn('Lettoscape: Desktop-Ebene nicht gefunden, Fenster bleibt normal.');
    } else {
      win.showInactive();
    }
  });
  win.setIgnoreMouseEvents(true);
  win.on('closed', () => wallpapers.delete(display.id));
  wallpapers.set(display.id, win);
  return win;
}

function rebuildWallpapers() {
  for (const w of wallpapers.values()) w.destroy();
  wallpapers.clear();
  const list = settings.allDisplays ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
  list.forEach(createWallpaper);
}

function broadcast(channel, data) {
  for (const w of wallpapers.values()) if (!w.isDestroyed()) w.webContents.send(channel, data);
  if (panel && !panel.isDestroyed()) panel.webContents.send(channel, data);
}

// ---------- Maus-Parallax + Vollbild-Pause ----------
let cursorTimer = null, pauseTimer = null, paused = false;

function startLoops() {
  clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!settings.parallax || paused) return;
    const p = screen.getCursorScreenPoint();
    for (const [id, w] of wallpapers) {
      const d = screen.getAllDisplays().find((x) => x.id === id);
      if (!d || w.isDestroyed()) continue;
      const x = ((p.x - d.bounds.x) / d.bounds.width) * 2 - 1;
      const y = -(((p.y - d.bounds.y) / d.bounds.height) * 2 - 1);
      w.webContents.send('cursor', { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
    }
  }, 33);

  clearInterval(pauseTimer);
  if (!isWin) return;
  pauseTimer = setInterval(() => {
    let p = false;
    if (settings.pauseOnFullscreen) {
      const ds = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds));
      try { p = desktop.isForegroundFullscreen(ds); } catch { p = false; }
    }
    if (p !== paused) {
      paused = p;
      for (const w of wallpapers.values()) if (!w.isDestroyed()) w.webContents.send('pause', paused);
    }
  }, 1500);
}

// ---------- Panel ----------
let panel = null;

function togglePanel() {
  if (panel && !panel.isDestroyed()) {
    if (panel.isVisible()) panel.hide();
    else showPanel();
    return;
  }
  panel = new BrowserWindow({
    width: 400,
    height: 680,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#14110f',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  panel.loadFile(path.join(__dirname, '..', 'panel', 'index.html'));
  panel.once('ready-to-show', showPanel);
  panel.on('blur', () => { if (!panel.webContents.isDevToolsOpened()) panel.hide(); });
}

function showPanel() {
  // unten rechts ueber der Taskleiste platzieren (Linux: Ecke des Arbeitsbereichs)
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = panel.getSize();
  panel.setPosition(wa.x + wa.width - w - 12, wa.y + wa.height - h - 12);
  panel.show();
  panel.focus();
}

// ---------- Tray ----------
let tray = null;
function iconPath() {
  return path.join(__dirname, '..', '..', 'assets', isWin ? 'icon.ico' : 'icon.png');
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(iconPath()) : img);
  tray.setToolTip('Lettoscape');
  const menu = Menu.buildFromTemplate([
    { label: 'Einstellungen öffnen', click: togglePanel },
    { type: 'separator' },
    ...SCENES.filter((s) => s.ready).map((s) => ({
      label: s.name, type: 'radio', checked: settings.scene === s.id,
      click: () => updateSettings({ scene: s.id }),
    })),
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', togglePanel);
}

// ---------- Einstellungen aendern ----------
function updateSettings(patch) {
  const before = settings;
  settings = { ...settings, ...patch };
  saveSettings();
  if ('autostart' in patch && patch.autostart !== before.autostart) applyAutostart(settings.autostart);
  if ('allDisplays' in patch && patch.allDisplays !== before.allDisplays) rebuildWallpapers();
  broadcast('settings', settings);
  return settings;
}

ipcMain.handle('get-settings', () => ({ settings, scenes: SCENES, version: app.getVersion(), platform: process.platform }));
ipcMain.handle('set-settings', (_e, patch) => updateSettings(patch));
ipcMain.handle('reset-settings', () => updateSettings({ ...DEFAULTS }));
ipcMain.on('wallpaper-ready', (e) => e.sender.send('settings', settings));
ipcMain.on('hide-panel', () => panel && panel.hide());
ipcMain.on('quit', () => app.quit());

// ---------- Start ----------
app.whenReady().then(() => {
  loadSettings();
  applyAutostart(settings.autostart);
  rebuildWallpapers();
  createTray();
  startLoops();

  screen.on('display-added', rebuildWallpapers);
  screen.on('display-removed', rebuildWallpapers);
  screen.on('display-metrics-changed', rebuildWallpapers);
  // Nach Standby/Explorer-Neustart neu einhaengen
  powerMonitor.on('resume', () => setTimeout(rebuildWallpapers, 2000));

  if (!process.argv.includes('--hidden') && !fs.existsSync(path.join(app.getPath('userData'), '.welcomed'))) {
    fs.writeFileSync(path.join(app.getPath('userData'), '.welcomed'), '1');
    togglePanel();
  }
});

app.on('second-instance', togglePanel);
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => {
  clearInterval(cursorTimer);
  clearInterval(pauseTimer);
  for (const w of wallpapers.values()) w.destroy();
  if (isWin) { try { desktop.restoreWallpaper(); } catch {} }
});
