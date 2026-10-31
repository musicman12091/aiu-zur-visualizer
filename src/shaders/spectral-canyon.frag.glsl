#version 300 es
precision highp float;
precision highp sampler2D;

uniform float u_time;
uniform float u_rms;
uniform float u_silent;
uniform vec2 u_resolution;
uniform float u_viewportYOffset;
uniform sampler2D u_waterfallTex;
uniform vec3 u_palette[5];

out vec4 fragColor;

// 64×64 neon wireframe ridge height (obsidian sky + glowing grid).
float terrainHeight(vec3 p) {
  float spectrum = texture(u_waterfallTex, vec2(fract(p.x * 0.075 + 0.5), fract(p.z * 0.035 - u_time * 0.025))).r;
  float idleWave = (0.28 + 0.22 * sin(p.x * 2.15 + u_time * 1.35) * cos(p.z * 1.55 - u_time * 0.95)
    + 0.14 * sin(p.x * 0.85 - p.z * 0.65 + u_time * 0.7)
    + 0.10 * sin(p.z * 3.1 + u_time * 1.8));
  float audioPeaks = spectrum * (1.8 + 2.6 * u_rms);
  float mixH = mix(audioPeaks, idleWave, clamp(u_silent, 0.0, 1.0));
  float ridges = sin(p.x * 1.6 + sin(p.z * 0.35)) * 0.10 + cos(p.x * 0.7 - p.z * 0.22) * 0.12;
  return -0.35 + mixH * 2.2 + ridges;
}

float gridEdge(vec2 xz) {
  // 64 Z-rows × 64 X-columns across the visible canyon floor.
  const float SCALE = 1.65;
  vec2 g = xz * SCALE;
  vec2 f = abs(fract(g) - 0.5);
  float d = min(f.x, f.y);
  float aa = max(fwidth(g.x), fwidth(g.y)) * 1.25;
  return 1.0 - smoothstep(0.0, aa + 0.018, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y -= 0.5 * u_viewportYOffset; // lift terrain with the portrait HUD drawer (matches gl_Position.y += offset)
  vec3 sky = vec3(0.006, 0.008, 0.016);

  // Upper ~35%: hard obsidian sky (luma << 0.05) — never a colored fog wall.
  if (uv.y > 0.65) {
    fragColor = vec4(sky, 1.0);
    return;
  }

  vec2 q = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec3 ray = normalize(vec3(q.x, q.y - 0.12, 1.15));
  float pitch = 0.5585053606; // Scene 3 terrain pitch: 32 degrees.
  ray.yz = mat2(cos(pitch), sin(pitch), -sin(pitch), cos(pitch)) * ray.yz; // pitch DOWN onto the terrain
  vec3 origin = vec3(0.0, 2.05, -2.0);
  float travel = 0.0;
  float terrain = -100.0;
  vec3 point = origin;
  for (int i = 0; i < 72; i++) {
    point = origin + ray * travel;
    terrain = point.y - terrainHeight(point);
    if (terrain < 0.02 || travel > 48.0) break;
    travel += max(terrain * 0.26, 0.02);
  }

  if (travel > 48.0 || terrain > 0.07) {
    float haze = smoothstep(0.62, 0.38, uv.y) * 0.04;
    fragColor = vec4(sky + u_palette[0] * haze, 1.0);
    return;
  }

  float spectrum = texture(u_waterfallTex, vec2(fract(point.x * 0.075 + 0.5), fract(point.z * 0.035 - u_time * 0.025))).r;
  float edge = gridEdge(point.xz);
  float heightGlow = clamp(0.15 + spectrum * 0.55 + (1.0 - u_silent) * u_rms * 0.5 + u_silent * 0.25, 0.0, 1.0);
  int band = int(floor(heightGlow * 4.0));
  vec3 neon = mix(u_palette[band], u_palette[min(band + 1, 4)], fract(heightGlow * 4.0));
  neon = max(neon, vec3(0.15, 0.55, 0.95)); // guarantee readable neon peaks even on dark palettes

  float fog = exp(-travel * 0.032);
  // Wireframe: bright grid lines + faint ridge fill; dark between cells.
  float lineBoost = 0.55 + 1.85 * edge + 0.9 * edge * heightGlow;
  vec3 color = mix(sky, neon * lineBoost, fog * max(edge, 0.08 * heightGlow));
  // Peak tips pop when audio (or idle wave) lifts the ridge.
  color += neon * edge * heightGlow * (0.35 + 0.65 * max(u_rms, u_silent * 0.45)) * fog;
  fragColor = vec4(color, 1.0);
}
