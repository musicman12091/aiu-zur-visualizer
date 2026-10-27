const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 pos = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const COMPOSITE_HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform float u_time;
uniform float u_delta;
uniform vec2 u_resolution;
uniform float u_rms;
uniform float u_sub;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_onset;
uniform float u_beat;
uniform vec3 u_palette[5];
uniform float u_gain;
uniform float u_complexity;
uniform float u_trailHalfLifeMs;
uniform float u_cameraShake;
uniform sampler2D u_history;
out vec4 fragColor;
`;

const PRESENT_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_frame;
uniform vec2 u_resolution;
uniform float u_bloom;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 px = 4.0 / u_resolution;
  vec3 color = texture(u_frame, uv).rgb;
  vec3 blur = (
    texture(u_frame, uv + vec2(px.x, 0.0)).rgb +
    texture(u_frame, uv - vec2(px.x, 0.0)).rgb +
    texture(u_frame, uv + vec2(0.0, px.y)).rgb +
    texture(u_frame, uv - vec2(0.0, px.y)).rgb
  ) * 0.25;
  vec3 linear = color + blur * u_bloom;
  fragColor = vec4(pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

export function trailDecay(deltaSeconds, trailHalfLifeMs) {
  if (!(trailHalfLifeMs > 0) || !(deltaSeconds >= 0)) return 0;
  return 0.5 ** ((deltaSeconds * 1000) / trailHalfLifeMs);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "shader compile failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "program link failed";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function makeTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Trail framebuffer incomplete (${status})`);
  }
  return { texture, framebuffer };
}

export class ShaderHost {
  constructor(canvas, { onContextLost, onContextRestored } = {}) {
    this.canvas = canvas;
    this.onContextLost = onContextLost;
    this.onContextRestored = onContextRestored;
    this.sceneSource = "";
    this.gl = null;
    this.lost = false;
    this.ready = false;
    this.error = "";
    this.width = 0;
    this.height = 0;
    this.index = 0;
    this.targets = [];
    this.composite = null;
    this.present = null;
    this.palette = new Float32Array(15);
    this.frame = {
      time: 0,
      delta: 0,
      rms: 0,
      sub: 0,
      bass: 0,
      mid: 0,
      high: 0,
      onset: 0,
      beat: 0,
      gain: 1,
      complexity: 0.35,
      trailHalfLifeMs: 220,
      cameraShake: 0,
      bloom: 0.35,
    };
    this._onLost = (event) => {
      event.preventDefault();
      this.lost = true;
      this.ready = false;
      this.onContextLost?.();
    };
    this._onRestored = () => {
      this.lost = false;
      try {
        this._createContext();
        if (this.sceneSource) this.setSceneSource(this.sceneSource);
        if (this.width && this.height) this.resize(this.width, this.height);
        this.onContextRestored?.();
      } catch (error) {
        this.error = error.message || String(error);
      }
    };
    canvas.addEventListener("webglcontextlost", this._onLost);
    canvas.addEventListener("webglcontextrestored", this._onRestored);
    this._createContext();
  }

