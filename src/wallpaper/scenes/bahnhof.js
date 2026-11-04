// Szene "Verlassener Bahnhof": Gleise in den Wald, alter Bahnsteig, Haeuschen, Laternen.
import { build } from './common.js';

export default build(`
#define TMAX 900.0
#define TREE_DIST 180.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define WAVE_DIR vec2(0.0)

const vec3 ST = vec3(5.2, 0.9, 20.0);  // Stationshaus (Boden = Bahnsteig)
const vec3 L1 = vec3(2.7, 3.15, 12.0);
const vec3 L2 = vec3(2.7, 3.15, 30.0);

float groundH(vec2 p, int oct) {
  float ax = abs(p.x);
  float h = fbm(p * 0.1, 3) * 0.4 * smoothstep(1.5, 4.0, ax);
  h += smoothstep(14.0, 50.0, ax) * fbm(p * 0.02 + 1.0, 4) * 18.0;
  h += farMountains(p, 260.0, 90.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float m = p.x < 0.0 ? smoothstep(4.5, 8.0, -p.x) : smoothstep(9.0, 12.0, p.x);
  // weiter hinten waechst der Wald naeher an die Gleise
  m = max(m, smoothstep(70.0, 110.0, p.y) * smoothstep(2.6, 4.0, abs(p.x)));
  m *= smoothstep(0.28, 0.45, fbm(p * 0.05 + 4.0, 3) + 0.25);
  return m * smoothstep(45.0, 28.0, g);
}

float sdLamp(vec3 p, vec3 L, out float glass) {
  float post = sdBox(p - vec3(L.x, L.y * 0.5, L.z), vec3(0.05, L.y * 0.5, 0.05));
  float arm = sdBox(p - vec3(L.x - 0.2, L.y - 0.05, L.z), vec3(0.22, 0.03, 0.03));
  glass = sdBox(p - vec3(L.x - 0.38, L.y - 0.3, L.z), vec3(0.11, 0.16, 0.11));
  return min(post, arm);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  float best = 1e9;
  // Schienen
  vec2 rq = vec2(abs(p.x) - 0.72, p.y - 0.22);
  vec2 rd2 = abs(rq) - vec2(0.035, 0.06);
  float rail = length(max(rd2, 0.0)) + min(max(rd2.x, rd2.y), 0.0);
  rail = max(rail, -10.0 - p.z);
  if (rail < best) { best = rail; m = 1.0; }
  // Schwellen
  vec3 sq = vec3(p.x, p.y - 0.1, mod(p.z, 0.75) - 0.375);
  float sleeper = max(sdBox(sq, vec3(1.25, 0.06, 0.11)), -10.0 - p.z);
  if (sleeper < best) { best = sleeper; m = 2.0; }
  // Bahnsteig
  float plat = sdBox(p - vec3(4.6, 0.45, 23.0), vec3(2.4, 0.45, 17.0));
  if (plat < best) { best = plat; m = 3.0; }
  // Stationshaus
  vec3 q = p - ST;
  if (length(q.xz) < 8.0) {
    float house = sdBox(q - vec3(0, 1.6, 0), vec3(1.4, 1.6, 4.0));
    if (house < best) { best = house; m = 4.0; }
    float roof = sdGable(q - vec3(0, 3.2, 0), 1.9, 1.2, 4.4);
    if (roof < best) { best = roof; m = 5.0; }
    float canopy = sdBox(q - vec3(-2.4, 2.75, 0), vec3(1.0, 0.05, 3.6));
    canopy = min(canopy, sdBox(vec3(q.x + 3.2, q.y - 1.35, abs(q.z) - 3.2), vec3(0.05, 1.4, 0.05)));
    if (canopy < best) { best = canopy; m = 1.0; }
    // Schild
    float sign = sdBox(q - vec3(-1.45, 2.35, 0), vec3(0.04, 0.25, 1.1));
    if (sign < best) { best = sign; m = 6.0; }
  } else {
    best = min(best, length(q.xz) - 7.5);
  }
  // Laternen
  float g1, g2;
  float lamps = min(sdLamp(p, L1, g1), sdLamp(p, L2, g2));
  if (lamps < best) { best = lamps; m = 1.0; }
  float gl = min(g1, g2);
  if (gl < best) { best = gl; m = 7.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  if (m < 1.5) return mix(vec3(0.28, 0.14, 0.07), vec3(0.35, 0.33, 0.32), step(0.6, n.y) * step(p.y, 0.3) * 0.6);
  if (m < 2.5) return vec3(0.2, 0.14, 0.09) * (0.7 + 0.3 * hash(vec2(floor(p.z / 0.75), 1.0)));
  if (m < 3.5) {
    float tile = step(0.03, min(fract(p.x * 1.6), fract(p.z * 1.6)));
    vec3 c = mix(vec3(0.3, 0.3, 0.3), vec3(0.4, 0.38, 0.35), hash(floor(p.xz * 1.6))) * (0.8 + 0.2 * tile);
    float moss = smoothstep(0.5, 0.75, fbm(p.xz * 0.8, 4));
    return mix(c, vec3(0.12, 0.2, 0.07), moss);
  }
  if (m < 4.5) {
    vec3 q = p - ST;
    float grime = fbm(vec2(q.z, q.y) * 1.5, 4);
    return mix(vec3(0.62, 0.52, 0.4), vec3(0.34, 0.3, 0.24), grime * smoothstep(2.5, 0.0, q.y));
  }
  if (m < 5.5) return vec3(0.22, 0.12, 0.1);
  if (m < 6.5) return vec3(0.1, 0.18, 0.14);
  return vec3(0.1);
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  if (m > 6.5) {
    // zweite Laterne flackert (kaputt)
    float broken = p.z > 20.0 ? step(0.35, noise(vec2(uTime * 3.0, 4.0))) : 1.0;
    return windowGlow(1.0) * 1.8 * broken;
  }
  if (m > 3.5 && m < 4.5) {
    vec3 q = p - ST;
    float win = step(abs(q.x + 1.4), 0.06) * step(abs(abs(q.z) - 1.8), 0.45) * step(abs(q.y - 1.7), 0.5);
    return windowGlow(2.0) * win * 0.8;
  }
  return vec3(0.0);
}

vec3 sceneLights(vec3 p, vec3 n) {
  float broken = step(0.35, noise(vec2(uTime * 3.0, 4.0)));
  vec3 l = pointLight(p, n, L1 - vec3(0.38, 0.4, 0.0), windowGlow(3.0) * 2.2);
  l += pointLight(p, n, L2 - vec3(0.38, 0.4, 0.0), windowGlow(4.0) * 2.2 * broken);
  return l;
}

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  float broken = step(0.35, noise(vec2(uTime * 3.0, 4.0)));
  col += pointGlow(ro, rd, t, L1 - vec3(0.38, 0.3, 0.0), windowGlow(5.0), 1.0) * (0.25 + nightAmt);
  col += pointGlow(ro, rd, t, L2 - vec3(0.38, 0.3, 0.0), windowGlow(6.0), 1.0) * (0.25 + nightAmt) * broken;
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(0.9, 1.75, 0.0);
  fw = normalize(vec3(0.03, -0.03, 1.0));
}
`);
