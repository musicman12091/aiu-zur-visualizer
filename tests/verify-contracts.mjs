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
  STORAGE_KEY, STORAGE_SCHEMA, V3_2_UPGRADE_DEFAULTS, V4_NEON_FLAG, loadStoredState, serializeStoredState,
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
  assert.doesNotMatch(code, /\.connect\(\s*(context|nextContext|audioContext)\.destination\s*\)/);
  assert.equal(code.includes("source.connect(context.destination)"), false);
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

test("fixed-step accumulator runs 1/60 s steps with a 4-step cap", () => {
  assert.equal(SIM_STEP, 1 / 60);
  assert.equal(MAX_STEPS_PER_FRAME, 4);
  assert.equal(planFixedSteps(0, 1 / 60).steps, 1);
  assert.equal(planFixedSteps(0, 1 / 30).steps, 2);
  const slow = planFixedSteps(0, 0.2);
  assert.deepEqual([slow.steps, slow.accumulator], [4, 0]);
  let acc = 0;
  let total = 0;
  for (let i = 0; i < 90; i += 1) {
    const r = planFixedSteps(acc, 1 / 90);
    acc = r.accumulator;
    total += r.steps;
  }
  assert.ok(total >= 59 && total <= 60, `90 frames @90 Hz → ${total} steps`);
  const src = read("src/render/ParticleSystem3D.js");
  assert.match(src, /MAX_STEPS_PER_FRAME/);
  assert.match(src, /SIM_STEP/);
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
  assert.match(sim, /2\.6 \* heat/, "gas buoyancy");
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

test("particle tiers: 65,536 desktop / 16,384 mobile with FPS step-down", () => {
  assert.deepEqual([...COUNT_TIERS], ["auto", "64", "128", "256", "512", "1k", "2k", "4k", "16k", "32k", "64k"]);
  assert.equal(resolveParticleCount("auto", false), 65536);
  assert.equal(resolveParticleCount("auto", true), 16384);
  assert.equal(resolveParticleCount(32768, false), 32768);
  assert.equal(resolveParticleCount("32k", false), 32768);
  assert.equal(isMobileAgent("Mozilla/5.0 (Linux; Android 15; SM-A576B) Mobile"), true);
  assert.equal(isMobileAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/141"), false);
  assert.equal(stepdownThreshold(60), 50);
  assert.equal(stepdownThreshold(30), 25);
  let r = nextAutoCount(65536, 45, 60, 0);
  assert.deepEqual(r, { count: 65536, slowWindows: 1 });
  r = nextAutoCount(65536, 45, 60, r.slowWindows);
  assert.deepEqual(r, { count: 32768, slowWindows: 0 });
  assert.deepEqual(nextAutoCount(65536, 12, 60, 0), { count: 16384, slowWindows: 0 });
  assert.deepEqual(nextAutoCount(65536, 58, 60, 1), { count: 65536, slowWindows: 0 });
  assert.equal(nextAutoCount(4096, 5, 60, 3).count, 4096);
  assert.equal(nextAutoCount(65536, 29, 30, 1).count, 65536, "30 fps cap is not a miss");
  assert.deepEqual(nextAutoCount(65536, 49, 60, 1), { count: 32768, slowWindows: 0 }, "FPS < 50 steps down");
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
  const particles = { flowMode: "fish", shape: "capsule", particleSize: 2.5, kaleidoSegments: 12, kaleidoSpin: false, particleCountTier: "16k" };
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
  for (const id of ["sel-scene", "sel-flow", "sel-shape", "rng-size", "sel-kaleido", "chk-kaleido-spin", "sel-count"]) {
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
    particleCountTier: "1k",
    densityAutoScale: true,
    trailLength: 0.28,
    trailType: "comet",
    formationType: "neon-tunnel",
    attractorText: "AI: UNDERGROUND",
    oscillationType: "helix",
    oscillationAmount: 1.0,
    oscillationSpeed: 1.2,
    pulseLayout: "band-clouds",
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
    ["oscillationAmount", 3.5], ["oscillationSpeed", 0.1], ["pulseLayout", "grid"], ["particleCountTier", "8k"], ["densityAutoScale", "yes"],
  ]) {
    const preset = JSON.parse(JSON.stringify(STAGE2_DEFAULT_PRESET));
    preset.particles[key] = bad;
    assert.equal(validatePreset(preset).ok, false, key);
  }
  const clamped = normalizeParticles({ trailLength: 4, oscillationAmount: -2, oscillationSpeed: 99 });
  assert.equal(clamped.trailLength, 1);
  assert.equal(clamped.oscillationAmount, 0);
  assert.equal(clamped.oscillationSpeed, 4);
  assert.equal(normalizeParticles({ countTier: 16384 }).particleCountTier, "16k", "Stage 2 countTier migrates");
  assert.equal(normalizeParticles({ countTier: "auto" }).particleCountTier, "auto");
  assert.deepEqual(decodePresetParam("scene:pulse_count:2k"), { particles: { particleCountTier: "2k" }, sceneId: "pulse-field-3d" });
  assert.equal(decodePresetParam("count:4096").particles.particleCountTier, "4k");
});

test("Stage 3 count tiers and density auto-scale formulas", () => {
  assert.deepEqual({ ...COUNT_TIER_VALUES }, {
    "64": 64, "128": 128, "256": 256, "512": 512, "1k": 1024, "2k": 2048, "4k": 4096, "16k": 16384, "32k": 32768, "64k": 65536,
  });
  assert.equal(DEFAULT_PARTICLES.particleCountTier, "1k");
  assert.equal(resolveParticleCount("1k", false), 1024);
  assert.equal(resolveParticleCount("64", true), 64);
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
  assert.match(kaleido, /mix\(chroma \* mappedPeak, vec3\(1\.0\), smoothstep\(1\.1, 3\.2, peak\) \* 0\.65\)/);
  const [r, gg, b] = chromaToneMap([0.2, 0.8, 0.4]);
  assert.ok(near(gg / r, 4, 1e-9) && near(gg / b, 2, 1e-9), "hue ratios preserved below the white blend");
  assert.ok(chromaToneMap([0.5, 0, 0])[1] === 0, "pure channel stays pure");
  const hot = chromaToneMap([8, 2, 0.5]);
  assert.ok(hot[1] > 0.5 && hot[2] > 0.5 && hot.every((v) => v <= 1.2), "very hot pixels bleed toward white");
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
  assert.match(hud, /3D Audio Pulse Field — Stage 3/);
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
      particleCountTier: "2k",
    }));
    assert.equal(round.sceneId, PARTICLE_SCENE_ID);
    assert.equal(round.particles.particleCountTier, "2k");
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

test("Stage 4 storage key and schema are zur_state_v4_0 / 4.0", () => {
  assert.equal(STORAGE_KEY, "zur_state_v4_0");
  assert.equal(STORAGE_SCHEMA, 4.0);
  assert.deepEqual({ ...V3_2_UPGRADE_DEFAULTS }, { paletteId: "neon-tunnel", particleCountTier: "2k", particleSize: 1.35, trailLength: 0.28, trailType: "comet" });
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
  assert.equal(p.particleCountTier, "2k");
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
    assert.equal(loaded.preset.particles.particleCountTier, "2k");
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
  preset.particles = { ...preset.particles, particleCountTier: "16k", particleSize: 2.2 };
  const loaded = loadStoredState(mockStorage({ zur_state_v3_2: serializeStoredState(preset) }));
  assert.equal(loaded.migrated, false);
  assert.equal(loaded.preset.visual.paletteId, "solar-plasma");
  assert.equal(loaded.preset.particles.particleCountTier, "16k");
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
  assert.match(frag32(), /float crowdNorm = 1\.0 \/ \(1\.0 \+ 0\.32 \* u_particleSize \* u_particleSize \* sqrt\(max\(u_activeCount, 64\.0\) \/ 1024\.0\)\);/);
  assert.match(frag32(), /uniform float u_particleSize;/);
  assert.match(frag32(), /uniform float u_activeCount;/);
  assert.equal(crowdNorm(1, 1024), 1 / 1.32);
  assert.ok(crowdNorm(4, 65536) < 0.03);
  assert.ok(crowdNorm(1, 0) > crowdNorm(1, 1024), "active count floors at 64");
  for (const size of [2.2, 3, 3.5, 4]) for (const count of [16384, 65536]) assert.ok(crowdNorm(size, count) < 0.15, `${size}@${count}`);
});

test("Stage 3.2 Velocity Capsule alpha scales by 0.40 * crowdNorm (premultiplied blend)", () => {
  assert.equal(CAPSULE_ALPHA, 0.40);
  assert.equal(capsuleAlpha(3.5, 16384), 0.4 * crowdNorm(3.5, 16384));
  assert.ok(capsuleAlpha(3.5, 16384) < 0.03, "no solid-white fireball");
  assert.match(frag32(), /capsuleAlpha = 0\.40 \* crowdNorm/);
  assert.match(frag32(), /fragColor = vec4\(color \* u_radianceScale \* [\d.]+ \* capsuleAlpha, min\(halo, 1\.0\) \* capsuleAlpha\)/);
  const system = stripComments(read("src/render/ParticleSystem3D.js"));
  assert.match(system, /gl\.blendFunc\(gl\.ONE, gl\.ONE_MINUS_SRC_ALPHA\)/);
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
  assert.equal((vert.match(/gl_Position\.y \+= u_viewportYOffset \* gl_Position\.w;/g) || []).length, 2, "both gl_Position paths");
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
  assert.ok(hud.indexOf('"sel-scene"') < hud.indexOf('"sel-palette"') && hud.indexOf('"sel-palette"') < hud.indexOf('"rng-hue"'), "Scene > Palette > Hue order");
  assert.match(hud, /btn-hide-hud/);
  assert.match(hud, /Hide HUD \/ Fullscreen/);
  assert.match(hud, /pulseLayout\.wrap\.hidden = [^;]*PULSE_SCENE_ID/);
  assert.match(read("src/app/main.js"), /canvas\.addEventListener\("click"[\s\S]*?toggleHidden/);
  assert.match(read("index.html"), /\.hud-hide\s*\{[^}]*position:\s*sticky/);
});

test("Stage 4 sw.js cache is v5, claims clients and precaches new shaders", () => {
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "zur-shell-v5"/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /\.(html|js|glsl)/);
  for (const file of ["render.frag.glsl", "render.vert.glsl", "sim.vert.glsl", "kaleido.frag.glsl", "core.frag.glsl", "spectral-canyon.frag.glsl"]) {
    assert.ok(sw.includes(file), file);
  }
});

test("Stage 3.2 AudioEngine stays silent (no destination connection)", () => {
  const audio = stripComments(read("src/audio/AudioEngine.js"));
  assert.doesNotMatch(audio, /\.connect\([^)]*\.destination/);
  assert.match(audio, /destinationConnections/);
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
  assert.match(fragment, /u_palette\[index \+ 1\]/);
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
  assert.match(hud, /txt-attractor/);
  for (const name of ["AI: UNDERGROUND", "MON DAAIN", "TENTH GATE", "ZUR"]) assert.ok(hud.includes(name));
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
  assert.match(state, /zur_state_v4_0/);
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
  assert.match(hud, /swarmHudScenes/);
  assert.match(hud, /spectral-canyon/);
  assert.match(hud, /stage2\.hidden/);
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
  assert.equal((vert.match(/gl_Position\.y \+= u_viewportYOffset \* gl_Position\.w/g) || []).length, 2);
  const corePass = ps.slice(ps.indexOf("if (extras.megastructure)"), ps.indexOf("const dart"));
  assert.match(corePass, /gl\.uniform1f\(C\.u_viewportYOffset, viewportYOffset\)/);
  assert.match(ps, /"u_viewportYOffset",\s*\]\);/);
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
  assert.match(sim, /max\(R, coreRadius \+ 0\.12\)/);
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
  assert.match(hud, /"sel-attractor-preset",\s*"Logo \/ Attractor Text"/);
  assert.match(hud, /\["custom", "Custom…"\]/);
  assert.match(hud, /this\.formation\.wrap, this\.attractorPreset\.wrap, this\.attractorText\.wrap/);
  assert.match(hud, /this\.attractorPreset\.wrap\.hidden = !logoActive;/);
  assert.match(hud, /const logoActive = particles\.formationType === "logo-attractor";/);
  assert.match(hud, /txt-attractor/);
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


let failed = 0;
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
