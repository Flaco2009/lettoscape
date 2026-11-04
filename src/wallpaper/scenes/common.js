// Lettoscape – gemeinsame Shader-Basis fuer alle Szenen (ausser Bergsee, der ist eigenstaendig).
//
// Eine Szene liefert nur ihren eigenen GLSL-Teil (siehe build()). Pflicht-Funktionen:
//
//   float groundH(vec2 p, int oct)              Gelaendehoehe
//   float forestMask(vec2 p, float g)           0..1 wo Nadelbaeume wachsen
//   float sdObj(vec3 p, out float m)            SDF aller Objekte, m = Material-ID (>= 1)
//   vec3  objAlbedo(float m, vec3 p, vec3 n)    Farbe je Material
//   vec3  objEmit(float m, vec3 p, vec3 n)      Eigenleuchten (Fenster, Feuer, Lampen)
//   vec3  sceneLights(vec3 p, vec3 n)           Licht lokaler Quellen auf Oberflaechen
//   vec3  sceneVolume(vec3 ro, vec3 rd, float t, vec3 col)  Glow, Rauch, Lichtkegel
//   void  sceneCamera(out vec3 ro, out vec3 fw) Kamera
//
// Pflicht-Defines: TMAX, TREE_DIST, HAS_WATER (0/1), WAVE_AMP, WAVE_DIR (vec2)

const prelude = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uHour;
uniform float uRain;
uniform float uSnow;
uniform float uFog;
uniform float uClouds;
uniform float uBright;
uniform vec2  uMouse;
uniform float uQuality;

const float PI = 3.14159265;
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

// ---------- Noise ----------
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash1(float x) { return hash(vec2(x, x * 1.37 + 0.11)); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * noise(p);
    p = ROT * p * 2.03;
    a *= 0.5;
  }
  return s;
}
float ridged(vec2 p, int oct) {
  float a = 0.5, s = 0.0, w = 1.0;
  for (int i = 0; i < 9; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(noise(p) * 2.0 - 1.0);
    n *= n;
    s += a * n * w;
    w = clamp(n * 1.6, 0.0, 1.0);
    p = ROT * p * 2.07;
    a *= 0.5;
  }
  return s;
}
// Ferne Berge als Kulisse (fuer Szenen mit Blick in die Weite)
float farMountains(vec2 p, float start, float height) {
  float m = smoothstep(start, start * 2.2, length(p));
  return m * ridged(p * 0.0045 + vec2(1.3, 7.1), 6) * height;
}

// ---------- SDF-Bausteine ----------
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdCyl(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
// Kegelstumpf, zentriert, Hoehe 2h, unten r1, oben r2
float sdCappedCone(vec3 p, float h, float r1, float r2) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h);
  vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
// Satteldach: Basis bei y=0 mit halber Breite w (x), First auf Hoehe hgt, halbe Laenge len (z)
float sdGable(vec3 p, float w, float hgt, float len) {
  float k = sqrt(hgt * hgt + w * w);
  float roof = (abs(p.x) * hgt + p.y * w - w * hgt) / k;
  return max(max(roof, -p.y), abs(p.z) - len);
}
// Pyramide (4 Seiten), Basis halbe Breite w bei y=0, Spitze bei hgt
float sdPyramid(vec3 p, float w, float hgt) {
  float k = sqrt(hgt * hgt + w * w);
  vec2 q = abs(p.xz);
  float m = max(q.x, q.y);
  return max((m * hgt + p.y * w - w * hgt) / k, -p.y);
}
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// Flache Bauflaeche: Gelaende um einen Punkt auf feste Hoehe ziehen
float pad(float g, vec2 p, vec2 c, float r, float hgt) {
  return mix(g, hgt, smoothstep(r * 1.9, r, length(p - c)));
}

// ---------- Licht / Himmel ----------
vec3 sunDir, moonDir, lightDir, lightCol;
float dayAmt, duskAmt, nightAmt, overcast;

void setupLight() {
  float a = (uHour - 6.0) / 12.0 * PI;
  sunDir  = normalize(vec3(-cos(a) * 0.85, sin(a) * 0.75, 0.55));
  moonDir = normalize(vec3( cos(a) * 0.7, -sin(a) * 0.65 + 0.05, 0.6));
  float e = sunDir.y;
  dayAmt   = smoothstep(-0.05, 0.25, e);
  nightAmt = smoothstep(0.0, -0.18, e);
  duskAmt  = clamp(1.0 - abs(e - 0.02) / 0.22, 0.0, 1.0);
  overcast = smoothstep(0.4, 1.0, max(uClouds, max(uRain, uSnow) * 0.95));
  vec3 sunC = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.93, 0.82), smoothstep(0.0, 0.35, e));
  if (e > -0.06) {
    lightDir = sunDir;
    lightCol = sunC * 3.0 * smoothstep(-0.06, 0.08, e);
  } else {
    lightDir = moonDir;
    lightCol = vec3(0.35, 0.45, 0.7) * 0.5 * smoothstep(-0.05, 0.2, moonDir.y);
  }
  lightCol *= 1.0 - overcast * 0.7;
}

