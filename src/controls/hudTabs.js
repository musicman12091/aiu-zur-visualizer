import { PALETTE_IDS } from "./palettes.js";
import {
  COLOR_PALETTE_LABELS,
  COUNT_TIERS,
  COUNT_TIER_LABELS,
  FLOW_LABELS,
  FORMATION_LABELS,
  KALEIDO_SEGMENTS,
  KINETIC_LABELS,
  OSCILLATION_TYPES,
  PARTICLE_STYLE_LABELS,
  PULSE_LAYOUTS,
  TRAIL_TYPES,
} from "../render/particleMath.js";
import { HUD_TABS, LOGO_HUD_TEXTS, SHADER_SCENES, SWARM_MODES, TAB_RULES } from "../app/AppState.js";

export const TAB_LABELS = Object.freeze({
  "deep-space": "🌌 Deep Space",
  "brain-3d": "🧠 3D Brain",
  "blood-swarm": "🩸 Blood & Swarm",
  "megastructure": "🔮 Megastructure",
  "canyon-pulse": "⛰️ Canyon & Pulse",
  "audio-rig": "🎙️ Audio & Rig",
});
export const SWARM_MODE_LABELS = Object.freeze({
  "blood-drip": "🩸 Blood Splatter & Wall-Run",
  "logo-text": "🔤 Logo / Text Attractor",
  "free-swarm": "🌐 3D Fractal & Swarm",
});
export const SHADER_SCENE_LABELS = Object.freeze({
  "spectral-canyon-3d": "⛰️ Spectral Canyon 3D",
  "pulse-field-3d": "〰️ 3D Audio Pulse Field",
  "aurora-ribbons": "🌌 Aurora Ribbons",
});
const TRAIL_LABELS = { comet: "Comet", electric: "Electric", strobe: "Strobe", ribbon: "Ribbon", none: "None" };
const OSC_LABELS = { off: "Off", wave: "Wave", helix: "Helix", bounce: "Bounce", pulse: "Pulse" };
const LAYOUT_LABELS = { "band-clouds": "Band Clouds", "geodesic-sphere": "Geodesic Sphere", "wave-grid": "Wave Grid" };
const CAMERA_MODE_LABELS = { "static": "Static", "orbit-3d": "Orbit 3D", "tunnel-fly": "Tunnel Fly", "beat-bank": "Beat Bank" };

/**
 * Single shared option normaliser: accepts `{ value, label, name, id }`, a `[value, label]` pair or a bare primitive.
 * Neither `value` nor `label` is ever blank: label = opt.label || opt.name || String(opt).
 */
export function normalizeOption(opt) {
  let value;
  let label;
  if (Array.isArray(opt)) {
    [value, label] = opt;
  } else if (opt !== null && typeof opt === "object") {
    value = opt.value ?? opt.id;
    label = opt.label || opt.name;
  } else {
    value = opt;
  }
  let text = String(label || "").trim();
  let val = String(value ?? "").trim();
  if (!text) text = val;
  if (!val) val = text;
  if (!text) {
    text = "Default";
    val = "default";
  }
  return { value: val, label: text };
}

export function normalizeOptions(options) {
  return options.map(normalizeOption);
}

/** Rebuilds a <select> from raw options through the shared normaliser; keeps the current value when still present. */
export function fillSelect(select, options) {
  const current = select.value;
  const normalized = normalizeOptions(options);
  select.replaceChildren();
  for (const entry of normalized) {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    select.append(option);
  }
  if (normalized.some((entry) => entry.value === current)) select.value = current;
  return normalized;
}

const pairs = (ids, labels) => ids.map((id) => ({ value: id, label: labels[id] || id }));

/** Layout key of the visual controls for a flat HUD state. */
export function layoutKey(flat) {
  const tab = flat.hudTab === "audio-rig" ? flat.visualTab : flat.hudTab;
  if (tab === "blood-swarm") return flat.swarmMode;
  if (tab === "canyon-pulse") return flat.shaderScene;
  return tab;
}

