#version 300 es
// ZUR Stage 3 — transform-feedback particle update (one fixed 1/60 s step per draw).
// a_pos = xyz position + w size/seed; a_vel = xyz velocity + w phase/life.
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec4 a_pos;
layout(location = 1) in vec4 a_vel;
layout(location = 2) in vec4 aLogoTarget;

out vec4 v_pos;
out vec4 v_vel;

uniform float u_dt;
uniform float u_time;
uniform int u_mode;          // 0 fluid, 1 gas, 2 murmuration, 3 fish, 4 physarum
uniform int u_count;
uniform float u_damping;     // continuous rate (1/s) from per-step retention
uniform float u_rms;
uniform float u_sub;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_onset;
uniform float u_waveSpeed;
uniform vec4 u_shock[4];     // xyz origin, w birth time (< 0 = empty)
uniform sampler2D u_neighbors; // RGBA32F, 2 texels per agent, 256 agents per row
uniform int u_useNeighbors;
uniform int u_formationType;     // 0 free-3d, 1 neon-tunnel, 2 polygon-rings, 3 supernova-shell, 4 fractal-core, 5 logo-attractor, 6 neural-brain, 7 living-galaxy, 8 supermassive-blackhole, 9 wormhole, 10 harmonic-ferrofluid
uniform int u_oscillationType;   // 0 off, 1 wave, 2 helix, 3 bounce, 4 pulse
uniform float u_oscillationAmount;
uniform float u_oscillationSpeed;
uniform int u_pulseLayout;       // -1 = swarm scene, 0 band-clouds, 1 geodesic-sphere, 2 wave-grid
uniform int u_megastructure;
uniform float u_bands[5];        // sub, bass, lowMid, highMid, treble
uniform vec3 u_billboardRight;   // ZUR-GH-007: active camera right (logo-attractor billboard XY)
uniform vec3 u_billboardUp;      // ZUR-GH-007: active camera up
uniform int u_particleStyle;     // ZUR-GH-013: 0 crisp-dot, 1 dart3d, 2 synapse-node, 3 star-streak
uniform int u_kineticMode;       // ZUR-GH-013: 0 off, 1 synapse-cascade, 2 accretion-warp, 3 ribbon-curtain, 4 shock-shatter
uniform float u_reactivityGain;  // ZUR-GH-009: Reactivity Punch 0.5..5.0
uniform float u_cleanGate;       // ZUR-GH-013: smoothstep(0.018, 0.13, maxBandEnergy * u_reactivityGain), 0 in silence
uniform int u_reactivityMode;    // ZUR-GH-013: 0 true-gate, 1 ember-floor, 2 ambient-vj

const float BOUND_RADIUS = 7.2;
// Spawn / formation volume: the normalized [-1.25, +1.25] cube scaled to world units.
const float VOLUME_HALF = 1.25;
const float WORLD_SCALE = 3.2;
const float VOLUME_WORLD = VOLUME_HALF * WORLD_SCALE;
const float TAU = 6.28318530718;

uint hash32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

float hashf(uint x) {
  return float(hash32(x) >> 8u) * (1.0 / 16777216.0);
}

vec3 hash3(uint x) {
  return vec3(hashf(x), hashf(x ^ 0x9e3779b9u), hashf(x ^ 0x85ebca6bu));
}

// ---- Analytic 3D simplex noise with gradient (Gustavson / McEwan) ----
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float simplexValueGradient(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;
  return 105.0 * dot(m4, pdotx);
}

// Divergence-free curl of a 3-component simplex potential. Not normalized,
// so the field stays incompressible.
vec3 curlAnalytic(vec3 q) {
  vec3 gx; vec3 gy; vec3 gz;
  simplexValueGradient(q, gx);
  simplexValueGradient(q + vec3(31.416, -47.853, 12.793), gy);
  simplexValueGradient(q + vec3(-19.731, 73.137, -59.413), gz);
  return vec3(gz.y - gy.z, gx.z - gz.x, gy.x - gx.y);
}

// Exact frozen-force drag: dv/dt = F - k v over dt.
void integrateFrozenDrag(inout vec3 pos, inout vec3 vel, vec3 forcing, float k, float dt) {
  float kd = k * dt;
  float E; float A; float B;
  if (abs(kd) < 1e-3) {
    E = 1.0 - kd + kd * kd * 0.5 - kd * kd * kd / 6.0;
    A = dt - k * dt * dt * 0.5 + k * k * dt * dt * dt / 6.0;
    B = dt * dt * 0.5 - k * dt * dt * dt / 6.0 + k * k * dt * dt * dt * dt / 24.0;
  } else {
    E = exp(-kd);
    A = (1.0 - E) / k;
    B = (dt - A) / k;
  }
  pos = pos + vel * A + forcing * B;
  vel = vel * E + forcing * A;
}

vec3 clampSpeed(vec3 v, float lo, float hi, vec3 fallbackDir) {
  float s = length(v);
  if (s < 1e-5) return fallbackDir * lo;
  return v * (clamp(s, lo, hi) / s);
}

// Five orbiting Lissajous attractors (mirrored in particleMath.js lissajous()).
vec3 lissajous(int index, float t) {
  float i = float(index);
  float fx = 0.21 + 0.037 * i;
  float fy = 0.17 + 0.029 * i;
  float fz = 0.13 + 0.041 * i;
  float ph = i * 1.2566370614;
  return vec3(sin(t * fx + ph) * 3.4, sin(t * fy * 1.7 + ph * 0.5) * 1.6, cos(t * fz + ph) * 3.4);
}

// ZUR-GH-008: School of Fish bait-ball leaders. Y offsets sum to zero (mirrored in particleMath.js FISH_LEADER_Y).
const float FISH_LEADER_Y[6] = float[6](0.9, -0.9, 0.55, -0.55, 0.25, -0.25);
vec3 fishLeader(int index, float t) {
  float i = float(index);
  float a = i * 1.0471975512 + t * 0.35;
  // equally spaced bob phases: the six bobs also sum to zero at every t
  float bob = sin(t * 0.5 + i * 1.0471975512) * 0.25;
  return vec3(cos(a) * 3.0, FISH_LEADER_Y[index] + bob, sin(a) * 3.0);
}

// ZUR-GH-008: Gas toroidal circulation ring radius and Y wrap height (mirrored in particleMath.js).
const float GAS_TORUS_RADIUS = 2.4;
const float GAS_WRAP_Y = 4.2;

// Causal Gaussian predator shockwaves: zero ahead of the expanding front.
vec3 shockwaveAcceleration(vec3 pos) {
  vec3 acc = vec3(0.0);
  const float width = 0.9;
  for (int i = 0; i < 4; i++) {
    vec4 s = u_shock[i];
    if (s.w < 0.0) continue;
    float age = u_time - s.w;
    if (age < 0.0 || age > 4.0) continue;
    vec3 d = pos - s.xyz;
    float r = length(d) + 1e-4;
    float front = u_waveSpeed * age;
    float x = (r - front) / width;
    float gate = smoothstep(-width, 0.0, front - r);
    float w = exp(-x * x) * gate * exp(-age / 1.6);
    acc += (d / r) * w * (9.0 + 14.0 * u_rms);
  }
  return acc;
}

float cellularRidge(vec3 p) {
  vec3 cell = floor(p);
  vec3 local = fract(p);
  float nearest = 10.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 neighbor = vec3(float(x), float(y), float(z));
        vec3 point = neighbor + fract(sin(vec3(
          dot(cell + neighbor, vec3(127.1, 311.7, 74.7)),
          dot(cell + neighbor, vec3(269.5, 183.3, 246.1)),
          dot(cell + neighbor, vec3(113.5, 271.9, 124.6))
        )) * 43758.5453);
        nearest = min(nearest, length(local - point));
      }
    }
  }
  float ridge = 1.0 - clamp(nearest, 0.0, 1.0);
  return ridge * ridge;
}

