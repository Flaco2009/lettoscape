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

if (isWin) app.setAppUserModelId('ch.flaco2009.lettoscape'); // noetig zum Anheften an die Taskleiste
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
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { saved = {}; }
  settings = { ...DEFAULTS, ...saved };
  // v2: alte Einstellungen waren viel zu hungrig fuer Laptops -> Leistung neu setzen
  if (!saved.settingsVersion || saved.settingsVersion < 2) {
    Object.assign(settings, POWER.balanced, { power: 'balanced', preload: false, settingsVersion: Math.max(2, settings.settingsVersion || 0) });
    saveSettings();
  }
  // v3: neue Pause-Einstellung (nur auf dem Desktop animieren)
  if (settings.settingsVersion < 3) {
    settings.pauseMode = saved.pauseOnFullscreen === false ? 'never' : 'desktop';
    settings.settingsVersion = 3;
    saveSettings();
  }
}

// Leistungsstufen. gpuBudget = Anteil der GPU-Zeit, den das Wallpaper hoechstens nutzen soll.
const POWER = {
  eco:      { fps: 20, renderScale: 0.45, quality: 'low' },
  balanced: { fps: 24, renderScale: 0.6,  quality: 'high' },
  beauty:   { fps: 30, renderScale: 0.85, quality: 'high' },
};
const BUDGET = { eco: 0.12, balanced: 0.25, beauty: 0.6, custom: 0.4 };

let onBattery = false;
function batteryMode() { return !!(onBattery && settings.batterySaver); }

/** Einstellungen, wie sie das Wallpaper tatsaechlich nutzt (Akku-Modus beruecksichtigt). */
function wallSettings() {
  const w = { ...settings, gpuBudget: BUDGET[settings.power] ?? 0.4, battery: batteryMode() };
  if (w.battery) {
    w.fps = Math.min(w.fps, POWER.eco.fps);
    w.renderScale = Math.min(w.renderScale, POWER.eco.renderScale);
    w.quality = 'low';
    w.gpuBudget = Math.min(w.gpuBudget, BUDGET.eco);
    w.preload = false;
  }
  return w;
}

function sendSettings() {
  const w = wallSettings();
  for (const win of wallpapers.values()) if (!win.isDestroyed()) win.webContents.send('settings', w);
  if (panel && !panel.isDestroyed()) panel.webContents.send('settings', settings);
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

// ---------- Taskleisten-Hintergrund ----------
// Die Win11-Taskleiste ist halbtransparent und nimmt ihre Farbe vom echten System-Wallpaper,
// nicht vom Wallpaper-Fenster. Deshalb wird regelmaessig ein Standbild der Szene als
// System-Wallpaper gesetzt; das Original wird beim Beenden wiederhergestellt.
const origWallFile = () => path.join(app.getPath('userData'), 'original-wallpaper.txt');
const snapFile = () => path.join(app.getPath('userData'), 'scene-snapshot.png');
let snapTimer = null;

async function updateTaskbarSnapshot() {
  if (!isWin || !settings.taskbarSync) return;
  const w = wallpapers.get(screen.getPrimaryDisplay().id);
  if (!w || w.isDestroyed()) return;
  const pi = [...wallpapers.keys()].indexOf(screen.getPrimaryDisplay().id);
  if (lastPause[pi] === 'hide') return; // gerade ausgeblendet -> spaeter
  try {
    const img = await w.webContents.capturePage();
    if (img.isEmpty()) return;
    if (!fs.existsSync(origWallFile())) {
      const cur = desktop.getWallpaper();
      if (cur && cur !== snapFile()) fs.writeFileSync(origWallFile(), cur);
    }
    fs.writeFileSync(snapFile(), img.toPNG());
    desktop.setWallpaper(snapFile());
  } catch (e) { console.warn('Taskleisten-Sync fehlgeschlagen:', e.message); }
}

function restoreSystemWallpaper() {
  try {
    if (fs.existsSync(origWallFile())) {
      const orig = fs.readFileSync(origWallFile(), 'utf8').trim();
      if (orig) desktop.setWallpaper(orig);
      fs.unlinkSync(origWallFile());
    }
  } catch {}
}

function startTaskbarSync() {
  clearInterval(snapTimer);
  if (!isWin) return;
  if (!settings.taskbarSync) { restoreSystemWallpaper(); return; }
  setTimeout(updateTaskbarSnapshot, 6000);
  snapTimer = setInterval(updateTaskbarSnapshot, 5 * 60 * 1000);
}

// ---------- Maus-Parallax + Vollbild-Pause ----------
let cursorTimer = null, pauseTimer = null, paused = false, lastCursor = null;

function startLoops() {
  clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!settings.parallax || paused) return;
    const p = screen.getCursorScreenPoint();
    if (lastCursor && lastCursor.x === p.x && lastCursor.y === p.y) return; // Maus steht still
    lastCursor = p;
    for (const [id, w] of wallpapers) {
      const d = screen.getAllDisplays().find((x) => x.id === id);
      if (!d || w.isDestroyed()) continue;
      const x = ((p.x - d.bounds.x) / d.bounds.width) * 2 - 1;
      const y = -(((p.y - d.bounds.y) / d.bounds.height) * 2 - 1);
      w.webContents.send('cursor', { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
    }
  }, 33);

  clearInterval(pauseTimer);
  pauseTimer = setInterval(updatePause, 500);
}

