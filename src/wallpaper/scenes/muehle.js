// Szene "Alte Mühle am Bach": Wassermuehle mit drehendem Rad, Bach, Laterne.
import { build } from './common.js';

export default build(`
#define TMAX 800.0
#define TREE_DIST 170.0
#define HAS_WATER 1
#define WAVE_AMP 0.06
#define WAVE_DIR vec2(0.0, -1.6)

const vec3 M = vec3(7.4, 1.0, 17.0);   // Muehlenhaus
const vec3 WC = vec3(5.05, 1.25, 17.0); // Radmitte

float creekX(float z) { return 2.6 * sin(z * 0.075) + 0.9; }

float groundH(vec2 p, int oct) {
  float base = 1.0 + fbm(p * 0.09, 3) * 0.7;
  base += smoothstep(12.0, 60.0, abs(p.x - creekX(p.y))) * fbm(p * 0.02 + 6.0, 4) * 16.0;
  float dc = abs(p.x - creekX(p.y));
  float h = base - 2.1 * smoothstep(3.4, 1.6, dc + (noise(p * 0.5) - 0.5) * 0.6);
  h = pad(h, p, M.xz, 3.0, M.y);
  h += farMountains(p, 240.0, 80.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float m = smoothstep(5.0, 9.0, abs(p.x - creekX(p.y)));
  m *= smoothstep(5.0, 9.0, length(p - M.xz));
  m *= smoothstep(4.0, 9.0, length(p));
  m *= smoothstep(0.3, 0.48, fbm(p * 0.05 + 8.0, 3) + 0.22);
  return m * smoothstep(40.0, 26.0, g);
}

float sdWheel(vec3 p) {
  vec3 w = p - WC;
  vec2 yz = rot2(uTime * 0.55) * w.yz;
  float r = length(yz);
  float slab = abs(w.x) - 0.16;
  float rim = max(abs(r - 1.62) - 0.07, slab);
  rim = min(rim, max(abs(r - 1.15) - 0.05, slab));
  float a = atan(yz.y, yz.x);
  float sec = 6.2832 / 12.0;
  float ra = (floor(a / sec + 0.5)) * sec;
  vec2 k = rot2(ra) * yz;
  float paddle = sdBox(vec3(w.x, k.x - 1.45, k.y), vec3(0.2, 0.32, 0.04));
  float spoke = sdBox(vec3(w.x, k.x - 0.7, k.y), vec3(0.05, 0.7, 0.04));
  float hub = sdCyl(w.yxz, 0.18, 0.3);
  return min(min(rim, paddle), min(spoke, hub));
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = p - M;
  if (length(q.xz) > 7.0) return length(q.xz) - 6.5;
  float best = 1e9;
  float stone = sdBox(q - vec3(0, 1.1, 0), vec3(1.8, 1.25, 2.4));
  if (stone < best) { best = stone; m = 1.0; }
  float timber = sdBox(q - vec3(0, 3.2, 0), vec3(1.85, 0.9, 2.45));
  if (timber < best) { best = timber; m = 2.0; }
  float roof = sdGable(q - vec3(0, 4.1, 0), 2.15, 1.9, 2.8);
  if (roof < best) { best = roof; m = 3.0; }
  float wheel = sdWheel(p);
  if (wheel < best) { best = wheel; m = 4.0; }
  // Laternenpfahl
  float post = sdBox(q - vec3(-1.6, 1.2, -3.2), vec3(0.06, 1.2, 0.06));
  if (post < best) { best = post; m = 4.0; }
  float lamp = sdBox(q - vec3(-1.6, 2.55, -3.2), vec3(0.14, 0.17, 0.14));
  if (lamp < best) { best = lamp; m = 5.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  vec3 q = p - M;
  if (m < 1.5) {
    vec2 b = vec2(q.z + q.x, q.y) * vec2(2.2, 3.5);
    b.x += floor(b.y) * 0.5;
    float j = smoothstep(0.05, 0.12, min(fract(b.x), fract(b.y)));
    vec3 s = mix(vec3(0.33, 0.31, 0.28), vec3(0.45, 0.42, 0.36), hash(floor(b))) * (0.7 + 0.3 * j);
    return mix(s, vec3(0.1, 0.17, 0.07), smoothstep(0.6, 0.0, q.y) * 0.7);
  }
  if (m < 2.5) {
    // Fachwerk
    float beam = max(step(abs(fract(q.z * 0.8) - 0.5), 0.06), step(abs(q.y - 3.2), 0.07));
    return mix(vec3(0.72, 0.66, 0.55), vec3(0.2, 0.12, 0.07), beam);
  }
  if (m < 3.5) return vec3(0.3, 0.14, 0.1) * (0.8 + 0.2 * step(0.5, fract(q.x * 5.0 + floor(q.y * 5.0) * 0.5)));
  if (m < 4.5) return vec3(0.24, 0.15, 0.09);
  return vec3(0.1);
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  vec3 q = p - M;
  if (m > 1.5 && m < 2.5) {
    float front = step(abs(q.z + 2.45), 0.06) * step(abs(abs(q.x) - 0.9), 0.32) * step(abs(q.y - 3.3), 0.35);
    float side = step(abs(q.x + 1.85), 0.06) * step(abs(abs(q.z) - 1.2), 0.32) * step(abs(q.y - 3.3), 0.35);
    return windowGlow(1.0) * (front + side);
  }
  if (m > 4.5) return windowGlow(2.0) * 1.6;
  return vec3(0.0);
}

vec3 sceneLights(vec3 p, vec3 n) {
  return pointLight(p, n, M + vec3(-1.6, 2.55, -3.4), windowGlow(3.0) * 1.4);
}

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  col += pointGlow(ro, rd, t, M + vec3(-1.6, 2.55, -3.2), windowGlow(4.0), 0.7) * (0.3 + nightAmt);
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(-1.5, 2.6, 2.0);
  fw = normalize(vec3(0.3, -0.06, 1.0));
}
`);
