/** Discord-encoder-safe 5-color palettes in 0..1 linear RGB. */

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function hexToLinear(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [16, 8, 0].map((shift) => srgbChannelToLinear(((value >> shift) & 255) / 255));
}

function palette(...hexes) {
  return hexes.map(hexToLinear);
}

/** Neon palettes keep every stop at HSV saturation >= 0.85 so additive glow never washes out to grey/white. */
export const NEON_PALETTE_IDS = Object.freeze(["neon-tunnel", "cyber-laser", "solar-plasma", "biolum-ocean", "emerald-matrix"]);
export const NEON_MIN_SATURATION = 0.85;

export const PALETTES = {
  "neon-tunnel": palette("#00F5FF", "#FF00A0", "#8A00FF", "#0066FF", "#FF00FF"),
  "cyber-laser": palette("#FF1744", "#00FFC6", "#FFE600", "#7A00FF", "#00FFFF"),
  "solar-plasma": palette("#FFB300", "#FF5A00", "#FF1F3D", "#FFD000", "#FF00FF"),
  "biolum-ocean": palette("#00FFD0", "#00B3FF", "#2040FF", "#9DFF00", "#00FFFF"),
  "emerald-matrix": palette("#00FF6A", "#00C853", "#7CFF00", "#00A8A8", "#39FF14"),
  "copper-teal": palette("#D4896A", "#E8B86D", "#F3E6D0", "#1FBEB0", "#14324A"),
};

export const PALETTE_IDS = Object.keys(PALETTES);

/**
 * ZUR-GH-014 universal palette: the single HUD Palette (particles.colorPalette) + Hue Shift drives all 5 engines. The
 * aurora / canyon / megastructure-rim 5-stop palettes come from this table (the old separate Scene Palette row is gone).
 */
export const UNIVERSAL_SCENE_PALETTES = Object.freeze({
  "true-neon": palette("#00F5FF", "#FF007F", "#8A2BE2", "#00FF66", "#00F5FF"),
  "full-spectrum": palette("#FF1744", "#FFE600", "#00FF66", "#00B3FF", "#B000FF"),
  "white-static": palette("#FFFFFF", "#D8ECFF", "#B8D8FF", "#FFFFFF", "#D8ECFF"),
  "crimson-pulse": palette("#2B0005", "#D90416", "#FF2A38", "#C8000A", "#FF0818"),
  "golden-cortex": palette("#FFD400", "#FFA800", "#FF7A00", "#00FFFF", "#B8D8FF"),
});

/** Shifted 5-stop scene palette for a universal colorPalette id (falls back to true-neon). */
export function universalPalette(colorPalette, hueShift = 0) {
  return shiftPalette(UNIVERSAL_SCENE_PALETTES[colorPalette] || UNIVERSAL_SCENE_PALETTES["true-neon"], hueShift);
}

function clampUnit(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Rotate a linear RGB palette around luma. hueShift is in turns (1 = full rotation). */
export function shiftPalette(colors, hueShift = 0) {
  const turns = Number.isFinite(hueShift) ? hueShift : 0;
  const angle = turns * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return colors.map(([r, g, b]) => {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cb = b - y;
    const cr = r - y;
    const rotatedCb = cb * cos - cr * sin;
    const rotatedCr = cb * sin + cr * cos;
    const nr = y + rotatedCr;
    const nb = y + rotatedCb;
    const ng = (y - 0.2126 * nr - 0.0722 * nb) / 0.7152;
    return [clampUnit(nr), clampUnit(ng), clampUnit(nb)];
  });
}