// Pausieren, wenn man das Wallpaper nicht sieht:
//  - Bildschirm gesperrt / Standby / laengere Abwesenheit
//  - Fenster maximiert oder im Vollbild (pro Bildschirm)
let locked = false;
let lastPause = [];
let pauseReason = '';
// Zustand pro Bildschirm:
//   'run'    – animiert
//   'freeze' – Standbild: letztes Bild bleibt stehen, es wird nichts mehr gerechnet
//              (eine App ist im Vordergrund, der Desktop ist aber noch teilweise zu sehen)
//   'hide'   – gar nicht sichtbar (verdeckt, gesperrt, abwesend)
let tick = 0;
let lastCovered = [];
function updatePause() {
  const displays = [...wallpapers.keys()].map((id) => screen.getAllDisplays().find((d) => d.id === id)).filter(Boolean);
  const mode = settings.pauseMode || 'desktop';
  let state = displays.map(() => 'run');
  let reason = '';
  if (locked) { state = state.map(() => 'hide'); reason = 'gesperrt'; }
  else if (powerMonitor.getSystemIdleTime() > 15 * 60) { state = state.map(() => 'hide'); reason = 'abwesend'; }
  else if (isWin && mode !== 'never') {
    // App im Vordergrund? (sehr billige Abfrage, jede halbe Sekunde)
    let onDesktop = true;
    try { onDesktop = desktop.desktopActive(process.pid); } catch { onDesktop = true; }
    // Verdeckte Bildschirme (Fensterliste durchgehen, etwas teurer -> seltener)
    if (tick % 3 === 0 || lastCovered.length !== displays.length) {
      try { lastCovered = desktop.coveredDisplays(displays.map((d) => screen.dipToScreenRect(null, d.workArea))); }
      catch { lastCovered = displays.map(() => false); }
    }
    state = displays.map((d, i) => {
      if (lastCovered[i]) return 'hide';
      if (mode === 'desktop' && !onDesktop) return 'freeze';
      return 'run';
    });
    if (state.includes('hide')) reason = 'verdeckt';
    else if (state.includes('freeze')) reason = 'app';
  }
  tick++;
  displays.forEach((d, i) => {
    if (lastPause[i] === state[i]) return;
    const w = wallpapers.get(d.id);
    if (w && !w.isDestroyed()) w.webContents.send('pause', { paused: state[i] !== 'run', hidden: state[i] === 'hide' });
  });
  const changed = state.length !== lastPause.length || state.some((c, i) => c !== lastPause[i]);
  lastPause = state;
  paused = state.length > 0 && state.every((x) => x !== 'run');
  pauseReason = reason;
  // Menue-Ecke nur bei echtem Vollbild/gesperrt ausblenden
  if (corner && !corner.isDestroyed() && (changed || tick % 3 === 0)) {
    const hide = locked || (isWin && mode !== 'never' && (() => {
      try { return desktop.isForegroundFullscreen(displays.map((d) => screen.dipToScreenRect(null, d.bounds))); } catch { return false; }
    })());
    if (hide && corner.isVisible()) corner.hide();
    else if (!hide && !corner.isVisible()) corner.showInactive();
  }
  if (changed) sendPower();
}

