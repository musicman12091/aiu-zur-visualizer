#version 300 es
precision highp float;
precision highp sampler2D;

uniform float u_time;
uniform float u_rms;
uniform vec2 u_resolution;
uniform float u_viewportYOffset;
uniform sampler2D u_waterfallTex;
uniform vec3 u_palette[5];

out vec4 fragColor;

float terrainHeight(vec3 p) {
  float spectrum = texture(u_waterfallTex, vec2(fract(p.x * 0.075 + 0.5), fract(p.z * 0.035 - u_time * 0.025))).r;
  float ridges = sin(p.x * 1.6 + sin(p.z * 0.35)) * 0.16 + cos(p.x * 0.7 - p.z * 0.22) * 0.22;
  return -0.5 + spectrum * 2.4 + ridges;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y -= 0.5 * u_viewportYOffset; // lift terrain with the portrait HUD drawer (matches gl_Position.y += offset)
  vec2 q = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec3 ray = normalize(vec3(q.x, q.y - 0.1, 1.1));
  float pitch = 0.5585053606; // Scene 3 terrain pitch: 32 degrees.
  ray.yz = mat2(cos(pitch), sin(pitch), -sin(pitch), cos(pitch)) * ray.yz; // pitch DOWN onto the terrain
  vec3 origin = vec3(0.0, 2.2, -2.0);
  float travel = 0.0;
  float terrain = -100.0;
  vec3 point = origin;
  for (int i = 0; i < 64; i++) {
    point = origin + ray * travel;
    terrain = point.y - terrainHeight(point);
    if (terrain < 0.025 || travel > 45.0) break;
    travel += max(terrain * 0.28, 0.025);
  }
  if (travel > 45.0 || terrain > 0.08) {
    float sky = smoothstep(-0.2, 0.8, uv.y);
    fragColor = vec4(mix(vec3(0.005, 0.008, 0.025), u_palette[0] * 0.12, sky), 1.0);
    return;
  }
  float dx = terrainHeight(point + vec3(0.03, 0.0, 0.0)) - terrainHeight(point - vec3(0.03, 0.0, 0.0));
  float dz = terrainHeight(point + vec3(0.0, 0.0, 0.03)) - terrainHeight(point - vec3(0.0, 0.0, 0.03));
  vec3 normal = normalize(vec3(-dx, 0.06, -dz));
  float light = 0.25 + 0.75 * max(dot(normal, normalize(vec3(-0.4, 0.8, -0.5))), 0.0);
  float spectrum = texture(u_waterfallTex, vec2(fract(point.x * 0.075 + 0.5), fract(point.z * 0.035 - u_time * 0.025))).r;
  float ridge = clamp(0.5 + 0.5 * normal.y + spectrum * 0.35, 0.0, 1.0);
  int band = int(floor(ridge * 4.0));
  vec3 color = mix(u_palette[band], u_palette[band + 1], fract(ridge * 4.0));
  float fog = exp(-travel * 0.035);
  color *= light * (0.65 + 0.8 * u_rms);
  color = mix(vec3(0.005, 0.008, 0.025), color, fog);
  fragColor = vec4(color, 1.0);
}
