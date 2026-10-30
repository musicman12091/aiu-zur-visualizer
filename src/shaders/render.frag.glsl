#version 300 es
// ZUR Stage 3.2 — chromatic neon sprites: 100% saturated palette halo, white only as a tiny pinprick core.
// Dart pass is additive (ONE, ONE); capsule pass is premultiplied (ONE, ONE_MINUS_SRC_ALPHA).
precision highp float;
precision highp int;

uniform int u_shape;
uniform float u_radianceScale;
uniform float u_particleSize;   // user multiplier 0.5x – 4.0x
uniform float u_activeCount;    // live agent count (16k / 64k crowds)
uniform vec3 u_lightDir;
uniform vec3 u_rimColor;

in vec3 v_color;
in vec3 v_colorAlt;
in vec2 v_local;
flat in float v_halfSeg;
flat in float v_radius;   // capsule: glow radius in pixels (v_local reaches it at the quad edge)
flat in vec3 v_normal;
in vec3 v_view;

out vec4 fragColor;

void main() {
  // Bounded radiance: big sprites in dense swarms never stack into solid white fireballs.
  float crowdNorm = 1.0 / (1.0 + 0.32 * u_particleSize * u_particleSize * sqrt(max(u_activeCount, 64.0) / 1024.0));
  if (u_shape == 0) {
    vec3 n = normalize(v_normal);
    vec3 v = normalize(v_view);
    float facing = abs(dot(n, v));
    float normalShade = abs(dot(n, u_lightDir));
    float rim = pow(1.0 - facing, 2.5);
    float r2 = v_local.x * v_local.x;
    float core = exp(-r2 * 42.0) * 0.30;
    float halo = exp(-r2 * 4.5);
    vec3 paletteColor = v_color;
    vec3 paletteColorSecondary = mix(v_colorAlt, u_rimColor * length(v_color), 0.5);
    vec3 dartColor = paletteColor * (0.45 + 0.85 * normalShade) + paletteColorSecondary * (0.65 * rim);
    vec3 hot = mix(v_color, vec3(1.0), 0.25) * core;
    fragColor = vec4((dartColor * (0.4 + 0.6 * halo) + hot) * u_radianceScale * 4.0 * sqrt(crowdNorm), 1.0);
    return;
  }
  vec2 q = vec2(max(abs(v_local.x) - v_halfSeg, 0.0), v_local.y);
  float r2 = dot(q, q) / max(v_radius * v_radius, 1e-4);
  if (r2 >= 1.0) discard;
  float core = exp(-r2 * 42.0) * 0.30;
  float halo = exp(-r2 * 4.5);
  vec3 hot = mix(v_color, vec3(1.0), 0.25) * core;
  vec3 color = v_color * halo * 1.1 + hot;
  float capsuleAlpha = 0.40 * crowdNorm;
  // Premultiplied: colour scales with the same bounded alpha so big sprites in 16k-64k crowds never stack to solid white.
  fragColor = vec4(color * u_radianceScale * 12.0 * capsuleAlpha, min(halo, 1.0) * capsuleAlpha);
}
