import { getSpectrumRow128 } from "./spectralMath.js";
export { getSpectrumRow128 };

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "spectral canyon shader compile failed";
    gl.deleteShader(shader);
    throw new Error(message);
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
    const message = gl.getProgramInfoLog(program) || "spectral canyon program link failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

/** Audio-reactive ScenePlugin lifecycle: init, resize, render, and dispose. */
export class SpectralCanyon3D {
  constructor(gl, sources) {
    this.gl = gl;
    this.sources = sources;
    this.ready = false;
    this.row = new Uint8Array(128 * 4);
    this.rowIndex = 0;
    this.time = 0;
    this.init();
  }

  init() {
    const gl = this.gl;
    this.dispose();
    this.program = link(gl, this.sources.postVert, this.sources.canyonFrag);
    this.vao = gl.createVertexArray();
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 128, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const blank = new Uint8Array(128 * 64 * 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 64, gl.RGBA, gl.UNSIGNED_BYTE, blank);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.locations = {
      time: gl.getUniformLocation(this.program, "u_time"),
      resolution: gl.getUniformLocation(this.program, "u_resolution"),
      viewportYOffset: gl.getUniformLocation(this.program, "u_viewportYOffset"),
      waterfallTex: gl.getUniformLocation(this.program, "u_waterfallTex"),
      palette: gl.getUniformLocation(this.program, "u_palette"),
      rms: gl.getUniformLocation(this.program, "u_rms"),
    };
    this.rowIndex = 0;
    this.ready = true;
  }

  resize(width, height) {
    this.width = Math.max(2, width);
    this.height = Math.max(2, height);
  }

  render(frame, palette, canvasWidth, canvasHeight, viewportYOffset = 0) {
    if (!this.ready) return;
    const gl = this.gl;
    this.time += Math.max(0, frame.delta || 0);
    this.row.set(getSpectrumRow128(frame));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.rowIndex, 128, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.row);
    this.rowIndex = (this.rowIndex + 1) % 64;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.locations.time, this.time);
    gl.uniform2f(this.locations.resolution, canvasWidth, canvasHeight);
    gl.uniform1f(this.locations.viewportYOffset, viewportYOffset);
    gl.uniform1f(this.locations.rms, frame.rms || 0);
    gl.uniform3fv(this.locations.palette, palette);
    gl.uniform1i(this.locations.waterfallTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dispose() {
    const gl = this.gl;
    if (this.program && gl.isProgram(this.program)) gl.deleteProgram(this.program);
    if (this.vao && gl.isVertexArray(this.vao)) gl.deleteVertexArray(this.vao);
    if (this.texture && gl.isTexture(this.texture)) gl.deleteTexture(this.texture);
    this.program = null;
    this.vao = null;
    this.texture = null;
    this.ready = false;
  }
}
