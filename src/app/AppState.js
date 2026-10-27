import { PALETTE_IDS } from "../controls/palettes.js";

export const SCHEMA_VERSION = 1;
export const INPUT_MODES = Object.freeze(["tab-capture", "microphone", "oscillator"]);
export const FFT_SIZES = Object.freeze([1024, 2048, 4096]);
const BAND_KEYS = ["sub", "bass", "lowMid", "highMid", "treble"];

/** Illustrative Preset Schema v1 object from the blueprint. */
export const BLUEPRINT_EXAMPLE_PRESET = {
  schemaVersion: 1,
  sceneId: "aurora-ribbons",
  sceneVersion: 1,
  audio: {
    inputMode: "tab-capture",
    suppressLocalAudio: true,
    includeSystemAudio: false,
    preAmpGain: 1.0,
    masterGain: 1.0,
    bandGain: { sub: 1.0, bass: 1.2, lowMid: 0.8, highMid: 0.7, treble: 0.5 },
    attackMs: 15,
    releaseMs: 180,
  },
  visual: {
    paletteId: "copper-teal",
    hueShift: 0.0,
    bloom: 0.35,
    trailHalfLifeMs: 220,
    cameraShake: 0.05,
    complexity: 0.5,
  },
  transition: {
    mode: "timer-then-onset",
    minimumDwellSeconds: 45,
    blendSeconds: 2,
  },
};

/** Mode A — PC static silent monitor. Tier 1, 1280×720 @ 30 fps, complexity 0.35. */
export const MODE_A_PRESET = {
  schemaVersion: 1,
  sceneId: "aurora-ribbons",
  sceneVersion: 1,
  name: "Mode A — PC Silent Monitor",
  audio: {
    inputMode: "tab-capture",
    suppressLocalAudio: true,
    includeSystemAudio: false,
    preAmpGain: 1.0,
    masterGain: 1.0,
    bandGain: { sub: 1.0, bass: 1.2, lowMid: 0.8, highMid: 0.7, treble: 0.5 },
    attackMs: 25,
    releaseMs: 180,
    fftSize: 2048,
    noiseGateThreshold: 0.02,
  },
  visual: {
    paletteId: "copper-teal",
    hueShift: 0.0,
    bloom: 0.35,
    trailHalfLifeMs: 220,
    cameraShake: 0.05,
    complexity: 0.35,
    gain: 1.0,
    width: 1280,
    height: 720,
    fps: 30,
    qualityTier: "safe",
  },
  transition: {
    mode: "timer-then-onset",
    minimumDwellSeconds: 45,
    blendSeconds: 2,
  },
};

/** Mode B — Galaxy A57 call-speaker. Tier 2, 1280×720 @ 60 fps, pre-amp 10×. */
export const MODE_B_PRESET = {
  schemaVersion: 1,
  sceneId: "aurora-ribbons",
  sceneVersion: 1,
  name: "Mode B — A57 Call Speaker",
  audio: {
    inputMode: "microphone",
    suppressLocalAudio: true,
    includeSystemAudio: false,
    preAmpGain: 10.0,
    masterGain: 1.0,
    bandGain: { sub: 1.3, bass: 1.4, lowMid: 1.1, highMid: 1.0, treble: 0.9 },
    attackMs: 25,
    releaseMs: 180,
    fftSize: 2048,
    noiseGateThreshold: 0.015,
  },
  visual: {
    paletteId: "copper-teal",
    hueShift: 0.0,
    bloom: 0.4,
    trailHalfLifeMs: 180,
    cameraShake: 0.04,
    complexity: 0.65,
    gain: 1.2,
    width: 1280,
    height: 720,
    fps: 60,
    qualityTier: "motion",
  },
  transition: {
    mode: "timer-then-onset",
    minimumDwellSeconds: 45,
    blendSeconds: 2,
  },
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectExecutable(value, path, errors) {
  if (typeof value === "function" || typeof value === "symbol") {
    errors.push(`${path} must be JSON data`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutable(entry, `${path}[${index}]`, errors));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      rejectExecutable(entry, `${path}.${key}`, errors);
    }
  }
}

