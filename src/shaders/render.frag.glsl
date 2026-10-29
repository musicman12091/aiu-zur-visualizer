#version 300 es
// ZUR Stage 3 — neon comet sprites: white-hot core + saturated neon halo (premultiplied additive).
precision highp float;
precision highp int;

uniform int u_shape;
uniform float u_radianceScale;
uniform vec3 u_lightDir;
uniform vec3 u_rimColor;

in vec3 v_color;
in vec2 v_local;
flat in float v_halfSeg;
flat in float v_radius;   // capsule: glow radius in pixels (v_local reaches it at the quad edge)
flat in vec3 v_normal;
in vec3 v_view;

out vec4 fragColor;

void main() {
  if (u_shape == 0) {
    vec3 n = normalize(v_normal);
    vec3 v = normalize(v_view);
    float facing = abs(dot(n, v));
    float diffuse = abs(dot(n, u_lightDir));
    float rim = pow(1.0 - facing, 2.5);
    float r2 = v_local.x * v_local.x;
    float core = exp(-r2 * 22.0);
    float halo = exp(-r2 * 4.5);
    vec3 lit = v_color * (0.35 + 0.75 * diffuse) + u_rimColor * rim * (0.6 + length(v_color));
    vec3 hot = mix(v_color, vec3(1.0), 0.85) * core * 1.4;
    fragColor = vec4((lit * (0.4 + 0.6 * halo) + hot) * u_radianceScale, 1.0);
    return;
  }
  vec2 q = vec2(max(abs(v_local.x) - v_halfSeg, 0.0), v_local.y);
  float r2 = dot(q, q) / max(v_radius * v_radius, 1e-4);
  if (r2 >= 1.0) discard;
  float core = exp(-r2 * 22.0);
  float halo = exp(-r2 * 4.5);
  vec3 hot = mix(v_color, vec3(1.0), 0.8) * core * 1.8;
  vec3 color = (v_color * halo * 1.1 + hot) * 0.3;
  fragColor = vec4(color * u_radianceScale, min(halo, 1.0));
}
