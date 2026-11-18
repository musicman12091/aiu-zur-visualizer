import { NEON_PALETTE_IDS } from "../controls/palettes.js";
import { COLOR_PALETTES, normalizeParticles } from "../render/particleMath.js";

export const VJ_DWELL_SECONDS = 12;
export const VJ_MANUAL_PAUSE_SECONDS = 45;
export const VJ_PHASES = Object.freeze(["breakdown", "build-up", "drop"]);

export class VJAutopilot {
  constructor({ dwellSeconds = VJ_DWELL_SECONDS, manualPauseSeconds = VJ_MANUAL_PAUSE_SECONDS } = {}) {
    this.dwellSeconds = dwellSeconds;
    this.manualPauseSeconds = manualPauseSeconds;
    this.phaseIndex = 0;
    this.elapsed = 0;
    this.pausedFor = 0;
  }

  manualTouch() {
    this.pausedFor = this.manualPauseSeconds;
  }

  update(deltaSeconds, enabled) {
    const dt = Math.max(0, Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.25));
    if (this.pausedFor > 0) {
      this.pausedFor = Math.max(0, this.pausedFor - dt);
      return { phase: VJ_PHASES[this.phaseIndex], changed: false, paused: true };
    }
    if (!enabled) return { phase: VJ_PHASES[this.phaseIndex], changed: false, paused: false };
    this.elapsed += dt;
    if (this.elapsed < this.dwellSeconds) {
      return { phase: VJ_PHASES[this.phaseIndex], changed: false, paused: false };
    }
    this.elapsed %= this.dwellSeconds;
    this.phaseIndex = (this.phaseIndex + 1) % VJ_PHASES.length;
    return {
      phase: VJ_PHASES[this.phaseIndex],
      changed: true,
      shockwave: this.phaseIndex === 2,
      paused: false,
    };
  }
}

const KALEIDO_BY_PHASE = [0, 8, 12];
/** ZUR-GH-013: the autopilot cycles the kaleido fold and the palette only (never the scene, formation or particleStyle). */
export const AUTOPILOT_PALETTES = Object.freeze(COLOR_PALETTES.filter((id) => id !== "golden-cortex"));

export function autopilotPreset(preset, phaseIndex) {
  const next = JSON.parse(JSON.stringify(preset));
  const particles = normalizeParticles(next.particles);
  particles.kaleidoSegments = KALEIDO_BY_PHASE[phaseIndex % KALEIDO_BY_PHASE.length];
  particles.colorPalette = AUTOPILOT_PALETTES[phaseIndex % AUTOPILOT_PALETTES.length];
  next.particles = particles;
  if (["spectral-canyon-3d", "aurora-ribbons"].includes(next.sceneId)) {
    next.visual = { ...next.visual, paletteId: NEON_PALETTE_IDS[phaseIndex % NEON_PALETTE_IDS.length] };
  }
  return next;
}
