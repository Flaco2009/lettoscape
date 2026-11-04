// Szene "Camping-Platz": Lichtung im Wald, Zelt, Lagerfeuer mit Funken, Sternenhimmel.
import { build } from './common.js';

export default build(`
#define TMAX 900.0
#define TREE_DIST 160.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define LEAVES 0.4
#define BUTTERFLIES 0.6
#define WAVE_DIR vec2(0.0)

const vec3 FIRE = vec3(0.6, 0.0, 7.5);
const vec3 TENT = vec3(-3.6, 0.0, 10.5);

float groundH(vec2 p, int oct) {
  float d = length(p - vec2(0.0, 9.0));
  float h = fbm(p * 0.12, 3) * 0.35;
  h += smoothstep(18.0, 70.0, d) * fbm(p * 0.02 + 4.0, 4) * 18.0;
  h += farMountains(p, 220.0, 90.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float d = length((p - vec2(0.0, 9.0)) * vec2(1.0, 0.8));
  float m = smoothstep(12.0, 17.0, d);
  m *= smoothstep(0.25, 0.45, fbm(p * 0.05 + 2.0, 3) + 0.2);
  return m * smoothstep(40.0, 25.0, g);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  float best = 1e9;
  // Lagerfeuer-Bereich
  vec3 f = p - FIRE;
  if (length(f) < 3.0) {
    // Holzscheite (Pyramide aus 4 Stuecken)
    float logs = 1e9;
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 1.5708 + 0.3;
      vec3 dir = vec3(cos(a), 0.0, sin(a));
      logs = min(logs, sdCapsule(f, dir * 0.55 + vec3(0, 0.06, 0), vec3(0, 0.5, 0), 0.07));
    }
    if (logs < best) { best = logs; m = 1.0; }
    // Steinring
    float a = atan(f.z, f.x);
    float stones = sdTorus(f - vec3(0, 0.05, 0), vec2(0.8, 0.13 + 0.04 * sin(a * 9.0)));
    if (stones < best) { best = stones; m = 2.0; }
    // Flammen
    float fl = fireFlicker(1.0);
    vec3 q = f - vec3(0, 0.45, 0);
    q.x += 0.06 * sin(uTime * 6.0 + q.y * 9.0);
    q.z += 0.05 * cos(uTime * 5.0 + q.y * 7.0);
    float flame = sdCappedCone(q, 0.38 * fl, 0.28, 0.0);
    if (flame < best) { best = flame; m = 3.0; }
  } else {
    best = length(f) - 2.5;
  }
  // Zelt
  vec3 t = p - TENT;
  t.xz = rot2(0.5) * t.xz;
  float tent = sdGable(t, 1.3, 1.5, 1.3);
  // Eingang aushoehlen
  tent = max(tent, -sdGable(t - vec3(0, 0, 1.0), 0.6, 1.0, 0.5));
  if (tent < best) { best = tent; m = 4.0; }
  // Sitzbaumstamm
  float seat = sdCapsule(p, vec3(2.2, 0.22, 6.2), vec3(3.0, 0.22, 8.4), 0.22);
  if (seat < best) { best = seat; m = 1.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  if (m < 1.5) return vec3(0.18, 0.11, 0.06) * (0.7 + 0.3 * noise(p.xy * 20.0));
  if (m < 2.5) return vec3(0.25, 0.24, 0.23) * (0.7 + 0.4 * noise(p.xz * 12.0));
  if (m < 3.5) return vec3(0.0);
  return mix(vec3(0.55, 0.32, 0.16), vec3(0.62, 0.4, 0.2), noise(p.xy * 3.0));
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  if (m > 2.5 && m < 3.5) {
    float h = clamp((p.y - FIRE.y - 0.07) / 0.8, 0.0, 1.0);
    return mix(vec3(4.0, 2.2, 0.6), vec3(2.5, 0.5, 0.05), h) * fireFlicker(2.0);
  }
  // Glut in den Scheiten
  if (m < 1.5 && length(p - FIRE) < 0.6) return vec3(1.2, 0.3, 0.05) * fireFlicker(3.0) * (0.6 + 0.4 * noise(p.xz * 30.0));
  // warmes Licht im Zelt
  if (m > 3.5) {
    vec3 t = p - TENT;
    return vec3(0.9, 0.55, 0.25) * 0.12 * (0.2 + nightAmt) * smoothstep(1.2, 0.2, t.y);
  }
  return vec3(0.0);
}

vec3 sceneLights(vec3 p, vec3 n) {
  vec3 fc = vec3(1.0, 0.5, 0.18) * 5.0 * fireFlicker(4.0) * (0.25 + 0.75 * (1.0 - dayAmt));
  return pointLight(p, n, FIRE + vec3(0, 0.6, 0), fc);
}

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  float fl = fireFlicker(5.0);
  col += pointGlow(ro, rd, t, FIRE + vec3(0, 0.5, 0), vec3(1.0, 0.45, 0.12) * fl, 1.3) * (0.5 + nightAmt);
  col = smokeColumn(ro, rd, t, col, FIRE + vec3(0.0, 1.0, 0.0), 0.6, 0.2);
  // Funken
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float life = fract(uTime * (0.25 + hash1(fi) * 0.2) + hash1(fi + 9.0));
    vec3 sp = FIRE + vec3(sin(fi * 2.1 + uTime) * 0.3 * life, 0.5 + life * 3.2, cos(fi * 1.3 + uTime * 0.7) * 0.3 * life);
    col += pointGlow(ro, rd, t, sp, vec3(1.0, 0.55, 0.15) * (1.0 - life), 0.06);
  }
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(0.0, 1.55, 0.0);
  fw = normalize(vec3(0.0, -0.04, 1.0));
}
`);
