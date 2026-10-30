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
uniform int u_formationType;     // 0 free-3d, 1 neon-tunnel, 2 polygon-rings, 3 supernova-shell, 4 fractal-core, 5 logo-attractor
uniform int u_oscillationType;   // 0 off, 1 wave, 2 helix, 3 bounce, 4 pulse
uniform float u_oscillationAmount;
uniform float u_oscillationSpeed;
uniform int u_pulseLayout;       // -1 = swarm scene, 0 band-clouds, 1 geodesic-sphere, 2 wave-grid
uniform int u_megastructure;
uniform float u_bands[5];        // sub, bass, lowMid, highMid, treble

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

vec3 logoAttractorTarget() {
  return aLogoTarget.xyz;
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
  if (u_formationType == 4) {
    vec3 dir = normalize(pos + vec3(1e-4));
    return dir * (1.45 + 0.5 * seed);
  }
  if (u_formationType == 5) return logoAttractorTarget();
  return pos;
}

// Stage 3 oscillation offset applied to the formation target.
vec3 oscillationOffset(vec3 pos, float seed, float phase) {
  if (u_oscillationType == 0 || u_oscillationAmount <= 0.0) return vec3(0.0);
  float t = u_time * u_oscillationSpeed;
  float amt = u_oscillationAmount * (1.0 + 0.6 * u_bass);
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

void main() {
  int id = gl_VertexID;
  uint uid = uint(id);
  vec3 pos = a_pos.xyz;
  vec3 vel = a_vel.xyz;
  float seed = a_pos.w;
  float phase = a_vel.w;
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
    // GAS: high-frequency multi-octave curl + thermal buoyancy + treble burst.
    vec3 q = pos * 0.55 + vec3(0.0, -u_time * 0.35, u_time * 0.12);
    vec3 turb = curlAnalytic(q) + 0.5 * curlAnalytic(q * 2.07 + 11.0);
    float heat = phase + u_onset * 0.6;
    F = k * turb * (0.9 + 1.2 * u_high + 0.6 * u_rms);
    F += vec3(0.0, 2.6 * heat + 0.5, 0.0);
    vec3 fromCore = pos - vec3(0.0, -2.0, 0.0);
    F += normalize(fromCore + 1e-4) * u_high * u_high * 18.0 * step(0.45, seed);
    F += -vec3(pos.x, 0.0, pos.z) * 0.35;
    phase -= dt / (2.8 + 2.2 * seed);
    if (phase <= 0.0 || pos.y > 5.5) {
      vec3 h = hash3(uid ^ hash32(uint(u_time * 60.0) + 7u));
      float a = h.x * 6.2831853;
      float rr = sqrt(h.y) * (1.0 + 0.8 * u_sub);
      pos = vec3(cos(a) * rr, -3.6 + h.z * 0.5, sin(a) * rr);
      vel = vec3(0.0, 0.6 + h.z, 0.0);
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
    vec3 core = outward * (3.0 + lane + 0.5 * u_bass) + vec3(0.0, sin(atan(pos.z, pos.x) * 2.0 + u_time * 0.4) * 0.45, 0.0);
    vec3 toCore = core - pos;
    F = vec3(toCore.x * 3.0, toCore.y * 7.0, toCore.z * 3.0);
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
  } else if (u_formationType != 0 || u_oscillationType != 0) {
    // Stage 3 formations + oscillation layer on top of the active flow mode.
    vec3 target = formationTarget(pos, seed, phase, uid) + oscillationOffset(pos, seed, phase);
    float pull = u_formationType == 0 ? 1.5 : (u_formationType == 5 ? 16.0 : 7.0);
    // Camera-facing tunnel / rings / logo: formation dominates curl so glyphs stay crisp.
    if (u_formationType == 1 || u_formationType == 2) F *= 0.15;
    if (u_formationType == 5) F *= 0.05; // damp random curl jitter for readable text
    float damp = u_formationType == 0 ? 0.0 : (u_formationType == 5 ? 5.5 : 2.6);
    F += (target - pos) * pull - vel * damp;
    if (u_formationType == 1) F += tiltToWorld(vec3(0.0, 0.0, 1.8 + 3.0 * u_rms + 2.0 * u_bass));
  }

  // Soft spherical boundary keeps every agent in the camera volume.
  float over = max(length(pos) - BOUND_RADIUS, 0.0);
  F += -normalize(pos + 1e-5) * over * over * 6.0;

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
