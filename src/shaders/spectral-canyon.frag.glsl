#version 300 es
// ZUR-GH-007 — Spectral Canyon 3D rewrite: clean raycast synthwave canyon floor + twin canyon walls.
// z scrolls with u_time * 2.5, x-frequency ridges are displaced by u_waterfallTex + multi-band audio
// height, every colour comes strictly from u_palette[0..4] (sRGB-encoded, luma-capped: zero white blowouts).
precision highp float;
precision highp sampler2D;

uniform float u_time;
uniform float u_rms;
uniform float u_silent;
uniform vec2 u_resolution;
uniform float u_viewportYOffset;
uniform sampler2D u_waterfallTex;
uniform vec3 u_palette[5];
uniform float u_bands[5]; // sub, bass, lowMid, highMid, treble

out vec4 fragColor;

const float SCROLL_SPEED = 2.5;      // z scroll = u_time * 2.5
const float CANYON_HALF_WIDTH = 1.5; // flat floor half-width before the twin walls rise
const float WALL_RAMP = 2.4;
const float WALL_HEIGHT = 3.1;
const float GRID_SPACING = 0.5;      // world units between grid lines on floor + walls
const float HORIZON_UV = 0.62;       // horizon row in (offset-corrected) uv
const float FOV = 1.15;
const float EYE_HEIGHT = 1.2;
const float MAX_TRAVEL = 42.0;
const float LUMA_CAP = 0.86;

float spectrumAt(float x, float zs) {
  return texture(u_waterfallTex, vec2(fract(x * 0.065 + 0.5), fract(zs * 0.018))).r;
}

// Multi-band audio height: |x| sweeps sub (canyon centre) -> treble (wall crests).
float bandHeight(float x) {
  float ax = clamp(abs(x) / (CANYON_HALF_WIDTH + WALL_RAMP), 0.0, 1.0) * 4.0;
  int b = int(floor(ax));
  int b1 = min(b + 1, 4);
  return mix(clamp(u_bands[min(b, 4)], 0.0, 1.5), clamp(u_bands[b1], 0.0, 1.5), fract(ax));
}

// Gentle idle baseline so the canyon breathes with no capture running.
float idleWave(float x, float zs) {
  return 0.35 + 0.22 * sin(x * 2.1 + u_time * 1.3) * cos(zs * 0.45 - u_time * 0.9)
    + 0.12 * sin(x * 0.8 - zs * 0.3 + u_time * 0.7);
}

float wallMask(float x) {
  float w = smoothstep(CANYON_HALF_WIDTH, CANYON_HALF_WIDTH + WALL_RAMP, abs(x));
  return w * w * (1.6 - 0.6 * w);
}

// Height field: floor ridges (x frequency) + twin walls, displaced by waterfall + band energy.
float canyonHeight(float x, float zs, out float audio) {
  float live = spectrumAt(x, zs) * (0.7 + 0.9 * u_rms) + 0.45 * bandHeight(x);
  audio = clamp(mix(live, idleWave(x, zs), clamp(u_silent, 0.0, 1.0)), 0.0, 1.6);
  float ridges = 0.16 * sin(x * 2.4 + 1.2 * sin(zs * 0.33)) + 0.10 * cos(x * 1.15 - zs * 0.52);
  float wall = wallMask(x);
  float floorH = ridges * (1.0 - wall) + audio * 0.32 * (1.0 - 0.6 * wall);
  return floorH + wall * (WALL_HEIGHT + 0.9 * audio + 1.6 * ridges);
}

float gridLine(float coord, float footprint) {
  float g = coord / GRID_SPACING;
  float d = abs(fract(g) - 0.5) * 2.0; // 1 on the line, 0 mid-cell (inverted below)
  float w = max(footprint / GRID_SPACING, 1e-4);
  float line = 1.0 - smoothstep(0.0, w * 1.6 + 0.04, 1.0 - d);
  // fade lines once they shrink below a pixel -> no moire / white sticks near the horizon
  return line * (1.0 - smoothstep(0.35, 0.7, w));
}

vec3 paletteRamp(float t) {
  float x = clamp(t, 0.0, 0.999) * 4.0;
  int i = int(floor(x));
  return mix(u_palette[i], u_palette[min(i + 1, 4)], fract(x));
}

vec3 linearToSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// No white blowouts: drop the shared grey, then cap perceived luma.
vec3 guardNeon(vec3 c) {
  c = max(c, vec3(0.0));
  c -= vec3(min(c.r, min(c.g, c.b))) * 0.35;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return c * min(1.0, LUMA_CAP / max(luma, 1e-4));
}

