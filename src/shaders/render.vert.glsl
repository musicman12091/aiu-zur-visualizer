#version 300 es
// ZUR Stage 3 — instanced 3D darts / velocity capsules built from gl_VertexID.
// Per-instance state (divisor = 1): a_pos = xyz + size/seed, a_vel = xyz + phase/life.
precision highp float;
precision highp int;

layout(location = 0) in vec4 a_pos;
layout(location = 1) in vec4 a_vel;

// ZUR-GH-008: shared dart3d edges must rasterise watertight. Each corner's clip position is a pure function of
// (instance, vertex index) and gl_Position is invariant, so the 4 triangles meet bit-identically (no dotted seams).
invariant gl_Position;

uniform mat4 u_viewProj;
uniform vec3 u_camPos;
uniform vec2 u_resolution;
uniform float u_projScale;      // projection[1][1]
uniform int u_shape;            // 0 dart (12 verts, TRIANGLES), 1 capsule (4 verts, TRIANGLE_STRIP)
uniform float u_size;           // user multiplier 0.5x – 4.0x
uniform float u_minRadiusPx;    // capture-space floor, already scaled to render height
uniform uint u_visibleThreshold;
uniform float u_exposure;       // capsule motion stretch (seconds)
uniform vec3 u_palette[5];
uniform float u_time;
uniform float u_high;
uniform float u_rms;
uniform float u_intensity;
uniform int u_trailType;        // 0 comet, 1 electric, 2 strobe, 3 ribbon, 4 none
uniform float u_trailLength;    // 0..1
uniform float u_densityScaleBoost;
uniform int u_pulseLayout;      // -1 = swarm scene, 0 band-clouds, 1 geodesic-sphere, 2 wave-grid
uniform float u_bands[5];       // sub, bass, lowMid, highMid, treble
uniform float u_viewportYOffset; // NDC lift (+0.38 when the portrait HUD drawer is open), lerped to 0 when hidden
uniform float u_cameraZoom;     // ZUR-GH-009: pinch / wheel zoom 0.35..3.50 (scales projected clip XY and sprite size)
uniform int u_particleStyle;    // ZUR-GH-009: 0 dart3d, 1 blood-drop, 2 synapse-spark, 3 star-streak
uniform int u_formationType;    // ZUR-GH-009: 6 neural-brain gold tint, 8 black-hole Doppler beaming
uniform float u_bass;
uniform float u_onset;
uniform float u_treble;
uniform float u_reactivityGain; // ZUR-GH-009: Reactivity Punch 0.5..5.0
uniform float u_activeCount;    // ZUR-GH-010: live agent count (shortens needle streaks at 96k..256k so the swarm stays readable)
uniform int u_kineticMode;      // ZUR-GH-010: 1 = splatter-run (blood sprite ceiling 28 px)

out vec3 v_color;
out vec3 v_colorAlt;            // secondary palette color for the dart rim (chromatic, never white)
out vec2 v_local;               // capsule: pixel coords along/perp velocity
flat out float v_halfSeg;
flat out float v_radius;
flat out vec3 v_normal;
out vec3 v_view;
flat out float v_seed;          // per-agent random 0..1
out float v_neuralPulse;        // ZUR-GH-009: dedicated synapse-firing wave (NOT stored in the velocity aux channel)
flat out float v_pinned;        // ZUR-GH-009: 2.6 while a blood drop is splatted on the wall (sim.vert aux.w), else 0
flat out float v_tint;          // scalar brightness (energy * shimmer * depth * intensity * trail flicker)
flat out float v_group;         // 0..1 colour slot for the fragment palette
flat out vec3 v_formColor;      // formation-owned colour (golden brain neurons) used by the true-neon palette
flat out float v_formMix;
flat out float v_hue;           // ZUR-GH-010: spatial hue (3D position + particle hash, never u_time)
flat out vec3 v_bh;             // ZUR-GH-010: black-hole event horizon (screen px centre xy, radius px z; 0 = off)
flat out float v_axon;          // ZUR-GH-010: 1 = 20% white-matter axon tract, 0 = 80% cortical soma
flat out vec4 v_style;          // non-dart styles: head offset px, head radius px, half length px, half width px

uint hash32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

