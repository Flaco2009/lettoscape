// Lettoscape – Wallpaper-Renderer (WebGL2, Vollbild-Shader)
import { scenes } from './scenes/index.js';
import { Ambience } from './audio.js';

const canvas = document.getElementById('c');
const errBox = document.getElementById('err');
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });

const api = window.lettoscape; // aus preload.js (fehlt im normalen Browser)

// Fallback fuer Tests im Browser: ?hour=20&weather=rain ...
const params = new URLSearchParams(location.search);
let settings = {
  scene: params.get('scene') || 'bergsee',
  timeMode: params.has('hour') ? 'fixed' : 'real',
  hour: parseFloat(params.get('hour') || '12'),
  weather: params.get('weather') || 'clear',
  fog: parseFloat(params.get('fog') || '0.45'),
  clouds: parseFloat(params.get('clouds') || '0.35'),
  brightness: 1,
  speed: 1,
  fps: 30,
  renderScale: parseFloat(params.get('scale') || '0.75'),
  quality: params.get('quality') || 'high',
  parallax: true,
  sound: false,
  volume: 0.5,
};

const WEATHER = {
  clear:  { rain: 0, snow: 0, fogAdd: 0,    cloudAdd: 0 },
  cloudy: { rain: 0, snow: 0, fogAdd: 0.1,  cloudAdd: 0.45 },
  rain:   { rain: 1, snow: 0, fogAdd: 0.25, cloudAdd: 0.6 },
  snow:   { rain: 0, snow: 1, fogAdd: 0.2,  cloudAdd: 0.5 },
  fog:    { rain: 0, snow: 0, fogAdd: 0.6,  cloudAdd: 0.3 },
};


const vsSrc = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

let prog = null, uni = {}, currentScene = null, currentId = null;

const UNIFORMS = ['uRes', 'uTime', 'uHour', 'uRain', 'uSnow', 'uFog', 'uClouds', 'uBright', 'uMouse', 'uQuality'];

function fail(msg) {
  // Vollbild-Fehler nur, wenn gar nichts angezeigt werden kann
  console.error(msg);
  if (prog) return;
  errBox.textContent = 'Lettoscape: ' + msg;
  errBox.style.display = 'grid';
}

// ---------- Szenen laden ----------
// Die Shader sind gross. Unter Windows (Direct3D) kann das Kompilieren einige Sekunden dauern.
// Deshalb:
//  - KHR_parallel_shader_compile: kompiliert im Hintergrund, die alte Szene laeuft weiter
//  - fertige Szenen bleiben im Speicher -> Zurueckwechseln ist sofort da
//  - nach dem Start werden die uebrigen Szenen nach und nach im Hintergrund vorbereitet
//  - Status (laedt / bereit / Fehler) geht ans Panel
const parallel = gl && gl.getExtension('KHR_parallel_shader_compile');
const cache = new Map();   // id -> { p, uni }
const jobs = new Map();    // id -> { p, vs, fs, t0, fg }
const failed = new Map();  // id -> Fehlertext
let wantedId = null;
let warmTimer = null;
let loadingHint = null;

function report(id, state, extra = {}) {
  if (api && api.sceneStatus) api.sceneStatus({ id, state, ...extra });
}

function startJob(id, fg) {
  const scene = scenes[id];
  if (!scene || cache.has(id) || failed.has(id)) return;
  const job = jobs.get(id);
  if (job) { if (fg) job.fg = true; return; }
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, scene.shader);
  gl.compileShader(fs);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  jobs.set(id, { p, vs, fs, t0: performance.now(), fg });
  report(id, 'loading', { background: !fg });
  if (!parallel) pollJobs(); // ohne Extension: synchron
}

function pollJobs() {
  for (const [id, job] of jobs) {
    if (parallel && !gl.getProgramParameter(job.p, parallel.COMPLETION_STATUS_KHR)) continue;
    jobs.delete(id);
    const ms = Math.round(performance.now() - job.t0);
    const { p, vs, fs } = job;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = (gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || 'unbekannter Fehler').trim();
      gl.deleteProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      failed.set(id, log);
      console.error(`Szene ${id}: Shader-Fehler nach ${ms} ms`, log);
      report(id, 'error', { ms, error: log.slice(0, 400) });
      if (id === wantedId) fail(`Szene "${scenes[id].name}" konnte nicht geladen werden.\n${log.slice(0, 300)}`);
      continue;
    }
    gl.detachShader(p, vs);
    gl.detachShader(p, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const u = {};
    for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
    cache.set(id, { p, uni: u });
    console.info(`Szene ${id} bereit nach ${ms} ms`);
    report(id, 'ready', { ms });
    if (id === wantedId) activate(id);
  }
  // Ladehinweis auf dem Wallpaper, falls es laenger dauert
  const job = wantedId && jobs.get(wantedId);
  showHint(job && performance.now() - job.t0 > 1500 ? scenes[wantedId].name : null);
}

let fadeTimer = null;
function activate(id) {
  const c = cache.get(id);
  if (!c) return;
  const swap = () => {
    prog = c.p;
    uni = c.uni;
    currentScene = scenes[id];
    currentId = id;
    errBox.style.display = 'none';
    canvas.style.opacity = '1';
  };
  clearTimeout(fadeTimer);
  scheduleWarmup();
  if (!prog || id === currentId) { swap(); return; }
  // sanft ueberblenden: kurz abdunkeln, Szene tauschen, wieder aufhellen
  canvas.style.opacity = '0';
  fadeTimer = setTimeout(swap, 420);
}