  _createContext() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    if (!gl) {
      this.gl = null;
      this.ready = false;
      this.error = "WebGL2 is unavailable";
      this.canvas.dataset.webgl = "unavailable";
      return;
    }
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.canvas.dataset.webgl = "webgl2";
    this.present = null;
    this.composite = null;
    this.targets = [];
  }

  setSceneSource(source) {
    this.sceneSource = source;
    if (!this.gl || this.lost) return;
    if (!source.includes("vec3 renderScene")) {
      throw new Error("Scene must implement vec3 renderScene(vec2 uv)");
    }
    const fragment = `${COMPOSITE_HEADER}
${source}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 shake = vec2(sin(u_time * 13.0), cos(u_time * 17.0)) * u_cameraShake * u_onset * 0.02;
  float halfLife = max(u_trailHalfLifeMs, 1.0);
  float decay = pow(0.5, (u_delta * 1000.0) / halfLife);
  vec3 history = texture(u_history, uv).rgb;
  vec3 scene = renderScene(uv + shake);
  // decay is the previous frame's remaining weight after one half-life step.
  // mix keeps a static scene at its own brightness while old motion fades.
  vec3 color = mix(scene, history, decay);
  fragColor = vec4(min(color, vec3(1.0)), 1.0);
}
`;
    const gl = this.gl;
    this.composite = link(gl, VERTEX_SOURCE, fragment);
    this.present = link(gl, VERTEX_SOURCE, PRESENT_SOURCE);
    this.compositeLoc = {
      time: gl.getUniformLocation(this.composite, "u_time"),
      delta: gl.getUniformLocation(this.composite, "u_delta"),
      resolution: gl.getUniformLocation(this.composite, "u_resolution"),
      rms: gl.getUniformLocation(this.composite, "u_rms"),
      sub: gl.getUniformLocation(this.composite, "u_sub"),
      bass: gl.getUniformLocation(this.composite, "u_bass"),
      mid: gl.getUniformLocation(this.composite, "u_mid"),
      high: gl.getUniformLocation(this.composite, "u_high"),
      onset: gl.getUniformLocation(this.composite, "u_onset"),
      beat: gl.getUniformLocation(this.composite, "u_beat"),
      palette: gl.getUniformLocation(this.composite, "u_palette"),
      gain: gl.getUniformLocation(this.composite, "u_gain"),
      complexity: gl.getUniformLocation(this.composite, "u_complexity"),
      trail: gl.getUniformLocation(this.composite, "u_trailHalfLifeMs"),
      shake: gl.getUniformLocation(this.composite, "u_cameraShake"),
      history: gl.getUniformLocation(this.composite, "u_history"),
    };
    this.presentLoc = {
      frame: gl.getUniformLocation(this.present, "u_frame"),
      resolution: gl.getUniformLocation(this.present, "u_resolution"),
      bloom: gl.getUniformLocation(this.present, "u_bloom"),
    };
    this.ready = true;
    this.error = "";
  }

  resize(width, height) {
    this.width = Math.max(2, width);
    this.height = Math.max(2, height);
    if (!this.gl || this.lost) return;
    const gl = this.gl;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.targets = [makeTarget(gl, this.width, this.height), makeTarget(gl, this.width, this.height)];
    this.index = 0;
    for (const target of this.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.02, 0.018, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  setFrame(frame) {
    this.frame = { ...this.frame, ...frame };
    const colors = frame.palette || [];
    for (let index = 0; index < 5; index += 1) {
      const color = colors[index] || [0, 0, 0];
      this.palette[index * 3] = color[0];
      this.palette[index * 3 + 1] = color[1];
      this.palette[index * 3 + 2] = color[2];
    }
  }

  render() {
    if (!this.ready || this.lost || !this.gl || this.targets.length < 2) return;
    const gl = this.gl;
    const read = this.targets[this.index];
    const write = this.targets[1 - this.index];
    const frame = this.frame;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.composite);
    const loc = this.compositeLoc;
    gl.uniform1f(loc.time, frame.time);
    gl.uniform1f(loc.delta, frame.delta);
    gl.uniform2f(loc.resolution, this.width, this.height);
    gl.uniform1f(loc.rms, frame.rms);
    gl.uniform1f(loc.sub, frame.sub);
    gl.uniform1f(loc.bass, frame.bass);
    gl.uniform1f(loc.mid, frame.mid);
    gl.uniform1f(loc.high, frame.high);
    gl.uniform1f(loc.onset, frame.onset);
    gl.uniform1f(loc.beat, frame.beat);
    gl.uniform3fv(loc.palette, this.palette);
    gl.uniform1f(loc.gain, frame.gain);
    gl.uniform1f(loc.complexity, frame.complexity);
    gl.uniform1f(loc.trail, frame.trailHalfLifeMs);
    gl.uniform1f(loc.shake, frame.cameraShake);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(loc.history, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.present);
    gl.bindTexture(gl.TEXTURE_2D, write.texture);
    gl.uniform1i(this.presentLoc.frame, 0);
    gl.uniform2f(this.presentLoc.resolution, this.width, this.height);
    gl.uniform1f(this.presentLoc.bloom, frame.bloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.index = 1 - this.index;
  }
}