/** `[control, label, extras]` rows per layout key, in on-screen order. Unlisted controls are hidden. */
export const CONTROL_LAYOUT = Object.freeze({
  "deep-space": [
    ["formation", "Cosmic Formation"], ["flow", "Cosmic Stream (Flow)"], ["style", "Particle Style"],
    ["kinetic", "Cosmic Kinetic"], ["palette", "Palette"], ["count", "Particle Count Tier"],
    ["zoom", "Camera Zoom"], ["cameraMode", "Camera Mode"], ["reactivity", "Reactivity Punch"],
    ["size", "Particle Size"], ["trailType", "Trail Type"], ["trailLength", "Trail Length"],
    ["kaleido", "Kaleidoscope Mirrors"], ["kaleidoSpin", "Beat Spin"],
  ],
  "brain-3d": [
    ["kinetic", "Neural Activity (Kinetic)"], ["flow", "Axon Pathway (Flow)"], ["style", "Neuron Style"],
    ["palette", "Brain Palette"], ["oscSpeed", "Synapse Firing Speed"], ["reactivity", "Reactivity Punch"],
    ["zoom", "Camera Zoom"], ["cameraMode", "Camera Mode"], ["count", "Particle Count Tier"],
    ["size", "Particle Size"], ["trailType", "Trail Type"], ["trailLength", "Trail Length"],
    ["kaleido", "Kaleidoscope Mirrors"],
  ],
  "blood-drip": [
    ["palette", "Palette"], ["reactivity", "Reactivity Punch"], ["oscSpeed", "Drip & Rush Speed"],
    ["trailLength", "Blood Streak Length", { min: 0.25, max: 1 }], ["count", "Particle Count Tier"],
    ["size", "Particle Size"], ["zoom", "Camera Zoom"],
  ],
  "logo-text": [
    ["logoText", "Logo Text"], ["style", "Particle Style"], ["palette", "Palette"], ["reactivity", "Reactivity Punch"],
    ["zoom", "Camera Zoom"], ["count", "Particle Count Tier"], ["size", "Particle Size"],
  ],
  "free-swarm": [
    ["formation", "Swarm Formation"], ["flow", "Swarm Physics"], ["style", "Particle Style"],
    ["kinetic", "Kinetic Mode"], ["oscillation", "Oscillation"], ["oscAmount", "Oscillation Amount"],
    ["oscSpeed", "Oscillation Speed"], ["palette", "Palette"],
    ["reactivity", "Reactivity Punch"], ["zoom", "Camera Zoom"], ["count", "Particle Count Tier"],
    ["trailType", "Trail Type"], ["trailLength", "Trail Length"], ["kaleido", "Kaleidoscope Mirrors"],
  ],
  "megastructure": [
    ["palette", "Palette"], ["cameraMode", "Camera Mode"], ["zoom", "Camera Zoom"], ["reactivity", "Reactivity Punch"],
    ["kaleido", "Kaleidoscope Mirrors"], ["kaleidoSpin", "Beat Spin"], ["chromatic", "Chromatic Aberration"],
    ["godRays", "God Rays"], ["count", "Orbit Swarm Count"], ["trailLength", "Trail Length"],
  ],
  "spectral-canyon-3d": [
    ["palette", "Palette"], ["hueShift", "Hue Shift"], ["cameraMode", "Camera Mode"], ["reactivity", "Reactivity Punch"],
    ["kaleido", "Kaleidoscope Mirrors"], ["chromatic", "Chromatic Aberration"], ["godRays", "God Rays"],
  ],
  "pulse-field-3d": [
    ["pulseLayout", "Pulse Field Layout"], ["palette", "Palette"], ["cameraMode", "Camera Mode"],
    ["zoom", "Camera Zoom"], ["reactivity", "Reactivity Punch"], ["trailLength", "Trail Length"],
  ],
  "aurora-ribbons": [
    ["palette", "Palette"], ["hueShift", "Hue Shift"], ["reactivity", "Reactivity Punch"],
    ["trailLength", "Trail Length"], ["kaleido", "Kaleidoscope Mirrors"],
  ],
});

/** Scene palettes (aurora / canyon) are driven by visual.paletteId; every particle scene by particles.colorPalette. */
export function paletteTarget(key) {
  return key === "spectral-canyon-3d" || key === "aurora-ribbons" ? "scene" : "color";
}

function rulesFor(key) {
  return TAB_RULES[key] || null;
}

/** Raw option list for a select control under a layout key. */
export function optionsFor(control, key) {
  const rules = rulesFor(key);
  switch (control) {
    case "formation": return pairs(rules?.formations || [], FORMATION_LABELS);
    case "flow": return pairs(rules?.flows || [], FLOW_LABELS);
    case "style": return pairs(rules?.styles || [], PARTICLE_STYLE_LABELS);
    case "kinetic": return pairs(rules?.kinetics || [], KINETIC_LABELS);
    case "palette":
      return paletteTarget(key) === "scene"
        ? PALETTE_IDS.map((id) => ({ value: id, label: id }))
        : pairs(rules?.palettes || TAB_RULES["deep-space"].palettes, COLOR_PALETTE_LABELS);
    case "oscillation": return pairs(OSCILLATION_TYPES, OSC_LABELS);
    case "logoText": return LOGO_HUD_TEXTS.map((text) => ({ value: text, label: text }));
    case "pulseLayout": return pairs(PULSE_LAYOUTS, LAYOUT_LABELS);
    case "count": return COUNT_TIERS.map((tier) => ({ value: tier, label: COUNT_TIER_LABELS[tier] || tier }));
    case "cameraMode": return pairs(Object.keys(CAMERA_MODE_LABELS), CAMERA_MODE_LABELS);
    case "trailType": return pairs(TRAIL_TYPES, TRAIL_LABELS);
    case "kaleido": return KALEIDO_SEGMENTS.map((n) => ({ value: String(n), label: n === 0 ? "Off" : `${n} mirrors` }));
    default: return [];
  }
}

/** Every static option list the HUD can ever build (used by the contract test to prove no <option> is blank). */
export function allStaticOptionLists() {
  const lists = [];
  const keys = Object.keys(CONTROL_LAYOUT);
  const selects = ["formation", "flow", "style", "kinetic", "palette", "oscillation", "logoText", "pulseLayout", "count", "cameraMode", "trailType", "kaleido"];
  for (const key of keys) for (const control of selects) lists.push({ key, control, options: optionsFor(control, key) });
  return lists;
}

export { HUD_TABS, SHADER_SCENES, SWARM_MODES };
