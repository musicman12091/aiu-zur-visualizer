#version 300 es
// ZUR Stage 2 — crisp rim-lit darts and analytic-SDF capsules (premultiplied additive).
precision highp float;
precision highp int;

uniform int u_shape;
uniform float u_radianceScale;
uniform vec3 u_lightDir;
uniform vec3 u_rimColor;

in vec3 v_color;
in vec2 v_local;
flat in float v_halfSeg;
flat in float v_radius;
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
    vec3 color = v_color * (0.35 + 0.75 * diffuse) + u_rimColor * rim * (0.6 + length(v_color));
    fragColor = vec4(color * u_radianceScale, 1.0);
    return;
  }
  vec2 q = vec2(max(abs(v_local.x) - v_halfSeg, 0.0), v_local.y);
  float d = length(q) - v_radius;
  float aa = max(fwidth(d), 1e-3);
  float coverage = clamp(0.5 - d / aa, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  float core = 1.0 - smoothstep(0.0, v_radius, length(q));
  vec3 color = v_color * (0.55 + 0.9 * core);
  fragColor = vec4(color * coverage * u_radianceScale, coverage);
}
