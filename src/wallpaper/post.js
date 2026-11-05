// Lettoscape – image post-processing
//
// To save power the scene is rendered at a lower resolution. Instead of simply stretching the
// image (pixelated/mushy), it is reconstructed here:
//
//  1. Jitter: every frame is rendered with a tiny, changing sub-pixel offset.
//  2. Temporal reconstruction (TAA upscaling): the frames are accumulated at full resolution.
//     Since the scenes hardly move, after a few frames this yields a sharp, smooth image
//     with far more detail than the low resolution provides.
//     To avoid ghosting on motion (leaves, rain, mouse) the history is clamped to the colors
//     of the current neighborhood (neighborhood clamping).
//  3. Light sharpening on output.
//  4. Scene change: the new scene "burns" in over the old one like an ember and visibly
//     gets sharper – you watch it come into being.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Pass A: current frame + history -> new history (full resolution)
const RESOLVE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uCur;     // current scene image (low resolution)
uniform sampler2D uHist;    // history so far (full resolution)
uniform vec2 uInRes;
uniform vec2 uOutRes;
uniform vec2 uJitter;       // offset of the current frame in input pixels
uniform float uAlpha;       // share of the new frame
uniform float uHasHist;

// Catmull-Rom (bicubic, sharp) with 9 bilinear taps
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

// Color space in which clamping works better
vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

void main() {
  vec2 uv = vUv - uJitter / uInRes;
  vec3 cur = catmullRom(uv);
  if (uHasHist < 0.5) { o = vec4(cur, 1.0); return; }

  // Color range of the neighborhood in the current frame (mean +- spread)
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
  // strongly deviating history (motion) -> move to the new frame faster
  float diff = length((h - hc) / max(hi - lo, vec3(0.02)));
  float a = clamp(uAlpha + diff * 0.25, uAlpha, 0.8);
  o = vec4(mix(fromYCoCg(hc), cur, a), 1.0);
}`;

// Pass B: output to the screen (sharpening + burn-in of the new scene)
const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uImg;     // new history
uniform sampler2D uOld;     // frozen image of the previous scene
uniform sampler2D uStill;   // preview image (while the scene is not live yet)
uniform float uUseStill;
uniform float uFade;        // 1 = blend softly instead of burning in
uniform vec2 uOutRes;
uniform float uSharp;
uniform float uProg;        // progress of the scene change 0..1 (>= 1: done)
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
  // contrast-adaptive sharpening (like AMD CAS, simplified)
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
    // preview image -> live image: gentle and unobtrusive
    vec3 old = texelFetch(uOld, p, 0).rgb;
    c = mix(old, c, smoothstep(0.0, 1.0, uProg));
  } else if (uProg < 1.0) {
    // new scene burns in over the old one: from bottom center outwards, with an ember edge
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

// Halton sequence (2,3): evenly distributed sub-pixel offsets
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

  /** Offset for the next scene frame (in input pixels). */
  function jitter() { return JITTER[frameNo % JITTER.length]; }

  /** Have the scene drawn into the intermediate buffer. */
  function bindScene() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFb);
    gl.viewport(0, 0, inW, inH);
  }

  function draw(prog) { gl.useProgram(prog); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  /** Blend the current scene frame and output it. alpha: share of the new frame (0..1). */
  function finish(alpha, sharp, now) {
    const [jx, jy] = jitter();
    const next = 1 - cur;
    // A: reconstruction
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

  // Output to the screen (or into target, e.g. to freeze the current image)
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

  /** Output only (render no scene) – for the preview image. */
  function presentOnly(now, sharp) { present(now, sharp, null); }

  /** Scene change: freeze the currently visible image, then burn in (or blend softly). */
  function beginTransition(now, fromBlack, fade = false) {
    if (fromBlack || (!hasHist && !useStill)) clear(oldFb, outW, outH);
    else present(now, 0.6, oldFb);   // exactly what is visible right now
    hasHist = false;
    trans = { active: true, t0: now, dur: fade ? 900 : 1700, fade };
  }

  /** Show the preview image at once (burn in) until the scene is live. */
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

  /** Discard the preview image (after beginTransition, which has already frozen it). */
  function dropStill() { useStill = false; }

  /** Switch from the preview image to the live image. */
  function endStill(now) {
    if (!useStill) return false;
    beginTransition(now, false, true);
    useStill = false;
    return true;
  }

  function inTransition() { return trans.active; }
  /** Discard the history (e.g. big jump in time of day). */
  function reset() { hasHist = false; }

  return { setSize, jitter, bindScene, draw, finish, presentOnly, beginTransition, showStill, endStill, dropStill, inTransition, reset,
    get showingStill() { return useStill; }, get inSize() { return [inW, inH]; }, get outSize() { return [outW, outH]; } };
}
