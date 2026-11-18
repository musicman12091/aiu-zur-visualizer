/**
 * Stage 2 pure math shared by ParticleSystem3D.js and tests/verify-contracts.mjs.
 * Every helper here mirrors a GLSL routine in src/shaders/*.glsl so the
 * contract tests can pin the numbers without a GPU.
 */

export const PARTICLE_SCENE_ID = "particle-swarm-3d";
export const AURORA_SCENE_ID = "aurora-ribbons";
export const PULSE_SCENE_ID = "pulse-field-3d";
export const MEGASTRUCTURE_SCENE_ID = "megastructure-3d";
export const SPECTRAL_CANYON_SCENE_ID = "spectral-canyon-3d";
export const SCENE_IDS = Object.freeze([
  PARTICLE_SCENE_ID, PULSE_SCENE_ID, MEGASTRUCTURE_SCENE_ID, SPECTRAL_CANYON_SCENE_ID, AURORA_SCENE_ID,
]);
/** Scenes drawn by the transform-feedback ParticleSystem3D. */
export const PARTICLE_SCENE_IDS = Object.freeze([PARTICLE_SCENE_ID, PULSE_SCENE_ID, MEGASTRUCTURE_SCENE_ID]);

/** Flow modes, in the order of the `u_mode` integer in sim.vert.glsl. */
export const FLOW_MODES = Object.freeze(["fluid", "gas", "murmuration", "fish", "physarum"]);
export const FLOW_LABELS = Object.freeze({
  fluid: "Fluid",
  gas: "Gas",
  murmuration: "Murmuration (Birds)",
  fish: "School of Fish (Flock)",
  physarum: "Physarum Neural Web",
});
export const PARTICLE_SHAPES = Object.freeze(["dart", "capsule"]);
export const KALEIDO_SEGMENTS = Object.freeze([0, 4, 6, 8, 12, 16]);
/** ZUR-GH-009: five density tiers only (no 16k/32k or smaller). */
export const COUNT_TIERS = Object.freeze(["64k", "96k", "128k", "160k", "256k"]);
export const COUNT_TIER_VALUES = Object.freeze({
  "64k": 65536,
  "96k": 98304,
  "128k": 131072,
  "160k": 163840,
  "256k": 262144,
});
export const COUNT_TIER_LABELS = Object.freeze({
  "64k": "64k (65,536)",
  "96k": "96k (98,304)",
  "128k": "128k (131,072)",
  "160k": "160k (163,840)",
  "256k": "256k (262,144)",
});
export const TRAIL_TYPES = Object.freeze(["comet", "electric", "strobe", "ribbon", "none"]);
/** Index = `u_formationType` in sim.vert.glsl; ZUR-GH-009 ids 6..9 follow logo-attractor, ZUR-GH-013 adds 10. */
export const FORMATION_TYPES = Object.freeze([
  "free-3d", "neon-tunnel", "polygon-rings", "supernova-shell", "fractal-core", "logo-attractor",
  "neural-brain", "living-galaxy", "supermassive-blackhole", "wormhole", "harmonic-ferrofluid",
]);
export const FORMATION_LABELS = Object.freeze({
  "free-3d": "Free 3D Swarm",
  "neon-tunnel": "Neon Tunnel Vortex",
  "polygon-rings": "Polygon Rings",
  "supernova-shell": "Supernova Shell",
  "fractal-core": "Fractal Core",
  "logo-attractor": "Logo / Text Attractor",
  "neural-brain": "Anatomical 3D Brain",
  "living-galaxy": "Living Spiral Galaxy",
  "supermassive-blackhole": "Supermassive Black Hole (Gargantua)",
  "wormhole": "Spherical Wormhole — Funnel in Sphere",
  "harmonic-ferrofluid": "Harmonic Ferrofluid Rings",
});
/**
 * Index = `u_particleStyle`. ZUR-GH-013: crisp-dot is index 0 and the universal default; blood-drop was deleted and
 * synapse-spark was rebuilt as synapse-node (legacy ids migrate through PARTICLE_STYLE_ALIASES).
 */
export const PARTICLE_STYLES = Object.freeze(["crisp-dot", "dart3d", "synapse-node", "star-streak"]);
export const PARTICLE_STYLE_LABELS = Object.freeze({
  "crisp-dot": "Crisp Dot — Pinpoint",
  "dart3d": "3D Dart",
  "synapse-node": "Neural Node & Spark",
  "star-streak": "Velocity Star Streak",
});
export const PARTICLE_STYLE_ALIASES = Object.freeze({ "blood-drop": "crisp-dot", "synapse-spark": "synapse-node", orb: "crisp-dot" });
/** Index = `u_colorPalette` (golden-cortex = 4). ZUR-GH-013: blood-red became crimson-pulse (same index 3). */
export const COLOR_PALETTES = Object.freeze(["true-neon", "full-spectrum", "white-static", "crimson-pulse", "golden-cortex"]);
export const COLOR_PALETTE_LABELS = Object.freeze({
  "true-neon": "True Neon",
  "full-spectrum": "Full Spectrum",
  "white-static": "White Static",
  "crimson-pulse": "Crimson Pulse",
  "golden-cortex": "Golden Cortex",
});
export const COLOR_PALETTE_ALIASES = Object.freeze({ "blood-red": "crimson-pulse" });
/** Index = `u_kineticMode`. ZUR-GH-013: splatter-run was deleted with the Blood mode (legacy saves fall back to off). */
export const KINETIC_MODES = Object.freeze([
  "off", "synapse-cascade", "accretion-warp", "ribbon-curtain", "shock-shatter",
]);
export const KINETIC_LABELS = Object.freeze({
  "off": "Off",
  "synapse-cascade": "Synapse Cascade",
  "accretion-warp": "Accretion Warp",
  "ribbon-curtain": "Ribbon Curtain",
  "shock-shatter": "Shock Shatter",
});
export const CAMERA_ZOOM_RANGE = Object.freeze([0.35, 3.5]);
export const CAMERA_ZOOM_STEP = 0.05;
export const REACTIVITY_GAIN_RANGE = Object.freeze([0.5, 5.0]);
export const NOISE_GATE_RANGE = Object.freeze([0, 0.1]);
export const NOISE_GATE_DEFAULT = 0.015;
/** ZUR-GH-013 reactivity modes (u_reactivityMode index): silence = black, 0.06 ember outline, legacy ambient VJ glow. */
export const REACTIVITY_MODES = Object.freeze(["true-gate", "ember-floor", "ambient-vj"]);
export const REACTIVITY_MODE_LABELS = Object.freeze({
  "true-gate": "True Gate — Silence = Black",
  "ember-floor": "Ember Floor (0.06 outline)",
  "ambient-vj": "Ambient VJ (always lit)",
});
export const OSCILLATION_TYPES = Object.freeze(["off", "wave", "helix", "bounce", "pulse"]);
/** ZUR-GH-007: Logo / Attractor Text presets shown directly under the Formation dropdown. */
export const LOGO_TEXT_PRESETS = Object.freeze(["AI: UNDERGROUND", "MON DAAIN", "TENTH GATE", "ZUR"]);
/** ZUR-GH-007: glyph targets keep only 8% of the oscillation amount (mirrors sim.vert.glsl). */
export const LOGO_OSCILLATION_SCALE = 0.08;
/** ZUR-GH-007: logo-attractor clamps the effective trail length so comet decay cannot smear glyphs. */
export const LOGO_TRAIL_LENGTH_MAX = 0.2;
export const PULSE_LAYOUTS = Object.freeze(["band-clouds", "geodesic-sphere", "wave-grid"]);
export const TRAIL_LENGTH_RANGE = Object.freeze([0, 1]);
export const OSCILLATION_AMOUNT_RANGE = Object.freeze([0, 3]);
export const OSCILLATION_SPEED_RANGE = Object.freeze([0.25, 4]);
/** ZUR-GH-009: every TF / logo-target buffer is allocated at this capacity regardless of the active tier. */
export const MAX_PARTICLES = 262144;
export const MIN_PARTICLES = 4096;
export const DESKTOP_PARTICLES = 65536;
export const MOBILE_PARTICLES = 65536;
export const PARTICLE_SIZE_RANGE = Object.freeze([0.5, 4.0]);
/** Bytes per agent: vec4 a_pos + vec4 a_vel, interleaved Float32. */
export const BYTES_PER_AGENT = 32;
export const FLOATS_PER_AGENT = 8;
/** Neighbor texture: two RGBA32F texels per agent, 256 agents per row. */
export const AGENTS_PER_ROW = 256;
export const SIM_STEP = 1 / 60;
/** ZUR-GH-012: exactly one transform-feedback step per frame (no multi-step catch-up, so 256k cannot death-spiral). */
export const MAX_STEPS_PER_FRAME = 1;
export const MAX_SIM_DT = 1 / 30;
/** ZUR-GH-012: active agent count from which dart3d draws the 4-vertex velocity-oriented dart SDF quad. */
export const DART_QUAD_MIN_COUNT = 131072;