// Warmes Fensterlicht: nachts hell, tagsueber nur leicht
vec3 windowGlow(float seed) {
  float fl = 0.85 + 0.15 * noise(vec2(uTime * 2.5, seed * 7.0));
  return vec3(1.0, 0.6, 0.24) * (0.25 + 2.8 * nightAmt + 1.2 * duskAmt) * fl;
}
// Flackerndes Feuer
float fireFlicker(float seed) {
  return 0.75 + 0.25 * noise(vec2(uTime * 7.0, seed)) + 0.1 * sin(uTime * 23.0 + seed);
}

vec3 skyBase(vec3 rd) {
  vec3 zenD = vec3(0.18, 0.38, 0.72), horD = vec3(0.62, 0.72, 0.84);
  vec3 zenS = vec3(0.12, 0.18, 0.38), horS = vec3(1.0, 0.58, 0.24);
  vec3 zenN = vec3(0.006, 0.01, 0.03), horN = vec3(0.03, 0.045, 0.09);
  vec3 zen = mix(mix(zenN, zenD, dayAmt), zenS, duskAmt * 0.5);
  vec3 hor = mix(mix(horN, horD, dayAmt), horS, duskAmt * 0.75);
  float y = max(rd.y, 0.0);
  vec3 col = mix(hor, zen, pow(y, 0.45));
  float sd = max(dot(rd, sunDir), 0.0);
  col += vec3(1.0, 0.55, 0.3) * pow(sd, 6.0) * (0.25 + duskAmt * 0.8) * smoothstep(-0.2, 0.0, sunDir.y);
  vec3 grey = vec3(dot(col, vec3(0.33))) * mix(0.25, 1.0, dayAmt) + duskAmt * vec3(0.08, 0.04, 0.02);
  return mix(col, grey * 0.6, overcast * 0.75);
}

