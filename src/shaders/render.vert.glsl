#version 300 es
// ZUR v6.0 (ZUR-GH-013) — instanced particle sprites built from gl_VertexID.
// Styles (u_particleStyle): 0 crisp-dot (4-vertex pinpoint quad, default), 1 dart3d (12-vertex cone, or the 4-vertex
// dart SDF quad from 131072 agents, both 0.55x), 2 synapse-node (crisp soma + 15% axon tracer sparks), 3 star-streak.
// Per-instance state (divisor = 1): a_pos = xyz + seed, a_vel = xyz + phase.
precision highp float;
precision highp int;

layout(location = 0) in vec4 a_pos;
layout(location = 1) in vec4 a_vel;

// ZUR-GH-008: shared dart3d edges must rasterise watertight (bit-identical shared vertices).
invariant gl_Position;

uniform mat4 u_viewProj;
uniform vec3 u_camPos;
uniform vec2 u_resolution;
uniform float u_projScale;      // projection[1][1]
uniform int u_shape;            // 0 dart cone (12 verts, TRIANGLES), 1 quad (4 verts, TRIANGLE_STRIP), 2 dart SDF quad (4 verts, >= 131072 agents)
uniform float u_size;           // user multiplier 0.5x – 4.0x
uniform float u_minRadiusPx;    // capture-space floor, already scaled to render height
uniform uint u_visibleThreshold;
uniform float u_exposure;       // legacy capsule exposure (seconds), kept bound
uniform vec3 u_palette[5];
uniform float u_time;
uniform float u_high;
uniform float u_rms;
uniform int u_colorPalette;
uniform float u_intensity;
uniform int u_trailType;        // 0 comet, 1 electric, 2 strobe, 3 ribbon, 4 none
uniform float u_trailLength;    // 0..1
uniform float u_densityScaleBoost;
uniform int u_pulseLayout;      // -1 = swarm scene, 0 band-clouds, 1 geodesic-sphere, 2 wave-grid
uniform float u_bands[5];       // sub, bass, lowMid, highMid, treble
uniform float u_viewportYOffset; // NDC lift (+0.38 when the portrait HUD drawer is open)
uniform float u_cameraZoom;     // pinch / wheel zoom 0.35..3.50
uniform int u_particleStyle;    // 0 crisp-dot, 1 dart3d, 2 synapse-node, 3 star-streak
uniform int u_formationType;    // 5 logo-attractor, 6 neural-brain, 8 black hole, 9 wormhole, 10 harmonic-ferrofluid
uniform float u_bass;
uniform float u_onset;
uniform float u_treble;
uniform float u_reactivityGain; // Reactivity Punch 0.5..5.0
uniform float u_activeCount;    // live agent count
uniform int u_kineticMode;      // 0 off, 1 synapse-cascade, 2 accretion-warp, 3 ribbon-curtain, 4 shock-shatter
uniform int u_reactivityMode;   // ZUR-GH-013: 0 true-gate (silence = black), 1 ember-floor (0.06), 2 ambient-vj

out vec2 v_local;               // style quad coords (px along / across the screen direction)
flat out vec3 v_normal;
out vec3 v_view;
flat out float v_seed;          // per-agent random 0..1
out float v_neuralPulse;        // audio-driven firing wave (brainstem -> cortex on the 3D Brain)
flat out float v_tint;          // scalar brightness (energy * depth * intensity * emission)
flat out float v_hue;           // < 0.03 per-particle hue jitter
flat out vec3 v_worldPos;       // agent centre: drives the continuous palette gradients
flat out float v_speedNorm;     // 0..1 speed for the palette gradient
flat out vec3 v_bh;             // black-hole event horizon (screen px centre xy, radius px z; 0 = off)
flat out float v_axon;          // 1 = white-matter axon tract, 0 = cortical soma
flat out float v_region;        // 3D Brain region: 0 cerebrum, 1 cerebellum, 2 brainstem
flat out float v_spark;         // synapse-node: 1 = axon tracer spark (15%), 0 = soma
flat out vec4 v_style;          // style extents: x head radius px, y tail px, z stretch, w quad half width px
flat out float v_band;          // pulse-field band 0..4 (-1 = swarm)

