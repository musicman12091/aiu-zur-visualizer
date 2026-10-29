// ZUR Stage 3 headless Chrome smoke: serves the repo, boots, asserts a silent
// AudioEngine (destinationConnections 0), then drives pulse-field-3d + layouts,
// trail types, formations, oscillations, density tiers and a portrait viewport,
// asserting zero console / page / WebGL errors and non-black frames.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.ZUR_PORT || 8080);
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-stage3";
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
const debugPort = 9335;
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
  `--user-data-dir=/tmp/zur-stage3-chrome-${Date.now()}`,
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
const results = { layouts: {}, trails: {}, formations: {}, oscillations: {}, tiers: {} };

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
    const info = (p) => ({ linked: gl.getProgramParameter(p, gl.LINK_STATUS), log: gl.getProgramInfoLog(p) || "" });
    return {
      ready: ps.ready,
      error: ps.error,
      sim: info(ps.simProgram),
      render: info(ps.renderProgram),
      trail: info(ps.trailProgram),
      kaleido: info(ps.postProgram),
      count: ps.count,
      scene: d.state.preset.sceneId,
      stage3: d.state.stage3,
      diagnostics: d.getDiagnostics(),
      canvas: { w: d.shaderHost.canvas.width, h: d.shaderHost.canvas.height },
    };
  })()`);
  results.programs = programs;
  if (!programs.ready) problems.push(`particle system not ready: ${programs.error}`);
  for (const key of ["sim", "render", "trail", "kaleido"]) {
    if (!programs[key]?.linked) problems.push(`${key} program not linked`);
    if (programs[key]?.log?.trim()) problems.push(`${key} infoLog: ${programs[key].log}`);
  }
  if (programs.diagnostics?.silent !== true || programs.diagnostics?.destinationConnections !== 0) problems.push("AudioEngine not silent");
  if (programs.scene !== "particle-swarm-3d") problems.push(`default scene ${programs.scene}`);
  const expectedDefaults = {
    sceneId: "particle-swarm-3d", paletteId: "neon-tunnel", particleCountTier: "1k", densityAutoScale: true, trailLength: 0.28,
    trailType: "comet", formationType: "neon-tunnel", oscillationType: "helix", oscillationAmount: 1, oscillationSpeed: 1.2, pulseLayout: "band-clouds",
  };
  if (JSON.stringify(programs.stage3) !== JSON.stringify(expectedDefaults)) problems.push(`default keys drifted: ${JSON.stringify(programs.stage3)}`);
  if (programs.count !== 1024) problems.push(`default count ${programs.count}`);

  await mkdir(SHOTS, { recursive: true });
  const shot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${SHOTS}/${name}.png`, Buffer.from(image.data, "base64"));
  };
  const check = async (bucket, key, label) => {
    await sleep(900);
    const sample = await evaluate("window.__zurBestSample()");
    const glErrors = await evaluate("window.__zurGlErrors()");
    results[bucket][key] = { ...sample, glErrors };
    if (sample.meanLuma < 0.5 || sample.litFraction <= 0) problems.push(`${label} ${key} rendered black`);
    if (glErrors.length) problems.push(`${label} ${key} GL errors ${glErrors}`);
  };

  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(3000);
  await check("tiers", "default", "default");
  await shot("default-neon-tunnel");

  // Scene dropdown exposes the Stage 3 label; pulse-field-3d renders every layout.
  const sceneLabels = await evaluate("[...document.querySelectorAll('#sel-scene option')].map((o) => [o.value, o.textContent])");
  if (!sceneLabels.some(([v, t]) => v === "pulse-field-3d" && t === "3D Audio Pulse Field — Stage 3")) problems.push(`scene label missing: ${JSON.stringify(sceneLabels)}`);
  await evaluate(`window.__zurSetSelect("sel-scene", "pulse-field-3d")`);
  if ((await evaluate("window.__ZUR_DEBUG__.state.preset.sceneId")) !== "pulse-field-3d") problems.push("pulse-field-3d not selected");
  for (const layout of ["band-clouds", "geodesic-sphere", "wave-grid"]) {
    await evaluate(`window.__zurSetSelect("sel-pulse-layout", "${layout}")`);
    await check("layouts", layout, "pulse layout");
    await shot(`pulse-${layout}`);
  }
  const active = await evaluate("window.__ZUR_DEBUG__.renderHost.activeScene");
  if (active !== "pulse-field-3d") problems.push(`active scene ${active}`);
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);

  for (const type of ["comet", "electric", "strobe", "ribbon", "none"]) {
    await evaluate(`window.__zurSetSelect("sel-trail-type", "${type}")`);
    await evaluate(`window.__zurSetRange("rng-trail-length", 0.6)`);
    await check("trails", type, "trail");
    if (type === "comet") await shot("trail-comet");
  }
  await evaluate(`window.__zurSetSelect("sel-trail-type", "comet")`);
  await evaluate(`window.__zurSetRange("rng-trail-length", 0)`);
  await sleep(300);
  await evaluate(`window.__zurSetRange("rng-trail-length", 0.28)`);

  for (const formation of ["free-3d", "neon-tunnel", "polygon-rings", "supernova-shell"]) {
    await evaluate(`window.__zurSetSelect("sel-formation", "${formation}")`);
    await check("formations", formation, "formation");
    await shot(`formation-${formation}`);
  }
  await evaluate(`window.__zurSetSelect("sel-formation", "neon-tunnel")`);
  for (const type of ["off", "wave", "helix", "bounce", "pulse"]) {
    await evaluate(`window.__zurSetSelect("sel-oscillation", "${type}")`);
    await evaluate(`window.__zurSetRange("rng-osc-amount", 2)`);
    await evaluate(`window.__zurSetRange("rng-osc-speed", 2)`);
    await check("oscillations", type, "oscillation");
  }

  for (const tier of ["64", "512", "4k", "64k", "auto"]) {
    await evaluate(`window.__zurSetSelect("sel-count", "${tier}")`);
    await check("tiers", tier, "count tier");
  }
  await evaluate(`window.__zurSetSelect("sel-count", "1k")`);
  await evaluate(`document.getElementById("chk-density").click()`);
  if ((await evaluate("window.__ZUR_DEBUG__.state.preset.particles.densityAutoScale")) !== false) problems.push("densityAutoScale toggle did not persist");
  await evaluate(`document.getElementById("chk-density").click()`);

  const positions = await evaluate("window.__zurPositions()");
  if (!positions.every(Number.isFinite)) problems.push("non-finite particle state");

  // Portrait viewport: the Pass 1 FBO must follow the canvas aspect (no squeezed 1280x720).
  await send("Emulation.setDeviceMetricsOverride", { width: 450, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const portrait = await evaluate(`(() => {
    const d = window.__ZUR_DEBUG__;
    const c = d.shaderHost.canvas;
    return { clientW: c.clientWidth, clientH: c.clientHeight, w: c.width, h: c.height, fbo: [d.particleSystem.width, d.particleSystem.height] };
  })()`);
  results.portrait = portrait;
  if (!(portrait.clientH > portrait.clientW)) problems.push(`viewport not portrait ${JSON.stringify(portrait)}`);
  else if (!(portrait.h > portrait.w) || Math.abs(portrait.w / portrait.h - portrait.clientW / portrait.clientH) > 0.02 || portrait.fbo[0] !== portrait.w || portrait.fbo[1] !== portrait.h) {
    problems.push(`portrait FBO not 1:1 with canvas ${JSON.stringify(portrait)}`);
  }
  await check("tiers", "portrait", "portrait");
  await shot("portrait");
  await send("Emulation.clearDeviceMetricsOverride");
  await sleep(1000);
  const landscape = await evaluate("({ w: window.__ZUR_DEBUG__.shaderHost.canvas.width, h: window.__ZUR_DEBUG__.shaderHost.canvas.height })");
  results.landscape = landscape;
  if (landscape.w <= landscape.h) problems.push(`did not return to landscape ${JSON.stringify(landscape)}`);

  // Mode A/B presets stay valid and silent.
  await evaluate("document.getElementById('btn-mode-a').click()");
  await evaluate("document.getElementById('btn-mode-b').click()");
  const diag = await evaluate("window.__ZUR_DEBUG__.getDiagnostics()");
  if (diag.destinationConnections !== 0 || diag.silent !== true) problems.push(`not silent after modes ${JSON.stringify(diag)}`);

  // Stage 2 ?preset= URLs still load (legacy numeric count migrates).
  await send("Page.navigate", { url: `${base}/?debug=1&preset=scene:pulse_flow:fish_count:4096` });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await sleep(100);
    const state = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
    if (state === "ok") break;
  }
  const reloaded = await evaluate("({ scene: window.__ZUR_DEBUG__.state.preset.sceneId, p: window.__ZUR_DEBUG__.state.preset.particles })");
  results.urlPreset = reloaded;
  if (reloaded.scene !== "pulse-field-3d" || reloaded.p.flowMode !== "fish" || reloaded.p.particleCountTier !== "4k") problems.push(`?preset= not applied ${JSON.stringify(reloaded)}`);
  await sleep(800);
  const finalGl = await evaluate("(() => { const gl = window.__ZUR_DEBUG__.shaderHost.gl; return gl.getError() ? [gl.getError()] : []; })()");
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
console.log(JSON.stringify(results, null, 2));
if (problems.length) {
  console.error(`STAGE3 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("STAGE3 SMOKE PASS");