function loadScene(id) {
  if (!scenes[id]) id = 'bergsee';
  wantedId = id;
  if (cache.has(id)) { activate(id); return; }
  if (failed.has(id)) {
    report(id, 'error', { error: failed.get(id).slice(0, 400) });
    if (!prog) fail(`Szene "${scenes[id].name}" konnte nicht geladen werden.`);
    return;
  }
  startJob(id, true);
}

// Uebrige Szenen im Hintergrund vorbereiten, eine nach der anderen
function scheduleWarmup() {
  clearTimeout(warmTimer);
  if (!parallel || settings.preload === false) return;
  warmTimer = setTimeout(() => {
    if (jobs.size > 0) { scheduleWarmup(); return; }
    const next = Object.keys(scenes).find((k) => !cache.has(k) && !failed.has(k));
    if (!next) return;
    startJob(next, false);
    scheduleWarmup();
  }, 8000);
}

function showHint(name) {
  if (!loadingHint) {
    loadingHint = document.createElement('div');
    loadingHint.id = 'loading';
    document.body.appendChild(loadingHint);
  }
  if (name) {
    loadingHint.textContent = name + ' wird vorbereitet …';
    loadingHint.classList.add('on');
  } else {
    loadingHint.classList.remove('on');
  }
}

if (!gl) fail('WebGL2 wird von deiner Grafikkarte/deinem Treiber nicht unterstuetzt.');

// GPU-Absturz / Treiber-Reset: Bild selbst wiederherstellen
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('WebGL-Kontext verloren');
  prog = null;
  currentId = null;
  cache.clear();
  jobs.clear();
  report(wantedId, 'lost');
});
canvas.addEventListener('webglcontextrestored', () => {
  console.warn('WebGL-Kontext wiederhergestellt');
  initGeometry();
  loadScene(wantedId || settings.scene);
});

// Vollbild-Dreieck
function initGeometry() {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
if (gl) initGeometry();

function resize() {
  const s = Math.min(Math.max(settings.renderScale, 0.3), 1.5);
  const w = Math.round(window.innerWidth * devicePixelRatio * s);
  const h = Math.round(window.innerHeight * devicePixelRatio * s);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
window.addEventListener('resize', resize);

// Weiche Uebergaenge fuer Wetter
const cur = { rain: 0, snow: 0, fog: 0.45, clouds: 0.35, hour: 12 };
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

function targetHour() {
  if (settings.timeMode === 'fixed') return settings.hour;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function lerp(a, b, k) { return a + (b - a) * k; }

const ambience = new Ambience();

function applySettings(s) {
  settings = { ...settings, ...s };
  loadScene(settings.scene);
  resize();
  ambience.update(settings);
}

let simTime = 0, last = performance.now(), lastDraw = 0, paused = false;
cur.hour = targetHour();

function frame(now) {
  requestAnimationFrame(frame);
  if (gl && !gl.isContextLost()) pollJobs();
  if (paused) { last = now; return; }
  const minDt = 1000 / Math.max(5, settings.fps);
  if (now - lastDraw < minDt - 1) return;
  lastDraw = now;

  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  simTime += dt * settings.speed;

  const w = WEATHER[settings.weather] || WEATHER.clear;
  const k = 1 - Math.exp(-dt * 0.6);
  cur.rain = lerp(cur.rain, w.rain, k);
  cur.snow = lerp(cur.snow, w.snow, k);
  cur.fog = lerp(cur.fog, Math.min(1, settings.fog + w.fogAdd), k);
  cur.clouds = lerp(cur.clouds, Math.min(1, settings.clouds + w.cloudAdd), k);
  // Uhrzeit weich nachfuehren (auch ueber Mitternacht)
  let dh = targetHour() - cur.hour;
  if (dh > 12) dh -= 24;
  if (dh < -12) dh += 24;
  cur.hour = (cur.hour + dh * (1 - Math.exp(-dt * 1.5)) + 24) % 24;

  const mk = 1 - Math.exp(-dt * 2.5);
  mouse.x = lerp(mouse.x, settings.parallax ? mouse.tx : 0, mk);
  mouse.y = lerp(mouse.y, settings.parallax ? mouse.ty : 0, mk);

  ambience.setWeather(cur.rain, cur.hour);

  if (!prog || gl.isContextLost()) return;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(prog);
  gl.uniform2f(uni.uRes, canvas.width, canvas.height);
  gl.uniform1f(uni.uTime, simTime);
  gl.uniform1f(uni.uHour, cur.hour);
  gl.uniform1f(uni.uRain, cur.rain);
  gl.uniform1f(uni.uSnow, cur.snow);
  gl.uniform1f(uni.uFog, cur.fog);
  gl.uniform1f(uni.uClouds, cur.clouds);
  gl.uniform1f(uni.uBright, settings.brightness);
  gl.uniform2f(uni.uMouse, mouse.x, mouse.y);
  gl.uniform1f(uni.uQuality, settings.quality === 'high' ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

if (gl) {
  applySettings({});
  // Testmodus: Wetter sofort setzen statt einblenden
  const w = WEATHER[settings.weather] || WEATHER.clear;
  Object.assign(cur, { rain: w.rain, snow: w.snow, fog: Math.min(1, settings.fog + w.fogAdd), clouds: Math.min(1, settings.clouds + w.cloudAdd) });
  requestAnimationFrame(frame);
}

if (api) {
  api.onSettings((s) => applySettings(s));
  api.onCursor(({ x, y }) => { mouse.tx = x; mouse.ty = y; });
  api.onPause((p) => { paused = p; ambience.update({ ...settings, sound: settings.sound && !p }); });
  api.ready();
} else {
  window.addEventListener('mousemove', (e) => {
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / innerHeight) * 2 - 1);
  });
}

// Fuer Screenshots/Tests
window.__lettoscape = { applySettings, get settings() { return settings; }, cur, currentId: () => currentId, cached: () => [...cache.keys()] };
