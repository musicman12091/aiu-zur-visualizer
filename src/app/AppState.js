import { PALETTE_IDS } from "../controls/palettes.js";
import {
  COUNT_TIERS,
  DEFAULT_PARTICLES,
  FLOW_MODES,
  FORMATION_TYPES,
  KALEIDO_SEGMENTS,
  OSCILLATION_AMOUNT_RANGE,
  OSCILLATION_SPEED_RANGE,
  OSCILLATION_TYPES,
  PARTICLE_SCENE_ID,
  PARTICLE_SHAPES,
  PARTICLE_SIZE_RANGE,
  PULSE_LAYOUTS,
  SCENE_IDS,
  TRAIL_LENGTH_RANGE,
  TRAIL_TYPES,
  normalizeParticles,
} from "../render/particleMath.js";

export { SCENE_IDS, PARTICLE_SCENE_ID };

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

/**
 * Stage 2 default: Mode A capture/visual settings with the 3D particle swarm
 * scene. Mode A / Mode B stay unchanged for Stage 1 contracts.
 */
export const STAGE2_DEFAULT_PRESET = {
  ...MODE_A_PRESET,
  sceneId: PARTICLE_SCENE_ID,
  name: "Stage 3 — Neon 3D Particle Swarm",
  visual: { ...MODE_A_PRESET.visual, paletteId: "neon-tunnel" },
  particles: { ...DEFAULT_PARTICLES },
};

/** Frozen Stage 3 AppState keys with their defaults. */
export const STAGE3_DEFAULTS = Object.freeze({
  sceneId: PARTICLE_SCENE_ID,
  paletteId: "neon-tunnel",
  particleCountTier: DEFAULT_PARTICLES.particleCountTier,
  densityAutoScale: DEFAULT_PARTICLES.densityAutoScale,
  trailLength: DEFAULT_PARTICLES.trailLength,
  trailType: DEFAULT_PARTICLES.trailType,
  formationType: DEFAULT_PARTICLES.formationType,
  oscillationType: DEFAULT_PARTICLES.oscillationType,
  oscillationAmount: DEFAULT_PARTICLES.oscillationAmount,
  oscillationSpeed: DEFAULT_PARTICLES.oscillationSpeed,
  pulseLayout: DEFAULT_PARTICLES.pulseLayout,
});

/** Flat view of the Stage 3 keys for a preset (scene + palette + particles.*). */
export function stage3View(preset) {
  const particles = { ...DEFAULT_PARTICLES, ...(preset?.particles || {}) };
  const out = { sceneId: preset?.sceneId ?? STAGE3_DEFAULTS.sceneId, paletteId: preset?.visual?.paletteId ?? STAGE3_DEFAULTS.paletteId };
  for (const key of Object.keys(STAGE3_DEFAULTS)) {
    if (key !== "sceneId" && key !== "paletteId") out[key] = particles[key];
  }
  return out;
}

/** Applies a capture/visual mode preset while keeping the current scene and Stage 2 controls. */
export function applyModeKeepingScene(modePreset, current) {
  const next = JSON.parse(JSON.stringify(modePreset));
  if (current?.sceneId) next.sceneId = current.sceneId;
  next.particles = { ...DEFAULT_PARTICLES, ...(current?.particles || {}) };
  return next;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Stage 3.2 persisted state: `{ storageSchema, preset }` under this key. Older keys are migrated on load. */
export const STORAGE_KEY = "zur_state_v3_2";
export const STORAGE_SCHEMA = 3.2;
export const LEGACY_STORAGE_KEYS = Object.freeze(["zur_state_v3", "zur_state_v2", "zur_state_v1", "zur.preset.v2", "zur.preset.v1"]);
/** Forced on any cached state older than v3.2 or still on copper-teal (grey-prone, small, dim). */
export const V3_2_UPGRADE_DEFAULTS = Object.freeze({
  paletteId: "neon-tunnel",
  particleCountTier: "2k",
  particleSize: 1.35,
  trailLength: 0.28,
  trailType: "comet",
});

export function upgradeToV32(preset) {
  const next = JSON.parse(JSON.stringify(preset));
  next.visual = { ...next.visual, paletteId: V3_2_UPGRADE_DEFAULTS.paletteId };
  next.particles = normalizeParticles({
    ...(next.particles || {}),
    particleCountTier: V3_2_UPGRADE_DEFAULTS.particleCountTier,
    particleSize: V3_2_UPGRADE_DEFAULTS.particleSize,
    trailLength: V3_2_UPGRADE_DEFAULTS.trailLength,
    trailType: V3_2_UPGRADE_DEFAULTS.trailType,
  });
  return next;
}

export function serializeStoredState(preset) {
  return JSON.stringify({ storageSchema: STORAGE_SCHEMA, preset });
}

/** Parses one stored payload (v3.2 envelope or a legacy bare preset). Returns null when unusable. */
export function migrateStoredPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const enveloped = isObject(parsed.preset);
  const schema = enveloped && Number.isFinite(parsed.storageSchema) ? parsed.storageSchema : 0;
  const preset = enveloped ? parsed.preset : parsed;
  if (isObject(preset.particles)) preset.particles = normalizeParticles(preset.particles);
  const checked = validatePreset(preset);
  if (!checked.ok) return null;
  const upgrade = schema < STORAGE_SCHEMA || checked.preset.visual.paletteId === "copper-teal";
  return { preset: upgrade ? upgradeToV32(checked.preset) : checked.preset, migrated: upgrade };
}

