#version 300 es
// ZUR Stage 2 — transform-feedback particle update (one fixed 1/60 s step per draw).
// a_pos = xyz position + w size/seed; a_vel = xyz velocity + w phase/life.
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec4 a_pos;
layout(location = 1) in vec4 a_vel;

out vec4 v_pos;
out vec4 v_vel;

uniform float u_dt;
uniform float u_time;
uniform int u_mode;          // 0 fluid, 1 gas, 2 murmuration, 3 fish
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

const float BOUND_RADIUS = 6.5;

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
  } else {
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
  }

  // Soft spherical boundary keeps every agent in the camera volume.
  float over = max(length(pos) - BOUND_RADIUS, 0.0);
  F += -normalize(pos + 1e-5) * over * over * 6.0;

  integrateFrozenDrag(pos, vel, F, k, dt);
  if (lo > 0.0) {
    vec3 fallbackDir = normalize(hash3(uid) - 0.5 + 1e-3);
    vel = clampSpeed(vel, lo, hi, fallbackDir);
  } else {
    float s = length(vel);
    if (s > hi) vel *= hi / s;
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
