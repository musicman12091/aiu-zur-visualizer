import { NEON_PALETTE_IDS } from "../controls/palettes.js";
import { enforceTabConstraints, flattenPreset, applyFlatToPreset, TAB_RULES, layoutKeyFor } from "./AppState.js";

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

/**
 * Tab-scoped autopilot: picks only values the active tab allows (TAB_RULES) and runs the result through
 * enforceTabConstraints. The scene never changes; the Audio & Rig tab drives the last visual tab.
 */
export function autopilotPlan(flatState, phaseIndex) {
  const flat = enforceTabConstraints(flatState);
  const rules = TAB_RULES[layoutKeyFor(flat)];
  const next = { ...flat, kaleidoSegments: KALEIDO_BY_PHASE[phaseIndex % KALEIDO_BY_PHASE.length] };
  const cycle = (list) => (list && list.length ? list[phaseIndex % list.length] : undefined);
  if (rules) {
    const formation = rules.formations && rules.formations.length > 1 ? cycle(rules.formations) : undefined;
    if (formation) {
      next.formation = formation;
      next.formationType = formation;
    }
    const palettes = rules.palettes;
    if (palettes && palettes.length > 1) next.colorPalette = cycle(palettes.filter((id) => id !== "golden-cortex"));
  }
  if (["spectral-canyon-3d", "aurora-ribbons"].includes(layoutKeyFor(flat))) {
    next.paletteId = NEON_PALETTE_IDS[phaseIndex % NEON_PALETTE_IDS.length];
  }
  return enforceTabConstraints(next);
}

export function autopilotPreset(preset, phaseIndex) {
  return applyFlatToPreset(preset, autopilotPlan(flattenPreset(preset), phaseIndex));
}