function numberIn(value, min, max, path, errors) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path} must be a finite number from ${min} to ${max}`);
  }
}

export function validatePreset(input) {
  const errors = [];
  rejectExecutable(input, "preset", errors);
  if (!isObject(input)) {
    return { ok: false, errors: ["preset must be a JSON object"] };
  }
  if (input.schemaVersion !== SCHEMA_VERSION) errors.push("schemaVersion must be 1");
  if (typeof input.sceneId !== "string" || input.sceneId.length === 0) errors.push("sceneId is required");
  if (typeof input.sceneVersion !== "number" || !Number.isFinite(input.sceneVersion)) {
    errors.push("sceneVersion must be a finite number");
  }
  if (input.name != null && typeof input.name !== "string") errors.push("name must be a string");

  const audio = input.audio;
  if (!isObject(audio)) {
    errors.push("audio is required");
  } else {
    if (!INPUT_MODES.includes(audio.inputMode)) errors.push(`audio.inputMode must be one of ${INPUT_MODES.join(", ")}`);
    if (typeof audio.suppressLocalAudio !== "boolean") errors.push("audio.suppressLocalAudio must be boolean");
    if (typeof audio.includeSystemAudio !== "boolean") errors.push("audio.includeSystemAudio must be boolean");
    numberIn(audio.preAmpGain, 1, 25, "audio.preAmpGain", errors);
    numberIn(audio.masterGain, 0.01, 8, "audio.masterGain", errors);
    if (!isObject(audio.bandGain)) {
      errors.push("audio.bandGain is required");
    } else {
      for (const key of BAND_KEYS) {
        numberIn(audio.bandGain[key], 0, 8, `audio.bandGain.${key}`, errors);
      }
    }
    numberIn(audio.attackMs, 1, 500, "audio.attackMs", errors);
    numberIn(audio.releaseMs, 1, 2000, "audio.releaseMs", errors);
    if (audio.fftSize != null && !FFT_SIZES.includes(audio.fftSize)) {
      errors.push("audio.fftSize must be 1024, 2048, or 4096");
    }
    if (audio.noiseGateThreshold != null) numberIn(audio.noiseGateThreshold, 0, 1, "audio.noiseGateThreshold", errors);
  }

  const visual = input.visual;
  if (!isObject(visual)) {
    errors.push("visual is required");
  } else {
    if (typeof visual.paletteId !== "string" || !PALETTE_IDS.includes(visual.paletteId)) {
      errors.push(`visual.paletteId must be one of ${PALETTE_IDS.join(", ")}`);
    }
    numberIn(visual.hueShift, -1, 1, "visual.hueShift", errors);
    numberIn(visual.bloom, 0, 1, "visual.bloom", errors);
    numberIn(visual.trailHalfLifeMs, 1, 5000, "visual.trailHalfLifeMs", errors);
    numberIn(visual.cameraShake, 0, 1, "visual.cameraShake", errors);
    numberIn(visual.complexity, 0.25, 1, "visual.complexity", errors);
    if (visual.gain != null) numberIn(visual.gain, 0.1, 5, "visual.gain", errors);
    if (visual.width != null) numberIn(visual.width, 320, 3840, "visual.width", errors);
    if (visual.height != null) numberIn(visual.height, 180, 2160, "visual.height", errors);
    if (visual.fps != null) numberIn(visual.fps, 1, 120, "visual.fps", errors);
    if (visual.qualityTier != null && typeof visual.qualityTier !== "string") {
      errors.push("visual.qualityTier must be a string");
    }
  }

  const transition = input.transition;
  if (!isObject(transition)) {
    errors.push("transition is required");
  } else {
    if (transition.mode !== "timer-then-onset") errors.push('transition.mode must be "timer-then-onset"');
    numberIn(transition.minimumDwellSeconds, 45, 600, "transition.minimumDwellSeconds", errors);
    numberIn(transition.blendSeconds, 0, 30, "transition.blendSeconds", errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], preset: JSON.parse(JSON.stringify(input)) };
}

export class AppState {
  constructor(preset = MODE_A_PRESET) {
    const initial = validatePreset(preset);
    if (!initial.ok) {
      throw new Error(initial.errors.join("; "));
    }
    this.preset = initial.preset;
    this.status = {
      wakeLock: "off",
      capture: "idle",
      webgl: "pending",
      fps: 0,
    };
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type) {
    for (const listener of this.listeners) listener(type, this);
  }

  setStatus(partial) {
    this.status = { ...this.status, ...partial };
    this.emit("status");
  }

  replacePreset(preset) {
    const result = validatePreset(preset);
    if (!result.ok) return result;
    this.preset = result.preset;
    this.emit("preset");
    return result;
  }

  updatePreset(mutate) {
    const draft = JSON.parse(JSON.stringify(this.preset));
    mutate(draft);
    return this.replacePreset(draft);
  }

  exportPreset() {
    return JSON.stringify(this.preset, null, 2);
  }

  importPreset(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, errors: ["preset JSON could not be parsed"] };
    }
    return this.replacePreset(parsed);
  }
}
