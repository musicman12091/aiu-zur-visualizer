// ZUR-GH-008 — Stage 4.2 trail post-process guard.
// Steady-state FBO energy of a static emitter is 1 / (1 - keepFactor) (28.5x at keep 0.965). At >= 16k agents the
// per-60 Hz keep is capped at 0.90 and particle radiance is scaled by u_trailEnergyNorm so the closed-form steady
// state stays bounded: (1 / (1 - k)) * clamp((1 - k) / (1 - 0.55), 0.18, 1) = 1 / 0.45 for every k in [0.55, 0.918].

/** Agent count at which the steady-state keep cap engages. */
export const TRAIL_HIGH_COUNT = 16384;
/** Per-60 Hz keepFactor ceiling for dense (>= 16k) swarms. */
export const TRAIL_KEEP_CAP = 0.90;
/** keepFactor at which u_trailEnergyNorm == 1 (normalisation reference). */
export const TRAIL_ENERGY_REF_KEEP = 0.55;
/** Lower clamp for u_trailEnergyNorm. */
export const TRAIL_ENERGY_NORM_MIN = 0.18;
/** Formation / flow / scene change: trail history decays fast for this long. */
export const TRAIL_TRANSITION_MS = 250;
/** keepFactor ceiling inside the transition decay window. */
export const TRAIL_TRANSITION_KEEP_MAX = 0.45;

/** Caps the per-60 Hz keepFactor at 0.90 when activeCount >= 16384 (and at transitionCap while a switch clears). */
export function capKeepFactor(keep60, activeCount, transitionCap = 1) {
  let keep = Number.isFinite(keep60) ? Math.max(0, keep60) : 0;
  if (activeCount >= TRAIL_HIGH_COUNT) keep = Math.min(keep, TRAIL_KEEP_CAP);
  return Math.min(keep, transitionCap);
}

/** u_trailEnergyNorm = clamp((1 - keepFactor) / (1 - 0.55), 0.18, 1.0). */
export function trailEnergyNorm(keep60) {
  const k = Number.isFinite(keep60) ? keep60 : 0;
  return Math.min(1, Math.max(TRAIL_ENERGY_NORM_MIN, (1 - k) / (1 - TRAIL_ENERGY_REF_KEEP)));
}

/** Closed-form steady-state accumulation of a unit emitter after normalisation. */
export function normalizedSteadyStateEnergy(keep60) {
  const k = Math.min(Math.max(keep60, 0), 0.9999);
  return trailEnergyNorm(k) / (1 - k);
}

/** render.frag.glsl sizeNorm: 1 / pow(max(size, 1), 0.65) once Particle size > 1.5, else 1. */
export function particleSizeNorm(particleSize) {
  if (!(particleSize > 1.5)) return 1;
  return 1 / Math.max(particleSize, 1) ** 0.65;
}

/** Identity of what is drawn: a change in any of these starts a trail transition decay window. */
export function transitionSignature(sceneId, formationType, flowMode) {
  return `${sceneId || ""}|${formationType || ""}|${flowMode || ""}`;
}

/**
 * Watches AppState sceneId / formationType / flowMode. On a change it opens a 250 ms window where the trail
 * keepFactor is clamped to <= 0.45, so stale formation silhouettes clear without a hard (keep = 0) flash.
 */
export class TrailTransitionGuard {
  constructor({ durationMs = TRAIL_TRANSITION_MS, keepMax = TRAIL_TRANSITION_KEEP_MAX } = {}) {
    this.durationMs = durationMs;
    this.keepMax = keepMax;
    this.signature = null;
    this.startedAt = -Infinity;
    this.count = 0;
  }

  /** Returns true when this call started a new transition window. The first observation never triggers. */
  observe(signature, nowMs) {
    if (this.signature === null) {
      this.signature = signature;
      return false;
    }
    if (signature === this.signature) return false;
    this.signature = signature;
    this.startedAt = nowMs;
    this.count += 1;
    return true;
  }

  active(nowMs) {
    return nowMs - this.startedAt >= 0 && nowMs - this.startedAt < this.durationMs;
  }

  /** keepFactor ceiling for this frame: 0.45 inside the window, 1 (no clamp) outside. */
  keepCap(nowMs) {
    return this.active(nowMs) ? this.keepMax : 1;
  }
}
