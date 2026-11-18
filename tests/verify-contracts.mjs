import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MODE_A_PRESET, MODE_B_PRESET, BLUEPRINT_EXAMPLE_PRESET, AppState, validatePreset } from "../src/app/AppState.js";
import {
  BANDS,
  ENVELOPES,
  ONSET_REFRACTORY_SECONDS,
  SILENCE_HOLD_SECONDS,
  FeatureExtractor,
  bandLevelFromDb,
  buildBinWeights,
  clamp01,
  combineStereoEnergy,
  rmsFromTimeDomain,
  stepEnvelope,
} from "../src/audio/FeatureExtractor.js";
import { QUALITY_TIERS, resolveRenderSize, shouldRenderFrame } from "../src/render/RenderHost.js";
import { trailDecay } from "../src/render/ShaderHost.js";
import { TransitionController } from "../src/render/TransitionController.js";
import {
  TRAIL_ENERGY_NORM_MIN,
  TRAIL_HIGH_COUNT,
  TRAIL_KEEP_CAP,
  TRAIL_TRANSITION_KEEP_MAX,
  TRAIL_TRANSITION_MS,
  TrailTransitionGuard,
  capKeepFactor,
  normalizedSteadyStateEnergy,
  particleSizeNorm,
  trailEnergyNorm,
  transitionSignature,
} from "../src/render/PostProcessPass.js";
import { STAGE2_DEFAULT_PRESET, applyModeKeepingScene } from "../src/app/AppState.js";
import {
  COUNT_TIERS,
  FLOW_DAMPING_PER_STEP,
  FLOW_MODES,
  KALEIDO_SEGMENTS,
  MAX_STEPS_PER_FRAME,
  PARTICLE_SCENE_ID,
  MEGASTRUCTURE_SCENE_ID,
  SPECTRAL_CANYON_SCENE_ID,
  SCENE_IDS,
  SHOCK_EMPTY_BIRTH,
  SHOCK_SLOTS,
  SIM_STEP,
  createShockBuffer,
  isShockSlotActive,
  dampingRateFromRetention,
  decodePresetParam,
  encodePresetParam,
  frozenDragCoefficients,
  hash32,
  integrateFrozenDrag,
  isInstanceVisible,
  isMobileAgent,
  kaleidoFold,
  lissajous,
  minRenderRadiusPx,
  nextAutoCount,
  normalizeParticles,
  planFixedSteps,
  resolveParticleCount,
  ringNeighbors,
  shockwaveWeight,
  steadyStateRadiance,
  stepdownThreshold,
  toneMap,
  trailRadianceScale,
  visibleThreshold,
  LOGO_OSCILLATION_SCALE,
  LOGO_TEXT_PRESETS,
  LOGO_TRAIL_LENGTH_MAX,
  billboardBasis,
  effectiveOscillationAmount,
  effectiveTrailLength,
} from "../src/render/particleMath.js";
import { seedParticleState, SPAWN_HALF } from "../src/render/ParticleSystem3D.js";
import {
  COUNT_TIER_VALUES,
  DEFAULT_PARTICLES,
  FORMATION_TYPES,
  GLOW,
  OSCILLATION_TYPES,
  PULSE_LAYOUTS,
  PULSE_SCENE_ID,
  TRAIL_TYPES,
  chromaToneMap,
  densityScaleBoost,
  densityTrailScale,
  glowProfile,
  keepForDt,
  projectionScales,
  resolveFboSize,
  tauFromKeep60,
  trailKeepFactor,
} from "../src/render/particleMath.js";
import { PALETTES, PALETTE_IDS } from "../src/controls/palettes.js";
import { STAGE3_DEFAULTS, stage3View } from "../src/app/AppState.js";
import {
  STORAGE_KEY, STORAGE_SCHEMA, LEGACY_STORAGE_KEYS, V3_2_UPGRADE_DEFAULTS, V4_NEON_FLAG, loadStoredState, serializeStoredState,
} from "../src/app/AppState.js";
import { NEON_PALETTE_IDS, NEON_MIN_SATURATION } from "../src/controls/palettes.js";
import { CAPSULE_ALPHA, capsuleAlpha, crowdNorm, foldRadius, kaleidoVignette, mirrorRepeat } from "../src/render/particleMath.js";
import { HUD_DRAWER_Y_OFFSET, stepViewportYOffset, viewportYOffsetTarget } from "../src/render/RenderHost.js";
import { sampleLogoTargets } from "../src/render/LogoAttractor.js";
import { getSpectrumRow128 } from "../src/render/spectralMath.js";
import { VJ_DWELL_SECONDS, VJ_MANUAL_PAUSE_SECONDS, VJAutopilot, VJ_PHASES } from "../src/app/VJAutopilot.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function read(path) {
  return readFileSync(path, "utf8");
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sliceExport(source, name) {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const next = source.slice(start + 1).search(/\n(?:export )?(?:async )?function /);
  return source.slice(start, next === -1 ? source.length : start + 1 + next);
}

test("stage 1 file map exists", () => {
  const files = [
    "index.html",
    "manifest.json",
    "sw.js",
    "CONTRACTS.md",
    "STATE.md",
    "src/app/main.js",
    "src/app/AppState.js",
    "src/audio/AudioEngine.js",
    "src/audio/FeatureExtractor.js",
    "src/render/RenderHost.js",
    "src/render/ShaderHost.js",
    "src/render/TransitionController.js",
    "src/controls/ControlHUD.js",
    "src/controls/palettes.js",
    "src/scenes/aurora-ribbons.glsl",
    "tests/verify-contracts.mjs",
    "icons/icon-192.png",
    "icons/icon-512.png",
  ];
  for (const file of files) assert.ok(existsSync(file), file);
});

test("manifest is a standalone PWA", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.icons.length >= 2);
});

