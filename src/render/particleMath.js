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
  fish: "School of Fish",
  physarum: "Physarum Neural Web",
});
export const PARTICLE_SHAPES = Object.freeze(["dart", "capsule"]);
export const KALEIDO_SEGMENTS = Object.freeze([0, 4, 6, 8, 12, 16]);
export const COUNT_TIERS = Object.freeze(["auto", "64", "128", "256", "512", "1k", "2k", "4k", "16k", "32k", "64k"]);
export const COUNT_TIER_VALUES = Object.freeze({
  "64": 64,
  "128": 128,
  "256": 256,
  "512": 512,
  "1k": 1024,
  "2k": 2048,
  "4k": 4096,
  "16k": 16384,
  "32k": 32768,
  "64k": 65536,
});
export const COUNT_TIER_LABELS = Object.freeze({ auto: "Auto (64k desktop / 16k mobile)" });
export const TRAIL_TYPES = Object.freeze(["comet", "electric", "strobe", "ribbon", "none"]);
export const FORMATION_TYPES = Object.freeze([
  "free-3d", "neon-tunnel", "polygon-rings", "supernova-shell", "fractal-core", "logo-attractor",
]);
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
export const MAX_PARTICLES = 65536;
export const MIN_PARTICLES = 4096;
export const DESKTOP_PARTICLES = 65536;
export const MOBILE_PARTICLES = 16384;
export const PARTICLE_SIZE_RANGE = Object.freeze([0.5, 4.0]);
/** Bytes per agent: vec4 a_pos + vec4 a_vel, interleaved Float32. */
export const BYTES_PER_AGENT = 32;
export const FLOATS_PER_AGENT = 8;
/** Neighbor texture: two RGBA32F texels per agent, 256 agents per row. */
export const AGENTS_PER_ROW = 256;
export const SIM_STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 4;

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
  particleCountTier: "1k",
  densityAutoScale: true,
  trailLength: 0.28,
  trailType: "comet",
  formationType: "neon-tunnel",
  attractorText: "AI: UNDERGROUND",
  oscillationType: "helix",
  oscillationAmount: 1.0,
  oscillationSpeed: 1.2,
  pulseLayout: "band-clouds",
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

export const TONEMAP = Object.freeze({ shoulder: 0.65, whiteLo: 1.1, whiteHi: 3.2, whiteMix: 0.65 });

function smoothstep(lo, hi, x) {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** JS mirror of the chroma-preserving tone map in kaleido.frag.glsl. */
export function chromaToneMap([r, g, b]) {
  const peak = Math.max(r, Math.max(g, b));
  const inv = 1 / Math.max(peak, 1e-4);
  const mappedPeak = peak / (1 + TONEMAP.shoulder * peak);
  const white = smoothstep(TONEMAP.whiteLo, TONEMAP.whiteHi, peak) * TONEMAP.whiteMix;
  return [r, g, b].map((c) => c * inv * mappedPeak * (1 - white) + white);
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
  if (COUNT_TIERS.includes(src.particleCountTier)) out.particleCountTier = src.particleCountTier;
  else if (src.countTier != null) {
    // Stage 2 stored presets / URLs used `countTier` (auto or a number).
    const legacy = src.countTier === "auto" ? "auto" : tierFromCount(src.countTier);
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
  ].join("_");
}

/** Accepts the encoded form above or a bare flow name (`?preset=gas`). Returns null when nothing usable. */
export function decodePresetParam(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
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
    else if (key === "count") result.particles.particleCountTier = raw === "auto" || COUNT_TIERS.includes(raw) ? raw : tierFromCount(raw);
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