float physarumField(vec3 p) {
  return cellularRidge(p * 0.65) * 0.57
    + cellularRidge(p * 1.3 + 7.1) * 0.29
    + cellularRidge(p * 2.6 - 3.4) * 0.14;
}

float sdCore(vec3 p) {
  float angle = atan(p.y, p.x);
  float lobes = sin(angle * 7.0 + u_time * 0.7) * cos(atan(p.z, length(p.xy)) * 5.0 - u_time * 0.4);
  float radius = 0.88 + 0.18 * lobes + 0.08 * sin(p.x * 5.0 + p.y * 4.0 + u_time) + 0.12 * u_bass;
  return length(p) - radius;
}

// ZUR-GH-007: glyph oscillation is scaled to 8% so Oscillation 3.00 cannot smear the letters.
const float LOGO_OSCILLATION_SCALE = 0.08;

// ZUR-GH-007: billboard the XY glyph plane onto the active camera (right/up) so text faces the viewer
// from every orbit angle instead of going edge-on.
vec3 logoAttractorTarget() {
  vec3 right = length(u_billboardRight) > 0.5 ? normalize(u_billboardRight) : vec3(1.0, 0.0, 0.0);
  vec3 up = length(u_billboardUp) > 0.5 ? normalize(u_billboardUp) : vec3(0.0, 1.0, 0.0);
  vec3 toward = cross(right, up); // points back at the camera
  return right * aLogoTarget.x + up * aLogoTarget.y + toward * aLogoTarget.z;
}

// Rodrigues rotation of v about a unit axis.
vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

// ZUR-GH-007: fractal-core is a full 3D multi-orbital volumetric shell + lobe streams (never a planar ring).
// Golden-spiral spherical distribution (theta azimuth = golden angle, phi polar = acos) per agent, split
// across five tilted orbital planes that counter-rotate, layered in depth, with radial audio-reactive
// breathing that dives into the sdCore() valleys. 30% of agents ride outward streams along the 7 lobes.
const float MEGA_SWARM_INNER_R = 0.62;
vec3 fractalCoreTarget(float seed, uint uid) {
  float n = float(max(u_count, 1));
  float i = float(uid) + 0.5;
  float phi = acos(clamp(1.0 - 2.0 * i / n, -1.0, 1.0)); // polar angle, uniform on the sphere
  float theta = i * 2.39996323;                          // golden-angle azimuth
  vec3 dir = vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
  int orbit = int(uid % 5u);
  float fo = float(orbit);
  vec3 axis = normalize(vec3(sin(fo * 1.2566370614 + 0.4), 0.35 + 1.1 * cos(fo * 0.9), cos(fo * 1.2566370614 + 0.4)));
  float spinDir = mod(fo, 2.0) < 0.5 ? 1.0 : -1.0;
  float band = clamp(u_bands[orbit], 0.0, 1.5);
  float stream = hashf(uid ^ 0x51ed270bu);
  if (stream < 0.30) {
    // Lobe streams: flow outward from the core along the 7 azimuthal lobe peaks of sdCore().
    float k = floor(hashf(uid ^ 0x2545f491u) * 7.0);
    float lobeAz = (1.5707963 - u_time * 0.7 + TAU * k) / 7.0;
    float el = (hashf(uid ^ 0x68e31da4u) - 0.5) * 1.9 + 0.25 * sin(u_time * 0.3 + k);
    vec3 lobeDir = vec3(cos(el) * cos(lobeAz), cos(el) * sin(lobeAz), sin(el));
    lobeDir = rotateAxis(lobeDir, axis, u_time * 0.05 * spinDir);
    float travel = fract(seed * 3.7 + u_time * (0.18 + 0.25 * band));
    float R = 1.15 + travel * (2.6 + 1.2 * band) + 0.12 * u_bass;
    return lobeDir * R;
  }
  dir = rotateAxis(dir, axis, u_time * (0.16 + 0.06 * fo) * spinDir);
  float lobes = sin(atan(dir.y, dir.x) * 7.0 + u_time * 0.7) * cos(atan(dir.z, length(dir.xy)) * 5.0 - u_time * 0.4);
  float coreRadius = 0.88 + 0.18 * lobes + 0.12 * u_bass;
  float valley = max(-lobes, 0.0);
  float layer = fract(seed * 5.0 + i * 0.6180339887);
  float breathe = 0.18 * sin(u_time * 1.6 + fo * 1.3 + layer * 3.0) + 0.45 * band;
  // ZUR-GH-012: the orbit swarm keeps a clear inner shell (r >= coreRadius + 0.62) so the Mandelbulb is never buried.
  float R = coreRadius + MEGA_SWARM_INNER_R + 1.0 * layer + breathe * (1.0 - 0.5 * valley) - valley * (0.25 + 0.35 * band);
  return dir * max(R, coreRadius + MEGA_SWARM_INNER_R);
}

vec4 fetchNeighbor(int id, int texel) {
  int row = id / 256;
  int col = (id - row * 256) * 2 + texel;
  return texelFetch(u_neighbors, ivec2(col, row), 0);
}

// Topological 6-neighbor ring (id±1..3): separation, alignment, cohesion.
void ringFlock(int id, vec3 pos, vec3 vel, float sepRadius, out vec3 sep, out vec3 align, out vec3 cohesion) {
  sep = vec3(0.0);
  vec3 sumV = vec3(0.0);
  vec3 sumP = vec3(0.0);
  for (int k = 1; k <= 3; k++) {
    int ids[2];
    ids[0] = (id + k) % u_count;
    ids[1] = (id - k + u_count) % u_count;
    for (int n = 0; n < 2; n++) {
      vec3 np = fetchNeighbor(ids[n], 0).xyz;
      vec3 nv = fetchNeighbor(ids[n], 1).xyz;
      vec3 d = pos - np;
      float dist = length(d) + 1e-4;
      if (dist < sepRadius) sep += (d / dist) * (sepRadius - dist) / sepRadius;
      sumV += nv;
      sumP += np;
    }
  }
  align = sumV / 6.0 - vel;
  cohesion = sumP / 6.0 - pos;
}


// Distance from the axis to a regular n-gon edge at polar angle a (circumradius R).
float polygonRadius(float a, float sides, float R) {
  float sector = TAU / sides;
  float offset = mod(a, sector) - sector * 0.5;
  return R * cos(sector * 0.5) / cos(offset);
}

// Tunnel / rings live in a camera-facing XY plane (revolving around Z, streaming along Z toward
// the camera), pitched ~12 degrees about X for 3D perspective. These map world <-> formation frame.
const float FORMATION_TILT = 0.2094395102; // 12 degrees
vec3 tiltToWorld(vec3 p) {
  float c = cos(FORMATION_TILT);
  float s = sin(FORMATION_TILT);
  return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}
vec3 tiltToFormation(vec3 p) {
  float c = cos(FORMATION_TILT);
  float s = sin(FORMATION_TILT);
  return vec3(p.x, p.y * c + p.z * s, -p.y * s + p.z * c);
}


// ---- ZUR-GH-009 Stage 5 formations (ids 6..9). Normalised shapes scaled into the existing +/-4 world volume. ----
const float BRAIN_SCALE = 3.4;
const float GALAXY_SCALE = 3.4;
const float HOLE_SCALE = 3.2;
const float FORMATION_TETHER_MIN = 4.2;
const float FORMATION_CURL_CAP = 0.18;
const float WORMHOLE_SCALE = 2.6;

