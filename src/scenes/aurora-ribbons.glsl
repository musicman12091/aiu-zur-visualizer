vec3 paletteAt(int index) {
  if (index == 0) return u_palette[0];
  if (index == 1) return u_palette[1];
  if (index == 2) return u_palette[2];
  if (index == 3) return u_palette[3];
  return u_palette[4];
}

vec3 renderScene(vec2 uv) {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 p = (uv - 0.5) * aspect;
  float tier = clamp(u_complexity, 0.25, 1.0);
  float ribbonCount = mix(3.0, 5.0, tier);
  float width = 0.05 + u_bass * u_gain * 0.18 + u_sub * 0.05;
  float curve = 0.7 + u_mid * 2.0;
  float drift = u_time * 0.32;
  vec3 color = paletteAt(0) * (0.025 + u_rms * 0.04);

  for (int i = 0; i < 5; i++) {
    if (float(i) >= ribbonCount) break;
    float fi = float(i);
    float y = sin(p.x * curve + drift + fi * 1.7) * (0.15 + u_sub * 0.22);
    y += sin(p.x * curve * 0.45 - drift * 0.7 + fi) * (0.04 + u_mid * 0.1);
    y += (fi - 2.0) * 0.12;
    float d = abs(p.y - y);
    float body = smoothstep(width, width * 0.2, d);
    float core = smoothstep(width * 0.28, 0.0, d);
    float spark = exp(-d * d * (90.0 - u_high * 40.0)) * u_high;
    vec3 ink = paletteAt(i);
    color += ink * body * (0.32 + u_rms * 0.85);
    color += ink * core * (0.2 + u_onset * 0.75);
    color += mix(ink, paletteAt(4), 0.55) * spark * (0.35 + u_onset);
  }

  color *= smoothstep(1.2, 0.2, length(p));
  return color;
}
