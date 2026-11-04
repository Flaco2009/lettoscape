// Szene "Waldlichtung": alte Eiche auf einer Wiese, Wald ringsum, Lichtstrahlen.
import { build } from './common.js';

export default build(`
#define TMAX 800.0
#define TREE_DIST 160.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define LEAVES 0.9
#define BUTTERFLIES 1.0
#define FLOWERS 1.0
#define WAVE_DIR vec2(0.0)

const vec3 OAK = vec3(3.0, 0.0, 26.0);
const vec3 DEER = vec3(-6.5, 0.0, 22.0);

float groundH(vec2 p, int oct);

// Reh aus Kapseln; grast und hebt ab und zu den Kopf
float sdDeer(vec3 p) {
  vec3 q = p - DEER;
  q.y -= groundH(DEER.xz, 3);
  q.xz = rot2(-0.4) * q.xz;
  if (length(q) > 3.0) return length(q) - 2.5;
  float graze = smoothstep(0.2, 0.8, sin(uTime * 0.35) * 0.5 + 0.5 + 0.15 * sin(uTime * 1.7));
  float body = sdCapsule(q, vec3(-0.45, 1.0, 0.0), vec3(0.45, 1.05, 0.0), 0.26);
  vec3 neckTop = mix(vec3(0.95, 1.65, 0.0), vec3(1.05, 0.55, 0.0), graze);
  float neck = sdCapsule(q, vec3(0.5, 1.15, 0.0), neckTop, 0.1);
  vec3 headDir = mix(vec3(0.3, 0.05, 0.0), vec3(0.12, -0.25, 0.0), graze);
  float head = sdCapsule(q, neckTop, neckTop + headDir, 0.085);
  // Ohre zucken
  float twitch = 0.04 * smoothstep(0.92, 1.0, sin(uTime * 3.1));
  float ears = min(sdCapsule(q, neckTop + vec3(0, 0.05, 0.06), neckTop + vec3(-0.05, 0.22 + twitch, 0.12), 0.025),
                   sdCapsule(q, neckTop + vec3(0, 0.05, -0.06), neckTop + vec3(-0.05, 0.22, -0.12), 0.025));
  float legs = 1e9;
  for (int i = 0; i < 4; i++) {
    float lx = i < 2 ? 0.38 : -0.38;
    float lz = (i == 0 || i == 2) ? 0.1 : -0.1;
    legs = min(legs, sdCapsule(q, vec3(lx, 0.95, lz), vec3(lx + 0.02, 0.02, lz), 0.045));
  }
  float tail = sdCapsule(q, vec3(-0.68, 1.12, 0.0), vec3(-0.75, 1.0, 0.0), 0.05);
  return min(min(smin(body, neck, 0.1), min(head, ears)), min(legs, tail));
}

float groundH(vec2 p, int oct) {
  float d = length(p - vec2(0.0, 15.0));
  float h = fbm(p * 0.08, 3) * 0.8;
  h += smoothstep(20.0, 60.0, d) * fbm(p * 0.025 + 7.0, 4) * 14.0;
  h += farMountains(p, 200.0, 70.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float d = length((p - vec2(0.0, 20.0)) * vec2(0.85, 1.0));
  float m = smoothstep(24.0, 30.0, d + fbm(p * 0.1, 2) * 6.0);
  return m * smoothstep(40.0, 25.0, g);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = p - OAK;
  float best = 1e9;
  if (length(q.xz) < 10.0 && q.y < 13.0) {
    // Stamm + Aeste
    float trunk = sdCappedCone(q - vec3(0, 2.4, 0), 2.4, 0.7, 0.38);
    trunk = min(trunk, sdCapsule(q, vec3(0, 4.2, 0), vec3(-2.6, 6.8, 0.4), 0.22));
    trunk = min(trunk, sdCapsule(q, vec3(0, 4.5, 0), vec3(2.4, 7.0, -0.6), 0.22));
    trunk = min(trunk, sdCapsule(q, vec3(0, 4.8, 0), vec3(0.3, 8.0, 1.8), 0.2));
    if (trunk < best) { best = trunk; m = 1.0; }
    // Krone aus mehreren Blaettermassen
    float crown = 1e9;
    crown = smin(crown, sdSphere(q - vec3(0.0, 8.2, 0.0), 3.4), 1.5);
    crown = smin(crown, sdSphere(q - vec3(-3.0, 7.0, 0.5), 2.5), 1.5);
    crown = smin(crown, sdSphere(q - vec3(2.9, 7.3, -0.6), 2.6), 1.5);
    crown = smin(crown, sdSphere(q - vec3(0.4, 9.6, 1.6), 2.2), 1.5);
    crown += (fbm(q.xz * 1.1 + q.y * 0.7, 4) - 0.5) * 1.2;
    if (crown < best) { best = crown * 0.7; m = 2.0; }
  } else {
    best = max(length(q.xz) - 9.5, q.y - 13.0);
  }
  float deer = sdDeer(p);
  if (deer < best) { best = deer; m = 4.0; }
  // Felsen
  float rocks = sdSphere((p - vec3(-4.5, -0.3, 11.0)) * vec3(1.0, 1.6, 1.0), 1.1) / 1.6;
  rocks = min(rocks, sdSphere((p - vec3(-3.3, -0.2, 10.3)) * vec3(1.0, 1.5, 1.0), 0.6) / 1.5);
  rocks += noise(p.xz * 4.0 + p.y) * 0.06;
  if (rocks < best) { best = rocks; m = 3.0; }
  return best;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  if (m < 1.5) return vec3(0.17, 0.12, 0.08) * (0.7 + 0.3 * noise(vec2(p.y * 8.0, atan(p.z - OAK.z, p.x - OAK.x) * 6.0)));
  if (m < 2.5) {
    float v = fbm(p.xz * 2.0 + p.y, 3);
    vec3 leaf = mix(vec3(0.07, 0.15, 0.04), vec3(0.22, 0.3, 0.08), v);
    // im Herbst etwas golden
    return mix(leaf, vec3(0.42, 0.28, 0.06), smoothstep(0.62, 0.8, v) * 0.6);
  }
  if (m > 3.5) return mix(vec3(0.42, 0.26, 0.14), vec3(0.75, 0.68, 0.58), smoothstep(0.75, 0.95, p.y - groundH(DEER.xz, 3)) * 0.0 + smoothstep(-0.2, -0.7, n.y) * 0.6);
  return mix(vec3(0.3, 0.3, 0.29), vec3(0.15, 0.22, 0.1), smoothstep(0.4, 0.8, n.y) * 0.7);
}

vec3 objEmit(float m, vec3 p, vec3 n) { return vec3(0.0); }
vec3 sceneLights(vec3 p, vec3 n) { return vec3(0.0); }

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  // Lichtstrahlen durch die Baumkronen
  float s = max(dot(rd, sunDir), 0.0);
  float rays = noise(vec2(atan(rd.x - sunDir.x, rd.y - sunDir.y) * 18.0 + uTime * 0.05, 0.0));
  rays = smoothstep(0.35, 0.9, rays);
  col += vec3(1.0, 0.86, 0.6) * pow(s, 5.0) * rays * 0.35 * dayAmt * (1.0 - overcast) * smoothstep(0.0, 0.15, sunDir.y);
  return col;
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(-1.0, 1.65, 0.0);
  fw = normalize(vec3(0.08, 0.1, 1.0));
}
`);
