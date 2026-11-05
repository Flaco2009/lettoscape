// Windows: Fenster hinter die Desktop-Icons haengen (WorkerW-Trick, wie Lively/Wallpaper Engine).
// Unterstuetzt klassisches Windows 10/11 und das neue Layout ab Windows 11 24H2.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const HWND = koffi.alias('HWND', 'intptr_t');
const EnumProc = koffi.proto('bool __stdcall EnumProc(HWND hwnd, intptr_t lParam)');

const FindWindowW = user32.func('HWND __stdcall FindWindowW(str16 cls, str16 name)');
const FindWindowExW = user32.func('HWND __stdcall FindWindowExW(HWND parent, HWND after, str16 cls, str16 name)');
const SendMessageTimeoutW = user32.func(
  'intptr_t __stdcall SendMessageTimeoutW(HWND hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'
);
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumProc *cb, intptr_t lParam)');
const SetParent = user32.func('HWND __stdcall SetParent(HWND child, HWND parent)');
const SetWindowPos = user32.func('bool __stdcall SetWindowPos(HWND hwnd, HWND after, int x, int y, int cx, int cy, uint32_t flags)');
const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hwnd, _Out_ uint16_t *buf, int max)');
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(HWND hwnd)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32_t *pid)');
const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *pv, uint32_t winIni)');

const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length === 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

function findDesktopLayer() {
  const progman = FindWindowW('Progman', null);
  if (!progman) return null;
  // Explorer bitten, die WorkerW-Ebene hinter den Icons zu erzeugen
  const out = [0];
  SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, out);
  SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, out);

  // Windows 11 24H2+: WorkerW ist ein Kind von Progman
  const childWorker = FindWindowExW(progman, 0, 'WorkerW', null);
  if (childWorker) {
    const defView = FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
    return { mode: 'progman', parent: progman, defView, worker: childWorker };
  }

  // Klassisch: WorkerW direkt nach dem Fenster mit SHELLDLL_DefView
  let worker = 0;
  const cb = koffi.register((top) => {
    const dv = FindWindowExW(top, 0, 'SHELLDLL_DefView', null);
    if (dv) worker = FindWindowExW(0, top, 'WorkerW', null);
    return true;
  }, koffi.pointer(EnumProc));
  EnumWindows(cb, 0);
  koffi.unregister(cb);
  if (!worker) return null;
  return { mode: 'workerw', parent: worker };
}

/**
 * Haengt ein Electron-Fenster als Wallpaper ein.
 * @param {BrowserWindow} win
 * @param {{x:number,y:number,width:number,height:number}} rect physische Pixel relativ zum virtuellen Bildschirm
 */
function attach(win, rect) {
  const layer = findDesktopLayer();
  if (!layer) return false;
  const hwnd = hwndOf(win);
  SetParent(hwnd, layer.parent);
  if (layer.mode === 'progman') {
    // unter die Icons (DefView), aber ueber die WorkerW-Ebene
    SetWindowPos(hwnd, layer.defView || 1, rect.x, rect.y, rect.width, rect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetWindowPos(layer.worker, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  } else {
    SetWindowPos(hwnd, 0, rect.x, rect.y, rect.width, rect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  return true;
}

/** Aktueller System-Wallpaper-Pfad. */
function getWallpaper() {
  const buf = Buffer.alloc(520 * 2);
  SystemParametersInfoW(0x0073, 520, buf, 0); // SPI_GETDESKWALLPAPER
  return buf.toString('utf16le').split('\0')[0];
}

/** Setzt das System-Wallpaper (die Taskleiste faerbt sich nach diesem Bild). */
function setWallpaper(file) {
  const buf = Buffer.from(file + '\0', 'utf16le');
  return SystemParametersInfoW(0x0014, 0, buf, 0x1 | 0x2); // SPI_SETDESKWALLPAPER
}

const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '']);

/** true, wenn ein Vollbild-Programm (Spiel, Video) im Vordergrund ist. */
function isForegroundFullscreen(displaysPhysical) {
  const fg = GetForegroundWindow();
  if (!fg) return false;
  const name = new Uint16Array(256);
  const len = GetClassNameW(fg, name, 256);
  const cls = String.fromCharCode(...name.slice(0, len));
  if (DESKTOP_CLASSES.has(cls)) return false;
  const r = {};
  if (!GetWindowRect(fg, r)) return false;
  return displaysPhysical.some((d) =>
    r.left <= d.x && r.top <= d.y && r.right >= d.x + d.width && r.bottom >= d.y + d.height
  );
}

// Unsichtbare ("cloaked") Fenster, z.B. auf anderen virtuellen Desktops oder versteckte UWP-Apps
let DwmGetWindowAttribute = null;
try {
  const dwm = koffi.load('dwmapi.dll');
  DwmGetWindowAttribute = dwm.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, uint32_t attr, _Out_ int *pv, uint32_t cb)');
} catch { DwmGetWindowAttribute = null; }
function isCloaked(h) {
  if (!DwmGetWindowAttribute) return false;
  const v = [0];
  return DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, v, 4) === 0 && v[0] !== 0;
}

