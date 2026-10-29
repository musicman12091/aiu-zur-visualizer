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

export const PALETTES = {
  "neon-tunnel": palette("#00F5FF", "#FF00A0", "#7B2CBF", "#0066FF", "#FFFFFF"),
  "cyber-laser": palette("#FF2D55", "#00FFC6", "#FFE600", "#7A00FF", "#FFFFFF"),
  "solar-plasma": palette("#FFB300", "#FF5A00", "#FF1F3D", "#FFE08A", "#FFFFFF"),
  "biolum-ocean": palette("#00FFD0", "#00B3FF", "#3D5AFE", "#B8FF5A", "#E6FFFF"),
  "emerald-matrix": palette("#00FF6A", "#00C853", "#B6FF9E", "#00A8A8", "#EFFFF4"),
  "copper-teal": palette("#D4896A", "#E8B86D", "#F3E6D0", "#1FBEB0", "#14324A"),
};

export const PALETTE_IDS = Object.keys(PALETTES);

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
