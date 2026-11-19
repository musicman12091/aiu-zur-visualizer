#version 300 es
// ZUR v6.0 (ZUR-GH-013) — crisp neon pinpoints. Every style is additive (ONE, ONE); silence is black in true-gate.
// Palettes are smooth cosine / mix() gradients over radialNorm, depthNorm, speedNorm and u_spectralCentroid; there are
// no angular colour buckets anywhere, so a ring of agents never shows a hue seam.
precision highp float;
precision highp int;

uniform int u_shape;             // 0 dart cone, 1 quad, 2 dart SDF quad
uniform float u_radianceScale;
uniform float u_particleSize;    // user multiplier 0.5x – 4.0x
uniform float u_activeCount;     // live agent count
uniform float u_trailEnergyNorm; // ZUR-GH-008: clamp((1 - keepFactor) / (1 - 0.55), 0.18, 1.0)
uniform vec3 u_lightDir;

in vec2 v_local;
flat in vec3 v_normal;
in vec3 v_view;
flat in float v_seed;
in float v_neuralPulse;
flat in float v_tint;
flat in float v_hue;
flat in vec3 v_worldPos;
flat in float v_speedNorm;
flat in vec3 v_bh;
flat in float v_axon;
flat in float v_region;
flat in float v_spark;
flat in vec4 v_style;
flat in float v_band;

uniform int u_formationType;     // 5 logo-attractor, 6 neural-brain
uniform int u_megastructure;     // 1 = orbit swarm around the Mandelbulb core (0.35x swarm alpha)
uniform int u_particleStyle;     // 0 crisp-dot, 1 dart3d, 2 synapse-node, 3 star-streak
uniform int u_colorPalette;      // 0 true-neon, 1 full-spectrum, 2 white-static, 3 crimson-pulse, 4 golden-cortex
uniform float u_time;
uniform float u_treble;
uniform float u_highMid;
uniform float u_bass;
uniform float u_onset;
uniform float u_spectralCentroid;
uniform float u_hueShift;        // ZUR-GH-014 universal palette: Hue Shift (turns) applied to every engine

out vec4 fragColor;

const float RADIANCE_BUDGET = 1.6;
const float CORTEX_SOMA_ALPHA = 0.52;
const float CORTEX_SOMA_RADIANCE = 1.85;
const float CORTEX_PULSE_BOOST = 3.2;
const float LOGO_NEON_RADIANCE = 1.9;
const float MEGA_SWARM_ALPHA = 0.35;
const float CRISP_DOT_GAIN = 2.4;
const float CRISP_DISC_GAIN = 0.55;     // ZUR-GH-014: the solid AA disc carries ~2.5x the energy of the old exp(-16 r2) core
const float PULSE_NODE_GAIN = 1.3;     // ZUR-GH-014: pulse lattice nodes are sharp neon points (full-energy disc)
const vec3 BRAIN_CRIMSON = vec3(1.0, 0.0024, 0.0090);       // #FF0818 in linear light
const vec3 BRAIN_CRIMSON_DEEP = vec3(0.578, 0.0, 0.0030);   // #C8000A in linear light
const vec3 BRAIN_SCARLET_FLASH = vec3(1.0, 0.0908, 0.1329); // #FF5566 in linear light (peak synapse flash only)
const float TAU = 6.28318530718;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// iq cosine palette: a + b * cos(TAU * (c * t + d)), continuous in t.
vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

// Continuous gradient coordinate: radius, depth, speed and the live spectral centroid. No angular term.
float gradientT() {
  float radialNorm = clamp(length(v_worldPos) / 3.2, 0.0, 1.0);
  float depthNorm = clamp((v_worldPos.z + 3.2) / 6.4, 0.0, 1.0);
  return 0.62 * radialNorm + 0.28 * depthNorm + 0.18 * v_speedNorm + 0.30 * u_spectralCentroid + v_hue + 0.18 * v_region
    + (v_band >= 0.0 ? v_band * 0.2 : 0.0);
}

