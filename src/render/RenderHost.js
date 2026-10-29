import { clamp01 } from "../audio/FeatureExtractor.js";
import { PALETTES, shiftPalette } from "../controls/palettes.js";
import { PARTICLE_SCENE_ID, normalizeParticles } from "./particleMath.js";

/** Four hardware tiers. Tier 1 matches Mode A; Tier 2 matches Mode B. */
export const QUALITY_TIERS = Object.freeze([
  Object.freeze({
    id: "safe",
    label: "Tier 1 Safe Baseline",
    width: 1280,
    height: 720,
    fps: 30,
    complexity: 0.35,
    maxRaymarchSteps: 32,
  }),
  Object.freeze({
    id: "motion",
    label: "Tier 2 Motion Target",
    width: 1280,
    height: 720,
    fps: 60,
    complexity: 0.65,
    maxRaymarchSteps: 48,
  }),
  Object.freeze({
    id: "enhanced",
    label: "Tier 3 Enhanced",
    width: 1600,
    height: 900,
    fps: 60,
    complexity: 0.85,
    maxRaymarchSteps: 64,
  }),
  Object.freeze({
    id: "high",
    label: "Tier 4 High",
    width: 1920,
    height: 1080,
    fps: 60,
    complexity: 1,
    maxRaymarchSteps: 80,
  }),
]);

export function resolveRenderSize(preset) {
  const visual = preset?.visual || {};
  const tier = QUALITY_TIERS.find((item) => item.id === visual.qualityTier) || QUALITY_TIERS[0];
  return {
    width: visual.width || tier.width,
    height: visual.height || tier.height,
    fps: visual.fps || tier.fps,
    complexity: visual.complexity ?? tier.complexity,
    tier,
  };
}

export function shouldRenderFrame(elapsedMs, fps) {
  if (!(fps > 0)) return true;
  return elapsedMs + 0.5 >= 1000 / fps;
}

export class RenderHost {
  constructor({ canvas, shaderHost, extractor, getPreset, transition, onFrame, readAudio }) {
    this.canvas = canvas;
    this.shaderHost = shaderHost;
    this.extractor = extractor;
    this.getPreset = getPreset;
    this.transition = transition;
    this.onFrame = onFrame;
    this.readAudio = readAudio;
    this.running = false;
    this.pausedForContextLoss = false;
    this.lastStamp = 0;
    this.sceneStartedAt = 0;
    this.framesThisSecond = 0;
    this.fpsWindowStart = 0;
    this.displayedFps = 0;
    this._raf = 0;
    this.particleSystem = null;
    this.particleError = "";
    this.activeScene = "";
    shaderHost.onContextLost = () => {
      this.pausedForContextLoss = true;
    };
    shaderHost.onContextRestored = () => {
      this.pausedForContextLoss = false;
      if (this.particleSystem) {
        try {
          this.particleSystem.gl = this.shaderHost.gl;
          this.particleSystem.init();
        } catch (error) {
          this.particleError = error?.message || String(error);
        }
      }
      this.applySize();
    };
  }

  /** Stage 2: attach the transform-feedback particle scene (shares the ShaderHost context). */
  setParticleSystem(particleSystem) {
    this.particleSystem = particleSystem;
    if (particleSystem && this.shaderHost.width) {
      particleSystem.resize(this.shaderHost.width, this.shaderHost.height);
    }
  }

  /** Scene actually drawn this frame: particles when requested and ready, else aurora. */
  resolveScene(preset) {
    if (preset?.sceneId === PARTICLE_SCENE_ID && this.particleSystem?.ready) return PARTICLE_SCENE_ID;
    return "aurora-ribbons";
  }

  applySize() {
    const size = resolveRenderSize(this.getPreset());
    this.shaderHost.resize(size.width, size.height);
    this.particleSystem?.resize(size.width, size.height);
    return size;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastStamp = 0;
    this.sceneStartedAt = 0;
    this._raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _loop = (now) => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    if (this.pausedForContextLoss) return;
    const preset = this.getPreset();
    const size = resolveRenderSize(preset);
    if (this.shaderHost.width !== size.width || this.shaderHost.height !== size.height) {
      this.shaderHost.resize(size.width, size.height);
      this.particleSystem?.resize(size.width, size.height);
    }
    let deltaSeconds;
    if (this.lastStamp !== 0) {
      const elapsed = now - this.lastStamp;
      if (!shouldRenderFrame(elapsed, size.fps)) return;
      deltaSeconds = Math.min(0.1, elapsed / 1000);
    } else {
      deltaSeconds = 1 / size.fps;
      this.sceneStartedAt = now;
      this.fpsWindowStart = now;
    }
    this.lastStamp = now;
    this.framesThisSecond += 1;
    if (now - this.fpsWindowStart >= 1000) {
      this.displayedFps = this.framesThisSecond;
      this.framesThisSecond = 0;
      this.fpsWindowStart = now;
      if (this.activeScene === PARTICLE_SCENE_ID) {
        this.particleSystem?.reportFps(this.displayedFps, size.fps, preset.particles?.countTier ?? "auto");
      }
    }

    const snapshot = this.readAudio?.() ?? null;
    if (snapshot && (snapshot.sampleRate !== this.extractor.sampleRate || snapshot.fftSize !== this.extractor.fftSize)) {
      this.extractor.configure({ sampleRate: snapshot.sampleRate, fftSize: snapshot.fftSize });
    }
    const frame = snapshot
      ? this.extractor.update({ ...snapshot, deltaSeconds })
      : this.extractor.update({
        timestampSeconds: now / 1000,
        deltaSeconds,
        frequencyDb: this.extractor.silentSpectrum(),
        waveform: this.extractor.silentWaveform(),
      });
    const transition = this.transition?.update(deltaSeconds, frame.onset) ?? null;
    const visual = preset.visual;
    const mid = clamp01((frame.lowMid + frame.highMid) * 0.5);
    const palette = shiftPalette(PALETTES[visual.paletteId] || PALETTES["copper-teal"], visual.hueShift || 0);
    this.shaderHost.setFrame({
      time: Math.max(0, (now - this.sceneStartedAt) / 1000),
      delta: deltaSeconds,
      rms: frame.rms,
      sub: frame.sub,
      bass: frame.bass,
      mid,
      high: frame.treble,
      onset: frame.onset,
      beat: frame.beat,
      gain: visual.gain ?? 1,
      complexity: size.complexity,
      trailHalfLifeMs: visual.trailHalfLifeMs,
      cameraShake: visual.cameraShake,
      bloom: visual.bloom,
      palette,
    });
    const scene = this.resolveScene(preset);
    if (scene !== this.activeScene) {
      if (scene === PARTICLE_SCENE_ID && this.particleSystem) this.particleSystem.resetAuto();
      this.activeScene = scene;
    }
    if (scene === PARTICLE_SCENE_ID) {
      const particles = preset.particles || this._defaultParticles || (this._defaultParticles = normalizeParticles(null));
      this.particleSystem.render(
        this.shaderHost.frame,
        this.shaderHost.palette,
        particles,
        visual,
        this.canvas.width,
        this.canvas.height,
      );
    } else {
      this.shaderHost.render();
    }
    this.onFrame?.({ frame, deltaSeconds, fps: this.displayedFps, transition, size });
  };
}
