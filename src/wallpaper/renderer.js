// Lettoscape – wallpaper renderer (WebGL2, fullscreen shader)
import { scenes } from './scenes/index.js';
import { Ambience } from './audio.js';
import { createPost } from './post.js';

const canvas = document.getElementById('c');
const errBox = document.getElementById('err');
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });

const api = window.lettoscape; // from preload.js (missing in a normal browser)

// Fallback for tests in the browser: ?hour=20&weather=rain ...
const params = new URLSearchParams(location.search);
const previewMode = params.get('preview') === '1'; // generate preview images (tools/make-previews.js)
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
  autoPerformance: params.get('auto') !== '0',
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

const UNIFORMS = ['uRes', 'uTime', 'uHour', 'uRain', 'uSnow', 'uFog', 'uClouds', 'uBright', 'uMouse', 'uQuality', 'uJitter'];

function fail(msg) {
  // Fullscreen error only if nothing can be shown at all
  console.error(msg);
  if (prog) return;
  errBox.textContent = 'Lettoscape: ' + msg;
  errBox.style.display = 'grid';
}

// ---------- Loading scenes ----------
// The shaders are big. On Windows (Direct3D) compiling can take several seconds.
// Therefore:
//  - KHR_parallel_shader_compile: compiles in the background, the old scene keeps running
//  - finished scenes stay in memory -> switching back is instant
//  - after startup the remaining scenes are prepared in the background, one by one
//  - status (loading / ready / error) goes to the panel
const parallel = gl && gl.getExtension('KHR_parallel_shader_compile');
const cache = new Map();   // id -> { p, uni }
const jobs = new Map();    // id -> { p, vs, fs, t0, fg }
const failed = new Map();  // id -> error text
const retries = new Map(); // id -> number of retries (on transient GPU errors)
let wantedId = null;
let warmTimer = null;

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
  if (!parallel) pollJobs(); // without the extension: synchronous
}

function pollJobs() {
  for (const [id, job] of jobs) {
    if (parallel && !gl.getProgramParameter(job.p, parallel.COMPLETION_STATUS_KHR)) continue;
    jobs.delete(id);
    const ms = Math.round(performance.now() - job.t0);
    const { p, vs, fs } = job;
    if (gl.isContextLost()) continue; // is reloaded after restoring
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const raw = (gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || '').trim();
      gl.deleteProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Without an error text it was usually a transient GPU error -> try again later
      const n = retries.get(id) || 0;
      if ((!raw || /context|lost|timeout|out of memory/i.test(raw)) && n < 3) {
        retries.set(id, n + 1);
        console.warn(`Scene ${id}: transient GPU error, retry ${n + 1}/3`);
        report(id, 'loading', { background: id !== wantedId, retry: n + 1 });
        setTimeout(() => { if (!gl.isContextLost()) startJob(id, id === wantedId); }, 1500 * (n + 1));
        continue;
      }
      const log = raw || 'unknown GPU error';
      failed.set(id, log);
      console.error(`Scene ${id}: shader error after ${ms} ms`, log);
      report(id, 'error', { ms, error: log.slice(0, 400) });
      if (!job.fg) scheduleWarmup(2000);
      if (id === wantedId) fail(`Scene "${scenes[id].name}" could not be loaded.\n${log.slice(0, 300)}`);
      continue;
    }
    gl.detachShader(p, vs);
    gl.detachShader(p, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const u = {};
    for (const n of UNIFORMS) u[n] = gl.getUniformLocation(p, n);
    cache.set(id, { p, uni: u });
    retries.delete(id);
    console.info(`Scene ${id} ready after ${ms} ms`);
    report(id, 'ready', { ms });
    if (!job.fg) scheduleWarmup(Math.max(800, Math.min(ms, 20000)));
    if (id === wantedId) activate(id);
  }
}

// No loading screen: the old scene keeps running until the new one is ready.
// Then the new scene burns in and visibly gets sharper (see post.js).
let buildT0 = -1e9;
let stillId = null;
function activate(id) {
  const c = cache.get(id);
  if (!c) return;
  scheduleWarmup();
  if (id === currentId && prog && !(post && post.showingStill)) return;
  const fresh = !prog;
  prog = c.p;
  uni = c.uni;
  currentScene = scenes[id];
  currentId = id;
  errBox.style.display = 'none';
  if (post && !previewMode) {
    const now = performance.now();
    if (post.showingStill && stillId === id) {
      // Preview image was already shown -> blend unobtrusively into the live image
      post.endStill(now);
      buildT0 = -1e9;
    } else {
      post.beginTransition(now, fresh && !post.showingStill);
      post.dropStill();
      buildT0 = now;
    }
    stillId = null;
    resize();
  }
}