// true-neon: smooth hue walk cyan #00F5FF -> magenta #FF007F -> violet #8A2BE2 -> green #00FF66 -> cyan, saturation 1.
vec3 trueNeon(float t) {
  float g = fract(t) * 4.0;
  float h = mix(0.5, 0.917, smoothstep(0.0, 1.0, clamp(g, 0.0, 1.0)));
  h = mix(h, 0.75, smoothstep(0.0, 1.0, clamp(g - 1.0, 0.0, 1.0)));
  h = mix(h, 0.40, smoothstep(0.0, 1.0, clamp(g - 2.0, 0.0, 1.0)));
  h = mix(h, 0.50, smoothstep(0.0, 1.0, clamp(g - 3.0, 0.0, 1.0)));
  return hsv2rgb(vec3(h, 1.0, 1.0));
}

// full-spectrum: rainbow cosine with a saturation lift (continuous, wraps cleanly at t = 1).
vec3 fullSpectrum(float t) {
  vec3 c = cosinePalette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
  float m = min(min(c.r, c.g), c.b);
  float M = max(max(c.r, c.g), c.b);
  return clamp((c - m * 0.85) / max(M - m * 0.85, 1e-3), 0.0, 1.0);
}

// Returns the un-tinted palette colour (peak channel ~1) for this fragment's agent.
vec3 palettePick(float rim) {
  float t = gradientT();
  if (u_colorPalette == 1) return fullSpectrum(t);
  if (u_colorPalette == 4) {
    // golden-cortex: metallic gold soma gradient, cyan-white axon tracts and firing waves
    if (v_neuralPulse > 0.55) return mix(vec3(0.0, 1.0, 1.0), vec3(1.0), clamp(v_neuralPulse - 0.55, 0.0, 1.0) * 1.2);
    if (v_axon > 0.5) return mix(vec3(0.0, 1.0, 1.0), vec3(0.6867, 0.8388, 1.0), 0.45 + 0.4 * fract(v_seed * 3.1));
    return mix(vec3(1.0, 0.6795, 0.0), vec3(1.0, 0.3916, 0.0), 0.5 + 0.5 * cos(TAU * t)) * CORTEX_SOMA_RADIANCE;
  }
  if (u_colorPalette == 2) {
    // white-static: #FFFFFF core, #D8ECFF rim; treble flicker is a mild gate so it never clips
    float flick = step(0.35, fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_time * 43.0) * 43758.5453)) * u_treble;
    vec3 c = mix(vec3(1.0), vec3(0.6867, 0.8388, 1.0), clamp(rim + 0.3 * (0.5 + 0.5 * cos(TAU * t)), 0.0, 1.0));
    return c * (0.55 + 0.45 * flick);
  }
  if (u_colorPalette == 3) {
    // crimson-pulse: #2B0005 -> #D90416 -> #FF2A38 gradient, ruby flash on beat / onset
    float k = clamp(0.35 + 0.65 * (0.5 + 0.5 * cos(TAU * t)) + 0.5 * u_onset, 0.0, 1.0);
    vec3 c = mix(mix(vec3(0.0242, 0.0, 0.0015), vec3(0.6939, 0.0012, 0.0080), smoothstep(0.0, 0.5, k)),
                 vec3(1.0, 0.0232, 0.0395), smoothstep(0.5, 1.0, k));
    if (u_formationType == 6) {
      c = v_neuralPulse > 0.65 ? BRAIN_SCARLET_FLASH : mix(BRAIN_CRIMSON_DEEP, BRAIN_CRIMSON, 0.5 + 0.5 * cos(TAU * t));
    }
    return c * (1.0 + 0.8 * clamp(u_bass * 0.6 + u_onset, 0.0, 1.0));
  }
  return trueNeon(t);
}

