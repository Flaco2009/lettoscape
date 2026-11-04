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

if (!gl) fail('WebGL2 wird von deiner Grafikkarte/deinem Treiber nicht unterstuetzt.');

const vsSrc = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

let prog = null, uni = {}, currentScene = null;

function fail(msg) {
  errBox.textContent = 'Lettoscape: ' + msg;
  errBox.style.display = 'grid';
  console.error(msg);
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function loadScene(id) {
  const scene = scenes[id] || scenes.bergsee;
  if (currentScene === scene) return;
  try {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, scene.shader));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    if (prog) gl.deleteProgram(prog);
    prog = p;
    currentScene = scene;
    uni = {};
    for (const n of ['uRes', 'uTime', 'uHour', 'uRain', 'uSnow', 'uFog', 'uClouds', 'uBright', 'uMouse', 'uQuality']) {
      uni[n] = gl.getUniformLocation(prog, n);
    }
  } catch (e) {
    fail('Shader-Fehler: ' + e.message);
  }
}

// Vollbild-Dreieck
const buf = gl && gl.createBuffer();
if (gl) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

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

  if (!prog) return;
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
window.__lettoscape = { applySettings, get settings() { return settings; }, cur };