/** Per-60 Hz-step velocity retention from the ticket, converted to a rate. */
export const FLOW_DAMPING_PER_STEP = Object.freeze({
  fluid: 0.985,
  gas: 0.94,
  murmuration: 0.97,
  fish: 0.955,
  physarum: 0.97,
});

export const DEFAULT_PARTICLES = Object.freeze({
  flowMode: "murmuration",
  shape: "capsule",
  particleSize: 1.0,
  kaleidoSegments: 0,
  kaleidoSpin: true,
  particleCountTier: "64k",
  densityAutoScale: true,
  trailLength: 0.28,
  trailType: "comet",
  formationType: "wormhole",
  attractorText: "AI: UNDERGROUND",
  oscillationType: "helix",
  oscillationAmount: 1.0,
  oscillationSpeed: 1.2,
  pulseLayout: "band-clouds",
  particleStyle: "crisp-dot",
  colorPalette: "true-neon",
  kineticMode: "off",
  reactivityGain: 2.5,
  cameraZoom: 1.0,
  reactivityMode: "true-gate",
});

/** Converts a per-step retention factor (e.g. 0.985 per 1/60 s) into a continuous damping rate (1/s). */
export function dampingRateFromRetention(retention, step = SIM_STEP) {
  if (!(retention > 0) || retention >= 1) return 0;
  return -Math.log(retention) / step;
}

/**
 * Exact integration of dv/dt = F - k v with F held constant over dt.
 * E = exp(-k dt), A = (1 - E) / k, B = (dt - A) / k.
 * v' = v E + F A ; x' = x + v A + F B.
 * Third-order Taylor fallback when |k dt| < 1e-3.
 */
export function frozenDragCoefficients(damping, dt) {
  const kd = damping * dt;
  if (Math.abs(kd) < 1e-3) {
    const E = 1 - kd + (kd * kd) / 2 - (kd * kd * kd) / 6;
    const A = dt - (damping * dt * dt) / 2 + (damping * damping * dt * dt * dt) / 6;
    const B = (dt * dt) / 2 - (damping * dt * dt * dt) / 6 + (damping * damping * dt ** 4) / 24;
    return { E, A, B };
  }
  const E = Math.exp(-kd);
  const A = (1 - E) / damping;
  const B = (dt - A) / damping;
  return { E, A, B };
}

export function integrateFrozenDrag(position, velocity, forcing, damping, dt) {
  const { E, A, B } = frozenDragCoefficients(damping, dt);
  return {
    position: position + velocity * A + forcing * B,
    velocity: velocity * E + forcing * A,
  };
}

/** ZUR-GH-012: one sim step per rendered frame with dt = min(frameDt, 1/30); skipped only when frameDt <= 0. */
export function planSimStep(frameDt) {
  if (!(frameDt > 0)) return { steps: 0, simDt: 0 };
  return { steps: 1, simDt: Math.min(frameDt, MAX_SIM_DT) };
}

/** Number of vertices dart3d draws per instance: 4 (quad strip) from 128k agents, else the 12-vertex cone. */
export function dartVertexCount(activeCount) {
  return activeCount >= DART_QUAD_MIN_COUNT ? 4 : 12;
}

/** Fixed-step accumulator. Drops backlog beyond maxSteps so a stall cannot spiral. */
export function planFixedSteps(accumulator, dt, step = SIM_STEP, maxSteps = MAX_STEPS_PER_FRAME) {
  let acc = accumulator + Math.max(0, Math.min(dt, 0.25));
  let steps = Math.floor(acc / step + 1e-9);
  if (steps > maxSteps) {
    steps = maxSteps;
    acc = 0;
  } else {
    acc -= steps * step;
  }
  return { steps, accumulator: Math.max(0, acc) };
}

/** 32-bit integer hash. Identical to `hash32` in sim.vert.glsl / render.vert.glsl. */
export function hash32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Deterministic render thinning: instance id is drawn when hash32(id) < threshold. */
export function visibleThreshold(fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  if (f >= 1) return 0xffffffff;
  return Math.floor(f * 0xffffffff) >>> 0;
}

export function isInstanceVisible(id, threshold) {
  return threshold >= 0xffffffff || hash32(id) < threshold;
}

/** Capture-space minimum radius: keeps particles encoder-safe on a 720p Discord share. */
export function minRenderRadiusPx(minCaptureRadiusPx, renderHeight, kaleidoZoom = 1) {
  return (minCaptureRadiusPx * (renderHeight / 720)) / Math.max(kaleidoZoom, 0.25);
}

