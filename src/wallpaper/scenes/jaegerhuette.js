// Szene "Jägerhütte": Blockhütte im Wald, warmes Fensterlicht, Rauch aus dem Kamin.
import { build } from './common.js';

export default build(`
#define TMAX 900.0
#define TREE_DIST 170.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define LEAVES 0.6
#define BATS 0.4
#define WAVE_DIR vec2(0.0)

const vec3 H = vec3(2.0, 0.6, 14.0);
const float HROT = 0.35;

vec3 toHut(vec3 p) { vec3 q = p - H; q.xz = rot2(HROT) * q.xz; return q; }
vec3 fromHut(vec3 q) { q.xz = rot2(-HROT) * q.xz; return q + H; }

float groundH(vec2 p, int oct) {
  float h = fbm(p * 0.07, 3) * 1.2;
  h += smoothstep(10.0, 60.0, length(p - H.xz)) * fbm(p * 0.02 + 2.0, 4) * 20.0;
  h = pad(h, p, H.xz, 4.5, H.y);
  h += farMountains(p, 240.0, 90.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float m = smoothstep(6.0, 10.0, length(p - H.xz));
  m *= smoothstep(5.0, 11.0, length(p - vec2(0.0, 1.0)));
  m *= smoothstep(0.28, 0.45, fbm(p * 0.05 + 3.0, 3) + 0.22);
  return m * smoothstep(45.0, 30.0, g);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = toHut(p);
  if (length(q.xz) > 7.0 || q.y > 6.0) return max(length(q.xz) - 6.5, q.y - 5.5);
  float best = 1e9;
  // Blockwaende (leicht gerundete Stamm-Rillen)
  float body = sdBox(q - vec3(0, 1.35, 0), vec3(2.4, 1.35, 1.8)) - 0.03 * abs(sin(q.y * 11.0));
  if (body < best) { best = body; m = 1.0; }
  // ueberstehende Balkenenden an den Ecken
  vec3 c = vec3(abs(q.x) - 2.4, q.y, abs(q.z) - 1.8);
  float ends = sdBox(vec3(c.x, mod(q.y, 0.29) - 0.145, c.z), vec3(0.18, 0.12, 0.18));
  ends = max(ends, q.y - 2.7);
  if (ends < best) { best = ends; m = 1.0; }
  // Dach
  float roof = sdGable(q - vec3(0, 2.7, 0), 3.0, 1.7, 2.25);
  roof = max(roof, -sdGable(q - vec3(0, 2.52, 0), 2.75, 1.55, 3.0));
  if (roof < best) { best = roof; m = 2.0; }
  // Kamin
  float chim = sdBox(q - vec3(1.4, 4.1, 0.7), vec3(0.32, 1.0, 0.32));
  if (chim < best) { best = chim; m = 3.0; }
  // Veranda + Holzstapel
  float deck = sdBox(q - vec3(0, 0.1, -2.4), vec3(2.6, 0.1, 0.6));
  if (deck < best) { best = deck; m = 1.0; }
  vec3 w = q - vec3(-3.2, 0.0, -0.6);
  float pile = 1e9;
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
      if (j > 2 - i) continue;
      float y = 0.2 + float(i) * 0.36;
      float x = (float(j) - 0.5 * float(2 - i)) * 0.38;
      pile = min(pile, sdCapsule(w, vec3(-0.2, y, x - 0.9), vec3(0.2, y, x - 0.9), 0.17));
    }
  }
  if (pile < best) { best = pile; m = 4.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  vec3 q = toHut(p);
  if (m < 1.5) return vec3(0.27, 0.16, 0.09) * (0.75 + 0.25 * noise(vec2(q.x * 3.0 + q.z * 3.0, q.y * 11.0)));
  if (m < 2.5) return vec3(0.16, 0.13, 0.12) * (0.8 + 0.2 * step(0.5, fract(q.z * 4.0 + floor(q.y * 6.0) * 0.5)));
  if (m < 3.5) return vec3(0.33, 0.31, 0.3) * (0.8 + 0.3 * hash(floor(q.xy * 6.0)));
  return vec3(0.35, 0.22, 0.12);
}

float windowMask(vec3 q) {
  // Vorderseite (z = -1.8): zwei Fenster + Tuer
  float front = step(abs(q.z + 1.8), 0.06);
  float win = step(abs(abs(q.x) - 1.4), 0.38) * step(abs(q.y - 1.55), 0.32);
  float door = step(abs(q.x), 0.42) * step(q.y, 1.85) * 0.18;
  // Seitenfenster
  float side = step(abs(abs(q.x) - 2.4), 0.06) * step(abs(q.z), 0.4) * step(abs(q.y - 1.55), 0.3);
  return front * (win + door) + side;
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  if (m < 1.5) {
    vec3 q = toHut(p);
    float cross = step(0.04, abs(abs(q.x) - 1.4)) * step(0.04, abs(q.y - 1.55));
    return windowGlow(1.0) * windowMask(q) * mix(0.6, 1.0, cross);
  }
  return vec3(0.0);
}

vec3 sceneLights(vec3 p, vec3 n) {
  vec3 l = vec3(0.0);
  l += pointLight(p, n, fromHut(vec3(-1.4, 1.5, -2.4)), windowGlow(2.0) * 0.8);
  l += pointLight(p, n, fromHut(vec3(1.4, 1.5, -2.4)), windowGlow(3.0) * 0.8);
  return l;
}

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  col += pointGlow(ro, rd, t, fromHut(vec3(-1.4, 1.55, -1.9)), windowGlow(4.0), 0.9) * nightAmt * 0.7;
  col += pointGlow(ro, rd, t, fromHut(vec3(1.4, 1.55, -1.9)), windowGlow(5.0), 0.9) * nightAmt * 0.7;
  // Kaminrauch
  col = smokeColumn(ro, rd, t, col, fromHut(vec3(1.4, 5.1, 0.7)), 1.1, 0.2);
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(-1.0, 1.7, 0.0);
  fw = normalize(vec3(0.15, 0.06, 1.0));
}
`);