vec3 skyColor(vec2 q, vec3 ray) {
  float up = clamp(q.y / 0.34, 0.0, 1.0); // fades to obsidian ~0.3 above the horizon (dark even with HUD open)
  vec3 horizon = u_palette[1] * 0.42;
  vec3 mid = u_palette[2] * 0.16;
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.35, up));
  col = mix(col, vec3(0.0), smoothstep(0.35, 0.9, up)); // obsidian zenith
  // striped synthwave sun sitting on the horizon (palette 3 -> 4), never white
  vec2 sunP = vec2(q.x, q.y - 0.07);
  float sunR = length(sunP);
  float stripes = step(0.42, fract(q.y * 38.0 - u_time * 0.35)) + step(0.08, q.y - 0.02);
  float disc = (1.0 - smoothstep(0.118, 0.126, sunR)) * clamp(stripes, 0.0, 1.0);
  vec3 sun = mix(u_palette[3], u_palette[4], clamp(q.y / 0.19, 0.0, 1.0)) * 0.75;
  col = mix(col, sun, disc);
  col += u_palette[4] * 0.10 * exp(-sunR * 6.0);
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y -= 0.5 * u_viewportYOffset; // lift the canyon with the portrait HUD drawer (matches gl_Position.y += offset)
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - HORIZON_UV);
  vec3 ray = normalize(vec3(q.x * FOV, q.y * FOV, 1.0));
  vec3 origin = vec3(0.0, EYE_HEIGHT, 0.0);
  float zScroll = u_time * SCROLL_SPEED;

  // Raycast the height field (relaxed steps + bisection refine).
  float travel = 0.05;
  float prevTravel = travel;
  float audio = 0.0;
  bool hit = false;
  for (int i = 0; i < 88; i++) {
    vec3 p = origin + ray * travel;
    float h = canyonHeight(p.x, p.z + zScroll, audio);
    float d = p.y - h;
    if (d < 0.002) { hit = true; break; }
    if (travel > MAX_TRAVEL) break;
    prevTravel = travel;
    travel += max(d * 0.38, 0.012 + travel * 0.006);
  }
  if (hit) {
    float a = prevTravel;
    float b = travel;
    for (int j = 0; j < 5; j++) {
      float m = 0.5 * (a + b);
      vec3 p = origin + ray * m;
      if (p.y - canyonHeight(p.x, p.z + zScroll, audio) < 0.0) b = m; else a = m;
    }
    travel = b;
  }

  vec3 sky = skyColor(q, ray);
  if (!hit) {
    fragColor = vec4(linearToSRGB(guardNeon(sky)), 1.0);
    return;
  }

  vec3 p = origin + ray * travel;
  float zs = p.z + zScroll;
  float h = canyonHeight(p.x, zs, audio);
  float e = 0.03;
  float dummy;
  vec3 n = normalize(vec3(
    canyonHeight(p.x - e, zs, dummy) - canyonHeight(p.x + e, zs, dummy),
    2.0 * e,
    canyonHeight(p.x, zs - e, dummy) - canyonHeight(p.x, zs + e, dummy)
  ));
  float wall = wallMask(p.x);
  float diffuse = clamp(dot(n, normalize(vec3(0.0, 0.75, -0.65))) * 0.5 + 0.5, 0.0, 1.0);

  // Grid on floor (x, z) and walls (z verticals + height contours), anti-aliased by pixel footprint.
  float footprint = travel * FOV / max(u_resolution.y, 1.0) * 1.6;
  float slope = 1.0 - n.y;
  float lineX = gridLine(p.x, footprint / max(abs(n.y), 0.25));
  float lineZ = gridLine(zs, footprint / max(abs(ray.y) + abs(n.z) * 0.5 + 0.02, 0.06));
  float lineH = gridLine(h * 1.0, footprint * 1.2) * smoothstep(0.25, 0.6, slope);
  float edge = clamp(max(max(lineX * (1.0 - 0.7 * slope), lineZ), lineH), 0.0, 1.0);

  float heightN = clamp(h / (WALL_HEIGHT + 1.2), 0.0, 1.0);
  vec3 fill = paletteRamp(0.15 + 0.55 * heightN + 0.2 * clamp(audio, 0.0, 1.0)) * (0.10 + 0.20 * diffuse + 0.10 * wall);
  vec3 line = mix(u_palette[0], u_palette[4], clamp(heightN * 1.4 + 0.25 * audio, 0.0, 1.0));
  line *= 0.55 + 0.30 * clamp(audio, 0.0, 1.2);
  vec3 color = mix(fill, line, edge);

  float fog = 1.0 - exp(-travel * 0.055);
  color = mix(color, u_palette[1] * 0.32, fog * 0.85);
  fragColor = vec4(linearToSRGB(guardNeon(color)), 1.0);
}
