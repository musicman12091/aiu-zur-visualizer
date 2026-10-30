import { PALETTE_IDS, PALETTES } from "./palettes.js";
import { QUALITY_TIERS } from "../render/RenderHost.js";
import {
  COUNT_TIERS,
  COUNT_TIER_LABELS,
  DEFAULT_PARTICLES,
  FLOW_LABELS,
  FLOW_MODES,
  FORMATION_TYPES,
  KALEIDO_SEGMENTS,
  OSCILLATION_AMOUNT_RANGE,
  OSCILLATION_SPEED_RANGE,
  OSCILLATION_TYPES,
  PARTICLE_SCENE_ID,
  PARTICLE_SCENE_IDS,
  PARTICLE_SIZE_RANGE,
  PULSE_LAYOUTS,
  PULSE_SCENE_ID,
  TRAIL_LENGTH_RANGE,
  TRAIL_TYPES,
} from "../render/particleMath.js";

const METERS = [
  ["sub", "Sub"],
  ["bass", "Bass"],
  ["lowMid", "Low mid"],
  ["highMid", "High mid"],
  ["treble", "Treble"],
  ["rms", "RMS"],
  ["onset", "Onset"],
];

const PULSE_SCENE_LABEL = "3D Audio Pulse Field — Stage 3";
const LABELS = {
  trail: { comet: "Comet", electric: "Electric", strobe: "Strobe", ribbon: "Ribbon", none: "None" },
  formation: { "free-3d": "Free 3D", "neon-tunnel": "Neon Tunnel", "polygon-rings": "Polygon Rings", "supernova-shell": "Supernova Shell" },
  oscillation: { off: "Off", wave: "Wave", helix: "Helix", bounce: "Bounce", pulse: "Pulse" },
  layout: { "band-clouds": "Band Clouds", "geodesic-sphere": "Geodesic Sphere", "wave-grid": "Wave Grid" },
};

