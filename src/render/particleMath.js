/**
 * Stage 2 pure math shared by ParticleSystem3D.js and tests/verify-contracts.mjs.
 * Every helper here mirrors a GLSL routine in src/shaders/*.glsl so the
 * contract tests can pin the numbers without a GPU.
 */

export const PARTICLE_SCENE_ID = "particle-swarm-3d";
export const AURORA_SCENE_ID = "aurora-ribbons";
export const SCENE_IDS = Object.freeze([PARTICLE_SCENE_ID, AURORA_SCENE_ID]);

/** Flow modes, in the order of the `u_mode` integer in sim.vert.glsl. */
export const FLOW_MODES = Object.freeze(["fluid", "gas", "murmuration", "fish"]);
export const FLOW_LABELS = Object.freeze({
  fluid: "Fluid",
  gas: "Gas",
  murmuration: "Murmuration (Birds)",
  fish: "School of Fish",
});
export const PARTICLE_SHAPES = Object.freeze(["dart", "capsule"]);
export const KALEIDO_SEGMENTS = Object.freeze([0, 4, 6, 8, 12, 16]);
export const COUNT_TIERS = Object.freeze(["auto", 4096, 16384, 32768, 65536]);
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
});

export const DEFAULT_PARTICLES = Object.freeze({
  flowMode: "murmuration",
  shape: "dart",
  particleSize: 1.0,
  kaleidoSegments: 0,
  kaleidoSpin: true,
  countTier: "auto",
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
  const E = trailKeep(dt, trailTauSeconds);
  const ref = 1 - Math.exp(-1 / (60 * trailTauSeconds));
  return (1 - E) / Math.max(ref, 1e-4);
}

/** Steady-state accumulated radiance of a static emitter with unit per-frame radiance. */
export function steadyStateRadiance(dt, trailTauSeconds) {
  const E = trailKeep(dt, trailTauSeconds);
  return trailRadianceScale(dt, trailTauSeconds) / Math.max(1 - E, 1e-9);
}

/** JS mirror of kaleidoFold() in kaleido.frag.glsl. Segments <= 1 is a 1:1 bypass. */
export function kaleidoFold(u, v, segments, angle, aspect, zoom = 1) {
  if (!(segments > 1)) return [u, v];
  const px = (u - 0.5) * aspect;
  const py = v - 0.5;
  const r = Math.hypot(px, py) / Math.max(zoom, 0.25);
  const wedge = (Math.PI * 2) / segments;
  let a = Math.atan2(py, px) + angle;
  a -= wedge * Math.floor(a / wedge);
  a = Math.abs(a - wedge * 0.5);
  return [(Math.cos(a) * r) / aspect + 0.5, Math.sin(a) * r + 0.5];
}

/** Reinhard x / (1 + x) per channel (the ticket's filmic c / (1 + c)). */
export function toneMap(x) {
  return x / (1 + x);
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
  if (typeof countTier === "number" && COUNT_TIERS.includes(countTier)) return countTier;
  return mobile ? MOBILE_PARTICLES : DESKTOP_PARTICLES;
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
  if (COUNT_TIERS.includes(src.countTier)) out.countTier = src.countTier;
  return out;
}

const SCENE_SHORT = { [PARTICLE_SCENE_ID]: "particles", [AURORA_SCENE_ID]: "aurora" };

/** `?preset=scene:particles_flow:fish_shape:dart_size:1.5_k:6_spin:1_count:auto` */
export function encodePresetParam(sceneId, particles) {
  const p = normalizeParticles(particles);
  return [
    `scene:${SCENE_SHORT[sceneId] || "particles"}`,
    `flow:${p.flowMode}`,
    `shape:${p.shape}`,
    `size:${Number(p.particleSize.toFixed(2))}`,
    `k:${p.kaleidoSegments}`,
    `spin:${p.kaleidoSpin ? 1 : 0}`,
    `count:${p.countTier}`,
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
    } else if (key === "flow") result.particles.flowMode = raw;
    else if (key === "shape") result.particles.shape = raw;
    else if (key === "size") result.particles.particleSize = Number(raw);
    else if (key === "k") result.particles.kaleidoSegments = Number(raw);
    else if (key === "spin") result.particles.kaleidoSpin = raw === "1";
    else if (key === "count") result.particles.countTier = raw === "auto" ? "auto" : Number(raw);
  }
  return matched ? result : null;
}
