#version 300 es
// ZUR Stage 3.2 — chromatic neon sprites: 100% saturated palette halo, white only as a tiny pinprick core.
// Dart pass is additive (ONE, ONE); capsule pass is premultiplied (ONE, ONE_MINUS_SRC_ALPHA).
precision highp float;
precision highp int;

uniform int u_shape;
uniform float u_radianceScale;
uniform float u_particleSize;   // user multiplier 0.5x – 4.0x
uniform float u_activeCount;    // live agent count (16k / 64k crowds)
uniform float u_trailEnergyNorm; // ZUR-GH-008: clamp((1 - keepFactor) / (1 - 0.55), 0.18, 1.0)
uniform vec3 u_lightDir;
uniform vec3 u_rimColor;

in vec3 v_color;
in vec3 v_colorAlt;
in vec2 v_local;
flat in float v_halfSeg;
flat in float v_radius;   // capsule: glow radius in pixels (v_local reaches it at the quad edge)
flat in vec3 v_normal;
in vec3 v_view;
in float v_neuralPulse;   // ZUR-GH-009: dedicated synapse firing varying from render.vert.glsl
flat in float v_seed;
flat in float v_pinned;
flat in float v_tint;
flat in float v_group;
flat in vec3 v_formColor;
flat in float v_formMix;
flat in vec4 v_style;

uniform int u_particleStyle;     // 0 dart3d, 1 blood-drop, 2 synapse-spark, 3 star-streak
uniform int u_colorPalette;      // 0 true-neon, 1 full-spectrum, 2 white-static, 3 blood-red
uniform float u_time;
uniform float u_treble;
uniform float u_bass;
uniform float u_onset;
uniform float u_spectralCentroid;

out vec4 fragColor;

// Hex constants below are converted to linear light (the rest of the pipeline is linear before the tone map).
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Returns the un-tinted palette colour (peak channel ~1) for this fragment's agent.
vec3 palettePick(float rim) {
  if (u_colorPalette == 1) {
    // full-spectrum rainbow, 0.95 saturation
    return hsv2rgb(vec3(fract(v_seed * 0.618 + u_time * 0.12 + u_spectralCentroid * 0.5), 0.95, 1.0));
  }
  if (u_colorPalette == 2) {
    // white-static: #FFFFFF core, #D8ECFF rim; flicker is a mild gate so it never clips
    float flick = step(0.35, fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_time * 43.0) * 43758.5453)) * u_treble;
    vec3 c = mix(vec3(1.0), vec3(0.6867, 0.8388, 1.0), clamp(rim, 0.0, 1.0));
    return c * (0.55 + 0.45 * flick);
  }
  if (u_colorPalette == 3) {
    // blood-red #2B0005 -> #D90416 -> #FF2A38, ruby flash on beat/onset
    float t = clamp(0.35 + 0.65 * fract(v_seed * 3.7) + 0.5 * u_onset, 0.0, 1.0);
    vec3 c = t < 0.5 ? mix(vec3(0.0242, 0.0, 0.0015), vec3(0.6939, 0.0012, 0.0080), t * 2.0)
                     : mix(vec3(0.6939, 0.0012, 0.0080), vec3(1.0, 0.0232, 0.0395), t * 2.0 - 1.0);
    return c * (1.0 + 0.8 * clamp(u_bass * 0.6 + u_onset, 0.0, 1.0));
  }
  // true-neon: #00F5FF #FF007F #00FF66 #8A2BE2 with a saturation floor >= 0.85 (no pastel blend)
  float g = fract(v_group + v_seed * 0.13) * 4.0;
  vec3 c = g < 1.0 ? vec3(0.0, 0.9131, 1.0) : g < 2.0 ? vec3(1.0, 0.0, 0.2122) : g < 3.0 ? vec3(0.0, 1.0, 0.1329) : vec3(0.2542, 0.0242, 0.7605);
  if (v_formMix > 0.5) c = v_formColor;
  return c;
}