// ---------- Panel ----------
// Das Panel ist ein normales App-Fenster: es erscheint in der Taskleiste und kann dort
// angeheftet werden. "Schliessen" minimiert es nur (oder versteckt es, wenn die
// Taskleisten-Anzeige aus ist). Mit dem Pin bleibt es offen und immer im Vordergrund.
let panel = null;
let panelPlaced = false;
let lastAutoClose = 0;
let quitting = false;

function createPanel(showAfter, anchor) {
  panel = new BrowserWindow({
    width: 400,
    height: 680,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Lettoscape',
    skipTaskbar: !settings.showInTaskbar,
    alwaysOnTop: !!settings.panelPinned,
    backgroundColor: '#14110f',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  panel.loadFile(path.join(__dirname, '..', 'panel', 'index.html'));
  panel.once('ready-to-show', () => {
    if (showAfter) showPanel(anchor);
    else if (settings.showInTaskbar) { placePanel('right'); panel.minimize(); }
  });
  panel.on('blur', () => {
    if (settings.panelPinned || panel.webContents.isDevToolsOpened()) return;
    if (!panel.isVisible() || panel.isMinimized()) return;
    lastAutoClose = Date.now();
    closePanel();
  });
  panel.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    closePanel();
  });
}

function placePanel(side) {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w, h] = panel.getSize();
  const x = side === 'left' ? wa.x + 12 : wa.x + wa.width - w - 12;
  panel.setPosition(Math.round(x), Math.round(wa.y + wa.height - h - 12));
  panelPlaced = true;
}

function showPanel(anchor) {
  if (!panel || panel.isDestroyed()) return createPanel(true, anchor);
  const wasOpen = panel.isVisible() && !panel.isMinimized();
  // Angepinnt und offen: Position behalten (man kann es frei verschieben)
  if (!wasOpen && (anchor || !panelPlaced || !settings.panelPinned)) placePanel(anchor || 'right');
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
}

function closePanel() {
  if (!panel || panel.isDestroyed()) return;
  if (settings.showInTaskbar) panel.minimize();
  else panel.hide();
}

function togglePanel(anchor) {
  if (!panel || panel.isDestroyed()) return createPanel(true, anchor);
  const open = panel.isVisible() && !panel.isMinimized();
  // Klick auf Tray/Ecke schliesst das Panel per Blur schon - nicht gleich wieder oeffnen
  if (!open && Date.now() - lastAutoClose < 300) return;
  if (open) closePanel();
  else showPanel(anchor);
}

// ---------- Menue-Ecke unten links (drei Striche beim Drueberfahren) ----------
let corner = null;

