#version 300 es
// ZUR Stage 3 — Pass 2: aspect-correct polar N-fold mirror kaleidoscope,
// chroma-preserving tone map (hue survives bright cores), single sRGB encode.
precision highp float;
precision highp sampler2D;

uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform float u_kaleidoSegments;  // 0 or 1 = off (1:1 bypass), 4, 6, 8, 12, 16
uniform float u_kaleidoAngle;     // beat-synced rotation (radians)
uniform float u_kaleidoZoom;
uniform float u_exposure;
uniform float u_blackFloor;     // RGBA8 fallback: removes 8-bit trail residue

in vec2 v_uv;
out vec4 fragColor;

vec2 kaleidoFold(vec2 uv) {
  if (u_kaleidoSegments <= 1.0) return uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(p) / max(u_kaleidoZoom, 0.25);
  float wedge = 6.28318530718 / u_kaleidoSegments;
  float a = atan(p.y, p.x) + u_kaleidoAngle;
  a -= wedge * floor(a / wedge);
  a = abs(a - wedge * 0.5);
  return vec2(cos(a) * r / aspect, sin(a) * r) + 0.5;
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
  vec2 uv = kaleidoFold(v_uv);
  vec3 scene = texture(u_scene, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  scene = max(scene - vec3(u_blackFloor), vec3(0.0));
  fragColor = vec4(linearToSRGB(toneMap(max(scene, vec3(0.0)) * u_exposure)), 1.0);
}
