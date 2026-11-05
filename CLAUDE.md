# Lettoscape – Notes for Claude Code

Cozy live wallpaper (Electron, Windows first, Linux later). Language in the UI, comments and docs: English.

## Structure
- `src/main/` main process: wallpaper window (WorkerW via koffi in `desktop-win.js`), panel, ☰ corner, tray, autostart, settings (`userData/settings.json`).
- `src/wallpaper/` renderer: one fullscreen fragment shader per scene (WebGL2), `renderer.js` sets uniforms, `audio.js` = procedural sound.
- `src/wallpaper/scenes/common.js` shared shader base (noise, SDFs, sky, light, forest, water, raymarch, overlays). Scenes only provide `groundH`, `forestMask`, `sdObj`, `objAlbedo`, `objEmit`, `sceneLights`, `sceneVolume`, `sceneCamera` + defines. The comment at the top of `common.js` describes the contract.
- `bergsee.js` is standalone (older, does not use common.js).
- `src/shared/scenes.json` scene list for the panel, `defaults.json` default settings.

## Loading scenes
- `renderer.js` compiles asynchronously (KHR_parallel_shader_compile), keeps finished scenes in a cache and reports `loading/ready/error/lost` via `sceneStatus` to the panel. Console of the wallpaper window: `Scene <id> ready after <ms> ms`.
- **Preview images** `src/wallpaper/previews/<id>-<day|dusk|night>.jpg` (+ `-thumb.jpg` for the panel): clicking a scene that is not compiled yet shows the image at once (burn-in); as soon as the shader is ready it blends softly into the live image. **After every change to a scene run `npm run previews` (or `npm run previews -- <id>`) and commit the images.**
- Preloading (`preload`, on by default): all scenes one after another in the background, after each scene a pause as long as compiling took, not on battery.
- Shader disk cache enlarged (`gpu-program-cache-size-kb` in `main.js`): after the first compile scenes are instant even after a restart.

## Performance / heat
- Power levels `power` = eco | balanced | beauty | custom (values in `main.js` `POWER`/`BUDGET` and in the panel `PRESETS`). On battery with `batterySaver`, `wallSettings()` forces the eco level.
- Renderer: fixed pixel cap per level (`maxPixels`), measures GPU time (EXT_disjoint_timer_query_webgl2) and lowers `dynScale` (min. 55 %), then the FPS (`fpsLimit`). Live values go to the panel via `render-stats`.
- Pause per display, states `run` / `freeze` / `hide` (`main.js` `updatePause`, every 500 ms):
  - `freeze` (still image): setting `pauseMode = 'desktop'` and a foreign app is in the foreground (`desktop-win.js` `desktopActive`; desktop, taskbar and own windows count as desktop). Nothing is drawn, the last frame stays, sound keeps playing. Also used for the manual pause (`wallPaused`).
  - `hide`: display covered (`coveredDisplays`), locked or 15 min away. Canvas hidden, sound off.
  - `pauseMode`: `desktop` (default) | `visible` (pause only when covered) | `never`.
  - While paused the render loop only wakes up every 500 ms.
- Shader: only check trees when the ray is at tree height (`TREE_TOP`), fewer octaves in the distance (`groundOct`), `farMountains` only from a start distance.
- Always use `&adapt=0` for screenshots/comparisons, otherwise the slow software GPU lowers the resolution and the image looks pale.

## Image reconstruction (post.js)
- The scene renders into a low-resolution intermediate image with sub-pixel jitter (`uJitter`; in scene shaders use `FC = gl_FragCoord.xy + uJitter`, never `gl_FragCoord` directly for rays/UVs).
- `post.js` reconstructs temporally at full resolution (Catmull-Rom + history with neighborhood clamping), sharpens, and does the “burn-in” transition on scene change. No loading screen: the old scene keeps running until the new one is compiled.
- Vary random noise in shaders (e.g. volume jitter) with `fract(uTime)`, then the reconstruction smooths it away.

## Testing
- App: `npm install && npm start`
- One scene only in the browser: `npx http-server src -p 8080`, then `http://localhost:8080/wallpaper/index.html?scene=camping&hour=22&weather=rain`
  (parameters: `scene`, `hour`, `weather` = clear|cloudy|rain|snow|fog, `fog`, `clouds`, `scale`, `quality`)

## Rules
- Materials in `sdObj`: m >= 1. Terrain is m = 0.
- Flatten terrain under buildings with `pad()`, keep trees away from camera and buildings via `forestMask`.
- Lights: warm (`windowGlow`, `fireFlicker`), stronger at night. Everything should feel cozy, never creepy.
- **Windows compile time:** On Windows Direct3D (fxc) translates the shaders, unrolls loops with fixed bounds and copies functions to every call site. Therefore: always `for (int i = ZERO; ...)` instead of `= 0`, call expensive functions (march, shade, sceneH, sdObj) at ONE place only (normals via a loop, water reflection as a second pass of the same loop in `main`).
- Performance: target 30 FPS at 75 % resolution on a mid-range GPU. Keep expensive loops in `sceneVolume` sparse.

## Comfort features (v0.9)
- The panel has tabs (Scene / Look / Performance / System) + a quick bar (random, next, sound, pause) and time-of-day chips.
- Settings: `autoSwitch`/`switchMinutes`/`switchRandom` (scene switcher in `main.js`), `wallPaused` (manual pause, not persisted), `hotkeys`.
- Global shortcuts: Ctrl+Alt+L panel, →/R next/random scene, M sound, P pause. The tray menu mirrors them.