const float LOGO_MIN_RADIUS_PX = 2.6;
const float DART_SCALE = 0.55;          // ZUR-GH-013: tighter darts (no furry needles)
const float CRISP_DOT_MAX_PX = 10.0;
const float SYNAPSE_SPARK_FRACTION = 0.15;
// ZUR-GH-014 polish: synapse-cascade = render-only 2.4x v_neuralPulse brightness / colour wave
const float CASCADE_PULSE_GAIN = 2.4;
const float CASCADE_SPEED = 1.25;      // fronts per second
const float CASCADE_TRAVEL = 2.2;      // brainstem base -> frontal pole, in brain units
const float CASCADE_WIDTH = 0.11;      // crisp front half-width (brain units)
const float CASCADE_HIT_FLOOR = 0.35;  // gate-open (hit) floor; silence: cleanGate = 0 -> no cascade
const float CASCADE_ONSET_GAIN = 2.5;
const float BRAIN_SCALE = 3.4 * 1.62;      // sim.vert.glsl BRAIN_SCALE (ZUR-GH-014 BRAIN_PRESENCE 1.62)
const float HOLE_SCALE = 3.2 * 1.0;        // sim.vert.glsl HOLE_SCALE (ZUR-GH-014 HOLE_PRESENCE 1.0)
// ZUR-GH-014 crisp-dot: anti-aliased pinpoint disc, base radius 1.4 px @ 64k -> 0.95 px @ 256k (log2 interpolation).
const float CRISP_DOT_RADIUS_64K = 1.4;
const float CRISP_DOT_RADIUS_256K = 0.95;
const float TAU_R = 6.28318530718;
const float BRAIN_CEREBRUM_FRAC = 0.82;
const float BRAIN_CEREBELLUM_FRAC = 0.11;

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

// Singularity-free velocity frame: blend the up hint away from +Y on steep dives.
mat3 velocityFrame(vec3 velocity) {
  float speed = length(velocity);
  vec3 forward = speed > 1e-5 ? velocity / speed : vec3(0.0, 0.0, 1.0);
  float steep = smoothstep(0.85, 0.99, abs(forward.y));
  vec3 upHint = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0), steep));
  vec3 right = normalize(cross(upHint, forward));
  vec3 up = cross(forward, right);
  return mat3(right, up, forward);
}

vec3 dartVertex(int index) {
  // nose, left, right, top fin, keel
  if (index == 0) return vec3(0.0, 0.0, 1.0);
  if (index == 1) return vec3(-0.42, 0.0, -0.55);
  if (index == 2) return vec3(0.42, 0.0, -0.55);
  if (index == 3) return vec3(0.0, 0.26, -0.38);
  return vec3(0.0, -0.18, -0.42);
}

int dartIndex(int face, int corner) {
  // faces: (N,L,T) (N,T,R) (N,R,K) (N,K,L)
  if (corner == 0) return 0;
  if (face == 0) return corner == 1 ? 1 : 3;
  if (face == 1) return corner == 1 ? 3 : 2;
  if (face == 2) return corner == 1 ? 2 : 4;
  return corner == 1 ? 4 : 1;
}

// ZUR-GH-013 true silence-to-peak gate, identical to FeatureExtractor.js cleanGate().
float cleanGateFromBands() {
  float maxBandEnergy = max(max(u_bands[0], u_bands[1]), max(max(u_bands[2], u_bands[3]), u_bands[4]));
  return smoothstep(0.018, 0.13, maxBandEnergy * u_reactivityGain);
}

float emissionFor(float cleanGate) {
  if (u_reactivityMode == 0) return cleanGate;             // true-gate: silence = 0.00 emission (black)
  if (u_reactivityMode == 1) return max(cleanGate, 0.06);  // ember-floor: 0.06 outline between beats
  return 1.0;                                              // ambient-vj: legacy always-lit VJ look
}

void offscreen() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}

float crispDotRadiusPx(float count) {
  float t = clamp(log2(max(count, 1.0) / 65536.0) / 2.0, 0.0, 1.0);
  return mix(CRISP_DOT_RADIUS_64K, CRISP_DOT_RADIUS_256K, t);
}

