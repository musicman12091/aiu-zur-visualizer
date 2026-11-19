import { QUALITY_TIERS } from "../render/RenderHost.js";
import {
  CAMERA_ZOOM_RANGE,
  CAMERA_ZOOM_STEP,
  NOISE_GATE_RANGE,
  OSCILLATION_AMOUNT_RANGE,
  OSCILLATION_SPEED_RANGE,
  PARTICLE_SCENE_IDS,
  PARTICLE_SIZE_RANGE,
  REACTIVITY_GAIN_RANGE,
  TRAIL_LENGTH_RANGE,
} from "../render/particleMath.js";
import { DEFAULT_PARTICLES } from "../render/particleMath.js";
import {
  ENGINES, PARTICLE_SIZE_HUD_MAX, QUICK_PRESETS, controlVisible, engineForScene, quickPresetForState,
} from "../app/AppState.js";
import { TEST_BEAT_LABEL, TRACK_ACCEPT } from "../audio/AudioEngine.js";
import { DECK_LAYOUT, fillSelect, optionsFor } from "./hudTabs.js";

/** Flat read-only view of the preset for the deck (no constraints: what is stored is what is shown). */
function deckView(preset) {
  const particles = { ...DEFAULT_PARTICLES, ...(preset?.particles || {}) };
  const visual = preset?.visual || {};
  return {
    ...particles,
    sceneId: preset?.sceneId,
    formation: particles.formationType,
    paletteId: visual.paletteId ?? "neon-tunnel",
    hueShift: visual.hueShift ?? 0,
    cameraMode: visual.cameraMode ?? "orbit-3d",
    chromaticAberration: visual.chromaticAberration ?? 0.30,
    godRays: visual.godRays ?? 0.35,
    quickPreset: preset?.deck?.quickPreset ?? null,
  };
}

const METERS = [
  ["sub", "Sub"],
  ["bass", "Bass"],
  ["lowMid", "Low Mid"],
  ["highMid", "High Mid"],
  ["treble", "Treble"],
  ["rms", "RMS"],
  ["onset", "Onset"],
];