/** Trail fade factor: history kept per frame. */
export function trailKeep(dt, trailTauSeconds) {
  if (!(trailTauSeconds > 0)) return 0;
  return Math.exp(-Math.max(0, dt) / trailTauSeconds);
}

/** Converts Stage 1 trailHalfLifeMs to the exponential time constant tau (s). */
export function trailTauFromHalfLife(halfLifeMs) {
  return Math.max(halfLifeMs, 1) / 1000 / Math.LN2;
}

/**
 * Radiance scale for injected particles so the steady-state glow is identical
 * at 30 and 60 fps: (1 - E) / (1 - exp(-1 / (60 tau))).
 */
export function trailRadianceScale(dt, trailTauSeconds) {
  if (!(trailTauSeconds > 0)) return 1;
  const E = trailKeep(dt, trailTauSeconds);
  const ref = 1 - Math.exp(-1 / (60 * trailTauSeconds));
  return (1 - E) / Math.max(ref, 1e-4);
}

/** Steady-state accumulated radiance of a static emitter with unit per-frame radiance. */
export function steadyStateRadiance(dt, trailTauSeconds) {
  const E = trailKeep(dt, trailTauSeconds);
  return trailRadianceScale(dt, trailTauSeconds) / Math.max(1 - E, 1e-9);
}

/** Triangle-wave mirror repeat (kaleido.frag.glsl mirrorRepeat): 1 - |fract(x / 2) * 2 - 1|. */
export function mirrorRepeat(x) {
  const f = x * 0.5 - Math.floor(x * 0.5);
  return 1 - Math.abs(f * 2 - 1);
}

/** Mirrored polar radius fold: identity up to 1, then reflects (kaleido.frag.glsl). */
export function foldRadius(rawRadius) {
  return mirrorRepeat(rawRadius);
}

/** Outer vignette smoothstep(1.12, 0.82, rawRadius) applied when segments > 1. */
export function kaleidoVignette(rawRadius) {
  return smoothstep(1.12, 0.82, rawRadius);
}

/**
 * JS mirror of kaleidoFold() in kaleido.frag.glsl. Segments <= 1 is a 1:1 bypass.
 * centerY follows u_viewportYOffset: 0.5 + 0.5 * offset.
 */
export function kaleidoFold(u, v, segments, angle, aspect, zoom = 1, centerY = 0.5) {
  if (!(segments > 1)) return [u, v];
  const px = (u - 0.5) * aspect;
  const py = v - centerY;
  const rawRadius = Math.hypot(px, py) / Math.max(zoom, 0.25);
  const r = foldRadius(rawRadius);
  const wedge = (Math.PI * 2) / segments;
  let a = Math.atan2(py, px) + angle;
  a -= wedge * Math.floor(a / wedge);
  a = Math.abs(a - wedge * 0.5);
  return [mirrorRepeat((Math.cos(a) * r) / aspect + 0.5), mirrorRepeat(Math.sin(a) * r + centerY)];
}

/** Reinhard x / (1 + x) per channel (Stage 2; kept for reference, no longer used by kaleido.frag.glsl). */
export function toneMap(x) {
  return x / (1 + x);
}

/** ZUR-GH-008: chroma-preserving peak tone map (no white bleed) + display-space high-luma chroma floor. */
export const TONEMAP = Object.freeze({ shoulder: 0.65, floorPeak: 0.65, floorSat: 0.6 });