vec3 sky(vec3 rd) {
  vec3 col = skyBase(rd);
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
    float mw = fbm(rd.xy * 6.0 + rd.z * 3.0, 4);
    float band = exp(-pow((rd.x * 0.8 + rd.y * 0.6 - 0.35) * 3.0, 2.0));
    col += vec3(0.25, 0.25, 0.4) * band * mw * 0.12 * nightAmt * (1.0 - overcast);
  }
  float sd = dot(rd, sunDir);
  col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, sd) * 8.0 * (1.0 - overcast) * step(-0.02, sunDir.y);
  float md = dot(rd, moonDir);
  col += vec3(0.9, 0.92, 1.0) * smoothstep(0.99955, 0.9997, md) * 1.6 * nightAmt * (1.0 - overcast * 0.8);
  col += vec3(0.3, 0.35, 0.5) * pow(max(md, 0.0), 300.0) * 0.4 * nightAmt;
  if (rd.y > 0.0) {
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

// Licht einer Punktquelle (fuer sceneLights)
vec3 pointLight(vec3 p, vec3 n, vec3 lp, vec3 lc) {
  vec3 l = lp - p;
  float d2 = dot(l, l);
  return lc * max(dot(n, l * inversesqrt(d2)), 0.0) / (d2 + 0.6);
}
// Leuchthof einer Punktquelle entlang des Blickstrahls (fuer sceneVolume)
vec3 pointGlow(vec3 ro, vec3 rd, float t, vec3 lp, vec3 lc, float size) {
  vec3 v = lp - ro;
  float along = dot(v, rd);
  if (along < 0.0 || along > t + size) return vec3(0.0);
  float h2 = dot(v, v) - along * along;
  return lc * size * size / (h2 + size * size * 0.15) * 0.05;
}

// ---------- Wind ----------
const vec2 WIND = vec2(0.94, 0.34);
// Boeen ziehen als Wellen ueber die Landschaft
float gustAt(vec2 p) { return fbm(p * 0.05 - WIND * uTime * 0.35, 3); }
vec2 windSway(vec2 c) {
  float ph = hash(c) * 6.2832;
  float gust = gustAt(c);
  float storm = 1.0 + uRain * 1.5;
  return WIND * (sin(uTime * 1.4 + ph) * 0.05 + gust * 0.22) * storm;
}

// Ziehende Wolkenschatten auf dem Boden
float cloudShadow(vec2 p) {
  float c = fbm(p * 0.006 + WIND * uTime * 0.025, 4);
  float amt = clamp(0.25 + uClouds * 1.4, 0.0, 1.0) * (1.0 - overcast) * dayAmt;
  return 1.0 - smoothstep(0.42, 0.68, c) * 0.6 * amt;
}

// Rauchsaeule (Kamin, Lagerfeuer). S = Austritt, strength ~ 0..1
vec3 smokeColumn(vec3 ro, vec3 rd, float t, vec3 col, vec3 S, float strength, float spread) {
  vec2 rxz = rd.xz;
  float s = dot(S.xz - ro.xz, rxz) / max(dot(rxz, rxz), 1e-4);
  if (s <= 0.0 || s >= t) return col;
  vec3 P = ro + rd * s;
  float hy = P.y - S.y;
  if (hy <= 0.0) return col;
  vec2 drift = WIND * hy * (0.35 + uRain * 0.3) + vec2(sin(uTime * 0.35 + hy * 0.8), cos(uTime * 0.27 + hy)) * 0.12 * hy;
  float hd = length(P.xz - S.xz - drift);
  float w = 0.18 + spread * hy;
  float dens = exp(-hd * hd / (w * w)) * smoothstep(12.0, 0.5, hy) * smoothstep(0.0, 0.4, hy);
  dens *= 0.35 + 1.0 * fbm(vec2(hd * 2.5 + hy * 0.3, hy * 1.3 - uTime * 0.7), 4);
  vec3 lit = skyBase(vec3(0.0, 1.0, 0.0)) * 0.9 + lightCol * 0.12;
  vec3 smoke = mix(vec3(0.62, 0.62, 0.66) * mix(0.12, 1.0, dayAmt), lit, 0.4);
  // nachts leicht mondhell, damit der Rauch vor dem dunklen Himmel sichtbar bleibt
  smoke = max(smoke, vec3(0.1, 0.11, 0.15) * nightAmt);
  // unten warm angestrahlt (Feuer/Fenster)
  smoke += vec3(0.5, 0.22, 0.06) * smoothstep(2.0, 0.0, hy) * (0.3 + nightAmt) * 0.5;
  return mix(col, smoke, clamp(dens * strength, 0.0, 0.75));
}

vec3 flowerColor(float h) {
  if (h < 0.3) return vec3(0.92, 0.9, 0.84);
  if (h < 0.55) return vec3(0.95, 0.78, 0.18);
  if (h < 0.8) return vec3(0.55, 0.36, 0.82);
  return vec3(0.92, 0.36, 0.42);
}
`;

const core = `
// ---------- Optionale Szenen-Schalter ----------
#ifndef LEAVES
#define LEAVES 0.5        // fallende Blaetter (0 = aus)
#endif
#ifndef FLOWERS
#define FLOWERS 0.6       // Blumen auf Wiesen
#endif
#ifndef BATS
#define BATS 0.0          // Fledermaeuse in der Daemmerung/Nacht
#endif
#ifndef BUTTERFLIES
#define BUTTERFLIES 0.0   // Schmetterlinge am Tag
#endif
#ifndef FISH
#define FISH 1.0          // springende Fische (Ringe im Wasser)
#endif

// ---------- Wald ----------
float treeH(vec2 p, float g) {
  float m = forestMask(p, g);
  if (m < 0.02) return 0.0;
  vec2 cs = vec2(1.8);
  vec2 c = floor(p / cs);
  if (hash(c + 7.1) > m * 1.15) return 0.0;
  vec2 ctr = (c + 0.5 + (vec2(hash(c + 1.3), hash(c + 2.7)) - 0.5) * 0.25) * cs;
  float th = 3.2 + hash(c + 3.9) * 3.4;
  float rad = th * 0.21;
  // Wind: Spitze schwankt staerker als der Fuss
  vec2 sway = windSway(ctr);
  float k0 = 1.0 - length(p - ctr) / rad;
  vec2 dv = p - ctr - sway * clamp(k0, 0.0, 1.0);
  // zerzauste Silhouette statt glattem Kegel
  float a = atan(dv.y, dv.x);
  rad *= 0.86 + 0.2 * noise(vec2(a * 2.2 + hash(c) * 20.0, th * 3.0));
  float k = 1.0 - length(dv) / rad;
  if (k <= 0.0) return 0.0;
  // Nadel-Struktur: weiche Buckel statt harter Etagen (keine Streifen)
  float fluff = (noise(dv * 3.0 + c * 7.0) - 0.5) * 0.35 * sqrt(k);
  return max(0.0, th * k + fluff);
}

float sceneH(vec2 p, float t, out float g) {
  g = groundH(p, t < 150.0 ? 8 : 6);
  if (t > TREE_DIST) return g;
  return g + treeH(p, g);
}

float fieldD(vec3 p, float t) {
  float g, om;
  return min((p.y - sceneH(p.xz, t, g)) * 0.6, sdObj(p, om));
}

float march(vec3 ro, vec3 rd, float tmax, int steps, out float m, out float g) {
  float t = 0.05;
  m = 0.0; g = 0.0;
  for (int i = 0; i < 280; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float h = sceneH(p.xz, t, g);
    float dT = p.y - h;
    float om;
    float dO = sdObj(p, om);
    if (dO < 0.0015 * t + 0.001) { m = om; return t; }
    if (dT < 0.0015 * t) { m = 0.0; return t; }
    float k = t < TREE_DIST ? 0.3 : 0.5;
    t += min(max(dT * k, 0.008 * t), dO);
    if (t > tmax) break;
  }
  return -1.0;
}

float softShadow(vec3 ro, vec3 rd) {
  // Startpunkt leicht verrauscht, damit keine Streifen (Banding) entstehen
  float res = 1.0, t = 0.3 + 0.3 * hash(ro.xz * 37.0 + fract(uTime));
  float ph = 1e10;
  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * t;
    float om;
    float hT = p.y - groundH(p.xz, t < 8.0 ? 8 : 4);
    float hO = sdObj(p, om);
    // Objekt-Abstaende >= 0.45 koennen Begrenzungsvolumen sein -> kein Halbschatten
    float h = hO < 0.45 ? min(hT, hO) : hT;
    float stepH = min(hT, hO);
    // verbesserte weiche Schatten (iq)
    float y = h * h / (2.0 * ph);
    float d = sqrt(max(h * h - y * y, 0.0));
    res = min(res, 7.0 * d / max(0.0, t - y));
    ph = h;
    if (res < 0.01 || p.y > 200.0) break;
    t += clamp(stepH * 0.8, 0.12, 20.0);
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

vec3 calcNormal(vec3 p, float t) {
  float e = 0.0015 * t + 0.004;
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * fieldD(p + k.xyy * e, t) + k.yyx * fieldD(p + k.yyx * e, t) +
                   k.yxy * fieldD(p + k.yxy * e, t) + k.xxx * fieldD(p + k.xxx * e, t));
}

vec3 terrainNormal(vec2 p, float t) {
  float e = 0.002 * t + 0.03, g;
  float hx = sceneH(p + vec2(e, 0), t, g) - sceneH(p - vec2(e, 0), t, g);
  float hz = sceneH(p + vec2(0, e), t, g) - sceneH(p - vec2(0, e), t, g);
  return normalize(vec3(-hx, 2.0 * e, -hz));
}

vec3 objNormal(vec3 p, float t) {
  float e = 0.0008 * t + 0.002, om;
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * sdObj(p + k.xyy * e, om) + k.yyx * sdObj(p + k.yyx * e, om) +
                   k.yxy * sdObj(p + k.yxy * e, om) + k.xxx * sdObj(p + k.xxx * e, om));
}