const SELECT_CONTROLS = {
  formation: ["sel-formation", "particles", "formationType"],
  flow: ["sel-flow", "particles", "flowMode"],
  style: ["sel-particle-style", "particles", "particleStyle"],
  kinetic: ["sel-kinetic-mode", "particles", "kineticMode"],
  oscillation: ["sel-oscillation", "particles", "oscillationType"],
  count: ["sel-count", "particles", "particleCountTier"],
  trailType: ["sel-trail-type", "particles", "trailType"],
  pulseLayout: ["sel-pulse-layout", "particles", "pulseLayout"],
  logoText: ["sel-attractor-preset", "particles", "attractorText"],
  reactivityMode: ["sel-reactivity-mode", "particles", "reactivityMode"],
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class ControlHUD {
  constructor(root, state) {
    this.root = root;
    this.state = state;
    this.handlers = {};
    this.meters = {};
    this.controls = {};
    this.frameTick = 0;
    this._build();
    // Status emits (FPS once a second, wake-lock on every pointerdown, capture) only touch the header pills and the
    // capture prompt. Rebuilding the visual controls on them detached the select / slider the user was touching.
    this.state.subscribe((type) => (type === "status" ? this.syncStatus() : this.sync()));
    // ZUR-GH-011: end of a slider drag (anywhere, incl. a cancelled touch) releases the guard and re-syncs once.
    const endDrag = () => {
      if (!this._dragInput) return;
      this._dragInput = null;
      this.sync();
    };
    globalThis.addEventListener?.("pointerup", endDrag, true);
    globalThis.addEventListener?.("pointercancel", endDrag, true);
    this.root.addEventListener("pointerdown", (event) => {
      if (!event.target.closest("#btn-vj-autopilot")) this.handlers.manualTouch?.();
    }, { passive: true });
    this.sync();
  }

  setHandlers(handlers) {
    this.handlers = handlers;
  }

  _build() {
    this.root.replaceChildren();
    const panel = el("aside", "hud control-hud");
    panel.id = "hud";

    this.hideButton = el("button", "hud-hide", "▼ Hide HUD / Fullscreen");
    this.hideButton.type = "button";
    this.hideButton.id = "btn-hide-hud";
    this.hideButton.addEventListener("click", () => this.setHidden(true));
    // ZUR-GH-013: Hide HUD + the Quick Presets strip share one solid sticky header (they never overlap while scrolling).
    this.stickyHeader = el("div", "hud-sticky");
    this.stickyHeader.id = "hud-sticky-header";
    this.stickyHeader.append(this.hideButton);
    panel.append(this.stickyHeader);

    const header = el("div", "hud-header");
    this.toggleButton = el("button", "hud-toggle", "ZUR");
    this.toggleButton.type = "button";
    this.toggleButton.id = "hud-toggle";
    this.toggleButton.setAttribute("aria-expanded", "true");
    this.toggleButton.addEventListener("click", () => this.toggle());
    header.append(this.toggleButton);

    this.pills = {
      wakeLock: this._pill("status-wakelock", "Wake Lock"),
      capture: this._pill("status-capture", "Capture"),
      webgl: this._pill("status-webgl", "WebGL2"),
      fps: this._pill("status-fps", "FPS"),
      particles: this._pill("status-particles", "Swarm"),
    };
    const pills = el("div", "pills");
    pills.append(this.pills.wakeLock, this.pills.capture, this.pills.webgl, this.pills.fps, this.pills.particles);
    header.append(pills);
    panel.append(header);

    this.body = el("div", "hud-body");
    this.body.id = "hud-body";

    // Capture prompt + status stay outside the tabs.
    this.audioPrompt = el("div", "row audio-prompt is-idle");
    this.audioPrompt.id = "audio-prompt";
    this.audioPrompt.setAttribute("role", "group");
    this.audioPrompt.setAttribute("aria-label", "Start audio capture");
    const promptHint = el("p", "audio-prompt-hint", "CAPTURE IDLE — tap to start audio");
    promptHint.id = "audio-prompt-hint";
    this.audioPrompt.append(promptHint);
    this.btnMicPrompt = this._button("btn-mic-prompt", "Mic / call speaker", () => this.handlers.mic?.());
    this.btnOscPrompt = this._button("btn-oscillator-prompt", TEST_BEAT_LABEL, () => this.handlers.oscillator?.());
    this.btnMicPrompt.classList.add("audio-prompt-btn");
    this.btnOscPrompt.classList.add("audio-prompt-btn");
    this.audioPrompt.append(this.btnMicPrompt, this.btnOscPrompt);
    this.body.append(this.audioPrompt);

    // ZUR-GH-012: mic fallback status (shared mode / silent Demo Beat) stays visible outside the tabs.
    this.micStatus = el("p", "mic-status", "");
    this.micStatus.id = "mic-status";
    this.micStatus.setAttribute("role", "status");
    this.micStatus.hidden = true;
    this.body.append(this.micStatus);

    this.title = el("p", "preset-name", "");
    this.body.append(this.title);

    this.error = el("p", "hud-error");
    this.error.id = "hud-error";
    this.error.setAttribute("role", "status");
    this.body.append(this.error);

    // (a) Quick Presets strip: sticky, horizontally scrollable, one-tap non-locking patches.
    this.quickBar = el("div", "hud-tabs hud-quick-presets");
    this.quickBar.id = "hud-quick-presets";
    this.quickBar.setAttribute("role", "toolbar");
    this.quickBar.setAttribute("aria-label", "Quick Presets");
    this.quickButtons = {};
    for (const entry of QUICK_PRESETS) {
      const button = el("button", "hud-tab", entry.label);
      button.type = "button";
      button.id = `quick-${entry.id}`;
      button.dataset.quickPreset = entry.id;
      button.addEventListener("click", () => this.handlers.quickPreset?.(entry.id));
      this.quickButtons[entry.id] = button;
      this.quickBar.append(button);
    }
    this.stickyHeader.append(this.quickBar);

    // (b) Engine Selector.
    this.engineBar = el("div", "hud-subpills hud-engines");
    this.engineBar.id = "hud-engines";
    this.engineBar.setAttribute("role", "radiogroup");
    this.engineBar.setAttribute("aria-label", "Engine");
    this.engineButtons = {};
    for (const engine of ENGINES) {
      const button = el("button", "hud-subpill", engine.label);
      button.type = "button";
      button.id = `engine-${engine.id}`;
      button.dataset.engine = engine.id;
      button.setAttribute("role", "radio");
      button.addEventListener("click", () => this.handlers.engine?.(engine.id));
      this.engineButtons[engine.id] = button;
      this.engineBar.append(button);
    }
    this.body.append(this.engineBar);

    // (c) Unlocked deck: every row is built once and always visible.
    const visual = el("div", "hud-visual");
    visual.id = "hud-visual-controls";
    this.visual = visual;
    this._buildVisualControls();
    this.body.append(visual);

    this.rig = el("div", "hud-rig");
    this.rig.id = "hud-audio-rig";
    this._buildRig();
    this.body.append(this.rig);

    this.hint = el("p", "hint", "H hides the panel. 1 / 2 load Mode A / B. T starts the silent Test Beat (silence + hits). P cycles engines, F cycles flow mode, K cycles kaleidoscope.");
    this.body.append(this.hint);
    panel.append(this.body);
    this.root.append(panel);
    this.panel = panel;
  }

  _buildVisualControls() {
    const add = (name, control) => {
      control.wrap.id = `row-${name}`;
      control.wrap.dataset.control = name;
      control.wrap.hidden = false;
      control.labelEl = control.wrap.querySelector(".field-label") || null;
      this.controls[name] = control;
      this.visual.append(control.wrap);
    };
    const particles = (partial) => this.handlers.particles?.(partial);

    for (const [name, [id, , key]] of Object.entries(SELECT_CONTROLS)) {
      const label = name;
      add(name, this._select(id, label, [], (value) => particles({ [key]: value })));
    }
    // ZUR-GH-014 universal palette: ONE row (Palette + Hue Shift) drives all 5 engines; the Scene Palette row is gone.
    const paletteSelect = this._select("sel-palette", "Palette", [], (value) => particles({ colorPalette: value }));
    const hueShift = this._range("rng-hue", "Hue Shift", -1, 1, 0.01, (value) => {
      this._commit((draft) => { draft.visual.hueShift = value; });
    });
    const paletteRow = el("div", "field-group universal-palette");
    paletteRow.append(paletteSelect.wrap, hueShift.wrap);
    add("palette", { wrap: paletteRow, select: paletteSelect.select });
    this.controls.hueShift = hueShift;
    add("cameraMode", this._select("sel-camera-mode", "Camera Mode", optionsFor("cameraMode"), (value) => {
      this._commit((draft) => { draft.visual.cameraMode = value; });
    }));
    add("kaleido", this._select("sel-kaleido", "Kaleidoscope Mirrors", optionsFor("kaleido"), (value) => {
      particles({ kaleidoSegments: Number(value) });
    }));
    add("kaleidoSpin", this._checkbox("chk-kaleido-spin", "Beat Spin", (checked) => particles({ kaleidoSpin: checked })));
    add("zoom", this._range("rng-camera-zoom", "Camera Zoom", CAMERA_ZOOM_RANGE[0], CAMERA_ZOOM_RANGE[1], CAMERA_ZOOM_STEP, (value) => {
      particles({ cameraZoom: value });
    }));
    add("reactivity", this._range("rng-reactivity", "Reactivity Punch", REACTIVITY_GAIN_RANGE[0], REACTIVITY_GAIN_RANGE[1], 0.1, (value) => {
      particles({ reactivityGain: value });
    }));
    add("size", this._range("rng-size", "Particle Size", PARTICLE_SIZE_RANGE[0], PARTICLE_SIZE_HUD_MAX, 0.05, (value) => {
      particles({ particleSize: value });
    }));
    add("trailLength", this._range("rng-trail-length", "Trail Length", TRAIL_LENGTH_RANGE[0], TRAIL_LENGTH_RANGE[1], 0.01, (value) => {
      particles({ trailLength: value });
    }));
    add("oscAmount", this._range("rng-osc-amount", "Oscillation Amount", OSCILLATION_AMOUNT_RANGE[0], OSCILLATION_AMOUNT_RANGE[1], 0.05, (value) => {
      particles({ oscillationAmount: value });
    }));
    add("oscSpeed", this._range("rng-osc-speed", "Oscillation Speed", OSCILLATION_SPEED_RANGE[0], OSCILLATION_SPEED_RANGE[1], 0.05, (value) => {
      particles({ oscillationSpeed: value });
    }));
    add("chromatic", this._range("rng-chromatic-aberration", "Chromatic Aberration", 0, 1, 0.01, (value) => {
      this._commit((draft) => { draft.visual.chromaticAberration = value; });
    }));
    add("godRays", this._range("rng-god-rays", "God Rays", 0, 1, 0.01, (value) => {
      this._commit((draft) => { draft.visual.godRays = value; });
    }));
  }

  _buildRig() {
    const rig = this.rig;
    const section = (title) => {
      const node = el("fieldset", "rig-section");
      node.append(el("legend", "field-label", title));
      rig.append(node);
      return node;
    };

    const meterBlock = section("Live 5-Band");
    meterBlock.classList.add("meters");
    meterBlock.id = "rig-meters";
    meterBlock.setAttribute("aria-label", "Audio meters");
    for (const [key, label] of METERS) {
      const row = el("div", "meter");
      row.append(el("span", "meter-label", label));
      const track = el("span", "meter-track");
      const fill = el("span", "meter-fill");
      fill.id = `meter-${key}`;
      fill.dataset.meter = key;
      fill.dataset.level = "0";
      fill.style.setProperty("--level", "0");
      track.append(fill);
      row.append(track);
      this.meters[key] = fill;
      meterBlock.append(row);
    }

    // ZUR-GH-013 audio track loader: AudioElement -> MediaElementAudioSourceNode -> AnalyserNode (silent unless
    // Speaker Monitor is checked; mic / tab capture never reach the speakers).
    const track = section("Audio Track");
    track.id = "rig-audio-track";
    const trackLabel = el("label", "file-button track-file", "Load Audio Track (WAV/MP3/OGG)");
    this.trackFile = document.createElement("input");
    this.trackFile.id = "file-audio-track";
    this.trackFile.type = "file";
    this.trackFile.accept = TRACK_ACCEPT;
    this.trackFile.addEventListener("change", () => {
      const file = this.trackFile.files?.[0];
      if (file) this.handlers.trackFile?.(file, this.speakerMonitor.input.checked);
    });
    trackLabel.append(this.trackFile);
    const trackRow = el("div", "row");
    this.trackPlay = this._button("btn-track-play", "Play / Pause", () => this.handlers.trackPlay?.());
    this.trackPlay.disabled = true;
    trackRow.append(trackLabel, this.trackPlay);
    track.append(trackRow);
    this.speakerMonitor = this._checkbox("chk-speaker-monitor", "Speaker Monitor (loaded file only)", (checked) => {
      this.handlers.speakerMonitor?.(checked);
    });
    track.append(this.speakerMonitor.wrap);
    this.trackStatus = el("p", "track-status", "No track loaded");
    this.trackStatus.id = "track-status";
    this.trackStatus.setAttribute("role", "status");
    track.append(this.trackStatus);

    const capture = section("Capture");
    const captureRow = el("div", "row");
    captureRow.append(this._button("btn-tab", "Tab capture", () => this.handlers.tab?.()));
    captureRow.append(this._button("btn-mic", "Mic / call speaker", () => this.handlers.mic?.()));
    captureRow.append(this._button("btn-oscillator", TEST_BEAT_LABEL, () => this.handlers.oscillator?.()));
    captureRow.append(this._button("btn-stop", "Stop", () => this.handlers.stop?.()));
    capture.append(captureRow);
    this.suppress = this._checkbox("chk-suppress", "Suppress local playback", (checked) => {
      const result = this.state.updatePreset((draft) => {
        draft.audio.suppressLocalAudio = checked;
      });
      if (!result.ok) this.setError(result.errors[0]);
      else this.handlers.suppressLocalAudio?.(checked);
    });
    capture.append(this.suppress.wrap);
    this.systemAudio = this._select("sel-system-audio", "System audio", [
      ["exclude", "Tab only (exclude system)"],
      ["include", "Include system audio"],
    ], (value) => {
      this._commit((draft) => {
        draft.audio.includeSystemAudio = value === "include";
      });
    });
    capture.append(this.systemAudio.wrap);
    this.device = this._select("sel-device", "Mic Device", [["", "Default microphone"]], () => {});
    capture.append(this.device.wrap);

    const presets = section("Presets & Gain");
    const modes = el("div", "row");
    modes.append(this._button("btn-mode-a", "Mode A 720p30", () => this.handlers.modeA?.()));
    modes.append(this._button("btn-mode-b", "Mode B 720p60", () => this.handlers.modeB?.()));
    presets.append(modes);
    this.preamp = this._range("rng-preamp", "Pre-Amp Gain", 1, 25, 0.1, (value) => {
      this._commit((draft) => { draft.audio.preAmpGain = value; });
    });
    this.gate = this._range("rng-gate", "Noise Gate", NOISE_GATE_RANGE[0], NOISE_GATE_RANGE[1], 0.001, (value) => {
      this._commit((draft) => { draft.audio.noiseGateThreshold = value; });
    });
    this.gain = this._range("rng-gain", "Visual Gain", 0.1, 5, 0.1, (value) => {
      this._commit((draft) => { draft.visual.gain = value; });
    });
    this.fft = this._select("sel-fft", "FFT Size", [
      ["1024", "1024"],
      ["2048", "2048"],
      ["4096", "4096"],
    ], (value) => {
      this._commit((draft) => { draft.audio.fftSize = Number(value); });
    });
    this.tier = this._select(
      "sel-tier",
      "Quality Tier",
      QUALITY_TIERS.map((tier) => [tier.id, `${tier.label} · ${tier.width}×${tier.height}@${tier.fps}`]),
      (value) => {
        const tier = QUALITY_TIERS.find((item) => item.id === value);
        if (!tier) return;
        this._commit((draft) => {
          draft.visual.qualityTier = tier.id;
          draft.visual.width = tier.width;
          draft.visual.height = tier.height;
          draft.visual.fps = tier.fps;
          draft.visual.complexity = tier.complexity;
        });
      },
    );
    this.density = this._checkbox("chk-density", "Density auto-scale", (checked) => {
      this.handlers.particles?.({ densityAutoScale: checked });
    });
    presets.append(this.preamp.wrap, this.gate.wrap, this.gain.wrap, this.fft.wrap, this.tier.wrap, this.density.wrap);

    const auto = section("VJ Autopilot");
    this.autopilot = el("button", "pill", "⚡ VJ Autopilot (Drop Detector)");
    this.autopilot.type = "button";
    this.autopilot.id = "btn-vj-autopilot";
    this.autopilot.setAttribute("aria-pressed", "false");
    this.autopilot.addEventListener("click", () => {
      this.handlers.autopilot?.(!this.state.preset.visual.vjAutopilot);
    });
    auto.append(this.autopilot);

    this.diagnostics = el("pre", "diagnostics");
    this.diagnostics.id = "diagnostics";
    rig.append(this.diagnostics);

    const presetRow = el("div", "row");
    presetRow.append(this._button("btn-export", "Export preset", () => this.handlers.exportPreset?.()));
    const fileLabel = el("label", "file-button", "Import");
    this.file = document.createElement("input");
    this.file.id = "preset-file";
    this.file.type = "file";
    this.file.accept = "application/json";
    this.file.addEventListener("change", () => {
      const file = this.file.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.handlers.importPreset?.(String(reader.result || ""));
      reader.readAsText(file);
    });
    fileLabel.append(this.file);
    presetRow.append(fileLabel);
    rig.append(presetRow);
    this.json = document.createElement("textarea");
    this.json.id = "preset-json";
    this.json.rows = 6;
    this.json.spellcheck = false;
    rig.append(this.json);
    rig.append(this._button("btn-import", "Apply JSON", () => this.handlers.importPreset?.(this.json.value)));
  }

  /** ZUR-GH-013: loaded-track status (name, play state, Speaker Monitor routing). */
  setTrackState(track) {
    const loaded = Boolean(track?.loaded);
    this.trackPlay.disabled = !loaded;
    const text = loaded
      ? `${track.playing ? "▶ Playing" : "⏸ Paused"} · ${track.name}${track.monitorConnected ? " · Speaker Monitor ON" : " · silent analysis"}`
      : "No track loaded";
    if (this.trackStatus.textContent !== text) this.trackStatus.textContent = text;
    this.trackStatus.dataset.playing = String(Boolean(track?.playing));
    if (typeof track?.speakerMonitor === "boolean" && this.speakerMonitor.input.checked !== track.speakerMonitor) {
      this.speakerMonitor.input.checked = track.speakerMonitor;
    }
  }

  _pill(id, label) {
    const node = el("span", "pill", label);
    node.id = id;
    node.dataset.state = "off";
    return node;
  }

  _button(id, label, onClick) {
    const button = el("button", "hud-button", label);
    button.type = "button";
    button.id = id;
    button.addEventListener("click", onClick);
    return button;
  }

  _checkbox(id, label, onChange) {
    const wrap = el("label", "check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.addEventListener("change", () => onChange(input.checked));
    wrap.append(input, el("span", "field-label", label));
    return { wrap, label: wrap, input };
  }

  _select(id, label, options, onChange) {
    const wrap = el("label", "field");
    const span = el("span", "field-label", label);
    const select = document.createElement("select");
    select.id = id;
    fillSelect(select, options);
    select.addEventListener("change", () => onChange(select.value));
    // ZUR-GH-011: values skipped while the picker was open (focus guard) are reconciled once it closes.
    select.addEventListener("blur", () => this.sync());
    wrap.append(span, select);
    return { wrap, select };
  }

  _range(id, label, min, max, step, onInput) {
    const wrap = el("label", "field");
    const span = el("span", "field-label", label);
    const value = el("span", "field-value", "");
    const head = el("span", "field-head");
    head.append(span, value);
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    // ZUR-GH-011: guard this slider against state echoes while the finger / mouse is down on it.
    input.addEventListener("pointerdown", () => { this._dragInput = input; });
    input.addEventListener("input", () => {
      value.textContent = input.value;
      onInput(Number(input.value));
    });
    wrap.append(head, input);
    return { wrap, input, value };
  }

  _commit(mutate) {
    const result = this.state.updatePreset(mutate);
    if (!result.ok) this.setError(result.errors[0]);
    else this.setError("");
    return result;
  }

  toggle(force) {
    const collapsed = typeof force === "boolean" ? force : !this.panel.classList.contains("is-collapsed");
    this.panel.classList.toggle("is-collapsed", collapsed);
    this.toggleButton.setAttribute("aria-expanded", String(!collapsed));
  }

  /** True while the full drawer is showing (neither collapsed to the ZUR chip nor hidden). */
  isOpen() {
    return !this.panel.classList.contains("is-collapsed") && !this.panel.classList.contains("is-hidden");
  }

  setHidden(hidden) {
    this.panel.classList.toggle("is-hidden", hidden);
    this.root.classList.toggle("is-hidden", hidden);
  }

  toggleHidden() {
    this.setHidden(!this.panel.classList.contains("is-hidden"));
  }

  setDevices(devices) {
    const select = this.device.select;
    const current = select.value;
    const options = [{ value: "", label: "Default microphone" }];
    let index = 1;
    for (const device of devices) {
      if (device.kind !== "audioinput") continue;
      options.push({ value: device.deviceId, label: device.label || `Microphone ${index}` });
      index += 1;
    }
    fillSelect(select, options);
    select.value = [...select.options].some((option) => option.value === current) ? current : "";
  }

  selectedDeviceId() {
    return this.device.select.value || null;
  }

  setMicStatus(text) {
    const label = text || "";
    if (this.micStatus.textContent !== label) this.micStatus.textContent = label;
    this.micStatus.hidden = !label;
  }

  setError(message) {
    this.error.textContent = message || "";
  }

  setDiagnostics(diagnostics) {
    this.diagnostics.textContent = JSON.stringify(diagnostics, null, 2);
  }

  setFrame(frame, fps) {
    for (const [key] of METERS) {
      const value = Number.isFinite(frame[key]) ? frame[key] : 0;
      const fill = this.meters[key];
      fill.style.setProperty("--level", String(value));
      fill.dataset.level = value.toFixed(4);
    }
    this.pills.fps.dataset.state = fps ? "active" : "off";
    this.pills.fps.textContent = fps ? `${fps} FPS` : "FPS";
    this.frameTick += 1;
    if (this.particleSystem && this.frameTick % 30 === 0) {
      const active = PARTICLE_SCENE_IDS.includes(this.state.preset.sceneId) && this.particleSystem.ready;
      const count = this.particleSystem.count;
      const countText = count >= 1024 ? `${Math.round(count / 1024)}k` : String(count);
      const text = active ? `${countText} · ${this.particleSystem.sceneFormat}` : "Swarm off";
      if (this.pills.particles.textContent !== text) {
        this.pills.particles.textContent = text;
        this.pills.particles.dataset.state = active ? "active" : "off";
        this.pills.particles.dataset.count = String(count);
      }
    }
  }

  setParticleStatus(particleSystem) {
    this.particleSystem = particleSystem || null;
    if (!particleSystem) {
      this.pills.particles.textContent = "Swarm unavailable";
      this.pills.particles.dataset.state = "unavailable";
    }
  }

  fillJson() {
    this.json.value = this.state.exportPreset();
  }

  _setSlider(control, value, text) {
    // ZUR-GH-011: a slider under an active pointer drag is never overwritten from state (its own input events already
    // drive state); the pointer-release handler re-syncs it once.
    if (control.input === this._dragInput) return;
    // Only write when the value really changed so an in-progress drag is never fought by its own echo.
    if (Number(control.input.value) !== Number(value)) control.input.value = String(value);
    if (control.value.textContent !== text) control.value.textContent = text;
  }

  /**
   * ZUR-GH-010 fix: idempotent DOM writes. Rows are only re-ordered when the layout key changes, a <select> is only
   * rebuilt when its option list changes, and values are only assigned when they differ. Moving or rebuilding the
   * focused control (as every sync() used to do) blurs it, closes the native picker and cancels slider drags.
   */
  _applyLayout(key, layout) {
    if (this._layoutKey === key) return;
    this._layoutKey = key;
    for (const [name, label, extras] of layout) {
      const control = this.controls[name];
      if (!control) continue;
      if (control.labelEl && control.labelEl.textContent !== label) control.labelEl.textContent = label;
      if (control.input && control.input.type === "range") {
        const fallback = name === "trailLength" ? TRAIL_LENGTH_RANGE : null;
        const min = String(extras?.min ?? (fallback ? fallback[0] : control.input.min));
        const max = String(extras?.max ?? (fallback ? fallback[1] : control.input.max));
        if (control.input.min !== min) control.input.min = min;
        if (control.input.max !== max) control.input.max = max;
      }
      this.visual.append(control.wrap);
    }
  }

  _syncSelect(control, options, value) {
    const signature = JSON.stringify(options);
    if (control.optionsSignature !== signature && document.activeElement !== control.select) {
      fillSelect(control.select, options);
      control.optionsSignature = signature;
    }
    this._setSelectValue(control.select, value);
  }

  /**
   * ZUR-GH-011: never assign into a focused <select> (on Android Chrome that closes the open native picker); the blur
   * handler re-syncs it once the picker is dismissed.
   */
  _setSelectValue(select, value) {
    if (select.value !== value && document.activeElement !== select) select.value = value;
  }

  _setHidden(node, hidden) {
    if (node.hidden !== hidden) node.hidden = hidden;
  }

  sync() {
    const preset = this.state.preset;
    const audio = preset.audio;
    const visual = preset.visual;
    const flat = deckView(preset);
    this.title.textContent = preset.name || preset.sceneId;

    // Quick Presets strip + Engine Selector: highlight only (never re-built, never constraining).
    // ZUR-GH-014: a pill lights only when the live sceneId + formation really match it (never stuck on Gargantua).
    const matchedQuick = quickPresetForState(preset);
    const activeAttr = matchedQuick ?? "";
    if (this.quickBar.dataset.active !== activeAttr) this.quickBar.dataset.active = activeAttr;
    for (const [id, button] of Object.entries(this.quickButtons)) {
      const active = id === matchedQuick;
      if (button.getAttribute("aria-pressed") !== String(active)) button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    }
    const engine = engineForScene(preset.sceneId);
    for (const [id, button] of Object.entries(this.engineButtons)) {
      const active = id === engine;
      if (button.getAttribute("aria-checked") !== String(active)) button.setAttribute("aria-checked", String(active));
      button.classList.toggle("is-active", active);
    }
    if (this.visual.dataset.activeEngine !== engine) this.visual.dataset.activeEngine = engine;

    // ZUR-GH-011 / 013: the deck is laid out exactly once; every later update diffs options and values in place, so
    // the focused select / dragged slider is never moved, rebuilt or snapped back.
    this._applyLayout("deck", DECK_LAYOUT);
    for (const [name] of DECK_LAYOUT) {
      const control = this.controls[name];
      if (!control) continue;
      // ZUR-GH-014: only controls wired to the active engine are shown (hidden rows keep their values).
      this._setHidden(control.wrap, !controlVisible(name, preset));
      if (control.select) this._syncSelect(control, optionsFor(name), this._valueFor(name, flat));
    }

    this._setSlider(this.controls.zoom, flat.cameraZoom, `${Number(flat.cameraZoom).toFixed(2)}×`);
    this._setSlider(this.controls.reactivity, flat.reactivityGain, Number(flat.reactivityGain).toFixed(1));
    this._setSlider(this.controls.size, flat.particleSize, `${Number(flat.particleSize).toFixed(2)}×`);
    this._setSlider(this.controls.trailLength, flat.trailLength, Number(flat.trailLength).toFixed(2));
    this._setSlider(this.controls.oscAmount, flat.oscillationAmount, Number(flat.oscillationAmount).toFixed(2));
    this._setSlider(this.controls.oscSpeed, flat.oscillationSpeed, `${Number(flat.oscillationSpeed).toFixed(2)}×`);
    this._setSlider(this.controls.hueShift, flat.hueShift, Number(flat.hueShift).toFixed(2));
    this._setSlider(this.controls.chromatic, flat.chromaticAberration, Number(flat.chromaticAberration).toFixed(2));
    this._setSlider(this.controls.godRays, flat.godRays, Number(flat.godRays).toFixed(2));
    if (this.controls.kaleidoSpin.input.checked !== flat.kaleidoSpin) this.controls.kaleidoSpin.input.checked = flat.kaleidoSpin;

    if (this.suppress.input.checked !== audio.suppressLocalAudio) this.suppress.input.checked = audio.suppressLocalAudio;
    const systemAudio = audio.includeSystemAudio ? "include" : "exclude";
    this._setSelectValue(this.systemAudio.select, systemAudio);
    this._setSlider(this.preamp, audio.preAmpGain, `${Number(audio.preAmpGain).toFixed(1)}×`);
    const gate = audio.noiseGateThreshold ?? 0.015;
    this._setSlider(this.gate, gate, Number(gate).toFixed(3));
    this._setSlider(this.gain, visual.gain ?? 1, Number(visual.gain ?? 1).toFixed(1));
    const fft = String(audio.fftSize || 2048);
    this._setSelectValue(this.fft.select, fft);
    const tier = visual.qualityTier || "safe";
    this._setSelectValue(this.tier.select, tier);
    if (this.density.input.checked !== flat.densityAutoScale) this.density.input.checked = flat.densityAutoScale;
    this.autopilot.setAttribute("aria-pressed", String(Boolean(visual.vjAutopilot)));
    this.autopilot.dataset.state = visual.vjAutopilot ? "active" : "off";
    this.syncStatus();
  }

  /** Header pills + capture prompt only; safe to run on every status emit. */
  syncStatus() {
    const captureIdle = (this.state.status.capture || "idle") === "idle";
    this.audioPrompt.classList.toggle("is-idle", captureIdle);
    this._setHidden(this.audioPrompt, !captureIdle);
    this._setPill(this.pills.wakeLock, this.state.status.wakeLock, `Wake ${this.state.status.wakeLock}`);
    const capture = this.state.status.capture;
    this._setPill(this.pills.capture, capture, capture === "oscillator" ? "Test Beat" : `Capture ${capture}`);
    this._setPill(this.pills.webgl, this.state.status.webgl, this.state.status.webgl === "webgl2" ? "WebGL2" : `WebGL ${this.state.status.webgl}`);
  }

  _valueFor(name, flat) {
    switch (name) {
      case "formation": return flat.formation;
      case "flow": return flat.flowMode;
      case "style": return flat.particleStyle;
      case "kinetic": return flat.kineticMode;
      case "oscillation": return flat.oscillationType;
      case "count": return flat.particleCountTier;
      case "trailType": return flat.trailType;
      case "pulseLayout": return flat.pulseLayout;
      case "logoText": return flat.attractorText;
      case "cameraMode": return flat.cameraMode;
      case "kaleido": return String(flat.kaleidoSegments);
      case "palette": return flat.colorPalette;
      case "reactivityMode": return flat.reactivityMode;
      default: return "";
    }
  }

  _setPill(node, state, text) {
    if (node.dataset.state !== (state || "off")) node.dataset.state = state || "off";
    if (node.textContent !== text) node.textContent = text;
  }
}
