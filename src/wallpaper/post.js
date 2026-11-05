// Lettoscape – Bild-Nachbearbeitung
//
// Die Szene wird aus Spargruenden in geringerer Aufloesung gerechnet. Statt das Bild einfach
// hochzuziehen (verpixelt/matschig), wird es hier rekonstruiert:
//
//  1. Jitter: jedes Bild wird um einen winzigen, wechselnden Sub-Pixel-Versatz verschoben gerechnet.
//  2. Zeitliche Rekonstruktion (TAA-Upscaling): die Bilder werden in voller Aufloesung aufaddiert.
//     Weil sich die Szenen kaum bewegen, entsteht so nach wenigen Bildern ein scharfes, glattes Bild
//     mit deutlich mehr Details, als die niedrige Aufloesung hergibt.
//     Gegen Schlieren bei Bewegung (Blaetter, Regen, Maus) wird der Verlauf auf die Farben der
//     aktuellen Umgebung begrenzt (Neighborhood Clamping).
//  3. Leichtes Nachschaerfen bei der Ausgabe.
//  4. Szenenwechsel: die neue Szene "brennt" sich wie Glut ueber die alte ein und wird dabei
//     sichtbar immer schaerfer – man sieht ihr beim Entstehen zu.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Durchgang A: aktuelles Bild + Verlauf -> neuer Verlauf (volle Aufloesung)
const RESOLVE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uCur;     // aktuelles Szenenbild (niedrige Aufloesung)
uniform sampler2D uHist;    // bisheriger Verlauf (volle Aufloesung)
uniform vec2 uInRes;
uniform vec2 uOutRes;
uniform vec2 uJitter;       // Versatz des aktuellen Bildes in Eingangs-Pixeln
uniform float uAlpha;       // Anteil des neuen Bildes
uniform float uHasHist;

// Catmull-Rom (bikubisch, scharf) mit 9 bilinearen Abtastungen
vec3 catmullRom(vec2 uv) {
  vec2 sp = uv * uInRes;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) / uInRes;
  vec2 t3 = (t1 + 2.0) / uInRes;
  vec2 t12 = (t1 + w2 / w12) / uInRes;
  vec3 r = vec3(0.0);
  r += texture(uCur, vec2(t0.x,  t0.y)).rgb  * w0.x  * w0.y;
  r += texture(uCur, vec2(t12.x, t0.y)).rgb  * w12.x * w0.y;
  r += texture(uCur, vec2(t3.x,  t0.y)).rgb  * w3.x  * w0.y;
  r += texture(uCur, vec2(t0.x,  t12.y)).rgb * w0.x  * w12.y;
  r += texture(uCur, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
  r += texture(uCur, vec2(t3.x,  t12.y)).rgb * w3.x  * w12.y;
  r += texture(uCur, vec2(t0.x,  t3.y)).rgb  * w0.x  * w3.y;
  r += texture(uCur, vec2(t12.x, t3.y)).rgb  * w12.x * w3.y;
  r += texture(uCur, vec2(t3.x,  t3.y)).rgb  * w3.x  * w3.y;
  return max(r, 0.0);
}

// Farbraum, in dem das Begrenzen besser funktioniert
vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