function labelPairs(ids, labels) {
  return ids.map((id) => [id, labels[id]]);
}

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
    this.frameTick = 0;
    this._build();
    this.state.subscribe(() => this.sync());
    this.sync();
  }

  setHandlers(handlers) {
    this.handlers = handlers;
  }

  _build() {
    this.root.replaceChildren();
    const panel = el("aside", "hud");
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

    // Scene, Palette and Hue shift stay together at the very top of the HUD.
    this.scene = this._select("sel-scene", "Scene", [
      [PARTICLE_SCENE_ID, "3D Particle Swarm"],
      [PULSE_SCENE_ID, PULSE_SCENE_LABEL],
      ["aurora-ribbons", "Aurora Ribbons (Stage 1)"],
    ], (value) => this.handlers.scene?.(value));
    this.palette = this._select(
      "sel-palette",
      "Palette",
      PALETTE_IDS.map((id) => [id, id]),
      (value) => {
        this._commit((draft) => {
          draft.visual.paletteId = value;
        });
      },
    );
    this.hue = this._range("rng-hue", "Hue shift", -1, 1, 0.01, (value) => {
      this._commit((draft) => {
        draft.visual.hueShift = value;
      });
    });
    const topControls = el("div", "top-controls");
    topControls.id = "top-controls";
    topControls.append(this.scene.wrap, this.palette.wrap, this.hue.wrap);
    this.body.append(topControls);
    this.title = el("p", "preset-name", "");
    this.body.append(this.title);

    const meterBlock = el("div", "meters");
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
    this.body.append(meterBlock);

    this.error = el("p", "hud-error");
    this.error.id = "hud-error";
    this.error.setAttribute("role", "status");
    this.body.append(this.error);

    const modes = el("div", "row");
    modes.append(this._button("btn-mode-a", "Mode A 720p30", () => this.handlers.modeA?.()));
    modes.append(this._button("btn-mode-b", "Mode B 720p60", () => this.handlers.modeB?.()));
    this.body.append(modes);

    // Stage 2 — scene + 3D particle swarm controls.
    const stage2 = el("fieldset", "stage2");
    stage2.id = "stage2-controls";
    stage2.append(el("legend", "field-label", "Stage 3 · 3D swarm"));
    this.flow = this._select("sel-flow", "Flow mode", FLOW_MODES.map((id) => [id, FLOW_LABELS[id]]), (value) => {
      this.handlers.particles?.({ flowMode: value });
    });
    this.shape = this._select("sel-shape", "3D shape", [
      ["dart", "3D Fish/Bird Dart"],
      ["capsule", "Velocity Capsule"],
    ], (value) => this.handlers.particles?.({ shape: value }));
    this.size = this._range("rng-size", "Particle size", PARTICLE_SIZE_RANGE[0], PARTICLE_SIZE_RANGE[1], 0.05, (value) => {
      this.handlers.particles?.({ particleSize: value });
    });
    this.kaleido = this._select(
      "sel-kaleido",
      "Kaleidoscope segments",
      KALEIDO_SEGMENTS.map((n) => [String(n), n === 0 ? "Off" : `${n} mirrors`]),
      (value) => this.handlers.particles?.({ kaleidoSegments: Number(value) }),
    );
    this.spin = this._checkbox("chk-kaleido-spin", "Kaleidoscope spin (beat-synced)", (checked) => {
      this.handlers.particles?.({ kaleidoSpin: checked });
    });
    this.count = this._select(
      "sel-count",
      "Particle count tier",
      COUNT_TIERS.map((tier) => [tier, COUNT_TIER_LABELS[tier] || tier]),
      (value) => this.handlers.particles?.({ particleCountTier: value }),
    );
    this.density = this._checkbox("chk-density", "Density auto-scale", (checked) => {
      this.handlers.particles?.({ densityAutoScale: checked });
    });
    this.trailType = this._select("sel-trail-type", "Trail type", labelPairs(TRAIL_TYPES, LABELS.trail), (value) => {
      this.handlers.particles?.({ trailType: value });
    });
    this.trailLength = this._range("rng-trail-length", "Trail length", TRAIL_LENGTH_RANGE[0], TRAIL_LENGTH_RANGE[1], 0.01, (value) => {
      this.handlers.particles?.({ trailLength: value });
    });
    this.formation = this._select("sel-formation", "Formation", labelPairs(FORMATION_TYPES, LABELS.formation), (value) => {
      this.handlers.particles?.({ formationType: value });
    });
    this.oscillation = this._select("sel-oscillation", "Oscillation", labelPairs(OSCILLATION_TYPES, LABELS.oscillation), (value) => {
      this.handlers.particles?.({ oscillationType: value });
    });
    this.oscAmount = this._range("rng-osc-amount", "Oscillation amount", OSCILLATION_AMOUNT_RANGE[0], OSCILLATION_AMOUNT_RANGE[1], 0.05, (value) => {
      this.handlers.particles?.({ oscillationAmount: value });
    });
    this.oscSpeed = this._range("rng-osc-speed", "Oscillation speed", OSCILLATION_SPEED_RANGE[0], OSCILLATION_SPEED_RANGE[1], 0.05, (value) => {
      this.handlers.particles?.({ oscillationSpeed: value });
    });
    this.pulseLayout = this._select("sel-pulse-layout", "Pulse field layout", labelPairs(PULSE_LAYOUTS, LABELS.layout), (value) => {
      this.handlers.particles?.({ pulseLayout: value });
    });
    stage2.append(
      this.flow.wrap, this.shape.wrap, this.size.wrap, this.kaleido.wrap, this.spin.label, this.count.wrap,
      this.density.label, this.trailType.wrap, this.trailLength.wrap, this.formation.wrap, this.oscillation.wrap,
      this.oscAmount.wrap, this.oscSpeed.wrap, this.pulseLayout.wrap,
    );
    this.body.append(stage2);

    const captureRow = el("div", "row");
    captureRow.append(this._button("btn-tab", "Tab capture", () => this.handlers.tab?.()));
    captureRow.append(this._button("btn-mic", "Mic / call speaker", () => this.handlers.mic?.()));
    captureRow.append(this._button("btn-oscillator", "Test oscillator", () => this.handlers.oscillator?.()));
    captureRow.append(this._button("btn-stop", "Stop", () => this.handlers.stop?.()));
    this.body.append(captureRow);

    this.suppress = this._checkbox("chk-suppress", "Suppress local playback", (checked) => {
      const result = this.state.updatePreset((draft) => {
        draft.audio.suppressLocalAudio = checked;
      });
      if (!result.ok) this.setError(result.errors[0]);
      else this.handlers.suppressLocalAudio?.(checked);
    });
    this.body.append(this.suppress.label);

    this.systemAudio = this._select("sel-system-audio", "System audio", [
      ["exclude", "Tab only (exclude system)"],
      ["include", "Include system audio"],
    ], (value) => {
      this._commit((draft) => {
        draft.audio.includeSystemAudio = value === "include";
      });
    });
    this.body.append(this.systemAudio.wrap);

    this.device = this._select("sel-device", "Mic device", [["", "Default microphone"]], () => {});
    this.body.append(this.device.wrap);

    this.preamp = this._range("rng-preamp", "Pre-amp", 1, 25, 0.1, (value) => {
      this._commit((draft) => {
        draft.audio.preAmpGain = value;
      });
    });
    this.body.append(this.preamp.wrap);

    this.gate = this._range("rng-gate", "Noise gate", 0, 0.2, 0.001, (value) => {
      this._commit((draft) => {
        draft.audio.noiseGateThreshold = value;
      });
    });
    this.body.append(this.gate.wrap);

    this.gain = this._range("rng-gain", "Visual gain", 0.1, 5, 0.1, (value) => {
      this._commit((draft) => {
        draft.visual.gain = value;
      });
    });
    this.body.append(this.gain.wrap);

    this.fft = this._select("sel-fft", "FFT size", [
      ["1024", "1024"],
      ["2048", "2048"],
      ["4096", "4096"],
    ], (value) => {
      this._commit((draft) => {
        draft.audio.fftSize = Number(value);
      });
    });
    this.body.append(this.fft.wrap);

    this.tier = this._select(
      "sel-tier",
      "Quality tier",
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
    this.body.append(this.tier.wrap);

    this.diagnostics = el("pre", "diagnostics");
    this.diagnostics.id = "diagnostics";
    this.body.append(this.diagnostics);

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
    this.body.append(presetRow);

    this.json = document.createElement("textarea");
    this.json.id = "preset-json";
    this.json.rows = 6;
    this.json.spellcheck = false;
    this.body.append(this.json);
    this.body.append(this._button("btn-import", "Apply JSON", () => this.handlers.importPreset?.(this.json.value)));

    this.hint = el("p", "hint", "H hides the panel. 1 / 2 load Mode A / B. T starts the silent test oscillator. P cycles scene, F cycles flow mode, K cycles kaleidoscope.");
    this.body.append(this.hint);
    panel.append(this.body);
    this.root.append(panel);
    this.panel = panel;
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
    wrap.append(input, document.createTextNode(label));
    return { label: wrap, input };
  }

  _select(id, label, options, onChange) {
    const wrap = el("label", "field");
    const span = el("span", "field-label", label);
    const select = document.createElement("select");
    select.id = id;
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
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
    select.replaceChildren();
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = "Default microphone";
    select.append(fallback);
    for (const device of devices) {
      if (device.kind !== "audioinput") continue;
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${select.length}`;
      select.append(option);
    }
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

  sync() {
    const preset = this.state.preset;
    const audio = preset.audio;
    const visual = preset.visual;
    this.title.textContent = preset.name || preset.sceneId;
    this.suppress.input.checked = audio.suppressLocalAudio;
    this.systemAudio.select.value = audio.includeSystemAudio ? "include" : "exclude";
    this.preamp.input.value = String(audio.preAmpGain);
    this.preamp.value.textContent = `${Number(audio.preAmpGain).toFixed(1)}×`;
    this.gate.input.value = String(audio.noiseGateThreshold ?? 0.02);
    this.gate.value.textContent = Number(audio.noiseGateThreshold ?? 0.02).toFixed(3);
    this.gain.input.value = String(visual.gain ?? 1);
    this.gain.value.textContent = Number(visual.gain ?? 1).toFixed(1);
    this.fft.select.value = String(audio.fftSize || 2048);
    this.tier.select.value = visual.qualityTier || "safe";
    this.palette.select.value = PALETTES[visual.paletteId] ? visual.paletteId : PALETTE_IDS[0];
    this.hue.input.value = String(visual.hueShift || 0);
    this.hue.value.textContent = Number(visual.hueShift || 0).toFixed(2);
    const particles = { ...DEFAULT_PARTICLES, ...(preset.particles || {}) };
    this.scene.select.value = PARTICLE_SCENE_IDS.includes(preset.sceneId) ? preset.sceneId : "aurora-ribbons";
    this.flow.select.value = particles.flowMode;
    this.shape.select.value = particles.shape;
    this.size.input.value = String(particles.particleSize);
    this.size.value.textContent = `${Number(particles.particleSize).toFixed(2)}×`;
    this.kaleido.select.value = String(particles.kaleidoSegments);
    this.spin.input.checked = particles.kaleidoSpin;
    this.count.select.value = particles.particleCountTier;
    this.density.input.checked = particles.densityAutoScale;
    this.trailType.select.value = particles.trailType;
    this.trailLength.input.value = String(particles.trailLength);
    this.trailLength.value.textContent = Number(particles.trailLength).toFixed(2);
    this.formation.select.value = particles.formationType;
    this.oscillation.select.value = particles.oscillationType;
    this.oscAmount.input.value = String(particles.oscillationAmount);
    this.oscAmount.value.textContent = Number(particles.oscillationAmount).toFixed(2);
    this.oscSpeed.input.value = String(particles.oscillationSpeed);
    this.oscSpeed.value.textContent = `${Number(particles.oscillationSpeed).toFixed(2)}×`;
    this.pulseLayout.select.value = particles.pulseLayout;
    this.pulseLayout.wrap.hidden = preset.sceneId !== PULSE_SCENE_ID;
    this._setPill(this.pills.wakeLock, this.state.status.wakeLock, `Wake ${this.state.status.wakeLock}`);
    this._setPill(this.pills.capture, this.state.status.capture, `Capture ${this.state.status.capture}`);
    this._setPill(this.pills.webgl, this.state.status.webgl, this.state.status.webgl === "webgl2" ? "WebGL2" : `WebGL ${this.state.status.webgl}`);
  }

  _setPill(node, state, text) {
    node.dataset.state = state || "off";
    node.textContent = text;
  }
}
