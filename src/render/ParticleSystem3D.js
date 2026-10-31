import {
  AGENTS_PER_ROW,
  BYTES_PER_AGENT,
  DEFAULT_PARTICLES,
  FLOATS_PER_AGENT,
  FLOW_DAMPING_PER_STEP,
  FLOW_MODES,
  FORMATION_TYPES,
  MAX_PARTICLES,
  MAX_STEPS_PER_FRAME,
  SIM_STEP,
  createShockBuffer,
  dampingRateFromRetention,
  billboardBasis,
  effectiveTrailLength,
  lissajous,
  OSCILLATION_TYPES,
  PULSE_LAYOUTS,
  TRAIL_TYPES,
  densityScaleBoost,
  densityTrailScale,
  keepForDt,
  minRenderRadiusPx,
  nextAutoCount,
  normalizeParticles,
  projectionScales,
  resolveParticleCount,
  tauFromKeep60,
  trailKeepFactor,
  trailRadianceScale,
  visibleThreshold,
} from "./particleMath.js";
import { sampleLogoTargets } from "./LogoAttractor.js";

export const SHADER_FILES = Object.freeze({
  sim: "sim.vert.glsl",
  simFrag: "sim.frag.glsl",
  renderVert: "render.vert.glsl",
  renderFrag: "render.frag.glsl",
  postVert: "post.vert.glsl",
  trailFrag: "trail.frag.glsl",
  kaleidoFrag: "kaleido.frag.glsl",
  coreFrag: "core.frag.glsl",
  canyonFrag: "spectral-canyon.frag.glsl",
});

/** Fetches every Stage 2 shader next to src/shaders/. */
export async function loadParticleShaders(baseUrl) {
  const entries = await Promise.all(Object.entries(SHADER_FILES).map(async ([key, file]) => {
    const response = await fetch(new URL(`../shaders/${file}`, baseUrl));
    if (!response.ok) throw new Error(`Could not load ${file}`);
    return [key, await response.text()];
  }));
  return Object.fromEntries(entries);
}

export const SPAWN_HALF = 1.25 * 3.2;

/** Deterministic initial state (allocated once). */
export function seedParticleState(count = MAX_PARTICLES, seed = 0x2f981b9d) {
  const data = new Float32Array(count * FLOATS_PER_AGENT);
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    const o = i * FLOATS_PER_AGENT;
    // Full [-1.25, +1.25] volume (x3.2 world units): no bottom-center funnel.
    data[o] = (rand() * 2 - 1) * SPAWN_HALF;
    data[o + 1] = (rand() * 2 - 1) * SPAWN_HALF;
    data[o + 2] = (rand() * 2 - 1) * SPAWN_HALF;
    data[o + 3] = rand();
    data[o + 4] = (rand() - 0.5) * 0.4;
    data[o + 5] = (rand() - 0.5) * 0.4;
    data[o + 6] = (rand() - 0.5) * 0.4;
    data[o + 7] = rand();
  }
  return data;
}

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "compile failed";
    gl.deleteShader(shader);
    throw new Error(`${label}: ${log}`);
  }
  return shader;
}