// ---------- Preview images ----------
// Every scene ships with ready-made images (day/dusk/night). When you click a scene that is not
// compiled yet, the image appears at once – the scene goes live as soon as the shader is ready.
const previewImgs = new Map();
function previewSlot(h) {
  if (h >= 7.5 && h < 16.5) return 'day';
  if ((h >= 16.5 && h < 20) || (h >= 5.5 && h < 7.5)) return 'dusk';
  return 'night';
}
// Preload the images for the current time of day so a click shows an image immediately
let previewsWarm = false;
function warmPreviews() {
  if (previewsWarm || previewMode) return;
  previewsWarm = true;
  for (const id of Object.keys(scenes)) {
    const url = `previews/${id}-${previewSlot(cur.hour)}.jpg`;
    if (!previewImgs.has(url)) { const img = new Image(); img.src = url; previewImgs.set(url, img); }
  }
}
function showPreview(id) {
  if (previewMode || !post) return;
  const url = `previews/${id}-${previewSlot(cur.hour)}.jpg`;
  let img = previewImgs.get(url);
  const go = () => {
    if (wantedId !== id || cache.has(id) || gl.isContextLost()) return;
    post.showStill(img, performance.now(), !prog && !post.showingStill);
    stillId = id;
    currentId = null;     // the old scene is no longer rendered
  };
  if (img && img.complete && img.naturalWidth) { go(); return; }
  if (!img) { img = new Image(); previewImgs.set(url, img); img.src = url; }
  img.addEventListener('load', go, { once: true });
}

function loadScene(id) {
  if (!scenes[id]) id = 'bergsee';
  wantedId = id;
  if (cache.has(id)) { activate(id); return; }
  // explicitly chosen: try again even after an earlier error
  failed.delete(id);
  retries.delete(id);
  startJob(id, true);
  if (!cache.has(id)) showPreview(id);
  setTimeout(warmPreviews, 1500);
}

// Prepare the remaining scenes in the background, one after another.
// Paced: after each scene pause as long as compiling took (max. half load).
// The first start takes a while, afterwards the shaders come from the disk cache
// and all scenes are ready after a few seconds.
let lastBgMs = 0;
function scheduleWarmup(delay = 3000) {
  clearTimeout(warmTimer);
  if (!parallel || previewMode) return;
  warmTimer = setTimeout(() => {
    if (settings.preload === false || settings.battery) { scheduleWarmup(30000); return; }
    if (jobs.size > 0) { scheduleWarmup(1000); return; }
    const next = Object.keys(scenes).find((k) => !cache.has(k) && !failed.has(k));
    if (!next) return;
    startJob(next, false);
  }, delay);
}

if (!gl) fail('WebGL2 is not supported by your GPU/driver.');

// GPU crash / driver reset: restore the picture on our own
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
  post = createPost(gl);
  resize();
  loadScene(wantedId || settings.scene);
});