function smoothstep(lo, hi, x) {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** JS mirror of the chroma-preserving peak tone map in kaleido.frag.glsl (ZUR-GH-008: never bleeds to white). */
export function chromaToneMap([r, g, b], coreSpecular = 0) {
  const peak = Math.max(r, Math.max(g, b));
  if (peak <= 1e-5) return [0, 0, 0];
  const mappedPeak = Math.min(peak / (1 + TONEMAP.shoulder * peak), 1);
  // megastructure-3d only (u_coreSpecular = 1): the raymarched core keeps its Stage 3 white specular bleed.
  const white = smoothstep(1.1, 3.2, peak) * 0.65 * coreSpecular;
  return [r, g, b].map((c) => (c / Math.max(peak, 1e-4)) * mappedPeak * (1 - white) + white);
}

/** JS mirror of chromaFloor() in kaleido.frag.glsl (display-space RGB 0..1, paletteHue = u_palette[0]). */
export function chromaFloor([r, g, b], paletteHue = [1, 0, 1], coreSpecular = 0) {
  const peak = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const w = smoothstep(TONEMAP.floorPeak - 0.12, TONEMAP.floorPeak, peak) * (1 - coreSpecular);
  if (w <= 0 || peak <= 1e-4) return [r, g, b];
  const sat = (peak - low) / peak;
  if (sat >= TONEMAP.floorSat) return [r, g, b];
  const ph = paletteHue.map((v) => Math.max(v, 0));
  const pMax = Math.max(...ph);
  const pMin = Math.min(...ph);
  const pal = pMax - pMin > 1e-3 ? ph.map((v) => (v - pMin) / (pMax - pMin)) : [1, 0, 1];
  const own = [r, g, b].map((v) => (v - low) / Math.max(peak - low, 1e-4));
  const t = smoothstep(0.02, 0.15, sat);
  return own.map((h, i) => {
    const hue = pal[i] + (h - pal[i]) * t;
    const floored = peak * (1 - TONEMAP.floorSat + TONEMAP.floorSat * hue);
    return [r, g, b][i] + (floored - [r, g, b][i]) * w;
  });
}

/** Neon comet sprite falloff (render.frag.glsl): saturated halo + tiny white pinprick core (peak 0.30). */
export const GLOW = Object.freeze({ coreK: 42.0, haloK: 4.5, coreGain: 0.30 });
export function glowProfile(r2) {
  return { core: Math.exp(-r2 * GLOW.coreK) * GLOW.coreGain, halo: Math.exp(-r2 * GLOW.haloK) };
}

/** Capsule alpha multiplier in render.frag.glsl (premultiplied Pass 1 blend). */
export const CAPSULE_ALPHA = 0.40;

/**
 * Bounded radiance for big sprites in dense swarms (render.frag.glsl crowdNorm).
 * particleSize 2.2..4.0 at 16k-64k stays below ~0.15 instead of stacking into white fireballs.
 */
export function crowdNorm(particleSize, activeCount) {
  return 1 / (1 + 0.32 * particleSize * particleSize * Math.sqrt(Math.max(activeCount, 64) / 1024));
}

/** Final Velocity Capsule alpha at the sprite centre (halo = 1). */
export function capsuleAlpha(particleSize, activeCount, halo = 1) {
  return Math.min(halo, 1) * CAPSULE_ALPHA * crowdNorm(particleSize, activeCount);
}

/**
 * Pass 1 FBO size. Portrait viewports (clientHeight > clientWidth) swap the tier W/H and
 * derive the width from the aspect, so the offscreen target is 1:1 with the canvas.
 */
export function resolveFboSize(targetWidth, targetHeight, clientWidth, clientHeight) {
  if (!(clientWidth > 0) || !(clientHeight > 0) || clientHeight <= clientWidth) {
    return { width: targetWidth, height: targetHeight, portrait: false };
  }
  const aspect = clientWidth / clientHeight;
  const height = Math.max(targetWidth, targetHeight);
  return { width: Math.max(2, Math.round(height * aspect)), height, portrait: true };
}

/** Hor+ projection scales: X shrinks only when landscape, Y shrinks only when portrait. */
export function projectionScales(f, aspect) {
  return { x: f * Math.min(1.0, 1.0 / aspect), y: f * Math.min(1.0, aspect) };
}

/** Stage 3 density auto-scale: fewer particles get bigger/brighter sprites. */
export function densityScaleBoost(count, enabled = true) {
  if (!enabled) return 1;
  return Math.min(5.5, Math.max(1.0, (4096.0 / count) ** 0.32));
}

/** Stage 3 density auto-scale (audited v3.1): low counts get punchier/shorter trails
 *  via clamp((N/4096)^0.28, 0.18, 1.0); high counts keep full trail persistence. */
export function densityTrailScale(count, enabled = true) {
  if (!enabled) return 1;
  return Math.min(1.0, Math.max(0.18, (count / 4096.0) ** 0.28));
}

/** Frame-rate independent history kept for a per-60 Hz keep factor. */
export function keepForDt(keep60, dt) {
  if (!(keep60 > 0)) return 0;
  return keep60 ** (Math.max(0, dt) * 60);
}

/** Time constant (s) equivalent to a per-60 Hz keep factor; 0 when no history is kept. */
export function tauFromKeep60(keep60) {
  if (!(keep60 > 0) || keep60 >= 1) return 0;
  return -1 / (60 * Math.log(keep60));
}

/** Per-60 Hz-frame history kept by the trail pass. */
export function trailKeepFactor(trailType, trailLength) {
  if (trailType === "none" || !(trailLength > 0.01)) return 0.0;
  const t = Math.min(1, Math.max(0, trailLength));
  return 0.15 + (0.965 - 0.15) * t ** 0.65;
}

/** Causal Gaussian predator shockwave weight. Zero ahead of the front. */
export function shockwaveWeight(r, age, waveSpeed, width, lifetime = 1.6) {
  if (!(age >= 0)) return 0;
  const front = waveSpeed * age;
  const d = (r - front) / width;
  const t = Math.min(1, Math.max(0, (front - r + width) / width));
  const gate = t * t * (3 - 2 * t);
  return Math.exp(-d * d) * gate * Math.exp(-age / lifetime);
}

/** Predator shockwave ring buffer: 4 vec4 slots (xyz origin, w birth time). */
export const SHOCK_SLOTS = 4;
/** Birth-time sentinel for an empty slot; sim.vert.glsl skips any slot with w < 0. */
export const SHOCK_EMPTY_BIRTH = -1e6;

/** Allocate the uniform buffer with every slot marked empty (never zero-init: w = 0 is a live shock at t = 0). */
export function createShockBuffer() {
  const buf = new Float32Array(SHOCK_SLOTS * 4);
  for (let i = 0; i < SHOCK_SLOTS; i++) buf[i * 4 + 3] = SHOCK_EMPTY_BIRTH;
  return buf;
}

/** Mirrors the slot gate in shockwaveAcceleration(): empty when w < 0, live for 0 <= age <= 4 s. */
export function isShockSlotActive(buf, slot, time) {
  const birth = buf[slot * 4 + 3];
  if (birth < 0) return false;
  const age = time - birth;
  return age >= 0 && age <= 4;
}

/** Lissajous attractor, mirrored by lissajous() in sim.vert.glsl. */
export function lissajous(index, time) {
  const i = index;
  const fx = 0.21 + 0.037 * i;
  const fy = 0.17 + 0.029 * i;
  const fz = 0.13 + 0.041 * i;
  const ph = i * 1.2566370614;
  return [
    Math.sin(time * fx + ph) * 3.4,
    Math.sin(time * fy * 1.7 + ph * 0.5) * 1.6,
    Math.cos(time * fz + ph) * 3.4,
  ];
}

/** ZUR-GH-008: School of Fish bait-ball leader Y offsets (sim.vert.glsl FISH_LEADER_Y); they sum to zero. */
export const FISH_LEADER_Y = Object.freeze([0.9, -0.9, 0.55, -0.55, 0.25, -0.25]);

/** Mirror of fishLeader() in sim.vert.glsl. */
export function fishLeader(index, time) {
  const a = index * 1.0471975512 + time * 0.35;
  const bob = Math.sin(time * 0.5 + index * 1.0471975512) * 0.25;
  return [Math.cos(a) * 3.0, FISH_LEADER_Y[index] + bob, Math.sin(a) * 3.0];
}

/** ZUR-GH-008: Gas toroidal circulation ring radius / Y wrap (sim.vert.glsl GAS_TORUS_RADIUS / GAS_WRAP_Y). */
export const GAS_TORUS_RADIUS = 2.4;
export const GAS_WRAP_Y = 4.2;

/** Meridional toroidal circulation (rho, y) of the Gas vortex ring: up inside, out over the top, down outside. */
export function gasCirculation(rho, y) {
  const mx = rho - GAS_TORUS_RADIUS;
  const fall = Math.exp(-(mx * mx + y * y) / 10);
  return [y * fall, -mx * fall];
}

/** Topological 6-neighbor ring (id±1, id±2, id±3 mod count). */
export function ringNeighbors(id, count) {
  const out = [];
  for (let k = 1; k <= 3; k += 1) {
    out.push((id + k) % count, (id - k + count) % count);
  }
  return out;
}

export function isMobileAgent(userAgent = "", maxTouchPoints = 0, width = 1920) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || (maxTouchPoints > 1 && width < 900);
}

export function resolveParticleCount(countTier, mobile) {
  if (typeof countTier === "number" && Object.values(COUNT_TIER_VALUES).includes(countTier)) return countTier;
  if (Object.hasOwn(COUNT_TIER_VALUES, countTier)) return COUNT_TIER_VALUES[countTier];
  return mobile ? MOBILE_PARTICLES : DESKTOP_PARTICLES;
}