// ZUR-GH-014 3D Pulse Field: sharp discrete neon dot-lattice nodes computed analytically per instance (the transform-
// feedback sim is paused on pulse-field-3d). Returns false for instances beyond the lattice budget (culled).
//  0 band-clouds:     five 13^3 cubic lattices clipped to a ball, one per band, around a pentagon; level expands them
//  1 geodesic-sphere: 4000-node Fibonacci (golden-angle) geodesic lattice; each latitude band breathes with its band
//  2 wave-grid:       72 x 72 node grid whose heights are the summed band waves (no streak / blur)
bool pulseLatticeNode(uint iid, int latticeLayout, out vec3 p, out int band) {
  float i = float(iid);
  if (latticeLayout == 1) {
    const float N = 4000.0;
    if (i >= N) return false;
    float y = 1.0 - 2.0 * (i + 0.5) / N;
    float rr = sqrt(max(0.0, 1.0 - y * y));
    float az = (i + 0.5) * 2.39996323 + u_time * 0.10;
    band = int(clamp(floor((y * 0.5 + 0.5) * 5.0), 0.0, 4.0));
    float level = clamp(u_bands[band], 0.0, 1.5);
    p = vec3(cos(az) * rr, y, sin(az) * rr) * 3.4 * (1.0 + 0.16 * level);
    return true;
  }
  if (latticeLayout == 2) {
    const float G = 72.0;
    if (i >= G * G) return false;
    float ix = mod(i, G);
    float iz = floor(i / G);
    float x = (ix / (G - 1.0) - 0.5) * 8.0;
    float z = (iz / (G - 1.0) - 0.5) * 8.0;
    float h = 0.0;
    for (int b = 0; b < 5; b++) {
      float fb = float(b);
      float dir = fb * 1.2566370614;
      float k = 0.6 + 0.35 * fb;
      float w = 0.8 + 0.7 * fb;
      h += clamp(u_bands[b], 0.0, 1.5) * sin(k * (x * cos(dir) + z * sin(dir)) + u_time * w);
    }
    band = int(mod(ix + iz, 5.0));
    float pitch = 0.5585053606; // 32 degrees
    p = vec3(x, h * 1.1 * cos(pitch) - z * sin(pitch), h * 1.1 * sin(pitch) + z * cos(pitch));
    return true;
  }
  const float C = 13.0;
  const float PER = C * C * C;
  if (i >= PER * 5.0) return false;
  band = int(floor(i / PER));
  float k = mod(i, PER);
  vec3 g = vec3(mod(k, C), mod(floor(k / C), C), floor(k / (C * C))) / (C - 1.0) * 2.0 - 1.0;
  if (dot(g, g) > 1.0) return false;
  float fb = float(band);
  float a = fb * 1.2566370614;
  vec3 center = vec3(cos(a) * 2.6, sin(a) * 1.7, sin(fb * 1.7) * 1.6);
  float level = clamp(u_bands[band], 0.0, 1.5);
  float spin = u_time * (0.15 + 0.1 * fb);
  vec3 q = vec3(cos(spin) * g.x + sin(spin) * g.z, g.y, -sin(spin) * g.x + cos(spin) * g.z);
  p = center + q * (0.85 + 0.45 * level);
  return true;
}