vec3 terrainAlbedo(vec3 p, vec3 n, float g, float t) {
  float tree = p.y - g;
  float isTree = smoothstep(0.08, 0.3, tree);
  float fm = forestMask(p.xz, g);
  float nv = fbm(p.xz * 0.3, 3);
  vec3 grass = mix(vec3(0.16, 0.2, 0.07), vec3(0.42, 0.36, 0.14), smoothstep(0.35, 0.75, nv));
  // feine Grasstruktur + helle Boeen, die ueber die Wiese laufen
  grass *= 0.85 + 0.3 * noise(p.xz * 6.0);
  float gust = fbm(p.xz * 0.11 - WIND * uTime * 0.9, 3);
  grass *= 0.8 + 0.45 * smoothstep(0.3, 0.75, gust);
  float flowerAmt = FLOWERS * (1.0 - uSnow) * smoothstep(50.0, 15.0, t) * mix(0.25, 1.0, dayAmt);
  if (flowerAmt > 0.01) {
    vec2 fp = p.xz * 2.2;
    vec2 ci = floor(fp);
    float hf = hash(ci + 17.0);
    float fpatch = smoothstep(0.45, 0.65, fbm(p.xz * 0.08 + 3.0, 3));
    if (hf > 0.86 - fpatch * 0.12) {
      vec2 o = fract(fp) - 0.5 - (vec2(hash(ci + 3.0), hash(ci + 5.0)) - 0.5) * 0.5;
      o += WIND * sin(uTime * 2.0 + hf * 30.0) * 0.06;
      float dot1 = smoothstep(0.17, 0.07, length(o));
      grass = mix(grass, flowerColor(hash(ci + 9.0)) * 0.8, dot1 * flowerAmt);
    }
  }
  vec3 rock  = mix(vec3(0.27, 0.27, 0.29), vec3(0.4, 0.39, 0.38), nv);
  vec3 treeC = mix(vec3(0.03, 0.08, 0.05), vec3(0.06, 0.13, 0.07), hash(floor(p.xz / 1.8)));
  // hellere Spitzen, dunkle Tiefe, leichte Farbvariation (Tanne/Fichte)
  treeC *= 0.75 + 0.6 * smoothstep(0.5, 5.0, tree) + 0.25 * noise(p.xz * 4.0 + p.y * 3.0);
  treeC = mix(treeC, treeC * vec3(1.15, 1.05, 0.8), hash(floor(p.xz / 1.8) + 4.0) * 0.5);
  float steep = smoothstep(0.82, 0.55, n.y);
  vec3 alb = mix(grass, rock, max(steep, smoothstep(30.0, 55.0, g)));
  alb = mix(alb, treeC * 1.1, fm * smoothstep(TREE_DIST * 0.7, TREE_DIST, t) * 0.85);
  alb = mix(alb, treeC, isTree);
  float snowLine = mix(50.0, -10.0, uSnow) + fbm(p.xz * 0.02, 4) * 30.0;
  float snow = smoothstep(snowLine - 8.0, snowLine + 8.0, g) * smoothstep(0.3, 0.65, n.y);
  snow = max(snow, uSnow * smoothstep(0.5, 0.9, n.y) * (isTree > 0.5 ? 0.55 : 0.9));
  return mix(alb, vec3(0.88, 0.9, 0.95), snow);
}

