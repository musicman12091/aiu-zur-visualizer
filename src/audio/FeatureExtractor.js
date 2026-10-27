/**
 * Frozen Stage 1 signal math.
 * Band edges are a log-frequency partition. Bin weights are fractional Hz
 * overlap and are rebuilt only when sampleRate, fftSize, or edges change.
 * Analysis stays in this module — nothing here touches AudioContext.destination.
 */

export const BANDS = Object.freeze({
  sub: Object.freeze([20, 60]),
  bass: Object.freeze([60, 250]),
  lowMid: Object.freeze([250, 1000]),
  highMid: Object.freeze([1000, 4000]),
  treble: Object.freeze([4000, 16000]),
});

export const BAND_NAMES = Object.freeze(["sub", "bass", "lowMid", "highMid", "treble"]);

export const ENVELOPES = Object.freeze({
  fast: Object.freeze({ attackMs: 10, releaseMs: 90 }),
  medium: Object.freeze({ attackMs: 25, releaseMs: 180 }),
  slow: Object.freeze({ attackMs: 80, releaseMs: 450 }),
});

export const DB_FLOOR = -120;
export const MIN_DECIBELS = -85;
export const MAX_DECIBELS = -10;
export const ONSET_REFRACTORY_SECONDS = 0.12;
export const SILENCE_HOLD_SECONDS = 0.25;
export const PRE_AMP_MIN = 1;
export const PRE_AMP_MAX = 25;

const MEDIUM_BANDS = ["sub", "bass", "lowMid"];
const SLOW_BANDS = ["highMid", "treble"];

export function clamp01(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function clampDb(rawDb) {
  if (!Number.isFinite(rawDb)) return DB_FLOOR;
  return Math.max(DB_FLOOR, rawDb);
}

export function dbToPower(rawDb) {
  return 10 ** (clampDb(rawDb) / 10);
}

export function envelopeAlpha(deltaSeconds, timeConstantMs) {
  if (!(timeConstantMs > 0)) return 1;
  if (!(deltaSeconds > 0)) return 0;
  return 1 - Math.exp((-deltaSeconds * 1000) / timeConstantMs);
}

export function stepEnvelope(current, input, deltaSeconds, timing) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeInput = Number.isFinite(input) ? input : 0;
  const timeConstantMs = safeInput > safeCurrent ? timing.attackMs : timing.releaseMs;
  const alpha = envelopeAlpha(deltaSeconds, timeConstantMs);
  return safeCurrent + (safeInput - safeCurrent) * alpha;
}

export function buildBinWeights(sampleRate, fftSize, bands = BANDS) {
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;
  const weights = {};
  for (const [name, range] of Object.entries(bands)) {
    const lo = range[0];
    const hi = range[1];
    const entries = [];
    for (let index = 0; index < binCount; index += 1) {
      const binLo = index * hzPerBin;
      const binHi = binLo + hzPerBin;
      const overlap = Math.min(binHi, hi) - Math.max(binLo, lo);
      if (overlap > 1e-9) {
        entries.push({ index, weight: overlap / hzPerBin });
      }
    }
    weights[name] = entries;
  }
  return weights;
}

export function bandLevelFromDb(
  rawDb,
  entries,
  preAmpGain = 1,
  minDecibels = MIN_DECIBELS,
  maxDecibels = MAX_DECIBELS,
) {
  let weightSum = 0;
  let powerSum = 0;
  const gain = Number.isFinite(preAmpGain) ? preAmpGain : 1;
  for (const entry of entries) {
    const weight = entry.weight;
    if (!(weight > 0)) continue;
    powerSum += dbToPower(rawDb[entry.index]) * weight;
    weightSum += weight;
  }
  if (!(weightSum > 0)) return 0;
  const meanPower = (powerSum / weightSum) * gain * gain;
  const bandDb = 10 * Math.log10(Math.max(meanPower, 1e-12));
  const span = maxDecibels - minDecibels;
  if (!(span > 0) || !Number.isFinite(bandDb)) return 0;
  return clamp01((bandDb - minDecibels) / span);
}

export function rmsFromTimeDomain(samples, preAmpGain = 1) {
  if (!samples || samples.length === 0) return 0;
  const gain = Number.isFinite(preAmpGain) ? preAmpGain : 1;
  let sumSquares = 0;
  let count = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) continue;
    sumSquares += sample * sample;
    count += 1;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSquares / count) * gain;
}

export function peakFromTimeDomain(samples, preAmpGain = 1) {
  if (!samples || samples.length === 0) return 0;
  const gain = Number.isFinite(preAmpGain) ? preAmpGain : 1;
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) continue;
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak * gain;
}