/** Maps a legacy Stage 2 numeric countTier (4096, 16384, ...) to a Stage 3 tier id. */
export function tierFromCount(value) {
  const hit = Object.entries(COUNT_TIER_VALUES).find(([, n]) => n === Number(value));
  return hit ? hit[0] : null;
}

/** FPS floor for auto step-down: 50 fps at a 60 fps cap, scaled for lower caps (Mode A 30 fps → 25). */
export function stepdownThreshold(targetFps) {
  return Math.min(50, (targetFps * 5) / 6);
}

/**
 * Auto tier step-down. After `windows` consecutive slow 1-second windows the swarm
 * halves (never below 4096). A window under half the threshold is a severe miss:
 * the swarm quarters immediately so weak GPUs recover within one second.
 */
export function nextAutoCount(count, fps, targetFps, slowWindows, windows = 2) {
  if (!(fps > 0)) return { count, slowWindows: 0 };
  const threshold = stepdownThreshold(targetFps);
  if (fps >= threshold) return { count, slowWindows: 0 };
  if (count <= MIN_PARTICLES) return { count, slowWindows: slowWindows + 1 };
  if (fps < threshold * 0.5) return { count: Math.max(MIN_PARTICLES, count >> 2), slowWindows: 0 };
  const slow = slowWindows + 1;
  if (slow < windows) return { count, slowWindows: slow };
  return { count: Math.max(MIN_PARTICLES, count >> 1), slowWindows: 0 };
}

function clampRange(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeParticles(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = { ...DEFAULT_PARTICLES };
  if (FLOW_MODES.includes(src.flowMode)) out.flowMode = src.flowMode;
  if (PARTICLE_SHAPES.includes(src.shape)) out.shape = src.shape;
  if (Number.isFinite(src.particleSize)) {
    out.particleSize = Math.min(PARTICLE_SIZE_RANGE[1], Math.max(PARTICLE_SIZE_RANGE[0], src.particleSize));
  }
  if (KALEIDO_SEGMENTS.includes(src.kaleidoSegments)) out.kaleidoSegments = src.kaleidoSegments;
  if (typeof src.kaleidoSpin === "boolean") out.kaleidoSpin = src.kaleidoSpin;
  // Removed tiers (auto, 64..32k) and legacy numeric `countTier` values fall back to 64k unless they map to a live tier.
  if (COUNT_TIERS.includes(src.particleCountTier)) out.particleCountTier = src.particleCountTier;
  else if (src.countTier != null) {
    const legacy = tierFromCount(src.countTier);
    if (legacy) out.particleCountTier = legacy;
  }
  if (typeof src.densityAutoScale === "boolean") out.densityAutoScale = src.densityAutoScale;
  if (Number.isFinite(src.trailLength)) out.trailLength = clampRange(src.trailLength, TRAIL_LENGTH_RANGE);
  if (TRAIL_TYPES.includes(src.trailType)) out.trailType = src.trailType;
  if (FORMATION_TYPES.includes(src.formationType)) out.formationType = src.formationType;
  if (typeof src.attractorText === "string") out.attractorText = src.attractorText.slice(0, 64);
  if (OSCILLATION_TYPES.includes(src.oscillationType)) out.oscillationType = src.oscillationType;
  if (Number.isFinite(src.oscillationAmount)) out.oscillationAmount = clampRange(src.oscillationAmount, OSCILLATION_AMOUNT_RANGE);
  if (Number.isFinite(src.oscillationSpeed)) out.oscillationSpeed = clampRange(src.oscillationSpeed, OSCILLATION_SPEED_RANGE);
  if (PULSE_LAYOUTS.includes(src.pulseLayout)) out.pulseLayout = src.pulseLayout;
  // Legacy styles (orb, blood-drop, synapse-spark) migrate through the alias table; unknown ids use crisp-dot.
  const style = PARTICLE_STYLE_ALIASES[src.particleStyle] || src.particleStyle;
  if (PARTICLE_STYLES.includes(style)) out.particleStyle = style;
  const palette = COLOR_PALETTE_ALIASES[src.colorPalette] || src.colorPalette;
  if (COLOR_PALETTES.includes(palette)) out.colorPalette = palette;
  if (KINETIC_MODES.includes(src.kineticMode)) out.kineticMode = src.kineticMode;
  if (REACTIVITY_MODES.includes(src.reactivityMode)) out.reactivityMode = src.reactivityMode;
  if (Number.isFinite(src.reactivityGain)) out.reactivityGain = clampRange(src.reactivityGain, REACTIVITY_GAIN_RANGE);
  if (Number.isFinite(src.cameraZoom)) out.cameraZoom = clampRange(src.cameraZoom, CAMERA_ZOOM_RANGE);
  return out;
}

const SCENE_SHORT = {
  [PARTICLE_SCENE_ID]: "particles",
  [PULSE_SCENE_ID]: "pulse",
  [MEGASTRUCTURE_SCENE_ID]: "mega",
  [SPECTRAL_CANYON_SCENE_ID]: "canyon",
  [AURORA_SCENE_ID]: "aurora",
};

/** `?preset=scene:particles_flow:fish_shape:dart_size:1.5_k:6_spin:1_count:auto` */
export function encodePresetParam(sceneId, particles) {
  const p = normalizeParticles(particles);
  // Only supported scenes get a token; an unknown ID is omitted rather than coerced to "particles",
  // so a reload can never flip the scene.
  const short = SCENE_IDS.includes(sceneId) ? SCENE_SHORT[sceneId] : null;
  return [
    ...(short ? [`scene:${short}`] : []),
    `flow:${p.flowMode}`,
    `shape:${p.shape}`,
    `size:${Number(p.particleSize.toFixed(2))}`,
    `k:${p.kaleidoSegments}`,
    `spin:${p.kaleidoSpin ? 1 : 0}`,
    `count:${p.particleCountTier}`,
    `das:${p.densityAutoScale ? 1 : 0}`,
    `tl:${Number(p.trailLength.toFixed(2))}`,
    `tt:${p.trailType}`,
    `form:${p.formationType}`,
    `logo:${encodeURIComponent(p.attractorText).replaceAll("_", "%5F")}`,
    `osc:${p.oscillationType}`,
    `oa:${Number(p.oscillationAmount.toFixed(2))}`,
    `os:${Number(p.oscillationSpeed.toFixed(2))}`,
    `pl:${p.pulseLayout}`,
    `ps:${p.particleStyle}`,
    `cp:${p.colorPalette}`,
    `km:${p.kineticMode}`,
    `rm:${p.reactivityMode}`,
  ].join("_");
}

/** Accepts the encoded form above or a bare flow name (`?preset=gas`). Returns null when nothing usable. */
export function decodePresetParam(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 400) return null;
  if (FLOW_MODES.includes(value)) {
    return { sceneId: PARTICLE_SCENE_ID, particles: { flowMode: value } };
  }
  const result = { particles: {} };
  let matched = false;
  for (const part of value.split("_")) {
    const [key, raw] = part.split(":");
    if (raw == null) continue;
    matched = true;
    if (key === "scene") {
      if (raw === "aurora") result.sceneId = AURORA_SCENE_ID;
      else if (raw === "particles") result.sceneId = PARTICLE_SCENE_ID;
      else if (raw === "pulse") result.sceneId = PULSE_SCENE_ID;
      else if (raw === "mega") result.sceneId = MEGASTRUCTURE_SCENE_ID;
      else if (raw === "canyon") result.sceneId = SPECTRAL_CANYON_SCENE_ID;
    } else if (key === "flow") result.particles.flowMode = raw;
    else if (key === "shape") result.particles.shape = raw;
    else if (key === "size") result.particles.particleSize = Number(raw);
    else if (key === "k") result.particles.kaleidoSegments = Number(raw);
    else if (key === "spin") result.particles.kaleidoSpin = raw === "1";
    else if (key === "count") result.particles.particleCountTier = COUNT_TIERS.includes(raw) ? raw : tierFromCount(raw);
    else if (key === "das") result.particles.densityAutoScale = raw === "1";
    else if (key === "tl") result.particles.trailLength = Number(raw);
    else if (key === "tt") result.particles.trailType = raw;
    else if (key === "form") result.particles.formationType = raw;
    else if (key === "logo") {
      try {
        result.particles.attractorText = decodeURIComponent(raw);
      } catch {
        result.particles.attractorText = "AI: UNDERGROUND";
      }
    }
    else if (key === "osc") result.particles.oscillationType = raw;
    else if (key === "oa") result.particles.oscillationAmount = Number(raw);
    else if (key === "os") result.particles.oscillationSpeed = Number(raw);
    else if (key === "pl") result.particles.pulseLayout = raw;
    else if (key === "ps") result.particles.particleStyle = raw;
    else if (key === "cp") result.particles.colorPalette = raw;
    else if (key === "km") result.particles.kineticMode = raw;
    else if (key === "rm") result.particles.reactivityMode = raw;
  }
  return matched ? result : null;
}