void main() {
  // Bounded radiance: big sprites in dense swarms never stack into solid white fireballs.
  float crowdNorm = 1.0 / (1.0 + 0.32 * u_particleSize * u_particleSize * sqrt(max(u_activeCount, 64.0) / 1024.0));
  // ZUR-GH-008: steady-state trail energy normalisation + big-sprite core scaling (3.35x no longer blows out).
  float sizeNorm = u_particleSize > 1.5 ? 1.0 / pow(max(u_particleSize, 1.0), 0.65) : 1.0;
  float energyNorm = clamp(u_trailEnergyNorm, 0.18, 1.0);
  if (u_particleStyle != 0) {
    float headR = max(v_style.y, 1.0);
    vec2 p = v_local;
    vec3 base = palettePick(0.0);
    float lum = v_tint * u_radianceScale * sqrt(crowdNorm) * energyNorm;
    vec3 outC = vec3(0.0);
    float alpha = 0.0;
    if (u_particleStyle == 1) {
      // blood-drop: teardrop SDF head (+x is the travel direction) with an arterial comet streak behind it
      vec2 uv = (p - vec2(v_style.x, 0.0)) / headR;
      float splat = 0.0;
      if (v_pinned > 0.5) {
        // wall splat: multi-lobe radial distortion
        float lobes = 0.55 + 0.45 * sin(atan(uv.y, uv.x) * 7.0 + v_seed * 19.0);
        uv /= max(lobes, 0.2);
        splat = 1.0;
      }
      float d = length(vec2(uv.x * (1.0 + 0.65 * uv.y), uv.y));
      float head = 1.0 - smoothstep(0.7, 1.0, d);
      float tailLen = max(v_style.x - 0.0, 0.0);
      float along = clamp(-(p.x - v_style.x) / max(tailLen + headR, 1.0), 0.0, 1.0);
      float tail = (v_pinned > 0.5 || p.x > v_style.x) ? 0.0 : (1.0 - along) * (1.0 - smoothstep(0.0, headR * (0.75 - 0.5 * along), abs(p.y)));
      float core = clamp(max(head, tail * 0.8), 0.0, 1.0);
      vec3 blood = mix(vec3(0.18, 0.0, 0.02), vec3(0.92, 0.02, 0.08), core);
      vec3 tinted = u_colorPalette == 3 ? blood : mix(blood, base, 0.65);
      vec2 g = uv - vec2(-0.3, -0.35);
      float glint = exp(-dot(g, g) * 14.0) * head;
      outC = (tinted * core + vec3(1.0, 0.35, 0.35) * glint * 0.8) * lum * 3.0;
      alpha = max(core, glint);
      if (alpha < 0.01) discard;
      if (splat > 0.5) outC *= 1.15;
    } else if (u_particleStyle == 2) {
      // synapse-spark: sharp golden soma core + cross dendrite filaments, cyan-white when firing
      float r = length(p) / headR;
      float soma = 1.0 - smoothstep(0.55, 1.0, r);
      float ang = atan(p.y, p.x) + v_seed * 6.2831;
      float branch = pow(abs(cos(ang * 2.0)), 14.0) * (1.0 - smoothstep(0.0, 4.0, r)) * step(1.0, r);
      branch += 0.5 * pow(abs(cos(ang * 3.0 + 1.0)), 18.0) * (1.0 - smoothstep(0.0, 2.6, r)) * step(1.0, r);
      bool firing = v_neuralPulse > 0.5;
      vec3 gold = vec3(1.0, 0.6795, 0.0);
      vec3 flashC = vec3(0.7454, 1.0, 1.0);
      vec3 somaC = u_colorPalette == 0 ? mix(gold, v_formMix > 0.5 ? v_formColor : gold, 0.7) : base;
      vec3 filC = firing ? flashC : somaC * 0.75;
      outC = (somaC * soma + filC * branch * (firing ? 1.6 : 0.8)) * lum * 3.0;
      alpha = max(soma, branch);
      if (alpha < 0.01) discard;
    } else {
      // star-streak: razor-thin ~1.5 px core needle, anisotropic, no halo
      float across = 1.0 - smoothstep(0.55, 1.0, abs(p.y) / 1.5);
      float along = 1.0 - smoothstep(0.35, 1.0, abs(p.x) / max(v_style.z, 1.0));
      alpha = across * along;
      if (alpha < 0.01) discard;
      outC = base * alpha * lum * 3.5;
    }
    fragColor = vec4(outC, alpha);
    return;
  }
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
    {
      // ZUR-GH-009 colour palette drives the dart colour (rim blends toward the secondary tone)
      vec3 pc = palettePick(rim);
      paletteColor = pc * v_tint;
      paletteColorSecondary = mix(pc, vec3(0.6867, 0.8388, 1.0), u_colorPalette == 2 ? 0.5 : 0.0) * v_tint * 0.8;
    }
    vec3 dartColor = paletteColor * (0.45 + 0.85 * normalShade) + paletteColorSecondary * (0.65 * rim);
    vec3 hot = mix(v_color, vec3(1.0), 0.25) * core * sizeNorm;
    fragColor = vec4((dartColor * (0.4 + 0.6 * halo) + hot) * u_radianceScale * 4.0 * sqrt(crowdNorm) * energyNorm, 1.0);
    return;
  }
  vec2 q = vec2(max(abs(v_local.x) - v_halfSeg, 0.0), v_local.y);
  float r2 = dot(q, q) / max(v_radius * v_radius, 1e-4);
  if (r2 >= 1.0) discard;
  float core = exp(-r2 * 42.0) * 0.30;
  float halo = exp(-r2 * 4.5);
  vec3 capsuleBase = palettePick(0.0) * v_tint;
  vec3 hot = mix(capsuleBase, vec3(1.0), 0.25) * core * sizeNorm;
  vec3 color = capsuleBase * halo * 1.1 + hot;
  float capsuleAlpha = 0.40 * crowdNorm * energyNorm;
  // Premultiplied: colour scales with the same bounded alpha so big sprites in 16k-64k crowds never stack to solid white.
  fragColor = vec4(color * u_radianceScale * 12.0 * capsuleAlpha, min(halo, 1.0) * capsuleAlpha);
}
