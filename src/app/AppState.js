import { PALETTE_IDS } from "../controls/palettes.js";
import {
  CAMERA_ZOOM_RANGE,
  COLOR_PALETTES,
  COUNT_TIERS,
  KINETIC_MODES,
  LOGO_TEXT_PRESETS,
  MEGASTRUCTURE_SCENE_ID,
  PULSE_SCENE_ID,
  SPECTRAL_CANYON_SCENE_ID,
  AURORA_SCENE_ID,
  NOISE_GATE_DEFAULT,
  NOISE_GATE_RANGE,
  PARTICLE_STYLES,
  REACTIVITY_GAIN_RANGE,
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

export { SCENE_IDS, PARTICLE_SCENE_ID, FLOW_MODES, FORMATION_TYPES };

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
    paletteId: "neon-tunnel",
    hueShift: 0.0,
    cameraMode: "orbit-3d",
    chromaticAberration: 0.30,
    godRays: 0.35,
    vjAutopilot: false,
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
    noiseGateThreshold: NOISE_GATE_DEFAULT,
  },
  visual: {
    paletteId: "neon-tunnel",
    hueShift: 0.0,
    cameraMode: "orbit-3d",
    chromaticAberration: 0.30,
    godRays: 0.35,
    vjAutopilot: false,
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
    paletteId: "neon-tunnel",
    hueShift: 0.0,
    cameraMode: "orbit-3d",
    chromaticAberration: 0.30,
    godRays: 0.35,
    vjAutopilot: false,
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
const STAGE2_BASE_PRESET = {
  ...MODE_A_PRESET,
  sceneId: PARTICLE_SCENE_ID,
  name: "Stage 3 — Neon 3D Particle Swarm",
  visual: { ...MODE_A_PRESET.visual, paletteId: "neon-tunnel" },
  particles: { ...DEFAULT_PARTICLES },
};

// ---- ZUR-GH-010 context-gated HUD tabs -------------------------------------------------------------------------

export const HUD_TABS = Object.freeze(["deep-space", "brain-3d", "blood-swarm", "megastructure", "canyon-pulse", "audio-rig"]);
/** Tabs that own a visualizer scene (audio-rig never changes the scene). */
export const VISUAL_HUD_TABS = Object.freeze(HUD_TABS.slice(0, 5));
export const SWARM_MODES = Object.freeze(["blood-drip", "logo-text", "free-swarm"]);
export const SHADER_SCENES = Object.freeze([SPECTRAL_CANYON_SCENE_ID, PULSE_SCENE_ID, AURORA_SCENE_ID]);
export const DEFAULT_HUD = Object.freeze({
  hudTab: "deep-space",
  swarmMode: "blood-drip",
  shaderScene: SPECTRAL_CANYON_SCENE_ID,
  visualTab: "deep-space",
});

const NEON_PALETTES = Object.freeze(["true-neon", "full-spectrum", "white-static", "blood-red"]);
const TAB_FLOWS = Object.freeze(["physarum", "murmuration", "fish"]);
const ALL_STYLES = PARTICLE_STYLES;
const SOFT_STYLES = Object.freeze(["star-streak", "dart3d", "synapse-spark"]);
const CAMERA_MODES = Object.freeze(["static", "orbit-3d", "tunnel-fly", "beat-bank"]);
/** The ticket's "flock" is the School of Fish flow (FLOW_MODES has no separate "flock" id; sim u_mode is index based). */
const FLOW_ALIASES = Object.freeze({ flock: "fish", flocking: "fish" });
export const PARTICLE_SIZE_HUD_MAX = 2.5;
export const BLOOD_TRAIL_MIN = 0.25;
export const BLOOD_TRAIL_DEFAULT = 0.72;
export const LOGO_OSCILLATION_HUD_MAX = 0.15;
export const LOGO_TRAIL_HUD_MAX = 0.35;
export const LOGO_HUD_TEXTS = Object.freeze(["MON DAAIN", "AI: UNDERGROUND", "TENTH GATE", "ZUR"]);

/** Allowed values per tab; the HUD builds its option lists from this table and the autopilot picks from it. */
export const TAB_RULES = Object.freeze({
  "deep-space": {
    formations: ["wormhole", "supermassive-blackhole", "living-galaxy", "neon-tunnel", "polygon-rings", "supernova-shell"],
    flows: TAB_FLOWS,
    styles: ["star-streak", "dart3d", "synapse-spark"],
    kinetics: ["off", "accretion-warp", "ribbon-curtain", "shock-shatter"],
    palettes: NEON_PALETTES,
  },
  "brain-3d": {
    formations: ["neural-brain"],
    flows: TAB_FLOWS,
    styles: ["synapse-spark", "star-streak", "dart3d"],
    kinetics: ["synapse-cascade", "shock-shatter", "off"],
    palettes: ["golden-cortex", ...NEON_PALETTES],
  },
  "blood-drip": { formations: ["free-3d"], styles: ["blood-drop"], kinetics: ["splatter-run"], palettes: NEON_PALETTES },
  "logo-text": { formations: ["logo-attractor"], styles: SOFT_STYLES, kinetics: ["off"], palettes: NEON_PALETTES },
  "free-swarm": {
    formations: ["fractal-core", "free-3d"],
    flows: ["flock", "murmuration", "physarum", "fluid", "gas"].map((id) => FLOW_ALIASES[id] || id),
    styles: ALL_STYLES,
    kinetics: KINETIC_MODES,
    palettes: NEON_PALETTES,
  },
  "megastructure": { formations: ["fractal-core"], styles: ["dart3d"], kinetics: ["off"], palettes: NEON_PALETTES },
  "pulse-field-3d": { styles: ["dart3d"], kinetics: ["off"], palettes: NEON_PALETTES },
});

const FLAT_DEFAULTS = Object.freeze({
  ...DEFAULT_HUD,
  sceneId: PARTICLE_SCENE_ID,
  paletteId: "neon-tunnel",
  hueShift: 0,
  cameraMode: "orbit-3d",
  chromaticAberration: 0.30,
  godRays: 0.35,
  ...DEFAULT_PARTICLES,
});

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function clampNum(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Entering a tab / sub-mode can reset the palette to that mode's default. */
function entryPalette(hudTab, swarmMode) {
  if (hudTab === "brain-3d") return "golden-cortex";
  if (hudTab === "blood-swarm" && swarmMode === "blood-drip") return "blood-red";
  return null;
}

/**
 * Pure: returns the flat state constrained to what the active HUD tab allows. Idempotent.
 * `formation` / `formationType` and `flowMode` / `flowType` are always kept equal. The Audio & Rig tab does not
 * change the scene; it only normalises ranges and the aliases.
 */
export function enforceTabConstraints(input) {
  const src = isObject(input) ? input : {};
  const s = { ...FLAT_DEFAULTS, ...src };
  const hudTab = pick(s.hudTab, HUD_TABS, DEFAULT_HUD.hudTab);
  s.hudTab = hudTab;
  s.swarmMode = pick(s.swarmMode, SWARM_MODES, DEFAULT_HUD.swarmMode);
  s.shaderScene = pick(s.shaderScene, SHADER_SCENES, DEFAULT_HUD.shaderScene);
  s.visualTab = pick(s.visualTab, VISUAL_HUD_TABS, hudTab === "audio-rig" ? DEFAULT_HUD.visualTab : hudTab);
  if (hudTab !== "audio-rig") s.visualTab = hudTab;

  const formationIn = src.formation !== undefined ? src.formation : src.formationType;
  let formation = pick(formationIn, FORMATION_TYPES, DEFAULT_PARTICLES.formationType);
  const flowIn = src.flowMode !== undefined ? src.flowMode : src.flowType;
  let flow = pick(FLOW_ALIASES[flowIn] || flowIn, FLOW_MODES, DEFAULT_PARTICLES.flowMode);
  let style = pick(s.particleStyle, PARTICLE_STYLES, DEFAULT_PARTICLES.particleStyle);
  let kinetic = pick(s.kineticMode, KINETIC_MODES, DEFAULT_PARTICLES.kineticMode);
  let osc = pick(s.oscillationType, OSCILLATION_TYPES, DEFAULT_PARTICLES.oscillationType);
  let palette = pick(s.colorPalette, COLOR_PALETTES, DEFAULT_PARTICLES.colorPalette);
  let trailType = pick(s.trailType, TRAIL_TYPES, DEFAULT_PARTICLES.trailType);
  let trailLength = clampNum(s.trailLength, TRAIL_LENGTH_RANGE[0], TRAIL_LENGTH_RANGE[1], DEFAULT_PARTICLES.trailLength);
  let oscAmount = clampNum(s.oscillationAmount, OSCILLATION_AMOUNT_RANGE[0], OSCILLATION_AMOUNT_RANGE[1], DEFAULT_PARTICLES.oscillationAmount);
  let sceneId = pick(s.sceneId, SCENE_IDS, PARTICLE_SCENE_ID);
  let attractorText = typeof s.attractorText === "string" ? s.attractorText.slice(0, 64) : DEFAULT_PARTICLES.attractorText;

  const rules = TAB_RULES[hudTab];
  if (hudTab === "deep-space") {
    sceneId = PARTICLE_SCENE_ID;
    formation = pick(formation, rules.formations, "wormhole");
    flow = pick(flow, rules.flows, "physarum");
    style = pick(style, rules.styles, "star-streak");
    kinetic = pick(kinetic, rules.kinetics, "off");
    palette = pick(palette, rules.palettes, "true-neon");
    if (["wormhole", "supermassive-blackhole", "living-galaxy"].includes(formation)) osc = "off";
  } else if (hudTab === "brain-3d") {
    sceneId = PARTICLE_SCENE_ID;
    formation = "neural-brain";
    flow = pick(flow, rules.flows, "physarum");
    style = pick(style, rules.styles, "synapse-spark");
    kinetic = pick(kinetic, rules.kinetics, "synapse-cascade");
    osc = "off";
    palette = pick(palette, rules.palettes, "golden-cortex");
  } else if (hudTab === "blood-swarm") {
    sceneId = PARTICLE_SCENE_ID;
    if (s.swarmMode === "blood-drip") {
      formation = "free-3d";
      style = "blood-drop";
      kinetic = "splatter-run";
      osc = "off";
      const noTrail = trailType === "none" || trailLength < BLOOD_TRAIL_MIN;
      trailType = "comet";
      trailLength = noTrail ? BLOOD_TRAIL_DEFAULT : Math.max(trailLength || 0, BLOOD_TRAIL_DEFAULT);
      palette = pick(palette, TAB_RULES["blood-drip"].palettes, "blood-red");
    } else if (s.swarmMode === "logo-text") {
      formation = "logo-attractor";
      kinetic = "off";
      oscAmount = Math.min(oscAmount, LOGO_OSCILLATION_HUD_MAX);
      trailLength = Math.min(trailLength, LOGO_TRAIL_HUD_MAX);
      style = pick(style, TAB_RULES["logo-text"].styles, "star-streak");
      palette = pick(palette, TAB_RULES["logo-text"].palettes, "true-neon");
      attractorText = pick(attractorText, LOGO_HUD_TEXTS, LOGO_TEXT_PRESETS.includes(attractorText) ? attractorText : "MON DAAIN");
    } else {
      formation = pick(formation, TAB_RULES["free-swarm"].formations, "free-3d");
      palette = pick(palette, TAB_RULES["free-swarm"].palettes, "true-neon");
    }
  } else if (hudTab === "megastructure") {
    sceneId = MEGASTRUCTURE_SCENE_ID;
    formation = "fractal-core";
    style = "dart3d";
    kinetic = "off";
    palette = pick(palette, rules.palettes, "true-neon");
  } else if (hudTab === "canyon-pulse") {
    sceneId = s.shaderScene;
    if (sceneId === PULSE_SCENE_ID) {
      style = "dart3d";
      kinetic = "off";
      palette = pick(palette, TAB_RULES["pulse-field-3d"].palettes, "true-neon");
    }
  }

  const out = {
    ...s,
    sceneId,
    formation,
    formationType: formation,
    flowMode: flow,
    flowType: flow,
    particleStyle: style,
    kineticMode: kinetic,
    oscillationType: osc,
    oscillationAmount: oscAmount,
    oscillationSpeed: clampNum(s.oscillationSpeed, OSCILLATION_SPEED_RANGE[0], OSCILLATION_SPEED_RANGE[1], DEFAULT_PARTICLES.oscillationSpeed),
    colorPalette: palette,
    trailType,
    trailLength,
    attractorText,
    particleCountTier: pick(s.particleCountTier, COUNT_TIERS, DEFAULT_PARTICLES.particleCountTier),
    particleSize: clampNum(s.particleSize, PARTICLE_SIZE_RANGE[0], PARTICLE_SIZE_HUD_MAX, DEFAULT_PARTICLES.particleSize),
    cameraZoom: clampNum(s.cameraZoom, CAMERA_ZOOM_RANGE[0], CAMERA_ZOOM_RANGE[1], DEFAULT_PARTICLES.cameraZoom),
    reactivityGain: clampNum(s.reactivityGain, REACTIVITY_GAIN_RANGE[0], REACTIVITY_GAIN_RANGE[1], DEFAULT_PARTICLES.reactivityGain),
    kaleidoSegments: pick(s.kaleidoSegments, KALEIDO_SEGMENTS, DEFAULT_PARTICLES.kaleidoSegments),
    kaleidoSpin: typeof s.kaleidoSpin === "boolean" ? s.kaleidoSpin : DEFAULT_PARTICLES.kaleidoSpin,
    pulseLayout: pick(s.pulseLayout, PULSE_LAYOUTS, DEFAULT_PARTICLES.pulseLayout),
    cameraMode: pick(s.cameraMode, CAMERA_MODES, "orbit-3d"),
    paletteId: PALETTE_IDS.includes(s.paletteId) ? s.paletteId : "neon-tunnel",
    hueShift: clampNum(s.hueShift, -1, 1, 0),
    chromaticAberration: clampNum(s.chromaticAberration, 0, 1, 0.30),
    godRays: clampNum(s.godRays, 0, 1, 0.35),
  };
  return out;
}

/** Key into TAB_RULES / the HUD layout for a flat state (audio-rig uses the last visual tab). */
export function layoutKeyFor(flat) {
  const tab = flat.hudTab === "audio-rig" ? flat.visualTab : flat.hudTab;
  if (tab === "blood-swarm") return flat.swarmMode;
  if (tab === "canyon-pulse") return flat.shaderScene;
  return tab;
}

/** Pure tab switch: applies the entry defaults of the new tab / sub-mode, then constrains. */
export function switchHudTab(state, hudTab, { swarmMode, shaderScene } = {}) {
  const prev = enforceTabConstraints(state);
  const tab = pick(hudTab, HUD_TABS, prev.hudTab);
  const mode = swarmMode ? pick(swarmMode, SWARM_MODES, prev.swarmMode) : prev.swarmMode;
  const scene = shaderScene ? pick(shaderScene, SHADER_SCENES, prev.shaderScene) : prev.shaderScene;
  const next = { ...prev, hudTab: tab, swarmMode: mode, shaderScene: scene };
  const changed = tab !== prev.hudTab || (tab === "blood-swarm" && mode !== prev.swarmMode);
  if (changed) {
    const palette = entryPalette(tab, mode);
    if (palette) next.colorPalette = palette;
  }
  return enforceTabConstraints(next);
}

const FLAT_PARTICLE_KEYS = Object.freeze(Object.keys(DEFAULT_PARTICLES).filter((key) => key !== "shape"));

/** Flat view used by enforceTabConstraints: scene + visual.* + hud.* + particles.* (formation / flow aliases filled in). */
export function flattenPreset(preset) {
  const hud = { ...DEFAULT_HUD, ...(preset?.hud || {}) };
  const particles = { ...DEFAULT_PARTICLES, ...(preset?.particles || {}) };
  const visual = preset?.visual || {};
  return {
    ...hud,
    sceneId: preset?.sceneId ?? PARTICLE_SCENE_ID,
    paletteId: visual.paletteId ?? "neon-tunnel",
    hueShift: visual.hueShift ?? 0,
    cameraMode: visual.cameraMode ?? "orbit-3d",
    chromaticAberration: visual.chromaticAberration ?? 0.30,
    godRays: visual.godRays ?? 0.35,
    ...particles,
    formation: particles.formationType,
    flowType: particles.flowMode,
  };
}

/** Writes a flat (constrained) state back into a copy of the preset. */
export function applyFlatToPreset(preset, flat) {
  const next = JSON.parse(JSON.stringify(preset));
  next.sceneId = flat.sceneId;
  next.hud = { hudTab: flat.hudTab, swarmMode: flat.swarmMode, shaderScene: flat.shaderScene, visualTab: flat.visualTab };
  next.visual = {
    ...next.visual,
    paletteId: flat.paletteId,
    hueShift: flat.hueShift,
    cameraMode: flat.cameraMode,
    chromaticAberration: flat.chromaticAberration,
    godRays: flat.godRays,
  };
  const particles = { ...(next.particles || {}) };
  for (const key of FLAT_PARTICLE_KEYS) particles[key] = flat[key];
  next.particles = normalizeParticles(particles);
  return next;
}

export function enforcePresetConstraints(preset) {
  return applyFlatToPreset(preset, enforceTabConstraints(flattenPreset(preset)));
}

/** Preset-level tab switch (used by the HUD and tests). */
export function switchPresetTab(preset, hudTab, options) {
  return applyFlatToPreset(preset, switchHudTab(flattenPreset(preset), hudTab, options));
}

/** Stage 3 default + HUD tab state (Deep Space). */
export const STAGE2_DEFAULT_PRESET = enforcePresetConstraints({ ...STAGE2_BASE_PRESET, hud: { ...DEFAULT_HUD } });

/** Flat particle-control keys exposed through AppState. */
export const STAGE3_DEFAULTS = Object.freeze({
  sceneId: PARTICLE_SCENE_ID,
  paletteId: "neon-tunnel",
  particleCountTier: DEFAULT_PARTICLES.particleCountTier,
  densityAutoScale: DEFAULT_PARTICLES.densityAutoScale,
  trailLength: DEFAULT_PARTICLES.trailLength,
  trailType: DEFAULT_PARTICLES.trailType,
  formationType: DEFAULT_PARTICLES.formationType,
  attractorText: DEFAULT_PARTICLES.attractorText,
  oscillationType: DEFAULT_PARTICLES.oscillationType,
  oscillationAmount: DEFAULT_PARTICLES.oscillationAmount,
  oscillationSpeed: DEFAULT_PARTICLES.oscillationSpeed,
  pulseLayout: DEFAULT_PARTICLES.pulseLayout,
  particleStyle: DEFAULT_PARTICLES.particleStyle,
  colorPalette: DEFAULT_PARTICLES.colorPalette,
  kineticMode: DEFAULT_PARTICLES.kineticMode,
  reactivityGain: DEFAULT_PARTICLES.reactivityGain,
  cameraZoom: DEFAULT_PARTICLES.cameraZoom,
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
  if (current?.hud) next.hud = { ...current.hud };
  return next;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Stage 5.1 persisted state: `{ storageSchema, preset }` under this key. Older keys are migrated on load. */
export const STORAGE_KEY = "zur_state_v5_1";
export const STORAGE_SCHEMA = 5.1;
export const V4_NEON_FLAG = "zur_v4_neon_forced";
export const LEGACY_STORAGE_KEYS = Object.freeze([
  "zur_state_v5_0", "zur_state_v4_0", "zur_state_v3_2", "zur_state_v3", "zur_state_v2", "zur_state_v1", "zur.preset.v2", "zur.preset.v1",
]);
/** Forced on any cached state older than v3.2 or still on copper-teal (grey-prone, small, dim). */
export const V3_2_UPGRADE_DEFAULTS = Object.freeze({
  paletteId: "neon-tunnel",
  particleCountTier: "64k",
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

export function upgradeToV40(preset) {
  const next = JSON.parse(JSON.stringify(preset));
  const wasCopper = next.visual?.paletteId === "copper-teal";
  next.visual = {
    ...next.visual,
    paletteId: wasCopper ? "neon-tunnel" : (next.visual?.paletteId || "neon-tunnel"),
    hueShift: wasCopper ? 0 : (next.visual?.hueShift ?? 0),
    cameraMode: next.visual?.cameraMode || "orbit-3d",
    chromaticAberration: next.visual?.chromaticAberration ?? 0.30,
    godRays: next.visual?.godRays ?? 0.35,
    vjAutopilot: next.visual?.vjAutopilot ?? false,
  };
  next.particles = normalizeParticles(next.particles);
  return { preset: next, forcedNeon: wasCopper };
}

/** ZUR-GH-009: drops removed tiers / the orb style (normalizeParticles) and resets the old 0.2-range noise gate. */
export function upgradeToV50(preset) {
  const next = JSON.parse(JSON.stringify(preset));
  next.particles = normalizeParticles(next.particles);
  if (next.audio && !(next.audio.noiseGateThreshold <= NOISE_GATE_RANGE[1])) {
    next.audio.noiseGateThreshold = NOISE_GATE_DEFAULT;
  }
  return next;
}

/** ZUR-GH-010: adds the HUD tab keys (inferred from the stored scene) and runs the tab constraints once. */
export function upgradeToV51(preset) {
  const next = JSON.parse(JSON.stringify(preset));
  if (!isObject(next.hud)) {
    const hud = { ...DEFAULT_HUD };
    if (next.sceneId === MEGASTRUCTURE_SCENE_ID) hud.hudTab = "megastructure";
    else if (SHADER_SCENES.includes(next.sceneId)) {
      hud.hudTab = "canyon-pulse";
      hud.shaderScene = next.sceneId;
    }
    else {
      const formation = next.particles?.formationType;
      if (formation === "neural-brain") hud.hudTab = "brain-3d";
      else if (formation === "logo-attractor") { hud.hudTab = "blood-swarm"; hud.swarmMode = "logo-text"; }
      else if (next.particles?.particleStyle === "blood-drop" || next.particles?.kineticMode === "splatter-run") {
        hud.hudTab = "blood-swarm";
      } else if (formation === "fractal-core" || formation === "free-3d") { hud.hudTab = "blood-swarm"; hud.swarmMode = "free-swarm"; }
    }
    hud.visualTab = hud.hudTab;
    next.hud = hud;
  }
  next.particles = normalizeParticles(next.particles);
  return enforcePresetConstraints(next);
}

export function serializeStoredState(preset) {
  return JSON.stringify({ storageSchema: STORAGE_SCHEMA, preset });
}

/** Parses one stored payload (versioned envelope or a legacy bare preset). Returns null when unusable. */
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
  const sourcePreset = enveloped ? parsed.preset : parsed;
  if (isObject(sourcePreset.particles)) sourcePreset.particles = normalizeParticles(sourcePreset.particles);
  const checked = validatePreset(sourcePreset);
  if (!checked.ok) return null;
  let preset = checked.preset;
  let migrated = false;
  let forcedNeon = false;
  const isCopper = checked.preset.visual.paletteId === "copper-teal";
  if (schema < 3.2 || (schema < STORAGE_SCHEMA && isCopper)) {
    preset = upgradeToV32(preset);
    if (isCopper) preset.visual.hueShift = 0;
    migrated = true;
  }
  if (schema < STORAGE_SCHEMA) {
    const upgraded = upgradeToV40(preset);
    preset = upgradeToV51(upgradeToV50(upgraded.preset));
    forcedNeon = upgraded.forcedNeon;
    migrated = true;
  } else {
    preset = {
      ...preset,
      visual: {
        cameraMode: "orbit-3d",
        chromaticAberration: 0.30,
        godRays: 0.35,
        vjAutopilot: false,
        ...preset.visual,
      },
      particles: normalizeParticles(preset.particles),
    };
    if (!isObject(preset.hud)) preset = upgradeToV51(preset);
  }
  return { preset, migrated, forcedNeon };
}

/** Reads the current storage key, falling back to the newest legacy key. Returns null when none is usable. */
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
    if (result) {
      let preset = result.preset;
      let migrated = result.migrated;
      try {
        if (storage.getItem(V4_NEON_FLAG) !== "1") {
          if (preset.visual.paletteId === "copper-teal") {
            preset = {
              ...preset,
              visual: { ...preset.visual, paletteId: "neon-tunnel", hueShift: 0 },
            };
            migrated = true;
          }
          storage.setItem(V4_NEON_FLAG, "1");
        }
      } catch {
        // Storage can be read-only; the current session can still use the migrated preset.
      }
      return { ...result, preset, migrated, key };
    }
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
    if (visual.cameraMode != null && !["static", "orbit-3d", "tunnel-fly", "beat-bank"].includes(visual.cameraMode)) {
      errors.push('visual.cameraMode must be "static", "orbit-3d", "tunnel-fly", or "beat-bank"');
    }
    if (visual.chromaticAberration != null) numberIn(visual.chromaticAberration, 0, 1, "visual.chromaticAberration", errors);
    if (visual.godRays != null) numberIn(visual.godRays, 0, 1, "visual.godRays", errors);
    if (visual.vjAutopilot != null && typeof visual.vjAutopilot !== "boolean") {
      errors.push("visual.vjAutopilot must be boolean");
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
      if (!PARTICLE_STYLES.includes(particles.particleStyle)) {
        errors.push(`particles.particleStyle must be one of ${PARTICLE_STYLES.join(", ")}`);
      }
      if (!COLOR_PALETTES.includes(particles.colorPalette)) {
        errors.push(`particles.colorPalette must be one of ${COLOR_PALETTES.join(", ")}`);
      }
      if (!KINETIC_MODES.includes(particles.kineticMode)) {
        errors.push(`particles.kineticMode must be one of ${KINETIC_MODES.join(", ")}`);
      }
      numberIn(particles.reactivityGain, REACTIVITY_GAIN_RANGE[0], REACTIVITY_GAIN_RANGE[1], "particles.reactivityGain", errors);
      numberIn(particles.cameraZoom, CAMERA_ZOOM_RANGE[0], CAMERA_ZOOM_RANGE[1], "particles.cameraZoom", errors);
      if (particles.attractorText != null && (typeof particles.attractorText !== "string" || particles.attractorText.length > 64)) {
        errors.push("particles.attractorText must be a string of at most 64 characters");
      }
    }
  }

  if (input.hud != null) {
    const hud = input.hud;
    if (!isObject(hud)) errors.push("hud must be an object");
    else {
      if (!HUD_TABS.includes(hud.hudTab)) errors.push(`hud.hudTab must be one of ${HUD_TABS.join(", ")}`);
      if (!SWARM_MODES.includes(hud.swarmMode)) errors.push(`hud.swarmMode must be one of ${SWARM_MODES.join(", ")}`);
      if (!SHADER_SCENES.includes(hud.shaderScene)) errors.push(`hud.shaderScene must be one of ${SHADER_SCENES.join(", ")}`);
      if (hud.visualTab != null && !VISUAL_HUD_TABS.includes(hud.visualTab)) {
        errors.push(`hud.visualTab must be one of ${VISUAL_HUD_TABS.join(", ")}`);
      }
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
    // Presets that carry HUD tab state are always re-constrained (ZUR-GH-010); legacy HUD-less presets are untouched.
    if (result.preset.hud) result.preset = enforcePresetConstraints(result.preset);
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
