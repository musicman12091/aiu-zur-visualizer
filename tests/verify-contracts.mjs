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
  SIM_STEP,
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
} from "../src/render/particleMath.js";
import { seedParticleState } from "../src/render/ParticleSystem3D.js";

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
  assert.match(read("src/shaders/trail.frag.glsl"), /vec4\(0\.0, 0\.0, 0\.0, u_fade\)/);
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
  assert.match(frag, /c \/ \(1\.0 \+ c\)/);
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

test("four flow modes are implemented in sim.vert.glsl with curl, buoyancy and shimmer", () => {
  assert.deepEqual([...FLOW_MODES], ["fluid", "gas", "murmuration", "fish"]);
  const sim = stripComments(read("src/shaders/sim.vert.glsl"));
  for (const n of [0, 1, 2]) assert.match(sim, new RegExp(`u_mode == ${n}`));
  assert.match(sim, /vec3 curlAnalytic\(vec3 q\)/);
  assert.match(sim, /simplexValueGradient/);
  assert.match(sim, /cross\(vec3\(0\.0, 1\.0, 0\.0\), pos\)/, "fluid laminar swirl");
  assert.match(sim, /radial \* u_bass \* u_onset/, "fluid bass radial impulse");
  assert.match(sim, /2\.6 \* heat/, "gas buoyancy");
  assert.match(sim, /u_high \* u_high \* 18\.0/, "gas treble burst");
  assert.match(sim, /sin\(phase \* 50\.0 \+ u_time \* 31\.0\) \* u_high/, "fish shimmer");
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
  assert.match(frag, /fwidth\(d\)/);
});

test("particle tiers: 65,536 desktop / 16,384 mobile with FPS step-down", () => {
  assert.deepEqual([...COUNT_TIERS], ["auto", 4096, 16384, 32768, 65536]);
  assert.equal(resolveParticleCount("auto", false), 65536);
  assert.equal(resolveParticleCount("auto", true), 16384);
  assert.equal(resolveParticleCount(32768, false), 32768);
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
  const particles = { flowMode: "fish", shape: "capsule", particleSize: 2.5, kaleidoSegments: 12, kaleidoSpin: false, countTier: 16384 };
  const encoded = encodePresetParam(PARTICLE_SCENE_ID, particles);
  const decoded = decodePresetParam(encoded);
  assert.equal(decoded.sceneId, PARTICLE_SCENE_ID);
  assert.deepEqual(normalizeParticles(decoded.particles), particles);
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