test("service worker caches the app shell", () => {
  const source = read("sw.js");
  assert.match(source, /addEventListener\("install"/);
  assert.match(source, /addEventListener\("fetch"/);
  assert.match(source, /aurora-ribbons\.glsl/);
});

test("wake lock is requested and reacquired on visibility", () => {
  const source = read("src/app/main.js");
  assert.match(source, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /document\.visibilityState === "visible"/);
  const tab = source.slice(source.indexOf("tab: () =>"), source.indexOf("mic: () =>"));
  assert.ok(tab.indexOf("startTabCapture") < tab.indexOf("acquireWakeLock"));
  const mic = source.slice(source.indexOf("mic: () =>"), source.indexOf("oscillator: () =>"));
  assert.ok(mic.indexOf("startMicCapture") < mic.indexOf("acquireWakeLock"));
});

test("capture starts are synchronous and never reach destination", () => {
  const source = read("src/audio/AudioEngine.js");
  const code = stripComments(source);
  for (const name of ["startTabCapture", "startMicCapture", "startTestOscillator"]) {
    const body = sliceExport(code, name);
    assert.equal(body.includes("await "), false, `${name} must not await before returning`);
    assert.ok(body.includes(".resume()"), name);
  }
  assert.ok(sliceExport(code, "startTabCapture").includes("getDisplayMedia("));
  assert.ok(sliceExport(code, "startMicCapture").includes("getUserMedia("));
  assert.match(code, /createMediaStreamSource\(new MediaStream\(\[audioTrack\]\)\)/);
  assert.match(code, /smoothingTimeConstant = 0/);
  assert.match(code, /suppressLocalAudioPlayback/);
  assert.match(code, /systemAudio: includeSystemAudio \? "include" : "exclude"/);
  assert.ok((code.match(/echoCancellation: false/g) || []).length >= 2);
  assert.ok((code.match(/noiseSuppression: false/g) || []).length >= 2);
  assert.ok((code.match(/autoGainControl: false/g) || []).length >= 2);
  assert.match(code, /\[40, 120, 500, 2000, 8000\]/);
  // ZUR-GH-013: exactly one destination connect in the whole engine, inside monitorConnect() (file track + Speaker
  // Monitor only); capture starts never reach it.
  assert.equal((code.match(/\.connect\([^)]*\.destination/g) || []).length, 1, "single destination path");
  const monitor = code.slice(code.indexOf("function monitorConnect"), code.indexOf("function monitorDisconnect"));
  assert.match(monitor, /currentMode !== "file-track"/);
  assert.match(monitor, /source\.connect\(context\.destination\)/);
  for (const name of ["startTabCapture", "startMicCapture", "startTestOscillator"]) {
    assert.doesNotMatch(sliceExport(code, name), /destination|monitorConnect/, `${name} never reaches the destination`);
  }
  assert.doesNotMatch(code, /getVideoTracks\(\)[^\n;]{0,80}\.stop\(/);
});

test("aurora scene implements only renderScene", () => {
  const scene = read("src/scenes/aurora-ribbons.glsl");
  assert.match(scene, /vec3\s+renderScene\s*\(\s*vec2\s+uv\s*\)/);
  assert.doesNotMatch(scene, /void\s+main\s*\(/);
  assert.doesNotMatch(scene, /#version/);
  assert.doesNotMatch(scene, /gl_FragColor/);
  assert.match(scene, /u_bass/);
  assert.match(scene, /u_mid/);
  assert.match(scene, /u_high/);
});

test("clamp01 rejects non-finite values", () => {
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(clamp01(Number.POSITIVE_INFINITY), 0);
  assert.equal(clamp01(Number.NEGATIVE_INFINITY), 0);
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(1), 1);
  assert.equal(clamp01(1.4), 1);
});

test("logarithmic bands use fractional bin overlap", () => {
  const sampleRate = 48000;
  const fftSize = 2048;
  const hzPerBin = sampleRate / fftSize;
  const weights = buildBinWeights(sampleRate, fftSize);
  for (const [name, range] of Object.entries(BANDS)) {
    const covered = Math.min(range[1], sampleRate / 2) - range[0];
    const sum = weights[name].reduce((total, entry) => total + entry.weight * hzPerBin, 0);
    assert.ok(Math.abs(sum - covered) < 1e-6, `${name} coverage ${sum}`);
  }
  const sub0 = weights.sub.find((entry) => entry.index === 0);
  assert.ok(sub0);
  assert.ok(Math.abs(sub0.weight - ((hzPerBin - 20) / hzPerBin)) < 1e-12);
});

test("bin weights are reused until the FFT configuration changes", () => {
  const extractor = new FeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
  const weights = extractor.weights;
  extractor.configure({ sampleRate: 48000, fftSize: 2048 });
  assert.equal(extractor.weights, weights);
  extractor.update({
    timestampSeconds: 0,
    deltaSeconds: 0.016,
    frequencyDb: extractor.silentSpectrum(),
    waveform: extractor.silentWaveform(),
  });
  assert.equal(extractor.weights, weights);
  extractor.configure({ sampleRate: 48000, fftSize: 4096 });
  assert.notEqual(extractor.weights, weights);
});

test("linear power uses a -120 dB floor and pre-amp squared", () => {
  const entries = [
    { index: 0, weight: 0.5 },
    { index: 1, weight: 1 },
  ];
  const raw = Float32Array.of(-10, -20);
  const mean = ((10 ** (-10 / 10)) * 0.5 + (10 ** (-20 / 10)) * 1) / 1.5;
  const expected = ((10 * Math.log10(mean)) - (-85)) / ((-10) - (-85));
  assert.ok(Math.abs(expected - 0.946941332177) < 1e-9);
  assert.ok(Math.abs(bandLevelFromDb(raw, entries, 1) - expected) < 1e-9);
  assert.equal(bandLevelFromDb(raw, entries, 2), 1);
  assert.equal(bandLevelFromDb(Float32Array.of(Number.NEGATIVE_INFINITY), [{ index: 0, weight: 1 }], 1), 0);
  assert.equal(bandLevelFromDb(Float32Array.of(-120), [{ index: 0, weight: 1 }], 1), 0);
  assert.equal(bandLevelFromDb(Float32Array.of(Number.NaN), [{ index: 0, weight: 1 }], 1), 0);
  const boosted = bandLevelFromDb(Float32Array.of(-40), [{ index: 0, weight: 1 }], 10);
  assert.ok(Math.abs(boosted - ((-20 - (-85)) / 75)) < 1e-9);
});

test("bass energy stays in the bass band", () => {
  const extractor = new FeatureExtractor({
    sampleRate: 48000,
    fftSize: 2048,
    preAmpGain: 1,
    noiseGateThreshold: 0.01,
  });
  const frequencyDb = new Float32Array(1024).fill(-120);
  for (const entry of extractor.weights.bass) {
    if (entry.weight === 1) frequencyDb[entry.index] = -20;
  }
  const waveform = new Float32Array(2048).fill(0.2);
  const frame = extractor.update({
    timestampSeconds: 0.016,
    deltaSeconds: 0.016,
    frequencyDb,
    waveform,
  });
  assert.ok(frame.bass > frame.treble);
  assert.ok(frame.bass > frame.sub);
  assert.equal(frame.beat, 0);
  assert.equal(frame.beatConfidence, 0);
  assert.equal(frame.isSilent, false);
});

test("envelopes are frame-rate independent and keep their time constants", () => {
  assert.deepEqual(ENVELOPES.fast, { attackMs: 10, releaseMs: 90 });
  assert.deepEqual(ENVELOPES.medium, { attackMs: 25, releaseMs: 180 });
  assert.deepEqual(ENVELOPES.slow, { attackMs: 80, releaseMs: 450 });
  const attack = stepEnvelope(0, 1, 0.01, ENVELOPES.fast);
  assert.ok(Math.abs(attack - (1 - Math.exp(-1))) < 1e-12);
  const release = stepEnvelope(1, 0, 0.01, { attackMs: 9999, releaseMs: 10 });
  assert.ok(release < 0.5);
  const shaped = new FeatureExtractor().updateFromBands({
    bands: { sub: 1, bass: 1, lowMid: 1, highMid: 1, treble: 1 },
    rms: 0.5,
    deltaSeconds: 0.025,
    timestampSeconds: 0.025,
  });
  assert.ok(shaped.bass > shaped.treble);

  const extractor = new FeatureExtractor({ onsetThresholdMultiplier: -10, minOnsetFlux: 0.01 });
  extractor.setMediumEnvelope(15, 400);
  const triggered = extractor.updateFromBands({
    bands: { sub: 1, bass: 1, lowMid: 1, highMid: 1, treble: 1 },
    rms: 0.4,
    deltaSeconds: 0.016,
    timestampSeconds: 1,
  });
  assert.ok(triggered.onset > 0.7 && triggered.onset < 0.85);
  const decayed = extractor.updateFromBands({
    bands: { sub: 1, bass: 1, lowMid: 1, highMid: 1, treble: 1 },
    rms: 0.4,
    deltaSeconds: 0.09,
    timestampSeconds: 1.2,
  });
  assert.ok(decayed.onset < 0.45);
});

test("onset respects a 120 ms refractory lock and the silence gate", () => {
  assert.equal(ONSET_REFRACTORY_SECONDS, 0.12);
  assert.equal(SILENCE_HOLD_SECONDS, 0.25);
  const extractor = new FeatureExtractor({
    noiseGateThreshold: 0.02,
    onsetThresholdMultiplier: -10,
    minOnsetFlux: 0.01,
  });
  const spike = { sub: 0.8, bass: 0, lowMid: 0, highMid: 0, treble: 0 };
  const rest = { sub: 0, bass: 0, lowMid: 0, highMid: 0, treble: 0 };
  extractor.updateFromBands({ bands: spike, rms: 0.4, deltaSeconds: 0.05, timestampSeconds: 0 });
  extractor.updateFromBands({ bands: rest, rms: 0.4, deltaSeconds: 0.05, timestampSeconds: 0.05 });
  extractor.updateFromBands({ bands: spike, rms: 0.4, deltaSeconds: 0.05, timestampSeconds: 0.1 });
  assert.equal(extractor.onsetTriggerCount, 1);
  extractor.updateFromBands({ bands: rest, rms: 0.4, deltaSeconds: 0.05, timestampSeconds: 0.15 });
  extractor.updateFromBands({ bands: spike, rms: 0.4, deltaSeconds: 0.05, timestampSeconds: 0.2 });
  assert.equal(extractor.onsetTriggerCount, 2);

  const silent = new FeatureExtractor({
    noiseGateThreshold: 0.05,
    onsetThresholdMultiplier: -10,
    minOnsetFlux: 0,
  });
  const quiet = silent.updateFromBands({
    bands: rest,
    rms: 0,
    deltaSeconds: 0.25,
    timestampSeconds: 0.25,
  });
  assert.equal(quiet.isSilent, false);
  const gated = silent.updateFromBands({
    bands: { sub: 1, bass: 1, lowMid: 1, highMid: 1, treble: 1 },
    rms: 0,
    deltaSeconds: 0.01,
    timestampSeconds: 0.26,
  });
  assert.equal(gated.isSilent, true);
  assert.equal(gated.onset, 0);
  assert.equal(silent.onsetTriggerCount, 0);
});

test("NaN waveforms and bands collapse to finite 0..1 fields", () => {
  const extractor = new FeatureExtractor({ sampleRate: 48000, fftSize: 32, noiseGateThreshold: 0 });
  const waveform = new Float32Array(32);
  waveform.fill(Number.NaN);
  waveform[3] = Number.POSITIVE_INFINITY;
  const frequencyDb = new Float32Array(16);
  frequencyDb.fill(Number.NaN);
  const frame = extractor.update({
    timestampSeconds: Number.NaN,
    deltaSeconds: 0.016,
    frequencyDb,
    waveform,
  });
  for (const key of ["rms", "peak", "sub", "bass", "lowMid", "highMid", "treble", "onset", "beat", "beatConfidence"]) {
    assert.equal(typeof frame[key], "number");
    assert.ok(frame[key] >= 0 && frame[key] <= 1, key);
  }
  assert.equal(frame.rms, 0);
  assert.equal(frame.peak, 0);
});

test("stereo energy survives opposite polarity", () => {
  const left = new Float32Array([0.5, -0.5]);
  const right = new Float32Array([-0.5, 0.5]);
  const cancelled = new Float32Array([0, 0]);
  const energy = combineStereoEnergy(rmsFromTimeDomain(left, 1), rmsFromTimeDomain(right, 1));
  assert.ok(Math.abs(energy - 0.5) < 1e-12);
  assert.equal(rmsFromTimeDomain(cancelled, 1), 0);
  const extractor = new FeatureExtractor({ preAmpGain: 2, noiseGateThreshold: 0 });
  const frame = extractor.update({
    timestampSeconds: 0,
    deltaSeconds: 0.016,
    frequencyDb: extractor.silentSpectrum(),
    waveform: left,
    waveformRight: right,
  });
  assert.ok(Math.abs(frame.rms - 1) < 1e-12);
});

test("pre-amp gain stays inside 1x..25x", () => {
  const extractor = new FeatureExtractor();
  extractor.setPreAmpGain(100);
  assert.equal(extractor.preAmpGain, 25);
  extractor.setPreAmpGain(0.2);
  assert.equal(extractor.preAmpGain, 1);
});

test("preset schema accepts the blueprint example and both hardware modes", () => {
  for (const preset of [BLUEPRINT_EXAMPLE_PRESET, MODE_A_PRESET, MODE_B_PRESET]) {
    const result = validatePreset(preset);
    assert.equal(result.ok, true, result.errors?.join("; "));
  }
  assert.equal(MODE_A_PRESET.audio.inputMode, "tab-capture");
  assert.equal(MODE_A_PRESET.audio.suppressLocalAudio, true);
  assert.equal(MODE_A_PRESET.audio.includeSystemAudio, false);
  assert.equal(MODE_A_PRESET.audio.preAmpGain, 1);
  assert.equal(MODE_A_PRESET.visual.width, 1280);
  assert.equal(MODE_A_PRESET.visual.height, 720);
  assert.equal(MODE_A_PRESET.visual.fps, 30);
  assert.equal(MODE_A_PRESET.visual.complexity, 0.35);
  assert.equal(MODE_B_PRESET.audio.inputMode, "microphone");
  assert.equal(MODE_B_PRESET.audio.preAmpGain, 10);
  assert.equal(MODE_B_PRESET.visual.width, 1280);
  assert.equal(MODE_B_PRESET.visual.height, 720);
  assert.equal(MODE_B_PRESET.visual.fps, 60);
  assert.equal(MODE_B_PRESET.visual.complexity, 0.65);
  assert.equal(MODE_A_PRESET.transition.minimumDwellSeconds, 45);
  assert.equal(MODE_B_PRESET.transition.minimumDwellSeconds, 45);

  const state = new AppState(MODE_B_PRESET);
  assert.equal(JSON.parse(state.exportPreset()).visual.fps, 60);
  assert.equal(state.importPreset("{").ok, false);
  const broken = validatePreset({ ...MODE_A_PRESET, schemaVersion: 2 });
  assert.equal(broken.ok, false);
  const loud = validatePreset({
    ...MODE_A_PRESET,
    audio: { ...MODE_A_PRESET.audio, preAmpGain: 26 },
  });
  assert.equal(loud.ok, false);
  const executable = validatePreset({
    ...MODE_A_PRESET,
    audio: { ...MODE_A_PRESET.audio, injected: () => {} },
  });
  assert.equal(executable.ok, false);
});

test("four quality tiers and trail decay match the hardware contract", () => {
  assert.equal(QUALITY_TIERS.length, 4);
  assert.deepEqual(
    [QUALITY_TIERS[0].width, QUALITY_TIERS[0].height, QUALITY_TIERS[0].fps, QUALITY_TIERS[0].complexity],
    [1280, 720, 30, 0.35],
  );
  assert.deepEqual(
    [QUALITY_TIERS[1].width, QUALITY_TIERS[1].height, QUALITY_TIERS[1].fps, QUALITY_TIERS[1].complexity],
    [1280, 720, 60, 0.65],
  );
  const modeA = resolveRenderSize(MODE_A_PRESET);
  const modeB = resolveRenderSize(MODE_B_PRESET);
  assert.deepEqual([modeA.width, modeA.height, modeA.fps, modeA.complexity], [1280, 720, 30, 0.35]);
  assert.deepEqual([modeB.width, modeB.height, modeB.fps, modeB.complexity], [1280, 720, 60, 0.65]);
  assert.equal(shouldRenderFrame(16, 30), false);
  assert.equal(shouldRenderFrame(33, 30), true);
  assert.ok(Math.abs(trailDecay(0.22, 220) - 0.5) < 1e-12);
  assert.match(read("src/render/ShaderHost.js"), /pow\(0\.5, \(u_delta \* 1000\.0\) \/ halfLife\)/);
  assert.match(read("src/render/ShaderHost.js"), /webglcontextlost/);
  assert.match(read("src/render/ShaderHost.js"), /webglcontextrestored/);
});

test("timer-then-onset waits for the dwell window", () => {
  const controller = new TransitionController();
  assert.equal(controller.update(44, 1).canSwitch, false);
  assert.equal(controller.update(1, 0.2).canSwitch, false);
  const ready = controller.update(0, 0.8);
  assert.equal(ready.dwellMet, true);
  assert.equal(ready.canSwitch, true);
});


// ---------------- Stage 2 (ZUR-GH-002) ----------------
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

test("stage 2 file map exists and Stage 1 aurora scene is preserved", () => {
  for (const file of [
    "src/render/ParticleSystem3D.js",
    "src/render/particleMath.js",
    "src/shaders/sim.vert.glsl",
    "src/shaders/render.vert.glsl",
    "src/shaders/render.frag.glsl",
    "src/shaders/post.vert.glsl",
    "src/shaders/kaleido.frag.glsl",
    "src/shaders/trail.frag.glsl",
    "tests/smoke-stage2.mjs",
    "src/scenes/aurora-ribbons.glsl",
  ]) assert.ok(existsSync(file), file);
  assert.match(read("src/app/main.js"), /aurora-ribbons\.glsl/);
});

test("integrateFrozenDrag matches the exact solution of dv/dt = F - k v", () => {
  const cases = [[0.907, 1 / 60], [3.71, 1 / 60], [1.2, 0.25], [12, 1 / 30]];
  for (const [k, dt] of cases) {
    const x0 = 0.3;
    const v0 = -1.7;
    const F = 2.4;
    const { position, velocity } = integrateFrozenDrag(x0, v0, F, k, dt);
    const vInf = F / k;
    const e = Math.exp(-k * dt);
    assert.ok(near(velocity, vInf + (v0 - vInf) * e, 1e-12), `v k=${k}`);
    assert.ok(near(position, x0 + vInf * dt + ((v0 - vInf) * (1 - e)) / k, 1e-12), `x k=${k}`);
    // Exactness: two half steps equal one full step (frame-rate independent).
    const half = integrateFrozenDrag(x0, v0, F, k, dt / 2);
    const twice = integrateFrozenDrag(half.position, half.velocity, F, k, dt / 2);
    assert.ok(near(twice.position, position, 1e-10) && near(twice.velocity, velocity, 1e-10), `compose k=${k}`);
  }
});

test("integrateFrozenDrag Taylor fallback is continuous near k*dt = 0", () => {
  const dt = 1 / 60;
  const tiny = frozenDragCoefficients(1e-5, dt);
  assert.ok(near(tiny.A, dt, 1e-6) && near(tiny.B, (dt * dt) / 2, 1e-6));
  const k = 0.054; // k dt = 9e-4 → Taylor branch
  const taylor = frozenDragCoefficients(k, dt);
  const E = Math.exp(-k * dt);
  const A = (1 - E) / k;
  const B = (dt - A) / k;
  assert.ok(near(taylor.E, E, 1e-12) && near(taylor.A, A, 1e-9) && near(taylor.B, B, 1e-6));
  const free = integrateFrozenDrag(1, 2, 3, 0, dt);
  assert.ok(near(free.position, 1 + 2 * dt + 1.5 * dt * dt, 1e-12) && near(free.velocity, 2 + 3 * dt, 1e-12));
});

test("ticket damping factors become exact per-step retention at 60 Hz", () => {
  assert.equal(FLOW_DAMPING_PER_STEP.fluid, 0.985);
  assert.equal(FLOW_DAMPING_PER_STEP.gas, 0.94);
  for (const mode of FLOW_MODES) {
    const k = dampingRateFromRetention(FLOW_DAMPING_PER_STEP[mode]);
    assert.ok(near(frozenDragCoefficients(k, SIM_STEP).E, FLOW_DAMPING_PER_STEP[mode], 1e-12), mode);
  }
});

test("fixed-step accumulator runs 1/60 s steps with a 4-step cap (generic helper; ZUR-GH-012 frames use 1 step)", () => {
  assert.equal(SIM_STEP, 1 / 60);
  assert.equal(MAX_STEPS_PER_FRAME, 1, "ZUR-GH-012: strictly one transform-feedback step per frame");
  assert.equal(planFixedSteps(0, 1 / 60, SIM_STEP, 4).steps, 1);
  assert.equal(planFixedSteps(0, 1 / 30, SIM_STEP, 4).steps, 2);
  const slow = planFixedSteps(0, 0.2, SIM_STEP, 4);
  assert.deepEqual([slow.steps, slow.accumulator], [4, 0]);
  let acc = 0;
  let total = 0;
  for (let i = 0; i < 90; i += 1) {
    const r = planFixedSteps(acc, 1 / 90, SIM_STEP, 4);
    acc = r.accumulator;
    total += r.steps;
  }
  assert.ok(total >= 59 && total <= 60, `90 frames @90 Hz → ${total} steps`);
  const src = read("src/render/ParticleSystem3D.js");
  assert.match(src, /MAX_STEPS_PER_FRAME/);
  assert.match(src, /planSimStep/);
});

test("hash32 thinning is deterministic and matches the GLSL constants", () => {
  assert.equal(hash32(0), hash32(0));
  assert.notEqual(hash32(1), hash32(2));
  const first = Array.from({ length: 64 }, (_, i) => hash32(i));
  const again = Array.from({ length: 64 }, (_, i) => hash32(i));
  assert.deepEqual(first, again);
  const threshold = visibleThreshold(0.75);
  let visible = 0;
  for (let id = 0; id < 65536; id += 1) if (isInstanceVisible(id, threshold)) visible += 1;
  assert.ok(Math.abs(visible / 65536 - 0.75) < 0.01, `visible ${visible}`);
  assert.equal(visibleThreshold(1), 0xffffffff);
  assert.ok(isInstanceVisible(12345, visibleThreshold(1)));
  for (const file of ["src/shaders/sim.vert.glsl", "src/shaders/render.vert.glsl"]) {
    const glsl = read(file);
    assert.match(glsl, /x \*= 0x7feb352du;/, file);
    assert.match(glsl, /x \*= 0x846ca68bu;/, file);
  }
  assert.match(read("src/shaders/render.vert.glsl"), /hash32\(iid\) >= u_visibleThreshold/);
});

test("capture-space minimum radius scales with render height and kaleidoscope zoom", () => {
  assert.ok(near(minRenderRadiusPx(1.6, 720, 1), 1.6));
  assert.ok(near(minRenderRadiusPx(1.6, 1080, 1), 2.4));
  assert.ok(near(minRenderRadiusPx(1.6, 720, 2), 0.8));
  assert.ok(near(minRenderRadiusPx(1.6, 720, 0.1), 6.4));
  const vert = read("src/shaders/render.vert.glsl");
  assert.match(vert, /u_minRadiusPx/);
  assert.match(read("src/render/ParticleSystem3D.js"), /minRenderRadiusPx\(1\.6, this\.height/);
});

test("trail radiance normalization gives identical glow at 30 and 60 fps", () => {
  const tau = 0.22 / Math.LN2;
  assert.ok(near(trailRadianceScale(1 / 60, tau), 1, 1e-12));
  assert.ok(near(steadyStateRadiance(1 / 30, tau), steadyStateRadiance(1 / 60, tau), 1e-9));
  assert.ok(near(steadyStateRadiance(1 / 144, tau), steadyStateRadiance(1 / 60, tau), 1e-9));
  assert.match(read("src/shaders/trail.frag.glsl"), /uniform float u_fade/);
  assert.match(read("src/render/ParticleSystem3D.js"), /gl\.blendFunc\(gl\.ONE, gl\.ONE_MINUS_SRC_ALPHA\)/);
});

test("kaleidoscope N = 0 / 1 is a 1:1 bypass and N-fold output is mirrored", () => {
  for (const n of [0, 1]) {
    for (const [u, v] of [[0.1, 0.9], [0.5, 0.5], [0.73, 0.21]]) {
      assert.deepEqual(kaleidoFold(u, v, n, 1.3, 16 / 9), [u, v]);
    }
  }
  const aspect = 16 / 9;
  for (const n of [4, 6, 8, 12, 16]) {
    const wedge = (Math.PI * 2) / n;
    for (let i = 0; i < 40; i += 1) {
      const theta = i * 0.157;
      const r = 0.31;
      const u = (Math.cos(theta) * r) / aspect + 0.5;
      const v = Math.sin(theta) * r + 0.5;
      const [fu, fv] = kaleidoFold(u, v, n, 0, aspect);
      const px = (fu - 0.5) * aspect;
      const py = fv - 0.5;
      assert.ok(near(Math.hypot(px, py), r, 1e-9), "radius preserved");
      const a = Math.atan2(py, px);
      assert.ok(a >= -1e-9 && a <= wedge / 2 + 1e-9, `angle inside half wedge n=${n}`);
      const mirror = kaleidoFold(u, 1 - v, n, 0, aspect);
      assert.ok(near(mirror[0], fu, 1e-9) && near(mirror[1], fv, 1e-9), "mirror symmetric");
    }
  }
  assert.deepEqual([...KALEIDO_SEGMENTS], [0, 4, 6, 8, 12, 16]);
  const frag = read("src/shaders/kaleido.frag.glsl");
  assert.match(frag, /if \(u_kaleidoSegments <= 1\.0\) return uv;/);
  assert.match(frag, /mappedPeak = peak \/ \(1\.0 \+ 0\.65 \* peak\)/);
  assert.match(frag, /u_kaleidoAngle/);
  assert.ok(near(toneMap(1), 0.5) && toneMap(1e6) < 1);
});

test("predator shockwave is causal (zero ahead of the front) and fades", () => {
  const speed = 4.5;
  const width = 0.9;
  assert.equal(shockwaveWeight(5, 0.5, speed, width), 0);
  assert.ok(shockwaveWeight(2.25, 0.5, speed, width) > 0.5);
  assert.ok(shockwaveWeight(2.25, 0.5, speed, width) > shockwaveWeight(2.25 - 1.2, 0.5, speed, width));
  assert.ok(shockwaveWeight(9, 2, speed, width) < shockwaveWeight(2.25, 0.5, speed, width));
  assert.equal(shockwaveWeight(1, -0.1, speed, width), 0);
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /smoothstep\(-width, 0\.0, front - r\)/);
  assert.match(sim, /uniform vec4 u_shock\[4\]/);
});

test("murmuration uses 5 Lissajous attractors, retarded time and a 6-neighbor ring", () => {
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /hash32\(uid\) % 5u/);
  assert.match(sim, /lissajous\(group, u_time - delay\)/);
  assert.match(sim, /float fx = 0\.21 \+ 0\.037 \* i;/);
  const p = lissajous(2, 3.5);
  assert.equal(p.length, 3);
  assert.ok(Math.abs(p[0]) <= 3.4 && Math.abs(p[1]) <= 1.6 && Math.abs(p[2]) <= 3.4);
  const ring = ringNeighbors(0, 4096);
  assert.equal(new Set(ring).size, 6);
  assert.deepEqual(ring.sort((a, b) => a - b), [1, 2, 3, 4093, 4094, 4095]);
  assert.match(sim, /ringFlock\(/);
  assert.match(read("src/render/ParticleSystem3D.js"), /PIXEL_UNPACK_BUFFER/);
});

test("five flow modes are implemented in sim.vert.glsl with curl, buoyancy, shimmer and chemotaxis", () => {
  assert.deepEqual([...FLOW_MODES], ["fluid", "gas", "murmuration", "fish", "physarum"]);
  const sim = stripComments(read("src/shaders/sim.vert.glsl"));
  for (const n of [0, 1, 2]) assert.match(sim, new RegExp(`u_mode == ${n}`));
  assert.match(sim, /vec3 curlAnalytic\(vec3 q\)/);
  assert.match(sim, /simplexValueGradient/);
  assert.match(sim, /cross\(vec3\(0\.0, 1\.0, 0\.0\), pos\)/, "fluid laminar swirl");
  assert.match(sim, /radial \* u_bass \* u_onset/, "fluid bass radial impulse");
  assert.match(sim, /0\.9 \* heat/, "gas buoyancy (ZUR-GH-008: residual thermal lift inside the toroidal circulation)");
  assert.match(sim, /u_high \* u_high \* 18\.0/, "gas treble burst");
  assert.match(sim, /sin\(phase \* 50\.0 \+ u_time \* 31\.0\) \* u_high/, "fish shimmer");
  assert.match(sim, /senseLeft = physarumField/);
  assert.match(sim, /senseForward = physarumField/);
  assert.match(sim, /senseRight = physarumField/);
  assert.match(sim, /float sensorAngle = 0\.45/);
  assert.match(sim, /senseForwardDir \* 0\.14/);
  assert.match(sim, /cellularRidge\(p \* 2\.6/);
  assert.doesNotMatch(sim, /sceneFBO|u_sceneFBO/);
  assert.match(sim, /integrateFrozenDrag\(pos, vel, F, k, dt\)/);
  assert.doesNotMatch(sim, /vel \*= 0\.9/);
});

test("transform feedback ping-pong is hazard-free and allocation-free per frame", () => {
  const src = read("src/render/ParticleSystem3D.js");
  assert.match(src, /transformFeedbackVaryings\(program, varyings, gl\.INTERLEAVED_ATTRIBS\)/);
  assert.match(src, /\["v_pos", "v_vel"\]/);
  assert.match(src, /gl\.DYNAMIC_COPY/);
  assert.match(src, /gl\.enable\(gl\.RASTERIZER_DISCARD\)/);
  assert.match(src, /gl\.endTransformFeedback\(\);\s*\/\/[^\n]*\n\s*gl\.bindTransformFeedback\(gl\.TRANSFORM_FEEDBACK, null\);\s*gl\.bindBufferBase\(gl\.TRANSFORM_FEEDBACK_BUFFER, 0, null\);/);
  assert.match(src, /gl\.drawArraysInstanced\(gl\.TRIANGLES, 0, 12, count\)/);
  assert.match(src, /gl\.drawArraysInstanced\(gl\.TRIANGLE_STRIP, 0, 4, count\)/);
  assert.match(src, /gl\.invalidateFramebuffer\(gl\.FRAMEBUFFER, \[gl\.DEPTH_ATTACHMENT\]\)/);
  assert.match(src, /gl\.RGBA16F/);
  assert.match(src, /gl\.DEPTH_COMPONENT24/);
  assert.match(src, /vertexAttribDivisor\(0, divisor\)/);
  const start = src.indexOf("  render(frame, palette");
  const end = src.indexOf("  stats()");
  const body = stripComments(src.slice(start, end));
  assert.doesNotMatch(body, /\bnew\s+[A-Z]/, "render() must not allocate");
  assert.doesNotMatch(body, /=\s*\[|=\s*\{\s*[a-z]/, "render() must not build arrays/objects");
  const state = seedParticleState(1024);
  assert.equal(state.length, 1024 * 8);
  assert.ok(state.every(Number.isFinite));
  assert.deepEqual(Array.from(seedParticleState(4).slice(0, 8)), Array.from(seedParticleState(4).slice(0, 8)));
});

test("render shader builds velocity-aligned darts and capsules from gl_VertexID", () => {
  const vert = read("src/shaders/render.vert.glsl");
  assert.match(vert, /velocityFrame\(vel\)/);
  assert.match(vert, /smoothstep\(0\.85, 0\.99, abs\(forward\.y\)\)/);
  assert.match(vert, /gl_VertexID \/ 3/);
  assert.match(vert, /gl_InstanceID/);
  const frag = read("src/shaders/render.frag.glsl");
  assert.match(frag, /float rim = pow\(1\.0 - facing, 2\.5\)/);
  assert.match(frag, /float core = exp\(-r2 \* 42\.0\) \* 0\.30/);
});

test("particle tiers: 64k..256k fixed tiers (ZUR-GH-009), no auto step-down", () => {
  assert.deepEqual([...COUNT_TIERS], ["64k", "96k", "128k", "160k", "256k"]);
  assert.equal(DEFAULT_PARTICLES.particleCountTier, "64k");
  assert.equal(resolveParticleCount("64k", false), 65536);
  assert.equal(resolveParticleCount("96k", false), 98304);
  assert.equal(resolveParticleCount("128k", false), 131072);
  assert.equal(resolveParticleCount("160k", false), 163840);
  assert.equal(resolveParticleCount("256k", false), 262144);
  assert.equal(resolveParticleCount(131072, false), 131072);
  assert.equal(isMobileAgent("Mozilla/5.0 (Linux; Android 15; SM-A576B) Mobile"), true);
  assert.equal(isMobileAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/141"), false);
  assert.equal(stepdownThreshold(60), 50);
  assert.equal(stepdownThreshold(30), 25);
  assert.equal(nextAutoCount(4096, 5, 60, 3).count, 4096);
});

test("Stage 2 preset schema, Mode A/B scene retention and ?preset= URL state", () => {
  assert.equal(validatePreset(STAGE2_DEFAULT_PRESET).ok, true);
  assert.equal(STAGE2_DEFAULT_PRESET.sceneId, PARTICLE_SCENE_ID);
  assert.equal(validatePreset(MODE_A_PRESET).ok, true);
  assert.equal(MODE_A_PRESET.sceneId, "aurora-ribbons");
  const bad = JSON.parse(JSON.stringify(STAGE2_DEFAULT_PRESET));
  bad.particles.kaleidoSegments = 5;
  assert.equal(validatePreset(bad).ok, false);
  bad.particles.kaleidoSegments = 6;
  bad.particles.particleSize = 9;
  assert.equal(validatePreset(bad).ok, false);
  const kept = applyModeKeepingScene(MODE_B_PRESET, { ...STAGE2_DEFAULT_PRESET, particles: { ...STAGE2_DEFAULT_PRESET.particles, flowMode: "gas" } });
  assert.equal(kept.sceneId, PARTICLE_SCENE_ID);
  assert.equal(kept.particles.flowMode, "gas");
  assert.equal(kept.visual.fps, 60);
  assert.equal(validatePreset(kept).ok, true);
  const particles = { flowMode: "fish", shape: "capsule", particleSize: 2.5, kaleidoSegments: 12, kaleidoSpin: false, particleCountTier: "128k" };
  const encoded = encodePresetParam(PARTICLE_SCENE_ID, particles);
  const decoded = decodePresetParam(encoded);
  assert.equal(decoded.sceneId, PARTICLE_SCENE_ID);
  assert.deepEqual(normalizeParticles(decoded.particles), { ...DEFAULT_PARTICLES, ...particles });
  assert.equal(decodePresetParam("gas").particles.flowMode, "gas");
  assert.equal(decodePresetParam("scene:aurora").sceneId, "aurora-ribbons");
  assert.equal(decodePresetParam("<script>"), null);
  assert.equal(normalizeParticles({ particleSize: 99, kaleidoSegments: 7 }).particleSize, 4);
  assert.equal(normalizeParticles({ kaleidoSegments: 7 }).kaleidoSegments, 0);
  const main = read("src/app/main.js");
  assert.match(main, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(main, /searchParams\.set\("preset"/);
  assert.match(main, /history\.replaceState/);
});

test("HUD exposes Stage 2 controls and the service worker caches Stage 2 assets", () => {
  const hud = read("src/controls/ControlHUD.js");
  for (const id of ["sel-flow", "rng-size", "sel-kaleido", "chk-kaleido-spin", "sel-count"]) {
    assert.match(hud, new RegExp(`"${id}"`), id);
  }
  const sw = read("sw.js");
  for (const file of ["sim.vert.glsl", "render.vert.glsl", "render.frag.glsl", "post.vert.glsl", "kaleido.frag.glsl", "ParticleSystem3D.js"]) {
    assert.match(sw, new RegExp(file.replace(".", "\\.")), file);
  }
  assert.match(sw, /aurora-ribbons\.glsl/);
});

test("shockwave ring buffer starts empty: no origin shockwaves at startup (Copilot review #1)", () => {
  const buf = createShockBuffer();
  assert.equal(buf.length, SHOCK_SLOTS * 4);
  assert.ok(SHOCK_EMPTY_BIRTH < 0);
  for (let slot = 0; slot < SHOCK_SLOTS; slot++) {
    assert.ok(buf[slot * 4 + 3] < 0, `slot ${slot} birth must be negative`);
    for (const t of [0, 0.5, 1, 2, 3.99, 4]) assert.equal(isShockSlotActive(buf, slot, t), false, `slot ${slot} t=${t}`);
  }
  // The old zero-init would have produced live shockwaves for the first 4 s.
  const zero = new Float32Array(16);
  assert.equal(isShockSlotActive(zero, 0, 1), true);
  // A real trigger still activates its slot.
  buf[3] = 2; buf[0] = 1;
  assert.equal(isShockSlotActive(buf, 0, 2.5), true);
  assert.equal(isShockSlotActive(buf, 0, 6.1), false);
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /this\.shock = createShockBuffer\(\)/);
  assert.doesNotMatch(ps, /this\.shock = new Float32Array/);
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /if \(s\.w < 0\.0\) continue;/);
});

test("unsupported scene IDs are rejected and cannot flip the scene through ?preset= (Copilot review #2)", () => {
  for (const id of SCENE_IDS) {
    assert.equal(validatePreset({ ...STAGE2_DEFAULT_PRESET, sceneId: id }).ok, true, id);
  }
  for (const id of ["unknown-scene", "PARTICLE-SWARM-3D", "aurora", "particles", " aurora-ribbons"]) {
    const r = validatePreset({ ...STAGE2_DEFAULT_PRESET, sceneId: id });
    assert.equal(r.ok, false, id);
    assert.ok(r.errors.some((e) => /sceneId must be one of/.test(e)), id);
  }
  // Round trip for every supported scene preserves it.
  for (const id of SCENE_IDS) {
    assert.equal(decodePresetParam(encodePresetParam(id, STAGE2_DEFAULT_PRESET.particles)).sceneId, id);
  }
  // An unknown scene is never encoded as "particles", so a reload keeps the current scene.
  const encoded = encodePresetParam("unknown-scene", STAGE2_DEFAULT_PRESET.particles);
  assert.doesNotMatch(encoded, /scene:/);
  const decoded = decodePresetParam(encoded);
  assert.equal(decoded.sceneId, undefined);
  const reloaded = { ...MODE_A_PRESET, particles: { ...STAGE2_DEFAULT_PRESET.particles, ...decoded.particles } };
  if (decoded.sceneId) reloaded.sceneId = decoded.sceneId;
  assert.equal(reloaded.sceneId, "aurora-ribbons");
  // Unknown scene tokens in the URL are ignored.
  assert.equal(decodePresetParam("scene:evil_flow:gas").sceneId, undefined);
});


test("Stage 3 frozen AppState keys, enums and defaults", () => {
  assert.deepEqual({ ...STAGE3_DEFAULTS }, {
    sceneId: "particle-swarm-3d",
    paletteId: "neon-tunnel",
    particleCountTier: "64k",
    densityAutoScale: true,
    trailLength: 0.28,
    trailType: "comet",
    formationType: "wormhole",
    attractorText: "AI: UNDERGROUND",
    oscillationType: "helix",
    oscillationAmount: 1.0,
    oscillationSpeed: 1.2,
    pulseLayout: "band-clouds",
    particleStyle: "crisp-dot",
    colorPalette: "true-neon",
    kineticMode: "off",
    reactivityGain: 2.5,
    cameraZoom: 1.0,
    reactivityMode: "true-gate",
  });
  assert.deepEqual([...SCENE_IDS], [
    "particle-swarm-3d", "pulse-field-3d", "megastructure-3d", "spectral-canyon-3d", "aurora-ribbons",
  ]);
  assert.equal(MEGASTRUCTURE_SCENE_ID, "megastructure-3d");
  assert.equal(SPECTRAL_CANYON_SCENE_ID, "spectral-canyon-3d");
  assert.ok(SCENE_IDS.includes("pulse-field-3d") && PULSE_SCENE_ID === "pulse-field-3d");
  assert.deepEqual([...PALETTE_IDS].sort(), ["biolum-ocean", "copper-teal", "cyber-laser", "emerald-matrix", "neon-tunnel", "solar-plasma"]);
  assert.equal(PALETTE_IDS[0], "neon-tunnel");
  assert.deepEqual([...TRAIL_TYPES], ["comet", "electric", "strobe", "ribbon", "none"]);
  assert.deepEqual([...FORMATION_TYPES], [
    "free-3d", "neon-tunnel", "polygon-rings", "supernova-shell", "fractal-core", "logo-attractor",
    "neural-brain", "living-galaxy", "supermassive-blackhole", "wormhole", "harmonic-ferrofluid",
  ]);
  assert.deepEqual([...OSCILLATION_TYPES], ["off", "wave", "helix", "bounce", "pulse"]);
  assert.deepEqual([...PULSE_LAYOUTS], ["band-clouds", "geodesic-sphere", "wave-grid"]);
  const state = new AppState(STAGE2_DEFAULT_PRESET);
  assert.deepEqual(state.stage3, { ...STAGE3_DEFAULTS });
  assert.deepEqual(stage3View(STAGE2_DEFAULT_PRESET), { ...STAGE3_DEFAULTS });
  assert.equal(validatePreset(STAGE2_DEFAULT_PRESET).ok, true);
  assert.equal(validatePreset(MODE_A_PRESET).ok, true);
  assert.equal(validatePreset(MODE_B_PRESET).ok, true);
  for (const [key, bad] of [
    ["trailLength", 1.01], ["trailType", "laser"], ["formationType", "cube"], ["oscillationType", "spin"],
    ["oscillationAmount", 3.5], ["oscillationSpeed", 0.1], ["pulseLayout", "grid"], ["particleCountTier", "8k"], ["particleStyle", "orb"], ["particleStyle", "blood-drop"], ["densityAutoScale", "yes"], ["reactivityMode", "loud"],
  ]) {
    const preset = JSON.parse(JSON.stringify(STAGE2_DEFAULT_PRESET));
    preset.particles[key] = bad;
    assert.equal(validatePreset(preset).ok, false, key);
  }
  const clamped = normalizeParticles({ trailLength: 4, oscillationAmount: -2, oscillationSpeed: 99 });
  assert.equal(clamped.trailLength, 1);
  assert.equal(clamped.oscillationAmount, 0);
  assert.equal(clamped.oscillationSpeed, 4);
  assert.equal(normalizeParticles({ countTier: 131072 }).particleCountTier, "128k", "numeric countTier migrates");
  assert.equal(normalizeParticles({ countTier: 16384 }).particleCountTier, "64k", "removed small tiers migrate to 64k");
  assert.equal(normalizeParticles({ countTier: "auto" }).particleCountTier, "64k");
  assert.deepEqual(decodePresetParam("scene:pulse_count:160k"), { particles: { particleCountTier: "160k" }, sceneId: "pulse-field-3d" });
});

test("Stage 3 count tiers and density auto-scale formulas", () => {
  assert.deepEqual({ ...COUNT_TIER_VALUES }, {
    "64k": 65536, "96k": 98304, "128k": 131072, "160k": 163840, "256k": 262144,
  });
  assert.equal(DEFAULT_PARTICLES.particleCountTier, "64k");
  assert.equal(resolveParticleCount("64k", true), 65536);
  assert.ok(near(densityScaleBoost(1024), Math.pow(4, 0.32), 1e-12));
  assert.ok(near(densityScaleBoost(4096), 1, 1e-12));
  assert.equal(densityScaleBoost(65536), 1);
  assert.ok(near(densityScaleBoost(64), 5.5, 1e-9) || densityScaleBoost(64) <= 5.5);
  assert.ok(densityScaleBoost(1) <= 5.5);
  assert.equal(densityScaleBoost(64, false), 1);
  assert.ok(near(densityTrailScale(1024), Math.pow(0.25, 0.28), 1e-12));
  assert.equal(densityTrailScale(65536), 1);
  assert.equal(densityTrailScale(1), 0.18);
  assert.equal(densityTrailScale(64, false), 1);
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /densityScaleBoost\(count, particles\.densityAutoScale\)/);
  assert.match(ps, /densityTrailScale\(count, particles\.densityAutoScale\)/);
});

test("Stage 3 trail keepFactor formula and frame-rate independence", () => {
  assert.equal(trailKeepFactor("none", 0.8), 0);
  assert.equal(trailKeepFactor("comet", 0.01), 0);
  assert.equal(trailKeepFactor("comet", 0), 0);
  assert.ok(near(trailKeepFactor("comet", 1), 0.965, 1e-12));
  assert.ok(near(trailKeepFactor("ribbon", 0.28), 0.15 + (0.965 - 0.15) * Math.pow(0.28, 0.65), 1e-12));
  assert.ok(trailKeepFactor("comet", 0.5) > trailKeepFactor("comet", 0.2));
  assert.ok(near(keepForDt(0.9, 1 / 60), 0.9, 1e-12));
  assert.ok(near(keepForDt(0.9, 1 / 30), 0.81, 1e-12));
  assert.equal(keepForDt(0, 0.016), 0);
  assert.equal(tauFromKeep60(0), 0);
  assert.ok(near(Math.exp(-1 / (60 * tauFromKeep60(0.9))), 0.9, 1e-12));
  assert.equal(trailRadianceScale(1 / 60, 0), 1);
  const trail = read("src/shaders/trail.frag.glsl");
  for (const name of ["u_trailType", "u_trailLength", "u_fade"]) assert.match(trail, new RegExp(name));
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /trailKeepFactor\(particles\.trailType, trailLength\)/);
});

test("Stage 3 portrait FBO axis swap and Hor+ projection", () => {
  assert.deepEqual(resolveFboSize(1280, 720, 1280, 720), { width: 1280, height: 720, portrait: false });
  assert.deepEqual(resolveFboSize(1280, 720, 1000, 1000), { width: 1280, height: 720, portrait: false });
  assert.deepEqual(resolveFboSize(1280, 720, 0, 0), { width: 1280, height: 720, portrait: false });
  const portrait = resolveFboSize(1280, 720, 900, 2000);
  assert.equal(portrait.portrait, true);
  assert.equal(portrait.height, 1280);
  assert.equal(portrait.width, Math.round(1280 * (900 / 2000)));
  assert.ok(near(portrait.width / portrait.height, 900 / 2000, 1e-3), "FBO is 1:1 with the canvas pixels");
  const size = resolveRenderSize(STAGE2_DEFAULT_PRESET, { clientWidth: 400, clientHeight: 900 });
  assert.equal(size.portrait, true);
  assert.ok(size.height > size.width);
  assert.equal(resolveRenderSize(STAGE2_DEFAULT_PRESET).width, 1280);
  const wide = projectionScales(2, 16 / 9);
  assert.ok(near(wide.x, 2 / (16 / 9)) && near(wide.y, 2));
  const tall = projectionScales(2, 9 / 20);
  assert.ok(near(tall.x, 2) && near(tall.y, 2 * (9 / 20)));
  assert.deepEqual(projectionScales(2, 1), { x: 2, y: 2 });
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /projectionScales\(f, aspect\)/);
  assert.ok(near(SPAWN_HALF, 1.25 * 3.2));
  const seed = seedParticleState(4096);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 4096; i += 1) {
    for (const axis of [0, 1, 2]) assert.ok(Math.abs(seed[i * 8 + axis]) <= SPAWN_HALF + 1e-6);
    minY = Math.min(minY, seed[i * 8 + 1]);
    maxY = Math.max(maxY, seed[i * 8 + 1]);
  }
  assert.ok(minY < -0.9 * SPAWN_HALF && maxY > 0.9 * SPAWN_HALF, "spawn covers the full volume, no funnel");
});

test("Stage 3 neon glow + chroma-preserving tone map constants", () => {
  assert.deepEqual({ ...GLOW }, { coreK: 42.0, haloK: 4.5, coreGain: 0.30 });
  const g = glowProfile(0.1);
  assert.ok(near(g.core, Math.exp(-4.2) * 0.3) && near(g.halo, Math.exp(-0.45)) && g.core < g.halo);
  const frag = read("src/shaders/render.frag.glsl");
  assert.match(frag, /float core = exp\(-r2 \* 42\.0\) \* 0\.30;/);
  assert.match(frag, /float halo = exp\(-r2 \* 4\.5\);/);
  const kaleido = read("src/shaders/kaleido.frag.glsl");
  assert.match(kaleido, /float peak = max\(c\.r, max\(c\.g, c\.b\)\);/);
  assert.match(kaleido, /vec3 chroma = c \/ max\(peak, 1e-4\);/);
  assert.match(kaleido, /float mappedPeak = peak \/ \(1\.0 \+ 0\.65 \* peak\);/);
  // ZUR-GH-008 supersedes the Stage 3 white-bleed shoulder: it survives only for the megastructure raymarched core
  // (u_coreSpecular = 1); particle scenes never mix toward vec3(1.0).
  assert.match(kaleido, /return mix\(chroma \* min\(mappedPeak, 1\.0\), vec3\(1\.0\), smoothstep\(1\.1, 3\.2, peak\) \* 0\.65 \* u_coreSpecular\);/);
  assert.match(read("src/render/ParticleSystem3D.js"), /gl\.uniform1f\(P\.u_coreSpecular, extras\.megastructure \? 1 : 0\);/);
  const [r, gg, b] = chromaToneMap([0.2, 0.8, 0.4]);
  assert.ok(near(gg / r, 4, 1e-9) && near(gg / b, 2, 1e-9), "hue ratios preserved");
  assert.ok(chromaToneMap([0.5, 0, 0])[1] === 0, "pure channel stays pure");
  const hot = chromaToneMap([8, 2, 0.5]);
  assert.ok(near(hot[1] / hot[0], 0.25, 1e-9) && near(hot[2] / hot[0], 0.0625, 1e-9) && hot.every((v) => v <= 1), "very hot pixels keep their hue (no white bleed)");
  assert.deepEqual(chromaToneMap([0, 0, 0]), [0, 0, 0]);
  const neon = PALETTES["neon-tunnel"];
  assert.equal(neon.length, 5);
  const hexes = ["#00F5FF", "#FF00A0", "#8A00FF", "#0066FF", "#FF00FF"];
  hexes.forEach((hex, i) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const lin = [16, 8, 0].map((sh) => {
      const c = ((n >> sh) & 255) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    lin.forEach((v, ch) => assert.ok(near(neon[i][ch], v, 1e-9), `${hex} ch ${ch}`));
  });
});

test("Stage 3 shaders and HUD bind every frozen uniform/key", () => {
  const sim = read("src/shaders/sim.vert.glsl");
  for (const name of ["u_formationType", "u_oscillationType", "u_oscillationAmount", "u_oscillationSpeed", "u_pulseLayout"]) {
    assert.match(sim, new RegExp(`uniform \\w+ ${name}`), `sim ${name}`);
  }
  const render = read("src/shaders/render.vert.glsl");
  for (const name of ["u_trailType", "u_trailLength", "u_densityScaleBoost", "u_pulseLayout"]) {
    assert.match(render, new RegExp(`uniform \\w+ ${name}`), `render ${name}`);
  }
  assert.match(read("src/shaders/trail.frag.glsl"), /uniform int u_trailType/);
  const ps = read("src/render/ParticleSystem3D.js");
  for (const name of [
    "u_trailType", "u_trailLength", "u_formationType", "u_oscillationType", "u_oscillationAmount",
    "u_oscillationSpeed", "u_densityScaleBoost", "u_pulseLayout",
  ]) assert.match(ps, new RegExp(`"${name}"|R\\.${name}|L\\.${name}|trailLoc\\.${name}`), name);
  for (const fn of ["polygonRadius", "formationTarget", "oscillationOffset", "pulseTarget"]) assert.match(sim, new RegExp(fn));
  for (const type of ["neon-tunnel", "polygon-rings", "supernova-shell"]) assert.ok(FORMATION_TYPES.includes(type));
  const hud = read("src/controls/ControlHUD.js");
  for (const id of [
    "sel-trail-type", "rng-trail-length", "sel-formation", "sel-oscillation", "rng-osc-amount", "rng-osc-speed",
    "sel-pulse-layout", "chk-density",
  ]) assert.match(hud, new RegExp(`"${id}"`), id);
  assert.match(read("src/app/AppState.js"), /label: "3D Pulse Field"/);
  const sw = read("sw.js");
  for (const file of ["sim.vert.glsl", "sim.frag.glsl", "render.vert.glsl", "render.frag.glsl", "post.vert.glsl", "trail.frag.glsl", "kaleido.frag.glsl"]) {
    assert.match(sw, new RegExp(file.replace(".", "\\.")), file);
  }
});

test("Stage 3 pulse-field-3d scene: five-band bound, no destination connection", () => {
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /uniform float u_bands\[5\]/);
  assert.match(sim, /u_pulseLayout == 1/);
  assert.match(sim, /u_pulseLayout == 2/);
  const host = read("src/render/RenderHost.js");
  assert.match(host, /frame\.sub, frame\.bass, frame\.lowMid, frame\.highMid, frame\.treble/);
  assert.equal(decodePresetParam(encodePresetParam(PULSE_SCENE_ID, DEFAULT_PARTICLES)).sceneId, PULSE_SCENE_ID);
  {
    const round = decodePresetParam(encodePresetParam(PARTICLE_SCENE_ID, {
      ...DEFAULT_PARTICLES,
      densityAutoScale: false,
      trailLength: 0.55,
      trailType: "electric",
      formationType: "polygon-rings",
      oscillationType: "bounce",
      oscillationAmount: 2.25,
      oscillationSpeed: 0.75,
      pulseLayout: "geodesic-sphere",
      particleCountTier: "96k",
    }));
    assert.equal(round.sceneId, PARTICLE_SCENE_ID);
    assert.equal(round.particles.particleCountTier, "96k");
    assert.equal(round.particles.densityAutoScale, false);
    assert.equal(round.particles.trailLength, 0.55);
    assert.equal(round.particles.trailType, "electric");
    assert.equal(round.particles.formationType, "polygon-rings");
    assert.equal(round.particles.oscillationType, "bounce");
    assert.equal(round.particles.oscillationAmount, 2.25);
    assert.equal(round.particles.oscillationSpeed, 0.75);
    assert.equal(round.particles.pulseLayout, "geodesic-sphere");
  }
  for (const file of ["src/render/ParticleSystem3D.js", "src/render/RenderHost.js", "src/app/main.js"]) {
    assert.doesNotMatch(read(file), /\.destination/, file);
  }
});

function mockStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    _map: map,
  };
}

function hexSaturation(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

const frag32 = () => stripComments(read("src/shaders/render.frag.glsl"));
const sim32 = () => stripComments(read("src/shaders/sim.vert.glsl"));

test("ZUR-GH-013 storage key and schema are zur_state_v6_0 / 6.0 (v5.3, v5.2, v5.1, v5.0 + v4 keys kept as legacy)", () => {
  assert.equal(STORAGE_KEY, "zur_state_v6_0");
  assert.equal(STORAGE_SCHEMA, 6.0);
  assert.ok(LEGACY_STORAGE_KEYS.includes("zur_state_v5_3"));
  assert.ok(LEGACY_STORAGE_KEYS.includes("zur_state_v5_2"));
  assert.ok(LEGACY_STORAGE_KEYS.includes("zur_state_v5_1"));
  assert.ok(LEGACY_STORAGE_KEYS.includes("zur_state_v5_0"));
  assert.ok(LEGACY_STORAGE_KEYS.includes("zur_state_v4_0"));
  assert.deepEqual({ ...V3_2_UPGRADE_DEFAULTS }, { paletteId: "neon-tunnel", particleCountTier: "64k", particleSize: 1.35, trailLength: 0.28, trailType: "comet" });
  assert.match(read("src/app/main.js"), /serializeStoredState\(/);
});

test("Stage 3.2 migration: cached copper-teal upgrades to neon-tunnel 2k / 1.35 / 0.28 / comet", () => {
  const preset = structuredClone(MODE_A_PRESET);
  preset.visual.paletteId = "copper-teal";
  const loaded = loadStoredState(mockStorage({ zur_state_v3_2: JSON.stringify({ storageSchema: 3.2, preset }) }));
  assert.equal(loaded.key, "zur_state_v3_2");
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.preset.visual.paletteId, "neon-tunnel");
  const p = loaded.preset.particles;
  assert.equal(p.particleCountTier, "64k");
  assert.equal(p.particleSize, 1.35);
  assert.equal(p.trailLength, 0.28);
  assert.equal(p.trailType, "comet");
});

test("Stage 3.2 migration: legacy keys and schema < 3.2 are force-upgraded", () => {
  for (const key of ["zur_state_v3", "zur_state_v2", "zur.preset.v2"]) {
    const preset = structuredClone(MODE_B_PRESET);
    preset.visual.paletteId = "cyber-laser";
    const loaded = loadStoredState(mockStorage({ [key]: JSON.stringify(preset) }));
    assert.equal(loaded.key, key, `${key} read`);
    assert.equal(loaded.migrated, true);
    assert.equal(loaded.preset.visual.paletteId, "neon-tunnel");
    assert.equal(loaded.preset.particles.particleCountTier, "64k");
  }
  const old = structuredClone(MODE_A_PRESET);
  const enveloped = JSON.stringify({ storageSchema: 3, preset: old });
  assert.equal(loadStoredState(mockStorage({ zur_state_v3_2: enveloped })).migrated, true);
  assert.equal(loadStoredState(mockStorage({})), null);
  assert.equal(loadStoredState(mockStorage({ zur_state_v3_2: "{not json" })), null);
});

test("Stage 4 migration preserves current non-copper state values", () => {
  const preset = structuredClone(MODE_A_PRESET);
  preset.visual.paletteId = "solar-plasma";
  preset.particles = { ...preset.particles, particleCountTier: "128k", particleSize: 2.2 };
  const loaded = loadStoredState(mockStorage({ zur_state_v3_2: serializeStoredState(preset) }));
  assert.equal(loaded.migrated, false);
  assert.equal(loaded.preset.visual.paletteId, "solar-plasma");
  assert.equal(loaded.preset.particles.particleCountTier, "128k");
  assert.equal(loaded.preset.particles.particleSize, 2.2);
});

test("Stage 3.2 neon palettes: every stop HSV saturation >= 0.85 and never white", () => {
  assert.deepEqual([...NEON_PALETTE_IDS], ["neon-tunnel", "cyber-laser", "solar-plasma", "biolum-ocean", "emerald-matrix"]);
  assert.equal(NEON_MIN_SATURATION, 0.85);
  const source = read("src/controls/palettes.js");
  for (const id of NEON_PALETTE_IDS) {
    const line = source.split("\n").find((l) => l.includes(`"${id}": palette(`));
    const hexes = line.match(/#[0-9A-Fa-f]{6}/g);
    assert.equal(hexes.length, 5, `${id} stops`);
    for (const hex of hexes) {
      assert.notEqual(hex.toUpperCase(), "#FFFFFF", `${id} has a white stop`);
      assert.ok(hexSaturation(hex) >= 0.85, `${id} ${hex} saturation ${hexSaturation(hex).toFixed(2)}`);
    }
    assert.equal(PALETTES[id].length, 5);
    for (const [r, g, b] of PALETTES[id]) {
      const max = Math.max(r, g, b);
      assert.ok((max - Math.min(r, g, b)) / max >= 0.85, `${id} linear stop saturation`);
    }
  }
  assert.ok(PALETTE_IDS.includes("copper-teal"), "copper-teal stays for Mode presets");
});

test("Stage 3.2 crowdNorm formula: JS mirror and render.frag", () => {
  assert.match(frag32(), /float crowdNorm = clamp\(pow\(65536\.0 \/ max\(float\(u_activeCount\), 65536\.0\), 0\.58\), 0\.28, 1\.0\);/);
  assert.match(frag32(), /uniform float u_particleSize;/);
  assert.match(frag32(), /uniform float u_activeCount;/);
  assert.equal(crowdNorm(1, 1024), 1 / 1.32);
  assert.ok(crowdNorm(4, 65536) < 0.03);
  assert.ok(crowdNorm(1, 0) > crowdNorm(1, 1024), "active count floors at 64");
  for (const size of [2.2, 3, 3.5, 4]) for (const count of [16384, 65536]) assert.ok(crowdNorm(size, count) < 0.15, `${size}@${count}`);
});

test("ZUR-GH-013 Velocity Capsule shading removed: every particle style draws additively (ONE, ONE)", () => {
  assert.equal(CAPSULE_ALPHA, 0.40);
  assert.equal(capsuleAlpha(3.5, 16384), 0.4 * crowdNorm(3.5, 16384));
  assert.doesNotMatch(frag32(), /capsuleAlpha/);
  const system = stripComments(read("src/render/ParticleSystem3D.js"));
  const draw = system.slice(system.indexOf("const dart = "));
  assert.match(draw, /gl\.blendFunc\(gl\.ONE, gl\.ONE\)/);
  assert.doesNotMatch(draw.slice(0, draw.indexOf("drawArraysInstanced")), /ONE_MINUS_SRC_ALPHA/);
  for (const name of ["u_particleSize", "u_activeCount"]) assert.match(system, new RegExp(`gl\\.uniform1f\\(R\\.${name}`), `${name} wired`);
});

test("Stage 3.2 sprite profile: saturated halo, pinprick core, no white specular on darts", () => {
  const frag = frag32();
  assert.match(frag, /float halo = exp\(-r2 \* 4\.5\);/);
  assert.match(frag, /float core = exp\(-r2 \* 42\.0\) \* 0\.30;/);
  assert.match(frag, /vec3 dartColor = paletteColor \* \(0\.45 \+ 0\.85 \* normalShade\) \+ paletteColorSecondary \* \(0\.65 \* rim\);/);
  assert.doesNotMatch(frag, /mix\(color, vec3\(1\.0\), rim\)/);
  assert.doesNotMatch(frag, /mix\(dartColor, vec3\(1\.0\)/);
});

test("Stage 3.2 sim.vert: tunnel and rings use camera-facing XY coordinates", () => {
  const sim = sim32();
  const xy = sim.match(/target\.xy = ringRadius \* vec2\(cos\(theta\), sin\(theta\)\);/g) || [];
  assert.equal(xy.length, 2, "tunnel and rings both write target.xy from cos/sin");
  assert.doesNotMatch(sim, /vec3\(cos\(a\) \* rt, sin\(a\) \* rt, z\)/);
  assert.doesNotMatch(sim, /target\.xz = ringRadius/);
  assert.match(sim, /const float FORMATION_TILT = 0\.2094395102;/);
  assert.match(sim, /F \+= tiltToWorld\(vec3\(0\.0, 0\.0, 1\.8 \+ 3\.0 \* u_rms \+ 2\.0 \* u_bass\)\)/);
  assert.match(sim, /if \(u_formationType == 1 \|\| u_formationType == 2\) F \*= 0\.15;/);
  assert.match(sim, /float theta = fract\(seed \* 8\.0\) \* TAU/);
});

test("Stage 3.2 kaleidoscope: mirrored radius fold, vignette and bypass", () => {
  const kal = stripComments(read("src/shaders/kaleido.frag.glsl"));
  assert.match(kal, /float r = 1\.0 - abs\(fract\(rawRadius \* 0\.5\) \* 2\.0 - 1\.0\);/);
  assert.match(kal, /vignette = smoothstep\(1\.12, 0\.82, rawRadius\);/);
  assert.match(kal, /if \(u_kaleidoSegments <= 1\.0\) return uv;/);
  assert.equal(foldRadius(0.4), 0.4);
  assert.ok(Math.abs(foldRadius(1.3) - 0.7) < 1e-9, "radius beyond 1 reflects back");
  assert.ok(Math.abs(mirrorRepeat(2.25) - 0.25) < 1e-9);
  assert.equal(kaleidoVignette(0.5), 1);
  assert.equal(kaleidoVignette(1.4), 0);
  for (const raw of [1.3, 2.0, 5.0]) assert.ok(foldRadius(raw) >= 0 && foldRadius(raw) <= 1, `fold bounded at ${raw}`);
});

test("Stage 3.2 u_viewportYOffset documented in CONTRACTS.md", () => {
  const contracts = read("CONTRACTS.md");
  assert.match(contracts, /`u_viewportYOffset`/);
  assert.match(contracts, /gl_Position\.y \+= u_viewportYOffset \* gl_Position\.w/);
  assert.match(contracts, /\+0\.38/);
  assert.match(contracts, /zur_state_v3_2/);
  assert.match(contracts, /crowdNorm/);
});

test("Stage 3.2 u_viewportYOffset uniform wired through vertex, post and ParticleSystem3D", () => {
  const vert = stripComments(read("src/shaders/render.vert.glsl"));
  assert.match(vert, /uniform float u_viewportYOffset;/);
  // ZUR-GH-013: the dart cone path offsets clip space; the screen-space crisp quad path offsets its NDC centre.
  assert.equal((vert.match(/gl_Position\.y \+= u_viewportYOffset \* gl_Position\.w;/g) || []).length, 1, "cone path");
  assert.match(vert, /vec2 quadNdc = ndc0 \+ offsetPx \* 2\.0 \/ u_resolution \+ vec2\(0\.0, u_viewportYOffset\);/, "quad path");
  const system = read("src/render/ParticleSystem3D.js");
  assert.match(system, /"u_viewportYOffset"/);
  assert.match(system, /gl\.uniform1f\(R\.u_viewportYOffset/);
  assert.match(system, /gl\.uniform1f\(P\.u_viewportYOffset/);
  assert.match(read("src/render/RenderHost.js"), /viewportYOffset/);
});

test("Stage 3.2 viewport offset: +0.38 only for open portrait HUD, smooth glide to 0", () => {
  assert.equal(HUD_DRAWER_Y_OFFSET, 0.38);
  assert.equal(viewportYOffsetTarget(true, 412, 915), 0.38);
  assert.equal(viewportYOffsetTarget(true, 1280, 720), 0);
  assert.equal(viewportYOffsetTarget(false, 412, 915), 0);
  let offset = 0.38;
  let previous = offset;
  for (let i = 0; i < 120 && offset !== 0; i += 1) {
    offset = stepViewportYOffset(offset, 0, 1 / 60);
    assert.ok(offset < previous && offset >= 0, "monotonic glide");
    previous = offset;
  }
  assert.equal(offset, 0, "settles at exactly 0");
  assert.ok(stepViewportYOffset(0, 0.38, 1 / 60) < 0.38, "does not jump");
});

test("Stage 3.2 HUD: Scene, Palette, Hue shift on top; Hide HUD button; pulse layout gated", () => {
  const hud = read("src/controls/ControlHUD.js");
  assert.ok(!hud.includes('"sel-scene"') && hud.indexOf('"sel-palette"') > 0 && hud.indexOf('"sel-palette"') < hud.indexOf('"rng-hue"'), "single Palette row precedes Hue; scene is chosen by the tab bar");
  assert.match(hud, /btn-hide-hud/);
  assert.match(hud, /Hide HUD \/ Fullscreen/);
  assert.match(read("src/controls/hudTabs.js"), /\["pulseLayout", "Pulse Field Layout"\]/);
  assert.match(read("src/app/main.js"), /canvas\.addEventListener\("click"[\s\S]*?toggleHidden/);
  assert.match(read("index.html"), /\.hud-hide\s*\{[^}]*position:\s*sticky/);
});

test("ZUR-GH-013 sw.js cache is zur-shell-v11, claims clients and precaches new shaders", () => {
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "zur-shell-v11"/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /\.(html|js|glsl)/);
  for (const file of ["render.frag.glsl", "render.vert.glsl", "sim.vert.glsl", "kaleido.frag.glsl", "core.frag.glsl", "spectral-canyon.frag.glsl"]) {
    assert.ok(sw.includes(file), file);
  }
});

test("Stage 3.2 AudioEngine stays silent unless a loaded track has Speaker Monitor checked", () => {
  const audio = stripComments(read("src/audio/AudioEngine.js"));
  assert.equal((audio.match(/\.connect\([^)]*\.destination/g) || []).length, 1);
  assert.match(audio, /destinationConnections/);
  assert.match(audio, /silent: destinationConnections === 0/);
});

test("Stage 4 visual controls have validated defaults and bounded values", () => {
  const visual = STAGE2_DEFAULT_PRESET.visual;
  assert.equal(visual.cameraMode, "orbit-3d");
  assert.equal(visual.chromaticAberration, 0.30);
  assert.equal(visual.godRays, 0.35);
  assert.equal(visual.vjAutopilot, false);
  for (const [key, value] of [
    ["cameraMode", "nope"], ["chromaticAberration", -0.1], ["chromaticAberration", 1.1],
    ["godRays", -1], ["godRays", 2], ["vjAutopilot", "yes"],
  ]) {
    const preset = structuredClone(STAGE2_DEFAULT_PRESET);
    preset.visual[key] = value;
    assert.equal(validatePreset(preset).ok, false, `${key}=${value}`);
  }
});

test("Stage 4 copper reset is one-time, neon, and clears hue shift", () => {
  const preset = structuredClone(STAGE2_DEFAULT_PRESET);
  preset.visual.paletteId = "copper-teal";
  preset.visual.hueShift = 0.42;
  const storage = mockStorage({ [STORAGE_KEY]: JSON.stringify({ storageSchema: STORAGE_SCHEMA, preset }) });
  const loaded = loadStoredState(storage);
  assert.equal(loaded.preset.visual.paletteId, "neon-tunnel");
  assert.equal(loaded.preset.visual.hueShift, 0);
  assert.equal(storage.getItem(V4_NEON_FLAG), "1");
});

test("Stage 4 formation text validates and URL state round-trips custom underscores", () => {
  const p = normalizeParticles({ formationType: "logo-attractor", attractorText: "CUSTOM_ZUR" });

test("ZUR-GH-005 greenlight: fresh Mode presets default to neon-tunnel hueShift 0", () => {
  for (const preset of [BLUEPRINT_EXAMPLE_PRESET, MODE_A_PRESET, MODE_B_PRESET, STAGE2_DEFAULT_PRESET]) {
    assert.equal(preset.visual.paletteId, "neon-tunnel", preset.name || "blueprint");
    assert.equal(preset.visual.hueShift, 0);
  }
});

test("ZUR-GH-005 greenlight: logo-attractor floors at 16k and tightens glyph spring", () => {
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /formationType === "logo-attractor"/);
  assert.match(ps, /Math\.max\(this\.count, 16384\)/);
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /u_formationType == 5 \? 16\.0/);
  assert.match(sim, /u_formationType == 5 \? 5\.5/);
  assert.match(sim, /u_formationType == 5\) F \*= 0\.05/);
});

  assert.equal(p.attractorText, "CUSTOM_ZUR");
  const decoded = decodePresetParam(encodePresetParam(MEGASTRUCTURE_SCENE_ID, p));
  assert.equal(decoded.sceneId, MEGASTRUCTURE_SCENE_ID);
  assert.equal(decoded.particles.attractorText, "CUSTOM_ZUR");
  const invalid = structuredClone(STAGE2_DEFAULT_PRESET);
  invalid.particles.attractorText = "x".repeat(65);
  assert.equal(validatePreset(invalid).ok, false);
});

test("Logo target generation is deterministic in Node and emits bounded vec4 points", () => {
  const first = sampleLogoTargets("ZUR", 4096);
  const second = sampleLogoTargets("ZUR", 4096);
  const custom = sampleLogoTargets("AI: UNDERGROUND", 4096);
  assert.equal(first.length, 4096 * 4);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, custom);
  for (let i = 0; i < first.length; i += 4) {
    assert.ok(first[i] >= -3.6 && first[i] <= 3.6);
    assert.ok(first[i + 1] >= -1.201 && first[i + 1] <= 1.201);
    assert.equal(first[i + 3], 1);
  }
});

test("Logo targets bind location 2 at divisor zero on both update VAOs and are disposed", () => {
  const src = read("src/render/ParticleSystem3D.js");
  assert.match(src, /this\.updateVaos\[i\].*0, true/);
  assert.match(src, /vertexAttribPointer\(2, 4, gl\.FLOAT, false, 16, 0\)/);
  assert.match(src, /vertexAttribDivisor\(2, 0\)/);
  assert.match(src, /gl\.deleteBuffer\(this\.logoTargetVBO\)/);
  assert.match(src, /gl\.disableVertexAttribArray\(2\)/);
});

test("Physarum sensors use three analytic multi-octave ridges with onset branching", () => {
  const sim = stripComments(read("src/shaders/sim.vert.glsl"));
  assert.match(sim, /senseLeft = physarumField/);
  assert.match(sim, /senseForward = physarumField/);
  assert.match(sim, /senseRight = physarumField/);
  assert.match(sim, /sensorAngle = 0\.45/);
  assert.match(sim, /vec3\(senseLeftDir \* 0\.14, 0\.0\)/);
  assert.match(sim, /vec3\(senseForwardDir \* 0\.14, 0\.0\)/);
  assert.match(sim, /vec3\(senseRightDir \* 0\.14, 0\.0\)/);
  assert.match(sim, /u_onset\);\s*vec2 steer/);
  assert.doesNotMatch(sim, /sceneFBO|u_scene/);
});

test("Fractal core is raymarched before swarm with bounded tier steps and palette shading", () => {
  const particle = read("src/render/ParticleSystem3D.js");
  const fragment = read("src/shaders/core.frag.glsl");
  const pass = particle.slice(particle.indexOf("if (extras.megastructure)"), particle.indexOf("const dart"));
  assert.ok(pass.includes("gl.drawArrays(gl.TRIANGLES, 0, 3)"));
  assert.ok(pass.indexOf("gl.drawArrays") < particle.indexOf("const dart"));
  assert.match(particle, /u_steps, visual\?\.qualityTier === "safe" \? 16 : 24/);
  assert.match(fragment, /for \(int stepIndex = 0; stepIndex < 24/);
  assert.match(fragment, /length\(point\) > 1\.35/);
  assert.match(fragment, /mix\(mix\(u_palette\[0\], u_palette\[2\]/);
  const shading = stripComments(fragment).slice(stripComments(fragment).indexOf("float band"));
  assert.ok(shading.length > 100 && !shading.includes("atan("), "no angular palette buckets (Mandelbulb phi atan is geometry only)");
  assert.match(read("src/render/RenderHost.js"), /megastructure: scene === "megastructure-3d"/);
});

test("Fractal core collision reflects particles out of the signed-distance core", () => {
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /float sdCore\(vec3 p\)/);
  assert.match(sim, /coreDistance < 0\.0/);
  assert.match(sim, /pos \+= n \*\s*\(-coreDistance/);
  assert.match(sim, /vel = reflect\(vel, n\) \* \(0\.85 \+ 0\.35 \* u_onset\)/);
  assert.match(sim, /uniform int u_megastructure/);
  assert.match(read("src/render/ParticleSystem3D.js"), /u_megastructure, extras\.megastructure \? 1 : 0/);
});

test("Wave-grid is pitched 32 degrees to expose terrain height", () => {
  const sim = read("src/shaders/sim.vert.glsl");
  assert.match(sim, /float pitch = 0\.5585053606/);
  assert.match(sim, /h \* 1\.1 \* cos\(pitch\) - z \* sin\(pitch\)/);
});

test("Spectral spectrum row uses live bins and five-band smooth fallback", () => {
  const silence = getSpectrumRow128({});
  const fallback = getSpectrumRow128({ sub: 1, bass: 0.6, lowMid: 0.3, highMid: 0.1, treble: 0 });
  const liveBins = new Float32Array(256).fill(-100);
  liveBins[201] = -10;
  const live = getSpectrumRow128({ frequencyDb: liveBins });
  assert.equal(silence.length, 512);
  assert.equal(fallback.length, 512);
  assert.equal(live.length, 512);
  assert.equal(silence[3], 255);
  assert.ok(fallback[3] > fallback[127 * 4]);
  assert.ok(live[100 * 4] > live[0]);
});

test("Spectral canyon implements ScenePlugin lifecycle and one-row texture updates", () => {
  const plugin = read("src/render/SpectralCanyon3D.js");
  const host = read("src/render/RenderHost.js");
  for (const method of ["init()", "resize(width, height)", "render(frame, palette", "dispose()"]) {
    assert.ok(plugin.includes(method), method);
  }
  assert.match(plugin, /texImage2D\(gl\.TEXTURE_2D, 0, gl\.RGBA8, 128, 64/);
  assert.match(plugin, /texSubImage2D\(gl\.TEXTURE_2D, 0, 0, this\.rowIndex, 128, 1/);
  assert.match(plugin, /getSpectrumRow128\(frame\)/);
  assert.match(host, /this\.spectralCanyon\.render/);
  assert.match(host, /scene === "spectral-canyon-3d"/);
  assert.match(read("src/shaders/spectral-canyon.frag.glsl"), /u_viewportYOffset/);
});

test("Kaleidoscope post effects use at most nine non-nested scene samples", () => {
  const shader = stripComments(read("src/shaders/kaleido.frag.glsl"));
  assert.equal((shader.match(/texture\(u_scene/g) || []).length, 4);
  assert.match(shader, /uniform float u_chromaticAberration/);
  assert.match(shader, /uniform float u_godRays/);
  assert.match(shader, /for \(int i = 0; i < 6; i\+\+\)/);
  assert.doesNotMatch(shader, /for\s*\([^)]*\)\s*\{[^{}]*for\s*\(/);
  assert.match(read("src/render/ParticleSystem3D.js"), /u_chromaticAberration/);
  assert.match(read("src/render/ParticleSystem3D.js"), /u_godRays/);
});

test("Camera director exposes four modes and applies static, tunnel-fly, and beat-bank paths", () => {
  const app = read("src/app/AppState.js");
  const particle = read("src/render/ParticleSystem3D.js");
  assert.match(app, /cameraMode: "orbit-3d"/);
  for (const mode of ["static", "orbit-3d", "tunnel-fly", "beat-bank"]) assert.ok(app.includes(`"${mode}"`), mode);
  assert.match(particle, /cameraMode === "static"/);
  assert.match(particle, /cameraMode === "tunnel-fly"/);
  assert.match(particle, /cameraMode === "beat-bank"/);
});

test("VJ autopilot advances Breakdown, Build-Up, Drop on a 12-second dwell", () => {
  const autopilot = new VJAutopilot();
  assert.equal(VJ_DWELL_SECONDS, 12);
  assert.deepEqual([...VJ_PHASES], ["breakdown", "build-up", "drop"]);
  let event = null;
  for (let i = 0; i < 48; i += 1) event = autopilot.update(0.25, true);
  assert.equal(event.phase, "build-up");
  assert.equal(event.changed, true);
  for (let i = 0; i < 48; i += 1) event = autopilot.update(0.25, true);
  assert.equal(event.phase, "drop");
  assert.equal(event.shockwave, true);
});

test("VJ autopilot manual HUD touch pauses changes for 45 seconds", () => {
  const autopilot = new VJAutopilot();
  assert.equal(VJ_MANUAL_PAUSE_SECONDS, 45);
  autopilot.manualTouch();
  let event = autopilot.update(0.25, true);
  assert.equal(event.paused, true);
  assert.equal(event.changed, false);
  for (let i = 0; i < 180; i += 1) event = autopilot.update(0.25, true);
  assert.equal(event.paused, false);
  assert.match(read("src/app/main.js"), /triggerShockwave\(frame\.rms/);
});

test("HUD exposes the VJ Autopilot pill and custom logo text", () => {
  const hud = read("src/controls/ControlHUD.js");
  assert.match(hud, /⚡ VJ Autopilot \(Drop Detector\)/);
  assert.match(hud, /btn-vj-autopilot/);
  for (const name of ["AI: UNDERGROUND", "MON DAAIN", "TENTH GATE", "ZUR"]) assert.ok(read("src/app/AppState.js").includes(name));
  assert.match(hud, /cameraMode/);
  assert.match(hud, /chromaticAberration/);
  assert.match(hud, /godRays/);
});

test("Scene IDs and app wiring include both Stage 4 render paths", () => {
  const host = read("src/render/RenderHost.js");
  const main = read("src/app/main.js");
  assert.match(host, /preset\?\.sceneId === "spectral-canyon-3d"/);
  assert.match(host, /viewportYOffsetTarget\(hudOpen/);
  assert.match(main, /new SpectralCanyon3D/);
  assert.match(main, /new ParticleSystem3D/);
});

test("Service worker caches the Stage 4 JavaScript and shaders", () => {
  const sw = read("sw.js");
  for (const path of [
    "src/app/VJAutopilot.js", "src/render/SpectralCanyon3D.js", "src/render/LogoAttractor.js",
    "src/shaders/core.frag.glsl", "src/shaders/spectral-canyon.frag.glsl",
  ]) assert.ok(sw.includes(path), path);
  assert.match(sw, /networkFirst/);
});

test("Service worker treats navigations and directory URLs as network-first", () => {
  const sw = read("sw.js");
  assert.match(sw, /request\.mode === "navigate"/);
  assert.match(sw, /pathname\.endsWith\("\/"\)/);
});

test("Spectral canyon lifts terrain upward with the portrait HUD offset", () => {
  const frag = read("src/shaders/spectral-canyon.frag.glsl");
  assert.match(frag, /uv\.y -= 0\.5 \* u_viewportYOffset;/);
  assert.doesNotMatch(frag, /uv\.y \+= 0\.5 \* u_viewportYOffset;/);
});

test("ZUR-GH-007 spectral canyon raycasts a synthwave floor + twin walls (no broken pitch/UV math)", () => {
  const frag = stripComments(read("src/shaders/spectral-canyon.frag.glsl"));
  assert.doesNotMatch(frag, /mat2\(cos\(pitch\)/);
  assert.doesNotMatch(frag, /uv\.y > 0\.65/);
  assert.match(frag, /const float HORIZON_UV = 0\.62/);
  assert.match(frag, /float wallMask\(float x\)/);
  assert.match(frag, /smoothstep\(CANYON_HALF_WIDTH, CANYON_HALF_WIDTH \+ WALL_RAMP, abs\(x\)\)/);
  assert.match(frag, /wall \* \(WALL_HEIGHT/);
  assert.match(frag, /for \(int j = 0; j < 5; j\+\+\)/); // bisection refine of the height-field hit
});

test("Logo attractor spreads a small active prefix across the full glyph height", async () => {
  const { sampleLogoTargets } = await import("../src/render/LogoAttractor.js");
  const t = sampleLogoTargets("ZUR", 2048);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 256; i += 1) { minY = Math.min(minY, t[i * 4 + 1]); maxY = Math.max(maxY, t[i * 4 + 1]); }
  assert.ok(maxY - minY > 2.0, `first 256 agents span ${maxY - minY}`);
});

test("Stage 4 docs record the new scene, post effects, autopilot, and migration", () => {
  const contracts = read("CONTRACTS.md");
  const state = read("STATE.md");
  assert.match(contracts, /Stage 4/);
  assert.match(contracts, /spectral-canyon-3d/);
  assert.match(contracts, /chromaticAberration/);
  assert.match(state, /ZUR-GH-005/);
  assert.match(state, /zur_state_v[45]_0/);
});

test("Spectral canyon draws neon wireframe ridges with an idle baseline wave", () => {
  const frag = read("src/shaders/spectral-canyon.frag.glsl");
  const plugin = read("src/render/SpectralCanyon3D.js");
  assert.match(frag, /u_silent/);
  assert.match(frag, /float gridLine\(float coord, float footprint\)/);
  assert.match(frag, /GRID_SPACING = 0\.5/);
  assert.match(frag, /idleWave/);
  assert.match(plugin, /idleSpectrumRow128/);
  assert.match(plugin, /u_silent/);
  assert.match(plugin, /frame\.isSilent/);
});

test("HUD hides 3D swarm on spectral-canyon and prompts Mic/oscillator while CAPTURE IDLE", () => {
  const hud = read("src/controls/ControlHUD.js");
  const html = read("index.html");
  assert.match(read("src/app/AppState.js"), /id: "canyon", sceneId: SPECTRAL_CANYON_SCENE_ID/);
  assert.doesNotMatch(hud, /this\.visual\.hidden = /, "ZUR-GH-013: the unlocked deck never hides the visual controls");
  assert.match(hud, /audio-prompt/);
  assert.match(hud, /btn-mic-prompt/);
  assert.match(hud, /btn-oscillator-prompt/);
  assert.match(hud, /captureIdle/);
  assert.match(html, /audio-prompt-pulse/);
  assert.match(hud, /CAPTURE IDLE/);
});

test("Smoke asserts spatial contrast for spectral-canyon and megastructure", () => {
  const smoke = read("tests/smoke-stage3.2.mjs");
  assert.match(smoke, /lumaStdDev/);
  assert.match(smoke, /minLuma < 0\.08/);
  assert.match(smoke, /maxLuma > 0\.55/);
  assert.match(smoke, /lumaStdDev > 0\.14/);
  assert.match(smoke, /3D SWARM controls still visible on spectral-canyon-3d/);
  assert.match(smoke, /CAPTURE IDLE audio prompt missing/);
});


// ---- ZUR-GH-007: Stage 4 visual + geometry fixes from M'lord's 7-minute Galaxy A57 capture ----

test("ZUR-GH-007 core raymarcher shares the kaleido optical centre (0.0, u_viewportYOffset)", () => {
  const core = stripComments(read("src/shaders/core.frag.glsl"));
  const kaleido = stripComments(read("src/shaders/kaleido.frag.glsl"));
  const vert = read("src/shaders/render.vert.glsl");
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(core, /uniform float u_viewportYOffset;/);
  assert.match(core, /vec2 opticalCenter = vec2\(0\.5, 0\.5 \+ 0\.5 \* u_viewportYOffset\)/);
  assert.match(core, /gl_FragCoord\.xy \/ u_resolution - opticalCenter/);
  assert.match(kaleido, /vec2 center = vec2\(0\.5, 0\.5 \+ 0\.5 \* u_viewportYOffset\)/);
  assert.equal((vert.match(/gl_Position\.y \+= u_viewportYOffset \* gl_Position\.w/g) || []).length, 1);
  assert.match(vert, /\+ vec2\(0\.0, u_viewportYOffset\);/);
  const corePass = ps.slice(ps.indexOf("if (extras.megastructure)"), ps.indexOf("const dart"));
  assert.match(corePass, /gl\.uniform1f\(C\.u_viewportYOffset, viewportYOffset\)/);
  assert.match(ps, /"u_viewportYOffset", "u_emission",\s*\]\);/);
  assert.match(ps, /gl\.uniform1f\(R\.u_viewportYOffset, viewportYOffset\)/);
  assert.match(ps, /gl\.uniform1f\(P\.u_viewportYOffset, viewportYOffset\)/);
});

test("ZUR-GH-007 core at the optical centre stays inside 4/6/8/12/16-mirror folds (HUD open + hidden)", async () => {
  const { opticalCenterUv } = await import("../src/render/particleMath.js");
  assert.deepEqual(opticalCenterUv(0), [0.5, 0.5]);
  assert.deepEqual(opticalCenterUv(0.38), [0.5, 0.69]);
  const aspect = 412 / 915;
  for (const offset of [0, 0.38]) {
    const [cu, cv] = opticalCenterUv(offset);
    for (const segments of [4, 6, 8, 12, 16]) {
      for (let k = 0; k < 64; k += 1) {
        const r = 0.12 * ((k % 8) + 1) / 8;
        const a = (k / 64) * Math.PI * 2;
        const u = cu + (Math.cos(a) * r) / aspect;
        const v = cv + Math.sin(a) * r;
        const [fu, fv] = kaleidoFold(u, v, segments, 0.37, aspect, 1, cv);
        // the fold preserves radius around the shared centre, so the core disk is always sampled
        const fr = Math.hypot((fu - cu) * aspect, fv - cv);
        assert.ok(Math.abs(fr - r) < 1e-6, `segments ${segments} offset ${offset} r ${r} -> ${fr}`);
      }
    }
    // the pre-fix core centre (uv 0.5) sat 0.19 below the HUD-open fold origin -> folded empty space
    if (offset > 0) assert.ok(Math.abs(0.5 - cv) > 0.15);
  }
});

test("ZUR-GH-007 fractal-core is a 3D multi-orbital golden-spiral shell + lobe streams, never a planar ring", () => {
  const sim = stripComments(read("src/shaders/sim.vert.glsl"));
  assert.match(sim, /vec3 fractalCoreTarget\(float seed, uint uid\)/);
  assert.match(sim, /if \(u_formationType == 4\) return fractalCoreTarget\(seed, uid\);/);
  assert.doesNotMatch(sim, /return dir \* \(1\.45 \+ 0\.5 \* seed\)/);
  assert.match(sim, /float phi = acos\(clamp\(1\.0 - 2\.0 \* i \/ n, -1\.0, 1\.0\)\)/);
  assert.match(sim, /float theta = i \* 2\.39996323/);
  assert.match(sim, /vec3 rotateAxis\(vec3 v, vec3 axis, float angle\)/);
  assert.match(sim, /int orbit = int\(uid % 5u\)/); // five tilted orbital planes
  assert.match(sim, /dir = rotateAxis\(dir, axis, u_time/);
  assert.match(sim, /float lobeAz = \(1\.5707963 - u_time \* 0\.7 \+ TAU \* k\) \/ 7\.0/); // 7 sdCore lobes
  assert.match(sim, /float valley = max\(-lobes, 0\.0\)/);
  assert.match(sim, /valley \* \(0\.25 \+ 0\.35 \* band\)/); // audio-reactive breathing into the SDF valleys
  assert.match(sim, /max\(R, coreRadius \+ MEGA_SWARM_INNER_R\)/);
  assert.match(sim, /if \(u_formationType == 4\) F \*= 0\.25;/);
});

test("ZUR-GH-007 fractal-core shell fills X, Y and Z equally (edge-on view is round, not a 1-px line)", async () => {
  const { fractalCoreShellDirections } = await import("../src/render/particleMath.js");
  for (const count of [2048, 16384, 65536]) {
    const d = fractalCoreShellDirections(count);
    const mean = [0, 0, 0];
    const sq = [0, 0, 0];
    for (let i = 0; i < count; i += 1) for (let a = 0; a < 3; a += 1) { mean[a] += d[i * 3 + a]; sq[a] += d[i * 3 + a] ** 2; }
    const std = sq.map((v, a) => Math.sqrt(v / count - (mean[a] / count) ** 2));
    for (const s of std) assert.ok(Math.abs(s - 1 / Math.sqrt(3)) < 0.02, `count ${count} std ${std}`);
    // camera at a 90-degree orbit looks down X: the projected (z, y) footprint must be as wide as tall
    let zMin = 1, zMax = -1, yMin = 1, yMax = -1;
    for (let i = 0; i < count; i += 1) {
      zMin = Math.min(zMin, d[i * 3 + 2]); zMax = Math.max(zMax, d[i * 3 + 2]);
      yMin = Math.min(yMin, d[i * 3 + 1]); yMax = Math.max(yMax, d[i * 3 + 1]);
    }
    assert.ok((zMax - zMin) / (yMax - yMin) > 0.95, `count ${count}`);
  }
});

test("ZUR-GH-007 logo-attractor scales oscillation by 0.08, frees agents to settle and billboards to the camera", () => {
  const sim = stripComments(read("src/shaders/sim.vert.glsl"));
  assert.match(sim, /const float LOGO_OSCILLATION_SCALE = 0\.08;/);
  assert.match(sim, /if \(u_formationType == 5\) amt \*= LOGO_OSCILLATION_SCALE;/);
  assert.match(sim, /uniform vec3 u_billboardRight;/);
  assert.match(sim, /uniform vec3 u_billboardUp;/);
  assert.match(sim, /return right \* aLogoTarget\.x \+ up \* aLogoTarget\.y \+ toward \* aLogoTarget\.z;/);
  assert.match(sim, /if \(u_formationType == 5\) \{ lo = 0\.0; hi = 6\.0; \}/);
  assert.equal(LOGO_OSCILLATION_SCALE, 0.08);
  assert.ok(Math.abs(effectiveOscillationAmount("logo-attractor", 3) - 0.24) < 1e-9);
  assert.equal(effectiveOscillationAmount("fractal-core", 3), 3);
});

test("ZUR-GH-007 logo-attractor clamps effective trail decay (Comet 0.81 cannot smear glyphs)", () => {
  assert.equal(LOGO_TRAIL_LENGTH_MAX, 0.2);
  assert.equal(effectiveTrailLength("logo-attractor", 0.81), 0.2);
  assert.equal(effectiveTrailLength("logo-attractor", 0.1), 0.1);
  assert.equal(effectiveTrailLength("neon-tunnel", 0.81), 0.81);
  assert.ok(trailKeepFactor("comet", effectiveTrailLength("logo-attractor", 0.81)) < 0.45);
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /const trailLength = effectiveTrailLength\(particles\.formationType, particles\.trailLength\)/);
  assert.match(ps, /trailKeepFactor\(particles\.trailType, trailLength\)/);
  assert.match(ps, /gl\.uniform1f\(R\.u_trailLength, trailLength\)/);
  assert.doesNotMatch(ps, /u_trailLength, particles\.trailLength/);
});

test("ZUR-GH-007 billboard basis faces the active camera from every orbit angle", () => {
  for (const deg of [0, 45, 90, 135, 180, 270]) {
    const a = (deg * Math.PI) / 180;
    const eye = [Math.sin(a) * 11.5, 2.2, Math.cos(a) * 11.5];
    const { right, up } = billboardBasis(eye);
    const fl = Math.hypot(...eye);
    const f = eye.map((v) => -v / fl);
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    assert.ok(Math.abs(dot(right, f)) < 1e-6, `right.forward @${deg}`);
    assert.ok(Math.abs(dot(up, f)) < 1e-6, `up.forward @${deg}`);
    assert.ok(Math.abs(dot(right, up)) < 1e-6);
    assert.ok(Math.abs(Math.hypot(...right) - 1) < 1e-6 && Math.abs(Math.hypot(...up) - 1) < 1e-6);
    assert.ok(up[1] > 0.9, "text stays upright");
  }
  const side = billboardBasis([11.5, 0, 0]);
  assert.ok(Math.abs(side.right[2] + 1) < 1e-6, "90-degree orbit: text runs along -Z, not edge-on");
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /billboardBasis\(this\.eye, this\.origin, this\.billboardRight, this\.billboardUp\)/);
  assert.match(ps, /"u_billboardRight", "u_billboardUp"/);
});

test("ZUR-GH-007 HUD places the Logo / Attractor Text selector directly under Formation", () => {
  const hud = read("src/controls/ControlHUD.js");
  assert.deepEqual([...LOGO_TEXT_PRESETS], ["AI: UNDERGROUND", "MON DAAIN", "TENTH GATE", "ZUR"]);
  // ZUR-GH-010: the selector lives in the Logo / Text Attractor sub-mode (formation is locked to logo-attractor there).
  assert.match(hud, /logoText: \["sel-attractor-preset"/);
  assert.match(read("src/controls/hudTabs.js"), /\["logoText", "Logo Text"\]/);
});

test("ZUR-GH-007 canyon scrolls z at u_time * 2.5 with waterfall + multi-band ridges", () => {
  const frag = stripComments(read("src/shaders/spectral-canyon.frag.glsl"));
  const plugin = read("src/render/SpectralCanyon3D.js");
  assert.match(frag, /const float SCROLL_SPEED = 2\.5;/);
  assert.match(frag, /float zScroll = u_time \* SCROLL_SPEED;/);
  assert.match(frag, /uniform float u_bands\[5\];/);
  assert.match(frag, /float bandHeight\(float x\)/);
  assert.match(frag, /texture\(u_waterfallTex,/);
  assert.match(frag, /sin\(x \* 2\.4/); // x-frequency ridges
  assert.match(plugin, /bands: gl\.getUniformLocation\(this\.program, "u_bands"\)/);
  assert.match(plugin, /gl\.uniform1fv\(this\.locations\.bands, this\.bands\)/);
  assert.match(plugin, /frame\.sub, frame\.bass, frame\.lowMid, frame\.highMid, frame\.treble/);
});

test("ZUR-GH-007 canyon colours come only from u_palette with a luma cap (zero white blowouts)", () => {
  const frag = stripComments(read("src/shaders/spectral-canyon.frag.glsl"));
  assert.doesNotMatch(frag, /vec3\(1\.0\)/);
  assert.doesNotMatch(frag, /max\(neon, vec3\(/);
  assert.doesNotMatch(frag, /vec3 sky = vec3\(0\./);
  assert.match(frag, /const float LUMA_CAP = 0\.86;/);
  assert.match(frag, /vec3 guardNeon\(vec3 c\)/);
  assert.equal((frag.match(/fragColor = vec4\(linearToSRGB\(guardNeon\(/g) || []).length, 2);
  for (const i of [0, 1, 2, 3, 4]) assert.ok(frag.includes(`u_palette[${i}]`), `u_palette[${i}]`);
  // JS mirror of guardNeon over every palette stop at 2x overdrive: luma never exceeds the cap
  const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  for (const id of PALETTE_IDS) {
    for (const stop of PALETTES[id]) {
      let c = stop.map((v) => v * 2);
      const m = Math.min(...c);
      c = c.map((v) => v - m * 0.35);
      const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      c = c.map((v) => Math.min(1, v * Math.min(1, 0.86 / Math.max(l, 1e-4))));
      const out = c.map(srgb);
      assert.ok(Math.min(...out) < 0.97, `${id} stop blew out to white ${out}`);
    }
  }
});

test("ZUR-GH-007 headless smoke covers 16 mirrors, 90-degree fractal-core, logo readability and canyon grid", () => {
  const smoke = read("tests/smoke-zur-gh-007.mjs");
  assert.match(smoke, /width: 412, height: 915/);
  assert.match(smoke, /for \(const segments of \[0, 4, 8, 16\]\)/);
  assert.match(smoke, /diskLitFraction > 0\.6/);
  assert.match(smoke, /\(Math\.PI \/ 2\) \/ 0\.06/);
  assert.match(smoke, /spread\.minRatio > 0\.55/);
  assert.match(smoke, /litWidthRatio > 0\.35/);
  assert.match(smoke, /logo\.textRuns >= 6/);
  assert.match(smoke, /rng-osc-amount", 3/);
  assert.match(smoke, /rng-trail-length", 0\.81/);
  assert.match(smoke, /sel-attractor-preset/);
  assert.match(smoke, /upperMidLumaFraction >= 0\.35/);
  assert.match(smoke, /l > 0\.15 && l < 0\.90/);
  assert.match(smoke, /gridCrossings >= 12/);
  assert.match(smoke, /upperMaxLuma < 0\.9/);
  assert.match(read("package.json"), /smoke:gh007/);
});

test("ZUR-GH-007 is logged in STATE.md and CONTRACTS.md", () => {
  const state = read("STATE.md");
  const contracts = read("CONTRACTS.md");
  assert.match(state, /ZUR-GH-007/);
  assert.match(contracts, /ZUR-GH-007/);
  assert.match(contracts, /Logo \/ Attractor Text/);
});

test("ZUR-GH-008 caps keepFactor at 0.90 for >= 16k agents and bounds steady-state trail energy", async () => {
  const { trailKeepFactor, chromaFloor, FISH_LEADER_Y, fishLeader, gasCirculation } = await import("../src/render/particleMath.js");
  assert.equal(TRAIL_HIGH_COUNT, 16384);
  assert.equal(TRAIL_KEEP_CAP, 0.9);
  const keepMax = trailKeepFactor("comet", 1);
  assert.ok(near(1 / (1 - keepMax), 28.571428, 1e-6), "uncapped Trail 1.00 accumulates 28.5x");
  assert.equal(capKeepFactor(keepMax, 65536), 0.9);
  assert.equal(capKeepFactor(keepMax, 16384), 0.9);
  assert.equal(capKeepFactor(keepMax, 16383), keepMax, "below 16k the keep is untouched");
  assert.equal(capKeepFactor(0.3, 65536), 0.3);
  // u_trailEnergyNorm = clamp((1 - k) / (1 - 0.55), 0.18, 1)
  assert.equal(TRAIL_ENERGY_NORM_MIN, 0.18);
  assert.ok(near(trailEnergyNorm(0.9), 0.1 / 0.45));
  assert.equal(trailEnergyNorm(0.3), 1);
  assert.equal(trailEnergyNorm(0.999), 0.18);
  for (const k of [0.55, 0.7, 0.85, 0.9]) assert.ok(near(normalizedSteadyStateEnergy(k), 1 / 0.45, 1e-9), `steady state bounded @${k}`);
  assert.ok(normalizedSteadyStateEnergy(capKeepFactor(keepMax, 65536)) < 2.3, "64k + Trail 1.00 steady state ~2.2x, not 28.5x");
  assert.equal(particleSizeNorm(1.5), 1);
  assert.ok(near(particleSizeNorm(3.35), 1 / 3.35 ** 0.65));
  const src = read("src/render/ParticleSystem3D.js");
  assert.match(src, /capKeepFactor\(/);
  assert.match(src, /gl\.uniform1f\(R\.u_trailEnergyNorm, energyNorm\)/);
  assert.match(src, /"u_trailEnergyNorm"/);
  const frag = stripComments(read("src/shaders/render.frag.glsl"));
  assert.match(frag, /uniform float u_trailEnergyNorm;/);
  assert.match(frag, /float sizeNorm = u_particleSize > 1\.5 \? 1\.0 \/ pow\(max\(u_particleSize, 1\.0\), 0\.65\) : 1\.0;/);
  assert.match(frag, /\* sqrt\(crowdNorm\) \* energyNorm \* logoBoost, 1\.0\)/, "dart radiance scaled by u_trailEnergyNorm");
  assert.match(frag, /exposure \* energyNorm \* paletteBoost \* logoBoost \* CRISP_DOT_GAIN/, "crisp quad radiance scaled by u_trailEnergyNorm");
  const kaleido = stripComments(read("src/shaders/kaleido.frag.glsl"));
  assert.match(kaleido, /uniform vec3 u_paletteHue;/);
  assert.match(kaleido, /const float CHROMA_FLOOR_PEAK = 0\.65;/);
  assert.match(kaleido, /fragColor = vec4\(chromaFloor\(linearToSRGB\(toneMap\(/);
  assert.match(kaleido, /\* \(1\.0 - u_coreSpecular\);/);
  const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  const lavender = chromaFloor([0.95, 0.88, 0.97], [1, 0, 0.63]);
  assert.ok(sat(lavender) >= 0.55 && Math.max(...lavender) <= 1, "white-lavender pulled back to >= 0.55 saturation");
  const grey = chromaFloor([0.9, 0.9, 0.9], [1, 0, 0.63]);
  assert.ok(sat(grey) >= 0.55 && grey[0] > grey[1], "pure white takes the dominant palette hue");
  assert.deepEqual(chromaFloor([0.3, 0.3, 0.3]), [0.3, 0.3, 0.3], "dim pixels untouched");
  assert.deepEqual(chromaFloor([0.95, 0.9, 0.97], [1, 0, 0.63], 1), [0.95, 0.9, 0.97], "megastructure core specular exempt");
  // Fix 4 mirrors.
  assert.equal(FISH_LEADER_Y.length, 6);
  assert.ok(Math.abs(FISH_LEADER_Y.reduce((a, b) => a + b, 0)) < 1e-12, "fish leader Y offsets sum to zero");
  for (const t of [0, 1.7, 13.2, 99]) {
    const ySum = [0, 1, 2, 3, 4, 5].reduce((acc, i) => acc + fishLeader(i, t)[1], 0);
    assert.ok(Math.abs(ySum) < 1e-9, `fish leaders balanced @t=${t}`);
  }
  assert.ok(gasCirculation(0.5, 0)[1] > 0 && gasCirculation(4.5, 0)[1] < 0, "gas rises inside the ring, sinks outside");
  assert.ok(gasCirculation(2.4, 2)[0] > 0 && gasCirculation(2.4, -2)[0] < 0, "gas spills outward on top, returns underneath");
  const sim = stripComments(read("src/shaders/sim.vert.glsl"));
  assert.match(sim, /const float FISH_LEADER_Y\[6\] = float\[6\]\(0\.9, -0\.9, 0\.55, -0\.55, 0\.25, -0\.25\);/);
  assert.match(sim, /vec3 leaderPos = fishLeader\(lead, u_time\);/);
  assert.match(sim, /const float GAS_TORUS_RADIUS = 2\.4;/);
  assert.match(sim, /pos\.y -= 2\.0 \* GAS_WRAP_Y;/, "gas toroidal Y wrap");
  assert.match(sim, /cross\(vec3\(0\.0, 1\.0, 0\.0\), radDir\)/, "gas radial curl dispersion");
  assert.doesNotMatch(sim, /pos\.y > 5\.5/, "no single central-plume respawn");
});

test("ZUR-GH-008 particle splatting disables DEPTH_TEST + depth writes; dart3d edges are watertight", () => {
  const src = read("src/render/ParticleSystem3D.js");
  const start = src.indexOf("  render(frame, palette");
  const end = src.indexOf("  stats()");
  const body = stripComments(src.slice(start, end));
  const draw = body.indexOf("gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, count)");
  const disable = body.lastIndexOf("gl.disable(gl.DEPTH_TEST);", draw);
  const mask = body.lastIndexOf("gl.depthMask(false);", draw);
  assert.ok(disable > 0 && mask > disable && draw > mask, "gl.disable(gl.DEPTH_TEST) + gl.depthMask(false) right before the instanced draw");
  assert.ok(!/gl\.enable\(gl\.DEPTH_TEST\)/.test(body), "particle pass never re-enables depth testing");
  const between = body.slice(mask, draw);
  assert.ok(!/DEPTH_TEST|depthMask\(true\)/.test(between));
  const vert = stripComments(read("src/shaders/render.vert.glsl"));
  assert.match(vert, /invariant gl_Position;/);
  assert.match(vert, /vec3 world = center \+ frame \* \(dartVertex\(vertexIndex\) \* s\);/);
});

test("ZUR-GH-008 formation / flow / scene change opens a 250 ms trail clear window (keep <= 0.45)", () => {
  assert.equal(TRAIL_TRANSITION_MS, 250);
  assert.equal(TRAIL_TRANSITION_KEEP_MAX, 0.45);
  const guard = new TrailTransitionGuard();
  const sig = (form, flow = "murmuration", scene = "particle-swarm-3d") => transitionSignature(scene, form, flow);
  assert.equal(guard.observe(sig("polygon-rings"), 0), false, "first observation never triggers");
  assert.equal(guard.keepCap(10), 1);
  assert.equal(guard.observe(sig("polygon-rings"), 100), false);
  assert.equal(guard.observe(sig("supernova-shell"), 1000), true, "formation change triggers");
  assert.equal(guard.keepCap(1000), 0.45);
  assert.equal(guard.keepCap(1249), 0.45);
  assert.equal(guard.keepCap(1250), 1, "window closes after 250 ms");
  assert.equal(guard.observe(sig("supernova-shell", "gas"), 2000), true, "flow change triggers");
  assert.equal(guard.observe(sig("supernova-shell", "gas", "megastructure-3d"), 3000), true, "scene change triggers");
  assert.equal(guard.count, 3);
  assert.equal(capKeepFactor(0.9, 65536, guard.keepCap(3100)), 0.45);
  assert.ok(0.45 ** 15 < 1e-5, "15 frames at keep 0.45 clear a stale silhouette");
  assert.ok(normalizedSteadyStateEnergy(0.45) < normalizedSteadyStateEnergy(0.9), "no flash: clear-window energy stays below the capped steady state");
  const host = read("src/render/RenderHost.js");
  assert.match(host, /this\.trailTransition = new TrailTransitionGuard\(\);/);
  assert.match(host, /transitionSignature\(preset\?\.sceneId, preset\?\.particles\?\.formationType, preset\?\.particles\?\.flowMode\)/);
  assert.match(host, /trailKeepCap: this\.trailTransition\.keepCap\(now\)/);
  assert.match(read("src/render/ParticleSystem3D.js"), /extras\.trailKeepCap \?\? 1/);
  assert.match(read("sw.js"), /\.\/src\/render\/PostProcessPass\.js/);
});

test("ZUR-GH-008 smoke script asserts whiteClip, meanSat, errors and silence at 64k + Trail 1.00 + size 3.35x + dart", () => {
  const smoke = read("tests/smoke-zur-gh-008.mjs");
  assert.match(smoke, /sel-count", "64k"/);
  assert.match(smoke, /rng-trail-length", 1\)/);
  assert.match(smoke, /rng-size", 3\.35\)/);
  assert.match(smoke, /sel-shape", "dart"/);
  assert.match(smoke, /m\.whiteClip < 0\.01/);
  assert.match(smoke, /m\.meanSat >= 0\.55/);
  assert.match(smoke, /keepFactor not clamped <= 0\.45 inside the window/);
  assert.match(smoke, /destinationConnections !== 0/);
  assert.match(read("package.json"), /smoke:gh008/);
});


// ───────────────────────── ZUR-GH-009 Stage 5: Blood, Brain & Deep Space ─────────────────────────
import * as pm009 from "../src/render/particleMath.js";
const g009 = {
  sim: () => stripComments(read("src/shaders/sim.vert.glsl")),
  vert: () => stripComments(read("src/shaders/render.vert.glsl")),
  frag: () => stripComments(read("src/shaders/render.frag.glsl")),
  core: () => stripComments(read("src/shaders/core.frag.glsl")),
  hud: () => read("src/controls/ControlHUD.js"),
  ps: () => read("src/render/ParticleSystem3D.js"),
};

test("ZUR-GH-013 sw.js cache is zur-shell-v11 and storage key zur_state_v6_0 with v5.3 + v5.2 + v5.1 + v4 migration", () => {
  assert.match(read("sw.js"), /const CACHE = "zur-shell-v11"/);
  assert.equal(STORAGE_KEY, "zur_state_v6_0");
  assert.deepEqual(LEGACY_STORAGE_KEYS.slice(0, 5), ["zur_state_v5_3", "zur_state_v5_2", "zur_state_v5_1", "zur_state_v5_0", "zur_state_v4_0"]);
  const old = structuredClone(MODE_A_PRESET);
  old.particles = { ...old.particles, particleCountTier: "16k", particleStyle: "orb" };
  const loaded = loadStoredState(mockStorage({ zur_state_v4_0: JSON.stringify({ storageSchema: 4.0, preset: old }) }));
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.preset.particles.particleCountTier, "64k", "legacy small tier -> 64k");
  assert.equal(loaded.preset.particles.particleStyle, "crisp-dot", "legacy orb -> crisp-dot (v6.0 default)");
  assert.equal(loaded.preset.particles.reactivityMode, "true-gate");
});

test("ZUR-GH-009 five count tiers: 64k 96k 128k 160k 256k, default 64k, no small tiers", () => {
  assert.deepEqual([...pm009.COUNT_TIERS], ["64k", "96k", "128k", "160k", "256k"]);
  assert.deepEqual({ ...pm009.COUNT_TIER_VALUES }, { "64k": 65536, "96k": 98304, "128k": 131072, "160k": 163840, "256k": 262144 });
  for (const tier of ["16k", "32k", "2k", "1k", "64", "auto"]) {
    assert.equal(normalizeParticles({ particleCountTier: tier }).particleCountTier, "64k", tier);
  }
  assert.doesNotMatch(g009.hud(), /"16k"|"32k"/);
});

test("ZUR-GH-009 MAX_PARTICLES 262144 sizes every transform-feedback VBO and the logo target buffer", () => {
  assert.equal(pm009.MAX_PARTICLES, 262144);
  const ps = g009.ps();
  assert.match(ps, /seedParticleState\(MAX_PARTICLES\)/);
  assert.match(ps, /gl\.bufferData\(gl\.ARRAY_BUFFER, this\.initialState, gl\.DYNAMIC_COPY\)/);
  assert.match(ps, /sampleLogoTargets\(attractorText, MAX_PARTICLES\)/);
  assert.match(ps, /logoTargetVBO/);
  assert.equal(sampleLogoTargets("ZUR", pm009.MAX_PARTICLES).length, pm009.MAX_PARTICLES * 4);
});

test("ZUR-GH-009 logo glyph targets wrap with % sampledPoints.length (guards 256k + logo-attractor)", () => {
  const src = read("src/render/LogoAttractor.js");
  assert.match(src, /sampledPoints\[i % sampledPoints\.length\]/);
  assert.match(src, /: \[\[0\.5, 0\.5\]\]/, "empty sample set guard");
  const t = sampleLogoTargets("A", 262144);
  for (let i = 0; i < t.length; i += 1) assert.ok(Number.isFinite(t[i]));
});

test("ZUR-GH-009 cameraZoom: 0.35..3.50, default 1.00, step 0.05, HUD slider", () => {
  assert.deepEqual([...pm009.CAMERA_ZOOM_RANGE], [0.35, 3.5]);
  assert.equal(pm009.CAMERA_ZOOM_STEP, 0.05);
  assert.equal(DEFAULT_PARTICLES.cameraZoom, 1.0);
  assert.equal(normalizeParticles({ cameraZoom: 9 }).cameraZoom, 3.5);
  assert.equal(normalizeParticles({ cameraZoom: 0 }).cameraZoom, 0.35);
  assert.match(g009.hud(), /"rng-camera-zoom", "Camera Zoom"/);
  const bad = structuredClone(STAGE2_DEFAULT_PRESET);
  bad.particles.cameraZoom = 4;
  assert.equal(validatePreset(bad).ok, false);
});

test("ZUR-GH-009 touch-action none ONLY on the canvas, pan-y on the HUD (Audit Fix 4)", () => {
  const html = read("index.html");
  assert.match(html, /#gl-canvas, #stage \{ touch-action: none; \}/);
  assert.match(html, /\.hud, \.control-hud \{ touch-action: pan-y; \}/);
  assert.equal((html.match(/touch-action: none/g) || []).length, 1);
});

test("ZUR-GH-009 pinch / wheel / double-tap handlers act only on the canvas", () => {
  const main = read("src/app/main.js");
  assert.match(main, /canvas\.addEventListener\("pointerdown"/);
  assert.match(main, /canvas\.addEventListener\("wheel"[\s\S]*?\{ passive: false \}/);
  assert.equal((main.match(/event\.target !== canvas/g) || []).length >= 5, true);
  assert.match(main, /pinchZoom\(pinch\.startZoom, pinch\.startDist/);
  assert.match(main, /updateParticles\(\{ cameraZoom: 1 \}\)/);
  assert.equal(pm009.pinchZoom(1, 100, 200), 2);
  assert.equal(pm009.pinchZoom(1, 100, 1), 0.35);
  assert.equal(pm009.pinchZoom(2, 100, 400), 3.5);
});

test("ZUR-GH-009 u_cameraZoom in render.vert and core.frag, wired through ParticleSystem3D", () => {
  assert.match(g009.vert(), /uniform float u_cameraZoom;/);
  assert.match(g009.vert(), /gl_Position\.xy \*= u_cameraZoom/);
  assert.match(g009.core(), /uniform float u_cameraZoom;/);
  assert.match(g009.core(), /0\.72 \/ max\(u_cameraZoom/);
  assert.match(g009.ps(), /gl\.uniform1f\(R\.u_cameraZoom, zoom\)/);
  assert.match(g009.ps(), /gl\.uniform1f\(C\.u_cameraZoom, zoom\)/);
});

test("ZUR-GH-013 particleStyle options: crisp-dot first, no orb / blood-drop anywhere (state, HUD, shaders)", () => {
  assert.deepEqual([...pm009.PARTICLE_STYLES], ["crisp-dot", "dart3d", "synapse-node", "star-streak"]);
  assert.equal(DEFAULT_PARTICLES.particleStyle, "crisp-dot");
  assert.equal(pm009.PARTICLE_STYLE_LABELS["crisp-dot"], "Crisp Dot — Pinpoint");
  assert.equal(normalizeParticles({ particleStyle: "orb" }).particleStyle, "crisp-dot");
  assert.equal(normalizeParticles({ particleStyle: "blood-drop" }).particleStyle, "crisp-dot");
  assert.equal(normalizeParticles({ particleStyle: "synapse-spark" }).particleStyle, "synapse-node");
  for (const f of ["src/controls/ControlHUD.js", "src/shaders/render.vert.glsl", "src/shaders/render.frag.glsl", "src/shaders/sim.vert.glsl"]) {
    assert.doesNotMatch(stripComments(read(f)), /"orb"|\borb\b|blood-drop/i, f);
  }
  assert.doesNotMatch(JSON.stringify(pm009.PARTICLE_STYLE_LABELS), /orb|blood/i);
  assert.match(g009.frag(), /uniform int u_particleStyle;/);
  assert.match(g009.vert(), /uniform int u_particleStyle;/);
});

test("ZUR-GH-013 particle style shading: crisp-dot pinpoint, star-streak stretch, synapse-node soma + 15% sparks, dart 0.55x", () => {
  const f = g009.frag();
  const v = g009.vert();
  assert.match(f, /float exposure = clamp\(pow\(16384\.0 \/ max\(float\(u_activeCount\), 1\.0\), 0\.52\), 0\.16, 1\.0\);/);
  assert.match(f, /float head = r2 < 1\.0 \? exp\(-r2 \* 16\.0\) : 0\.0;/, "exp(-r2*16) core, hard cutoff at r = 1");
  assert.match(f, /float conserve = 1\.0 \/ \(1\.0 \+ 0\.35 \* \(stretch - 1\.0\)\);/, "energy-conserving streak");
  assert.match(v, /stretch = 1\.0 \+ clamp\(length\(vScreen\) \* \(16\.0 \+ 45\.0 \* u_bass \+ 60\.0 \* u_onset\), 0\.0, 18\.0\);/);
  assert.match(v, /float stretch = 1\.0;/, "crisp head at rest");
  assert.match(v, /const float DART_SCALE = 0\.55;/);
  assert.match(v, /const float SYNAPSE_SPARK_FRACTION = 0\.15;/);
  assert.match(f, /u_onset \* 1\.6 \+ u_highMid \* 1\.4/, "axon sparks gated by onset / highMid");
  assert.doesNotMatch(f, /sin\(atan\(uv\.y, uv\.x\) \* 7\.0/, "no asterisk soma");
  assert.match(f, /vec3\(0\.7454, 1\.0, 1\.0\)/, "#E0FFFF in linear light");
  assert.equal(pm009.crispDotCore(0), 1);
  assert.equal(pm009.crispDotCore(1), 0, "hard cutoff at r = 1");
  assert.ok(Math.abs(pm009.crispDotCore(0.5) - Math.exp(-0.25 * 16)) < 1e-12);
  assert.ok(Math.abs(pm009.crispDotExposure(262144) - Math.max(0.16, Math.min(1, (16384 / 262144) ** 0.52))) < 1e-12);
  assert.equal(pm009.crispDotExposure(16384), 1);
  assert.equal(pm009.starStreakStretch(0, 1, 1), 1, "at rest the streak is a crisp dot");
  assert.equal(pm009.starStreakStretch(10, 1, 1), 19, "clamped to 1 + 18");
  assert.ok(pm009.starStreakConserve(19) < 0.15 && pm009.starStreakConserve(1) === 1);
});

test("ZUR-GH-013 colorPalette options + u_colorPalette in render.frag, core.frag and kaleido (crimson-pulse replaces blood-red)", () => {
  assert.deepEqual([...pm009.COLOR_PALETTES], ["true-neon", "full-spectrum", "white-static", "crimson-pulse", "golden-cortex"]);
  assert.equal(normalizeParticles({ colorPalette: "blood-red" }).colorPalette, "crimson-pulse");
  assert.equal(DEFAULT_PARTICLES.colorPalette, "true-neon");
  assert.match(g009.frag(), /uniform int u_colorPalette;/);
  assert.match(g009.core(), /uniform int u_colorPalette;/);
  assert.match(stripComments(read("src/shaders/kaleido.frag.glsl")), /uniform int u_colorPalette;/);
  assert.match(g009.frag(), /step\(0\.35, fract\(sin\(dot\(gl_FragCoord\.xy, vec2\(12\.9898, 78\.233\)\) \+ u_time \* 43\.0\) \* 43758\.5453\)\) \* u_treble/);
  assert.match(g009.frag(), /energyNorm/);
  assert.match(g009.ps(), /gl\.uniform1i\(R\.u_colorPalette, paletteIndex\)/);
  assert.ok(pm009.hsvSaturation([0, 0.9131, 1.0]) >= 0.85 && pm009.hsvSaturation([1.0, 0.0, 0.2122]) >= 0.85);
});

test("ZUR-GH-009/013 formations after logo-attractor (brain, galaxy, black hole, wormhole, ferrofluid) in state and sim.vert", () => {
  const ids = ["neural-brain", "living-galaxy", "supermassive-blackhole", "wormhole", "harmonic-ferrofluid"];
  assert.deepEqual(FORMATION_TYPES.slice(6), ids);
  assert.equal(FORMATION_TYPES.indexOf("logo-attractor"), 5);
  assert.deepEqual(ids.map((id) => pm009.FORMATION_LABELS[id]), [
    "Anatomical 3D Brain", "Living Spiral Galaxy", "Supermassive Black Hole (Gargantua)",
    "Spherical Wormhole — Funnel in Sphere", "Harmonic Ferrofluid Rings",
  ]);
  const sim = g009.sim();
  for (let i = 6; i <= 10; i += 1) assert.match(sim, new RegExp(`u_formationType == ${i}`));
  assert.match(sim, /float spiral = log\(rd \/ BH_DISK_INNER\)/);
  assert.match(sim, /vec3 wormholeTarget\(/);
});

test("ZUR-GH-013 neural-brain v_neuralPulse is audio-only (no 0.45 baseline; thalamic idle only in ambient-vj)", () => {
  assert.match(g009.vert(), /out float v_neuralPulse;/);
  assert.match(g009.frag(), /in float v_neuralPulse;/);
  assert.match(g009.vert(), /float audioDrive = clamp\(u_bands\[0\] \* 0\.5 \+ u_bass \* 0\.8 \+ u_onset \* 1\.3 \+ u_treble \* 0\.6, 0\.0, 1\.5\);/);
  assert.doesNotMatch(g009.vert(), /0\.45 \+ u_treble/, "no idle 0.45 baseline");
  const vert = g009.vert();
  const thal = vert.indexOf("float thalamic");
  assert.ok(thal > 0 && vert.slice(Math.max(0, thal - 200), thal).includes("u_reactivityMode == 2"), "thalamic rhythm only in ambient-vj");
  assert.equal(pm009.neuralPulse(0.5, 0.3, 0, 0, 0, 0), 0, "silence -> no firing wave");
  assert.equal(pm009.neuralAudioDrive(0, 0, 0, 0), 0);
  assert.ok(pm009.neuralAudioDrive(0.5, 0.5, 0.5, 0.5) > 0);
});

test("ZUR-GH-013 kineticMode options (splatter-run removed), default off, u_kineticMode in sim.vert, HUD row above Oscillation", () => {
  assert.deepEqual([...pm009.KINETIC_MODES], ["off", "synapse-cascade", "accretion-warp", "ribbon-curtain", "shock-shatter"]);
  assert.equal(DEFAULT_PARTICLES.kineticMode, "off");
  assert.equal(normalizeParticles({ kineticMode: "splatter-run" }).kineticMode, "off");
  const sim = g009.sim();
  assert.match(sim, /uniform int u_kineticMode;/);
  for (let mode = 1; mode <= 4; mode += 1) assert.match(sim, new RegExp(`u_kineticMode == ${mode}`));
  assert.doesNotMatch(sim, /u_kineticMode == 5/);
  const hud = g009.hud();
  assert.ok(hud.indexOf('"sel-kinetic-mode"') > 0 && hud.indexOf('"sel-kinetic-mode"') < hud.indexOf('"sel-oscillation"'));
  const layout = read("src/controls/hudTabs.js");
  assert.ok(layout.indexOf('["kinetic", "Kinetic Mode"]') < layout.indexOf('["oscillation", "Oscillation"]'));
});

test("ZUR-GH-009 Reactivity Punch: gain 0.5..5.0 default 2.5, noise gate default 0.015 (0..0.100)", () => {
  assert.deepEqual([...pm009.REACTIVITY_GAIN_RANGE], [0.5, 5]);
  assert.equal(DEFAULT_PARTICLES.reactivityGain, 2.5);
  assert.match(g009.hud(), /"rng-reactivity", "Reactivity Punch"/);
  assert.match(g009.sim(), /uniform float u_reactivityGain;/);
  assert.match(g009.vert(), /uniform float u_reactivityGain;/);
  assert.equal(pm009.NOISE_GATE_DEFAULT, 0.015);
  assert.deepEqual([...pm009.NOISE_GATE_RANGE], [0, 0.1]);
  assert.equal(MODE_A_PRESET.audio.noiseGateThreshold, 0.015);
  assert.match(read("src/audio/FeatureExtractor.js"), /noiseGateThreshold = 0\.015/);
  const old = structuredClone(MODE_A_PRESET);
  old.audio.noiseGateThreshold = 0.2;
  const loaded = loadStoredState(mockStorage({ zur_state_v4_0: JSON.stringify({ storageSchema: 4.0, preset: old }) }));
  assert.equal(loaded.preset.audio.noiseGateThreshold, 0.015);
});

test("ZUR-GH-009 reactivity applies at oscillationAmount 0: radial kick, onset impulse, point-size pulse", () => {
  assert.match(g009.sim(), /1\.0 \+ 0\.28 \* u_reactivityGain \* \(u_sub \* 0\.65 \+ u_bass \* 0\.35\)/);
  assert.match(g009.sim(), /u_onset \* 2\.2 \* u_reactivityGain/);
  assert.match(g009.vert(), /1\.0 \+ 0\.45 \* u_reactivityGain \* \(u_bass \* 0\.5 \+ u_onset \* 0\.5\)/);
  assert.ok(Math.abs(pm009.radialKick(2.5, 1, 1) - (1 + 0.28 * 2.5)) < 1e-12);
  assert.equal(pm009.radialKick(2.5, 0, 0), 1);
  assert.ok(Math.abs(pm009.onsetImpulse(1, 2.5) - 5.5) < 1e-12);
  assert.ok(Math.abs(pm009.pointSizePulse(2.5, 1, 1) - (1 + 0.45 * 2.5)) < 1e-12);
});

test("ZUR-GH-009 HUD has no Visual Preset / Audio Profile rows and ships the new controls", () => {
  const hud = g009.hud();
  assert.doesNotMatch(hud, /Visual Preset|Audio Profile|presetId|audioProfile/);
  for (const id of ["sel-particle-style", "sel-palette", "sel-kinetic-mode", "rng-camera-zoom", "rng-reactivity"]) {
    assert.match(hud, new RegExp(`"${id}"`));
  }
});

test("ZUR-GH-009 smoke script covers 256k stability, scenarios and audio-reactivity delta", () => {
  const smoke = read("tests/smoke-zur-gh-009.mjs");
  assert.match(smoke, /256k/);
  assert.match(smoke, /blackRatio < 0\.85/);
  assert.match(smoke, /whiteClip < 0\.01/);
  assert.match(smoke, /crimson-pulse/, "ZUR-GH-013: the blood scenario became crimson-pulse");
  assert.doesNotMatch(smoke, /"blood-red"|"synapse-spark"|data-hud-tab/);
  assert.match(smoke, /wormhole/);
  assert.match(smoke, /rng-osc-amount", 0/);
  assert.match(read("package.json"), /smoke:gh009/);
});


let failed = 0;

// ---------------- ZUR-GH-010 Stage 5.1 contracts ----------------
const gh010 = await import("../src/app/AppState.js");
const gh010Tabs = await import("../src/controls/hudTabs.js");
const gh010Math = await import("../src/render/particleMath.js");

test("ZUR-GH-013 unlocked deck: no HUD tabs, no enforceTabConstraints, every control row always laid out", () => {
  for (const gone of ["HUD_TABS", "enforceTabConstraints", "switchHudTab", "switchPresetTab", "sceneForHud", "VISUAL_HUD_TABS", "DEFAULT_HUD"]) {
    assert.equal(gone in gh010, false, `${gone} removed from AppState`);
  }
  assert.doesNotMatch(stripComments(read("src/app/main.js")) + stripComments(read("src/controls/ControlHUD.js")), /enforceTabConstraints|\bhudTab\b/);
  const rows = gh010Tabs.DECK_LAYOUT.map(([name]) => name);
  assert.deepEqual(rows.slice(0, 4), ["formation", "style", "palette", "reactivityMode"], "Formation, Particle Style, Palette, Reactivity Mode lead the deck");
  for (const name of ["kinetic", "count", "size", "zoom", "trailType", "trailLength", "oscillation", "logoText", "pulseLayout", "kaleido", "scenePalette"]) assert.ok(rows.includes(name), name);
  assert.equal(new Set(rows).size, rows.length, "no duplicate rows");
  assert.deepEqual(gh010Tabs.optionsFor("style").map((o) => o.value), ["crisp-dot", "dart3d", "synapse-node", "star-streak"], "full style list, never narrowed");
  assert.deepEqual(gh010Tabs.optionsFor("formation").map((o) => o.value), [...FORMATION_TYPES], "every formation selectable");
  assert.deepEqual(gh010Tabs.optionsFor("reactivityMode").map((o) => o.value), ["true-gate", "ember-floor", "ambient-vj"]);
});

test("ZUR-GH-013 Quick Presets strip + Engine Selector: ids, labels, scene routing, never touch particleStyle", () => {
  assert.deepEqual(gh010.QUICK_PRESETS.map((q) => q.label), ["Wormhole", "3D Brain", "Gargantua", "Ferrofluid Rings", "Spiral Galaxy", "Logo Text", "Megastructure", "Spectral Canyon"]);
  assert.deepEqual(gh010.ENGINES.map((e) => e.label), ["3D Particle Engine", "Megastructure", "Spectral Canyon", "3D Pulse Field", "Aurora Ribbons"]);
  assert.deepEqual(gh010.ENGINES.map((e) => e.sceneId), ["particle-swarm-3d", "megastructure-3d", "spectral-canyon-3d", "pulse-field-3d", "aurora-ribbons"]);
  for (const style of ["crisp-dot", "dart3d", "synapse-node", "star-streak"]) {
    let preset = structuredClone(gh010.STAGE2_DEFAULT_PRESET);
    preset.particles.particleStyle = style;
    for (const q of gh010.QUICK_PRESET_IDS) {
      preset = gh010.applyQuickPreset(preset, q);
      assert.equal(preset.particles.particleStyle, style, `quick preset ${q} keeps ${style}`);
      assert.equal(validatePreset(preset).ok, true, q);
    }
    for (const e of gh010.ENGINE_IDS) {
      preset = gh010.applyEngine(preset, e);
      assert.equal(preset.particles.particleStyle, style, `engine ${e} keeps ${style}`);
      assert.equal(preset.sceneId, gh010.sceneForEngine(e));
    }
  }
  assert.equal(gh010.applyQuickPreset(gh010.STAGE2_DEFAULT_PRESET, "brain").particles.formationType, "neural-brain");
  assert.equal(gh010.applyQuickPreset(gh010.STAGE2_DEFAULT_PRESET, "ferrofluid").particles.formationType, "harmonic-ferrofluid");
  assert.equal(gh010.applyQuickPreset(gh010.STAGE2_DEFAULT_PRESET, "canyon").sceneId, "spectral-canyon-3d");
  for (const q of gh010.QUICK_PRESETS) assert.equal("particleStyle" in (q.particles || {}), false, `${q.id} has no style override`);
  const hud = read("src/controls/ControlHUD.js");
  assert.match(hud, /this\.quickBar\.id = "hud-quick-presets"/);
  assert.match(hud, /this\.engineBar\.id = "hud-engines"/);
  assert.match(hud, /button\.dataset\.quickPreset = entry\.id/);
  assert.match(hud, /button\.dataset\.engine = engine\.id/);
});

test("ZUR-GH-013 palette / formation / reactivity changes never reset particleStyle (AppState + autopilot)", () => {
  const state = new AppState(gh010.STAGE2_DEFAULT_PRESET);
  state.updatePreset((draft) => { draft.particles = normalizeParticles({ ...draft.particles, particleStyle: "star-streak" }); });
  for (const formationType of FORMATION_TYPES) {
    state.updatePreset((draft) => { draft.particles = normalizeParticles({ ...draft.particles, formationType }); });
    assert.equal(state.preset.particles.particleStyle, "star-streak", formationType);
  }
  for (const colorPalette of pm009.COLOR_PALETTES) {
    state.updatePreset((draft) => { draft.particles = normalizeParticles({ ...draft.particles, colorPalette }); });
    assert.equal(state.preset.particles.particleStyle, "star-streak", colorPalette);
  }
  for (const reactivityMode of pm009.REACTIVITY_MODES) {
    state.updatePreset((draft) => { draft.particles = normalizeParticles({ ...draft.particles, reactivityMode }); });
    assert.equal(state.preset.particles.particleStyle, "star-streak", reactivityMode);
  }
  assert.doesNotMatch(stripComments(read("src/app/VJAutopilot.js")), /particleStyle/, "autopilot never touches style");
});

test("ZUR-GH-010/013 zero blank <option> across every static option list (unlocked deck)", () => {
  const lists = gh010Tabs.allStaticOptionLists();
  assert.equal(lists.length, 14, "every deck select (formation, flow, style, kinetic, palette, reactivityMode, scenePalette, ...)");
  for (const { key, control, options } of lists) {
    assert.ok(options.length > 0, `${key}/${control} empty`);
    for (const o of gh010Tabs.normalizeOptions(options)) {
      assert.ok(o.value.trim().length > 0 && o.label.trim().length > 0, `${key}/${control} blank option`);
    }
  }
  assert.deepEqual(gh010Tabs.normalizeOption(""), { value: "default", label: "Default" });
  assert.deepEqual(gh010Tabs.normalizeOption({ value: "x", name: "X" }), { value: "x", label: "X" });
  assert.match(read("src/controls/ControlHUD.js"), /fillSelect\(/);
});

test("ZUR-GH-010/013 dark-mode select CSS, sticky quick-preset strip, no particleShape / duplicate palette row", () => {
  const html = read("index.html");
  assert.match(html, /\.control-hud select, \.control-hud option \{ color-scheme: dark; background-color: #121624; color: #f0f4ff; \}/);
  const hud = read("src/controls/ControlHUD.js");
  assert.ok(!/"sel-shape"/.test(hud) && !/3D shape/.test(hud), "no 3D shape row");
  assert.equal((hud.match(/"sel-palette"/g) || []).length, 1, "single particle palette select");
  assert.equal((hud.match(/"sel-scene-palette"/g) || []).length, 1, "single scene palette select");
  assert.doesNotMatch(hud + read("src/controls/hudTabs.js"), /data-hud-tab|dataset\.hudTab/);
});

test("ZUR-GH-011 golden-cortex palette: index 4, 80% gold soma alpha 0.52 x1.85, cyan-white pulse > 0.55 x3.2", () => {
  assert.equal(gh010Math.GOLDEN_CORTEX_SOMA_ALPHA, 0.52);
  assert.equal(gh010Math.GOLDEN_CORTEX_SOMA_RADIANCE, 1.85);
  assert.equal(gh010Math.GOLDEN_CORTEX_PULSE_BOOST, 3.2);
  const fg = frag32();
  assert.match(fg, /const float CORTEX_SOMA_ALPHA = 0\.52;/);
  assert.match(fg, /const float CORTEX_SOMA_RADIANCE = 1\.85;/);
  assert.match(fg, /const float CORTEX_PULSE_BOOST = 3\.2;/);
  assert.match(fg, /cortexFiring \? CORTEX_PULSE_BOOST : 1\.0/);
  assert.match(fg, /if \(cortexSoma\) lum \*= CORTEX_SOMA_ALPHA/);
  assert.match(fg, /mix\(vec3\(1\.0, 0\.6795, 0\.0\), vec3\(1\.0, 0\.3916, 0\.0\), 0\.5 \+ 0\.5 \* cos\(TAU \* t\)\) \* CORTEX_SOMA_RADIANCE/, "#FFD700 -> #FFA800 smooth gold gradient x1.85");
  assert.ok(gh010Tabs.optionsFor("palette").map((o) => o.value).includes("golden-cortex"));
  assert.equal(gh010Math.GOLDEN_CORTEX_SOMA_FRACTION, 0.8);
  assert.equal(gh010Math.GOLDEN_CORTEX_PULSE_THRESHOLD, 0.55);
  assert.match(fg, /u_formationType == 6 && v_neuralPulse > 0\.55/);
  assert.match(stripComments(read("src/shaders/render.vert.glsl")), /uniform int u_colorPalette;/);
});

test("ZUR-GH-010 multi-hue spatial palettes: hue driven by position/hash, not a global u_time wash", () => {
  const v = stripComments(read("src/shaders/render.vert.glsl")) + stripComments(read("src/shaders/render.frag.glsl"));
  assert.match(v, /v_seed|a_pos|hash/);
  assert.match(read("tests/smoke-zur-gh-010.mjs"), /hueSectorCount/);
});

test("ZUR-GH-010 draw path: dart3d TRIANGLES x12, other styles TRIANGLE_STRIP x4", () => {
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /if \(dart && dartVerts === 12\) gl\.drawArraysInstanced\(gl\.TRIANGLES, 0, 12, count\);/);
  assert.match(ps, /else gl\.drawArraysInstanced\(gl\.TRIANGLE_STRIP, 0, 4, count\);/);
});

test("ZUR-GH-010 crowdNorm to 262144 + zoom damp + 14 px sprite ceiling (blood 28 px ceiling removed)", () => {
  assert.match(frag32(), /clamp\(pow\(65536\.0 \/ max\(float\(u_activeCount\), 65536\.0\), 0\.58\), 0\.28, 1\.0\)/);
  assert.equal(gh010Math.densityCrowdNorm(65536), 1);
  assert.ok(Math.abs(gh010Math.densityCrowdNorm(262144) - Math.max(0.28, Math.pow(0.25, 0.58))) < 1e-9);
  const vert = stripComments(read("src/shaders/render.vert.glsl"));
  assert.match(vert, /1\.0 \/ pow\(u_cameraZoom, 0\.35\)/);
  assert.match(vert, /min\(worldSize \* pxPerUnit \* zoomDamp, 14\.0\)/);
  assert.doesNotMatch(vert, /28\.0|bloodStyle/);
  assert.equal(gh010Math.zoomSpriteDamp(1), 1);
  assert.ok(Math.abs(gh010Math.zoomSpriteDamp(3.5) - 1 / Math.pow(3.5, 0.35)) < 1e-9);
  assert.ok(gh010Math.spriteRadiusPx(500, 1) <= 14);
});

test("ZUR-GH-010 formation confinement: tether >= 4.2 and curl <= 0.18 * radius for u_formation >= 6", () => {
  const sim = sim32();
  assert.match(sim, /const float FORMATION_TETHER_MIN = 4\.2;/);
  assert.match(sim, /const float FORMATION_CURL_CAP = 0\.18;/);
  assert.match(sim, /if \(u_formationType >= 6\) pull = max\(pull, FORMATION_TETHER_MIN\);/);
  assert.ok(gh010Math.formationTether(6, 1) >= 4.2 && gh010Math.formationTether(9, 0.5) >= 4.2);
  assert.ok(gh010Math.formationTether(3, 1) < 4.2);
  assert.ok(Math.abs(gh010Math.formationCurlCap(2) - 0.36) < 1e-9);
});

test("ZUR-GH-010 Gargantua: formation 8, r<0.24 void, 14 deg disk 60%, Einstein ring 28%, jets 12%", () => {
  const sim = sim32();
  assert.equal(gh010Math.FORMATION_TYPES.indexOf("supermassive-blackhole"), 8);
  assert.match(sim, /if \(u_formationType == 8\) return blackHoleTarget\(seed, uid\);/);
  assert.match(sim, /BH_DISK_FRAC = 0\.60/);
  assert.match(sim, /BH_RING_FRAC = 0\.28/);
  assert.match(sim, /BH_HORIZON = 0\.24/);
  assert.match(sim, /BH_TILT = 0\.2443461/);
  assert.ok(Math.abs(0.2443461 - 14 * Math.PI / 180) < 1e-6);
  assert.equal(gh010Math.BH_DISK_FRACTION + gh010Math.BH_RING_FRACTION + gh010Math.BH_JET_FRACTION, 1);
  assert.equal(gh010Math.blackHoleKind(0.1), "disk");
  assert.equal(gh010Math.blackHoleKind(0.7), "ring");
  assert.equal(gh010Math.blackHoleKind(0.95), "jet");
  assert.ok(gh010Math.insideBlackHoleVoid([0.1, 0.1, 0.1]));
});

test("ZUR-GH-010 smoke:gh010 script wired with 412x915, BH void and 256k density gates", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["smoke:gh010"], "node tests/smoke-zur-gh-010.mjs");
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /412/);
  assert.match(smoke, /915/);
  assert.match(smoke, /262144|256k/);
  assert.match(smoke, /blackRatio/);
  assert.match(smoke, /whiteClip/);
});

// ---------------- ZUR-GH-011 (zur-shell-v9 / zur_state_v5_2) contracts ----------------

/** Minimal in-memory DOM: enough of the element API for ControlHUD, and it counts every node re-insertion. */
function makeFakeDom() {
  const stats = { moves: 0 };
  const doc = { activeElement: null };
  class FakeNode {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = {};
      this.dataset = {};
      this.listeners = {};
      this.style = { setProperty() {} };
      this.className = "";
      this.hidden = false;
      this.scrollTop = 0;
      this._text = "";
      const cls = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (c, force) => { const on = force === undefined ? !cls.has(c) : Boolean(force); if (on) cls.add(c); else cls.delete(c); return on; },
        contains: (c) => cls.has(c),
      };
    }
    append(...nodes) {
      for (const n of nodes) {
        if (n.parentNode) {
          stats.moves += 1;
          n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1);
        }
        n.parentNode = this;
        this.children.push(n);
      }
    }
    replaceChildren(...nodes) {
      for (const c of this.children) c.parentNode = null;
      this.children = [];
      this._selected = undefined;
      this.append(...nodes);
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn({ type, target: this }); }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); this.children = []; }
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      for (const c of this.children) {
        if (c.className.split(" ").includes(cls)) return c;
        const deep = c.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    }
    closest() { return null; }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) { doc.activeElement = null; this.dispatch("blur"); } }
    get options() { return this.children.filter((c) => c.tagName === "OPTION"); }
    get value() {
      if (this.tagName !== "SELECT") return this._value ?? "";
      const opts = this.options;
      const i = this._selected ?? 0;
      return i >= 0 && opts[i] ? opts[i].value : "";
    }
    set value(v) {
      if (this.tagName !== "SELECT") { this._value = String(v); return; }
      this._selected = this.options.findIndex((o) => o.value === String(v));
    }
  }
  doc.createElement = (tag) => new FakeNode(tag);
  return { doc, stats, FakeNode };
}

test("ZUR-GH-011 DOM node identity gate: 10 slider inputs + AppState/status updates never recreate or move HUD nodes", async () => {
  const { doc, stats, FakeNode } = makeFakeDom();
  const windowListeners = {};
  const hadDocument = "document" in globalThis;
  const previousDocument = globalThis.document;
  const previousAdd = globalThis.addEventListener;
  globalThis.document = doc;
  globalThis.addEventListener = (type, fn) => { (windowListeners[type] ||= []).push(fn); };
  try {
    const { ControlHUD } = await import("../src/controls/ControlHUD.js");
    const state = new gh010.AppState(gh010.STAGE2_DEFAULT_PRESET);
    const hud = new ControlHUD(new FakeNode("div"), state);
    hud.setHandlers({
      particles: (partial) => state.updatePreset((draft) => { draft.particles = normalizeParticles({ ...draft.particles, ...partial }); }),
    });
    assert.equal(state.preset.hud, undefined, "v6.0 presets carry no hud tab state");
    assert.equal(state.preset.deck.quickPreset, "wormhole");
    const zoom = hud.controls.zoom.input;
    const reactivity = hud.controls.reactivity.input;
    const palette = hud.controls.palette.select;
    const formation = hud.controls.formation.select;
    const formationOptions = [...formation.options];
    hud.panel.scrollTop = 240;
    const movesBefore = stats.moves;
    for (let i = 0; i < 10; i += 1) {
      zoom.value = String(1 + i * 0.2);
      zoom.dispatch("input");
      state.setStatus({ fps: 50 + i, wakeLock: i % 2 ? "active" : "released" });
      state.updatePreset((draft) => { draft.visual.gain = 1 + i * 0.1; });
      assert.equal(hud.controls.zoom.input, zoom, `range node identical after input ${i}`);
      assert.equal(hud.controls.reactivity.input, reactivity);
      assert.equal(hud.controls.palette.select, palette, `select node identical after update ${i}`);
      assert.equal(hud.controls.formation.select, formation);
    }
    assert.deepEqual([...formation.options], formationOptions, "<option> nodes never rebuilt within a tab");
    assert.equal(stats.moves, movesBefore, "no row was removed / re-inserted within the same layout key");
    assert.equal(hud.panel.scrollTop, 240, ".control-hud scrollTop never reset");
    assert.ok(Math.abs(state.preset.particles.cameraZoom - 2.8) < 1e-9, "slider still drives state");

    // Focused <select> is never overwritten (Android picker stays open); blur reconciles it.
    palette.focus();
    const shownBefore = palette.value;
    state.updatePreset((draft) => { draft.particles.colorPalette = "full-spectrum"; });
    assert.equal(palette.value, shownBefore, "focused select untouched");
    palette.blur();
    assert.equal(palette.value, "full-spectrum", "blur re-syncs the select");

    // Slider under an active drag is guarded; pointerup releases and re-syncs.
    zoom.dispatch("pointerdown");
    const dragValue = zoom.value;
    state.updatePreset((draft) => { draft.particles.cameraZoom = 1.5; });
    assert.equal(zoom.value, dragValue, "dragged slider untouched by external state");
    for (const fn of windowListeners.pointerup || []) fn({ type: "pointerup" });
    assert.equal(Number(zoom.value), 1.5, "pointerup re-syncs the slider");

    // ZUR-GH-013: Quick Presets / Engine changes are value changes on the single unlocked deck, never a re-layout.
    state.replacePreset(gh010.applyQuickPreset(state.preset, "brain"));
    state.replacePreset(gh010.applyEngine(state.preset, "canyon"));
    assert.equal(stats.moves, movesBefore, "quick preset + engine switch never move rows");
    assert.equal(hud._layoutKey, "deck");
    assert.equal(hud.controls.formation.select, formation);
    // Sanity: the gate is not vacuous; a genuinely new layout key does re-order rows, and keeps scrollTop.
    hud._applyLayout("probe", gh010Tabs.DECK_LAYOUT);
    assert.ok(stats.moves > movesBefore, "a new layout key re-orders rows");
    assert.equal(hud.panel.scrollTop, 240);
  } finally {
    if (hadDocument) globalThis.document = previousDocument; else delete globalThis.document;
    if (previousAdd) globalThis.addEventListener = previousAdd; else delete globalThis.addEventListener;
  }
});

test("ZUR-GH-011/013 HUD source: status emits only touch pills; single 'deck' layout key; focus / drag guards", () => {
  const hud = read("src/controls/ControlHUD.js");
  assert.match(hud, /type === "status" \? this\.syncStatus\(\) : this\.sync\(\)/);
  assert.match(hud, /this\._applyLayout\("deck", DECK_LAYOUT\)/);
  assert.match(hud, /document\.activeElement !== select/);
  assert.match(hud, /control\.input === this\._dragInput/);
  assert.doesNotMatch(hud, /innerHTML/);
  assert.equal((hud.match(/replaceChildren\(/g) || []).length, 1, "only _build() clears the root");
});

test("ZUR-GH-011/013 sticky header: Hide HUD + Quick Presets strip share one solid z-20 sticky container", () => {
  const html = read("index.html");
  assert.match(html, /\.hud-sticky \{\s*position: sticky; top: -12px; z-index: 20;[^}]*background: rgba\(10, 14, 24, 0\.98\)/);
  assert.match(html, /\.hud-sticky \.hud-hide \{ position: static;/);
  assert.match(html, /\.hud\.is-collapsed \.hud-tabs \{ display: none; \}/);
  const hud = read("src/controls/ControlHUD.js");
  assert.match(hud, /this\.stickyHeader\.append\(this\.hideButton\)/);
  assert.match(hud, /this\.stickyHeader\.append\(this\.quickBar\)/);
  assert.match(hud, /this\.body\.append\(this\.engineBar\)/);
  assert.doesNotMatch(hud, /this\.tabBar/);
});

test("ZUR-GH-013 thalamic idle rhythm survives only in ambient-vj; true-gate brain is dark in silence", () => {
  const vert = stripComments(read("src/shaders/render.vert.glsl"));
  assert.match(vert, /if \(u_formationType == 6\) \{/);
  assert.match(vert, /float thalamic = sin\(length\(center\) \* 6\.0 - u_time \* 3\.8 \+ seed \* 1\.7\);/);
  assert.match(vert, /v_neuralPulse = max\(v_neuralPulse, smoothstep\(0\.55, 0\.95, thalamic\) \* 0\.78\);/);
  let audioIdleMax = 0;
  let thalamicMax = 0;
  for (let r = 0; r <= 1.5; r += 0.01) {
    for (let t = 0; t < 2; t += 0.05) {
      audioIdleMax = Math.max(audioIdleMax, gh010Math.neuralPulse(r, t, 0, 0, 0, 0));
      thalamicMax = Math.max(thalamicMax, gh010Math.thalamicPulse(r, t, 0.3));
    }
  }
  assert.equal(audioIdleMax, 0, "no audio -> no firing wave at all (true silence)");
  assert.ok(thalamicMax > gh010Math.GOLDEN_CORTEX_PULSE_THRESHOLD, "ambient-vj thalamic baseline still crosses the firing threshold");
  assert.equal(pm009.reactivityEmission("true-gate", 0), 0);
  assert.equal(pm009.reactivityEmission("ember-floor", 0), 0.06);
  assert.equal(pm009.reactivityEmission("ambient-vj", 0), 1);
});

test("ZUR-GH-011/013 smoke:gh010 carries node-identity, style-persistence, reactivity and brain-luminance gates", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /nodeIdentity/);
  assert.match(smoke, /stylePersistence/);
  assert.match(smoke, /brainLuma/);
  assert.match(smoke, /activeMeanLuma >= 0\.22/);
  assert.doesNotMatch(smoke, /bloodDefault|blood-swarm"\]|goTab\(/);
});

test("ZUR-GH-012 smoke passes Linux container flags only on linux", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /process\.platform === "linux"/);
  for (const flag of ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"]) {
    assert.ok(smoke.includes(`"${flag}"`), flag);
  }
  assert.ok(smoke.includes('(process.env.ZUR_ANGLE || "swiftshader") === "swiftshader"'));
  assert.match(smoke, /--use-angle=/);
});

test("ZUR-GH-012 smoke detects software renderer", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /UNMASKED_RENDERER_WEBGL/);
  assert.ok(smoke.includes("/SwiftShader|llvmpipe/i"));
});

test("ZUR-GH-012 software warmup scaling", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /SW_WARMUP_FRAMES = Math\.min\(6, Math\.max\(4,[^\n]*ZUR_SW_WARMUP \|\| 5/);
  assert.match(smoke, /HW_MIN_WARMUP_FRAMES = 30/);
  for (const ms of ["4500", "7000", "5000"]) assert.match(smoke, new RegExp(`sleep\\(${ms}\\)|measure\\([^\\n]*, ${ms}[,)]`));
});

test("ZUR-GH-012 262144 gate kept", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  for (const needle of ['sel-count", "256k"', "!== 262144", "262144 * 32", "u_activeCount", "densityCrowdNorm"]) {
    assert.ok(smoke.includes(needle), needle);
  }
  assert.doesNotMatch(smoke, /if \(!software\)[^\n]*256k/);
});

test("ZUR-GH-012 hardware gates not weakened", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  for (const needle of [
    "process.env.ZUR_ANGLE === 'd3d11' ? 0.30 : 0.38", "centerBlackRatio >= 0.9", "activeMeanLuma >= 0.22",
    "hueSectorCount >= 3", "ZUR_BRAIN_LUMA_MIN || 0.36", "consoleErrors.length", "pageErrors.length", "webglWarnings.length", "[T+",
  ]) assert.ok(smoke.includes(needle), needle);
  assert.match(smoke, /problems\.push\(`console\.error/);
  assert.match(smoke, /problems\.push\(`pageerror/);
  assert.match(smoke, /problems\.push\(`WebGL warnings/);
});

test("ZUR-GH-012 linux default renderer + software calibration", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  for (const needle of [
    'process.platform === "linux" && !process.env.ZUR_ANGLE', 'ZUR_LINUX_ANGLE || "gl"', "ZUR_SW_DENSE_BLACK_MIN || 0.35",
    "ZUR_SW_BRAIN_LUMA_MIN || 0.36", "software ? SW_DENSE_BLACK_MIN : (process.env.ZUR_ANGLE === 'd3d11' ? 0.30 : 0.38)",
  ]) assert.ok(smoke.includes(needle), needle);
});

// ---------------------------------------------------------------- ZUR-GH-012
const gh012 = {
  vert: () => stripComments(read("src/shaders/render.vert.glsl")),
  frag: () => stripComments(read("src/shaders/render.frag.glsl")),
  sim: () => stripComments(read("src/shaders/sim.vert.glsl")),
  audio: () => stripComments(read("src/audio/AudioEngine.js")),
};
const gh012App = await import("../src/app/AppState.js");
const gh012Math = await import("../src/render/particleMath.js");

test("ZUR-GH-013 sceneId is derived from the Engine Selector for every engine", () => {
  const expected = { particles: "particle-swarm-3d", megastructure: "megastructure-3d", canyon: "spectral-canyon-3d", pulse: "pulse-field-3d", aurora: "aurora-ribbons" };
  assert.deepEqual([...gh012App.ENGINE_IDS], Object.keys(expected));
  for (const [engine, scene] of Object.entries(expected)) {
    assert.equal(gh012App.sceneForEngine(engine), scene, engine);
    assert.equal(gh012App.engineForScene(scene), engine, scene);
    assert.equal(gh012App.applyEngine(gh012App.STAGE2_DEFAULT_PRESET, engine).sceneId, scene);
  }
});

test("ZUR-GH-012/013 Mode B applies particle-swarm-3d / wormhole / 64k / 1.0; Mode A keeps a valid scene and the style", () => {
  const b = gh012App.applyModeKeepingScene(MODE_B_PRESET, gh012App.STAGE2_DEFAULT_PRESET);
  assert.equal(b.hud, undefined);
  assert.equal(b.sceneId, "particle-swarm-3d");
  assert.equal(b.particles.formationType, "wormhole");
  assert.equal(b.particles.particleCountTier, "64k");
  assert.equal(b.particles.particleSize, 1.0);
  assert.equal(validatePreset(b).ok, true);
  const styled = structuredClone(gh012App.STAGE2_DEFAULT_PRESET);
  styled.particles.particleStyle = "star-streak";
  const a = gh012App.applyModeKeepingScene(MODE_A_PRESET, styled);
  assert.ok(SCENE_IDS.includes(a.sceneId));
  assert.equal(validatePreset(a).ok, true);
});

test("ZUR-GH-013 zur_state_v5_3 / v5_2 Blood saves migrate to zur_state_v6_0 crisp-dot + wormhole, hud deleted", () => {
  assert.equal(gh012App.STORAGE_KEY, "zur_state_v6_0");
  assert.equal(gh012App.STORAGE_SCHEMA, 6.0);
  assert.ok(gh012App.LEGACY_STORAGE_KEYS.includes("zur_state_v5_3") && gh012App.LEGACY_STORAGE_KEYS.includes("zur_state_v5_2"));
  assert.equal(typeof gh012App.upgradeToV60, "function");
  const blood = structuredClone(gh012App.STAGE2_DEFAULT_PRESET);
  delete blood.deck;
  blood.hud = { hudTab: "blood-swarm", swarmMode: "blood-drip", shaderScene: "spectral-canyon-3d", visualTab: "blood-swarm" };
  blood.particles = { ...blood.particles, formationType: "free-3d", particleStyle: "blood-drop", kineticMode: "splatter-run", colorPalette: "blood-red" };
  delete blood.particles.reactivityMode;
  for (const [key, schema] of [["zur_state_v5_3", 5.3], ["zur_state_v5_2", 5.2]]) {
    const loaded = loadStoredState(mockStorage({ [key]: JSON.stringify({ storageSchema: schema, preset: blood }) }));
    assert.equal(loaded.migrated, true, key);
    assert.equal(loaded.preset.hud, undefined, `${key} hud deleted`);
    assert.equal(loaded.preset.particles.particleStyle, "crisp-dot", key);
    assert.equal(loaded.preset.particles.formationType, "wormhole", key);
    assert.equal(loaded.preset.particles.kineticMode, "off", key);
    assert.equal(loaded.preset.particles.colorPalette, "crimson-pulse", key);
    assert.equal(loaded.preset.particles.reactivityMode, "true-gate", key);
    assert.equal(loaded.preset.sceneId, "particle-swarm-3d", key);
    assert.equal(validatePreset(loaded.preset).ok, true, key);
  }
  // A non-blood v5.3 save keeps the user's own formation; style moves to the v6.0 crisp-dot default, hud is dropped.
  const own = structuredClone(gh012App.STAGE2_DEFAULT_PRESET);
  delete own.deck;
  own.hud = { hudTab: "brain-3d", swarmMode: "free-swarm", shaderScene: "spectral-canyon-3d", visualTab: "brain-3d" };
  own.particles = { ...own.particles, formationType: "neural-brain", particleStyle: "star-streak" };
  const kept = loadStoredState(mockStorage({ zur_state_v5_3: JSON.stringify({ storageSchema: 5.3, preset: own }) }));
  assert.equal(kept.preset.particles.particleStyle, "crisp-dot");
  assert.equal(kept.preset.particles.formationType, "neural-brain");
  assert.equal(kept.preset.hud, undefined);
  const serialized = JSON.parse(serializeStoredState(kept.preset));
  assert.equal(serialized.storageSchema, 6.0);
});

test("ZUR-GH-012 one transform-feedback step per frame: planSimStep, MAX_STEPS_PER_FRAME 1, simSteps stat", () => {
  assert.equal(gh012Math.MAX_STEPS_PER_FRAME, 1);
  assert.equal(gh012Math.MAX_SIM_DT, 1 / 30);
  assert.deepEqual(gh012Math.planSimStep(0), { steps: 0, simDt: 0 });
  assert.deepEqual(gh012Math.planSimStep(-1), { steps: 0, simDt: 0 });
  assert.deepEqual(gh012Math.planSimStep(1 / 60), { steps: 1, simDt: 1 / 60 });
  assert.deepEqual(gh012Math.planSimStep(0.5), { steps: 1, simDt: 1 / 30 });
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /planSimStep\(/);
  assert.match(ps, /simSteps/);
  assert.match(ps, /stepsLastFrame/);
  assert.doesNotMatch(ps, /planFixedSteps|this\.accumulator/);
});

test("ZUR-GH-012 dart3d uses a 4-vertex velocity dart quad from 131072 agents", () => {
  assert.equal(gh012Math.DART_QUAD_MIN_COUNT, 131072);
  assert.equal(gh012Math.dartVertexCount(131071), 12);
  assert.equal(gh012Math.dartVertexCount(131072), 4);
  assert.equal(gh012Math.dartVertexCount(262144), 4);
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /dartVerts/);
  assert.match(ps, /gl\.TRIANGLE_STRIP, 0, 4, count/);
  assert.match(gh012.vert(), /u_shape == 2/);
  assert.match(gh012.frag(), /u_shape == 2/);
});

test("ZUR-GH-013 no atan seams: palettes are smooth iq-cosine / mix() gradients over radial, depth, speed, centroid", () => {
  const f = gh012.frag();
  assert.doesNotMatch(f, /atan\(/, "render.frag has no atan (no wedge buckets)");
  assert.doesNotMatch(f, /floor\(/, "render.frag has no floor() buckets");
  const g = f.slice(f.indexOf("float gradientT()"), f.indexOf("vec3 trueNeon"));
  for (const term of ["radialNorm", "depthNorm", "v_speedNorm", "u_spectralCentroid"]) assert.ok(g.includes(term), term);
  assert.doesNotMatch(g, /v_seed\s*\*\s*[1-9]/, "no per-particle hue scatter");
  assert.match(f, /vec3 fullSpectrum\(float t\)/);
  assert.match(f, /cos\(TAU \* \(/, "iq cosine palette a + b cos(2pi(c t + d))");
  assert.match(gh012.vert(), /flat out vec3 v_worldPos/);
  assert.match(f, /cosinePalette\(t, vec3\(0\.5\), vec3\(0\.5\), vec3\(1\.0\), vec3\(0\.0, 0\.33, 0\.67\)\)/);
  const pal = (t) => pm009.cosinePalette(t, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67]);
  for (let t = 0; t < 1; t += 0.01) {
    const a = pal(t);
    const b = pal(t + 0.01);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.12, `continuous at t=${t.toFixed(2)}`);
  }
  const wrapA = pal(0);
  const wrapB = pal(1);
  assert.ok(Math.hypot(wrapA[0] - wrapB[0], wrapA[1] - wrapB[1], wrapA[2] - wrapB[2]) < 1e-9, "periodic: no seam at the wrap");
  assert.doesNotMatch(stripComments(read("src/shaders/core.frag.glsl")), /neon\[index\]|floor\(atan/);
});

test("ZUR-GH-012 Gargantua: edge-on disk plane normal (0.08, 0.96, -0.26) + 28% photon ring + 12% jets", () => {
  const sim = gh012.sim();
  assert.match(sim, /diskNormal = normalize\(vec3\(0\.08, 0\.96, -0\.26\)\)/);
  assert.match(sim, /jetN = normalize\(vec3\(0\.08, 0\.96, -0\.26\)\)/);
  assert.ok(Math.abs(Math.hypot(0.08, 0.96, -0.26) - 1) < 0.01, "stated normal is unit length");
  assert.match(gh012.vert(), /u_formationType == 8/);
});

test("ZUR-GH-012 logo-attractor bypasses crowdNorm and the crisp exposure: 2.6 px, 1.9x neon", () => {
  const f = gh012.frag();
  const v = gh012.vert();
  assert.match(f, /const float LOGO_NEON_RADIANCE = 1\.9;/);
  assert.match(v, /const float LOGO_MIN_RADIUS_PX = 2\.6;/);
  assert.match(f, /if \(logo\) crowdNorm = max\(crowdNorm, 1\.0\);/);
  assert.match(f, /if \(logo\) exposure = 1\.0;/);
  assert.match(f, /bool logo = u_formationType == 5;/);
  assert.match(v, /radiusPx = max\(radiusPx, LOGO_MIN_RADIUS_PX\)/);
  assert.match(v, /headR = max\(headR, LOGO_MIN_RADIUS_PX \* 1\.5\)/);
  assert.equal(gh012Math.FORMATION_TYPES.indexOf("logo-attractor"), 5);
});

test("ZUR-GH-013 Blood removed from shaders / state / HUD; brain 0.52 / 0.78 / 3.2 on all palettes kept", () => {
  for (const file of ["src/shaders/render.frag.glsl", "src/shaders/render.vert.glsl", "src/shaders/sim.vert.glsl", "src/controls/ControlHUD.js", "src/controls/hudTabs.js", "src/app/main.js", "src/app/VJAutopilot.js"]) {
    assert.doesNotMatch(stripComments(read(file)), /BLOOD_|blood-drip|blood-drop|splatter-run|blood-swarm|Blood & Swarm|bloodStyle/, file);
  }
  const f = gh012.frag();
  assert.match(f, /const float CORTEX_SOMA_ALPHA = 0\.52;/);
  assert.match(f, /const float CORTEX_PULSE_BOOST = 3\.2;/);
  assert.match(f, /bool cortexFiring = u_formationType == 6 && v_neuralPulse > 0\.55;/);
  assert.doesNotMatch(f.match(/bool cortexSoma[^\n]*/)[0], /u_colorPalette/, "not golden-cortex only");
  const v = gh012.vert();
  assert.match(v, /if \(u_formationType == 6\) \{/);
  assert.match(v, /\* 0\.78\)/);
  assert.equal(gh012Math.FORMATION_TYPES.indexOf("neural-brain"), 6);
});

test("ZUR-GH-012/013 crimson-pulse 3D Brain stays crimson (#FF0818/#C8000A), #FF5566 only on peak flashes; smoke gates luma >= 0.12 + R > 2.2G", () => {
  const f = gh012.frag();
  const rawFrag = read("src/shaders/render.frag.glsl");
  assert.match(rawFrag, /BRAIN_CRIMSON = vec3\(1\.0, 0\.0024, 0\.0090\); *\/\/ #FF0818/);
  assert.match(rawFrag, /BRAIN_CRIMSON_DEEP = vec3\(0\.578, 0\.0, 0\.0030\); *\/\/ #C8000A/);
  assert.match(rawFrag, /BRAIN_SCARLET_FLASH = vec3\(1\.0, 0\.0908, 0\.1329\); *\/\/ #FF5566/);
  assert.match(f, /v_neuralPulse > 0\.65 \? BRAIN_SCARLET_FLASH : mix\(BRAIN_CRIMSON_DEEP, BRAIN_CRIMSON,/);
  assert.match(f, /vec3 flashC = u_colorPalette == 3 \? BRAIN_SCARLET_FLASH : vec3\(0\.7454, 1\.0, 1\.0\);/, "no cyan dendrite flash on the crimson brain");
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /m\.activeMeanLuma >= 0\.12\)\) problems\.push\(`3D Brain crimson-pulse/);
  assert.match(smoke, /m\.meanR > 2\.2 \* m\.meanG/);
  assert.match(smoke, /else if \(!\(m\.activeMeanLuma >= 0\.25\)\) problems\.push\(`3D Brain \$\{palette\}/, "other 4 palettes keep >= 0.25");
});

test("ZUR-GH-012 megastructure swarm r >= 0.62 at 0.35x alpha; canyon sky/floor clamp 0.03; hue only on emissive lines", () => {
  assert.match(gh012.sim(), /const float MEGA_SWARM_INNER_R = 0\.62;/);
  assert.match(gh012.frag(), /const float MEGA_SWARM_ALPHA = 0\.35;/);
  assert.match(gh012.frag(), /u_megastructure == 1/);
  const canyon = stripComments(read("src/shaders/spectral-canyon.frag.glsl"));
  assert.match(canyon, /const float OBSIDIAN = 0\.03;/);
  assert.match(canyon, /min\(col, vec3\(OBSIDIAN_LIN\)\)/);
  const ps = read("src/render/ParticleSystem3D.js");
  assert.match(ps, /coreEye/);
  assert.match(ps, /u_megastructure/);
});

test("ZUR-GH-012 Android mic fallback: raw -> {audio:true} -> silent 124 BPM Demo Beat, gesture order kept", () => {
  const raw = read("src/audio/AudioEngine.js");
  const a = gh012.audio();
  assert.match(a, /export const DEMO_BEAT_BPM = 124;/);
  assert.match(a, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(a, /micStage = "demo"/);
  assert.match(a, /Mic locked by another app — Demo Beat 124 BPM \(silent\)/);
  const start = raw.slice(raw.indexOf("export function startMicCapture"));
  assert.ok(start.indexOf("resume()") !== -1 && start.indexOf("resume()") < start.indexOf("getUserMedia"), "resume() is invoked before getUserMedia");
  assert.ok(start.indexOf("getUserMedia") < start.indexOf("await "), "getUserMedia is invoked synchronously, before any await");
  const demo = a.slice(a.indexOf("function startDemoBeat"), a.indexOf("export function startTestOscillator"));
  assert.doesNotMatch(demo, /context\.destination/, "demo beat is analysed, never connected to the destination");
  for (const n of ["kick", "bass", "lead"]) assert.match(demo, new RegExp(`const ${n} = voice`));
  assert.match(read("src/controls/ControlHUD.js"), /setMicStatus/);
  assert.match(read("src/app/main.js"), /setMicStatus\(mode === "microphone"/);
});

test("ZUR-GH-013 service worker cache zur-shell-v11", () => {
  assert.match(read("sw.js"), /const CACHE = "zur-shell-v11"/);
  assert.doesNotMatch(read("sw.js"), /zur-shell-v10"/);
});

// ---------------------------------------------------------------- ZUR-GH-013 (zur-shell-v11 / zur_state_v6_0)
const gh013Fx = await import("../src/audio/FeatureExtractor.js");
const gh013 = {
  sim: () => stripComments(read("src/shaders/sim.vert.glsl")),
  vert: () => stripComments(read("src/shaders/render.vert.glsl")),
  frag: () => stripComments(read("src/shaders/render.frag.glsl")),
  audio: () => stripComments(read("src/audio/AudioEngine.js")),
};

test("ZUR-GH-013 cleanGate = smoothstep(0.018, 0.13, maxBandEnergy * u_reactivityGain) in JS and GLSL", () => {
  assert.equal(gh013Fx.CLEAN_GATE_LO, 0.018);
  assert.equal(gh013Fx.CLEAN_GATE_HI, 0.13);
  assert.equal(pm009.CLEAN_GATE_LO, 0.018);
  assert.equal(pm009.CLEAN_GATE_HI, 0.13);
  assert.match(gh013.vert(), /return smoothstep\(0\.018, 0\.13, maxBandEnergy \* u_reactivityGain\);/);
  assert.equal(pm009.cleanGate(0, 2.5), 0);
  assert.equal(pm009.cleanGate(0.018 / 2.5, 2.5), 0, "gate fully closed at the low edge");
  assert.equal(pm009.cleanGate(0.13 / 2.5, 2.5), 1, "gate fully open at the high edge");
  const mid = pm009.cleanGate(0.074 / 2.5, 2.5);
  assert.ok(mid > 0.45 && mid < 0.55, "smoothstep midpoint");
  assert.equal(pm009.maxBandEnergy([0.01, 0.3, 0.2, NaN, 0.1]), 0.3);
  assert.equal(gh013Fx.frameCleanGate({ sub: 0.9, bass: 0.9, lowMid: 0.9, highMid: 0.9, treble: 0.9, isSilent: true }, 2.5), 0, "isSilent forces 0");
  assert.ok(gh013Fx.frameCleanGate({ sub: 0.5, bass: 0.5, lowMid: 0.1, highMid: 0.1, treble: 0.1, isSilent: false }, 2.5) > 0.99);
  assert.ok(Number.isFinite(pm009.cleanGate(NaN, 2.5)) && pm009.cleanGate(NaN, 2.5) === 0, "NaN-safe");
});

test("ZUR-GH-013 reactivityMode true-gate (default) / ember-floor 0.06 / ambient-vj; emission multiplies every engine", () => {
  assert.deepEqual([...pm009.REACTIVITY_MODES], ["true-gate", "ember-floor", "ambient-vj"]);
  assert.equal(DEFAULT_PARTICLES.reactivityMode, "true-gate");
  assert.equal(pm009.reactivityEmission("true-gate", 0), 0, "silence = 0.00 emission");
  assert.equal(pm009.reactivityEmission("true-gate", 0.4), 0.4);
  assert.equal(pm009.reactivityEmission("ember-floor", 0), 0.06);
  assert.equal(pm009.reactivityEmission("ambient-vj", 0), 1);
  assert.match(gh013.vert(), /float emissionFor\(float cleanGate\)/);
  assert.match(stripComments(read("src/shaders/core.frag.glsl")), /alpha \*= clamp\(u_emission, 0\.0, 1\.0\);/);
  assert.match(stripComments(read("src/shaders/spectral-canyon.frag.glsl")), /guardNeon\(color\) \* u_emission/);
  assert.match(read("src/render/ShaderHost.js"), /vec3 linear = \(color \+ blur \* u_bloom\) \* u_emission;/);
  assert.match(read("src/render/RenderHost.js"), /reactivityEmission\(/);
  assert.match(read("src/render/ParticleSystem3D.js"), /gl\.uniform1f\(L\.u_cleanGate, gate\)/);
  assert.match(read("src/controls/ControlHUD.js"), /reactivityMode: \["sel-reactivity-mode", "particles", "reactivityMode"\]/);
});

test("ZUR-GH-013 no fake idle brightness: no constant idle floor or u_time-only pulses outside ambient-vj", () => {
  const v = gh013.vert();
  assert.doesNotMatch(v, /0\.45 \+ u_treble|idleGlow|IDLE_BRIGHT/);
  assert.match(v, /u_reactivityMode == 2/, "time-only (thalamic) rhythm is fenced to ambient-vj");
  const ps = stripComments(read("src/render/ParticleSystem3D.js"));
  assert.match(ps, /gatedTrailKeep\(/);
  assert.equal(pm009.TRUE_GATE_TRAIL_DECAY_MS, 120);
  const dt = 1 / 60;
  const closed = pm009.gatedTrailKeep(0.98, dt, 0, "true-gate");
  assert.ok(Math.abs(closed - Math.exp(-dt / 0.12)) < 1e-12, "120 ms trail decay with the gate closed");
  assert.equal(pm009.gatedTrailKeep(0.98, dt, 1, "true-gate"), 0.98, "open gate keeps the user's trail");
  assert.equal(pm009.gatedTrailKeep(0.98, dt, 0, "ambient-vj"), 0.98);
  assert.equal(pm009.gatedDamping(1, 0), 1 + pm009.TRUE_GATE_MOTION_DAMP, "damped motion in silence");
  assert.equal(pm009.gatedDamping(1, 1), 1);
  const sim = gh013.sim();
  assert.match(sim, /k \+= \(1\.0 - u_cleanGate\) \* 5\.0;/);
  assert.match(sim, /float burst = u_cleanGate \* \(sustainedBurst \+ u_onset \* [\d.]+\)/, "beats: velocity burst");
  assert.match(sim, /pos \+= radial \* u_cleanGate \* u_onset/, "beats: radial displacement");
});

test("ZUR-GH-013 Load Audio Track (WAV/MP3/OGG): AudioElement -> MediaElementSource -> Analyser; Speaker Monitor only path to speakers", () => {
  const a = gh013.audio();
  const raw = read("src/audio/AudioEngine.js");
  assert.match(raw, /export const TRACK_ACCEPT = "\.wav,\.mp3,\.ogg,audio\/wav,audio\/x-wav,audio\/mpeg,audio\/ogg";/);
  const finish = a.slice(a.indexOf("async function finishFileTrack"), a.indexOf("export async function playPauseTrack"));
  assert.match(finish, /trackElement = new Audio\(\);/);
  assert.match(finish, /createMediaElementSource\(trackElement\)/);
  assert.match(finish, /attachAnalyser\(context, source, fftSize, 1\);/);
  assert.match(finish, /currentMode = "file-track";/);
  assert.ok(finish.indexOf("applySpeakerMonitor()") > finish.indexOf("attachAnalyser"), "monitor applied after the analyser");
  assert.doesNotMatch(finish, /\.destination/);
  const apply = a.slice(a.indexOf("function applySpeakerMonitor"), a.indexOf("function releaseTrack"));
  assert.match(apply, /currentMode === "file-track" && speakerMonitor\) monitorConnect\(\);\s*else monitorDisconnect\(\);/);
  for (const fn of ["startFileTrack", "playPauseTrack", "setSpeakerMonitor", "getTrackState"]) assert.match(raw, new RegExp(`export (async )?function ${fn}\\(`), fn);
  assert.match(a, /destinationConnections = 0;[\s\S]*destinationConnections = 1;|destinationConnections = 1;[\s\S]*destinationConnections = 0;/);
  const stop = a.slice(a.indexOf("export async function stopCapture"));
  assert.match(stop.slice(0, 1200), /releaseTrack\(\)|monitorDisconnect\(\)/, "stop always unroutes the speakers");
  const hud = read("src/controls/ControlHUD.js");
  assert.match(hud, /"Load Audio Track \(WAV\/MP3\/OGG\)"/);
  assert.match(hud, /this\.trackFile\.id = "file-audio-track";/);
  assert.match(hud, /this\.trackFile\.accept = TRACK_ACCEPT;/);
  assert.match(hud, /"btn-track-play"/);
  assert.match(hud, /"chk-speaker-monitor"/);
  const main = read("src/app/main.js");
  for (const h of ["trackFile", "trackPlay", "speakerMonitor"]) assert.match(main, new RegExp(`${h}[:(]`), h);
});

test("ZUR-GH-013 mic and tab capture stay at destinationConnections 0 (monitorConnect refuses non-file modes)", () => {
  const a = gh013.audio();
  const monitor = a.slice(a.indexOf("function monitorConnect"), a.indexOf("function monitorDisconnect"));
  assert.match(monitor, /if \(currentMode !== "file-track" \|\| !source \|\| !context \|\| monitorConnected\) return false;/);
  for (const name of ["startTabCapture", "startMicCapture", "startDemoBeat", "startTestOscillator"]) {
    const start = a.indexOf(`function ${name}`);
    assert.ok(start >= 0, name);
    const body = a.slice(start, start + 2500);
    assert.doesNotMatch(body.slice(0, body.indexOf("\n}\n") + 1 || undefined), /monitorConnect|\.connect\([^)]*destination/, name);
  }
  assert.match(a, /if \(isAudioDestination\(destination\)\) \{\s*destinationRefusals \+= 1;\s*throw/);
  assert.match(a, /silent: destinationConnections === 0/);
});

test("ZUR-GH-013 4 s rolling-peak auto-gain on the shared Android mic only", () => {
  assert.equal(gh013Fx.AUTO_GAIN_WINDOW_SECONDS, 4);
  assert.equal(gh013Fx.AUTO_GAIN_BUCKETS, 16);
  assert.deepEqual([...gh013Fx.AUTO_GAIN_RANGE], [1, 8]);
  const rp = new gh013Fx.RollingPeak();
  for (let i = 0; i < 60; i += 1) rp.push(0.1, 1 / 60);
  assert.ok(Math.abs(rp.peak() - 0.1) < 1e-7);
  for (let i = 0; i < 60 * 4.5; i += 1) rp.push(0, 1 / 60);
  assert.equal(rp.peak(), 0, "peak forgets after the 4 s window");
  assert.equal(gh013Fx.autoGainFromPeak(0), 1, "no boost of pure noise / silence");
  assert.equal(gh013Fx.autoGainFromPeak(0.01), 1, "below the minimum peak");
  assert.equal(gh013Fx.autoGainFromPeak(0.05), 8, "clamped at 8x");
  assert.ok(Math.abs(gh013Fx.autoGainFromPeak(0.45) - 2) < 1e-12);
  assert.equal(gh013Fx.autoGainFromPeak(2), 1, "never attenuates below 1x");
  assert.equal(gh013Fx.autoGainEnabledFor("mic", "shared"), true);
  assert.equal(gh013Fx.autoGainEnabledFor("mic", "raw"), false);
  assert.equal(gh013Fx.autoGainEnabledFor("tab", "shared"), false);
  assert.equal(gh013Fx.autoGainEnabledFor("file-track", undefined), false);
  const fx = new gh013Fx.FeatureExtractor();
  assert.equal(typeof fx.setAutoGain, "function");
  const main = read("src/app/main.js");
  assert.match(main, /extractor\.setAutoGain\(autoGainEnabledFor\(/);
  assert.match(main, /extractor\.setAutoGain\(false\)/);
});

test("ZUR-GH-013 anatomical neural-brain: 82% cerebrum / 11% cerebellum / 7% brainstem, 0.045 gap, +/-0.03 gyri, 32 deg view", () => {
  assert.equal(pm009.BRAIN_CEREBRUM_FRACTION, 0.82);
  assert.equal(pm009.BRAIN_CEREBELLUM_FRACTION, 0.11);
  assert.ok(Math.abs(pm009.BRAIN_BRAINSTEM_FRACTION - 0.07) < 1e-12);
  assert.ok(Math.abs(pm009.BRAIN_CEREBRUM_FRACTION + pm009.BRAIN_CEREBELLUM_FRACTION + pm009.BRAIN_BRAINSTEM_FRACTION - 1) < 1e-12);
  assert.equal(pm009.BRAIN_LONGITUDINAL_GAP, 0.045);
  assert.equal(pm009.BRAIN_GYRI_AMPLITUDE, 0.03);
  assert.equal(pm009.BRAIN_VIEW_YAW_DEG, 32);
  const counts = { cerebrum: 0, cerebellum: 0, brainstem: 0 };
  for (let i = 0; i < 10000; i += 1) counts[pm009.brainRegion((i + 0.5) / 10000)] += 1;
  assert.deepEqual(counts, { cerebrum: 8200, cerebellum: 1100, brainstem: 700 });
  const sim = gh013.sim();
  assert.match(sim, /const float BRAIN_CEREBRUM_FRAC = 0\.82;/);
  assert.match(sim, /const float BRAIN_CEREBELLUM_FRAC = 0\.11;/);
  assert.match(sim, /const float BRAIN_GAP = 0\.045;/);
  assert.match(sim, /const float BRAIN_VIEW_YAW = 0\.5585053606;/);
  assert.ok(Math.abs(0.5585053606 - (32 * Math.PI) / 180) < 1e-9);
  assert.match(sim, /p\.x = s \* max\(s \* p\.x, BRAIN_GAP \* 0\.5\);/, "the longitudinal fissure stays empty (no central egg)");
  assert.match(sim, /p \+= n \* 0\.03 \* ridge;/, "+/-0.03 gyri");
  assert.match(sim, /region < BRAIN_CEREBRUM_FRAC \+ BRAIN_CEREBELLUM_FRAC/);
});

test("ZUR-GH-013 harmonic-ferrofluid: 70% spherical-harmonic spike shell on 5 bands + 30% concentric EQ rings", () => {
  assert.equal(FORMATION_TYPES.indexOf("harmonic-ferrofluid"), 10);
  assert.equal(pm009.FERRO_SHELL_FRACTION, 0.7);
  assert.equal(pm009.FERRO_RING_FRACTION, 0.3);
  assert.deepEqual([...pm009.FERRO_HARMONIC_DEGREES], [2, 3, 4, 6, 8]);
  const sim = gh013.sim();
  assert.match(sim, /const float FERRO_SHELL_FRAC = 0\.70;/);
  assert.match(sim, /if \(u_formationType == 10\) return harmonicFerrofluidTarget\(seed, uid\);/);
  const fn = sim.slice(sim.indexOf("vec3 harmonicFerrofluidTarget"), sim.indexOf("vec3 harmonicFerrofluidTarget") + 2600);
  assert.match(fn, /kind < FERRO_SHELL_FRAC/);
  assert.match(fn, /u_bands\[ring\]/, "each EQ ring follows its band");
  assert.match(fn, /int ring = int\(uid % 5u\);/, "5 concentric rings");
  assert.equal(gh010.QUICK_PRESETS.find((q) => q.id === "ferrofluid").particles.formationType, "harmonic-ferrofluid");
});

test("ZUR-GH-013 wormhole: horned torus tilted 22 deg, R 0.94 outer shell, 0.08 throat", () => {
  assert.equal(pm009.WORMHOLE_TILT_DEG, 22);
  assert.equal(pm009.WORMHOLE_SHELL_R, 0.94);
  assert.equal(pm009.WORMHOLE_THROAT_R, 0.08);
  const outer = pm009.wormholePoint(0, 0);
  assert.ok(Math.abs(Math.hypot(...outer) - 0.94) < 1e-9);
  const throat = pm009.wormholePoint(0.5, 0);
  assert.ok(Math.abs(Math.hypot(...throat) - 0.08) < 1e-9);
  let shell = 0;
  let inner = 0;
  const N = 4000;
  for (let i = 0; i < N; i += 1) {
    const r = Math.hypot(...pm009.wormholePoint((i + 0.5) / N, (i * 0.618) % 1));
    assert.ok(Number.isFinite(r) && r <= 1.0, "closed shell bounded by the unit sphere");
    if (r >= 0.8) shell += 1;
    if (r < 0.3) inner += 1;
  }
  assert.ok(shell / N > 0.3 && inner / N > 0.1, "both outer shell and throat are occupied");
  const sim = gh013.sim();
  assert.match(sim, /const float WORMHOLE_TILT = 0\.3839724354;/);
  assert.ok(Math.abs(0.3839724354 - (22 * Math.PI) / 180) < 1e-9);
  assert.match(sim, /float rxz = 0\.51 \+ 0\.43 \* cos\(theta\);/, "R = 0.51 + 0.43 = 0.94, throat 0.51 - 0.43 = 0.08");
  assert.equal(DEFAULT_PARTICLES.formationType, "wormhole");
});

test("ZUR-GH-013 Blood removed: no Blood & Swarm tab, styles, kinetic or palette ids anywhere in the shipped app", () => {
  const files = ["index.html", "sw.js", "src/app/main.js", "src/controls/ControlHUD.js", "src/controls/hudTabs.js", "src/app/VJAutopilot.js",
    "src/shaders/render.frag.glsl", "src/shaders/render.vert.glsl", "src/shaders/sim.vert.glsl", "src/render/ParticleSystem3D.js", "src/render/RenderHost.js"];
  for (const file of files) assert.doesNotMatch(stripComments(read(file)), /blood|splatter/i, file);
  assert.ok(!pm009.PARTICLE_STYLES.includes("blood-drop"));
  assert.ok(!pm009.KINETIC_MODES.includes("splatter-run"));
  assert.ok(!pm009.COLOR_PALETTES.includes("blood-red"));
  for (const gone of ["BLOOD_GLASS_Z", "bloodPin", "bloodNeedsRespawn", "isBloodRouted", "bloodStreakSpeed"]) assert.equal(gone in pm009, false, gone);
  // Migration-only references (legacy detection) are allowed in AppState / particleMath aliases.
  assert.match(read("src/app/AppState.js"), /isLegacyBloodPreset/);
});

test("ZUR-GH-013 crisp-dot is the #1 default everywhere (fresh state, Mode A/B, migrations)", () => {
  assert.equal(DEFAULT_PARTICLES.particleStyle, "crisp-dot");
  assert.equal(pm009.PARTICLE_STYLES[0], "crisp-dot");
  assert.equal(gh010.STAGE2_DEFAULT_PRESET.particles.particleStyle, "crisp-dot");
  assert.equal(new AppState(gh010.STAGE2_DEFAULT_PRESET).preset.particles.particleStyle, "crisp-dot");
  assert.equal(gh010.applyModeKeepingScene(MODE_B_PRESET, gh010.STAGE2_DEFAULT_PRESET).particles.particleStyle, "crisp-dot");
  assert.equal(pm009.CRISP_DOT_CORE_K, 16);
  assert.equal(pm009.DART_SCALE, 0.55);
  assert.equal(pm009.SYNAPSE_SPARK_FRACTION, 0.15);
  assert.match(read("src/controls/hudTabs.js") + read("src/render/particleMath.js"), /Crisp Dot — Pinpoint/);
});

test("ZUR-GH-013 smoke:gh010 asserts the v6.0 gates (a)-(f) and keeps the kept gates", () => {
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /silence\.frameMeanLuma <= 0\.025/, "(a) meanLuma");
  assert.match(smoke, /silence\.blackRatio >= 0\.94/, "(a) blackRatio");
  assert.match(smoke, /active\.activeMeanLuma >= 0\.12/, "(b) >= 0.12");
  assert.match(smoke, /ratio >= 5/, "(b) >= 5x silence");
  assert.match(smoke, /maxAdjacentHueDelta <= 0\.08/, "(c) seams");
  assert.match(smoke, /stylePersistence/, "(d)");
  assert.match(smoke, /shellFraction >= 0\.30/, "(e) shell");
  assert.match(smoke, /throatFraction >= 0\.05/, "(e) throat");
  assert.match(smoke, /262144/);
  assert.match(smoke, /crowdNorm/);
  assert.match(smoke, /destinationConnections/);
  assert.match(smoke, /autoGain/);
  assert.match(smoke, /zur_state_v5_3/);
  assert.match(smoke, /consoleErrors\.length/);
  assert.doesNotMatch(smoke, /enforceTabConstraints|goTab\(|idle activeMeanLuma/);
});

test("ZUR-GH-013 tightening 1: brain / wormhole / logo / black hole swap the 1.42x sustained swell for a <= 1.08x onset micro-pulse", () => {
  const sim = gh013.sim();
  assert.match(sim, /bool structuredFormation\(\) \{\s*return u_formationType == 5 \|\| u_formationType == 6 \|\| u_formationType == 8 \|\| u_formationType == 9;/);
  assert.match(sim, /const float STRUCTURED_ONSET_PULSE = 0\.08;/);
  assert.match(sim, /if \(structuredFormation\(\)\) kick = 1\.0 \+ STRUCTURED_ONSET_PULSE \* clamp\(u_onset, 0\.0, 1\.0\) \* u_cleanGate;/);
  assert.match(sim, /float sustainedBurst = structuredFormation\(\) \? 0\.0 : u_bass \* 1\.6;/, "no sustained bass burst on structured shapes");
  assert.match(sim, /float structuredImpulse = structuredFormation\(\) \? 0\.35 : 1\.0;/);
  assert.match(sim, /FORMATION_CURL_CAP \* \(structuredFormation\(\) \? 0\.33 : 1\.0\)/);
  assert.match(sim, /cerebrumSurface\(d, side\) \* \(1\.0 \+ 0\.04 \* u_onset \* u_cleanGate\)/, "brain soma breathes on onsets only");
  // sustained bass / RMS are routed elsewhere
  assert.match(sim, /0\.25 \+ 0\.55 \* \(b1 \+ b4\) \+ 0\.30 \* u_bass \+ 0\.35 \* u_rms/, "ferrofluid spike amplitude");
  assert.match(sim, /u_onset \* 9\.0 \+ u_high \* 6\.0 \+ u_bass \* 4\.0 \+ u_rms \* 3\.0/, "tracer speed");
  const v = gh013.vert();
  assert.match(v, /0\.9 \* u_onset \+ 0\.5 \* u_bass \+ 0\.35 \* u_rms/, "brightness");
  assert.match(v, /stretch = min\(stretch \+ 2\.5 \* \(u_bass \+ u_rms\) \* cleanGate, 19\.0\);/, "streak stretch");
  // JS mirror: worst-case sustained bed (sub = bass = 1, gain 5) never scales a structured target beyond 1.0;
  // a full onset with the gate open peaks at exactly 1.08.
  for (const f of ["neural-brain", "wormhole", "logo-attractor", "supermassive-blackhole"]) {
    assert.ok(pm009.STRUCTURED_FORMATIONS.includes(f), f);
    assert.equal(pm009.formationKick(f, 5, 1, 1, 0, 1), 1, `${f} sustained`);
    assert.ok(Math.abs(pm009.formationKick(f, 5, 1, 1, 1, 1) - 1.08) < 1e-12, `${f} onset peak`);
    assert.equal(pm009.formationKick(f, 2.5, 1, 1, 1, 0), 1, `${f} closed gate`);
  }
  assert.ok(Math.abs(pm009.formationKick("free-3d", 2.5, 1, 1) - pm009.radialKick(2.5, 1, 1)) < 1e-12, "other formations keep the legacy kick");
  assert.ok(Math.abs(pm009.radialKick(2.5, 0.55, 0.7) - 1.42) < 0.01, "the legacy sustained swell was ~1.42x");
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /structured swell gate/);
  assert.match(smoke, /ratio <= 1\.10/);
});

test("ZUR-GH-013 tightening 2: particleStyle resets to crisp-dot only when migrating < v6_0; v6_0 saves keep it", () => {
  for (const style of ["crisp-dot", "star-streak", "synapse-node", "dart3d"]) {
    const p = structuredClone(gh010.STAGE2_DEFAULT_PRESET);
    p.particles.particleStyle = style;
    const current = loadStoredState(mockStorage({ zur_state_v6_0: serializeStoredState(p) }));
    assert.equal(current.key, "zur_state_v6_0");
    assert.equal(current.migrated, false, `${style}: a v6_0 save is not a migration`);
    assert.equal(current.preset.particles.particleStyle, style, `v6_0 keeps ${style}`);
    assert.equal(new AppState(current.preset).preset.particles.particleStyle, style, `AppState keeps ${style}`);
    // round trip: save -> reload -> save is stable
    const again = loadStoredState(mockStorage({ zur_state_v6_0: serializeStoredState(current.preset) }));
    assert.equal(again.preset.particles.particleStyle, style);
    // the same style in an older envelope is migrated to the v6.0 default
    for (const [key, schema] of [["zur_state_v5_3", 5.3], ["zur_state_v5_2", 5.2], ["zur_state_v4_0", 4.0]]) {
      const old = structuredClone(p);
      delete old.deck;
      const legacy = loadStoredState(mockStorage({ [key]: JSON.stringify({ storageSchema: schema, preset: old }) }));
      assert.equal(legacy.migrated, true, `${key} ${style}`);
      assert.equal(legacy.preset.particles.particleStyle, "crisp-dot", `${key}: ${style} -> crisp-dot`);
    }
  }
  const src = stripComments(read("src/app/AppState.js"));
  const mig = src.slice(src.indexOf("export function migrateStoredPayload"), src.indexOf("export function loadStoredState"));
  assert.match(mig, /if \(schema < STORAGE_SCHEMA\) \{[\s\S]*?upgradeToV60\(/, "the crisp-dot reset lives only in the < v6_0 branch");
  assert.equal((src.match(/upgradeToV60\(/g) || []).length, 2, "defined once, called once");
  const smoke = read("tests/smoke-zur-gh-010.mjs");
  assert.match(smoke, /v6_0 particleStyle reload gate/);
});

for (const entry of tests) {
  try {
    await entry.fn();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error);
  }
}
if (failed > 0) {
  console.error(`${failed} failed, ${tests.length - failed} passed`);
  process.exit(1);
}
console.log(`${tests.length} passed`);
