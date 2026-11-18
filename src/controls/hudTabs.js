import { PALETTE_IDS } from "./palettes.js";
import {
  COLOR_PALETTES,
  COLOR_PALETTE_LABELS,
  COUNT_TIERS,
  COUNT_TIER_LABELS,
  FLOW_LABELS,
  FLOW_MODES,
  FORMATION_LABELS,
  FORMATION_TYPES,
  KALEIDO_SEGMENTS,
  KINETIC_LABELS,
  KINETIC_MODES,
  OSCILLATION_TYPES,
  PARTICLE_STYLES,
  PARTICLE_STYLE_LABELS,
  PULSE_LAYOUTS,
  REACTIVITY_MODES,
  REACTIVITY_MODE_LABELS,
  TRAIL_TYPES,
} from "../render/particleMath.js";
import { ENGINES, LOGO_HUD_TEXTS, QUICK_PRESETS } from "../app/AppState.js";

// ZUR-GH-013 (v6.0) deck config: Quick Presets strip + Engine Selector + one unlocked control deck. There are no HUD
// tabs and no per-tab option filtering: every control lists every value and is always visible.

const TRAIL_LABELS = { comet: "Comet", electric: "Electric", strobe: "Strobe", ribbon: "Ribbon", none: "None" };
const OSC_LABELS = { off: "Off", wave: "Wave", helix: "Helix", bounce: "Bounce", pulse: "Pulse" };
const LAYOUT_LABELS = { "band-clouds": "Band Clouds", "geodesic-sphere": "Geodesic Sphere", "wave-grid": "Wave Grid" };
const CAMERA_MODE_LABELS = { "static": "Static", "orbit-3d": "Orbit 3D", "tunnel-fly": "Tunnel Fly", "beat-bank": "Beat Bank" };

export const QUICK_PRESET_LABELS = Object.freeze(Object.fromEntries(QUICK_PRESETS.map((entry) => [entry.id, entry.label])));
export const ENGINE_LABELS = Object.freeze(Object.fromEntries(ENGINES.map((entry) => [entry.id, entry.label])));

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

/** `[control, label]` rows of the unlocked deck, in on-screen order. Every row is always visible. */
export const DECK_LAYOUT = Object.freeze([
  ["formation", "Formation"], ["style", "Particle Style"], ["palette", "Palette"],
  ["reactivityMode", "Reactivity Mode"], ["reactivity", "Reactivity Punch"],
  ["flow", "Flow"], ["kinetic", "Kinetic Mode"], ["count", "Particle Count Tier"], ["size", "Particle Size"],
  ["zoom", "Camera Zoom"], ["cameraMode", "Camera Mode"], ["trailType", "Trail Type"], ["trailLength", "Trail Length"],
  ["oscillation", "Oscillation"], ["oscAmount", "Oscillation Amount"], ["oscSpeed", "Oscillation Speed"],
  ["logoText", "Logo Text"], ["pulseLayout", "Pulse Field Layout"], ["kaleido", "Kaleidoscope Mirrors"],
  ["kaleidoSpin", "Beat Spin"], ["scenePalette", "Scene Palette (Aurora / Canyon)"], ["hueShift", "Hue Shift"],
  ["chromatic", "Chromatic Aberration"], ["godRays", "God Rays"],
]);

/** Raw option list for a select control (full lists, never filtered). */
export function optionsFor(control) {
  switch (control) {
    case "formation": return pairs(FORMATION_TYPES, FORMATION_LABELS);
    case "flow": return pairs(FLOW_MODES, FLOW_LABELS);
    case "style": return pairs(PARTICLE_STYLES, PARTICLE_STYLE_LABELS);
    case "kinetic": return pairs(KINETIC_MODES, KINETIC_LABELS);
    case "palette": return pairs(COLOR_PALETTES, COLOR_PALETTE_LABELS);
    case "reactivityMode": return pairs(REACTIVITY_MODES, REACTIVITY_MODE_LABELS);
    case "scenePalette": return PALETTE_IDS.map((id) => ({ value: id, label: id }));
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

export const SELECT_CONTROL_NAMES = Object.freeze([
  "formation", "flow", "style", "kinetic", "palette", "reactivityMode", "scenePalette", "oscillation", "logoText",
  "pulseLayout", "count", "cameraMode", "trailType", "kaleido",
]);

/** Every static option list the HUD can ever build (used by the contract test to prove no <option> is blank). */
export function allStaticOptionLists() {
  return SELECT_CONTROL_NAMES.map((control) => ({ key: "deck", control, options: optionsFor(control) }));
}
