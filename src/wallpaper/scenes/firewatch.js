// Szene "Feuerwachturm": Holzturm auf einem Waldhuegel, Blick ueber Huegelketten.
import { build } from './common.js';

export default build(`
#define TMAX 1400.0
#define TREE_DIST 220.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define LEAVES 0.25
#define WAVE_DIR vec2(0.0)

const vec3 TB = vec3(12.0, 22.0, 52.0); // Turmfuss

float groundH(vec2 p, int oct) {
  float h = 2.0 + fbm(p * 0.011 + 3.0, oct > 5 ? 6 : 4) * 30.0;
  h += fbm(p * 0.06, 3) * 1.5;
  // Tal zwischen Kamera und Turm
  h -= 12.0 * exp(-pow(p.y - 24.0, 2.0) / 120.0) * smoothstep(60.0, 10.0, abs(p.x));
  h = pad(h, p, vec2(0.0, -2.0), 8.0, 24.0);
  h = pad(h, p, TB.xz, 6.0, TB.y);
  h += farMountains(p, 350.0, 120.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float m = smoothstep(0.32, 0.5, fbm(p * 0.02 + 5.0, 3) + 0.22);
  m *= smoothstep(16.0, 24.0, length(p - vec2(0.0, -2.0)));
  m *= smoothstep(4.0, 7.0, length(p - TB.xz));
  return m * smoothstep(85.0, 60.0, g);
}

float sdRing(vec3 p, float w, float t, float h) {
  return max(sdBox(p, vec3(w, h, w)), -sdBox(p, vec3(w - t, h + 1.0, w - t)));
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = p - TB;
  float bound = length(q.xz) - 4.5;
  if (bound > 1.0 || q.y < -1.0 || q.y > 20.0) return max(max(bound, q.y - 19.0), max(-1.0 - q.y, 0.05));
  float best = 1e9;
  // Beine + Ringe
  float legs = 1e9;
  for (int i = 0; i < 4; i++) {
    vec2 s = vec2(i == 0 || i == 3 ? 1.0 : -1.0, i < 2 ? 1.0 : -1.0);
    legs = min(legs, sdCapsule(q, vec3(s.x * 2.6, -0.5, s.y * 2.6), vec3(s.x * 1.4, 15.0, s.y * 1.4), 0.12));
  }
  legs = min(legs, sdRing(q - vec3(0, 5.0, 0), 2.25, 0.12, 0.08));
  legs = min(legs, sdRing(q - vec3(0, 10.0, 0), 1.85, 0.12, 0.08));
  if (legs < best) { best = legs; m = 1.0; }
  // Plattform + Gelaender
  float deck = sdBox(q - vec3(0, 15.05, 0), vec3(2.2, 0.08, 2.2));
  deck = min(deck, sdRing(q - vec3(0, 15.6, 0), 2.2, 0.06, 0.04));
  if (deck < best) { best = deck; m = 1.0; }
  // Kabine
  float cab = sdBox(q - vec3(0, 16.35, 0), vec3(1.6, 1.25, 1.6));
  if (cab < best) { best = cab; m = 2.0; }
  // Dach
  float roof = sdPyramid(q - vec3(0, 17.55, 0), 2.1, 1.0);
  if (roof < best) { best = roof; m = 3.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  if (m < 1.5) return vec3(0.22, 0.14, 0.08);
  if (m < 2.5) return vec3(0.38, 0.32, 0.22) * (0.85 + 0.15 * sin((p.y - TB.y) * 30.0));
  return vec3(0.35, 0.12, 0.08);
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  if (m > 1.5 && m < 2.5) {
    vec3 q = p - TB;
    float band = step(15.85, q.y) * step(q.y, 16.95);
    float notCorner = step(abs(q.x), 1.35) + step(abs(q.z), 1.35);
    return windowGlow(1.0) * band * min(notCorner, 1.0) * (abs(n.y) < 0.5 ? 1.0 : 0.0);
  }
  return vec3(0.0);
}

vec3 sceneLights(vec3 p, vec3 n) {
  return pointLight(p, n, TB + vec3(0, 16.4, 0), windowGlow(2.0) * 2.0);
}

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  return col + pointGlow(ro, rd, t, TB + vec3(0, 16.4, 0), windowGlow(3.0), 3.0) * nightAmt * 0.6;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(0.0, 25.8, 0.0);
  fw = normalize(vec3(3.0, 1.0, 52.0));
}
`);
