# Lettoscape – Hinweise für Claude Code

Cozy Live-Wallpaper (Electron, Windows zuerst, Linux später). Sprache im UI und in Kommentaren: Deutsch.

## Aufbau
- `src/main/` Hauptprozess: Wallpaper-Fenster (WorkerW via koffi in `desktop-win.js`), Panel, ☰-Ecke, Tray, Autostart, Settings (`userData/settings.json`).
- `src/wallpaper/` Renderer: ein Vollbild-Fragment-Shader pro Szene (WebGL2), `renderer.js` setzt Uniforms, `audio.js` = prozeduraler Sound.
- `src/wallpaper/scenes/common.js` gemeinsame Shader-Basis (Noise, SDFs, Himmel, Licht, Wald, Wasser, Raymarch, Overlays). Szenen liefern nur `groundH`, `forestMask`, `sdObj`, `objAlbedo`, `objEmit`, `sceneLights`, `sceneVolume`, `sceneCamera` + Defines. Kommentar oben in `common.js` beschreibt den Vertrag.
- `bergsee.js` ist eigenständig (älter, nutzt common.js nicht).
- `src/shared/scenes.json` Szenenliste fürs Panel, `defaults.json` Standard-Einstellungen.

## Szenen laden
- `renderer.js` kompiliert asynchron (KHR_parallel_shader_compile), hält fertige Szenen im Cache und meldet `loading/ready/error/lost` per `sceneStatus` an das Panel. Konsole des Wallpaper-Fensters: `Szene <id> bereit nach <ms> ms`.
- **Vorschaubilder** `src/wallpaper/previews/<id>-<day|dusk|night>.jpg` (+ `-thumb.jpg` fürs Panel): Klick auf eine noch nicht kompilierte Szene zeigt sofort das Bild (Einbrennen), sobald der Shader fertig ist, wird weich ins Live-Bild übergeblendet. **Nach jeder Änderung an einer Szene `npm run previews` (oder `npm run previews -- <id>`) ausführen und die Bilder committen.**
- Vorladen (`preload`, Standard an): alle Szenen nacheinander im Hintergrund, nach jeder Szene so lange Pause wie das Kompilieren dauerte, nicht im Akkubetrieb.
- Shader-Disk-Cache vergrößert (`gpu-program-cache-size-kb` in `main.js`): nach dem ersten Kompilieren sind Szenen auch nach Neustart sofort da.

## Leistung / Wärme
- Leistungsstufen `power` = eco | balanced | beauty | custom (Werte in `main.js` `POWER`/`BUDGET` und im Panel `PRESETS`). Im Akkubetrieb mit `batterySaver` erzwingt `wallSettings()` die Stufe eco.
- Renderer: feste Pixel-Obergrenze je Stufe (`maxPixels`), misst GPU-Zeit (EXT_disjoint_timer_query_webgl2) und regelt `dynScale` (min. 55 %), danach die FPS (`fpsLimit`) herunter. Live-Werte gehen per `render-stats` ans Panel.
- Pause pro Bildschirm, Zustände `run` / `freeze` / `hide` (`main.js` `updatePause`, alle 500 ms):
  - `freeze` (Standbild): Einstellung `pauseMode = 'desktop'` und eine fremde App ist im Vordergrund (`desktop-win.js` `desktopActive`; Desktop, Taskleiste und eigene Fenster zählen als Desktop). Es wird nichts gezeichnet, das letzte Bild bleibt stehen, Sound läuft weiter.
  - `hide`: Bildschirm verdeckt (`coveredDisplays`), gesperrt oder 15 min Abwesenheit. Canvas versteckt, Sound aus.
  - `pauseMode`: `desktop` (Standard) | `visible` (nur bei verdeckt pausieren) | `never`.
  - Pausiert wacht die Render-Schleife nur alle 500 ms auf.
- Shader: Bäume nur prüfen, wenn der Strahl auf Baumhöhe ist (`TREE_TOP`), weniger Oktaven in der Ferne (`groundOct`), `farMountains` erst ab Startdistanz.
- Screenshots/Vergleiche immer mit `&adapt=0`, sonst regelt die langsame Software-GPU die Auflösung herunter und das Bild wirkt blass.

## Bild-Rekonstruktion (post.js)
- Szene rendert in ein Zwischenbild niedriger Auflösung mit Sub-Pixel-Jitter (`uJitter`, in Szenen-Shadern über `FC = gl_FragCoord.xy + uJitter` nutzen, nie `gl_FragCoord` direkt für Strahlen/UVs).
- `post.js` rekonstruiert zeitlich in voller Auflösung (Catmull-Rom + Verlauf mit Neighborhood-Clamping), schärft nach und macht beim Szenenwechsel den „Einbrenn“-Übergang. Kein Ladebildschirm: alte Szene läuft weiter, bis die neue kompiliert ist.
- Zufallsrauschen in Shadern (z. B. Volumen-Jitter) mit `fract(uTime)` variieren, dann glättet die Rekonstruktion es weg.

## Testen
- App: `npm install && npm start`
- Nur eine Szene im Browser: `npx http-server src -p 8080`, dann `http://localhost:8080/wallpaper/index.html?scene=camping&hour=22&weather=rain`
  (Parameter: `scene`, `hour`, `weather` = clear|cloudy|rain|snow|fog, `fog`, `clouds`, `scale`, `quality`)

## Regeln
- Materialien in `sdObj`: m >= 1. Gelände ist m = 0.
- Gelände unter Gebäuden mit `pad()` flach machen, Bäume per `forestMask` von Kamera und Gebäuden fernhalten.
- Lichter: warm (`windowGlow`, `fireFlicker`), nachts stärker. Alles soll cozy wirken, nie gruselig.
- **Windows-Kompilierzeit:** Unter Windows übersetzt Direct3D (fxc) die Shader, rollt Schleifen mit fester Grenze aus und kopiert Funktionen an jede Aufrufstelle. Deshalb: Schleifen immer `for (int i = ZERO; ...)` statt `= 0`, teure Funktionen (march, shade, sceneH, sdObj) nur an EINER Stelle aufrufen (Normalen per Schleife, Wasser-Spiegelung als zweiter Durchgang derselben Schleife in `main`).
- Performance: Ziel 30 FPS bei 75 % Auflösung auf Mittelklasse-GPU. Teure Schleifen in `sceneVolume` sparsam.