vec3 shade(vec3 p, vec3 rd, float t, float m, float g, bool cheap) {
  // Treffer exakt auf die Oberflaeche setzen (verhindert Ringe/Selbstschatten)
  if (m < 0.5) { float gg; p.y = sceneH(p.xz, t, gg); g = gg; }
  vec3 n = m < 0.5 ? terrainNormal(p.xz, t) : objNormal(p, t);
  vec3 alb;
  float ao = 1.0;
  if (m < 0.5) {
    alb = terrainAlbedo(p, n, g, t);
    float tree = p.y - g;
    if (tree > 0.08) ao = mix(0.35, 1.0, clamp(tree / 6.0, 0.0, 1.0));
  } else {
    alb = objAlbedo(m, p, n);
    alb = mix(alb, vec3(0.88, 0.9, 0.95), uSnow * smoothstep(0.6, 0.9, n.y) * 0.85);
  }
  float dif = max(dot(n, lightDir), 0.0);
  float sh = 1.0;
  if (!cheap && dif > 0.0 && length(lightCol) > 0.05) sh = softShadow(p + n * (0.05 + 0.002 * t), lightDir);
  sh *= cloudShadow(p.xz);
  vec3 amb = skyBase(vec3(0.0, 1.0, 0.0)) * (0.4 + 0.6 * n.y) * 0.6;
  amb += skyBase(normalize(vec3(-lightDir.x, 0.1, -lightDir.z))) * 0.15;
  vec3 col = alb * (lightCol * dif * sh + amb * ao + sceneLights(p, n));
  // weiches Randlicht vom Himmel (laesst Silhouetten "atmen")
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  col += alb * skyBase(normalize(vec3(rd.x, 0.15, rd.z))) * rim * 0.35 * ao;
  col += uRain * 0.04 * pow(max(dot(reflect(rd, n), lightDir), 0.0), 16.0) * lightCol;
  if (m > 0.5) col += objEmit(m, p, n);
  return col;
}

vec3 applyFog(vec3 col, vec3 ro, vec3 rd, float t) {
  float dens = 0.0006 + overcast * 0.0012 + uFog * 0.0012;
  float f = 1.0 - exp(-t * dens);
  vec3 fc = skyBase(vec3(rd.x, 0.03, rd.z));
  col = mix(col, fc, f);
  float b = 0.12;
  float a = 0.01 * (0.2 + uFog * 2.0);
  float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float fh = a * exp(-ro.y * b) * (1.0 - exp(-t * ry * b)) / ry;
  vec3 hp = ro + rd * min(t, 400.0);
  float mn = fbm(hp.xz * 0.02 + vec2(uTime * 0.01, 0.0), 4);
  fh *= 0.3 + mn * 1.3;
  vec3 mistC = mix(fc, vec3(0.75, 0.78, 0.82) * mix(0.05, 1.0, dayAmt), 0.5);
  mistC += vec3(1.0, 0.6, 0.35) * duskAmt * 0.25;
  return mix(col, mistC, clamp(fh, 0.0, 0.85));
}

// ---------- Overlays ----------
vec3 birds(vec2 uv, vec3 col) {
  if (dayAmt < 0.3 || uRain > 0.5) return col;
  float tt = uTime * 0.035;
  vec2 c = vec2(fract(tt * 0.6 + 0.3) * 2.6 - 1.3, 0.3 + 0.04 * sin(tt * 2.0));
  float acc = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec2 o = vec2(sin(fi * 2.3 + tt * 3.0) * 0.06 + fi * 0.008, cos(fi * 1.7 + tt * 2.5) * 0.025);
    vec2 d = uv - (c + o);
    float flap = sin(uTime * 9.0 + fi * 1.3) * 0.004;
    float wing = abs(d.x) * 0.55 - (d.y + flap * (1.0 - abs(d.x) * 120.0));
    acc = max(acc, smoothstep(0.0028, 0.0, abs(wing)) * smoothstep(0.009, 0.004, abs(d.x)));
  }
  return mix(col, vec3(0.04, 0.04, 0.05), acc * 0.85 * dayAmt);
}

