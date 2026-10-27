import { AppState, MODE_A_PRESET, MODE_B_PRESET, validatePreset } from "./AppState.js";
import { FeatureExtractor } from "../audio/FeatureExtractor.js";
import {
  getAudioContext,
  getDiagnostics,
  readSnapshot,
  resumeContext,
  setFftSize,
  setSuppressLocalAudioPlayback,
  setVideoSink,
  startMicCapture,
  startTabCapture,
  startTestOscillator,
  stopCapture,
} from "../audio/AudioEngine.js";
import { ShaderHost } from "../render/ShaderHost.js";
import { RenderHost } from "../render/RenderHost.js";
import { TransitionController } from "../render/TransitionController.js";
import { ControlHUD } from "../controls/ControlHUD.js";

const STORAGE_KEY = "zur.preset.v1";

function loadInitialPreset() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return MODE_A_PRESET;
    const result = validatePreset(JSON.parse(saved));
    return result.ok ? result.preset : MODE_A_PRESET;
  } catch {
    return MODE_A_PRESET;
  }
}

const state = new AppState(loadInitialPreset());
const extractor = new FeatureExtractor({
  preAmpGain: state.preset.audio.preAmpGain,
  noiseGateThreshold: state.preset.audio.noiseGateThreshold,
  masterGain: state.preset.audio.masterGain,
  bandGain: state.preset.audio.bandGain,
});
extractor.setMediumEnvelope(state.preset.audio.attackMs, state.preset.audio.releaseMs);

const canvas = document.getElementById("stage");
const shaderHost = new ShaderHost(canvas);
const transition = new TransitionController({
  mode: state.preset.transition.mode,
  minimumDwellSeconds: state.preset.transition.minimumDwellSeconds,
  blendSeconds: state.preset.transition.blendSeconds,
  sceneId: state.preset.sceneId,
});
const hud = new ControlHUD(document.getElementById("hud-root"), state);
setVideoSink(document.getElementById("capture-sink"));

let wakeLockSentinel = null;

function applyExtractor(preset) {
  extractor.setPreAmpGain(preset.audio.preAmpGain);
  extractor.setMix({
    masterGain: preset.audio.masterGain,
    bandGain: preset.audio.bandGain,
    noiseGateThreshold: preset.audio.noiseGateThreshold ?? 0.02,
  });
  extractor.setMediumEnvelope(preset.audio.attackMs, preset.audio.releaseMs);
  setFftSize(preset.audio.fftSize || 2048);
  transition.mode = preset.transition.mode;
  transition.minimumDwellSeconds = preset.transition.minimumDwellSeconds;
  transition.blendSeconds = preset.transition.blendSeconds;
}

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) {
    state.setStatus({ wakeLock: "unsupported" });
    return;
  }
  if (wakeLockSentinel && !wakeLockSentinel.released) {
    state.setStatus({ wakeLock: "active" });
    return;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      const visible = document.visibilityState === "visible";
      state.setStatus({ wakeLock: visible ? "released" : "hidden" });
    });
    state.setStatus({ wakeLock: "active" });
  } catch (error) {
    state.setStatus({ wakeLock: error?.name === "NotAllowedError" ? "needs-gesture" : "denied" });
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void acquireWakeLock();
    void resumeContext();
  }
});

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, state.exportPreset());
  } catch {
    // Private mode can reject storage; the session still runs.
  }
}

function publishDiagnostics() {
  hud.setDiagnostics(getDiagnostics());
}

function watchCapture(pending, mode) {
  pending.then((result) => {
    if (!result) return;
    state.setStatus({ capture: mode });
    hud.setError("");
    publishDiagnostics();
    if (mode === "microphone") void refreshDevices();
  }).catch((error) => {
    state.setStatus({ capture: "error" });
    hud.setError(error?.message || "Capture failed");
    publishDiagnostics();
  });
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  hud.setDevices(devices);
}

const host = new RenderHost({
  canvas,
  shaderHost,
  extractor,
  transition,
  getPreset: () => state.preset,
  readAudio: readSnapshot,
  onFrame: ({ frame, fps }) => {
    hud.setFrame(frame, fps);
    if (fps && state.status.fps !== fps) state.setStatus({ fps });
  },
});

hud.setHandlers({
  modeA: () => {
    state.replacePreset(MODE_A_PRESET);
    hud.fillJson();
  },
  modeB: () => {
    state.replacePreset(MODE_B_PRESET);
    hud.fillJson();
  },
  tab: () => {
    const audio = state.preset.audio;
    const pending = startTabCapture({
      suppressLocalAudio: audio.suppressLocalAudio,
      includeSystemAudio: audio.includeSystemAudio,
      fftSize: audio.fftSize || 2048,
    });
    void acquireWakeLock();
    watchCapture(pending, "tab-capture");
  },
  mic: () => {
    const pending = startMicCapture({
      deviceId: hud.selectedDeviceId(),
      fftSize: state.preset.audio.fftSize || 2048,
    });
    void acquireWakeLock();
    watchCapture(pending, "microphone");
  },
  oscillator: () => {
    const pending = startTestOscillator({ fftSize: state.preset.audio.fftSize || 2048 });
    void acquireWakeLock();
    watchCapture(pending, "oscillator");
  },
  stop: () => {
    void stopCapture().then(() => {
      state.setStatus({ capture: "idle" });
      hud.setError("");
      publishDiagnostics();
    });
  },
  suppressLocalAudio: (enabled) => {
    void setSuppressLocalAudioPlayback(enabled).then(() => publishDiagnostics());
  },
  exportPreset: () => {
    const json = state.exportPreset();
    hud.fillJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.preset.sceneId}-preset.json`;
    link.click();
    URL.revokeObjectURL(url);
  },
  importPreset: (json) => {
    const result = state.importPreset(json);
    if (!result.ok) hud.setError(result.errors[0]);
    else {
      hud.setError("");
      hud.fillJson();
    }
  },
});

state.subscribe((type) => {
  if (type === "preset") {
    applyExtractor(state.preset);
    persist();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
    return;
  }
  if (event.key === "h" || event.key === "H") hud.toggle();
  if (event.key === "1") hud.handlers.modeA?.();
  if (event.key === "2") hud.handlers.modeB?.();
  if (event.key === "t" || event.key === "T") hud.handlers.oscillator?.();
  if (event.key === "Escape") hud.toggle(true);
});

async function boot() {
  window.__ZUR_BOOT__ = "pending";
  applyExtractor(state.preset);
  hud.fillJson();
  state.setStatus({
    webgl: shaderHost.gl ? "webgl2" : "unavailable",
    capture: "idle",
  });
  const response = await fetch(new URL("../scenes/aurora-ribbons.glsl", import.meta.url));
  if (!response.ok) throw new Error("Could not load aurora-ribbons.glsl");
  shaderHost.setSceneSource(await response.text());
  host.applySize();
  host.start();
  void acquireWakeLock();
  void refreshDevices();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  publishDiagnostics();
  const debug = new URLSearchParams(location.search).has("debug");
  if (debug) {
    window.__ZUR_DEBUG__ = {
      state,
      extractor,
      shaderHost,
      renderHost: host,
      getDiagnostics,
      readSnapshot,
      getAudioContext,
    };
  }
  window.__ZUR_BOOT__ = "ok";
}

document.addEventListener("pointerdown", () => {
  void acquireWakeLock();
}, { passive: true });

void boot().catch((error) => {
  window.__ZUR_BOOT__ = "error";
  state.setStatus({ webgl: shaderHost.gl ? state.status.webgl : "unavailable" });
  hud.setError(error?.message || "Startup failed");
  console.error(error);
});