/** ZUR-GH-007: effective trail length; logo-attractor is clamped to LOGO_TRAIL_LENGTH_MAX for sharp glyphs. */
export function effectiveTrailLength(formationType, trailLength) {
  const t = Number.isFinite(trailLength) ? Math.min(1, Math.max(0, trailLength)) : 0;
  return formationType === "logo-attractor" ? Math.min(t, LOGO_TRAIL_LENGTH_MAX) : t;
}

/** ZUR-GH-007: oscillation amount applied to formation targets (logo glyphs scaled by 0.08). */
export function effectiveOscillationAmount(formationType, amount) {
  const a = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return formationType === "logo-attractor" ? a * LOGO_OSCILLATION_SCALE : a;
}

/**
 * ZUR-GH-007: camera billboard basis for the logo plane (right = forward x worldUp, up = right x forward).
 * Falls back to +X / +Y before the first camera frame.
 */
export function billboardBasis(eye, target = [0, 0, 0], outRight = new Float32Array(3), outUp = new Float32Array(3)) {
  let fx = target[0] - eye[0];
  let fy = target[1] - eye[1];
  let fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz);
  if (!(fl > 1e-6)) {
    outRight[0] = 1; outRight[1] = 0; outRight[2] = 0;
    outUp[0] = 0; outUp[1] = 1; outUp[2] = 0;
    return { right: outRight, up: outUp };
  }
  fx /= fl; fy /= fl; fz /= fl;
  // right = forward x (0, 1, 0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  outRight[0] = rx; outRight[1] = 0; outRight[2] = rz;
  // up = right x forward
  outUp[0] = 0 * fz - rz * fy;
  outUp[1] = rz * fx - rx * fz;
  outUp[2] = rx * fy - 0 * fx;
  return { right: outRight, up: outUp };
}

/**
 * ZUR-GH-007: JS mirror of sim.vert.glsl golden-spiral fractal-core shell directions (static, t = 0):
 * returns xyz unit directions for `count` agents so contracts can assert a true 3D volume (no planar ring).
 */
export function fractalCoreShellDirections(count) {
  const n = Math.max(1, Math.floor(count));
  const out = new Float32Array(n * 3);
  for (let id = 0; id < n; id += 1) {
    const i = id + 0.5;
    const phi = Math.acos(Math.min(1, Math.max(-1, 1 - (2 * i) / n)));
    const theta = i * 2.39996323;
    out[id * 3] = Math.sin(phi) * Math.cos(theta);
    out[id * 3 + 1] = Math.cos(phi);
    out[id * 3 + 2] = Math.sin(phi) * Math.sin(theta);
  }
  return out;
}

/**
 * ZUR-GH-007: shared optical centre (uv) of the swarm, the raymarched core and the kaleidoscope fold.
 * NDC (0.0, u_viewportYOffset) -> uv (0.5, 0.5 + 0.5 * u_viewportYOffset).
 */
export function opticalCenterUv(viewportYOffset = 0) {
  const offset = Number.isFinite(viewportYOffset) ? viewportYOffset : 0;
  return [0.5, 0.5 + 0.5 * offset];
}

// ---- ZUR-GH-009 pure mirrors of shader / input math (pinned by tests/verify-contracts.mjs) ----

export function clampCameraZoom(value) {
  return Number.isFinite(value) ? clampRange(value, CAMERA_ZOOM_RANGE) : 1;
}

/** Two-finger pinch: newZoom = clamp(startZoom * currentDist / startDist). */
export function pinchZoom(startZoom, startDist, currentDist) {
  if (!(startDist > 0) || !Number.isFinite(currentDist)) return clampCameraZoom(startZoom);
  return clampCameraZoom(startZoom * (currentDist / startDist));
}

/** Wheel zoom: scroll up (negative deltaY) zooms in. */
export function wheelZoom(zoom, deltaY) {
  return clampCameraZoom(zoom * Math.exp(-Math.max(-400, Math.min(400, deltaY)) * 0.0015));
}

/** Radial kick applied to sim target positions even when Oscillation amount is 0 (sim.vert.glsl). */
export function radialKick(gain, sub, bass) {
  return 1 + 0.28 * gain * (sub * 0.65 + bass * 0.35);
}

