/** Timer-then-onset gate. Stage 1 ships one scene, so a pass does not swap programs. */
export class TransitionController {
  constructor({
    mode = "timer-then-onset",
    minimumDwellSeconds = 45,
    blendSeconds = 2,
    sceneId = "aurora-ribbons",
    onsetThreshold = 0.65,
  } = {}) {
    this.mode = mode;
    this.minimumDwellSeconds = minimumDwellSeconds;
    this.blendSeconds = blendSeconds;
    this.onsetThreshold = onsetThreshold;
    this.activeSceneId = sceneId;
    this.elapsed = 0;
    this.blend = 0;
    this.switching = false;
  }

  update(deltaSeconds, onset) {
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.elapsed += dt;
    const dwellMet = this.elapsed >= this.minimumDwellSeconds;
    const onsetHit = Number.isFinite(onset) && onset >= this.onsetThreshold;
    let started = false;
    if (!this.switching && this.mode === "timer-then-onset" && dwellMet && onsetHit) {
      this.switching = true;
      started = true;
    }
    if (this.switching) {
      const step = this.blendSeconds > 0 ? dt / this.blendSeconds : 1;
      this.blend = Math.min(1, this.blend + step);
    }
    return {
      sceneId: this.activeSceneId,
      canSwitch: this.switching,
      started,
      dwellMet,
      blend: this.blend,
      elapsed: this.elapsed,
    };
  }

  commitSwitch(nextSceneId) {
    if (!this.switching) return false;
    this.activeSceneId = nextSceneId;
    this.elapsed = 0;
    this.blend = 0;
    this.switching = false;
    return true;
  }
}
