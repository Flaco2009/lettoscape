# 🔥 Lettoscape

Cozy, immersive live wallpaper for Windows (Linux to follow).
Real day/night time, weather, fog, stars, fireflies, ambient sound – everything adjustable in the panel.

<p><img src="docs/bergsee-tageszeiten.png" width="420" alt="Mountain lake by day, dusk and night"> <img src="docs/panel.png" width="260" alt="Settings panel"></p>

## Features

- **Live wallpaper** behind the desktop icons (Windows 10/11, incl. 24H2)
- **Runs like a normal app**: taskbar icon, right-click → *Pin to taskbar*
- **☰ corner at the bottom left**: three bars appear on hover, a click opens the panel
- **Pin button** in the panel: pinned, it stays open and on top
- **Tray icon** in the notification area as well
- **Autostart** with Windows
- **Day/night** by real time or fixed
- **Weather**: clear, cloudy, rain, snow, fog (smooth transitions)
- **Ambient sound**: wind, water, rain, crickets at night (procedural, no files)
- **Mouse parallax**, multiple displays
- **Pauses automatically** when an app covers the desktop or a game/video runs fullscreen
- **Quick bar**: random scene, next scene, mute, pause; automatic scene switching on a timer
- **Global shortcuts**: Ctrl+Alt+L panel, Ctrl+Alt+→ next scene, Ctrl+Alt+R random, Ctrl+Alt+M mute, Ctrl+Alt+P pause
- Adjustable performance: quiet / balanced / beauty, plus FPS, resolution, quality

## Scenes

| Scene | Status |
|---|---|
| Mountain Lake | ✅ |
| Campsite | ✅ (rough) |
| Fire Watchtower | ✅ (rough) |
| Abandoned Castle | ✅ (rough) |
| Forest Clearing | ✅ (rough) |
| Hunter's Cabin | ✅ (rough) |
| Old Mill by the Creek | ✅ (rough) |
| Abandoned Station | ✅ (rough) |
| Chapel at the Forest Edge | ✅ (rough) |
| Lighthouse on the Coast | ✅ (rough) |

## Run (development)

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

## Preview images

After changing a scene, regenerate its preview images:

```bash
npm run previews            # all scenes
npm run previews -- camping # one scene only
```

## Build the installer (Windows)

```bash
npm run dist:win
```

The installer ends up in `dist/`.

## Project structure

```
src/
  main/        main process: tray, panel, autostart, desktop embedding
  wallpaper/   renderer (WebGL2) + scene shaders + sound
  panel/       settings panel
  shared/      default settings + scene list
assets/        icons
```

## Adding a new scene

1. Create the shader in `src/wallpaper/scenes/<name>.js` (template: `camping.js`, uses `common.js`)
2. Register it in `src/wallpaper/scenes/index.js`
3. Set `"ready": true` in `src/shared/scenes.json`

## License

MIT