void shade() {
  // ZUR-GH-010: nothing is emitted inside the r < 0.24 event horizon.
  if (v_bh.z > 0.0 && distance(gl_FragCoord.xy, v_bh.xy) < v_bh.z) discard;
  if (v_tint <= 0.0) discard;
  // Darts keep the ZUR-GH-010 density norm; crisp quads use the pinpoint exposure curve below.
  float crowdNorm = clamp(pow(65536.0 / max(float(u_activeCount), 65536.0), 0.58), 0.28, 1.0);
  crowdNorm *= RADIANCE_BUDGET / (1.0 + 0.32 * u_particleSize * u_particleSize);
  bool logo = u_formationType == 5;
  float logoBoost = logo ? LOGO_NEON_RADIANCE : 1.0;
  if (logo) crowdNorm = max(crowdNorm, 1.0);
  bool cortexFiring = u_formationType == 6 && v_neuralPulse > 0.55;
  bool cortexSoma = u_formationType == 6 && v_axon < 0.5 && !cortexFiring;
  float paletteBoost = cortexFiring ? CORTEX_PULSE_BOOST : 1.0;
  float sizeNorm = u_particleSize > 1.5 ? 1.0 / pow(max(u_particleSize, 1.0), 0.65) : 1.0;
  float energyNorm = clamp(u_trailEnergyNorm, 0.18, 1.0);

  if (u_shape == 1) {
    // Crisp quads: crisp-dot, synapse-node, star-streak. Head = exp(-r2 * 16) core with a hard cutoff at r = 1.
    float exposure = clamp(pow(16384.0 / max(float(u_activeCount), 1.0), 0.52), 0.16, 1.0);
    if (logo) exposure = 1.0;
    float headR = max(v_style.x, 1.0);
    float tailPx = v_style.y;
    float stretch = max(v_style.z, 1.0);
    vec2 p = v_local / headR;                    // head-normalised, +x = travel direction
    float r2 = dot(p, p);
    float head = r2 < 1.0 ? exp(-r2 * 16.0) : 0.0;
    // ZUR-GH-014 crisp-dot (and the pulse lattice nodes): anti-aliased pinpoint disc, no Gaussian fog skirt.
    bool disc = u_particleStyle == 0 || v_band >= 0.0;
    if (disc) head = smoothstep(1.0, 0.50, sqrt(r2)) * (v_band >= 0.0 ? PULSE_NODE_GAIN : CRISP_DISC_GAIN);
    float tail = 0.0;
    if (!disc && tailPx > 0.5 && p.x < 0.0) {
      float along = clamp(-v_local.x / tailPx, 0.0, 1.0);
      float across = p.y / 0.6;
      tail = (1.0 - along) * (1.0 - along) * exp(-across * across * 16.0) * step(-v_local.x, tailPx);
    }
    // energy-conserving stretch: the streak spreads the same energy as the resting dot
    float conserve = 1.0 / (1.0 + 0.35 * (stretch - 1.0));
    float shape = max(head, tail) * conserve;
    vec3 base = palettePick(sqrt(min(r2, 1.0)));
    float lum = v_tint * u_radianceScale * exposure * energyNorm * paletteBoost * logoBoost * CRISP_DOT_GAIN;
    if (cortexSoma) lum *= CORTEX_SOMA_ALPHA * 1.6;
    vec3 outC = base * shape * lum;
    if (v_spark > 0.5) {
      // synapse-node axon tracer spark: only lit by onsets / high-mids (dark otherwise)
      float sparkGate = clamp(u_onset * 1.6 + u_highMid * 1.4, 0.0, 1.0);
      vec3 flashC = u_colorPalette == 3 ? BRAIN_SCARLET_FLASH : vec3(0.7454, 1.0, 1.0);
      outC = mix(base, flashC, 0.6) * shape * lum * sparkGate * 1.6;
    }
    // pinpoint hot centre (tiny white core, no blow-out)
    if (!disc) outC += vec3(1.0) * exp(-r2 * 64.0) * step(r2, 1.0) * lum * 0.18 * sizeNorm * (v_spark > 0.5 ? 0.0 : 1.0);
    if (max(max(outC.r, outC.g), outC.b) < 1e-4) discard;
    fragColor = vec4(outC, 1.0);
    return;
  }
  if (u_shape == 2) {
    // ZUR-GH-012: dart SDF on the 4-vertex quad. u = -1 at the tail, +1 at the nose; the half width tapers 1 -> 0.
    float u = v_local.x;
    float halfWidth = max(0.5 * (1.0 - u), 1e-3);
    float inside = halfWidth - abs(v_local.y);
    float cover = smoothstep(0.0, 0.22, inside) * (1.0 - smoothstep(0.92, 1.0, u));
    if (cover < 0.02) discard;
    float rim = pow(1.0 - clamp(inside / halfWidth, 0.0, 1.0), 2.5);
    float spine = exp(-v_local.y * v_local.y * 9.0);
    vec3 pc = palettePick(rim);
    vec3 dartBody = pc * v_tint * (0.45 + 0.55 * spine) * paletteBoost * (cortexSoma ? 0.62 : 1.0);
    vec3 rimColor = mix(pc, vec3(0.6867, 0.8388, 1.0), u_colorPalette == 2 ? 0.5 : 0.0) * v_tint * 0.8 * paletteBoost;
    vec3 hot = mix(pc * v_tint, vec3(1.0), 0.25) * spine * 0.3 * sizeNorm;
    vec3 quadColor = (dartBody * (0.4 + 0.6 * exp(-u * u * 1.5)) + rimColor * (0.65 * rim) + hot) * cover;
    fragColor = vec4(quadColor * u_radianceScale * 4.0 * sqrt(crowdNorm) * energyNorm * logoBoost * 0.85, 1.0);
    return;
  }
  // u_shape == 0: dart3d cone
  vec3 n = normalize(v_normal);
  vec3 v = normalize(v_view);
  float facing = abs(dot(n, v));
  float normalShade = abs(dot(n, u_lightDir));
  float rim = pow(1.0 - facing, 2.5);
  float r2 = v_local.x * v_local.x;
  float core = exp(-r2 * 42.0) * 0.30;
  float halo = exp(-r2 * 4.5);
  vec3 pc = palettePick(rim);
  float somaFade = cortexSoma ? 0.62 : paletteBoost;
  vec3 paletteColor = pc * v_tint * somaFade;
  vec3 paletteColorSecondary = mix(pc, vec3(0.6867, 0.8388, 1.0), u_colorPalette == 2 ? 0.5 : 0.0) * v_tint * 0.8 * somaFade;
  vec3 dartColor = paletteColor * (0.45 + 0.85 * normalShade) + paletteColorSecondary * (0.65 * rim);
  vec3 hot = mix(pc * v_tint, vec3(1.0), 0.25) * core * sizeNorm;
  fragColor = vec4((dartColor * (0.4 + 0.6 * halo) + hot) * u_radianceScale * 4.0 * sqrt(crowdNorm) * energyNorm * logoBoost, 1.0);
}

// Luma-preserving hue rotation (turns), identical to palettes.js shiftPalette().
vec3 hueRotate(vec3 c, float turns) {
  if (abs(turns) < 1e-4) return c;
  float a = turns * TAU;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float cb = c.b - y;
  float cr = c.r - y;
  float nr = y + (cb * sin(a) + cr * cos(a));
  float nb = y + (cb * cos(a) - cr * sin(a));
  float ng = (y - 0.2126 * nr - 0.0722 * nb) / 0.7152;
  return max(vec3(nr, ng, nb), vec3(0.0));
}

void main() {
  shade();
  fragColor.rgb = hueRotate(fragColor.rgb, u_hueShift);
  // ZUR-GH-012: the orbit swarm is a faint halo around the Mandelbulb core, never a fog bank in front of it.
  if (u_megastructure == 1) fragColor *= MEGA_SWARM_ALPHA;
}