function link(gl, vertexSource, fragmentSource, label, varyings) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}.frag`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  if (varyings) gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "link failed";
    gl.deleteProgram(program);
    throw new Error(`${label}: ${log}`);
  }
  return program;
}

function locations(gl, program, names) {
  const out = {};
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

// --- tiny allocation-free mat4 helpers (column-major) ---
function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  const scales = projectionScales(f, aspect);
  out[0] = scales.x;
  out[5] = scales.y;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function lookAt(out, eye, target) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = zz; // cross(up=(0,1,0), z)
  let xy = 0;
  let xz = -zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function multiply(out, a, b) {
  for (let c = 0; c < 4; c += 1) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

const SIM_UNIFORMS = [
  "u_dt", "u_time", "u_mode", "u_count", "u_damping", "u_rms", "u_sub", "u_bass", "u_mid", "u_high",
  "u_onset", "u_waveSpeed", "u_shock", "u_neighbors", "u_useNeighbors",
  "u_formationType", "u_oscillationType", "u_oscillationAmount", "u_oscillationSpeed", "u_pulseLayout", "u_megastructure", "u_bands",
  "u_billboardRight", "u_billboardUp",
];
const RENDER_UNIFORMS = [
  "u_viewProj", "u_camPos", "u_resolution", "u_projScale", "u_shape", "u_size", "u_minRadiusPx",
  "u_visibleThreshold", "u_exposure", "u_palette", "u_time", "u_high", "u_rms", "u_intensity",
  "u_radianceScale", "u_lightDir", "u_rimColor",
  "u_trailType", "u_trailLength", "u_densityScaleBoost", "u_pulseLayout", "u_bands",
  "u_particleSize", "u_activeCount", "u_viewportYOffset",
];
const POST_UNIFORMS = [
  "u_scene", "u_resolution", "u_kaleidoSegments", "u_kaleidoAngle", "u_kaleidoZoom",
  "u_exposure", "u_blackFloor", "u_viewportYOffset", "u_chromaticAberration", "u_godRays",
];

/**
 * WebGL2 transform-feedback particle scene. Shares the Stage 1 ShaderHost
 * context; renders Pass 1 into its own scene FBO and Pass 2 (kaleidoscope +
 * tone map) into the default framebuffer.
 */
export class ParticleSystem3D {
  constructor(gl, sources, { mobile = false } = {}) {
    this.gl = gl;
    this.sources = sources;
    this.mobile = mobile;
    this.ready = false;
    this.error = "";
    this.width = 0;
    this.height = 0;
    this.read = 0;
    this.accumulator = 0;
    this.simTime = 0;
    this.stepsLastFrame = 0;
    this.totalSteps = 0;
    this.framesRendered = 0;
    this.autoCount = resolveParticleCount("auto", mobile);
    this.slowWindows = 0;
    this.count = this.autoCount;
    this.sceneFormat = "none";
    this.kaleidoAngle = 0;
    this.kickVelocity = 0;
    this.prevOnset = 0;
    this.lastShockAt = -10;
    this.shockCursor = 0;
    this.shock = createShockBuffer(); // every slot starts empty (w < 0), see sim.vert.glsl
    this.logoText = DEFAULT_PARTICLES.attractorText;
    this.logoTargets = sampleLogoTargets(this.logoText, MAX_PARTICLES);
    this.viewProj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.eye = new Float32Array(3);
    this.origin = new Float32Array(3);
    this.coreForward = new Float32Array(3);
    this.coreRight = new Float32Array(3);
    this.coreUp = new Float32Array(3);
    this.billboardRight = new Float32Array([1, 0, 0]);
    this.billboardUp = new Float32Array([0, 1, 0]);
    this.lightDir = new Float32Array([0.35, 0.82, 0.45]);
    this.rimColor = new Float32Array(3);
    this.bands = new Float32Array(5);
    this.initialState = seedParticleState(MAX_PARTICLES);
    this.init();
  }

  init() {
    const gl = this.gl;
    this.ready = false;
    try {
      const s = this.sources;
      this.simProgram = link(gl, s.sim, s.simFrag, "sim", ["v_pos", "v_vel"]);
      this.renderProgram = link(gl, s.renderVert, s.renderFrag, "render");
      this.trailProgram = link(gl, s.postVert, s.trailFrag, "trail");
      this.postProgram = link(gl, s.postVert, s.kaleidoFrag, "kaleido");
      this.coreProgram = link(gl, s.postVert, s.coreFrag, "fractal-core");
      this.simLoc = locations(gl, this.simProgram, SIM_UNIFORMS);
      this.renderLoc = locations(gl, this.renderProgram, RENDER_UNIFORMS);
      this.trailLoc = locations(gl, this.trailProgram, ["u_fade", "u_trailType", "u_trailLength", "u_time"]);
      this.postLoc = locations(gl, this.postProgram, POST_UNIFORMS);
      this.coreLoc = locations(gl, this.coreProgram, [
        "u_resolution", "u_eye", "u_forward", "u_right", "u_up", "u_palette", "u_time", "u_bass", "u_steps",
        "u_viewportYOffset",
      ]);

      // Ping-pong interleaved Float32 state: [a_pos vec4 | a_vel vec4] x MAX_PARTICLES.
      this.buffers = [gl.createBuffer(), gl.createBuffer()];
      for (const buffer of this.buffers) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.initialState, gl.DYNAMIC_COPY);
      }
      this.logoTargetVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.logoTargetVBO);
      gl.bufferData(gl.ARRAY_BUFFER, this.logoTargets, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.updateVaos = [gl.createVertexArray(), gl.createVertexArray()];
      this.renderVaos = [gl.createVertexArray(), gl.createVertexArray()];
      for (let i = 0; i < 2; i += 1) {
        this._bindStateVao(this.updateVaos[i], this.buffers[i], 0, true);
        this._bindStateVao(this.renderVaos[i], this.buffers[i], 1);
      }
      this.emptyVao = gl.createVertexArray();
      gl.bindVertexArray(null);
      this.tf = gl.createTransformFeedback();

      // Neighbor texture: GPU-side copy of the read buffer (2 RGBA32F texels / agent).
      this.neighborTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.neighborTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, AGENTS_PER_ROW * 2, MAX_PARTICLES / AGENTS_PER_ROW);
      gl.bindTexture(gl.TEXTURE_2D, null);

      this.hdrSupported = Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
      this.read = 0;
      this.accumulator = 0;
      this.scene = null;
      this.ready = true;
      this.error = "";
      if (this.width && this.height) this.resize(this.width, this.height);
    } catch (error) {
      this.error = error?.message || String(error);
      this.ready = false;
      throw error;
    }
  }

  _bindStateVao(vao, buffer, divisor, withLogoTarget = false) {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, BYTES_PER_AGENT, 0);
    gl.vertexAttribDivisor(0, divisor);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_AGENT, 16);
    gl.vertexAttribDivisor(1, divisor);
    if (withLogoTarget) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.logoTargetVBO);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(2, 0);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttribDivisor(2, 0);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _makeSceneTarget(internalFormat, format, type) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, this.width, this.height, 0, format, type, null);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(depth);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, depth, framebuffer };
  }

  resize(width, height) {
    this.width = Math.max(2, width);
    this.height = Math.max(2, height);
    if (!this.ready) return;
    const gl = this.gl;
    if (this.scene) {
      gl.deleteFramebuffer(this.scene.framebuffer);
      gl.deleteRenderbuffer(this.scene.depth);
      gl.deleteTexture(this.scene.texture);
      this.scene = null;
    }
    if (this.hdrSupported) {
      this.scene = this._makeSceneTarget(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
      if (this.scene) this.sceneFormat = "RGBA16F";
    }
    if (!this.scene) {
      this.scene = this._makeSceneTarget(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      this.sceneFormat = "RGBA8";
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Called once per 1-second FPS window by RenderHost. Auto tier steps down if FPS < threshold. */
  reportFps(fps, targetFps, countTier) {
    if (countTier !== "auto") {
      this.slowWindows = 0;
      return;
    }
    const next = nextAutoCount(this.autoCount, fps, targetFps, this.slowWindows);
    this.autoCount = next.count;
    this.slowWindows = next.slowWindows;
  }

  resetAuto() {
    this.autoCount = resolveParticleCount("auto", this.mobile);
    this.slowWindows = 0;
  }

  triggerShockwave(rms = 0) {
    this._pushShock(this.simTime, rms);
  }

  _pushShock(time, rms) {
    const group = (this.shockCursor * 3 + 1) % 5;
    const p = lissajous(group, time);
    const o = this.shockCursor * 4;
    this.shock[o] = p[0] + (Math.sin(time * 7.1) * 0.8);
    this.shock[o + 1] = p[1] + (Math.cos(time * 5.3) * 0.5);
    this.shock[o + 2] = p[2] + (Math.sin(time * 3.7) * 0.8);
    this.shock[o + 3] = time;
    this.shockCursor = (this.shockCursor + 1) % 4;
    this.lastShockAt = time;
    this.kickVelocity += 1.2 + rms * 2;
  }

  /**
   * frame: ShaderHost.frame (time, delta, bands, onset, gain, trailHalfLifeMs)
   * palette: ShaderHost.palette Float32Array(15)
   * extras: { pulse: boolean (pulse-field-3d), bands: [sub, bass, lowMid, highMid, treble],
   *   viewportYOffset: NDC lift for the portrait HUD drawer (0 when hidden) }
   */
  render(frame, palette, particlesInput, visual, canvasWidth, canvasHeight, extras = {}) {
    if (!this.ready || !this.scene) return;
    const gl = this.gl;
    const particles = particlesInput || normalizeParticles(null);
    const dt = Math.min(Math.max(frame.delta || 0, 0), 0.25);
    const modeIndex = Math.max(0, FLOW_MODES.indexOf(particles.flowMode));
    const tierCount = resolveParticleCount(particles.particleCountTier, this.mobile);
    this.count = particles.particleCountTier === "auto" ? this.autoCount : tierCount;
    // Logo glyph needs dense coverage; floor active agents at 16k even if HUD tier is 2k.
    if (particles.formationType === "logo-attractor") {
      this.count = Math.max(this.count, 16384);
    }
    const count = this.count;
    const attractorText = particles.attractorText || DEFAULT_PARTICLES.attractorText;
    if (attractorText !== this.logoText) {
      this.logoText = attractorText;
      this.logoTargets = sampleLogoTargets(attractorText, MAX_PARTICLES);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.logoTargetVBO);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.logoTargets);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    const pulse = Boolean(extras.pulse);
    const pulseLayout = pulse ? Math.max(0, PULSE_LAYOUTS.indexOf(particles.pulseLayout)) : -1;
    const trailType = Math.max(0, TRAIL_TYPES.indexOf(particles.trailType));
    // ZUR-GH-007: logo-attractor clamps the effective trail decay (fade + capsule stretch) so glyphs stay sharp.
    const trailLength = effectiveTrailLength(particles.formationType, particles.trailLength);
    const viewportYOffset = extras.viewportYOffset || 0;
    const densityBoost = densityScaleBoost(count, particles.densityAutoScale);
    for (let i = 0; i < 5; i += 1) this.bands[i] = Math.max(0, extras.bands?.[i] || 0);

    // Predator shockwave ring buffer: audio onset rising edge, or an ambient pulse in silence.
    const onset = frame.onset || 0;
    if (onset > 0.55 && this.prevOnset <= 0.55 && this.simTime - this.lastShockAt > 0.25) {
      this._pushShock(this.simTime, frame.rms || 0);
    } else if ((frame.rms || 0) < 0.01 && this.simTime - this.lastShockAt > 7) {
      this._pushShock(this.simTime, 0);
    }
    this.prevOnset = onset;

    // Fixed-step accumulator (1/60 s, max 4 steps).
    let acc = this.accumulator + dt;
    let steps = Math.floor(acc / SIM_STEP + 1e-9);
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      acc = 0;
    } else {
      acc -= steps * SIM_STEP;
    }
    this.accumulator = Math.max(0, acc);
    this.stepsLastFrame = steps;

    const useNeighbors = modeIndex >= 2 && modeIndex <= 3 && !pulse ? 1 : 0;
    if (steps > 0) {
      gl.useProgram(this.simProgram);
      const L = this.simLoc;
      gl.uniform1f(L.u_dt, SIM_STEP);
      gl.uniform1i(L.u_mode, modeIndex);
      gl.uniform1i(L.u_count, count);
      gl.uniform1f(L.u_damping, dampingRateFromRetention(FLOW_DAMPING_PER_STEP[FLOW_MODES[modeIndex]]));
      gl.uniform1f(L.u_rms, frame.rms || 0);
      gl.uniform1f(L.u_sub, frame.sub || 0);
      gl.uniform1f(L.u_bass, frame.bass || 0);
      gl.uniform1f(L.u_mid, frame.mid || 0);
      gl.uniform1f(L.u_high, frame.high || 0);
      gl.uniform1f(L.u_onset, onset);
      gl.uniform1f(L.u_waveSpeed, 4.5);
      gl.uniform4fv(L.u_shock, this.shock);
      gl.uniform1i(L.u_useNeighbors, useNeighbors);
      gl.uniform1i(L.u_formationType, Math.max(0, FORMATION_TYPES.indexOf(particles.formationType)));
      gl.uniform1i(L.u_oscillationType, Math.max(0, OSCILLATION_TYPES.indexOf(particles.oscillationType)));
      gl.uniform1f(L.u_oscillationAmount, particles.oscillationAmount);
      gl.uniform1f(L.u_oscillationSpeed, particles.oscillationSpeed);
      gl.uniform1i(L.u_pulseLayout, pulseLayout);
      gl.uniform1i(L.u_megastructure, extras.megastructure ? 1 : 0);
      gl.uniform1fv(L.u_bands, this.bands);
      // ZUR-GH-007: logo glyph plane billboards onto the active camera (previous frame's eye; slow orbit).
      billboardBasis(this.eye, this.origin, this.billboardRight, this.billboardUp);
      gl.uniform3fv(L.u_billboardRight, this.billboardRight);
      gl.uniform3fv(L.u_billboardUp, this.billboardUp);
      gl.uniform1i(L.u_neighbors, 1);
      if (useNeighbors) {
        // GPU-side copy of the current state for 6-neighbor ring flocking (no CPU readback).
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.neighborTex);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, this.buffers[this.read]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AGENTS_PER_ROW * 2, Math.ceil(count / AGENTS_PER_ROW), gl.RGBA, gl.FLOAT, 0);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      }
      gl.enable(gl.RASTERIZER_DISCARD);
      for (let i = 0; i < steps; i += 1) {
        this.simTime += SIM_STEP;
        gl.uniform1f(L.u_time, this.simTime);
        const write = 1 - this.read;
        gl.bindVertexArray(this.updateVaos[this.read]);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[write]);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.endTransformFeedback();
        // Hazard-free unbind before the buffer is used as a vertex source (Chrome ANGLE).
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindVertexArray(null);
        this.read = write;
      }
      gl.disable(gl.RASTERIZER_DISCARD);
      this.totalSteps += steps;
    }

    // Camera: slow orbit.
    const t = this.simTime;
    // Tunnel / ring formations face the camera down the Z axis (sim.vert.glsl adds the 12° tilt), with a gentle sway.
    const downZ = !pulse && (particles.formationType === "neon-tunnel" || particles.formationType === "polygon-rings");
    const waveGrid = pulse && particles.pulseLayout === "wave-grid";
    const cameraMode = visual?.cameraMode || "orbit-3d";
    const orbit = cameraMode === "static" ? 0
      : downZ ? Math.sin(t * 0.09) * 0.18 : t * 0.06;
    const dist = 11.5 - (frame.bass || 0) * 1.2;
    this.eye[0] = Math.sin(orbit) * dist;
    this.eye[1] = waveGrid ? 0 : cameraMode === "static" ? (downZ ? 0 : 2.2)
      : downZ ? Math.sin(t * 0.07) * 0.4 : 2.2 + Math.sin(t * 0.07) * 1.6;
    this.eye[2] = cameraMode === "tunnel-fly" ? 9.5 + Math.sin(t * 0.4) * 0.3 : Math.cos(orbit) * dist;
    const aspect = this.width / this.height;
    perspective(this.proj, ((waveGrid ? 36 : 50) * Math.PI) / 180, aspect, 0.1, 60);
    lookAt(this.view, this.eye, this.origin);
    if (cameraMode === "beat-bank") {
      const bank = Math.sin(t * 2.0) * 0.07 + (frame.onset || 0) * 0.18;
      const c = Math.cos(bank);
      const s = Math.sin(bank);
      for (let column = 0; column < 4; column += 1) {
        const x = this.view[column * 4];
        const y = this.view[column * 4 + 1];
        this.view[column * 4] = x * c - y * s;
        this.view[column * 4 + 1] = x * s + y * c;
      }
    }
    multiply(this.viewProj, this.proj, this.view);

    // Pass 1: scene FBO — trail fade, then particles.
    const keep60 = trailKeepFactor(particles.trailType, trailLength) * densityTrailScale(count, particles.densityAutoScale);
    const tau = tauFromKeep60(keep60);
    const keep = keepForDt(keep60, dt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.trailProgram);
    gl.uniform1f(this.trailLoc.u_fade, 1 - keep);
    gl.uniform1i(this.trailLoc.u_trailType, trailType);
    gl.uniform1f(this.trailLoc.u_trailLength, trailLength);
    gl.uniform1f(this.trailLoc.u_time, t);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (extras.megastructure) {
      const C = this.coreLoc;
      const fl = Math.hypot(this.eye[0], this.eye[1], this.eye[2]) || 1;
      const forward = this.coreForward;
      const right = this.coreRight;
      const up = this.coreUp;
      forward[0] = -this.eye[0] / fl;
      forward[1] = -this.eye[1] / fl;
      forward[2] = -this.eye[2] / fl;
      const rightLength = Math.hypot(forward[2], forward[0]) || 1;
      right[0] = forward[2] / rightLength;
      right[1] = 0;
      right[2] = -forward[0] / rightLength;
      up[0] = right[1] * forward[2] - right[2] * forward[1];
      up[1] = right[2] * forward[0] - right[0] * forward[2];
      up[2] = right[0] * forward[1] - right[1] * forward[0];
      gl.useProgram(this.coreProgram);
      gl.uniform2f(C.u_resolution, this.width, this.height);
      gl.uniform3fv(C.u_eye, this.eye);
      gl.uniform3fv(C.u_forward, forward);
      gl.uniform3fv(C.u_right, right);
      gl.uniform3fv(C.u_up, up);
      gl.uniform3fv(C.u_palette, palette);
      gl.uniform1f(C.u_time, t);
      gl.uniform1f(C.u_bass, frame.bass || 0);
      gl.uniform1i(C.u_steps, visual?.qualityTier === "safe" ? 16 : 24);
      // ZUR-GH-007: core, swarm (u_viewportYOffset in render.vert) and kaleido fold share one optical centre.
      gl.uniform1f(C.u_viewportYOffset, viewportYOffset);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const dart = particles.shape !== "capsule";
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (dart) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
    }
    // Darts add (depth-tested); capsules are premultiplied so dense 16k–64k crowds saturate instead of whiting out.
    if (dart) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.renderProgram);
    const R = this.renderLoc;
    gl.uniformMatrix4fv(R.u_viewProj, false, this.viewProj);
    gl.uniform3fv(R.u_camPos, this.eye);
    gl.uniform2f(R.u_resolution, this.width, this.height);
    gl.uniform1f(R.u_projScale, this.proj[5]);
    gl.uniform1i(R.u_shape, dart ? 0 : 1);
    gl.uniform1f(R.u_size, particles.particleSize);
    gl.uniform1f(R.u_particleSize, particles.particleSize);
    gl.uniform1f(R.u_activeCount, count);
    gl.uniform1f(R.u_viewportYOffset, viewportYOffset);
    gl.uniform1f(R.u_minRadiusPx, minRenderRadiusPx(1.6, this.height, 1));
    gl.uniform1ui(R.u_visibleThreshold, visibleThreshold(visual?.qualityTier === "safe" ? 0.75 : 1));
    gl.uniform1f(R.u_exposure, 1 / 30);
    gl.uniform3fv(R.u_palette, palette);
    gl.uniform1f(R.u_time, t);
    gl.uniform1f(R.u_high, frame.high || 0);
    gl.uniform1f(R.u_rms, frame.rms || 0);
    gl.uniform1f(R.u_intensity, Math.min(1.2, Math.max(0.18, 0.22 * Math.sqrt(16384 / count))) * (dart ? 0.55 : 0.5));
    gl.uniform1f(R.u_radianceScale, trailRadianceScale(dt, tau));
    gl.uniform1i(R.u_trailType, trailType);
    gl.uniform1f(R.u_trailLength, trailLength);
    gl.uniform1f(R.u_densityScaleBoost, densityBoost);
    gl.uniform1i(R.u_pulseLayout, pulseLayout);
    gl.uniform1fv(R.u_bands, this.bands);
    gl.uniform3fv(R.u_lightDir, this.lightDir);
    this.rimColor[0] = palette[12];
    this.rimColor[1] = palette[13];
    this.rimColor[2] = palette[14];
    gl.uniform3fv(R.u_rimColor, this.rimColor);
    gl.bindVertexArray(this.renderVaos[this.read]);
    if (dart) gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, count);
    else gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH_ATTACHMENT]);

    // Pass 2: default framebuffer — kaleidoscope + tone map + sRGB.
    if (particles.kaleidoSpin) {
      this.kaleidoAngle += dt * (0.12 + 0.6 * (frame.mid || 0) + this.kickVelocity);
      this.kickVelocity *= Math.exp(-dt * 3.5);
      if (this.kaleidoAngle > Math.PI * 64) this.kaleidoAngle -= Math.PI * 64;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(this.postProgram);
    const P = this.postLoc;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.texture);
    gl.uniform1i(P.u_scene, 0);
    gl.uniform2f(P.u_resolution, this.width, this.height);
    gl.uniform1f(P.u_kaleidoSegments, particles.kaleidoSegments);
    gl.uniform1f(P.u_kaleidoAngle, this.kaleidoAngle);
    gl.uniform1f(P.u_kaleidoZoom, 1);
    gl.uniform1f(P.u_exposure, frame.gain ?? 1);
    gl.uniform1f(P.u_blackFloor, this.sceneFormat === "RGBA8" ? 3 / 255 : 0);
    gl.uniform1f(P.u_viewportYOffset, viewportYOffset);
    gl.uniform1f(P.u_chromaticAberration, visual?.chromaticAberration ?? 0.30);
    gl.uniform1f(P.u_godRays, visual?.godRays ?? 0.35);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.framesRendered += 1;
  }

  stats() {
    return {
      ready: this.ready,
      error: this.error,
      count: this.count,
      autoCount: this.autoCount,
      sceneFormat: this.sceneFormat,
      totalSteps: this.totalSteps,
      stepsLastFrame: this.stepsLastFrame,
      framesRendered: this.framesRendered,
      simTime: this.simTime,
      kaleidoAngle: this.kaleidoAngle,
      readBuffer: this.read,
    };
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    for (const vao of [...(this.updateVaos || []), ...(this.renderVaos || [])]) {
      gl.bindVertexArray(vao);
      gl.disableVertexAttribArray(2);
      gl.vertexAttribDivisor(2, 0);
    }
    gl.bindVertexArray(null);
    if (this.logoTargetVBO) gl.deleteBuffer(this.logoTargetVBO);
    this.logoTargetVBO = null;
  }
}
