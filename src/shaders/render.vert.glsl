#version 300 es
// ZUR Stage 3 — instanced 3D darts / velocity capsules built from gl_VertexID.
// Per-instance state (divisor = 1): a_pos = xyz + size/seed, a_vel = xyz + phase/life.
precision highp float;
precision highp int;

layout(location = 0) in vec4 a_pos;
layout(location = 1) in vec4 a_vel;

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

out vec3 v_color;
out vec3 v_colorAlt;            // secondary palette color for the dart rim (chromatic, never white)
out vec2 v_local;               // capsule: pixel coords along/perp velocity
flat out float v_halfSeg;
flat out float v_radius;
flat out vec3 v_normal;
out vec3 v_view;

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
  if (u_visibleThreshold != 0xffffffffu && hash32(iid) >= u_visibleThreshold) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_color = vec3(0.0);
    v_colorAlt = vec3(0.0);
    return;
  }

  vec3 center = a_pos.xyz;
  float seed = a_pos.w;
  vec3 vel = a_vel.xyz;
  float phase = a_vel.w;
  float speed = length(vel);

  vec4 clipCenter = u_viewProj * vec4(center, 1.0);
  float w = max(clipCenter.w, 0.05);
  float pxPerUnit = u_projScale * 0.5 * u_resolution.y / w;
  bool pulse = u_pulseLayout >= 0;
  int band = int(iid % 5u);
  float bandLevel = pulse ? clamp(u_bands[band], 0.0, 1.5) : 0.0;
  float worldSize = 0.055 * u_size * u_densityScaleBoost * (0.65 + 0.7 * seed) * (1.0 + 0.45 * bandLevel);
  float radiusPx = worldSize * pxPerUnit;
  float floorScale = radiusPx < u_minRadiusPx ? u_minRadiusPx / max(radiusPx, 1e-4) : 1.0;

  uint group = hash32(iid ^ 0x5bd1e995u) % 5u;
  vec3 base = paletteAt(group);
  vec3 accent = paletteAt((group + 2u) % 5u);
  float shimmer = 1.0 + u_high * 0.9 * sin(phase * 43.0 + u_time * 27.0 + seed * 11.0);
  float energy = 0.55 + 0.35 * clamp(speed * 0.25, 0.0, 1.0) + 0.35 * u_rms;
  float depthCue = clamp(1.25 - w * 0.045, 0.35, 1.15);
  float tint = energy * shimmer * depthCue * u_intensity;
  v_color = mix(base, accent, clamp(speed * 0.18, 0.0, 0.6)) * tint;
  v_colorAlt = accent * tint;
  if (pulse) {
    // each band owns one palette color; its level drives the flash
    v_color = mix(paletteAt(uint(band)), paletteAt(uint(band + 2) % 5u), 0.2) * (0.45 + 2.6 * bandLevel) * depthCue * u_intensity;
    v_colorAlt = paletteAt(uint(band + 2) % 5u) * (0.45 + 2.6 * bandLevel) * depthCue * u_intensity;
  }
  if (u_trailType == 1) {
    float flick = float(hash32(iid + uint(u_time * 30.0)) & 255u) * (1.0 / 255.0);
    v_color *= 0.55 + 0.95 * flick;
    v_colorAlt *= 0.55 + 0.95 * flick;
  } else if (u_trailType == 2) {
    float strobe = mix(0.35, 1.7, step(0.5, fract(u_time * (3.0 + 5.0 * u_trailLength) + seed)));
    v_color *= strobe;
    v_colorAlt *= strobe;
  }

  if (u_shape == 0) {
    int face = gl_VertexID / 3;
    int corner = gl_VertexID - face * 3;
    mat3 frame = velocityFrame(vel);
    vec3 a = dartVertex(dartIndex(face, 0));
    vec3 b = dartVertex(dartIndex(face, 1));
    vec3 c = dartVertex(dartIndex(face, 2));
    vec3 local = dartVertex(dartIndex(face, corner));
    float s = worldSize * 2.2 * floorScale;
    vec3 world = center + frame * (local * s);
    v_normal = normalize(frame * cross(b - a, c - a));
    v_view = normalize(u_camPos - world);
    // glow radius: 0 at the nose, 1 at the base (render.frag.glsl core/halo falloff)
    v_local = vec2(corner == 0 ? 0.0 : 1.0, 0.0);
    gl_Position = u_viewProj * vec4(world, 1.0);
    gl_Position.y += u_viewportYOffset * gl_Position.w;
    return;
  }

  // Velocity-stretched screen-space capsule (4-vertex strip).
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vec4 clipAhead = u_viewProj * vec4(center + vel * 0.05, 1.0);
  vec2 ndc0 = clipCenter.xy / w;
  vec2 ndc1 = clipAhead.xy / max(clipAhead.w, 0.05);
  vec2 deltaPx = (ndc1 - ndc0) * 0.5 * u_resolution;
  float pixelSpeed = length(deltaPx) / 0.05;
  vec2 dir = length(deltaPx) > 1e-3 ? normalize(deltaPx) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float radius = max(radiusPx, u_minRadiusPx);
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