/** Reads zur_state_v3_2, falling back to the newest legacy key. Returns null when nothing usable is stored. */
export function loadStoredState(storage) {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch {
      return null;
    }
    if (!raw) continue;
    const result = migrateStoredPayload(raw);
    if (result) return { ...result, key };
  }
  return null;
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
  else if (!SCENE_IDS.includes(input.sceneId)) errors.push(`sceneId must be one of ${SCENE_IDS.join(", ")}`);
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

  if (input.particles != null) {
    const particles = input.particles;
    if (!isObject(particles)) {
      errors.push("particles must be an object");
    } else {
      if (!FLOW_MODES.includes(particles.flowMode)) errors.push(`particles.flowMode must be one of ${FLOW_MODES.join(", ")}`);
      if (!PARTICLE_SHAPES.includes(particles.shape)) errors.push(`particles.shape must be one of ${PARTICLE_SHAPES.join(", ")}`);
      numberIn(particles.particleSize, PARTICLE_SIZE_RANGE[0], PARTICLE_SIZE_RANGE[1], "particles.particleSize", errors);
      if (!KALEIDO_SEGMENTS.includes(particles.kaleidoSegments)) {
        errors.push(`particles.kaleidoSegments must be one of ${KALEIDO_SEGMENTS.join(", ")}`);
      }
      if (typeof particles.kaleidoSpin !== "boolean") errors.push("particles.kaleidoSpin must be boolean");
      if (!COUNT_TIERS.includes(particles.particleCountTier)) {
        errors.push(`particles.particleCountTier must be one of ${COUNT_TIERS.join(", ")}`);
      }
      if (typeof particles.densityAutoScale !== "boolean") errors.push("particles.densityAutoScale must be boolean");
      numberIn(particles.trailLength, TRAIL_LENGTH_RANGE[0], TRAIL_LENGTH_RANGE[1], "particles.trailLength", errors);
      if (!TRAIL_TYPES.includes(particles.trailType)) errors.push(`particles.trailType must be one of ${TRAIL_TYPES.join(", ")}`);
      if (!FORMATION_TYPES.includes(particles.formationType)) {
        errors.push(`particles.formationType must be one of ${FORMATION_TYPES.join(", ")}`);
      }
      if (!OSCILLATION_TYPES.includes(particles.oscillationType)) {
        errors.push(`particles.oscillationType must be one of ${OSCILLATION_TYPES.join(", ")}`);
      }
      numberIn(particles.oscillationAmount, OSCILLATION_AMOUNT_RANGE[0], OSCILLATION_AMOUNT_RANGE[1], "particles.oscillationAmount", errors);
      numberIn(particles.oscillationSpeed, OSCILLATION_SPEED_RANGE[0], OSCILLATION_SPEED_RANGE[1], "particles.oscillationSpeed", errors);
      if (!PULSE_LAYOUTS.includes(particles.pulseLayout)) errors.push(`particles.pulseLayout must be one of ${PULSE_LAYOUTS.join(", ")}`);
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

  get stage3() {
    return stage3View(this.preset);
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
    // Stage 2 presets lack the Stage 3 keys (and use `countTier`); fill them from defaults.
    if (isObject(parsed) && isObject(parsed.particles)) parsed.particles = normalizeParticles(parsed.particles);
    return this.replacePreset(parsed);
  }
}