/** ZUR-GH-013 tightening: formations that never swell on sustained audio (logo, brain, black hole, wormhole). */
export const STRUCTURED_FORMATIONS = Object.freeze(["logo-attractor", "neural-brain", "supermassive-blackhole", "wormhole"]);
export const STRUCTURED_ONSET_PULSE = 0.08;
/** Target scale for a formation: structured ones get only a <= 1.08x transient onset micro-pulse. */
export function formationKick(formationType, gain, sub, bass, onset = 0, gate = 1) {
  if (STRUCTURED_FORMATIONS.includes(formationType)) {
    const o = Math.min(1, Math.max(0, Number.isFinite(onset) ? onset : 0));
    const g = Math.min(1, Math.max(0, Number.isFinite(gate) ? gate : 0));
    return 1 + STRUCTURED_ONSET_PULSE * o * g;
  }
  return radialKick(gain, sub, bass);
}

/** Onset velocity impulse (sim.vert.glsl). */
export function onsetImpulse(gain, onset) {
  return onset * 2.2 * gain;
}

/** Point-size pulse (render.vert.glsl). */
export function pointSizePulse(gain, bass, onset) {
  return 1 + 0.45 * gain * (bass * 0.5 + onset * 0.5);
}

/**
 * v_neuralPulse mirror (render.vert.glsl). ZUR-GH-013: the amplitude comes strictly from the audio bands (the old 0.45
 * idle baseline was deleted), so silence never fires a wave.
 */
export function neuralAudioDrive(sub, bass, onset, treble) {
  return Math.min(1.5, Math.max(0, sub * 0.5 + bass * 0.8 + onset * 1.3 + treble * 0.6));
}
export function neuralPulse(radius, time, onset, treble, sub = 0, bass = 0) {
  const wave = Math.sin(radius * 14 - time * 9 - onset * 5);
  const t = Math.min(1, Math.max(0, (wave - 0.72) / (0.98 - 0.72)));
  return t * t * (3 - 2 * t) * neuralAudioDrive(sub, bass, onset, treble);
}

/** Weighted band centroid 0..1 (sub = 0 ... treble = 1) fed to u_spectralCentroid. */
export function spectralCentroidFromBands(sub, bass, lowMid, highMid, treble) {
  const sum = sub + bass + lowMid + highMid + treble;
  if (!(sum > 1e-6)) return 0.5;
  return (bass * 0.25 + lowMid * 0.5 + highMid * 0.75 + treble) / sum;
}

