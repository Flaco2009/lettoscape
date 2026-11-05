// Windows: attach a window behind the desktop icons (WorkerW trick, like Lively/Wallpaper Engine).
// Supports classic Windows 10/11 and the new layout from Windows 11 24H2.
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
  // Ask Explorer to create the WorkerW layer behind the icons
  const out = [0];
  SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, out);
  SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, out);

  // Windows 11 24H2+: WorkerW is a child of Progman
  const childWorker = FindWindowExW(progman, 0, 'WorkerW', null);
  if (childWorker) {
    const defView = FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
    return { mode: 'progman', parent: progman, defView, worker: childWorker };
  }

  // Classic: WorkerW right after the window with SHELLDLL_DefView
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
 * Attaches an Electron window as the wallpaper.
 * @param {BrowserWindow} win
 * @param {{x:number,y:number,width:number,height:number}} rect physical pixels relative to the virtual screen
 */
function attach(win, rect) {
  const layer = findDesktopLayer();
  if (!layer) return false;
  const hwnd = hwndOf(win);
  SetParent(hwnd, layer.parent);
  if (layer.mode === 'progman') {
    // below the icons (DefView), but above the WorkerW layer
    SetWindowPos(hwnd, layer.defView || 1, rect.x, rect.y, rect.width, rect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetWindowPos(layer.worker, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  } else {
    SetWindowPos(hwnd, 0, rect.x, rect.y, rect.width, rect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  return true;
}

/** Current system wallpaper path. */
function getWallpaper() {
  const buf = Buffer.alloc(520 * 2);
  SystemParametersInfoW(0x0073, 520, buf, 0); // SPI_GETDESKWALLPAPER
  return buf.toString('utf16le').split('\0')[0];
}

/** Sets the system wallpaper (the taskbar takes its color from this image). */
function setWallpaper(file) {
  const buf = Buffer.from(file + '\0', 'utf16le');
  return SystemParametersInfoW(0x0014, 0, buf, 0x1 | 0x2); // SPI_SETDESKWALLPAPER
}

const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '']);

/** true if a fullscreen program (game, video) is in the foreground. */
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

// Invisible ("cloaked") windows, e.g. on other virtual desktops or hidden UWP apps
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
 * Which displays are completely covered (maximized or fullscreen window)?
 * Then the wallpaper is not visible there and can pause.
 * @param {{x,y,width,height}[]} works work areas (without taskbar) in physical pixels
 * @returns {boolean[]} per display: covered yes/no
 */
function coveredDisplays(works) {
  enumList = [];
  EnumWindows(enumCallback, 0); // order: topmost window first
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

// Windows that count as "on the desktop": desktop itself, taskbar, start menu overlays
const DESKTOP_LIKE = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', 'MultitaskingViewFrame',
  'ForegroundStaging', 'TaskListThumbnailWnd']);

/**
 * Is the desktop currently "active" (no other program in the foreground)?
 * Our own windows (panel, menu corner) count as desktop so changes can be seen live.
 * Cheap enough for a query every few hundred milliseconds.
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
