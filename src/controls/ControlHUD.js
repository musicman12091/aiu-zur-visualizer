import { PALETTE_IDS, PALETTES } from "./palettes.js";
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
import { PARTICLE_SIZE_HUD_MAX, enforceTabConstraints, flattenPreset, switchPresetTab } from "../app/AppState.js";
import {
  CONTROL_LAYOUT,
  HUD_TABS,
  SHADER_SCENES,
  SHADER_SCENE_LABELS,
  SWARM_MODES,
  SWARM_MODE_LABELS,
  TAB_LABELS,
  fillSelect,
  layoutKey,
  optionsFor,
  paletteTarget,
} from "./hudTabs.js";

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
    this.state.subscribe(() => this.sync());
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
    panel.append(this.hideButton);

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
    this.btnOscPrompt = this._button("btn-oscillator-prompt", "Test oscillator", () => this.handlers.oscillator?.());
    this.btnMicPrompt.classList.add("audio-prompt-btn");
    this.btnOscPrompt.classList.add("audio-prompt-btn");
    this.audioPrompt.append(this.btnMicPrompt, this.btnOscPrompt);
    this.body.append(this.audioPrompt);

    this.title = el("p", "preset-name", "");
    this.body.append(this.title);

    this.error = el("p", "hud-error");
    this.error.id = "hud-error";
    this.error.setAttribute("role", "status");
    this.body.append(this.error);

    // Sticky, horizontally scrollable tab bar.
    this.tabBar = el("div", "hud-tabs");
    this.tabBar.id = "hud-tabs";
    this.tabBar.setAttribute("role", "tablist");
    this.tabButtons = {};
    for (const tab of HUD_TABS) {
      const button = el("button", "hud-tab", TAB_LABELS[tab]);
      button.type = "button";
      button.id = `tab-${tab}`;
      button.dataset.hudTab = tab;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => this._switch(tab));
      this.tabButtons[tab] = button;
      this.tabBar.append(button);
    }
    this.body.append(this.tabBar);

    this.swarmPills = this._pillGroup("swarm-pills", "swarmMode", SWARM_MODES, SWARM_MODE_LABELS, (mode) => {
      this._switch("blood-swarm", { swarmMode: mode });
    });
    this.shaderPills = this._pillGroup("shader-pills", "shaderScene", SHADER_SCENES, SHADER_SCENE_LABELS, (scene) => {
      this._switch("canyon-pulse", { shaderScene: scene });
    });
    this.body.append(this.swarmPills.group, this.shaderPills.group);

    // Visual controls: every row is built once; the layout of the active tab decides which are visible.
    const visual = el("div", "hud-visual");
    visual.id = "hud-visual-controls";
    this.visual = visual;
    this._buildVisualControls();
    this.body.append(visual);

    this.rig = el("div", "hud-rig");
    this.rig.id = "hud-audio-rig";
    this._buildRig();
    this.body.append(this.rig);

    this.hint = el("p", "hint", "H hides the panel. 1 / 2 load Mode A / B. T starts the silent test oscillator. P cycles visual tabs, F cycles flow mode, K cycles kaleidoscope.");
    this.body.append(this.hint);
    panel.append(this.body);
    this.root.append(panel);
    this.panel = panel;
  }

  _buildVisualControls() {
    const add = (name, control) => {
      control.wrap.id = `row-${name}`;
      control.wrap.dataset.control = name;
      control.wrap.hidden = true;
      control.labelEl = control.wrap.querySelector(".field-label") || null;
      this.controls[name] = control;
      this.visual.append(control.wrap);
    };
    const particles = (partial) => this.handlers.particles?.(partial);

    for (const [name, [id, , key]] of Object.entries(SELECT_CONTROLS)) {
      const label = name;
      add(name, this._select(id, label, [], (value) => particles({ [key]: value })));
    }
    add("palette", this._select("sel-palette", "Palette", [], (value) => {
      if (this._paletteTarget === "scene") this._commit((draft) => { draft.visual.paletteId = value; });
      else particles({ colorPalette: value });
    }));
    add("cameraMode", this._select("sel-camera-mode", "Camera Mode", optionsFor("cameraMode", "deep-space"), (value) => {
      this._commit((draft) => { draft.visual.cameraMode = value; });
    }));
    add("kaleido", this._select("sel-kaleido", "Kaleidoscope Mirrors", optionsFor("kaleido", "deep-space"), (value) => {
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
    add("hueShift", this._range("rng-hue", "Hue Shift", -1, 1, 0.01, (value) => {
      this._commit((draft) => { draft.visual.hueShift = value; });
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

    const capture = section("Capture");
    const captureRow = el("div", "row");
    captureRow.append(this._button("btn-tab", "Tab capture", () => this.handlers.tab?.()));
    captureRow.append(this._button("btn-mic", "Mic / call speaker", () => this.handlers.mic?.()));
    captureRow.append(this._button("btn-oscillator", "Test oscillator", () => this.handlers.oscillator?.()));
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

  _pillGroup(id, dataKey, ids, labels, onPick) {
    const group = el("div", "hud-subpills");
    group.id = id;
    group.hidden = true;
    const buttons = {};
    for (const value of ids) {
      const button = el("button", "hud-subpill", labels[value]);
      button.type = "button";
      button.dataset[dataKey === "swarmMode" ? "swarmMode" : "shaderScene"] = value;
      button.addEventListener("click", () => onPick(value));
      buttons[value] = button;
      group.append(button);
    }
    return { group, buttons };
  }

  _switch(hudTab, options) {
    const result = this.state.replacePreset(switchPresetTab(this.state.preset, hudTab, options));
    if (!result.ok) this.setError(result.errors[0]);
    else this.setError("");
    return result;
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
    control.input.value = String(value);
    control.value.textContent = text;
  }

  sync() {
    const preset = this.state.preset;
    const audio = preset.audio;
    const visual = preset.visual;
    const flat = enforceTabConstraints(flattenPreset(preset));
    const key = layoutKey(flat);
    const layout = CONTROL_LAYOUT[key] || [];
    const onRig = flat.hudTab === "audio-rig";
    this._paletteTarget = paletteTarget(key);
    this.title.textContent = preset.name || preset.sceneId;

    for (const tab of HUD_TABS) {
      const active = tab === flat.hudTab;
      this.tabButtons[tab].setAttribute("aria-selected", String(active));
      this.tabButtons[tab].classList.toggle("is-active", active);
    }
    const swarmShown = flat.hudTab === "blood-swarm" || (onRig && flat.visualTab === "blood-swarm");
    const shaderShown = flat.hudTab === "canyon-pulse" || (onRig && flat.visualTab === "canyon-pulse");
    this.swarmPills.group.hidden = !(flat.hudTab === "blood-swarm");
    this.shaderPills.group.hidden = !(flat.hudTab === "canyon-pulse");
    for (const mode of SWARM_MODES) this.swarmPills.buttons[mode].classList.toggle("is-active", swarmShown && mode === flat.swarmMode);
    for (const scene of SHADER_SCENES) this.shaderPills.buttons[scene].classList.toggle("is-active", shaderShown && scene === flat.shaderScene);
    this.visual.hidden = onRig;
    this.rig.hidden = !onRig;
    this.visual.dataset.layout = key;
    this.rig.dataset.tab = flat.hudTab;

    // Visibility + order + per-tab labels / options.
    const shown = new Set();
    for (const [name, label, extras] of layout) {
      const control = this.controls[name];
      if (!control) continue;
      shown.add(name);
      control.wrap.hidden = onRig ? true : false;
      if (control.labelEl) control.labelEl.textContent = label;
      if (control.select) {
        const current = this._valueFor(name, flat);
        fillSelect(control.select, optionsFor(name, key));
        control.select.value = current;
      }
      if (extras && control.input) {
        control.input.min = String(extras.min ?? control.input.min);
        control.input.max = String(extras.max ?? control.input.max);
      }
      this.visual.append(control.wrap);
    }
    for (const [name, control] of Object.entries(this.controls)) {
      if (!shown.has(name)) control.wrap.hidden = true;
    }
    const trailLayout = layout.find(([name]) => name === "trailLength");
    if (!trailLayout?.[2] && this.controls.trailLength) {
      this.controls.trailLength.input.min = String(TRAIL_LENGTH_RANGE[0]);
      this.controls.trailLength.input.max = String(TRAIL_LENGTH_RANGE[1]);
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
    this.controls.kaleidoSpin.input.checked = flat.kaleidoSpin;

    this.suppress.input.checked = audio.suppressLocalAudio;
    this.systemAudio.select.value = audio.includeSystemAudio ? "include" : "exclude";
    this._setSlider(this.preamp, audio.preAmpGain, `${Number(audio.preAmpGain).toFixed(1)}×`);
    const gate = audio.noiseGateThreshold ?? 0.015;
    this._setSlider(this.gate, gate, Number(gate).toFixed(3));
    this._setSlider(this.gain, visual.gain ?? 1, Number(visual.gain ?? 1).toFixed(1));
    this.fft.select.value = String(audio.fftSize || 2048);
    this.tier.select.value = visual.qualityTier || "safe";
    this.density.input.checked = flat.densityAutoScale;

    const captureIdle = (this.state.status.capture || "idle") === "idle";
    this.audioPrompt.classList.toggle("is-idle", captureIdle);
    this.audioPrompt.hidden = !captureIdle;
    this.autopilot.setAttribute("aria-pressed", String(Boolean(visual.vjAutopilot)));
    this.autopilot.dataset.state = visual.vjAutopilot ? "active" : "off";
    this._setPill(this.pills.wakeLock, this.state.status.wakeLock, `Wake ${this.state.status.wakeLock}`);
    this._setPill(this.pills.capture, this.state.status.capture, `Capture ${this.state.status.capture}`);
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
      case "palette": return this._paletteTarget === "scene" ? (PALETTES[flat.paletteId] ? flat.paletteId : PALETTE_IDS[0]) : flat.colorPalette;
      default: return "";
    }
  }

  _setPill(node, state, text) {
    node.dataset.state = state || "off";
    node.textContent = text;
  }
}
