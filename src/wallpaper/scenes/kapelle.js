// Szene "Waldrand-Kapelle": kleine Kapelle mit Glockenturm, Kerzenlicht in den Fenstern.
import { build } from './common.js';

export default build(`
#define TMAX 900.0
#define TREE_DIST 170.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define BATS 0.6
#define BUTTERFLIES 0.7
#define FLOWERS 0.9
#define WAVE_DIR vec2(0.0)

const vec3 K = vec3(-0.5, 0.5, 19.0);
const float KROT = 0.3;

vec3 toK(vec3 p) { vec3 q = p - K; q.xz = rot2(KROT) * q.xz; return q; }
vec3 fromK(vec3 q) { q.xz = rot2(-KROT) * q.xz; return q + K; }

float groundH(vec2 p, int oct) {
  float h = fbm(p * 0.06, 3) * 1.4 + p.y * 0.02;
  h += smoothstep(15.0, 60.0, length(p - K.xz)) * fbm(p * 0.02 + 9.0, 4) * 16.0;
  h = pad(h, p, K.xz, 5.0, K.y);
  h += farMountains(p, 240.0, 90.0);
  return h;
}

float forestMask(vec2 p, float g) {
  // Wald nur hinter und neben der Kapelle (Waldrand)
  float edge = smoothstep(24.0, 30.0, p.y + fbm(vec2(p.x * 0.1, 0.0), 3) * 8.0);
  float sides = smoothstep(14.0, 20.0, abs(p.x));
  float m = max(edge, sides) * smoothstep(7.0, 11.0, length(p - K.xz));
  m *= smoothstep(0.25, 0.42, fbm(p * 0.05 + 6.0, 3) + 0.25);
  return m * smoothstep(45.0, 28.0, g);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = toK(p);
  float best = 1e9;
  if (length(q.xz) < 9.0 && q.y < 9.5) {
    float nave = sdBox(q - vec3(0, 1.7, 0.4), vec3(1.8, 1.7, 3.2));
    if (nave < best) { best = nave; m = 1.0; }
    float roof = sdGable(q - vec3(0, 3.35, 0.4), 2.15, 2.1, 3.45);
    if (roof < best) { best = roof; m = 2.0; }
    vec3 t = q - vec3(0, 0.0, -3.5);
    float tower = sdBox(t - vec3(0, 2.65, 0), vec3(0.85, 2.65, 0.85));
    // Glockenstube
    tower = max(tower, -sdBox(t - vec3(0, 4.55, 0), vec3(1.0, 0.38, 0.45)));
    tower = max(tower, -sdBox(t - vec3(0, 4.55, 0), vec3(0.45, 0.38, 1.0)));
    if (tower < best) { best = tower; m = 1.0; }
    vec3 bq = t - vec3(0, 4.85, 0);
    bq.yz = rot2(sin(uTime * 0.9) * 0.18) * bq.yz;
    float bell = sdCappedCone(bq + vec3(0, 0.3, 0), 0.25, 0.3, 0.14);
    if (bell < best) { best = bell; m = 4.0; }
    float spire = sdPyramid(t - vec3(0, 5.28, 0), 1.0, 2.5);
    if (spire < best) { best = spire; m = 2.0; }
    float cross = min(sdBox(t - vec3(0, 8.1, 0), vec3(0.04, 0.35, 0.04)), sdBox(t - vec3(0, 8.2, 0), vec3(0.22, 0.04, 0.04)));
    if (cross < best) { best = cross; m = 4.0; }
    // Bank
    float bench = sdBox(q - vec3(2.8, 0.45, -3.0), vec3(0.25, 0.05, 0.9));
    bench = min(bench, sdBox(vec3(q.x - 2.8, q.y - 0.22, abs(q.z + 3.0) - 0.75), vec3(0.2, 0.22, 0.05)));
    if (bench < best) { best = bench; m = 3.0; }
  } else {
    best = max(length(q.xz) - 8.5, q.y - 9.0);
  }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  vec3 q = toK(p);
  if (m < 1.5) {
    float grime = fbm(vec2(q.x + q.z, q.y) * 1.2, 4);
    return mix(vec3(0.78, 0.74, 0.66), vec3(0.45, 0.43, 0.38), grime * smoothstep(2.0, 0.0, q.y) + grime * 0.3);
  }
  if (m < 2.5) return vec3(0.2, 0.12, 0.1) * (0.8 + 0.2 * step(0.5, fract(q.z * 5.0 + floor(q.y * 6.0) * 0.5)));
  if (m < 3.5) return vec3(0.3, 0.2, 0.12);
  return vec3(0.45, 0.36, 0.18);
}

float archWin(vec2 uv, vec2 c, vec2 s) {
  vec2 d = (uv - c) / s;
  float body = step(abs(d.x), 1.0) * step(abs(d.y), 1.0);
  float top = step(length(vec2(d.x, (d.y - 1.0) * 1.0)), 1.0);
  return max(body, top);
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  if (m > 1.5) return vec3(0.0);
  vec3 q = toK(p);
  float e = 0.0;
  // Seitenfenster
  if (abs(abs(q.x) - 1.8) < 0.06) {
    e += archWin(vec2(q.z, q.y), vec2(-0.8, 1.7), vec2(0.28, 0.5));
    e += archWin(vec2(q.z, q.y), vec2(1.2, 1.7), vec2(0.28, 0.5));
    e += archWin(vec2(q.z, q.y), vec2(3.0, 1.7), vec2(0.28, 0.5));
  }
  // Tuer im Turm
  if (abs(q.z + 4.35) < 0.06) e += archWin(vec2(q.x, q.y), vec2(0.0, 0.7), vec2(0.38, 0.7)) * 0.7;
  // rundes Fenster im Turm
  if (abs(q.z + 4.35) < 0.06) e += step(length(vec2(q.x, q.y - 2.9)), 0.28);
  float candle = 0.8 + 0.2 * noise(vec2(uTime * 4.0, q.z * 2.0));
  return windowGlow(1.0) * e * candle * 0.9;
}

vec3 sceneLights(vec3 p, vec3 n) {
  return pointLight(p, n, fromK(vec3(0.0, 0.9, -5.0)), windowGlow(2.0) * 1.2);
}

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  col += pointGlow(ro, rd, t, fromK(vec3(0.0, 0.8, -4.4)), windowGlow(3.0), 1.1) * nightAmt * 0.8;
  col += pointGlow(ro, rd, t, fromK(vec3(0.0, 2.9, -4.4)), windowGlow(4.0), 0.6) * nightAmt * 0.6;
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(1.5, 1.7, 0.0);
  fw = normalize(vec3(-0.12, 0.1, 1.0));
}
`);
