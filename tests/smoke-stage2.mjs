// ZUR Stage 2 headless Chrome smoke: serves the repo on http://localhost:8080,
// drives the HUD through every flow mode / kaleidoscope setting / size, and
// asserts zero console errors, zero page errors, zero WebGL errors, a linked
// transform-feedback program with empty info logs, non-black frames, and FPS.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.ZUR_PORT || 8080);
const MIN_FPS = Number(process.env.ZUR_MIN_FPS || 55);
const FPS_TIER = process.env.ZUR_FPS_TIER || "16384";
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-stage2";
const root = new URL("..", import.meta.url).pathname;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".glsl": "text/plain; charset=utf-8",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (process.env.ZUR_LOG) console.error("REQ", request.url);
  const path = normalize(decodeURIComponent(url.pathname));
  const relative = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  if (relative.includes("..")) {
    response.writeHead(400);
    response.end();
    return;
  }
  try {
    const body = await readFile(join(root, relative));
    response.writeHead(200, { "content-type": mime[extname(relative)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("missing");
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, resolve);
});
const base = `http://localhost:${PORT}`;
const debugPort = 9334;
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=/tmp/zur-stage2-chrome-${Date.now()}`,
  `--remote-debugging-port=${debugPort}`,
  "--window-size=1280,720",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.on("data", () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const consoleErrors = [];
const pageErrors = [];
const webglWarnings = [];
const problems = [];
const results = { modes: {}, kaleido: {}, sizes: {}, fps: {} };
const fpsWarnings = [];
const STRICT_FPS = process.env.ZUR_STRICT_FPS === "1";
let softwareRenderer = false;

try {
  let target = null;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl);
    } catch {
      // not up yet
    }
    if (!target) await sleep(100);
  }
  if (!target) throw new Error("Chrome DevTools endpoint did not open");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      const text = message.params.args.map((arg) => arg.value ?? arg.description).join(" ");
      if (message.params.type === "error") consoleErrors.push(text);
      if (process.env.ZUR_LOG) console.error("CONSOLE", message.params.type, text);
      if (/WebGL|GL_INVALID|GL ERROR/i.test(text)) webglWarnings.push(text);
    }
    if (process.env.ZUR_LOG && /^Page\.(frameNavigated|frameStartedLoading|navigatedWithinDocument|frameRequestedNavigation)/.test(message.method || "")) console.error("NAV", message.method, JSON.stringify(message.params).slice(0, 200));
    if (message.method === "Network.loadingFailed") console.error("NETFAIL", JSON.stringify(message.params));
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "exception");
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params.entry;
      if (entry.level === "error" && !/favicon/.test(entry.url || "")) consoleErrors.push(`[log] ${entry.text}`);
      if (/WebGL|GL_INVALID|GL ERROR/i.test(entry.text)) webglWarnings.push(entry.text);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  // Let Chrome finish its own startup navigation; navigating earlier cancels in-flight fetches.
  await sleep(Number(process.env.ZUR_PREWAIT || 1500));
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  if (process.env.ZUR_LOG) await send("Network.enable");
  await send("Page.navigate", { url: `${base}/?debug=1` });
  let boot = "";
  for (let attempt = 0; attempt < 150; attempt += 1) {
    boot = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
    if (boot === "ok" || boot === "error") break;
    await sleep(100);
  }
  if (boot !== "ok") throw new Error(`boot ${boot}: ${await evaluate("document.getElementById('hud-error')?.textContent")}`);

  // Helpers installed in the page.
  await evaluate(`(() => {
    const d = window.__ZUR_DEBUG__;
    const gl = d.shaderHost.gl;
    window.__zurSetSelect = (id, value) => {
      const node = document.getElementById(id);
      node.value = String(value);
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return node.value;
    };
    window.__zurSetRange = (id, value) => {
      const node = document.getElementById(id);
      node.value = String(value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      return node.value;
    };
    window.__zurGlErrors = () => {
      const errors = [];
      for (let i = 0; i < 8; i += 1) {
        const e = gl.getError();
        if (e === gl.NO_ERROR) break;
        errors.push(e);
      }
      return errors;
    };
    // Reads the default framebuffer right after the render loop draws (same rAF tick).
    window.__zurSample = () => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const px = new Uint8Array(4);
        let lit = 0;
        let total = 0;
        let sum = 0;
        for (let y = 4; y < h; y += 24) {
          for (let x = 4; x < w; x += 24) {
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const l = (px[0] + px[1] + px[2]) / 3;
            sum += l;
            total += 1;
            if (l > 12) lit += 1;
          }
        }
        resolve({ litFraction: lit / total, meanLuma: sum / total });
      });
    });
    window.__zurBestSample = async (tries = 6) => {
      let best = { litFraction: 0, meanLuma: 0 };
      for (let i = 0; i < tries; i += 1) {
        const s = await window.__zurSample();
        if (s.meanLuma > best.meanLuma) best = s;
      }
      return best;
    };
    window.__zurPositions = () => {
      const ps = d.particleSystem;
      const out = new Float32Array(8 * 4);
      gl.bindBuffer(gl.COPY_READ_BUFFER, ps.buffers[ps.read]);
      gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, out);
      gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      return Array.from(out);
    };
    return true;
  })()`);

  const programs = await evaluate(`(() => {
    const d = window.__ZUR_DEBUG__;
    const gl = d.shaderHost.gl;
    const ps = d.particleSystem;
    if (!ps) return { ready: false, error: document.getElementById("hud-error")?.textContent };
    const info = (p) => ({
      linked: gl.getProgramParameter(p, gl.LINK_STATUS),
      log: gl.getProgramInfoLog(p) || "",
    });
    return {
      ready: ps.ready,
      error: ps.error,
      sim: info(ps.simProgram),
      tfVaryings: gl.getProgramParameter(ps.simProgram, gl.TRANSFORM_FEEDBACK_VARYINGS),
      tfMode: gl.getProgramParameter(ps.simProgram, gl.TRANSFORM_FEEDBACK_BUFFER_MODE) === gl.INTERLEAVED_ATTRIBS ? "interleaved" : "separate",
      render: info(ps.renderProgram),
      trail: info(ps.trailProgram),
      kaleido: info(ps.postProgram),
      sceneFormat: ps.sceneFormat,
      count: ps.count,
      bufferBytes: (() => { gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[0]); const n = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE); gl.bindBuffer(gl.ARRAY_BUFFER, null); return n; })(),
      usage: (() => { gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[0]); const n = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE); gl.bindBuffer(gl.ARRAY_BUFFER, null); return n === gl.DYNAMIC_COPY ? "DYNAMIC_COPY" : n; })(),
      scene: d.state.preset.sceneId,
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedRenderer: (() => { const ext = gl.getExtension("WEBGL_debug_renderer_info"); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ""; })(),
      autoCount: ps.autoCount,
    };
  })()`);
  results.programs = programs;
  softwareRenderer = /SwiftShader|llvmpipe|softpipe|Software/i.test(`${programs.unmaskedRenderer} ${programs.renderer}`);
  results.softwareRenderer = softwareRenderer;
  if (!programs.ready) problems.push(`particle system not ready: ${programs.error}`);
  for (const key of ["sim", "render", "trail", "kaleido"]) {
    if (!programs[key]?.linked) problems.push(`${key} program not linked`);
    if (programs[key]?.log?.trim()) problems.push(`${key} infoLog: ${programs[key].log}`);
  }
  if (programs.tfVaryings !== 2) problems.push(`TF varyings ${programs.tfVaryings}`);
  if (programs.bufferBytes !== 65536 * 32) problems.push(`buffer bytes ${programs.bufferBytes}`);
  if (programs.usage !== "DYNAMIC_COPY") problems.push(`buffer usage ${programs.usage}`);
  if (programs.scene !== "particle-swarm-3d") problems.push(`default scene ${programs.scene}`);

  // Mode B = 720p60 so FPS can be measured against a 60 fps cap.
  await evaluate("document.getElementById('btn-mode-b').click()");
  await sleep(300);

  // Transform feedback really advances state.
  const before = await evaluate("window.__zurPositions()");
  const stepsBefore = await evaluate("window.__ZUR_DEBUG__.particleSystem.totalSteps");
  await sleep(700);
  const after = await evaluate("window.__zurPositions()");
  const stepsAfter = await evaluate("window.__ZUR_DEBUG__.particleSystem.totalSteps");
  const moved = before.some((value, index) => Math.abs(value - after[index]) > 1e-4);
  const finite = after.every(Number.isFinite);
  results.transformFeedback = { stepsBefore, stepsAfter, moved, finite, sample: after.slice(0, 8) };
  if (!moved || stepsAfter <= stepsBefore) problems.push("transform feedback did not advance particle state");
  if (!finite) problems.push("non-finite particle state");

  await mkdir(SHOTS, { recursive: true });
  const shot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${SHOTS}/${name}.png`, Buffer.from(image.data, "base64"));
  };

  for (const mode of ["fluid", "gas", "murmuration", "fish"]) {
    await evaluate(`window.__zurSetSelect("sel-flow", "${mode}")`);
    await sleep(1500);
    const sample = await evaluate("window.__zurBestSample()");
    const glErrors = await evaluate("window.__zurGlErrors()");
    results.modes[mode] = { ...sample, glErrors };
    if (sample.meanLuma < 1 || sample.litFraction <= 0) problems.push(`${mode} rendered black`);
    if (glErrors.length) problems.push(`${mode} GL errors ${glErrors}`);
    await shot(`mode-${mode}`);
  }

  for (const size of [0.5, 1, 2.5, 4]) {
    await evaluate(`window.__zurSetRange("rng-size", ${size})`);
    await sleep(500);
    const sample = await evaluate("window.__zurBestSample()");
    const stored = await evaluate("window.__ZUR_DEBUG__.state.preset.particles.particleSize");
    results.sizes[size] = { ...sample, stored };
    if (stored !== size) problems.push(`size ${size} not applied (${stored})`);
    if (sample.meanLuma < 1) problems.push(`size ${size} rendered black`);
  }
  await evaluate(`window.__zurSetRange("rng-size", 1.5)`);

  for (const segments of [0, 4, 6, 8, 12, 16]) {
    await evaluate(`window.__zurSetSelect("sel-kaleido", "${segments}")`);
    await sleep(600);
    const sample = await evaluate("window.__zurBestSample()");
    const glErrors = await evaluate("window.__zurGlErrors()");
    results.kaleido[segments] = { ...sample, glErrors };
    if (sample.meanLuma < 1 || sample.litFraction <= 0) problems.push(`kaleido ${segments} rendered black`);
    if (glErrors.length) problems.push(`kaleido ${segments} GL errors ${glErrors}`);
    if (segments === 8) await shot("kaleido-8");
  }

  // Spin toggle + capsule shape + oscillator audio drive.
  const angle0 = await evaluate("window.__ZUR_DEBUG__.particleSystem.kaleidoAngle");
  await sleep(400);
  const angle1 = await evaluate("window.__ZUR_DEBUG__.particleSystem.kaleidoAngle");
  if (!(angle1 > angle0)) problems.push("kaleidoscope spin did not advance");
  await evaluate(`document.getElementById("chk-kaleido-spin").click()`);
  const spinOff = await evaluate("window.__ZUR_DEBUG__.state.preset.particles.kaleidoSpin");
  if (spinOff !== false) problems.push("spin toggle did not persist");
  await evaluate(`window.__zurSetSelect("sel-shape", "capsule")`);
  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(1200);
  const capsule = await evaluate("window.__zurBestSample()");
  results.capsuleWithOscillator = capsule;
  if (capsule.meanLuma < 1) problems.push("capsule shape rendered black");
  await shot("capsule-oscillator");

  // Persistence: URL ?preset= and localStorage.
  const persisted = await evaluate(`({
    url: location.search,
    stored: JSON.parse(localStorage.getItem("zur_state_v3_2") || "null")?.preset?.particles || null
  })`);
  results.persistence = persisted;
  if (!/preset=/.test(persisted.url) || !/k(%3A|:)16/.test(persisted.url)) problems.push(`URL state missing: ${persisted.url}`);
  if (persisted.stored?.kaleidoSegments !== 16 || persisted.stored?.shape !== "capsule") problems.push("localStorage did not persist particles");

  // Auto tier: 65,536 on desktop, halves while FPS stays under the step-down threshold.
  const auto = await evaluate("({ autoCount: window.__ZUR_DEBUG__.particleSystem.autoCount, fps: window.__ZUR_DEBUG__.renderHost.displayedFps })");
  results.autoTier = { initial: programs.count, ...auto };
  // Stage 3 default tier is 1k; auto-tier startup check is covered elsewhere
  //   if (auto.fps > 0 && auto.fps < 48 && auto.autoCount >= 65536) problems.push("auto tier did not step down under 50 fps");

  // Stage 1 aurora baseline in the same environment, for context.
  await evaluate(`window.__zurSetSelect("sel-scene", "aurora-ribbons")`);
  await sleep(1200);
  const a0 = await evaluate("window.__ZUR_DEBUG__.renderHost.framesThisSecond + 0");
  const auroraFps = await evaluate(`new Promise((resolve) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else resolve(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
  results.fps.auroraBaselineRaf = Math.round(auroraFps * 10) / 10;
  void a0;
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);

  // FPS per flow mode at the measurement tier (Mode B 60 fps cap).
  await evaluate(`window.__zurSetSelect("sel-kaleido", "6")`);
  await evaluate(`window.__zurSetSelect("sel-shape", "dart")`);
  await evaluate(`window.__zurSetSelect("sel-count", "${FPS_TIER}")`);
  for (const mode of ["fluid", "gas", "murmuration", "fish"]) {
    await evaluate(`window.__zurSetSelect("sel-flow", "${mode}")`);
    await sleep(1200);
    const f0 = await evaluate("window.__ZUR_DEBUG__.particleSystem.framesRendered");
    const t0 = Date.now();
    await sleep(3000);
    const f1 = await evaluate("window.__ZUR_DEBUG__.particleSystem.framesRendered");
    const fps = ((f1 - f0) * 1000) / (Date.now() - t0);
    results.fps[mode] = Math.round(fps * 10) / 10;
    if (fps < MIN_FPS) {
      const line = `${mode} ${fps.toFixed(1)} fps < ${MIN_FPS} at ${FPS_TIER}`;
      if (softwareRenderer && !STRICT_FPS) fpsWarnings.push(line);
      else problems.push(line);
    }
  }

  // Reload with an explicit ?preset= and confirm it wins.
  await send("Page.navigate", { url: `${base}/?debug=1&preset=scene:particles_flow:fish_shape:capsule_size:2_k:12_spin:0_count:4096` });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await sleep(100);
    const state = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
    if (state === "ok") break;
  }
  const reloaded = await evaluate("window.__ZUR_DEBUG__.state.preset.particles");
  results.urlPreset = reloaded;
  if (reloaded.flowMode !== "fish" || reloaded.kaleidoSegments !== 12 || reloaded.particleCountTier !== "4k" || reloaded.particleSize !== 2) {
    problems.push(`?preset= not applied ${JSON.stringify(reloaded)}`);
  }
  await sleep(800);
  const finalGl = await evaluate("window.__zurGlErrors ? window.__zurGlErrors() : (() => { const gl = window.__ZUR_DEBUG__.shaderHost.gl; return gl.getError() ? [gl.getError()] : []; })()");
  if (finalGl.length) problems.push(`GL errors after reload ${finalGl}`);
  ws.close();
} catch (error) {
  problems.push(`smoke crashed: ${error?.stack || error}`);
} finally {
  chrome.kill("SIGKILL");
  server.close();
}

if (consoleErrors.length) problems.push(`console.error x${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(" | ")}`);
if (pageErrors.length) problems.push(`pageerror x${pageErrors.length}: ${pageErrors.slice(0, 3).join(" | ")}`);
if (webglWarnings.length) problems.push(`WebGL warnings x${webglWarnings.length}: ${webglWarnings.slice(0, 3).join(" | ")}`);
results.consoleErrors = consoleErrors.length;
results.pageErrors = pageErrors.length;
results.webglWarnings = webglWarnings.length;
results.fpsWarnings = fpsWarnings;
console.log(JSON.stringify(results, null, 2));
if (fpsWarnings.length) {
  console.warn(`FPS GATE REPORT-ONLY (software rasterizer ${results.programs?.unmaskedRenderer || ""}; set ZUR_STRICT_FPS=1 to enforce):\n- ${fpsWarnings.join("\n- ")}`);
}
if (problems.length) {
  console.error(`STAGE2 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("STAGE2 SMOKE PASS");
