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
uniform float u_chromaticAberration; // 0..1, three radial RGB samples
uniform float u_godRays; // 0..1, six additive radial samples
uniform vec3 u_paletteHue; // ZUR-GH-008: dominant palette colour (u_palette[0]) for the high-luma chroma floor
uniform float u_coreSpecular; // ZUR-GH-008: 1 in megastructure-3d (raymarched core keeps its white specular), else 0

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

// ZUR-GH-008: chroma-preserving peak tone map. Only the peak channel is compressed (hue and channel ratios
// survive) and particle scenes never bleed to white (the white shoulder is kept only for the megastructure core).
vec3 toneMap(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  if (peak <= 1e-5) return vec3(0.0);
  vec3 chroma = c / max(peak, 1e-4);
  float mappedPeak = peak / (1.0 + 0.65 * peak);
  // Megastructure only: the raymarched ferrofluid core keeps its hot specular bleed (ZUR-GH-006/007 look).
  return mix(chroma * min(mappedPeak, 1.0), vec3(1.0), smoothstep(1.1, 3.2, peak) * 0.65 * u_coreSpecular);
}

// ZUR-GH-008 high-luma chroma floor (display space): once the peak passes 0.65, pull desaturated channels back
// toward the dominant hue (the pixel's own, or the palette's when it is grey) so HSV saturation stays >= 0.55.
const float CHROMA_FLOOR_PEAK = 0.65;
const float CHROMA_FLOOR_SAT = 0.6;
vec3 chromaFloor(vec3 s) {
  float peak = max(s.r, max(s.g, s.b));
  float low = min(s.r, min(s.g, s.b));
  float w = smoothstep(CHROMA_FLOOR_PEAK - 0.12, CHROMA_FLOOR_PEAK, peak) * (1.0 - u_coreSpecular);
  if (w <= 0.0 || peak <= 1e-4) return s;
  float sat = (peak - low) / peak;
  if (sat >= CHROMA_FLOOR_SAT) return s;
  vec3 hue = (s - low) / max(peak - low, 1e-4);
  vec3 ph = max(u_paletteHue, vec3(0.0));
  float pMax = max(ph.r, max(ph.g, ph.b));
  float pMin = min(ph.r, min(ph.g, ph.b));
  vec3 paletteHue = pMax - pMin > 1e-3 ? (ph - pMin) / (pMax - pMin) : vec3(1.0, 0.0, 1.0);
  hue = mix(paletteHue, hue, smoothstep(0.02, 0.15, sat));
  vec3 floored = peak * (1.0 - CHROMA_FLOOR_SAT + CHROMA_FLOOR_SAT * hue);
  return mix(s, floored, w);
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
  vec2 radial = uv - vec2(0.5, 0.5 + 0.5 * u_viewportYOffset);
  vec2 split = normalize(radial + vec2(1e-5)) * (0.004 * u_chromaticAberration);
  vec3 scene = vec3(
    texture(u_scene, clamp(uv + split, vec2(0.0), vec2(1.0))).r,
    texture(u_scene, clamp(uv, vec2(0.0), vec2(1.0))).g,
    texture(u_scene, clamp(uv - split, vec2(0.0), vec2(1.0))).b
  );
  vec3 rays = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float stepAmount = (float(i) + 1.0) / 6.0;
    rays += texture(u_scene, clamp(uv - radial * stepAmount * 0.12, vec2(0.0), vec2(1.0))).rgb;
  }
  scene += rays * (u_godRays / 6.0) * 0.35;
  scene = max(scene - vec3(u_blackFloor), vec3(0.0)) * vignette;
  // Strip the shared grey component so overlapping cyan + magenta stays electric instead of washing to silver.
  scene -= vec3(min(scene.r, min(scene.g, scene.b))) * 0.7;
  fragColor = vec4(chromaFloor(linearToSRGB(toneMap(max(scene, vec3(0.0)) * u_exposure))), 1.0);
}
