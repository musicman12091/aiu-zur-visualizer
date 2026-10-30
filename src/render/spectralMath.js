const BAND_CENTERS = [0.04, 0.22, 0.46, 0.70, 0.92];
const BAND_WIDTHS = [0.09, 0.13, 0.15, 0.14, 0.10];

function clamp01(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Converts live dB bins, or smoothed five-band levels, to one RGBA8 waterfall row. */
export function getSpectrumRow128(frame = {}) {
  const row = new Uint8Array(128 * 4);
  const bins = frame.frequencyDb || frame.spectrum || frame.bins;
  for (let x = 0; x < 128; x += 1) {
    let level = 0;
    if (bins?.length) {
      const index = Math.min(bins.length - 1, Math.floor((x / 127) * bins.length));
      const db = Number(bins[index]);
      level = clamp01((db + 100) / 90);
    } else {
      let weighted = 0;
      let total = 0;
      for (let band = 0; band < BAND_CENTERS.length; band += 1) {
        const distance = (x / 127 - BAND_CENTERS[band]) / BAND_WIDTHS[band];
        const weight = Math.exp(-0.5 * distance * distance);
        const value = [frame.sub, frame.bass, frame.lowMid, frame.highMid, frame.treble][band] || 0;
        weighted += clamp01(value) * weight;
        total += weight;
      }
      level = total ? clamp01(weighted / total) : 0;
    }
    const value = Math.round(level * 255);
    const offset = x * 4;
    row[offset] = value;
    row[offset + 1] = value;
    row[offset + 2] = value;
    row[offset + 3] = 255;
  }
  return row;
}