vec3 fireflies(vec2 uv, vec3 col) {
  float amt = nightAmt * (1.0 - uRain) * (1.0 - uSnow);
  if (amt < 0.01) return col;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    vec2 base = vec2(hash(vec2(fi, 1.0)) * 2.4 - 1.2, -0.3 + hash(vec2(fi, 2.0)) * 0.25);
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
    for (int l = 0; l < 3; l++) {
      float fl = float(l);
      vec2 q = uv * vec2(90.0 + fl * 40.0, 2.5 + fl);
      q.x += q.y * 0.15;
      q.y += uTime * (5.0 + fl * 2.0);
      vec2 c = floor(q), f = fract(q);
      float h = hash(c + fl * 13.0);
      float streak = smoothstep(0.08, 0.0, abs(f.x - 0.5)) * smoothstep(0.0, 0.3, f.y) * smoothstep(1.0, 0.6, f.y);
      acc += streak * step(1.0 - uRain * 0.35, h) * (0.5 - fl * 0.12);
    }
    col = mix(col, col + vec3(0.6, 0.65, 0.7) * mix(0.15, 0.6, dayAmt), clamp(acc, 0.0, 1.0) * 0.35);
  }
  if (uSnow > 0.01) {
    for (int l = 0; l < 4; l++) {
      float fl = float(l);
      float sc = 12.0 + fl * 9.0;
      vec2 q = uv * sc;
      q.y += uTime * (0.25 + fl * 0.08) * sc * 0.08;
      q.x += sin(uTime * 0.5 + q.y * 0.4 + fl) * 0.4;
      vec2 c = floor(q), f = fract(q) - 0.5;
      float h = hash(c + fl * 7.0);
      vec2 o = (vec2(hash(c + 3.0), hash(c + 5.0)) - 0.5) * 0.6;
      float s = smoothstep(0.09 - fl * 0.015, 0.0, length(f - o));
      col += vec3(0.9, 0.92, 1.0) * s * step(1.0 - uSnow * 0.6, h) * mix(0.25, 0.85, dayAmt) * (0.8 - fl * 0.12);
    }
  }
  return col;
}

// Fallende Blaetter (drei Tiefenebenen)
vec3 leaves(vec2 uv, vec3 col) {
  float amt = LEAVES * (1.0 - uSnow) * (1.0 - uRain * 0.6);
  if (amt < 0.01) return col;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float sc = 3.5 + fl * 3.0;
    vec2 q = uv * sc;
    q.y += uTime * (0.22 + fl * 0.05) * sc * 0.12;
    q.x -= uTime * WIND.x * (0.15 + fl * 0.05) * sc * 0.12;
    vec2 c = floor(q);
    float h = hash(c + fl * 31.0);
    if (h < 1.0 - 0.07 * amt) continue;
    vec2 f = fract(q) - 0.5;
    f.x += sin(uTime * (1.2 + h) + h * 40.0) * 0.25;
    float ang = uTime * (1.5 + h * 2.0) + h * 20.0;
    vec2 r = rot2(ang) * f;
    float flip = abs(sin(ang * 0.7));
    float sz = (0.07 - fl * 0.012);
    float leaf = smoothstep(sz, sz * 0.4, length(r * vec2(1.0, 2.2 / max(flip, 0.25))));
    vec3 lc = mix(vec3(0.85, 0.42, 0.1), vec3(0.75, 0.62, 0.15), hash(c + 2.0));
    lc = mix(lc, vec3(0.55, 0.15, 0.08), step(0.75, hash(c + 4.0)));
    lc *= mix(0.08, 1.0, dayAmt) * (0.7 + 0.3 * flip) + duskAmt * vec3(0.15, 0.06, 0.0);
    col = mix(col, lc, leaf * (0.95 - fl * 0.25));
  }
  return col;
}

// Schwebende Staub-/Pollenteilchen im Sonnenlicht
vec3 motes(vec2 uv, vec3 rd, vec3 col) {
  float amt = dayAmt * (1.0 - overcast) * (1.0 - uRain);
  if (amt < 0.01) return col;
  float toward = 0.35 + 1.6 * pow(max(dot(rd, sunDir), 0.0), 4.0);
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float sc = 22.0 + fl * 18.0;
    vec2 q = uv * sc + vec2(uTime * 0.12, sin(uTime * 0.1 + fl) * 0.4) * (1.0 + fl);
    vec2 c = floor(q);
    float h = hash(c + fl * 11.0);
    if (h < 0.93) continue;
    vec2 o = (vec2(hash(c + 1.0), hash(c + 2.0)) - 0.5) * 0.6 + 0.08 * vec2(sin(uTime + h * 50.0), cos(uTime * 0.8 + h * 30.0));
    float d = length(fract(q) - 0.5 - o);
    float tw = 0.5 + 0.5 * sin(uTime * 2.0 + h * 90.0);
    col += vec3(1.0, 0.95, 0.8) * smoothstep(0.06, 0.0, d) * tw * toward * amt * 0.25;
  }
  return col;
}