void main() {
  uint iid = uint(gl_InstanceID);
  v_local = vec2(0.0);
  v_normal = vec3(0.0, 1.0, 0.0);
  v_view = vec3(0.0, 0.0, 1.0);
  v_seed = 0.0;
  v_neuralPulse = 0.0;
  v_tint = 0.0;
  v_hue = 0.0;
  v_worldPos = vec3(0.0);
  v_speedNorm = 0.0;
  v_axon = 0.0;
  v_region = 0.0;
  v_spark = 0.0;
  v_band = -1.0;
  v_bh = vec3(0.0);
  v_style = vec4(1.0, 0.0, 1.0, 1.0);

  float cleanGate = cleanGateFromBands();
  float emission = emissionFor(cleanGate);
  if (emission <= 0.0 || (u_visibleThreshold != 0xffffffffu && hash32(iid) >= u_visibleThreshold)) {
    offscreen();
    return;
  }
  if (u_formationType == 8) {
    vec4 bhClip = u_viewProj * vec4(0.0, 0.0, 0.0, 1.0);
    float bhW = max(bhClip.w, 0.05);
    vec2 bhNdc = bhClip.xy / bhW * u_cameraZoom + vec2(0.0, u_viewportYOffset);
    float bhPx = u_projScale * 0.5 * u_resolution.y / bhW * u_cameraZoom * (0.24 * HOLE_SCALE * 1.2);
    v_bh = vec3((bhNdc * 0.5 + 0.5) * u_resolution, bhPx);
  }

  vec3 center = a_pos.xyz;
  float seed = a_pos.w;
  vec3 vel = a_vel.xyz;
  int latticeBand = 0;
  if (u_pulseLayout >= 0) {
    // pulse-field-3d: the swarm state is ignored (sim paused); nodes sit exactly on the lattice and never move/streak.
    if (!pulseLatticeNode(iid, u_pulseLayout, center, latticeBand)) {
      offscreen();
      return;
    }
    vel = vec3(0.0);
  }
  float speed = length(vel);
  v_seed = seed;
  v_worldPos = center;
  v_speedNorm = clamp(speed * 0.2, 0.0, 1.0);
  v_hue = (hashf(iid ^ 0x2545f491u) - 0.5) * 0.028;
  v_axon = hashf(iid ^ 0xb5297a4du) < 0.8 ? 0.0 : 1.0;
  float sparkHash = hashf(iid ^ 0x9c1f4e3bu);

  // Audio-only firing wave: amplitude comes strictly from the bands (0 in silence); time only moves the front.
  float audioDrive = clamp(u_bands[0] * 0.5 + u_bass * 0.8 + u_onset * 1.3 + u_treble * 0.6, 0.0, 1.5);
  float cascadePulse = 0.0;   // ZUR-GH-014 polish: synapse-cascade brightness / colour front (render-only, no geometry)
  float wave = sin(length(center) * 14.0 - u_time * 9.0 - u_onset * 5.0);
  v_neuralPulse = smoothstep(0.72, 0.98, wave) * audioDrive;
  if (u_formationType == 6) {
    float region = hashf(iid ^ 0x68e31da4u);
    v_region = region < BRAIN_CEREBRUM_FRAC ? 0.0 : (region < BRAIN_CEREBRUM_FRAC + BRAIN_CEREBELLUM_FRAC ? 1.0 : 2.0);
    // brainstem -> cortex conduction wave, launched from the base of the brainstem
    float c = cos(2.1293017);   // brain view yaw (32 degrees + 90 degrees), sim.vert.glsl brainView()
    float s = sin(2.1293017);
    vec3 stemBase = vec3(c * 0.0 + s * -0.20, -0.86, -s * 0.0 + c * -0.20) * BRAIN_SCALE;
    float travel = length(center - stemBase) / BRAIN_SCALE;
    float conduction = sin(travel * 11.0 - u_time * 8.0 - u_onset * 4.0);
    v_neuralPulse = smoothstep(0.55, 0.95, conduction) * audioDrive;
    if (u_kineticMode == 1) {
      // ZUR-GH-014 polish: kineticMode synapse-cascade no longer pushes agents (sim.vert removes the radial part on
      // surface formations, so the brain swell stays ~1.00x). Instead a crisp electric front races from the brainstem
      // base across the cortical folds on every hit: v_neuralPulse fires (cyan-white) and the tint peaks at 2.4x.
      float hit = cleanGate * clamp(CASCADE_HIT_FLOOR + CASCADE_ONSET_GAIN * u_onset, 0.0, 1.0);
      float front = fract(u_time * CASCADE_SPEED) * CASCADE_TRAVEL;              // brainstem (0) -> frontal cortex
      float fd = (travel - front) / CASCADE_WIDTH;
      float folds = 0.75 + 0.25 * sin(travel * 23.0 + seed * 6.2831853);         // ripple along the gyri
      cascadePulse = exp(-fd * fd) * folds * hit;
      v_neuralPulse = max(v_neuralPulse, cascadePulse > 0.02 ? 0.56 + 0.44 * cascadePulse : 0.0);
    }
    if (u_reactivityMode == 2) {
      // ambient-vj only: the legacy idle thalamic rhythm (a time-only pulse, never used by true-gate / ember-floor)
      float thalamic = sin(length(center) * 6.0 - u_time * 3.8 + seed * 1.7);
      v_neuralPulse = max(v_neuralPulse, smoothstep(0.55, 0.95, thalamic) * 0.78);
    }
  }

  vec4 clipCenter = u_viewProj * vec4(center, 1.0);
  float w = max(clipCenter.w, 0.05);
  float pxPerUnit = u_projScale * 0.5 * u_resolution.y / w * u_cameraZoom;
  bool pulse = u_pulseLayout >= 0;
  int band = u_pulseLayout >= 0 ? latticeBand : int(iid % 5u);
  float bandLevel = pulse ? clamp(u_bands[band], 0.0, 1.5) : 0.0;
  if (pulse) v_band = float(band);
  float sizePulse = 1.0 + 0.45 * u_reactivityGain * (u_bass * 0.5 + u_onset * 0.5) * cleanGate;
  float worldSize = 0.055 * u_size * u_densityScaleBoost * (0.65 + 0.7 * seed) * (1.0 + 0.45 * bandLevel) * sizePulse;
  float zoomDamp = u_cameraZoom > 1.0 ? 1.0 / pow(u_cameraZoom, 0.35) : 1.0;
  float radiusPx = min(worldSize * pxPerUnit * zoomDamp, 14.0);
  if (u_formationType == 5) radiusPx = max(radiusPx, LOGO_MIN_RADIUS_PX);
  worldSize = radiusPx / max(pxPerUnit, 1e-4);
  float floorScale = radiusPx < u_minRadiusPx ? u_minRadiusPx / max(radiusPx, 1e-4) : 1.0;

  // Brightness: energy * depth cue * intensity, then the reactivity emission. Beats explode the brightness.
  float energy = 0.55 + 0.35 * clamp(speed * 0.25, 0.0, 1.0) + 0.35 * u_rms;
  float shimmer = 1.0 + u_high * 0.9 * sin(a_vel.w * 43.0 + u_time * 27.0 + seed * 11.0);
  float depthCue = clamp(1.25 - w * 0.045, 0.35, 1.15);
  // sustained bass / RMS -> brightness (the structured formations no longer swell with them)
  float beatBoost = u_reactivityMode == 2 ? 1.0 : 1.0 + cleanGate * (0.9 * u_onset + 0.5 * u_bass + 0.35 * u_rms);
  float tint = energy * shimmer * depthCue * u_intensity * emission * beatBoost;
  if (pulse) tint = (0.45 + 2.6 * bandLevel) * depthCue * u_intensity * emission;
  if (u_formationType == 8) {
    // Doppler beaming: the disk side rotating toward camera-right brightens
    vec3 camRight = vec3(u_viewProj[0][0], u_viewProj[1][0], u_viewProj[2][0]);
    float rightLen = length(camRight);
    camRight = rightLen > 1e-5 ? camRight / rightLen : vec3(1.0, 0.0, 0.0);
    tint *= max(0.25, 1.0 + 0.65 * dot(normalize(vel + vec3(1e-4)), camRight));
  }
  if (u_trailType == 1) {
    float flick = float(hash32(iid + uint(u_time * 30.0)) & 255u) * (1.0 / 255.0);
    tint *= 0.55 + 0.95 * flick;
  } else if (u_trailType == 2) {
    tint *= mix(0.35, 1.7, step(0.5, fract(u_time * (3.0 + 5.0 * u_trailLength) + seed)));
  }
  tint *= 1.0 + (CASCADE_PULSE_GAIN - 1.0) * cascadePulse;   // ZUR-GH-014 polish: 2.4x crisp cascade brightness
  v_tint = tint;

  if (u_shape == 0 && u_particleStyle == 1) {
    // dart3d: 12-vertex cone, 0.55x scale
    int face = gl_VertexID / 3;
    int corner = gl_VertexID - face * 3;
    mat3 frame = velocityFrame(vel);
    vec3 a = dartVertex(dartIndex(face, 0));
    vec3 b = dartVertex(dartIndex(face, 1));
    vec3 c = dartVertex(dartIndex(face, 2));
    int vertexIndex = dartIndex(face, corner);
    float s = worldSize * 2.2 * floorScale * DART_SCALE;
    vec3 world = center + frame * (dartVertex(vertexIndex) * s);
    v_normal = normalize(frame * cross(b - a, c - a));
    v_view = normalize(u_camPos - world);
    v_local = vec2(corner == 0 ? 0.0 : 1.0, 0.0);
    gl_Position = u_viewProj * vec4(world, 1.0);
    gl_Position.xy *= u_cameraZoom;
    gl_Position.y += u_viewportYOffset * gl_Position.w;
    return;
  }

  // Screen-space quads (4-vertex strip).
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vec4 clipAhead = u_viewProj * vec4(center + vel * 0.05, 1.0);
  vec2 ndc0 = clipCenter.xy / w * u_cameraZoom;
  vec2 ndc1 = clipAhead.xy / max(clipAhead.w, 0.05) * u_cameraZoom;
  vec2 deltaPx = (ndc1 - ndc0) * 0.5 * u_resolution;
  vec2 vScreen = (ndc1 - ndc0) / 0.05 * 0.5;            // projected 2D screen velocity (half-screens / s)
  vec2 dir = length(deltaPx) > 1e-3 ? normalize(deltaPx) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float radius = max(radiusPx, u_minRadiusPx);
  vec2 offsetPx;
  if (u_shape == 2) {
    // dart3d >= 131072 agents: one velocity-oriented quad, dart silhouette shaded per fragment (0.55x).
    float lengthPx = radius * 2.2 * 1.55 * DART_SCALE;
    float halfL = lengthPx * 0.5 + 1.0;
    float halfW = radius * 2.2 * 0.5 * DART_SCALE + 1.0;
    float centerShift = lengthPx * 0.5 - radius * 2.2 * 0.55 * DART_SCALE;
    offsetPx = dir * (corner.x * halfL + centerShift) + perp * corner.y * halfW;
    v_local = corner;
    v_style = vec4(halfL, halfW, 1.0, halfW);
  } else {
    // crisp-dot head shared by every quad style: razor pinpoint radius (exp(-r2 * 16) core, hard cutoff at r = 1)
    float headR = clamp(radius * 1.5, 2.5, CRISP_DOT_MAX_PX);
    if (u_particleStyle == 0 || pulse) {
      // ZUR-GH-014 true pinpoint: 1.4 px @ 64k -> 0.95 px @ 256k (x Particle Size, +1 px AA rim on the quad);
      // the pulse lattice uses the same pinpoint nodes (1.6x so the sparse lattice stays legible).
      float base = crispDotRadiusPx(u_activeCount) * u_size * (pulse ? 2.0 + 0.6 * bandLevel : 1.0);
      headR = clamp(base * mix(0.9, 1.15, clamp(sizePulse - 1.0, 0.0, 1.0)), 0.8, CRISP_DOT_MAX_PX);
    }
    if (u_formationType == 5) headR = max(headR, LOGO_MIN_RADIUS_PX * 1.5);
    bool spark = u_particleStyle == 2 && sparkHash < SYNAPSE_SPARK_FRACTION;
    v_spark = spark ? 1.0 : 0.0;
    float stretch = 1.0;
    if (u_particleStyle == 3 || spark) {
      // star-streak: stretches along the projected 2D screen velocity, crisp head at rest (stretch == 1)
      stretch = 1.0 + clamp(length(vScreen) * (16.0 + 45.0 * u_bass + 60.0 * u_onset), 0.0, 18.0);
      stretch = min(stretch + 2.5 * (u_bass + u_rms) * cleanGate, 19.0);  // sustained bass / RMS -> streak stretch
      if (spark) stretch = 1.0 + clamp(length(vScreen) * 40.0 + 8.0 * u_onset, 0.0, 18.0);
    }
    float tailPx = headR * (stretch - 1.0);
    float halfL = headR + tailPx * 0.5;
    float centerShift = -tailPx * 0.5;                   // tail trails behind the head
    offsetPx = dir * (corner.x * halfL + centerShift) + perp * corner.y * headR;
    v_local = vec2(corner.x * halfL + centerShift, corner.y * headR);
    v_style = vec4(headR, tailPx, stretch, headR);
  }
  vec2 quadNdc = ndc0 + offsetPx * 2.0 / u_resolution + vec2(0.0, u_viewportYOffset);
  gl_Position = vec4(quadNdc * w, clipCenter.z, w);
}
