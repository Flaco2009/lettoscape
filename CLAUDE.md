# Lettoscape – Hinweise für Claude Code

Cozy Live-Wallpaper (Electron, Windows zuerst, Linux später). Sprache im UI und in Kommentaren: Deutsch.

## Aufbau
- `src/main/` Hauptprozess: Wallpaper-Fenster (WorkerW via koffi in `desktop-win.js`), Panel, ☰-Ecke, Tray, Autostart, Settings (`userData/settings.json`).
- `src/wallpaper/` Renderer: ein Vollbild-Fragment-Shader pro Szene (WebGL2), `renderer.js` setzt Uniforms, `audio.js` = prozeduraler Sound.
- `src/wallpaper/scenes/common.js` gemeinsame Shader-Basis (Noise, SDFs, Himmel, Licht, Wald, Wasser, Raymarch, Overlays). Szenen liefern nur `groundH`, `forestMask`, `sdObj`, `objAlbedo`, `objEmit`, `sceneLights`, `sceneVolume`, `sceneCamera` + Defines. Kommentar oben in `common.js` beschreibt den Vertrag.
- `bergsee.js` ist eigenständig (älter, nutzt common.js nicht).
- `src/shared/scenes.json` Szenenliste fürs Panel, `defaults.json` Standard-Einstellungen.

## Testen
- App: `npm install && npm start`
- Nur eine Szene im Browser: `npx http-server src -p 8080`, dann `http://localhost:8080/wallpaper/index.html?scene=camping&hour=22&weather=rain`
  (Parameter: `scene`, `hour`, `weather` = clear|cloudy|rain|snow|fog, `fog`, `clouds`, `scale`, `quality`)

## Regeln
- Materialien in `sdObj`: m >= 1. Gelände ist m = 0.
- Gelände unter Gebäuden mit `pad()` flach machen, Bäume per `forestMask` von Kamera und Gebäuden fernhalten.
- Lichter: warm (`windowGlow`, `fireFlicker`), nachts stärker. Alles soll cozy wirken, nie gruselig.
- Performance: Ziel 30 FPS bei 75 % Auflösung auf Mittelklasse-GPU. Teure Schleifen in `sceneVolume` sparsam.
