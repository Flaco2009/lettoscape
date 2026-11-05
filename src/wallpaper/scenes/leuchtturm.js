// Szene "Leuchtturm an der Waldküste": Klippe mit Leuchtturm, drehender Lichtkegel, Meer.
import { build } from './common.js';

export default build(`
#define TMAX 1400.0
#define TREE_DIST 200.0
#define HAS_WATER 1
#define WAVE_AMP 0.09
#define LEAVES 0.0
#define FISH 0.6
#define WAVE_DIR vec2(0.35, -1.0)

const vec3 LH = vec3(24.0, 13.0, 58.0);
const vec3 LAMP = vec3(24.0, 22.85, 58.0);

float headland(vec2 p) {
  return smoothstep(2.0, 12.0, p.x - 20.0 + fbm(p * 0.04, 4) * 14.0 - max(p.y - 160.0, 0.0) * 0.3 - max(40.0 - p.y, 0.0) * 0.6);
}

float groundH(vec2 p, int oct) {
  float hm = headland(p);
  float h = -4.0 + hm * (13.0 + fbm(p * 0.03, 5) * 7.0);
  // Felsen im Vordergrund (Standplatz)
  float rocks = smoothstep(6.0, 1.5, length((p - vec2(-1.0, -1.0)) * vec2(0.7, 1.0)));
  h = max(h, -4.0 + rocks * (5.6 + fbm(p * 0.6, 4) * 1.2));
  h = pad(h, p, LH.xz, 5.0, LH.y);
  h += farMountains(p, 400.0, 110.0) * smoothstep(0.0, 1.0, hm + smoothstep(300.0, 500.0, p.y));
  return h;
}

float forestMask(vec2 p, float g) {
  float m = smoothstep(4.0, 8.0, g) * smoothstep(8.0, 13.0, length(p - LH.xz));
  m *= smoothstep(0.3, 0.48, fbm(p * 0.04 + 2.0, 3) + 0.22);
  return m * smoothstep(40.0, 26.0, g);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = p - LH;
  if (length(q.xz) > 8.0 || q.y > 12.0) return max(length(q.xz) - 7.5, q.y - 11.6);
  float best = 1e9;
  float tower = sdCappedCone(q - vec3(0, 4.5, 0), 4.6, 1.6, 1.05);
  if (tower < best) { best = tower; m = 1.0; }
  float gallery = sdCyl(q - vec3(0, 9.12, 0), 1.45, 0.09);
  gallery = min(gallery, max(abs(length(q.xz) - 1.42) - 0.03, abs(q.y - 9.45) - 0.3));
  if (gallery < best) { best = gallery; m = 2.0; }
  float lantern = sdCyl(q - vec3(0, 9.85, 0), 0.78, 0.62);
  if (lantern < best) { best = lantern; m = 3.0; }
  float cap = sdCappedCone(q - vec3(0, 10.75, 0), 0.32, 0.95, 0.12);
  cap = min(cap, sdSphere(q - vec3(0, 11.15, 0), 0.14));
  if (cap < best) { best = cap; m = 2.0; }
  // Waerterhaus
  vec3 h = q - vec3(3.6, 0.0, -0.5);
  float house = sdBox(h - vec3(0, 1.1, 0), vec3(1.3, 1.1, 1.8));
  if (house < best) { best = house; m = 4.0; }
  float roof = sdGable(h - vec3(0, 2.2, 0), 1.6, 1.1, 2.0);
  if (roof < best) { best = roof; m = 5.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  vec3 q = p - LH;
  if (m < 1.5) {
    float band = step(0.5, fract(q.y / 3.0));
    return mix(vec3(0.85, 0.83, 0.78), vec3(0.62, 0.1, 0.08), band);
  }
  if (m < 2.5) return vec3(0.08, 0.08, 0.09);
  if (m < 3.5) return vec3(0.05);
  if (m < 4.5) return vec3(0.82, 0.8, 0.74);
  return vec3(0.3, 0.12, 0.1);
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  if (m > 2.5 && m < 3.5) return vec3(3.0, 2.4, 1.4) * (0.6 + 1.2 * nightAmt + 0.6 * duskAmt);
  if (m > 3.5 && m < 4.5) {
    vec3 h = p - LH - vec3(3.6, 0.0, -0.5);
    float win = step(abs(h.x + 1.3), 0.06) * step(abs(abs(h.z) - 0.8), 0.3) * step(abs(h.y - 1.2), 0.35);
    return windowGlow(1.0) * win;
  }
  return vec3(0.0);
}

vec3 sceneLights(vec3 p, vec3 n) { return pointLight(p, n, LAMP, vec3(1.0, 0.85, 0.55) * 4.0 * (0.3 + nightAmt)); }

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  float vis = 0.25 + nightAmt + duskAmt * 0.4;
  col += pointGlow(ro, rd, t, LAMP, vec3(1.0, 0.85, 0.55), 2.2) * vis;
  // drehender Lichtkegel (zwei Seiten)
  float a = uTime * 0.55;
  vec3 b = normalize(vec3(cos(a), -0.015, sin(a)));
  float tm = min(t, 420.0);
  int nSt = uQuality > 0.5 ? 20 : 10;
  float dt = tm / float(nSt);
  float dens = 0.0;
  for (int i = ZERO; i < nSt; i++) {
    vec3 x = ro + rd * (dt * (float(i) + hash(gl_FragCoord.xy + float(i) + fract(uTime * 7.31) * 97.0)));
    vec3 v = x - LAMP;
    float al = dot(v, b);
    vec3 bb = al > 0.0 ? b : -b;
    al = abs(al);
    float perp = length(v - bb * al);
    float w = 0.35 + al * 0.07;
    dens += exp(-perp * perp / (w * w)) * exp(-al * 0.01) * dt;
  }
  col += vec3(1.0, 0.88, 0.6) * dens * 0.012 * vis * (0.6 + uFog + overcast);
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(0.0, 3.4, 0.0);
  fw = normalize(vec3(0.27, 0.1, 1.0));
}
`);
