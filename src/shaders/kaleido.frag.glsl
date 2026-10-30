#version 300 es
// ZUR Stage 3.2 — Pass 2: aspect-correct polar N-fold mirror kaleidoscope (mirrored radius fold +
// outer vignette, so FBO border pixels never smear into corner rays), chroma-preserving tone map,
// single sRGB encode.
precision highp float;
precision highp sampler2D;

uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_kaleidoSegments;  // 0 or 1 = off (1:1 bypass), 4, 6, 8, 12, 16
uniform float u_kaleidoAngle;     // beat-synced rotation (radians)
uniform float u_kaleidoZoom;
uniform float u_exposure;
uniform float u_blackFloor;     // RGBA8 fallback: removes 8-bit trail residue
uniform float u_viewportYOffset; // NDC lift of the swarm (portrait HUD drawer); the mirror centre follows it

in vec2 v_uv;
out vec4 fragColor;

// Triangle-wave mirror repeat: coordinates past the FBO edge reflect back instead of clamping.
vec2 mirrorRepeat(vec2 uv) {
  return 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
}

vec2 kaleidoFold(vec2 uv, out float vignette) {
  vignette = 1.0;
  if (u_kaleidoSegments <= 1.0) return uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 center = vec2(0.5, 0.5 + 0.5 * u_viewportYOffset);
  vec2 p = (uv - center) * vec2(aspect, 1.0);
  float rawRadius = length(p) / max(u_kaleidoZoom, 0.25);
  vignette = smoothstep(1.12, 0.82, rawRadius);
  float r = 1.0 - abs(fract(rawRadius * 0.5) * 2.0 - 1.0);
  float wedge = 6.28318530718 / u_kaleidoSegments;
  float a = atan(p.y, p.x) + u_kaleidoAngle;
  a -= wedge * floor(a / wedge);
  a = abs(a - wedge * 0.5);
  return mirrorRepeat(vec2(cos(a) * r / aspect, sin(a) * r) + center);
}

// Tone-map the peak channel only so saturated neon stays saturated; very hot pixels bleed to white.
vec3 toneMap(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  vec3 chroma = c / max(peak, 1e-4);
  float mappedPeak = peak / (1.0 + 0.65 * peak);
  return mix(chroma * mappedPeak, vec3(1.0), smoothstep(1.1, 3.2, peak) * 0.65);
}

vec3 linearToSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  float vignette;
  vec2 uv = kaleidoFold(v_uv, vignette);
  vec3 scene = texture(u_scene, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  scene = max(scene - vec3(u_blackFloor), vec3(0.0)) * vignette;
  // Strip the shared grey component so overlapping cyan + magenta stays electric instead of washing to silver.
  scene -= vec3(min(scene.r, min(scene.g, scene.b))) * 0.7;
  fragColor = vec4(linearToSRGB(toneMap(max(scene, vec3(0.0)) * u_exposure)), 1.0);
}