// Sternschnuppen (nur im Himmel)
vec3 shootingStars(vec2 uv, vec3 col, float skyMask) {
  float amt = nightAmt * (1.0 - overcast) * skyMask;
  if (amt < 0.01) return col;
  for (int i = 0; i < 2; i++) {
    float P = 17.0 + float(i) * 11.0;
    float id = floor((uTime + float(i) * 7.0) / P);
    float ph = fract((uTime + float(i) * 7.0) / P);
    float dur = 0.06;
    if (ph > dur) continue;
    float k = ph / dur;
    vec2 a = vec2(hash1(id * 3.1) * 1.6 - 0.8, 0.22 + hash1(id * 5.7) * 0.22);
    vec2 dir = normalize(vec2(hash1(id * 9.3) > 0.5 ? 1.0 : -1.0, -0.45 - hash1(id) * 0.3));
    vec2 head = a + dir * k * 0.45;
    vec2 v = uv - head;
    float along = dot(v, -dir);
    float perp = length(v + dir * along);
    float tail = smoothstep(0.16, 0.0, along) * step(0.0, along);
    float line = smoothstep(0.0025, 0.0, perp) * tail * sin(k * 3.1416);
    col += vec3(0.9, 0.93, 1.0) * line * amt * 1.5;
  }
  return col;
}

// Fledermaeuse in der Daemmerung und nachts
vec3 bats(vec2 uv, vec3 col) {
  float amt = BATS * max(duskAmt, nightAmt * 0.8) * (1.0 - uRain);
  if (amt < 0.01) return col;
  float acc = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float tt = uTime * (0.25 + hash1(fi) * 0.15) + fi * 13.0;
    vec2 c = vec2(sin(tt * 0.9 + fi) * 0.7 + sin(tt * 2.3) * 0.1, 0.18 + 0.12 * sin(tt * 0.7 + fi * 2.0) + 0.04 * sin(tt * 3.1));
    vec2 d = uv - c;
    float flap = sin(uTime * 16.0 + fi * 2.0);
    vec2 w = vec2(abs(d.x), d.y - flap * 0.006 * (abs(d.x) * 90.0));
    float body = smoothstep(0.004, 0.0015, length(d * vec2(1.0, 0.7)));
    float wing = smoothstep(0.0025, 0.0, abs(w.y - w.x * 0.35 + 0.002)) * smoothstep(0.016, 0.01, w.x);
    acc = max(acc, max(body, wing));
  }
  return mix(col, vec3(0.01, 0.01, 0.02), acc * amt);
}