vec3 paletteAt(uint index) {
  if (index == 0u) return u_palette[0];
  if (index == 1u) return u_palette[1];
  if (index == 2u) return u_palette[2];
  if (index == 3u) return u_palette[3];
  return u_palette[4];
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

void main() {
  uint iid = uint(gl_InstanceID);
  v_local = vec2(0.0);
  v_halfSeg = 0.0;
  v_radius = 1.0;
  v_normal = vec3(0.0, 1.0, 0.0);
  v_view = vec3(0.0, 0.0, 1.0);
  v_seed = 0.0;
  v_neuralPulse = 0.0;
  v_pinned = 0.0;
  v_tint = 0.0;
  v_group = 0.0;
  v_formColor = vec3(0.0);
  v_formMix = 0.0;
  v_hue = 0.0;
  v_axon = 0.0;
  v_bh = vec3(0.0);
  if (u_formationType == 8) {
    vec4 bhClip = u_viewProj * vec4(0.0, 0.0, 0.0, 1.0);
    float bhW = max(bhClip.w, 0.05);
    vec2 bhNdc = bhClip.xy / bhW * u_cameraZoom + vec2(0.0, u_viewportYOffset);
    float bhPx = u_projScale * 0.5 * u_resolution.y / bhW * u_cameraZoom * (0.24 * 3.2 * 1.2); // 1.2x margin hides the sprite edge halo/bloom bleed around the r < 0.24 void
    v_bh = vec3((bhNdc * 0.5 + 0.5) * u_resolution, bhPx);
  }
  v_style = vec4(0.0, 1.0, 1.0, 1.0);
  if (u_visibleThreshold != 0xffffffffu && hash32(iid) >= u_visibleThreshold) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_color = vec3(0.0);
    v_colorAlt = vec3(0.0);
    return;
  }

  vec3 center = a_pos.xyz;
  float seed = a_pos.w;
  vec3 vel = a_vel.xyz;
  // sim.vert.glsl stores phase + 2.6 for a wall-pinned blood drop.
  float pinned = a_vel.w >= 2.0 ? 2.6 : 0.0;
  float phase = a_vel.w - pinned;
  float speed = length(vel);
  v_seed = seed;
  v_pinned = pinned;
  // ZUR-GH-009: synapse firing wave travelling outward through the agent positions.
  float wave = sin(length(a_pos.xyz) * 14.0 - u_time * 9.0 - u_onset * 5.0);
  v_neuralPulse = smoothstep(0.72, 0.98, wave) * clamp(0.45 + u_treble * 0.9 + u_onset * 1.1, 0.0, 1.5);

  vec4 clipCenter = u_viewProj * vec4(center, 1.0);
  float w = max(clipCenter.w, 0.05);
  float pxPerUnit = u_projScale * 0.5 * u_resolution.y / w * u_cameraZoom;
  bool pulse = u_pulseLayout >= 0;
  int band = int(iid % 5u);
  float bandLevel = pulse ? clamp(u_bands[band], 0.0, 1.5) : 0.0;
  // ZUR-GH-009: point-size pulse applies even when Oscillation amount == 0.
  float sizePulse = 1.0 + 0.45 * u_reactivityGain * (u_bass * 0.5 + u_onset * 0.5);
  float worldSize = 0.055 * u_size * u_densityScaleBoost * (0.65 + 0.7 * seed) * (1.0 + 0.45 * bandLevel) * sizePulse;
  // ZUR-GH-010: zoom damps the sprite sub-linearly (1 / zoom^0.35 above 1x) and a hard pixel ceiling bounds it
  // (14 px standard, 28 px blood splatters) so 256k swarms at 3.5x zoom never fuse into a white fireball.
  bool bloodStyle = u_particleStyle == 1 || u_kineticMode == 1;
  float maxRadiusPx = bloodStyle ? 28.0 : 14.0;
  float zoomDamp = u_cameraZoom > 1.0 ? 1.0 / pow(u_cameraZoom, 0.35) : 1.0;
  float radiusPx = min(worldSize * pxPerUnit * zoomDamp, maxRadiusPx);
  worldSize = radiusPx / max(pxPerUnit, 1e-4);
  float floorScale = radiusPx < u_minRadiusPx ? u_minRadiusPx / max(radiusPx, 1e-4) : 1.0;

  uint group = hash32(iid ^ 0x5bd1e995u) % 5u;
  vec3 base = paletteAt(group);
  vec3 accent = paletteAt((group + 2u) % 5u);
  float shimmer = 1.0 + u_high * 0.9 * sin(phase * 43.0 + u_time * 27.0 + seed * 11.0);
  float energy = 0.55 + 0.35 * clamp(speed * 0.25, 0.0, 1.0) + 0.35 * u_rms;
  float depthCue = clamp(1.25 - w * 0.045, 0.35, 1.15);
  float tint = energy * shimmer * depthCue * u_intensity;
  float tintScalar = tint;
  v_group = float(group) * 0.2 + 0.1 * fract(seed * 7.0);
  float hueHash = float(hash32(iid ^ 0x2545f491u) >> 8u) * (1.0 / 16777216.0);
  v_hue = fract(hueHash + dot(center, vec3(0.071, 0.053, 0.087)));
  v_axon = float(hash32(iid ^ 0xb5297a4du) >> 8u) * (1.0 / 16777216.0) < 0.8 ? 0.0 : 1.0;
  if (u_formationType == 8) tintScalar *= max(0.25, 1.0 + 0.65 * normalize(vel + vec3(1e-4)).x); // Doppler beaming
  if (u_formationType == 6) {
    // 80% cortical soma gold / 20% white-matter axon tracts (same split as sim.vert.glsl isCorticalSoma)
    bool soma = float(hash32(iid ^ 0xb5297a4du) >> 8u) * (1.0 / 16777216.0) < 0.8;
    v_formColor = soma ? mix(vec3(1.0, 0.6795, 0.0), vec3(1.0, 0.4508, 0.0), fract(seed * 5.0)) : vec3(1.0, 0.8714, 0.4342);
    v_formMix = 1.0;
  }
  v_color = mix(base, accent, clamp(speed * 0.18, 0.0, 0.6)) * tint;
  v_colorAlt = accent * tint;
  if (pulse) {
    // each band owns one palette color; its level drives the flash
    tintScalar = (0.45 + 2.6 * bandLevel) * depthCue * u_intensity;
    v_group = float(band) * 0.2 + 0.1;
    v_color = mix(paletteAt(uint(band)), paletteAt(uint(band + 2) % 5u), 0.2) * (0.45 + 2.6 * bandLevel) * depthCue * u_intensity;
    v_colorAlt = paletteAt(uint(band + 2) % 5u) * (0.45 + 2.6 * bandLevel) * depthCue * u_intensity;
  }
  if (u_trailType == 1) {
    float flick = float(hash32(iid + uint(u_time * 30.0)) & 255u) * (1.0 / 255.0);
    v_color *= 0.55 + 0.95 * flick;
    v_colorAlt *= 0.55 + 0.95 * flick;
    tintScalar *= 0.55 + 0.95 * flick;
  } else if (u_trailType == 2) {
    float strobe = mix(0.35, 1.7, step(0.5, fract(u_time * (3.0 + 5.0 * u_trailLength) + seed)));
    v_color *= strobe;
    v_colorAlt *= strobe;
    tintScalar *= strobe;
  }
  v_tint = tintScalar;

  if (u_shape == 0 && u_particleStyle == 0) {
    int face = gl_VertexID / 3;
    int corner = gl_VertexID - face * 3;
    mat3 frame = velocityFrame(vel);
    vec3 a = dartVertex(dartIndex(face, 0));
    vec3 b = dartVertex(dartIndex(face, 1));
    vec3 c = dartVertex(dartIndex(face, 2));
    int vertexIndex = dartIndex(face, corner);
    float s = worldSize * 2.2 * floorScale;
    // Same expression for every face sharing this vertex index -> bit-identical shared-edge positions.
    vec3 world = center + frame * (dartVertex(vertexIndex) * s);
    v_normal = normalize(frame * cross(b - a, c - a));
    v_view = normalize(u_camPos - world);
    // glow radius: 0 at the nose, 1 at the base (render.frag.glsl core/halo falloff)
    v_local = vec2(corner == 0 ? 0.0 : 1.0, 0.0);
    gl_Position = u_viewProj * vec4(world, 1.0);
    gl_Position.xy *= u_cameraZoom;
    gl_Position.y += u_viewportYOffset * gl_Position.w;
    return;
  }

  // Velocity-stretched screen-space capsule (4-vertex strip).
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vec4 clipAhead = u_viewProj * vec4(center + vel * 0.05, 1.0);
  vec2 ndc0 = clipCenter.xy / w * u_cameraZoom;
  vec2 ndc1 = clipAhead.xy / max(clipAhead.w, 0.05) * u_cameraZoom;
  vec2 deltaPx = (ndc1 - ndc0) * 0.5 * u_resolution;
  float pixelSpeed = length(deltaPx) / 0.05;
  vec2 dir = length(deltaPx) > 1e-3 ? normalize(deltaPx) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float radius = max(radiusPx, u_minRadiusPx);
  if (u_particleStyle != 0) {
    // ZUR-GH-009 particle styles: one screen-space quad whose shape is drawn per-fragment (render.frag.glsl).
    float areaNorm = clamp((radiusPx * radiusPx) / max(radius * radius, 1e-4), 0.35, 1.0);
    v_tint *= areaNorm;
    float headX = 0.0;
    float centerShift = 0.0;
    float halfL;
    float halfW;
    float headR = radius;
    if (u_particleStyle == 1) {
      // blood-drop: teardrop head + arterial comet tail; a pinned drop is a short fat splat
      bool wallSplat = pinned > 0.5;
      headR = min(radius * (wallSplat ? 2.1 : 1.35), 28.0);
      // pinned drops keep a vertical streak: tail length follows the downward run speed
      float tailPx = u_trailType == 4 ? 0.0
        : headR * (0.8 + clamp(pixelSpeed * 0.045, 0.0, 6.0) * (0.5 + u_trailLength));
      headX = tailPx * 0.5;
      centerShift = -tailPx * 0.5;
      halfL = headR * 1.3 + tailPx * 0.5;
      halfW = headR * 1.3;
    } else if (u_particleStyle == 2) {
      headR = min(radius * 1.2, 14.0);
      halfL = headR * 4.0;
      halfW = halfL;
    } else {
      // star-streak: razor-thin ~1.5 px core, anisotropic velocity-stretched needle, zero halo
      float needleStretch = clamp(speed * 14.0, 1.0, 6.5);
      headR = 1.5;
      halfL = min(radius, 14.0) * 2.0 * needleStretch * clamp(65536.0 / max(u_activeCount, 65536.0), 0.15, 1.0) + 2.0;
      halfW = 2.5 * clamp(pow(65536.0 / max(u_activeCount, 65536.0), 0.3), 0.6, 1.0);
    }
    vec2 styleDir = u_particleStyle == 2 ? vec2(1.0, 0.0) : (pinned > 0.5 ? vec2(0.0, -1.0) : dir);
    vec2 stylePerp = vec2(-styleDir.y, styleDir.x);
    vec2 styleExtent = vec2(halfL, halfW);
    vec2 styleOffset = styleDir * (corner.x * styleExtent.x + centerShift) + stylePerp * corner.y * styleExtent.y;
    v_local = corner * styleExtent;
    v_style = vec4(headX, headR, halfL, halfW);
    vec2 styleNdc = ndc0 + styleOffset * 2.0 / u_resolution + vec2(0.0, u_viewportYOffset);
    gl_Position = vec4(styleNdc * w, clipCenter.z, w);
    return;
  }
  float stretch = 1.0;
  if (u_trailType == 0) stretch = 1.0 + 2.0 * u_trailLength;
  else if (u_trailType == 1) stretch = 1.0 + 1.2 * u_trailLength;
  else if (u_trailType == 3) stretch = 1.0 + 5.0 * u_trailLength;
  else if (u_trailType == 4) stretch = 0.0;
  float halfSeg = min(0.5 * pixelSpeed * u_exposure * stretch, 18.0 * u_size * (1.0 + 2.0 * u_trailLength));
  float glowRadius = radius * 2.4;
  vec2 extent = vec2(halfSeg + glowRadius + 1.0, glowRadius + 1.0);
  vec2 offsetPx = dir * corner.x * extent.x + perp * corner.y * extent.y;
  v_local = corner * extent;
  v_halfSeg = halfSeg;
  v_radius = glowRadius;
  // keep brightness per area roughly constant when the floor enlarges tiny capsules
  v_color *= clamp((radiusPx * radiusPx) / max(radius * radius, 1e-4), 0.35, 1.0);
  gl_Position = vec4((ndc0 + offsetPx * 2.0 / u_resolution) * w, clipCenter.z, w);
  gl_Position.y += u_viewportYOffset * gl_Position.w;
}