let enumList = [];
const enumCallback = koffi.register((h) => { enumList.push(h); return true; }, koffi.pointer(EnumProc));
const IGNORE_CLASSES = new Set([...DESKTOP_CLASSES, 'Windows.UI.Core.CoreWindow', 'tooltips_class32', 'Shell_InputSwitchTopLevelWindow', 'NotifyIconOverflowWindow', 'XamlExplorerHostIslandWindow']);

/**
 * Welche Bildschirme sind komplett verdeckt (maximiertes oder Vollbild-Fenster)?
 * Dann sieht man das Wallpaper dort nicht und es kann pausieren.
 * @param {{x,y,width,height}[]} works Arbeitsbereiche (ohne Taskleiste) in physischen Pixeln
 * @returns {boolean[]} pro Bildschirm: verdeckt ja/nein
 */
function coveredDisplays(works) {
  enumList = [];
  EnumWindows(enumCallback, 0); // Reihenfolge: oberstes Fenster zuerst
  const covered = works.map(() => false);
  const name = new Uint16Array(128);
  for (const h of enumList) {
    if (!IsWindowVisible(h) || IsIconic(h)) continue;
    const len = GetClassNameW(h, name, 128);
    const cls = String.fromCharCode(...name.slice(0, len));
    if (IGNORE_CLASSES.has(cls)) continue;
    const r = {};
    if (!GetWindowRect(h, r)) continue;
    if (r.right - r.left < 200 || r.bottom - r.top < 200) continue;
    let relevant = false;
    works.forEach((w, i) => {
      if (covered[i]) return;
      const tol = 4;
      if (r.left <= w.x + tol && r.top <= w.y + tol && r.right >= w.x + w.width - tol && r.bottom >= w.y + w.height - tol) relevant = true;
    });
    if (!relevant || isCloaked(h)) continue;
    works.forEach((w, i) => {
      const tol = 4;
      if (r.left <= w.x + tol && r.top <= w.y + tol && r.right >= w.x + w.width - tol && r.bottom >= w.y + w.height - tol) covered[i] = true;
    });
    if (covered.every(Boolean)) break;
  }
  return covered;
}

// Fenster, bei denen man "auf dem Desktop" ist: Desktop selbst, Taskleiste, Startmenue-Ueberlagerungen
const DESKTOP_LIKE = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', 'MultitaskingViewFrame',
  'ForegroundStaging', 'TaskListThumbnailWnd']);

/**
 * Ist gerade der Desktop "aktiv" (kein anderes Programm im Vordergrund)?
 * Eigene Fenster (Panel, Menue-Ecke) zaehlen als Desktop, damit man Aenderungen live sieht.
 * Billig genug fuer eine Abfrage alle paar hundert Millisekunden.
 */
function desktopActive(ownPid) {
  const fg = GetForegroundWindow();
  if (!fg) return true;
  const name = new Uint16Array(128);
  const len = GetClassNameW(fg, name, 128);
  const cls = String.fromCharCode(...name.slice(0, len));
  if (DESKTOP_LIKE.has(cls)) return true;
  if (IsIconic(fg) || !IsWindowVisible(fg)) return true;
  const pid = [0];
  GetWindowThreadProcessId(fg, pid);
  return pid[0] === ownPid;
}

module.exports = { attach, getWallpaper, setWallpaper, isForegroundFullscreen, coveredDisplays, desktopActive, hwndOf };