// 80% cortical soma / 20% interior white-matter axon tracts (render.vert.glsl mirrors this split for the gold tint).
bool isCorticalSoma(uint uid) {
  return hashf(uid ^ 0xb5297a4du) < 0.8;
}

// ---- ZUR-GH-013 Anatomical 3D Brain (replaces the lung / egg ovals). Brain frame: +x lateral (right), +y up,
// +z anterior (frontal pole). Region split (render.vert.glsl mirrors it with the same hash): 82% cerebral lobes,
// 11% striated cerebellum, 7% brainstem. Mirrored in particleMath.js BRAIN_*.
const float BRAIN_CEREBRUM_FRAC = 0.82;
const float BRAIN_CEREBELLUM_FRAC = 0.11;   // cumulative 0.93; the last 7% is the brainstem
const float BRAIN_GAP = 0.045;              // dark longitudinal fissure width (no central egg)
const float BRAIN_HEMI_WIDTH = 0.46;
const float BRAIN_VIEW_YAW = 0.5585053606;  // 32 degrees: 3/4 lateral view

float brainRegion(uint uid) {
  return hashf(uid ^ 0x68e31da4u);
}

vec3 unitSphere(vec2 h) {
  float z = 1.0 - 2.0 * h.x;
  float rr = sqrt(max(0.0, 1.0 - z * z));
  float a = h.y * TAU;
  return vec3(cos(a) * rr, sin(a) * rr, z);
}

// Asymmetric cerebral hemisphere surface for side s (+1 right / -1 left) and unit direction d.
vec3 cerebrumSurface(vec3 d, float s) {
  float lateral = s * d.x;                                   // > 0 on the outer (lateral) face
  float medialHalf = BRAIN_HEMI_WIDTH * 0.18;                // flattened medial wall
  float lateralHalf = BRAIN_HEMI_WIDTH * 0.82;
  float cx = s * (BRAIN_GAP * 0.5 + medialHalf);
  float x = cx + d.x * (lateral > 0.0 ? lateralHalf : medialHalf);
  float y = d.y * (d.y > 0.0 ? 0.44 : 0.26);                 // domed top, flatter base
  float z = d.z * 0.70;
  // tapered frontal pole (anterior) and a narrower, pointed occipital pole (posterior)
  float front = max(d.z, 0.0);
  float back = max(-d.z, 0.0);
  float taper = 1.0 - 0.34 * front * front - 0.22 * back * back * back;
  x = cx + (x - cx) * taper;
  y *= 1.0 - 0.18 * front * front;
  z += 0.05 * back * back;                                   // occipital pole extends backward
  // temporal lobe: lower lateral bulge pushed forward and down, below the Sylvian fissure
  float temporal = smoothstep(0.15, 0.6, lateral) * smoothstep(0.05, -0.45, d.y) * smoothstep(-0.55, 0.15, d.z) * smoothstep(0.85, 0.35, d.z);
  y -= 0.11 * temporal;
  z += 0.07 * temporal;
  x += s * 0.045 * temporal;
  // Sylvian (lateral) fissure: a groove rising backward along the lateral face; dots are parted away from its line
  float fissureY = -0.04 + 0.20 * clamp(-d.z + 0.15, 0.0, 1.0) * 0.6;
  float fd = y - fissureY;
  float onLateral = smoothstep(0.25, 0.55, lateral) * smoothstep(0.7, 0.2, d.z) * smoothstep(-0.75, -0.2, d.z);
  float part = onLateral * (1.0 - smoothstep(0.0, 0.045, abs(fd)));
  y += sign(fd + 1e-4) * 0.035 * part;
  x -= s * 0.03 * part;                                      // the fissure is recessed into the surface
  vec3 p = vec3(x, y, z);
  // surface-locked +/-0.03 gyri / sulci ridges (driven by the parametric direction, so they ride with the surface)
  float ridge = sin(d.x * 21.0 + 2.2 * sin(d.z * 15.0 + d.y * 4.0)) * cos(d.y * 19.0 + 1.6 * sin(d.z * 11.0));
  vec3 n = normalize(vec3((x - cx) / 0.36, y / 0.36, z / 0.70) + vec3(1e-4));
  p += n * 0.03 * ridge;
  p.x = s * max(s * p.x, BRAIN_GAP * 0.5);                  // the 0.045 longitudinal gap stays empty
  return p;
}

// Horizontally striated cerebellum tucked under the occipital pole.
vec3 cerebellumSurface(vec3 d) {
  float folia = 0.5 + 0.5 * cos(d.y * 42.0);                 // horizontal folia grooves
  vec3 r = vec3(0.34, 0.15, 0.19) * (1.0 - 0.10 * folia);
  return vec3(0.0, -0.30, -0.46) + d * r;
}

// Brainstem descending from under the cerebrum (pons / medulla), slight forward curve, tapering.
vec3 brainstemPoint(vec3 h) {
  float t = h.x;                                             // 0 top .. 1 bottom
  float a = h.y * TAU;
  float radius = mix(0.095, 0.06, t) * (0.85 + 0.15 * h.z);
  vec3 axis = vec3(0.0, mix(-0.16, -0.86, t), mix(-0.10, -0.20, t) + 0.05 * sin(t * 3.14159265));
  return axis + vec3(cos(a) * radius, 0.0, sin(a) * radius);
}