function createCorner() {
  if (corner && !corner.isDestroyed()) corner.destroy();
  corner = null;
  if (!settings.cornerMenu) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const size = 56;
  corner = new BrowserWindow({
    x: wa.x, y: wa.y + wa.height - size, width: size, height: size,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  corner.setAlwaysOnTop(true, 'floating');
  corner.loadFile(path.join(__dirname, '..', 'corner', 'index.html'));
  corner.once('ready-to-show', () => { if (!paused) corner.showInactive(); });
  corner.on('closed', () => { corner = null; });
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
    { label: 'Einstellungen öffnen', click: () => showPanel() },
    { type: 'separator' },
    ...SCENES.filter((s) => s.ready).map((s) => ({
      label: s.name, type: 'radio', checked: settings.scene === s.id,
      click: () => updateSettings({ scene: s.id }),
    })),
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => togglePanel());
}

// ---------- Einstellungen aendern ----------
function updateSettings(patch) {
  const before = settings;
  settings = { ...settings, ...patch };
  saveSettings();
  if ('autostart' in patch && patch.autostart !== before.autostart) applyAutostart(settings.autostart);
  if ('allDisplays' in patch && patch.allDisplays !== before.allDisplays) rebuildWallpapers();
  if ('pauseMode' in patch && patch.pauseMode !== before.pauseMode) { lastPause = []; updatePause(); }
  if ('cornerMenu' in patch && patch.cornerMenu !== before.cornerMenu) createCorner();
  if (panel && !panel.isDestroyed()) {
    if ('panelPinned' in patch) panel.setAlwaysOnTop(!!settings.panelPinned);
    if ('showInTaskbar' in patch && patch.showInTaskbar !== before.showInTaskbar) {
      panel.setSkipTaskbar(!settings.showInTaskbar);
      const open = panel.isVisible() && !panel.isMinimized();
      if (!open) { if (settings.showInTaskbar) panel.minimize(); else panel.hide(); }
    }
  }
  if ('taskbarSync' in patch && patch.taskbarSync !== before.taskbarSync) startTaskbarSync();
  sendSettings();
  return settings;
}

// Ladezustand der Szenen (vom Wallpaper gemeldet), fuers Panel
const sceneStatus = {};
ipcMain.on('scene-status', (_e, st) => {
  if (!st || !st.id) return;
  // mehrere Bildschirme: "bereit" gewinnt gegen "laedt"
  const prev = sceneStatus[st.id];
  if (st.state === 'loading' && prev && prev.state === 'ready') return;
  sceneStatus[st.id] = st;
  if (panel && !panel.isDestroyed()) panel.webContents.send('scene-status', st);
  if (st.state === 'error') console.warn(`Szene ${st.id}: ${st.error}`);
});

ipcMain.handle('get-settings', () => ({ settings, scenes: SCENES, version: app.getVersion(), platform: process.platform, sceneStatus, power: powerInfo() }));

// Live-Werte vom Wallpaper (FPS, Aufloesung, GPU-Last) fuers Panel
ipcMain.on('render-stats', (_e, st) => {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.webContents.send('render-stats', st);
});
function powerInfo() { return { onBattery, battery: batteryMode(), pausedAll: lastPause.length > 0 && lastPause.every((x) => x !== 'run'), reason: pauseReason }; }
function sendPower() { if (panel && !panel.isDestroyed()) panel.webContents.send('power', powerInfo()); }
ipcMain.handle('set-settings', (_e, patch) => updateSettings(patch));
ipcMain.handle('reset-settings', () => updateSettings({ ...DEFAULTS }));
ipcMain.on('wallpaper-ready', (e) => e.sender.send('settings', wallSettings()));
ipcMain.on('hide-panel', () => closePanel());
ipcMain.on('open-panel', (_e, anchor) => togglePanel(anchor));
ipcMain.on('quit', () => app.quit());

// ---------- Start ----------
app.whenReady().then(() => {
  loadSettings();
  applyAutostart(settings.autostart);
  rebuildWallpapers();
  createTray();
  createCorner();
  startLoops();
  startTaskbarSync();

  screen.on('display-added', rebuildWallpapers);
  screen.on('display-removed', rebuildWallpapers);
  screen.on('display-metrics-changed', rebuildWallpapers);
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, createCorner);
  // Nach Standby/Explorer-Neustart neu einhaengen
  powerMonitor.on('resume', () => { locked = false; setTimeout(rebuildWallpapers, 2000); });
  // Akku: automatisch sparen
  try { onBattery = powerMonitor.isOnBatteryPower(); } catch { onBattery = false; }
  powerMonitor.on('on-battery', () => { onBattery = true; sendSettings(); sendPower(); });
  powerMonitor.on('on-ac', () => { onBattery = false; sendSettings(); sendPower(); });
  powerMonitor.on('lock-screen', () => { locked = true; updatePause(); });
  powerMonitor.on('unlock-screen', () => { locked = false; updatePause(); });
  powerMonitor.on('suspend', () => { locked = true; updatePause(); });
  sendSettings();

  // Beim normalen Start (z.B. Klick auf das angeheftete Icon) Panel zeigen,
  // beim Autostart nur still in die Taskleiste legen.
  const hidden = process.argv.includes('--hidden');
  createPanel(!hidden);
});

app.on('second-instance', () => showPanel());
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => {
  quitting = true;
  clearInterval(cursorTimer);
  clearInterval(pauseTimer);
  for (const w of wallpapers.values()) w.destroy();
  clearInterval(snapTimer);
  if (isWin) restoreSystemWallpaper();
});