/** Phase-safe stereo energy. Opposite-polarity channels do not cancel. */
export function combineStereoEnergy(rmsL, rmsR) {
  const left = Number.isFinite(rmsL) ? rmsL : 0;
  const right = Number.isFinite(rmsR) ? rmsR : 0;
  return Math.sqrt((left * left + right * right) / 2);
}

function emptyBands() {
  return { sub: 0, bass: 0, lowMid: 0, highMid: 0, treble: 0 };
}

export class FeatureExtractor {
  constructor(options = {}) {
    this.sampleRate = 0;
    this.fftSize = 0;
    this.weights = null;
    this.bands = BANDS;
    this.preAmpGain = 1;
    this.masterGain = 1;
    this.bandGain = { sub: 1, bass: 1, lowMid: 1, highMid: 1, treble: 1 };
    this.noiseGateThreshold = 0.02;
    this.minDecibels = MIN_DECIBELS;
    this.maxDecibels = MAX_DECIBELS;
    this.onsetThresholdMultiplier = 1.5;
    this.minOnsetFlux = 0.03;
    this.mediumTiming = { attackMs: ENVELOPES.medium.attackMs, releaseMs: ENVELOPES.medium.releaseMs };
    this.medium = emptyBands();
    this.slow = emptyBands();
    this.onsetEnv = 0;
    this.prevBands = emptyBands();
    this.meanFlux = 0;
    this.varFlux = 0;
    this.silentFor = 0;
    this.isSilent = false;
    this.lastOnsetAt = -Infinity;
    this.onsetTriggerCount = 0;
    this._silentFreq = null;
    this._silentWave = null;
    this._stereoScratch = null;
    this.configure({
      sampleRate: options.sampleRate ?? 48000,
      fftSize: options.fftSize ?? 2048,
    });
    if (options.preAmpGain != null) this.setPreAmpGain(options.preAmpGain);
    if (options.noiseGateThreshold != null) this.noiseGateThreshold = options.noiseGateThreshold;
    if (options.onsetThresholdMultiplier != null) {
      this.onsetThresholdMultiplier = options.onsetThresholdMultiplier;
    }
    if (options.minOnsetFlux != null) this.minOnsetFlux = options.minOnsetFlux;
    if (options.masterGain != null) this.masterGain = options.masterGain;
    if (options.bandGain) this.bandGain = { ...this.bandGain, ...options.bandGain };
  }

  configure({ sampleRate, fftSize } = {}) {
    const nextRate = sampleRate || this.sampleRate || 48000;
    const nextSize = fftSize || this.fftSize || 2048;
    if (this.weights && nextRate === this.sampleRate && nextSize === this.fftSize) return;
    this.sampleRate = nextRate;
    this.fftSize = nextSize;
    this.binCount = nextSize / 2;
    this.weights = buildBinWeights(nextRate, nextSize, this.bands);
    this._silentFreq = null;
    this._silentWave = null;
    this._stereoScratch = null;
  }

  setPreAmpGain(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    this.preAmpGain = Math.min(PRE_AMP_MAX, Math.max(PRE_AMP_MIN, numeric));
  }

  setMix({ masterGain, bandGain, noiseGateThreshold } = {}) {
    if (Number.isFinite(masterGain) && masterGain > 0) this.masterGain = masterGain;
    if (bandGain) this.bandGain = { ...this.bandGain, ...bandGain };
    if (Number.isFinite(noiseGateThreshold) && noiseGateThreshold >= 0) {
      this.noiseGateThreshold = noiseGateThreshold;
    }
  }

  /**
   * Preset attack/release drive the Medium envelope only.
   * Fast (10/90) and Slow (80/450) stay frozen.
   */
  setMediumEnvelope(attackMs, releaseMs) {
    if (Number.isFinite(attackMs) && attackMs > 0) this.mediumTiming.attackMs = attackMs;
    if (Number.isFinite(releaseMs) && releaseMs > 0) this.mediumTiming.releaseMs = releaseMs;
  }

  silentSpectrum() {
    if (!this._silentFreq || this._silentFreq.length !== this.binCount) {
      this._silentFreq = new Float32Array(this.binCount);
      this._silentFreq.fill(DB_FLOOR);
    }
    return this._silentFreq;
  }

  silentWaveform() {
    if (!this._silentWave || this._silentWave.length !== this.fftSize) {
      this._silentWave = new Float32Array(this.fftSize);
    }
    return this._silentWave;
  }