// Schmetterlinge am Tag
vec3 butterflies(vec2 uv, vec3 col) {
  float amt = BUTTERFLIES * dayAmt * (1.0 - uRain) * (1.0 - uSnow);
  if (amt < 0.01) return col;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float tt = uTime * (0.3 + hash1(fi + 3.0) * 0.2) + fi * 9.0;
    vec2 c = vec2(sin(tt * 0.7 + fi * 1.7) * 0.75, -0.3 + 0.12 * sin(tt * 1.3 + fi) + 0.03 * sin(tt * 5.0));
    vec2 d = uv - c;
    float flap = 0.35 + 0.65 * abs(sin(uTime * 11.0 + fi * 3.0));
    vec2 w = vec2(abs(d.x) / flap, d.y);
    float wings = smoothstep(0.009, 0.004, length((w - vec2(0.006, 0.002)) * vec2(1.0, 0.85)));
    vec3 bc = flowerColor(hash1(fi + 1.0));
    col = mix(col, bc * mix(0.2, 1.0, dayAmt), wings * amt);
  }
  return col;
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// ---------- Main ----------
void main() {
  setupLight();
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  vec3 ro, fw;
  sceneCamera(ro, fw);
  // ganz leichtes "Atmen" der Kamera, damit das Bild nie eingefroren wirkt
  ro += vec3(sin(uTime * 0.11) * 0.06, sin(uTime * 0.17) * 0.035, sin(uTime * 0.07) * 0.05);
  fw = normalize(fw + vec3(sin(uTime * 0.09) * 0.004, sin(uTime * 0.13) * 0.003, 0.0));
  vec3 rt0 = normalize(cross(vec3(0, 1, 0), fw));
  ro += rt0 * uMouse.x * 0.35 + vec3(0.0, uMouse.y * 0.1, 0.0);
  fw = normalize(fw + rt0 * uMouse.x * 0.03 + vec3(0.0, uMouse.y * 0.015, 0.0));
  vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw * 1.55 + uv.x * rt + uv.y * up);

  int steps = uQuality > 0.5 ? 240 : 150;
  float tWater = (HAS_WATER == 1 && rd.y < 0.0) ? -ro.y / rd.y : 1e9;

  float m, g;
  float t = march(ro, rd, min(tWater, TMAX), steps, m, g);
  vec3 col;
  float tHit = TMAX;

  if (t > 0.0) {
    vec3 p = ro + rd * t;
    col = shade(p, rd, t, m, g, false);
    col = applyFog(col, ro, rd, t);
    tHit = t;
  } else if (HAS_WATER == 1 && tWater < TMAX) {
    vec3 p = ro + rd * tWater;
    float sp = uTime * (0.35 + uRain * 0.6);
    vec2 wp = p.xz * vec2(0.35, 0.9) + WAVE_DIR * sp;
    float e = 0.05;
    float w0 = fbm(wp * 0.9 + sp * 0.3, 4);
    float wx = fbm((wp + vec2(e, 0)) * 0.9 + sp * 0.3, 4);
    float wz = fbm((wp + vec2(0, e)) * 0.9 + sp * 0.3, 4);
    float amp = (WAVE_AMP + uRain * 0.15) * exp(-tWater * 0.02);
    vec3 n = normalize(vec3(-(wx - w0) / e * amp, 1.0, -(wz - w0) / e * amp));
    if (uRain > 0.01) {
      vec2 rc = floor(p.xz * 1.2);
      vec2 rf = fract(p.xz * 1.2) - 0.5;
      float ph = fract(uTime * 0.8 + hash(rc));
      float ring = sin((length(rf) - ph * 0.5) * 60.0) * smoothstep(0.5, 0.0, length(rf)) * (1.0 - ph);
      n.xz += normalize(rf + 1e-4) * ring * 0.15 * uRain;
      n = normalize(n);
    }
    // springende Fische: ab und zu Ringe auf dem Wasser
    if (FISH > 0.0) {
      vec2 fc = floor(p.xz / 9.0);
      float fh = hash(fc + 41.0);
      if (fh > 0.55) {
        vec2 ctr = (fc + 0.2 + 0.6 * vec2(hash(fc + 2.0), hash(fc + 7.0))) * 9.0;
        float ph = fract(uTime * (0.05 + fh * 0.04) + fh * 10.0);
        float dd = length(p.xz - ctr);
        float ring = sin((dd - ph * 4.0) * 9.0) * smoothstep(ph * 4.0 + 0.6, ph * 4.0, dd) * smoothstep(ph * 4.0 - 1.5, ph * 4.0, dd) * (1.0 - ph);
        n.xz += normalize(p.xz - ctr + 1e-4) * ring * 0.12 * FISH;
        n = normalize(n);
      }
    }
    vec3 rr = reflect(rd, n);
    rr.y = abs(rr.y);
    float m2, g2;
    float t2 = march(p + vec3(0, 0.02, 0), rr, TMAX, uQuality > 0.5 ? 130 : 80, m2, g2);
    vec3 refl;
    if (t2 > 0.0) {
      vec3 p2 = p + rr * t2;
      refl = shade(p2, rr, t2, m2, g2, true);
      refl = applyFog(refl, p, rr, t2);
    } else {
      refl = sky(rr);
    }
    refl = sceneVolume(p, rr, t2 > 0.0 ? t2 : TMAX, refl);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    fres = mix(fres, 1.0, 0.55);
    vec3 water = vec3(0.01, 0.035, 0.04) * (0.3 + dayAmt);
    col = mix(water, refl * 0.92, fres);
    col += lightCol * pow(max(dot(rr, lightDir), 0.0), 400.0) * 1.5;
    col = applyFog(col, ro, rd, tWater);
    tHit = tWater;
  } else {
    col = sky(rd);
    col = mix(col, applyFog(col, ro, rd, TMAX), 0.35 * smoothstep(0.25, 0.0, rd.y));
  }

  col = sceneVolume(ro, rd, tHit, col);

  vec2 suv = gl_FragCoord.xy / uRes - 0.5;
  suv.x *= uRes.x / uRes.y;
  float skyMask = tHit >= TMAX ? 1.0 : 0.0;
  col = shootingStars(suv, col, skyMask);
  col = birds(suv, col);
  col = bats(suv, col);
  col = motes(suv, rd, col);
  col = butterflies(suv, col);
  col = fireflies(suv, col);
  col = leaves(suv, col);
  col = precipitation(suv, col);

  col *= uBright * 1.15;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.18);
  vec2 q = gl_FragCoord.xy / uRes;
  col *= 0.55 + 0.45 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.18);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.012;
  fragColor = vec4(col, 1.0);
}
`;

/** Baut den kompletten Fragment-Shader aus dem Szenen-Teil. */
export function build(sceneSrc) {
  return prelude + '\n// ===== Szene =====\n' + sceneSrc + '\n// ===== Kern =====\n' + core;
}
