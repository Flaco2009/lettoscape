// Lettoscape – generate preview images
//
// Renders every scene at three times of day and saves the images to src/wallpaper/previews/.
// The app shows them immediately when you click a scene that has not finished compiling yet,
// and uses the small versions as tiles in the panel.
//
// Usage:   npm run previews              (all scenes)
//          npm run previews -- camping   (only given scenes)
//
// After changing a scene, just regenerate and commit.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SCENES = require(path.join(ROOT, 'src', 'shared', 'scenes.json'));
const OUT = path.join(ROOT, 'src', 'wallpaper', 'previews');

const SLOTS = { day: 13, dusk: 18.3, night: 22 };
const SIZE = { width: 1280, height: 720 };   // large image (upscaled when shown)
const THUMB = { width: 320, height: 180 };   // tile in the panel
const FRAMES = Number(process.env.PREVIEW_FRAMES || 16); // frames to accumulate (anti-aliasing)

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(win, expr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await win.webContents.executeJavaScript(expr)) return true; } catch { /* Seite laedt noch */ }
    await wait(250);
  }
  return false;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js') && a !== '.');
  const list = SCENES.filter((s) => s.ready && (only.length === 0 || only.includes(s.id)));

  const win = new BrowserWindow({
    ...SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false },
  });

  for (const scene of list) {
    for (const [slot, hour] of Object.entries(SLOTS)) {
      const t0 = Date.now();
      await win.loadFile(path.join(ROOT, 'src', 'wallpaper', 'index.html'), {
        query: { scene: scene.id, hour: String(hour), scale: '0.75', adapt: '0', auto: '0', preview: '1', quality: 'high' },
      });
      const ok = await waitFor(win, `window.__lettoscape && window.__lettoscape.currentId() === '${scene.id}' && window.__lettoscape.frames() >= ${FRAMES}`, 10 * 60 * 1000);
      if (!ok) { console.error(`  ${scene.id} ${slot}: Zeitueberschreitung, uebersprungen`); continue; }
      const img = await win.webContents.capturePage();
      if (img.isEmpty()) { console.error(`  ${scene.id} ${slot}: empty image`); continue; }
      const big = img.resize(SIZE);
      fs.writeFileSync(path.join(OUT, `${scene.id}-${slot}.jpg`), big.toJPEG(84));
      fs.writeFileSync(path.join(OUT, `${scene.id}-${slot}-thumb.jpg`), img.resize({ ...THUMB, quality: 'best' }).toJPEG(80));
      console.log(`  ${scene.id.padEnd(13)} ${slot.padEnd(5)} ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
  app.quit();
});