vec3 brainView(vec3 p) {
  // 32 degree 3/4 lateral view: rotate about Y so the right lateral face (temporal lobe, Sylvian fissure) shows.
  float c = cos(BRAIN_VIEW_YAW + 1.5707963);
  float s = sin(BRAIN_VIEW_YAW + 1.5707963);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 neuralBrainTarget(float seed, uint uid) {
  vec3 h = hash3(uid ^ 0x1b873593u);
  float region = brainRegion(uid);
  vec3 pos;
  if (region < BRAIN_CEREBRUM_FRAC) {
    float side = hashf(uid ^ 0x2f6b1a7du) < 0.5 ? -1.0 : 1.0;
    vec3 d = unitSphere(h.xy);
    if (isCorticalSoma(uid)) {
      pos = cerebrumSurface(d, side) * (1.0 + 0.04 * u_onset * u_cleanGate);
    } else {
      // white-matter tract: arcs from a cortical site down toward the brainstem (stays inside one hemisphere)
      float s = fract(seed * 9.0 + u_time * 0.22);
      vec3 cortex = cerebrumSurface(d, side);
      vec3 core = vec3(side * 0.14, -0.08, -0.04);
      pos = mix(cortex, core, s * 0.85);
    }
  } else if (region < BRAIN_CEREBRUM_FRAC + BRAIN_CEREBELLUM_FRAC) {
    pos = cerebellumSurface(unitSphere(h.xy));
  } else {
    pos = brainstemPoint(h);
  }
  return brainView(pos) * BRAIN_SCALE;
}

// ---- ZUR-GH-013 Harmonic Ferrofluid (replaces Blood): 70% spherical-harmonic spike shell on 5 FFT bands + 30% EQ rings.
const float FERRO_SHELL_FRAC = 0.70;
const float FERRO_SCALE = 2.4;

vec3 harmonicFerrofluidTarget(float seed, uint uid) {
  vec3 h = hash3(uid ^ 0x51ed270bu);
  float kind = hashf(uid ^ 0x0ab1c2d3u);
  float b0 = clamp(u_bands[0], 0.0, 1.5);
  float b1 = clamp(u_bands[1], 0.0, 1.5);
  float b2 = clamp(u_bands[2], 0.0, 1.5);
  float b3 = clamp(u_bands[3], 0.0, 1.5);
  float b4 = clamp(u_bands[4], 0.0, 1.5);
  if (kind < FERRO_SHELL_FRAC) {
    vec3 d = unitSphere(h.xy);
    float ct = d.y;                                          // cos(theta)
    float st = sqrt(max(0.0, 1.0 - ct * ct));
    float phi = atan(d.z, d.x + 1e-6);                       // geometry only (continuous through cos/sin below)
    float spin = u_time * 0.25;
    // real spherical harmonics, one per band (l = 2, 3, 4, 6, 8)
    float y2 = 0.5 * (3.0 * ct * ct - 1.0);
    float y3 = st * st * st * sin(3.0 * (phi + spin));
    float y4 = st * st * st * st * cos(4.0 * (phi - spin));
    float y6 = st * st * st * st * st * st * cos(6.0 * phi + spin * 2.0);
    float y8 = pow(st, 8.0) * sin(8.0 * phi - spin * 3.0);
    float field = b0 * y2 * 0.55 + b1 * y3 * 0.75 + b2 * y4 * 0.7 + b3 * y6 * 0.8 + b4 * y8 * 0.9;
    // ferrofluid spikes: sharpened positive lobes, dots spread along each spike
    // sustained bass / RMS feed the spike amplitude (ZUR-GH-013 tightening)
    float spike = pow(clamp(0.5 + 0.5 * field, 0.0, 1.0), 6.0) * (0.25 + 0.55 * (b1 + b4) + 0.30 * u_bass + 0.35 * u_rms);
    float r = 0.62 + 0.10 * field + spike * h.z;
    return d * r * FERRO_SCALE;
  }
  // concentric 3D live EQ waveform rings (one per band), tilted toward the camera
  int ring = int(uid % 5u);
  float level = clamp(u_bands[ring], 0.0, 1.5);
  float a = h.x * TAU;
  float radius = 0.92 + 0.13 * float(ring);
  float wave = sin(a * (5.0 + 2.0 * float(ring)) + u_time * (1.5 + 0.4 * float(ring))) * (0.04 + 0.22 * level);
  vec3 ringPos = vec3(cos(a) * radius, wave + (h.y - 0.5) * 0.015, sin(a) * radius);
  float tilt = 0.42 + 0.08 * float(ring);
  float c = cos(tilt);
  float s = sin(tilt);
  return vec3(ringPos.x, ringPos.y * c - ringPos.z * s, ringPos.y * s + ringPos.z * c) * FERRO_SCALE;
}

float galaxyOmega(float r) {
  return 1.35 / pow(r + 0.12, 1.15);
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 livingGalaxyTarget(float seed, uint uid) {
  vec3 h = hash3(uid ^ 0x2c1b3c6du);
  float kind = hashf(uid ^ 0x27d4eb2fu);
  vec3 pos;
  const float SPIN = 0.06;
  if (kind < 0.18) {
    // central bulge: dense, slightly flattened ball that rotates rigidly-ish
    vec3 dir = normalize(hash3(uid ^ 0x165667b1u) * 2.0 - 1.0 + vec3(1e-3));
    float rb = 0.30 * pow(h.x, 1.4);
    pos = rotateY(dir * rb * vec3(1.0, 0.7, 1.0), galaxyOmega(rb) * u_time * SPIN);
  } else if (kind > 0.95) {
    // H-II knots: tight star-forming clumps pinned to the arms, swelling on u_mid / u_high
    int k = int(uid % 12u);
    float rk = 0.30 + 0.07 * float(k);
    float th = log(rk / 0.08) / 0.32;
    float ang = th + float(k % 4) * 1.5707963 + galaxyOmega(rk) * u_time * SPIN;
    vec3 center = vec3(cos(ang), 0.0, sin(ang)) * rk;
    float swell = 1.0 + 2.2 * (u_mid + u_high);
    pos = center + (h - 0.5) * 0.06 * swell;
  } else {
    // four logarithmic arms: r = 0.08 * exp(0.32 * theta_arm), Keplerian shear
    int arm = int(uid % 4u);
    float th = h.x * 8.46;
    float r = 0.08 * exp(0.32 * th);
    float ang = th + float(arm) * 1.5707963 + galaxyOmega(r) * u_time * SPIN;
    float rr = r + (h.y - 0.5) * 0.10 * (0.4 + r);
    pos = vec3(cos(ang) * rr, (h.z - 0.5) * 0.07 * (1.3 - min(r, 1.2)), sin(ang) * rr);
  }
  // present the disc ~25 degrees toward the orbiting camera
  float c = cos(0.43);
  float s = sin(0.43);
  pos = vec3(pos.x, pos.y * c - pos.z * s, pos.y * s + pos.z * c);
  return pos * GALAXY_SCALE;
}

// ZUR-GH-010 Gargantua (formation index 8 == FORMATION_TYPES["supermassive-blackhole"]).
// Split 60% 14-degree-tilted spiral accretion disk / 28% full 360-degree Einstein photon ring / 12% polar jets.
// Everything is built in the camera-facing basis so the void stays centred on screen at every orbit angle.
const float BH_DISK_FRAC = 0.60;
const float BH_RING_FRAC = 0.28;                 // cumulative edge at BH_DISK_FRAC + BH_RING_FRAC = 0.88; jets take 0.12
const float BH_HORIZON = 0.24;                   // spherical event horizon void radius (normalised, x HOLE_SCALE in world)
const float BH_SHADOW = 0.36;                    // lateral shadow cylinder: lensed void seen from the camera
const float BH_PHOTON_RING = 0.42;
const float BH_DISK_INNER = 0.46;
const float BH_TILT = 0.2443461;                 // 14 degrees
// ZUR-GH-012 Interstellar Gargantua: the disk is a nearly edge-on equatorial plane, tilted 14 degrees toward the camera.
// diskNormal = normalize(vec3(0.08, 0.96, -0.26)) in (screen right, screen up, toward camera); it is also the jet axis.

void blackHoleBasis(out vec3 right, out vec3 up, out vec3 toward) {
  right = length(u_billboardRight) > 0.5 ? normalize(u_billboardRight) : vec3(1.0, 0.0, 0.0);
  up = length(u_billboardUp) > 0.5 ? normalize(u_billboardUp) : vec3(0.0, 1.0, 0.0);
  toward = normalize(cross(right, up));
}

vec3 blackHoleTarget(float seed, uint uid) {
  vec3 h = hash3(uid ^ 0x3c6ef372u);
  float kind = hashf(uid ^ 0x4cf5ad43u);
  vec3 right; vec3 up; vec3 toward;
  blackHoleBasis(right, up, toward);
  vec3 pos;
  if (kind < BH_DISK_FRAC) {
    // edge-on accretion disk: three log-spiral arms, Keplerian shear (Doppler beaming lives in render.vert.glsl)
    float rd = BH_DISK_INNER + 0.85 * pow(h.x, 1.25);
    int arm = int(uid % 3u);
    float spiral = log(rd / BH_DISK_INNER) * 2.4;
    float ang = spiral + float(arm) * 2.0943951 + (h.y - 0.5) * 0.5 + u_time * 0.20 / pow(rd + 0.15, 1.5);
    vec3 diskNormal = normalize(vec3(0.08, 0.96, -0.26));
    vec3 axisX = normalize(vec3(diskNormal.y, -diskNormal.x, 0.0));          // in-plane, ~screen horizontal
    vec3 axisY = cross(diskNormal, axisX);                                    // in-plane, mostly along the view axis
    vec3 inPlane = axisX * cos(ang) * rd + axisY * sin(ang) * rd;
    vec3 local = inPlane + diskNormal * (h.z - 0.5) * 0.05 * rd;
    pos = right * local.x + up * local.y + toward * local.z;
  } else if (kind < BH_DISK_FRAC + BH_RING_FRAC) {
    // Einstein photon ring: gravitationally lensed light wrapped through the full 360 degrees around the hole
    float phi = h.y * TAU;
    float rr = BH_PHOTON_RING + (h.x - 0.5) * 0.03;
    pos = right * cos(phi) * rr + up * sin(phi) * rr + toward * (h.z - 0.5) * 0.03;
  } else {
    // collimated twin polar jets along the screen-vertical axis, driven by u_sub and u_onset
    float dir = h.z < 0.5 ? 1.0 : -1.0;
    float s = fract(h.x + u_time * (0.30 + 0.5 * u_sub + 0.8 * u_onset));
    float width = (0.015 + 0.09 * s) * (0.4 + 0.6 * h.y);
    float ang = hashf(uid ^ 0x1f83d9abu) * TAU;
    vec3 jetN = normalize(vec3(0.08, 0.96, -0.26));
    vec3 jetA = normalize(vec3(jetN.y, -jetN.x, 0.0));
    vec3 jetB = cross(jetN, jetA);
    vec3 jetLocal = jetN * dir * (0.46 + s * 1.15) + jetA * cos(ang) * width + jetB * sin(ang) * width;
    pos = right * jetLocal.x + up * jetLocal.y + toward * jetLocal.z;
  }
  if (length(pos) < BH_HORIZON) pos *= BH_HORIZON / max(length(pos), 1e-4);
  return pos * HOLE_SCALE;
}

/// Hard exclusion: no agent may rest inside the event horizon sphere or the camera-facing shadow cylinder.
vec3 blackHoleExclude(vec3 pos) {
  vec3 right; vec3 up; vec3 toward;
  blackHoleBasis(right, up, toward);
  float rr = BH_HORIZON * HOLE_SCALE;
  float rs = BH_SHADOW * HOLE_SCALE;
  float lx = dot(pos, right);
  float ly = dot(pos, up);
  float lz = dot(pos, toward);
  float lat = length(vec2(lx, ly));
  if (lat < rs) {
    vec2 dir2 = lat > 1e-4 ? vec2(lx, ly) / lat : vec2(1.0, 0.0);
    lx = dir2.x * rs * 1.08;
    ly = dir2.y * rs * 1.08;
    pos = right * lx + up * ly + toward * lz;
  }
  float len = length(pos);
  if (len < rr) pos *= rr * 1.05 / max(len, 1e-4);
  return pos;
}

// ZUR-GH-013 Spherical Wormhole — Funnel in Sphere: a closed horned torus. theta = u * TAU sweeps the meridian:
// theta = 0 is the outer R = 0.94 equator of the dot shell, theta = PI the tight r = 0.08 throat inside it; both poles
// fold the shell smoothly inward. Streams flow along the meridian (shell -> pole -> throat -> pole -> shell).
const float WORMHOLE_TILT = 0.3839724354;  // 22 degrees toward the camera
vec3 wormholeTarget(float seed, uint uid) {
  vec3 h = hash3(uid ^ 0x5be0cd19u);
  float u = fract(h.x + u_time * 0.035);
  float theta = u * TAU;
  float rxz = 0.51 + 0.43 * cos(theta);
  float y = 0.76 * sin(theta) * mix(0.52, 1.0, 0.5 + 0.5 * cos(theta));
  float psi = h.y * TAU + u_time * 0.12;
  vec3 p = vec3(cos(psi) * rxz, y, sin(psi) * rxz);
  float c = cos(WORMHOLE_TILT);
  float s = sin(WORMHOLE_TILT);
  p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
  return p * WORMHOLE_SCALE;
}

// ZUR-GH-013: formations whose silhouette must stay readable under loud sustained audio.
const float STRUCTURED_ONSET_PULSE = 0.08;  // max transient radial scale 1.08x (onset only, never bass / RMS)
bool structuredFormation() {
  return u_formationType == 5 || u_formationType == 6 || u_formationType == 8 || u_formationType == 9;
}

// Stage 3 formation target for one agent. free-3d returns pos (no pull).
vec3 formationTarget(vec3 pos, float seed, float phase, uint uid) {
  if (u_formationType == 1) {
    // neon-tunnel: hex vortex in the camera-facing XY plane; agents revolve around Z and stream along +Z
    vec3 local = tiltToFormation(pos);
    float theta = atan(local.y, local.x) + 0.2 + 0.25 * u_rms;
    float lane = 0.55 + 0.45 * seed;
    float ringRadius = polygonRadius(theta, 6.0, 4.6) * lane;
    vec3 target = local;
    target.xy = ringRadius * vec2(cos(theta), sin(theta));
    return tiltToWorld(target);
  }
  if (u_formationType == 2) {
    // polygon-rings: 8 concentric hexagonal rings facing the camera, scrolling toward it along Z
    float ring = floor(seed * 8.0);
    float z = mod((ring / 8.0 + u_time * 0.05) , 1.0) * 2.0 * VOLUME_WORLD - VOLUME_WORLD;
    // Angle comes from the agent's seed (stable): flow modes advance `phase` far faster than a capped agent can chase.
    float theta = fract(seed * 8.0) * TAU + u_time * 0.15;
    float ringRadius = polygonRadius(theta, 6.0, 5.0);
    vec3 target = vec3(0.0, 0.0, z);
    target.xy = ringRadius * vec2(cos(theta), sin(theta));
    return tiltToWorld(target);
  }
  if (u_formationType == 3) {
    // supernova-shell: fibonacci shell that swells on bass / onset
    float i = float(uid) + 0.5;
    float n = float(max(u_count, 1));
    float y = 1.0 - 2.0 * i / n;
    float rr = sqrt(max(0.0, 1.0 - y * y));
    float az = i * 2.39996323;
    float R = 3.0 + 1.4 * u_bass + 1.8 * u_onset;
    return vec3(cos(az) * rr, y, sin(az) * rr) * R;
  }
  if (u_formationType == 4) return fractalCoreTarget(seed, uid);
  if (u_formationType == 5) return logoAttractorTarget();
  if (u_formationType == 6) return neuralBrainTarget(seed, uid);
  if (u_formationType == 7) return livingGalaxyTarget(seed, uid);
  if (u_formationType == 8) return blackHoleTarget(seed, uid);
  if (u_formationType == 9) return wormholeTarget(seed, uid);
  if (u_formationType == 10) return harmonicFerrofluidTarget(seed, uid);
  return pos;
}

// Stage 3 oscillation offset applied to the formation target.
vec3 oscillationOffset(vec3 pos, float seed, float phase) {
  if (u_oscillationType == 0 || u_oscillationAmount <= 0.0) return vec3(0.0);
  float t = u_time * u_oscillationSpeed;
  float amt = u_oscillationAmount * (1.0 + 0.6 * u_bass);
  if (u_formationType == 5) amt *= LOGO_OSCILLATION_SCALE; // keep glyph targets sharp
  float ang = pos.z * 1.1 + t * 2.0 + seed * TAU;
  vec3 radialDir = normalize(vec3(pos.xy, 0.0) + vec3(1e-4, 0.0, 0.0));
  if (u_oscillationType == 1) {
    return vec3(0.0, sin(pos.z * 1.3 + t * 2.0) * 0.7 * amt, cos(pos.x * 1.1 + t * 1.7) * 0.35 * amt);
  }
  if (u_oscillationType == 2) {
    return vec3(cos(ang), sin(ang), 0.0) * 0.55 * amt;
  }
  if (u_oscillationType == 3) {
    return (radialDir * abs(sin(t * 2.0 + seed * TAU)) * 0.9 + vec3(0.0, 0.0, 0.0)) * amt;
  }
  float breathe = sin(t * 3.0 - length(pos) * 0.8);
  return normalize(pos + vec3(1e-4)) * breathe * 0.7 * amt;
}

// Stage 3 pulse-field target: every agent belongs to band id % 5.
vec3 pulseTarget(int id, vec3 pos, float seed, uint uid, out float stiffness) {
  int band = id % 5;
  float level = clamp(u_bands[band], 0.0, 1.5);
  stiffness = 4.0;
  if (u_pulseLayout == 1) {
    float i = float(id) + 0.5;
    float n = float(max(u_count, 1));
    float y = 1.0 - 2.0 * i / n;
    float rr = sqrt(max(0.0, 1.0 - y * y));
    float az = i * 2.39996323 + u_time * (0.12 + 0.5 * level);
    float R = 3.2 * (1.0 + 0.28 * level);
    return vec3(cos(az) * rr, y, sin(az) * rr) * R;
  }
  if (u_pulseLayout == 2) {
    float g = ceil(sqrt(float(max(u_count, 1))));
    float ix = float(id % int(g));
    float iz = float(id / int(g));
    float x = (ix / max(g - 1.0, 1.0) - 0.5) * 2.0 * VOLUME_WORLD;
    float z = (iz / max(g - 1.0, 1.0) - 0.5) * 2.0 * VOLUME_WORLD;
    float h = 0.0;
    for (int b = 0; b < 5; b++) {
      float fb = float(b);
      float dir = fb * 1.2566370614;
      float k = 0.6 + 0.35 * fb;
      float w = 0.8 + 0.7 * fb + 1.5 * clamp(u_bands[b], 0.0, 1.5);
      h += clamp(u_bands[b], 0.0, 1.5) * sin(k * (x * cos(dir) + z * sin(dir)) + u_time * w);
    }
    stiffness = 7.0;
    float pitch = 0.5585053606; // 32 degrees
    return vec3(x, h * 1.1 * cos(pitch) - z * sin(pitch), h * 1.1 * sin(pitch) + z * cos(pitch));
  }
  // band-clouds: five clouds around a pentagon; level sets swirl speed and shell scale
  float fb = float(band);
  float a = fb * 1.2566370614;
  vec3 center = vec3(cos(a) * 2.6, sin(a) * 1.7, sin(fb * 1.7) * 1.6);
  vec3 rel = pos - center;
  vec3 dir = normalize(rel + (hash3(uid) - 0.5) * 0.05 + vec3(1e-4));
  float R = 0.7 + 0.6 * seed + 0.9 * level;
  return center + dir * R;
}


// ZUR-GH-013: one distinct motion per kinetic mode 1..4 (the blood splatter run was deleted).
vec3 kineticForce(vec3 pos, vec3 vel, float seed, uint uid) {
  float r = length(pos);
  vec3 radial = pos / max(r, 1e-4);
  if (u_kineticMode == 1) {
    // synapse-cascade: an excitation front sweeps outward; agents on it fire along random dendrite branches
    float fd = (r - fract(u_time * 0.28) * 6.0) / 0.55;
    float front = exp(-fd * fd);
    vec3 branch = normalize(cross(radial, hash3(uid ^ 0x6d2b79f5u) - 0.5) + radial * 0.6 + vec3(1e-4));
    return branch * front * (10.0 + 14.0 * u_onset);
  }
  if (u_kineticMode == 2) {
    // accretion-warp: Keplerian swirl about Y, inward spiral, vertical flattening into a disk
    float rho = length(pos.xz) + 1e-3;
    vec3 tangent = vec3(-pos.z, 0.0, pos.x) / rho;
    vec3 inward = -vec3(pos.x, 0.0, pos.z) / rho;
    return tangent * (4.5 / (0.6 + 0.5 * rho)) * (1.0 + 0.8 * u_bass)
      + inward * (0.7 + 2.0 * u_onset) + vec3(0.0, -pos.y * 3.0, 0.0);
  }
  if (u_kineticMode == 3) {
    // ribbon-curtain: six lanes of sinusoidal ribbons sliding sideways in thin sheets
    float lane = floor(seed * 6.0) / 6.0;
    float wave = sin(pos.x * 1.1 + u_time * 1.4 + lane * TAU) * (0.8 + 1.5 * u_mid);
    float sheetZ = (lane - 0.42) * 5.0;
    return vec3(1.6 + 2.0 * u_rms, (wave * 1.2 - pos.y * 0.9) * 2.0, (sheetZ - pos.z) * 3.0);
  }
  if (u_kineticMode == 4) {
    // shock-shatter: space is cut into cells; each cell bursts away from its own centre on onsets
    vec3 cell = floor(pos * 0.45);
    uvec3 c = uvec3(ivec3(cell) + 64);
    uint ch = hash32(c.x * 73856093u ^ c.y * 19349663u ^ c.z * 83492791u);
    vec3 center = (cell + 0.5 + (hash3(ch) - 0.5) * 0.6) / 0.45;
    vec3 away = normalize(pos - center + vec3(1e-3));
    return away * (u_onset * u_onset * 30.0 + 0.6 * u_bass) - pos * 0.12;
  }
  return vec3(0.0);
}

void main() {
  int id = gl_VertexID;
  uint uid = uint(id);
  vec3 pos = a_pos.xyz;
  vec3 vel = a_vel.xyz;
  float seed = a_pos.w;
  float phase = a_vel.w;
  // ZUR-GH-013: legacy states may still carry the deleted blood pin flag (phase + 2.6); drop it.
  if (phase >= 2.0) phase -= 2.6;
  phase = clamp(phase, 0.0, 1.0);
  float dt = u_dt;
  float k = u_damping;
  vec3 F = vec3(0.0);
  float r = length(pos);
  vec3 radial = pos / max(r, 1e-4);
  float lo = 0.0;
  float hi = 9.0;

  if (u_mode == 0) {
    // FLUID: divergence-free curl + laminar swirl + bass radial impulse.
    vec3 q = pos * 0.22 + vec3(0.0, 0.0, u_time * 0.05);
    vec3 target = curlAnalytic(q) * (0.55 + 1.5 * u_bass + 0.4 * u_sub);
    target += cross(vec3(0.0, 1.0, 0.0), pos) * (0.22 + 0.25 * u_mid);
    F = k * target;
    F += radial * u_bass * u_onset * 22.0;
    phase = fract(phase + dt * (0.15 + u_rms));
  } else if (u_mode == 1) {
    // GAS (ZUR-GH-008): multi-octave curl + toroidal thermal circulation. Heat rises through the core, a radial
    // curl disperses it outward over the top, it sinks at the rim and returns underneath, so buoyancy circulates
    // the full 3D volume instead of stalling in one central white-hot column. Smooth spherical / Y wrap bounds it.
    vec3 q = pos * 0.55 + vec3(0.0, -u_time * 0.35, u_time * 0.12);
    vec3 turb = curlAnalytic(q) + 0.5 * curlAnalytic(q * 2.07 + 11.0);
    float heat = phase + u_onset * 0.6;
    F = k * turb * (0.9 + 1.2 * u_high + 0.6 * u_rms);
    float rxz = length(pos.xz) + 1e-4;
    vec3 radDir = vec3(pos.x / rxz, 0.0, pos.z / rxz);
    vec2 merid = vec2(rxz - GAS_TORUS_RADIUS, pos.y);          // meridional plane, centred on the vortex ring
    vec2 circ = vec2(merid.y, -merid.x) * exp(-dot(merid, merid) / 10.0);
    F += (radDir * circ.x + vec3(0.0, circ.y, 0.0)) * (1.6 + 1.1 * heat + 0.8 * u_mid);
    F += vec3(0.0, 0.9 * heat + 0.15, 0.0);                   // residual thermal buoyancy
    F += cross(vec3(0.0, 1.0, 0.0), radDir) * (0.9 + 0.8 * u_mid);  // radial curl (swirl about Y)
    F += radDir * smoothstep(0.0, 3.0, pos.y) * (1.2 + 1.5 * u_high); // plume tops spill outward
    F += normalize(pos + 1e-4) * u_high * u_high * 18.0 * step(0.45, seed);
    F -= pos * 0.06 * smoothstep(4.0, 6.0, length(pos));      // soft spherical bound
    phase -= dt / (2.8 + 2.2 * seed);
    if (pos.y > GAS_WRAP_Y) {
      pos.y -= 2.0 * GAS_WRAP_Y;                               // toroidal Y wrap: re-enter underneath, same column
    } else if (pos.y < -GAS_WRAP_Y) {
      pos.y += 2.0 * GAS_WRAP_Y;
    }
    if (length(pos) > 6.5) pos *= -0.85;                       // spherical wrap through the opposite side
    if (phase <= 0.0) {
      vec3 h = hash3(uid ^ hash32(uint(u_time * 60.0) + 7u));
      float a = h.x * 6.2831853;
      float rr = sqrt(h.y) * (3.2 + 0.8 * u_sub);              // reseed across the full disk, not the centre
      pos = vec3(cos(a) * rr, (h.z * 2.0 - 1.0) * 3.0, sin(a) * rr);
      vel = vec3(0.0, 0.3 + h.z * 0.6, 0.0);
      phase = 1.0;
    }
  } else if (u_mode == 2) {
    // MURMURATION: curl flow + 5 Lissajous attractors with retarded-time delay
    // + causal predator shockwaves + topological 6-neighbor flocking.
    int group = int(hash32(uid) % 5u);
    vec3 leaderNow = lissajous(group, u_time);
    float delay = length(pos - leaderNow) / max(u_waveSpeed, 0.1);
    vec3 leader = lissajous(group, u_time - delay);
    vec3 toLeader = leader - pos;
    float dl = length(toLeader) + 1e-4;
    float shell = 0.9 + 0.8 * u_bass;
    F = (toLeader / dl) * (dl - shell) * 1.6;
    F += cross(vec3(0.0, 1.0, 0.0), toLeader / dl) * 1.2;
    F += curlAnalytic(pos * 0.3 + vec3(u_time * 0.1)) * 1.4;
    F += shockwaveAcceleration(pos);
    if (u_useNeighbors == 1) {
      vec3 sep; vec3 align; vec3 coh;
      ringFlock(id, pos, vel, 0.35, sep, align, coh);
      F += sep * 6.0 + align * 1.8 + coh * 0.7;
    }
    lo = 0.9;
    hi = 3.4 + 1.5 * u_rms;
    phase = fract(phase + dt * (0.8 + 2.0 * u_mid));
  } else if (u_mode == 3) {
    // FISH: tight horizontal banking torus + rapid darting alignment + u_high shimmer.
    vec3 flat_ = vec3(pos.x, 0.0, pos.z);
    float rf = length(flat_) + 1e-4;
    vec3 outward = flat_ / rf;
    float lane = (seed - 0.5) * 1.1;
    // ZUR-GH-008: six bait-ball leaders orbit the torus; their Y offsets (and bob phases) sum to zero so the
    // school is balanced across +Y / -Y instead of clustering in the upper hemisphere.
    int lead = int(hash32(uid ^ 0x9e3779b9u) % 6u);
    vec3 leaderPos = fishLeader(lead, u_time);
    vec3 core = outward * (3.0 + lane + 0.5 * u_bass)
      + vec3(0.0, leaderPos.y + sin(atan(pos.z, pos.x) * 2.0 + u_time * 0.4) * 0.45, 0.0);
    vec3 toCore = core - pos;
    F = vec3(toCore.x * 3.0, toCore.y * 7.0, toCore.z * 3.0);
    vec3 toLeaderBall = leaderPos - pos;
    F += toLeaderBall * 0.35 / (1.0 + 0.15 * dot(toLeaderBall, toLeaderBall));
    vec3 swim = cross(vec3(0.0, 1.0, 0.0), outward);
    F += swim * (5.5 + 3.0 * u_mid);
    float burstSlot = floor(u_time * 1.5 + seed * 7.0);
    if (hashf(uid ^ hash32(uint(burstSlot))) > 0.93) F += normalize(vel + swim * 0.1) * 9.0;
    F += cross(normalize(vel + 1e-4), vec3(0.0, 1.0, 0.0)) * sin(phase * 50.0 + u_time * 31.0) * u_high * 6.0;
    F += shockwaveAcceleration(pos) * 0.7;
    if (u_useNeighbors == 1) {
      vec3 sep; vec3 align; vec3 coh;
      ringFlock(id, pos, vel, 0.25, sep, align, coh);
      F += sep * 7.0 + align * 4.5 + coh * 0.5;
    }
    lo = 1.2;
    hi = 4.5 + 2.0 * u_high;
    phase = fract(phase + dt * (1.2 + 3.0 * u_high));
  } else {
    // Three-sensor chemotaxis: multi-octave cellular ridges steer this neural web.
    vec2 heading = normalize(vel.xy + vec2(1e-4, 0.0));
    float sensorAngle = 0.45;
    vec2 senseForwardDir = heading;
    vec2 senseLeftDir = vec2(cos(sensorAngle) * heading.x - sin(sensorAngle) * heading.y,
                             sin(sensorAngle) * heading.x + cos(sensorAngle) * heading.y);
    vec2 senseRightDir = vec2(cos(sensorAngle) * heading.x + sin(sensorAngle) * heading.y,
                              -sin(sensorAngle) * heading.x + cos(sensorAngle) * heading.y);
    float senseLeft = physarumField(pos + vec3(senseLeftDir * 0.14, 0.0));
    float senseForward = physarumField(pos + vec3(senseForwardDir * 0.14, 0.0));
    float senseRight = physarumField(pos + vec3(senseRightDir * 0.14, 0.0));
    float branchJitter = (hashf(uid ^ uint(u_time * 30.0)) - 0.5) * (0.25 + 1.5 * u_onset);
    vec2 steer = senseForward * senseForwardDir
      + senseLeft * senseLeftDir * (1.0 + branchJitter)
      + senseRight * senseRightDir * (1.0 - branchJitter);
    F = vec3(normalize(steer + vec2(1e-4, 0.0)) * (2.0 + 5.0 * u_onset), 0.0);
    F += vec3(-pos.x, 0.0, -pos.z) * 0.12;
    lo = 0.25;
    hi = 3.0 + 2.0 * u_onset;
    phase = fract(phase + dt * (0.5 + 2.0 * u_onset));
  }

  if (u_pulseLayout >= 0) {
    // Stage 3 pulse-field: spring to the layout target, swirl speed driven by the agent's band.
    float stiff;
    vec3 target = pulseTarget(id, pos, seed, uid, stiff);
    float level = clamp(u_bands[id % 5], 0.0, 1.5);
    F = (target - pos) * stiff - vel * 1.2;
    if (u_pulseLayout == 0) {
      float a = float(id % 5) * 1.2566370614;
      vec3 center = vec3(cos(a) * 2.6, sin(a) * 1.7, sin(float(id % 5) * 1.7) * 1.6);
      F += cross(vec3(0.0, 1.0, 0.0), pos - center) * (0.8 + 5.0 * level);
    }
    F += curlAnalytic(pos * 0.35 + vec3(u_time * 0.08)) * 0.6;
    lo = 0.0;
    hi = 14.0;
  } else {
    // Stage 3 formations + oscillation layer on top of the active flow mode. ZUR-GH-009: runs for free-3d too so the
    // audio radial kick below applies even when Oscillation amount == 0 (kick == 1 in silence => no force).
    float kick = u_formationType == 5 ? 1.0 : 1.0 + 0.28 * u_reactivityGain * (u_sub * 0.65 + u_bass * 0.35);
    // ZUR-GH-013 tightening: structured shapes (logo, brain, black hole, wormhole) never balloon on sustained audio.
    // The legacy sustained 1.42x swell becomes a <= 1.08x transient onset micro-pulse; sustained bass / RMS drive
    // brightness, tracer speed, streak stretch and ferrofluid spikes instead.
    if (structuredFormation()) kick = 1.0 + STRUCTURED_ONSET_PULSE * clamp(u_onset, 0.0, 1.0) * u_cleanGate;
    vec3 target = (formationTarget(pos, seed, phase, uid) + oscillationOffset(pos, seed, phase)) * kick;
    float pull = u_formationType == 0 ? 1.5 : (u_formationType == 5 ? 16.0 : 7.0);
    // ZUR-GH-010 formation confinement lock (Stage 5 formations, u_formation >= 6): tether never below 4.2 and the
    // turbulent curl displacement is capped at 0.18 * formationRadius so the shape cannot dissolve.
    float formationRadius = max(length(target), 1.0);
    if (u_formationType >= 6) pull = max(pull, FORMATION_TETHER_MIN);
    // Camera-facing tunnel / rings / logo: formation dominates curl so glyphs stay crisp.
    if (u_formationType == 1 || u_formationType == 2) F *= 0.15;
    if (u_formationType == 5) F *= 0.05; // damp random curl jitter for readable text
    if (u_formationType == 4) F *= 0.25;
    if (u_formationType >= 6) {
      F *= 0.25; // volumetric targets dominate the flow field
      // ZUR-GH-013: structured shapes keep audio-driven turbulence to a third of the cap so loud flows cannot inflate them.
      float curlMax = FORMATION_CURL_CAP * (structuredFormation() ? 0.33 : 1.0) * formationRadius * pull;
      float fl = length(F);
      if (fl > curlMax) F *= curlMax / fl;
    }
    float damp = u_formationType == 0 ? 0.0 : (u_formationType == 5 ? 5.5 : 2.6);
    F += (target - pos) * pull - vel * damp;
    if (u_formationType == 1) F += tiltToWorld(vec3(0.0, 0.0, 1.8 + 3.0 * u_rms + 2.0 * u_bass));
    // ZUR-GH-007: glyph agents must be able to come to rest on their targets. The murmuration / fish
    // minimum-speed clamp (lo > 0) kept them orbiting ~0.2 world units around each glyph pixel -> pink cloud.
    if (u_formationType == 5) { lo = 0.0; hi = 6.0; }
  }

  // Soft spherical boundary keeps every agent in the camera volume.
  float over = max(length(pos) - BOUND_RADIUS, 0.0);
  F += -normalize(pos + 1e-5) * over * over * 6.0;

  if (u_kineticMode >= 1) F += kineticForce(pos, vel, seed, uid);
  // ZUR-GH-009: onset velocity impulse (kept even when Oscillation amount == 0); glyph targets only feel 15%.
  float onsetKick = u_onset * 2.2 * u_reactivityGain * (u_formationType == 5 ? 0.15 : 1.0);
  vec3 kickDir = normalize(radial + (hash3(uid ^ 0x7f4a7c15u) - 0.5) * 0.9 + vec3(1e-4));
  // ZUR-GH-013: structured shapes take onset impulses at 0.35x so a transient pulse stays a micro-pulse (<= ~1.08x).
  float structuredImpulse = structuredFormation() ? 0.35 : 1.0;
  vel += kickDir * onsetKick * dt * 3.0 * structuredImpulse;
  // ZUR-GH-013 true-gate: beats (gate open) add an explosive radial displacement + velocity burst; silence damps motion.
  float glyphScale = u_formationType == 5 ? 0.1 : 1.0;
  if (u_reactivityMode != 2) {
    // Onset-dominated so the burst is transient: a sustained bass bed only breathes the shape (equilibrium offset
    // ~ burst / pull), while each transient throws agents outward before the formation spring snaps them back.
    float sustainedBurst = structuredFormation() ? 0.0 : u_bass * 1.6;  // structured: onset-only (transient)
    float burst = u_cleanGate * (sustainedBurst + u_onset * 9.0) * (u_reactivityGain / 2.5) * glyphScale;
    vel += radial * burst * dt * structuredImpulse;
    pos += radial * u_cleanGate * u_onset * 1.4 * dt * (u_reactivityGain / 2.5) * glyphScale * structuredImpulse;
    k += (1.0 - u_cleanGate) * 5.0;  // damped motion between beats
  }
  // ZUR-GH-013 synapse-node: 15% axon tracer sparks race along the formation surface on onsets / high-mids.
  if (u_particleStyle == 2 && hashf(uid ^ 0x9c1f4e3bu) < 0.15) {
    vec3 along = normalize(cross(radial, vec3(0.0, 1.0, 0.0)) + cross(radial, vec3(1.0, 0.0, 0.0)) * 0.35 + vec3(1e-4));
    vel += along * (u_onset * 9.0 + u_high * 6.0 + u_bass * 4.0 + u_rms * 3.0) * u_cleanGate * dt * 6.0;  // sustained bass / RMS -> tracer speed
  }

  integrateFrozenDrag(pos, vel, F, k, dt);
  if (u_formationType == 4 || u_megastructure == 1) {
    float coreDistance = sdCore(pos);
    if (coreDistance < 0.0) {
      const float e = 0.002;
      vec3 n = normalize(vec3(
        sdCore(pos + vec3(e, 0.0, 0.0)) - sdCore(pos - vec3(e, 0.0, 0.0)),
        sdCore(pos + vec3(0.0, e, 0.0)) - sdCore(pos - vec3(0.0, e, 0.0)),
        sdCore(pos + vec3(0.0, 0.0, e)) - sdCore(pos - vec3(0.0, 0.0, e))
      ));
      pos += n * (-coreDistance + 0.015);
      vel = reflect(vel, n) * (0.85 + 0.35 * u_onset);
    }
  }
  if (lo > 0.0) {
    vec3 fallbackDir = normalize(hash3(uid) - 0.5 + 1e-3);
    vel = clampSpeed(vel, lo, hi, fallbackDir);
  } else {
    float s = length(vel);
    if (s > hi) vel *= hi / s;
  }

  // ZUR-GH-010 black hole: nothing may sit inside the event horizon or the camera-facing shadow cylinder.
  if (u_pulseLayout < 0 && u_formationType == 8) pos = blackHoleExclude(pos);

  // neon-tunnel streams toward the camera (+Z in the tilted formation frame) and re-enters at the far end.
  if (u_pulseLayout < 0 && u_formationType == 1) {
    vec3 local = tiltToFormation(pos);
    if (local.z > VOLUME_WORLD) {
      local.z -= 2.0 * VOLUME_WORLD;
      pos = tiltToWorld(local);
    }
  }

  // NaN / runaway guard.
  if (any(isnan(pos)) || any(isinf(pos)) || length(pos) > 40.0) {
    pos = (hash3(uid + 17u) - 0.5) * 4.0;
    vel = vec3(0.0);
  }
  if (any(isnan(vel)) || any(isinf(vel))) vel = vec3(0.0);

  v_pos = vec4(pos, seed);
  v_vel = vec4(vel, phase);
}