void main() {
  vec2 uv = vUv - uJitter / uInRes;
  vec3 cur = catmullRom(uv);
  if (uHasHist < 0.5) { o = vec4(cur, 1.0); return; }

  // Farbbereich der Umgebung im aktuellen Bild (Mittelwert +- Streuung)
  ivec2 ip = ivec2(uv * uInRes);
  ivec2 mx = ivec2(uInRes) - 1;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = toYCoCg(texelFetch(uCur, clamp(ip + ivec2(x, y), ivec2(0), mx), 0).rgb);
      m1 += c;
      m2 += c * c;
    }
  }
  m1 /= 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
  vec3 lo = m1 - 1.25 * sigma - 0.004;
  vec3 hi = m1 + 1.25 * sigma + 0.004;

  vec3 hist = texelFetch(uHist, ivec2(vUv * uOutRes), 0).rgb;
  vec3 h = toYCoCg(hist);
  vec3 hc = clamp(h, lo, hi);
  // stark abweichender Verlauf (Bewegung) -> schneller auf das neue Bild gehen
  float diff = length((h - hc) / max(hi - lo, vec3(0.02)));
  float a = clamp(uAlpha + diff * 0.25, uAlpha, 0.8);
  o = vec4(mix(fromYCoCg(hc), cur, a), 1.0);
}`;

// Durchgang B: Ausgabe auf den Bildschirm (Nachschaerfen + Einbrennen der neuen Szene)
const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uImg;     // neuer Verlauf
uniform sampler2D uOld;     // eingefrorenes Bild der vorherigen Szene
uniform sampler2D uStill;   // Vorschaubild (solange die Szene noch nicht live ist)
uniform float uUseStill;
uniform float uFade;        // 1 = weich ueberblenden statt einbrennen
uniform vec2 uOutRes;
uniform float uSharp;
uniform float uProg;        // Fortschritt des Szenenwechsels 0..1 (>= 1: fertig)
uniform float uAspect;

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  ivec2 p = ivec2(vUv * uOutRes);
  ivec2 mx = ivec2(uOutRes) - 1;
  vec3 c;
  if (uUseStill > 0.5) {
    c = texture(uStill, vUv).rgb;
  } else {
  c = texelFetch(uImg, p, 0).rgb;
  // kontrastabhaengiges Nachschaerfen (wie AMD CAS, vereinfacht)
  vec3 n = texelFetch(uImg, clamp(p + ivec2(0, 1), ivec2(0), mx), 0).rgb;
  vec3 s = texelFetch(uImg, clamp(p - ivec2(0, 1), ivec2(0), mx), 0).rgb;
  vec3 e = texelFetch(uImg, clamp(p + ivec2(1, 0), ivec2(0), mx), 0).rgb;
  vec3 w = texelFetch(uImg, clamp(p - ivec2(1, 0), ivec2(0), mx), 0).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w)));
  vec3 mxc = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mxc) / max(mxc, 1e-4), 0.0, 1.0));
  vec3 wgt = -amp * uSharp * 0.2;
  c = clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), 0.0, 1.0);
  }

  if (uProg < 1.0 && uFade > 0.5) {
    // Vorschaubild -> Live-Bild: sanft und unauffaellig
    vec3 old = texelFetch(uOld, p, 0).rgb;
    c = mix(old, c, smoothstep(0.0, 1.0, uProg));
  } else if (uProg < 1.0) {
    // neue Szene brennt sich ueber die alte ein: von der Mitte unten nach aussen, mit Glutkante
    vec2 q = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.35);
    float field = length(q) * 0.9 + noise(vUv * vec2(uAspect, 1.0) * 5.0) * 0.45 + noise(vUv * vec2(uAspect, 1.0) * 23.0) * 0.12;
    float edge = uProg * 1.75 - 0.08;
    float m = smoothstep(edge + 0.06, edge - 0.06, field);
    vec3 old = texelFetch(uOld, p, 0).rgb;
    vec3 col = mix(old, c, m);
    float glow = smoothstep(0.07, 0.0, abs(field - edge)) * (1.0 - uProg);
    col += vec3(1.0, 0.55, 0.2) * glow * 0.55;
    c = col;
  }
  o = vec4(c, 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

// Halton-Folge (2,3): gleichmaessig verteilte Sub-Pixel-Versaetze
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export function createPost(gl) {
  const floatOk = !!gl.getExtension('EXT_color_buffer_float');
  const resolve = compile(gl, VS, RESOLVE_FS);
  const present_ = compile(gl, VS, PRESENT_FS);

  let inW = 0, inH = 0, outW = 0, outH = 0;
  let sceneTex = null, sceneFb = null;
  const hist = [null, null], histFb = [null, null];
  let oldTex = null, oldFb = null;
  let stillTex = null, useStill = false;
  let cur = 0, hasHist = false, frameNo = 0;
  let trans = { active: false, t0: 0, dur: 1600, fade: false };

  function tex(w, h, hdr, linear) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (hdr) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
    else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function fb(t) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
  }
  function clear(f, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.02, 0.027, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function setSize(ow, oh, iw, ih) {
    if (iw !== inW || ih !== inH) {
      if (sceneTex) { gl.deleteTexture(sceneTex); gl.deleteFramebuffer(sceneFb); }
      inW = iw; inH = ih;
      sceneTex = tex(inW, inH, false, true);
      sceneFb = fb(sceneTex);
    }
    if (ow !== outW || oh !== outH) {
      for (let i = 0; i < 2; i++) if (hist[i]) { gl.deleteTexture(hist[i]); gl.deleteFramebuffer(histFb[i]); }
      if (oldTex) { gl.deleteTexture(oldTex); gl.deleteFramebuffer(oldFb); }
      outW = ow; outH = oh;
      for (let i = 0; i < 2; i++) { hist[i] = tex(outW, outH, floatOk, false); histFb[i] = fb(hist[i]); clear(histFb[i], outW, outH); }
      oldTex = tex(outW, outH, floatOk, false);
      oldFb = fb(oldTex);
      clear(oldFb, outW, outH);
      hasHist = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Versatz fuer das naechste Szenenbild (in Eingangs-Pixeln). */
  function jitter() { return JITTER[frameNo % JITTER.length]; }

  /** Szene in den Zwischenspeicher zeichnen lassen. */
  function bindScene() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFb);
    gl.viewport(0, 0, inW, inH);
  }

  function draw(prog) { gl.useProgram(prog); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  /** Aktuelles Szenenbild verrechnen und ausgeben. alpha: Anteil des neuen Bildes (0..1). */
  function finish(alpha, sharp, now) {
    const [jx, jy] = jitter();
    const next = 1 - cur;
    // A: Rekonstruktion
    gl.bindFramebuffer(gl.FRAMEBUFFER, histFb[next]);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(resolve.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, hist[cur]);
    gl.uniform1i(resolve.u.uCur, 0);
    gl.uniform1i(resolve.u.uHist, 1);
    gl.uniform2f(resolve.u.uInRes, inW, inH);
    gl.uniform2f(resolve.u.uOutRes, outW, outH);
    gl.uniform2f(resolve.u.uJitter, jx, jy);
    gl.uniform1f(resolve.u.uAlpha, alpha);
    gl.uniform1f(resolve.u.uHasHist, hasHist ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = next;
    hasHist = true;
    frameNo++;
    present(now, sharp, null);
  }

  // Ausgabe auf den Bildschirm (oder in target, z.B. um das aktuelle Bild einzufrieren)
  function present(now, sharp, target) {
    let prog = 1;
    if (trans.active && !target) {
      prog = Math.min(1, (now - trans.t0) / trans.dur);
      if (prog >= 1) trans.active = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(present_.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hist[cur]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, target ? hist[cur] : oldTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, stillTex || hist[cur]);
    gl.uniform1i(present_.u.uImg, 0);
    gl.uniform1i(present_.u.uOld, 1);
    gl.uniform1i(present_.u.uStill, 2);
    gl.uniform1f(present_.u.uUseStill, useStill && stillTex ? 1 : 0);
    gl.uniform1f(present_.u.uFade, trans.fade ? 1 : 0);
    gl.uniform2f(present_.u.uOutRes, outW, outH);
    gl.uniform1f(present_.u.uSharp, sharp);
    gl.uniform1f(present_.u.uProg, trans.active && !target ? prog : 1);
    gl.uniform1f(present_.u.uAspect, outW / outH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Nur ausgeben (keine Szene rechnen) – fuer das Vorschaubild. */
  function presentOnly(now, sharp) { present(now, sharp, null); }

  /** Szenenwechsel: aktuell sichtbares Bild einfrieren, dann einbrennen (oder weich ueberblenden). */
  function beginTransition(now, fromBlack, fade = false) {
    if (fromBlack || (!hasHist && !useStill)) clear(oldFb, outW, outH);
    else present(now, 0.6, oldFb);   // genau das, was gerade zu sehen ist
    hasHist = false;
    trans = { active: true, t0: now, dur: fade ? 900 : 1700, fade };
  }

  /** Vorschaubild sofort zeigen (einbrennen), bis die Szene live ist. */
  function showStill(img, now, fromBlack) {
    beginTransition(now, fromBlack, false);
    if (!stillTex) stillTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, stillTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    useStill = true;
  }

  /** Vorschaubild verwerfen (nach beginTransition, das es schon eingefroren hat). */
  function dropStill() { useStill = false; }

  /** Vom Vorschaubild ins Live-Bild wechseln. */
  function endStill(now) {
    if (!useStill) return false;
    beginTransition(now, false, true);
    useStill = false;
    return true;
  }

  function inTransition() { return trans.active; }
  /** Verlauf verwerfen (z.B. grosser Sprung der Uhrzeit). */
  function reset() { hasHist = false; }

  return { setSize, jitter, bindScene, draw, finish, presentOnly, beginTransition, showStill, endStill, dropStill, inTransition, reset,
    get showingStill() { return useStill; }, get inSize() { return [inW, inH]; }, get outSize() { return [outW, outH]; } };
}