  update({
    timestampSeconds = 0,
    deltaSeconds = 0,
    frequencyDb,
    frequencyDbRight = null,
    waveform,
    waveformRight = null,
  } = {}) {
    const spectrum = this._mergeStereoSpectrum(frequencyDb, frequencyDbRight);
    const raw = emptyBands();
    for (const name of BAND_NAMES) {
      raw[name] = bandLevelFromDb(
        spectrum,
        this.weights[name],
        this.preAmpGain,
        this.minDecibels,
        this.maxDecibels,
      );
    }
    const energy = this._measureEnergy(waveform, waveformRight);
    return this.updateFromBands({
      bands: raw,
      rms: energy.rms,
      peak: energy.peak,
      deltaSeconds,
      timestampSeconds,
    });
  }

  updateFromBands({ bands, rms, peak = 0, deltaSeconds = 0, timestampSeconds = 0 }) {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const postRms = Number.isFinite(rms) ? Math.max(0, rms) : 0;
    const postPeak = Number.isFinite(peak) ? Math.max(0, peak) : 0;

    if (postRms < this.noiseGateThreshold) {
      this.silentFor += dt;
      this.isSilent = this.silentFor > SILENCE_HOLD_SECONDS;
    } else {
      this.silentFor = 0;
      this.isSilent = false;
    }

    const shaped = emptyBands();
    for (const name of BAND_NAMES) {
      const gain = Number.isFinite(this.bandGain[name]) ? this.bandGain[name] : 1;
      const level = Number.isFinite(bands[name]) ? bands[name] : 0;
      shaped[name] = clamp01(level * gain * this.masterGain);
    }

    let flux = 0;
    for (const name of BAND_NAMES) {
      flux += Math.max(0, shaped[name] - (this.prevBands[name] || 0));
    }
    this.prevBands = { ...shaped };

    const stdFlux = Math.sqrt(Math.max(0, this.varFlux));
    const threshold = this.meanFlux + this.onsetThresholdMultiplier * stdFlux;
    const time = Number.isFinite(timestampSeconds) ? timestampSeconds : 0;
    const refractoryOpen = time - this.lastOnsetAt >= ONSET_REFRACTORY_SECONDS;
    let onsetTarget = 0;
    if (!this.isSilent && flux >= this.minOnsetFlux && flux > threshold && refractoryOpen) {
      onsetTarget = 1;
      this.lastOnsetAt = time;
      this.onsetTriggerCount += 1;
    }

    const follow = envelopeAlpha(dt, 500);
    this.meanFlux += follow * (flux - this.meanFlux);
    const deviation = (flux - this.meanFlux) ** 2;
    this.varFlux += follow * (deviation - this.varFlux);

    for (const name of MEDIUM_BANDS) {
      this.medium[name] = stepEnvelope(this.medium[name], shaped[name], dt, this.mediumTiming);
    }
    for (const name of SLOW_BANDS) {
      this.slow[name] = stepEnvelope(this.slow[name], shaped[name], dt, ENVELOPES.slow);
    }
    this.onsetEnv = stepEnvelope(this.onsetEnv, onsetTarget, dt, ENVELOPES.fast);
    if (this.isSilent) this.onsetEnv = 0;

    return {
      timestampSeconds: time,
      rms: clamp01(postRms * this.masterGain),
      peak: clamp01(postPeak * this.masterGain),
      sub: clamp01(this.medium.sub),
      bass: clamp01(this.medium.bass),
      lowMid: clamp01(this.medium.lowMid),
      highMid: clamp01(this.slow.highMid),
      treble: clamp01(this.slow.treble),
      onset: clamp01(this.onsetEnv),
      beat: 0,
      beatConfidence: 0,
      isSilent: this.isSilent,
    };
  }

  _mergeStereoSpectrum(frequencyDb, frequencyDbRight) {
    const source = frequencyDb ?? this.silentSpectrum();
    if (!frequencyDbRight) return source;
    if (!this._stereoScratch || this._stereoScratch.length !== source.length) {
      this._stereoScratch = new Float32Array(source.length);
    }
    for (let index = 0; index < source.length; index += 1) {
      const power = (dbToPower(source[index]) + dbToPower(frequencyDbRight[index])) / 2;
      this._stereoScratch[index] = 10 * Math.log10(Math.max(power, 1e-12));
    }
    return this._stereoScratch;
  }

  _measureEnergy(waveform, waveformRight) {
    const wave = waveform ?? this.silentWaveform();
    if (!waveformRight) {
      return {
        rms: rmsFromTimeDomain(wave, this.preAmpGain),
        peak: peakFromTimeDomain(wave, this.preAmpGain),
      };
    }
    const rms = combineStereoEnergy(
      rmsFromTimeDomain(wave, this.preAmpGain),
      rmsFromTimeDomain(waveformRight, this.preAmpGain),
    );
    const peak = Math.max(
      peakFromTimeDomain(wave, this.preAmpGain),
      peakFromTimeDomain(waveformRight, this.preAmpGain),
    );
    return { rms, peak };
  }
}