/** Saturation floor used by the true-neon palette (render.frag.glsl satFloor). Input / output linear-ish rgb. */
export function hsvSaturation([r, g, b]) {
  const mx = Math.max(r, g, b);
  return mx <= 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

// ---- ZUR-GH-010 pure mirrors of shader math (pinned by tests/verify-contracts.mjs) ----

/** render.frag.glsl crowdNorm: clamp(pow(65536 / max(count, 65536), 0.58), 0.28, 1.0). */
export function densityCrowdNorm(activeCount) {
  return Math.min(1, Math.max(0.28, (65536 / Math.max(activeCount, 65536)) ** 0.58));
}

/** render.vert.glsl: sub-linear sprite radius damping above 1x zoom (1 / zoom^0.35). */
export function zoomSpriteDamp(zoom) {
  return zoom > 1 ? 1 / zoom ** 0.35 : 1;
}
/** render.vert.glsl max sprite radius in px (ZUR-GH-013: one 14 px ceiling; the 28 px blood ceiling was deleted). */
export const SPRITE_MAX_PX = 14;
export function spriteRadiusPx(rawRadiusPx, zoom) {
  return Math.min(rawRadiusPx * zoomSpriteDamp(zoom), SPRITE_MAX_PX);
}

/** Stage 5 formations (u_formationType >= 6): minimum tether stiffness and turbulent-curl cap (fraction of formation radius). */
export const FORMATION_LOCK_MIN_INDEX = 6;
export const FORMATION_TETHER_MIN = 4.2;
export const FORMATION_CURL_CAP = 0.18;
export function formationTether(formationIndex, pull) {
  return formationIndex >= FORMATION_LOCK_MIN_INDEX ? Math.max(pull, FORMATION_TETHER_MIN) : pull;
}
export function formationCurlCap(formationRadius) {
  return FORMATION_CURL_CAP * formationRadius;
}

/**
 * Interstellar Gargantua (supermassive-blackhole, FORMATION_TYPES index 8 — the ticket's index matches the real one).
 * 60% tilted spiral accretion disk / 28% full-360 Einstein photon ring / 12% collimated polar jets.
 * Radii are normalised formation units (sim.vert.glsl scales by HOLE_SCALE).
 */
export const BLACKHOLE_FORMATION_INDEX = 8;
export const BH_DISK_FRACTION = 0.60;
export const BH_RING_FRACTION = 0.28;
export const BH_JET_FRACTION = 0.12;
export const BH_HORIZON_RADIUS = 0.24;
export const BH_DISK_TILT_DEG = 14;
/** Lateral keep-out about the view axis through the hole: nothing is lit in front of / behind the event horizon. */
export const BH_SHADOW_RADIUS = 0.36;
export const BH_PHOTON_RING_RADIUS = 0.42;
export const BH_DISK_INNER_RADIUS = 0.46;
export function blackHoleKind(u) {
  if (u < BH_DISK_FRACTION) return "disk";
  if (u < BH_DISK_FRACTION + BH_RING_FRACTION) return "ring";
  return "jet";
}
/** True when a formation-space position (view-aligned: xy lateral, z along the view axis) is inside the void. */
export function insideBlackHoleVoid([x, y, z]) {
  return Math.hypot(x, y, z) < BH_HORIZON_RADIUS || Math.hypot(x, y) < BH_SHADOW_RADIUS;
}

/** Golden Cortex palette (ZUR-GH-010): 80% translucent cortical gold soma / 20% cyan-white axon tracts + firing waves. */
/** ZUR-GH-011: resting soma alpha floor (was 0.26), applied before the density norm so idle brains are not muddy. */
export const GOLDEN_CORTEX_SOMA_ALPHA = 0.52;
/** ZUR-GH-011: metallic gold soma radiance (#FFD700 -> #FFA800). */
export const GOLDEN_CORTEX_SOMA_RADIANCE = 1.85;
/** ZUR-GH-011: electric cyan-white (#00FFFF -> #FFFFFF) axon flash boost (was 2.8). */
export const GOLDEN_CORTEX_PULSE_BOOST = 3.2;
/** ZUR-GH-011 idle thalamic rhythm peak. ZUR-GH-013: only used by reactivityMode "ambient-vj" (never true-gate). */
export const GOLDEN_CORTEX_THALAMIC_PEAK = 0.78;

/** render.vert.glsl thalamic baseline mirror: slow radial sweep that keeps golden-cortex firing with no audio. */
export function thalamicPulse(radius, time, seed) {
  const sweep = Math.sin(radius * 6 - time * 3.8 + seed * 1.7);
  const t = Math.min(1, Math.max(0, (sweep - 0.55) / (0.95 - 0.55)));
  return t * t * (3 - 2 * t) * GOLDEN_CORTEX_THALAMIC_PEAK;
}

export const GOLDEN_CORTEX_SOMA_FRACTION = 0.8;
/** Golden Cortex split + firing threshold (ZUR-GH-010, unchanged by ZUR-GH-011). */
export const GOLDEN_CORTEX_PULSE_THRESHOLD = 0.55;
// GOLDEN_CORTEX_PULSE_BOOST / GOLDEN_CORTEX_SOMA_ALPHA above supersede the ZUR-GH-010 2.8 / 0.26 values.

// ---- ZUR-GH-013 (v6.0) pure mirrors of shader math (pinned by tests/verify-contracts.mjs) ----

/** True silence-to-peak gate thresholds: cleanGate = smoothstep(0.018, 0.13, maxBandEnergy * u_reactivityGain). */
export const CLEAN_GATE_LO = 0.018;
export const CLEAN_GATE_HI = 0.13;
function gateSmoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
export function maxBandEnergy(bands) {
  let m = 0;
  for (const value of bands || []) if (Number.isFinite(value) && value > m) m = value;
  return m;
}
export function cleanGate(maxEnergy, reactivityGain = 1) {
  const x = (Number.isFinite(maxEnergy) ? maxEnergy : 0) * (Number.isFinite(reactivityGain) ? reactivityGain : 1);
  return gateSmoothstep(CLEAN_GATE_LO, CLEAN_GATE_HI, x);
}
/** ember-floor keeps a 0.06 outline between beats. */
export const EMBER_FLOOR = 0.06;
/** render.vert.glsl emissionFor(): true-gate = gate (0.00 at silence), ember-floor = max(gate, 0.06), ambient-vj = 1. */
export function reactivityEmission(mode, gate) {
  if (mode === "ember-floor") return Math.max(gate, EMBER_FLOOR);
  if (mode === "ambient-vj") return 1;
  return gate;
}
/** With the gate closed the trail decays with a 120 ms time constant (no lingering glow in silence). */
export const TRUE_GATE_TRAIL_DECAY_MS = 120;
export function gatedTrailKeep(keep, dt, gate, mode = "true-gate") {
  if (mode === "ambient-vj") return keep;
  const fast = Math.exp(-Math.max(dt, 0) / (TRUE_GATE_TRAIL_DECAY_MS / 1000));
  const closed = Math.min(keep, fast);
  const g = Math.min(1, Math.max(0, gate));
  return closed + (keep - closed) * g;
}
/** sim.vert.glsl: extra damping (k += (1 - gate) * 5) so motion settles while the gate is closed. */
export const TRUE_GATE_MOTION_DAMP = 5;
export function gatedDamping(damping, gate, mode = "true-gate") {
  return mode === "ambient-vj" ? damping : damping + (1 - Math.min(1, Math.max(0, gate))) * TRUE_GATE_MOTION_DAMP;
}

/** crisp-dot pinpoint: core = exp(-r2 * 16) with a hard cutoff at r = 1; exposure follows the live agent count. */
export const CRISP_DOT_CORE_K = 16;
export function crispDotCore(r) {
  return r >= 1 ? 0 : Math.exp(-r * r * CRISP_DOT_CORE_K);
}
export function crispDotExposure(activeCount) {
  return Math.min(1, Math.max(0.16, (16384 / Math.max(activeCount, 1)) ** 0.52));
}
/** star-streak: 1 + clamp(length(vScreen) * (16 + 45 * bass + 60 * onset), 0, 18); stretch == 1 at rest (crisp head). */
export function starStreakStretch(screenSpeed, bass, onset) {
  return 1 + Math.min(18, Math.max(0, screenSpeed * (16 + 45 * bass + 60 * onset)));
}
/** Energy conservation: the streak spreads the same energy as the resting dot. */
export function starStreakConserve(stretch) {
  return 1 / (1 + 0.35 * (Math.max(stretch, 1) - 1));
}
export const DART_SCALE = 0.55;
export const SYNAPSE_SPARK_FRACTION = 0.15;

/** Spherical wormhole horn torus (sim.vert.glsl wormholeTarget). */
export const WORMHOLE_SHELL_R = 0.94;
export const WORMHOLE_THROAT_R = 0.08;
export const WORMHOLE_TILT_DEG = 22;
export const WORMHOLE_SCALE = 2.6;
export function wormholePoint(u, v) {
  const theta = u * Math.PI * 2;
  const phi = v * Math.PI * 2;
  const rxz = 0.51 + 0.43 * Math.cos(theta);
  const y = 0.76 * Math.sin(theta) * (0.52 + (1 - 0.52) * (0.5 + 0.5 * Math.cos(theta)));
  const x = rxz * Math.cos(phi);
  const z = rxz * Math.sin(phi);
  const a = (WORMHOLE_TILT_DEG * Math.PI) / 180;
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

/** Anatomical 3D Brain region split (sim.vert.glsl brainRegion). */
export const BRAIN_CEREBRUM_FRACTION = 0.82;
export const BRAIN_CEREBELLUM_FRACTION = 0.11;
export const BRAIN_BRAINSTEM_FRACTION = 0.07;
export const BRAIN_LONGITUDINAL_GAP = 0.045;
export const BRAIN_GYRI_AMPLITUDE = 0.03;
export const BRAIN_VIEW_YAW_DEG = 32;
export function brainRegion(u) {
  if (u < BRAIN_CEREBRUM_FRACTION) return "cerebrum";
  if (u < BRAIN_CEREBRUM_FRACTION + BRAIN_CEREBELLUM_FRACTION) return "cerebellum";
  return "brainstem";
}

/** Harmonic Ferrofluid Rings: 70% spherical-harmonic spike shell on 5 FFT bands + 30% concentric EQ rings. */
export const FERRO_SHELL_FRACTION = 0.70;
export const FERRO_RING_FRACTION = 0.30;
export const FERRO_HARMONIC_DEGREES = Object.freeze([2, 3, 4, 6, 8]);

/** render.frag.glsl gradientT(): continuous palette coordinate (no angular term => no hue seams). */
export function paletteGradientT(radialNorm, depthNorm, speedNorm, centroid, jitter = 0) {
  return 0.62 * radialNorm + 0.28 * depthNorm + 0.18 * speedNorm + 0.30 * centroid + jitter;
}
/** iq cosine palette a + b * cos(TAU * (c * t + d)). */
export function cosinePalette(t, a, b, c, d) {
  return [0, 1, 2].map((i) => a[i] + b[i] * Math.cos(Math.PI * 2 * (c[i] * t + d[i])));
}
