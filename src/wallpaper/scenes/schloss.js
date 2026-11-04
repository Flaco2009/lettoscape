// Szene "Verlassenes Schloss": Burgruine auf einem Huegel, Mondlicht, ein letztes Laternenlicht.
import { build } from './common.js';

export default build(`
#define TMAX 1200.0
#define TREE_DIST 200.0
#define HAS_WATER 0
#define WAVE_AMP 0.03
#define BATS 1.0
#define LEAVES 0.3
#define WAVE_DIR vec2(0.0)

const vec3 C = vec3(0.0, 15.0, 58.0);

float groundH(vec2 p, int oct) {
  vec2 d = p - C.xz;
  float h = fbm(p * 0.03, 4) * 5.0 - 1.0;
  h += 17.0 * exp(-dot(d, d) / 1100.0);
  h = pad(h, p, C.xz, 13.0, C.y);
  h += farMountains(p, 280.0, 100.0);
  return h;
}

float forestMask(vec2 p, float g) {
  float m = smoothstep(14.0, 22.0, length(p - C.xz));
  m *= p.y < 46.0 ? smoothstep(9.0, 17.0, abs(p.x)) : 1.0;
  m *= smoothstep(0.3, 0.5, fbm(p * 0.03 + 1.0, 3) + 0.22);
  return m * smoothstep(60.0, 40.0, g);
}

float sdObj(vec3 p, out float m) {
  m = 0.0;
  vec3 q = p - C;
  float bound = max(length(q.xz - vec2(-3.0, 0.0)) - 14.0, q.y - 21.0);
  if (bound > 1.0) return bound;
  // Bergfried mit Zinnen
  float r = length(q.xz);
  float a = atan(q.z, q.x);
  float merl = step(0.5, fract(a * 1.9099));
  float keep = max(r - 3.2, max(-q.y - 1.0, q.y - (16.0 + 0.8 * merl)));
  keep = max(keep, -max(r - 2.6, 15.5 - q.y));
  // Schiessscharten
  vec3 k = q;
  float sa = floor(a / (PI / 3.0) + 0.5) * (PI / 3.0);
  k.xz = rot2(sa) * k.xz;
  float slit = sdBox(vec3(k.x - 3.2, mod(k.y, 4.5) - 2.6, k.z), vec3(0.6, 0.5, 0.12));
  keep = max(keep, -slit);
  // Mauer mit Tor, oben zerfallen
  float wall = sdBox(q - vec3(-5.5, 2.5, 0.0), vec3(4.8, 3.5, 0.45));
  wall = max(wall, q.y - (4.0 + 1.6 * noise(vec2(q.x * 0.9, 1.0)) - 0.8 * smoothstep(-6.0, -9.5, q.x)));
  wall = max(wall, -sdBox(q - vec3(-4.0, 1.2, 0.0), vec3(0.8, 1.6, 1.0)));
  wall = max(wall, -sdCyl((q - vec3(-4.0, 2.8, 0.0)).xzy, 0.8, 1.0));
  // Kleiner, eingestuerzter Turm
  vec3 t = q - vec3(-10.8, 0.0, 0.6);
  float tower = max(length(t.xz) - 2.1, max(-t.y - 1.0, t.y - (6.0 + 2.2 * sin(t.x * 1.3 + t.z * 0.7) + 1.5 * noise(t.xz * 2.0))));
  tower = max(tower, -max(length(t.xz) - 1.6, 1.0 - t.y));
  // Herabgefallene Steine
  float rubble = sdSphere(q - vec3(-7.5, -0.3, 2.2), 0.7);
  rubble = min(rubble, sdSphere(q - vec3(-8.6, -0.4, 1.4), 0.5));
  rubble = min(rubble, sdBox(q - vec3(-2.0, 0.1, 2.6), vec3(0.5, 0.35, 0.4)));
  float d = min(min(keep, wall), min(tower, rubble));
  m = 1.0;
  // Fahnenmast + flatternde Fahne
  float pole = sdCapsule(q, vec3(0.0, 16.0, 0.0), vec3(0.0, 20.2, 0.0), 0.06);
  vec3 fq = q - vec3(0.0, 19.4, 0.0);
  fq.xz = rot2(-0.35) * fq.xz;
  float u = clamp(fq.x / 2.0, 0.0, 1.0);
  fq.z -= sin(fq.x * 3.5 - uTime * 6.0) * 0.18 * u + sin(fq.x * 7.0 - uTime * 9.0) * 0.05 * u;
  fq.y += u * u * 0.15 * (1.0 - 0.5 * sin(uTime * 2.0));
  float flag = sdBox(fq - vec3(1.0, 0.0, 0.0), vec3(1.0, 0.5, 0.025));
  float pf = min(pole, flag * 0.6);
  if (pf < d * 0.8) { m = pole < flag ? 3.0 : 2.0; return pf; }
  return d * 0.8;
}

vec3 objAlbedo(float m, vec3 p, vec3 n) {
  vec3 q = p - C;
  if (m > 2.5) return vec3(0.1, 0.09, 0.08);
  if (m > 1.5) {
    // Fahne: tiefrot mit goldenem Streifen
    float stripe = step(abs(q.y - 19.4), 0.09);
    return mix(vec3(0.5, 0.08, 0.07), vec3(0.85, 0.65, 0.2), stripe);
  }
  // Steinquader
  vec2 b = vec2(q.x + q.z, q.y) * vec2(1.4, 2.6);
  b.x += floor(b.y) * 0.5;
  float joint = smoothstep(0.04, 0.09, min(fract(b.x), fract(b.y)));
  vec3 stone = mix(vec3(0.3, 0.3, 0.31), vec3(0.42, 0.4, 0.37), hash(floor(b)));
  stone *= 0.75 + 0.25 * joint;
  // Efeu / Moos von unten
  float ivy = smoothstep(0.45, 0.7, fbm(q.xy * 0.6 + q.z * 0.3, 4)) * smoothstep(8.0, 1.0, q.y);
  return mix(stone, vec3(0.08, 0.16, 0.06), ivy);
}

vec3 objEmit(float m, vec3 p, vec3 n) {
  // ein warmes Fenster im Bergfried
  vec3 q = p - C;
  float w = step(abs(q.y - 11.3), 0.5) * step(abs(atan(q.z, q.x) + 1.5708), 0.16) * step(2.5, length(q.xz));
  return windowGlow(4.0) * w * 0.9;
}

vec3 sceneLights(vec3 p, vec3 n) { return vec3(0.0); }

vec3 sceneVolume(vec3 ro, vec3 rd, float t, vec3 col) {
  return col + pointGlow(ro, rd, t, C + vec3(0.0, 11.3, -3.3), windowGlow(5.0), 1.5) * (0.3 + nightAmt);
}

void sceneCamera(out vec3 ro, out vec3 fw) {
  ro = vec3(3.0, 9.5, 0.0);
  fw = normalize(vec3(-4.0, 6.0, 58.0));
}
`);
