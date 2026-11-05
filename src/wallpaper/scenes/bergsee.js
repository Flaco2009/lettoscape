// Szene "Bergsee" – GLSL-Shader als String-Modul.
export default `#version 300 es
// Lettoscape – Szene "Bergsee"
// Raymarched Berge, See mit Spiegelung, Nadelwald, Tal-Nebel, Tag/Nacht, Wetter.
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uHour;     // 0..24
uniform float uRain;     // 0..1
uniform float uSnow;     // 0..1
uniform float uFog;      // 0..1  Tal-Nebel
uniform float uClouds;   // 0..1  Bewoelkung
uniform float uBright;   // 0.5..1.5
uniform vec2  uMouse;    // -1..1 Parallax
uniform float uQuality;  // 0 = niedrig, 1 = hoch

// ZERO: siehe common.js – verhindert Ausrollen von Schleifen (schnelleres Kompilieren unter Windows)
#define ZERO min(int(uRes.x), 0)

const float PI = 3.14159265;
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

// ---------- Noise ----------
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = ZERO; i < oct; i++) {
    s += a * noise(p);
    p = ROT * p * 2.03;
    a *= 0.5;
  }
  return s;
}
float ridged(vec2 p, int oct) {
  float a = 0.5, s = 0.0, w = 1.0;
  for (int i = ZERO; i < oct; i++) {
    float n = 1.0 - abs(noise(p) * 2.0 - 1.0);
    n *= n;
    s += a * n * w;
    w = clamp(n * 1.6, 0.0, 1.0);
    p = ROT * p * 2.07;
    a *= 0.5;
  }
  return s;
}

// ---------- Gelaende ----------
float groundH(vec2 p, int oct) {
  float x = p.x, z = p.y;
  float hills = fbm(p * 0.018 + 3.0, 4) * 16.0 * smoothstep(60.0, 160.0, z);
  float shoreN = fbm(vec2(x * 0.018, 1.7), 3) * 40.0;
  float shore = smoothstep(55.0, 90.0, z + shoreN - 20.0);
  float side  = smoothstep(14.0, 40.0, abs(x) - z * 0.25);
  float near  = smoothstep(6.0, 0.0, z) * smoothstep(-2.0, 0.0, z + 2.0);
  float h = -2.0 + fbm(p * 0.15, 2) * 0.8;
  h += max(shore, side) * (2.6 + hills);
  h += near * 2.4;
  float mm = smoothstep(160.0, 380.0, z);
  if (mm > 0.0) h += mm * ridged(p * 0.0045 + vec2(1.3, 7.1), oct) * 85.0;
  h += smoothstep(250.0, 600.0, z) * 25.0;
  return h;
}

float forestMask(vec2 p, float g) {
  float m = smoothstep(0.2, 1.2, g) * smoothstep(38.0, 22.0, g);
  m *= smoothstep(0.38, 0.6, fbm(p * 0.03 + 9.0, 3) + 0.2);
  // freie Sicht direkt vor der Kamera
  m *= 1.0 - smoothstep(9.0, 4.0, length(vec2(p.x * 0.6, p.y - 1.0)));
  return m;
}

// Nadelbaeume als Kegel pro Zelle
float treeH(vec2 p, float g) {
  float m = forestMask(p, g);
  if (m < 0.02) return 0.0;
  vec2 cs = vec2(1.8);
  vec2 c = floor(p / cs);
  if (hash(c + 7.1) > m * 1.15) return 0.0;
  vec2 ctr = (c + 0.5 + (vec2(hash(c + 1.3), hash(c + 2.7)) - 0.5) * 0.25) * cs;
  float d = length(p - ctr);
  float th = 3.2 + hash(c + 3.9) * 3.4;
  float rad = th * 0.2;
  // leicht gestufte Silhouette (Aeste)
  float k = 1.0 - d / rad;
  float cone = th * k + 0.05 * th * sin(k * 22.0) * k;
  return max(0.0, cone);
}

float sceneH(vec2 p, float t, out float g) {
  int oct = t < 40.0 ? 8 : (t < 200.0 ? 6 : 5);
  if (uQuality < 0.5) oct = max(oct - 2, 4);
  g = groundH(p, oct);
  if (t > 220.0) return g;
  return g + treeH(p, g);
}

// ---------- Licht / Himmel ----------
vec3 sunDir, moonDir, lightDir, lightCol;
float dayAmt, duskAmt, nightAmt;

void setupLight() {
  float a = (uHour - 6.0) / 12.0 * PI;
  sunDir  = normalize(vec3(-cos(a) * 0.85, sin(a) * 0.75, 0.55));
  moonDir = normalize(vec3( cos(a) * 0.7, -sin(a) * 0.65 + 0.05, 0.6));
  float e = sunDir.y;
  dayAmt   = smoothstep(-0.05, 0.25, e);
  nightAmt = smoothstep(0.0, -0.18, e);
  duskAmt  = clamp(1.0 - abs(e - 0.02) / 0.22, 0.0, 1.0);
  vec3 sunC = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.93, 0.82), smoothstep(0.0, 0.35, e));
  if (e > -0.06) {
    lightDir = sunDir;
    lightCol = sunC * 3.0 * smoothstep(-0.06, 0.08, e);
  } else {
    lightDir = moonDir;
    lightCol = vec3(0.35, 0.45, 0.7) * 0.35 * smoothstep(-0.05, 0.2, moonDir.y);
  }
  float overcast = smoothstep(0.4, 1.0, max(uClouds, max(uRain, uSnow) * 0.95));
  lightCol *= 1.0 - overcast * 0.7;
}

vec3 skyBase(vec3 rd) {
  vec3 zenD = vec3(0.18, 0.38, 0.72), horD = vec3(0.62, 0.72, 0.84);
  vec3 zenS = vec3(0.12, 0.18, 0.38), horS = vec3(1.0, 0.58, 0.24);
  vec3 zenN = vec3(0.006, 0.01, 0.03), horN = vec3(0.03, 0.045, 0.09);
  vec3 zen = mix(mix(zenN, zenD, dayAmt), zenS, duskAmt * 0.5);
  vec3 hor = mix(mix(horN, horD, dayAmt), horS, duskAmt * 0.75);
  float y = max(rd.y, 0.0);
  vec3 col = mix(hor, zen, pow(y, 0.45));
  // Sonnenglanz am Horizont
  float sd = max(dot(rd, sunDir), 0.0);
  col += vec3(1.0, 0.55, 0.3) * pow(sd, 6.0) * (0.25 + duskAmt * 0.8) * smoothstep(-0.2, 0.0, sunDir.y);
  float overcast = smoothstep(0.4, 1.0, max(uClouds, max(uRain, uSnow) * 0.95));
  vec3 grey = vec3(dot(col, vec3(0.33))) * mix(0.25, 1.0, dayAmt) + duskAmt * vec3(0.08, 0.04, 0.02);
  return mix(col, grey * 0.6, overcast * 0.75);
}

vec3 sky(vec3 rd, bool withClouds) {
  vec3 col = skyBase(rd);
  float overcast = smoothstep(0.4, 1.0, max(uClouds, max(uRain, uSnow) * 0.95));
  // Sterne
  if (nightAmt > 0.0 && rd.y > 0.0) {
    vec3 d = rd * 260.0;
    vec2 cell = floor(d.xy + d.z * 0.37);
    float h = hash(cell);
    if (h > 0.9965) {
      vec2 f = fract(d.xy + d.z * 0.37) - 0.5;
      float s = smoothstep(0.35, 0.0, length(f));
      float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 5.0) + h * 100.0);
      col += vec3(0.85, 0.9, 1.0) * s * tw * nightAmt * (1.0 - overcast) * smoothstep(0.0, 0.15, rd.y) * 1.6;
    }
    // Milchstrasse
    float mw = fbm(rd.xy * 6.0 + rd.z * 3.0, 4);
    float band = exp(-pow((rd.x * 0.8 + rd.y * 0.6 - 0.35) * 3.0, 2.0));
    col += vec3(0.25, 0.25, 0.4) * band * mw * 0.12 * nightAmt * (1.0 - overcast);
  }
  // Sonne
  float sd = dot(rd, sunDir);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, sd) * 8.0 * (1.0 - overcast) * step(-0.02, sunDir.y);
  // Mond
  float md = dot(rd, moonDir);
  float moon = smoothstep(0.99955, 0.9997, md);
  col += vec3(0.9, 0.92, 1.0) * moon * 1.6 * nightAmt * (1.0 - overcast * 0.8);
  col += vec3(0.3, 0.35, 0.5) * pow(max(md, 0.0), 300.0) * 0.4 * nightAmt;
  // Wolken
  if (withClouds && rd.y > 0.0) {
    vec2 uv = rd.xz / (rd.y + 0.08) * 1.4;
    uv += vec2(uTime * 0.012, uTime * 0.004);
    float cov = mix(0.62, 0.3, max(uClouds, max(uRain, uSnow)));
    float c = fbm(uv, 6);
    float a = smoothstep(cov, cov + 0.28, c) * smoothstep(0.0, 0.12, rd.y);
    float lit = fbm(uv + sunDir.xz * 0.06, 4);
    vec3 cLight = mix(vec3(0.05, 0.06, 0.09), vec3(1.0, 0.98, 0.95), dayAmt);
    cLight = mix(cLight, vec3(1.0, 0.6, 0.4), duskAmt * 0.7);
    vec3 cDark = cLight * mix(0.45, 0.7, dayAmt) * vec3(0.82, 0.85, 0.95);
    vec3 cc = mix(cLight, cDark, smoothstep(0.3, 0.8, c - lit + 0.5));
    col = mix(col, cc * mix(1.0, 0.65, overcast), a * 0.9);
  }
  return col;
}

// ---------- Raymarch ----------
float marchTerrain(vec3 ro, vec3 rd, float tmax, int steps, out float gOut) {
  float t = 0.1;
  gOut = 0.0;
  for (int i = ZERO; i < steps; i++) {
    vec3 p = ro + rd * t;
    float g;
    float h = sceneH(p.xz, t, g);
    float d = p.y - h;
    if (d < 0.0015 * t) { gOut = g; return t; }
    float k = t < 220.0 ? 0.3 : 0.5;
    t += max(d * k, 0.012 * t);
    if (t > tmax) break;
  }
  return -1.0;
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.5;
  int n = uQuality > 0.5 ? 32 : 14;
  for (int i = ZERO; i < n; i++) {
    vec3 p = ro + rd * t;
    float h = p.y - groundH(p.xz, t < 8.0 ? 6 : 4);
    res = min(res, 10.0 * h / t);
    if (res < 0.01 || p.y > 220.0) break;
    t += clamp(h * 0.6, 0.5, 25.0);
  }
  return clamp(res, 0.0, 1.0);
}

vec3 calcNormal(vec2 p, float t) {
  float e = 0.004 * t + 0.02, g;
  float hx = 0.0, hz = 0.0;
  for (int i = ZERO; i < 4; i++) {
    float sx = i == 0 ? 1.0 : (i == 1 ? -1.0 : 0.0);
    float sz = i == 2 ? 1.0 : (i == 3 ? -1.0 : 0.0);
    float hh = sceneH(p + vec2(sx, sz) * e, t, g);
    hx += sx * hh;
    hz += sz * hh;
  }
  return normalize(vec3(-hx, 2.0 * e, -hz));
}

vec3 fogColor(vec3 rd) {
  vec3 c = skyBase(vec3(rd.x, 0.03, rd.z));
  return c;
}

vec3 shadeTerrain(vec3 p, vec3 rd, float t, float g, bool cheap) {
  { float gg; p.y = sceneH(p.xz, t, gg); g = gg; }
  vec3 n = calcNormal(p.xz, t);
  float tree = p.y - g;
  float isTree = smoothstep(0.08, 0.3, tree);
  float fm = forestMask(p.xz, g);

  // Material
  float nv = fbm(p.xz * 0.3, 3);
  vec3 grass = mix(vec3(0.16, 0.2, 0.07), vec3(0.42, 0.36, 0.14), smoothstep(0.35, 0.75, nv));
  vec3 rock  = mix(vec3(0.27, 0.27, 0.29), vec3(0.4, 0.39, 0.38), nv);
  vec3 treeC = mix(vec3(0.03, 0.08, 0.05), vec3(0.06, 0.13, 0.07), hash(floor(p.xz / 1.8)));
  float steep = smoothstep(0.82, 0.55, n.y);
  vec3 alb = mix(grass, rock, max(steep, smoothstep(25.0, 45.0, g)));
  // ferner Wald ohne Geometrie
  alb = mix(alb, treeC * 1.1, fm * smoothstep(150.0, 260.0, t) * 0.85);
  alb = mix(alb, treeC, isTree);
  // Schnee
  float snowLine = mix(50.0, 6.0, uSnow) + fbm(p.xz * 0.02, 4) * 30.0;
  float snow = smoothstep(snowLine - 8.0, snowLine + 8.0, g) * smoothstep(0.3, 0.65, n.y);
  snow = max(snow, uSnow * smoothstep(0.5, 0.9, n.y) * (isTree > 0.5 ? 0.55 : 0.9));
  alb = mix(alb, vec3(0.88, 0.9, 0.95), snow);

  // Licht
  float dif = max(dot(n, lightDir), 0.0);
  float sh = 1.0;
  if (!cheap && t < 160.0 && dif > 0.0 && length(lightCol) > 0.05) sh = softShadow(p + n * (0.3 + 0.002 * t), lightDir);
  vec3 amb = skyBase(vec3(0.0, 1.0, 0.0)) * (0.4 + 0.6 * n.y) * 0.6;
  amb += skyBase(normalize(vec3(-lightDir.x, 0.1, -lightDir.z))) * 0.15;
  float ao = mix(0.55, 1.0, smoothstep(0.0, 3.0, tree)) ;
  ao = isTree > 0.5 ? mix(0.35, 1.0, clamp(tree / 6.0, 0.0, 1.0)) : 1.0;
  vec3 col = alb * (lightCol * dif * sh + amb * ao);
  // Feuchter Glanz bei Regen
  col += uRain * 0.04 * pow(max(dot(reflect(rd, n), lightDir), 0.0), 16.0) * lightCol;
  return col;
}

vec3 applyFog(vec3 col, vec3 ro, vec3 rd, float t) {
  float overcast = smoothstep(0.4, 1.0, max(uClouds, max(uRain, uSnow) * 0.95));
  float dens = 0.0005 + overcast * 0.0009 + uFog * 0.0004;
  float f = 1.0 - exp(-t * dens);
  vec3 fc = fogColor(rd);
  col = mix(col, fc, f);
  // Tal-Nebel (Hoehennebel) mit Animation
  float b = 0.09;
  float a = 0.008 * (0.2 + uFog * 2.0);
  float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float fh = a * exp(-ro.y * b) * (1.0 - exp(-t * ry * b)) / ry;
  vec3 hp = ro + rd * min(t, 400.0);
  float mn = fbm(hp.xz * 0.012 + vec2(uTime * 0.008, 0.0), 4);
  fh *= 0.3 + mn * 1.3;
  vec3 mistC = mix(fc, vec3(0.75, 0.78, 0.82) * mix(0.05, 1.0, dayAmt), 0.5);
  mistC += vec3(1.0, 0.6, 0.35) * duskAmt * 0.25;
  col = mix(col, mistC, clamp(fh, 0.0, 0.85));
  return col;
}

// ---------- Overlays ----------
vec3 birds(vec2 uv, vec3 col) {
  if (dayAmt < 0.3 || uRain > 0.5) return col;
  float tt = uTime * 0.035;
  vec2 c = vec2(fract(tt * 0.6 + 0.3) * 2.6 - 1.3, 0.22 + 0.04 * sin(tt * 2.0));
  float acc = 0.0;
  for (int i = ZERO; i < 14; i++) {
    float fi = float(i);
    vec2 o = vec2(sin(fi * 2.3 + tt * 3.0) * 0.06 + fi * 0.008, cos(fi * 1.7 + tt * 2.5) * 0.025);
    vec2 bp = c + o;
    vec2 d = uv - bp;
    float flap = sin(uTime * 9.0 + fi * 1.3) * 0.004;
    float wing = abs(d.x) * 0.55 - (d.y + flap * (1.0 - abs(d.x) * 120.0));
    float s = smoothstep(0.0028, 0.0, abs(wing) ) * smoothstep(0.009, 0.004, abs(d.x)) ;
    acc = max(acc, s);
  }
  return mix(col, vec3(0.04, 0.04, 0.05), acc * 0.85 * dayAmt);
}

vec3 fireflies(vec2 uv, vec3 col) {
  float amt = nightAmt * (1.0 - uRain) * (1.0 - uSnow);
  if (amt < 0.01) return col;
  for (int i = ZERO; i < 28; i++) {
    float fi = float(i);
    vec2 base = vec2(hash(vec2(fi, 1.0)) * 2.4 - 1.2, -0.28 + hash(vec2(fi, 2.0)) * 0.22);
    vec2 p = base + 0.03 * vec2(sin(uTime * 0.3 + fi * 4.0), cos(uTime * 0.23 + fi * 2.0));
    float blink = smoothstep(0.3, 1.0, sin(uTime * (0.6 + hash(vec2(fi, 3.0))) + fi * 7.0));
    float d = length(uv - p);
    col += vec3(1.0, 0.85, 0.35) * (0.0008 / (d * d + 0.00008)) * blink * amt * 0.012;
  }
  return col;
}

vec3 precipitation(vec2 uv, vec3 col) {
  if (uRain > 0.01) {
    float acc = 0.0;
    for (int l = ZERO; l < 3; l++) {
      float fl = float(l);
      vec2 q = uv * vec2(90.0 + fl * 40.0, 2.5 + fl);
      q.x += q.y * 0.15;
      q.y += uTime * (5.0 + fl * 2.0);
      vec2 c = floor(q);
      vec2 f = fract(q);
      float h = hash(c + fl * 13.0);
      float streak = smoothstep(0.08, 0.0, abs(f.x - 0.5)) * smoothstep(0.0, 0.3, f.y) * smoothstep(1.0, 0.6, f.y);
      acc += streak * step(1.0 - uRain * 0.35, h) * (0.5 - fl * 0.12);
    }
    col = mix(col, col + vec3(0.6, 0.65, 0.7) * mix(0.15, 0.6, dayAmt), clamp(acc, 0.0, 1.0) * 0.35);
  }
  if (uSnow > 0.01) {
    for (int l = ZERO; l < 4; l++) {
      float fl = float(l);
      float sc = 12.0 + fl * 9.0;
      vec2 q = uv * sc;
      q.y += uTime * (0.25 + fl * 0.08) * sc * 0.08;
      q.x += sin(uTime * 0.5 + q.y * 0.4 + fl) * 0.4;
      vec2 c = floor(q);
      vec2 f = fract(q) - 0.5;
      float h = hash(c + fl * 7.0);
      vec2 o = (vec2(hash(c + 3.0), hash(c + 5.0)) - 0.5) * 0.6;
      float s = smoothstep(0.09 - fl * 0.015, 0.0, length(f - o));
      col += vec3(0.9, 0.92, 1.0) * s * step(1.0 - uSnow * 0.6, h) * mix(0.25, 0.85, dayAmt) * (0.8 - fl * 0.12);
    }
  }
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// ---------- Main ----------
void main() {
  setupLight();
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  vec3 ro = vec3(uMouse.x * 0.6, 2.3 + uMouse.y * 0.15, 0.0);
  ro += vec3(sin(uTime * 0.11) * 0.06, sin(uTime * 0.17) * 0.035, sin(uTime * 0.07) * 0.05);
  float yaw = uMouse.x * 0.035;
  float pitch = 0.035 + uMouse.y * 0.02;
  vec3 fw = normalize(vec3(sin(yaw), pitch, cos(yaw)));
  vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw * 1.55 + uv.x * rt + uv.y * up);

  int steps = uQuality > 0.5 ? 200 : 110;
  float tmax = 1400.0;
  float tWater = rd.y < 0.0 ? -ro.y / rd.y : 1e9;

  float g;
  float t = marchTerrain(ro, rd, min(tWater, tmax), steps, g);
  vec3 col;

  if (t > 0.0) {
    vec3 p = ro + rd * t;
    col = shadeTerrain(p, rd, t, g, false);
    col = applyFog(col, ro, rd, t);
  } else if (tWater < tmax) {
    vec3 p = ro + rd * tWater;
    // Wellen
    float sp = uTime * (0.35 + uRain * 0.6);
    vec2 wp = p.xz * vec2(0.35, 0.9);
    float e = 0.05;
    float w0 = fbm(wp * 0.9 + sp, 4);
    float wx = fbm((wp + vec2(e, 0)) * 0.9 + sp, 4);
    float wz = fbm((wp + vec2(0, e)) * 0.9 + sp, 4);
    float amp = (0.035 + uRain * 0.15) * exp(-tWater * 0.02);
    vec3 n = normalize(vec3(-(wx - w0) / e * amp, 1.0, -(wz - w0) / e * amp));
    // Regentropfen-Ringe
    if (uRain > 0.01) {
      vec2 rc = floor(p.xz * 1.2);
      vec2 rf = fract(p.xz * 1.2) - 0.5;
      float ph = fract(uTime * 0.8 + hash(rc));
      float ring = sin((length(rf) - ph * 0.5) * 60.0) * smoothstep(0.5, 0.0, length(rf)) * (1.0 - ph);
      n.xz += normalize(rf + 1e-4) * ring * 0.15 * uRain;
      n = normalize(n);
    }
    // springende Fische
    {
      vec2 fc = floor(p.xz / 9.0);
      float fh = hash(fc + 41.0);
      if (fh > 0.55) {
        vec2 ctr = (fc + 0.2 + 0.6 * vec2(hash(fc + 2.0), hash(fc + 7.0))) * 9.0;
        float ph = fract(uTime * (0.05 + fh * 0.04) + fh * 10.0);
        float dd = length(p.xz - ctr);
        float ring = sin((dd - ph * 4.0) * 9.0) * smoothstep(ph * 4.0 + 0.6, ph * 4.0, dd) * smoothstep(ph * 4.0 - 1.5, ph * 4.0, dd) * (1.0 - ph);
        n.xz += normalize(p.xz - ctr + 1e-4) * ring * 0.12;
        n = normalize(n);
      }
    }
    vec3 rr = reflect(rd, n);
    rr.y = abs(rr.y);
    float g2;
    float t2 = marchTerrain(p + vec3(0, 0.02, 0), rr, 1200.0, uQuality > 0.5 ? 100 : 55, g2);
    vec3 refl;
    if (t2 > 0.0) {
      vec3 p2 = p + rr * t2;
      refl = shadeTerrain(p2, rr, t2, g2, true);
      refl = applyFog(refl, p, rr, t2);
    } else {
      refl = sky(rr, true);
    }
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    fres = mix(fres, 1.0, 0.55);
    vec3 water = vec3(0.01, 0.035, 0.04) * (0.3 + dayAmt);
    col = mix(water, refl * 0.92, fres);
    // Mondlicht- / Sonnenpfad
    float spec = pow(max(dot(rr, lightDir), 0.0), 400.0);
    col += lightCol * spec * 1.5;
    col = applyFog(col, ro, rd, tWater);
  } else {
    col = sky(rd, true);
    col = mix(col, applyFog(col, ro, rd, 1400.0), 0.35 * smoothstep(0.25, 0.0, rd.y));
  }

  vec2 suv = gl_FragCoord.xy / uRes - 0.5;
  suv.x *= uRes.x / uRes.y;
  col = birds(suv, col);
  col = fireflies(suv, col);
  col = precipitation(suv, col);

  col *= uBright * 1.15;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  // leichte S-Kurve + Saettigung fuer mehr Tiefe
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.12);
  // Vignette + Korn
  vec2 q = gl_FragCoord.xy / uRes;
  col *= 0.55 + 0.45 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.18);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.012;
  fragColor = vec4(col, 1.0);
}
`;
