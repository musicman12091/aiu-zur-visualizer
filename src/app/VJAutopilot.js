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