// Fullscreen triangle
function initGeometry() {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
if (gl) initGeometry();
let post = gl ? createPost(gl) : null;

// ---------- Resolution + GPU budget ----------
// Rendering happens at a lower resolution and is upscaled (the scenes are soft, hardly noticeable).
// In addition:
//  - fixed pixel cap per power level (4K laptops would otherwise render 4x as much)
//  - dynScale: shrinks automatically when the wallpaper needs more GPU time than allowed
let dynScale = 1;
let fpsLimit = 60;   // lowered when the resolution is already at the minimum
const MIN_DYN = 0.55;
function maxPixels() {
  const b = settings.gpuBudget ?? 0.25;
  return b <= 0.15 ? 0.45e6 : b <= 0.3 ? 0.9e6 : b <= 0.45 ? 1.4e6 : 2.1e6;
}
// Build-up after a scene change: coarse first, then ever finer
const BUILD_STEPS = [0.3, 0.45, 0.65, 0.85, 1];
function buildMul(now) {
  const i = Math.floor((now - buildT0) / 320);
  return i >= BUILD_STEPS.length ? 1 : BUILD_STEPS[Math.max(0, i)];
}
let lastBuild = 1;

function resize() {
  // Output: full screen resolution (capped at ~1440p, above that the browser scales)
  let ow = window.innerWidth * devicePixelRatio;
  let oh = window.innerHeight * devicePixelRatio;
  const oc = Math.min(1, Math.sqrt(3.7e6 / Math.max(ow * oh, 1)));
  ow = Math.max(160, Math.round(ow * oc));
  oh = Math.max(90, Math.round(oh * oc));
  if (canvas.width !== ow || canvas.height !== oh) {
    canvas.width = ow;
    canvas.height = oh;
  }
  // Scene: smaller internally (performance), reconstructed in post.js
  const base = Math.min(Math.max(settings.renderScale, 0.25), 1.5);
  let w = window.innerWidth * devicePixelRatio * base;
  let h = window.innerHeight * devicePixelRatio * base;
  const cap = Math.sqrt(maxPixels() / Math.max(w * h, 1));
  lastBuild = buildMul(performance.now());
  const k = Math.min(1, cap) * dynScale * lastBuild;
  w = Math.max(96, Math.min(ow, Math.round(w * k)));
  h = Math.max(54, Math.min(oh, Math.round(h * k)));
  if (post) post.setSize(ow, oh, w, h);
}

// Measure GPU time (if the driver can)
const timer = gl && gl.getExtension('EXT_disjoint_timer_query_webgl2');
const queries = [];
let gpuMs = 0, gpuSamples = 0, frames = 0, statT0 = performance.now(), lastAdapt = performance.now();
function pollQueries() {
  while (queries.length) {
    const q = queries[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    queries.shift();
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
    if (!disjoint) {
      const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gpuMs = gpuSamples ? gpuMs * 0.8 + ms * 0.2 : ms;
      gpuSamples++;
    }
    gl.deleteQuery(q);
  }
}

const noAdapt = params.get('adapt') === '0'; // for tests/screenshots: do not regulate resolution
function adapt(now) {
  if (noAdapt || now - lastAdapt < 2500) return;
  if (settings.autoPerformance === false) {
    // Automatic off: fixed values from the settings
    if (dynScale !== 1 || fpsLimit !== 60) { dynScale = 1; fpsLimit = 60; resize(); }
  }
  const secs = (now - statT0) / 1000;
  const fps = frames / Math.max(secs, 0.001);
  lastAdapt = now;
  const target = Math.max(5, settings.fps);
  if (paused) {
    if (api && api.renderStats) api.renderStats({ paused: true, battery: !!settings.battery });
    frames = 0; statT0 = now;
    return;
  }
  const budget = settings.gpuBudget ?? 0.25;
  let load = null;
  let next = dynScale;
  const auto = settings.autoPerformance !== false;
  if (!auto) {
    if (timer && gpuSamples > 2) load = (gpuMs * Math.max(fps, 1)) / 1000;  // only measure and display
  } else if (timer && gpuSamples > 2) {
    load = (gpuMs * Math.max(fps, 1)) / 1000;      // share of GPU time
    const ratio = budget / Math.max(load, 1e-4);
    if (ratio < 0.85) {   // over budget
      if (dynScale <= MIN_DYN + 1e-3) fpsLimit = Math.max(12, Math.round(Math.min(fpsLimit, target) * Math.max(0.7, ratio)));
      else next = dynScale * Math.max(0.7, Math.sqrt(ratio));
    } else if (ratio > 1.4) {
      if (fpsLimit < target) fpsLimit = Math.min(target, Math.round(fpsLimit * 1.15) + 1);
      else next = dynScale * Math.min(1.12, Math.sqrt(ratio));
    }
  } else if (fps < Math.min(target, fpsLimit) * 0.75) {
    // cannot keep the frame rate -> GPU maxed out
    if (dynScale <= MIN_DYN + 1e-3) fpsLimit = Math.max(12, Math.round(Math.min(fpsLimit, target) * 0.8));
    else next = dynScale * 0.85;
  } else if (fps > target * 0.95) {
    next = dynScale * 1.04;
  }
  next = Math.min(1, Math.max(MIN_DYN, Math.round(next * 20) / 20));
  if (next !== dynScale) { dynScale = next; resize(); }
  if (api && api.renderStats) {
    const [iw, ih] = post ? post.inSize : [canvas.width, canvas.height];
    api.renderStats({ fps: Math.round(fps), target: Math.min(target, fpsLimit), w: iw, h: ih, outW: canvas.width, outH: canvas.height,
      load: load === null ? null : Math.round(load * 100), budget: Math.round(budget * 100),
      gpuMs: timer && gpuSamples ? Math.round(gpuMs * 10) / 10 : null, battery: !!settings.battery, paused });
  }
  frames = 0;
  statT0 = now;
}
window.addEventListener('resize', resize);

// Smooth transitions for weather
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
  // new power level / battery change: restart regulation
  if (['fps', 'renderScale', 'gpuBudget', 'quality', 'autoPerformance', 'scene'].some((k) => k in s && s[k] !== settings[k])) {
    dynScale = 1;
    fpsLimit = 60;
    gpuSamples = 0;
  }
  settings = { ...settings, ...s };
  loadScene(settings.scene);
  resize();
  ambience.update(settings);
}

let simTime = 0, last = performance.now(), lastDraw = 0, paused = false, totalFrames = 0;
cur.hour = targetHour();

function frame(now) {
  if (paused) {
    // paused: wake up only rarely (finish compiling scenes, report status)
    if (gl && !gl.isContextLost()) { pollJobs(); adapt(now); }
    last = now;
    setTimeout(() => requestAnimationFrame(frame), 500);
    return;
  }
  requestAnimationFrame(frame);
  if (gl && !gl.isContextLost()) {
    pollJobs();
    if (timer) pollQueries();
    adapt(now);
  }
  const minDt = 1000 / Math.max(5, Math.min(settings.fps, fpsLimit));
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
  // Follow the time smoothly (also across midnight)
  let dh = targetHour() - cur.hour;
  if (dh > 12) dh -= 24;
  if (dh < -12) dh += 24;
  cur.hour = (cur.hour + dh * (1 - Math.exp(-dt * 1.5)) + 24) % 24;

  const mk = 1 - Math.exp(-dt * 2.5);
  mouse.x = lerp(mouse.x, settings.parallax ? mouse.tx : 0, mk);
  mouse.y = lerp(mouse.y, settings.parallax ? mouse.ty : 0, mk);

  ambience.setWeather(cur.rain, cur.hour);

  if (post && post.showingStill && !gl.isContextLost()) {
    // Preview image visible: do not render the scene, only output during burn-in
    if (post.inTransition()) post.presentOnly(now, settings.sharpen ?? 0.6);
    return;
  }
  if (!prog || !post || gl.isContextLost()) return;
  if (buildMul(now) !== lastBuild) resize();   // build-up stage advances
  const [iw, ih] = post.inSize;
  const [jx, jy] = post.jitter();
  post.bindScene();
  gl.useProgram(prog);
  gl.uniform2f(uni.uRes, iw, ih);
  gl.uniform2f(uni.uJitter, jx, jy);
  gl.uniform1f(uni.uTime, simTime);
  gl.uniform1f(uni.uHour, cur.hour);
  gl.uniform1f(uni.uRain, cur.rain);
  gl.uniform1f(uni.uSnow, cur.snow);
  gl.uniform1f(uni.uFog, cur.fog);
  gl.uniform1f(uni.uClouds, cur.clouds);
  gl.uniform1f(uni.uBright, settings.brightness);
  gl.uniform2f(uni.uMouse, mouse.x, mouse.y);
  gl.uniform1f(uni.uQuality, settings.quality === 'high' ? 1 : 0);
  let q = null;
  if (timer && queries.length < 3 && frames % 3 === 0) {
    q = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(q); }
  frames++;

  // Share of the new frame: small = calm and sharp, larger with motion / during build-up
  const mouseMove = Math.hypot(mouse.tx - mouse.x, mouse.ty - mouse.y);
  let alpha = 0.1;
  alpha = Math.max(alpha, Math.min(0.45, mouseMove * 3));
  alpha = Math.max(alpha, cur.rain * 0.22, cur.snow * 0.18);
  if (lastBuild < 1) alpha = 0.5;
  post.finish(alpha, settings.sharpen ?? 0.6, now);
  totalFrames++;
}

if (gl) {
  applySettings({});
  // Test mode: set weather immediately instead of fading in
  const w = WEATHER[settings.weather] || WEATHER.clear;
  Object.assign(cur, { rain: w.rain, snow: w.snow, fog: Math.min(1, settings.fog + w.fogAdd), clouds: Math.min(1, settings.clouds + w.cloudAdd) });
  requestAnimationFrame(frame);
}

if (api) {
  api.onSettings((s) => applySettings(s));
  api.onCursor(({ x, y }) => { mouse.tx = x; mouse.ty = y; });
  let wasHidden = false;
  api.onPause((st) => {
    // st = { paused, hidden } (old version: only true/false)
    const p = typeof st === 'object' ? !!st.paused : !!st;
    const hidden = typeof st === 'object' ? !!st.hidden : !!st;
    paused = p;
    // Still image: the last frame simply stays (nothing is drawn any more), sound keeps playing.
    // Hidden: hide the picture, sound off.
    canvas.style.visibility = hidden ? 'hidden' : 'visible';
    ambience.update({ ...settings, sound: settings.sound && !hidden });
    if (!p && wasHidden && post) post.reset();            // after hiding do not drag the old image along
    wasHidden = hidden;
  });
  api.ready();
} else {
  window.addEventListener('mousemove', (e) => {
    mouse.tx = (e.clientX / innerWidth) * 2 - 1;
    mouse.ty = -((e.clientY / innerHeight) * 2 - 1);
  });
}

// For screenshots/tests
window.__lettoscape = { applySettings, get settings() { return settings; }, cur, currentId: () => currentId, cached: () => [...cache.keys()], frames: () => totalFrames, showingStill: () => !!(post && post.showingStill) };
