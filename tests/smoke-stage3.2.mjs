// ZUR Stage 3.2 headless Chrome smoke on a Galaxy A57 portrait viewport (412x915): neon saturation,
// Velocity Capsule white-out guard, camera-facing tunnel / ring span, kaleidoscope mirrors,
// dynamic u_viewportYOffset, HUD hide/tap, and zero console / page / WebGL errors with a silent AudioEngine.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.ZUR_PORT || 8082);
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-stage3.2";
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
const debugPort = Number(process.env.ZUR_DEBUG_PORT || 9336);
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
  `--user-data-dir=/tmp/zur-stage3.2-chrome-${Date.now()}`,
  `--remote-debugging-port=${debugPort}`,
  "--window-size=412,915",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.on("data", () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const consoleErrors = [];
const pageErrors = [];
const webglWarnings = [];
const problems = [];
const results = { chroma: {}, capsule: {}, span: {}, kaleido: {}, viewport: {} };

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
      if (/WebGL|GL_INVALID|GL ERROR/i.test(text)) webglWarnings.push(text);
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "exception");
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params.entry;
      if (entry.level === "error" && !/favicon/.test(entry.url || "")) consoleErrors.push(`[log] ${entry.text} ${entry.url || ""}`);
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
  await sleep(Number(process.env.ZUR_PREWAIT || 1500));
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  // Galaxy A57 portrait.
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base}/?debug=1` });
  let boot = "";
  for (let attempt = 0; attempt < 150; attempt += 1) {
    boot = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
    if (boot === "ok" || boot === "error") break;
    await sleep(100);
  }
  if (boot !== "ok") throw new Error(`boot ${boot}: ${await evaluate("document.getElementById('hud-error')?.textContent")}`);

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
    window.__zurSetText = (id, value) => {
      const node = document.getElementById(id);
      node.value = value;
      node.dispatchEvent(new Event("change", { bubbles: true }));
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
    window.__zurMetrics = () => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let lumaSum = 0;
        let chromaSum = 0;
        let lit = 0;
        let total = 0;
        let minLuma = 1;
        let maxLuma = 0;
        let skyMaxLuma = 0;
        const lumas = [];
        let minRow = h;
        let maxRow = -1;
        const rowLit = new Uint16Array(h);
        const skyFloor = Math.floor(h * 0.65); // GL y grows up; upper ~35% of the screen
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = buf[i] / 255;
            const g = buf[i + 1] / 255;
            const b = buf[i + 2] / 255;
            const mx = Math.max(r, g, b);
            const mn = Math.min(r, g, b);
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            lumaSum += luma;
            lumas.push(luma);
            minLuma = Math.min(minLuma, luma);
            maxLuma = Math.max(maxLuma, luma);
            if (y >= skyFloor) skyMaxLuma = Math.max(skyMaxLuma, luma);
            total += 1;
            if (mx > 0.12) {
              lit += 1;
              chromaSum += mx - mn;
              rowLit[y] += 1;
            }
          }
        }
        const meanLuma = total ? lumaSum / total : 0;
        let varSum = 0;
        for (const luma of lumas) {
          const d = luma - meanLuma;
          varSum += d * d;
        }
        const lumaStdDev = total ? Math.sqrt(varSum / total) : 0;
        for (let y = 0; y < h; y += 2) {
          if (rowLit[y] >= 2) {
            minRow = Math.min(minRow, y);
            maxRow = Math.max(maxRow, y);
          }
        }
        resolve({
          w, h,
          litFraction: lit / total,
          meanLuminance: meanLuma,
          meanChroma: lit ? chromaSum / lit : 0,
          minLuma,
          maxLuma,
          lumaStdDev,
          skyMaxLuma,
          verticalSpanRatio: maxRow >= minRow ? (maxRow - minRow) / h : 0,
          topRow: minRow / h,
          bottomRow: maxRow / h,
        });
      });
    });
    window.__zurBest = async (tries = 4) => {
      let best = null;
      for (let i = 0; i < tries; i += 1) {
        const m = await window.__zurMetrics();
        if (!best || m.litFraction > best.litFraction) best = m;
      }
      return best;
    };
    return true;
  })()`);

  await mkdir(SHOTS, { recursive: true });
  const shot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${SHOTS}/${name}.png`, Buffer.from(image.data, "base64"));
  };
  const measure = async (label, settleMs = 1100) => {
    await sleep(settleMs);
    const metrics = await evaluate("window.__zurBest()");
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return { ...metrics, glErrors };
  };

  const diag0 = await evaluate("window.__ZUR_DEBUG__.getDiagnostics()");
  if (diag0.silent !== true || diag0.destinationConnections !== 0) problems.push("AudioEngine not silent");
  const idlePrompt = await evaluate(`(() => {
    const prompt = document.getElementById("audio-prompt");
    const mic = document.getElementById("btn-mic-prompt");
    const osc = document.getElementById("btn-oscillator-prompt");
    return {
      shown: Boolean(prompt) && !prompt.hidden && prompt.classList.contains("is-idle"),
      mic: Boolean(mic),
      osc: Boolean(osc),
      capture: window.__ZUR_DEBUG__.state.status.capture,
    };
  })()`);
  if (!idlePrompt.shown || !idlePrompt.mic || !idlePrompt.osc) {
    problems.push(`CAPTURE IDLE audio prompt missing ${JSON.stringify(idlePrompt)}`);
  }
  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(2500);

  // Dynamic u_viewportYOffset: open drawer on portrait lifts the swarm; hiding the HUD glides back to 0.
  const geometry = await evaluate(`(() => {
    const c = document.getElementById("stage");
    return { w: c.clientWidth, h: c.clientHeight, hudOpen: !document.getElementById("hud").classList.contains("is-hidden") };
  })()`);
  if (geometry.w !== 412 || geometry.h !== 915) problems.push(`viewport is not 412x915: ${JSON.stringify(geometry)}`);
  await sleep(1500);
  const open = await evaluate("window.__ZUR_DEBUG__.renderHost.viewportYOffset");
  results.viewport.drawerOpen = open;
  if (Math.abs(open - 0.38) > 0.01) problems.push(`viewportYOffset with drawer open ${open}, expected 0.38`);
  const hudOrder = await evaluate(`[...document.querySelectorAll("#hud-body > .top-controls > *")].map((n) => n.querySelector("select,input")?.id)`);
  if (JSON.stringify(hudOrder) !== JSON.stringify(["sel-scene", "sel-palette", "rng-hue"])) problems.push(`HUD top order ${JSON.stringify(hudOrder)}`);
  if (!(await evaluate("document.getElementById('btn-hide-hud')?.textContent.includes('Hide HUD')"))) problems.push("Hide HUD button missing");
  const layoutVisible = await evaluate("!document.getElementById('sel-pulse-layout').closest('label').hidden");
  if (layoutVisible) problems.push("Pulse field layout visible outside pulse-field-3d");
  await evaluate("document.getElementById('btn-hide-hud').click()");
  await sleep(1800);
  const hidden = await evaluate("({ offset: window.__ZUR_DEBUG__.renderHost.viewportYOffset, open: document.getElementById('hud').classList.contains('is-hidden') })");
  results.viewport.drawerHidden = hidden;
  if (!hidden.open || Math.abs(hidden.offset) > 0.01) problems.push(`HUD hide did not glide offset to 0 ${JSON.stringify(hidden)}`);
  await evaluate("document.getElementById('stage').click()");
  await sleep(1800);
  const reopened = await evaluate("({ offset: window.__ZUR_DEBUG__.renderHost.viewportYOffset, hidden: document.getElementById('hud').classList.contains('is-hidden') })");
  if (reopened.hidden || Math.abs(reopened.offset - 0.38) > 0.01) problems.push(`canvas tap did not restore HUD ${JSON.stringify(reopened)}`);
  await evaluate("document.getElementById('stage').click()");
  await sleep(500);

  // Chromatic saturation (default neon palette) for both shapes.
  for (const shape of ["capsule", "dart"]) {
    await evaluate(`window.__zurSetSelect("sel-shape", "${shape}")`);
    await evaluate(`window.__zurSetSelect("sel-count", "2k")`);
    await evaluate(`window.__zurSetRange("rng-size", 1.35)`);
    const m = await measure(`chroma ${shape}`);
    results.chroma[shape] = m;
    if (!(m.meanChroma > 0.35)) problems.push(`${shape} mean chroma ${m.meanChroma.toFixed(3)} <= 0.35`);
    if (m.litFraction <= 0) problems.push(`${shape} rendered black`);
    await shot(`chroma-${shape}`);
  }
  await evaluate(`window.__zurSetSelect("sel-shape", "dart")`);
  await evaluate(`window.__zurSetSelect("sel-count", "64k")`);
  await evaluate(`window.__zurSetRange("rng-size", 1.35)`);
  const dart64 = await measure("dart 64k");
  results.chroma.dart64k = dart64;
  if (!(dart64.meanChroma > 0.35)) problems.push(`dart 64k mean chroma ${dart64.meanChroma.toFixed(3)} <= 0.35`);
  await shot("chroma-dart-64k");

  // Velocity Capsule particleSize 3.5 at 16k must not white-out.
  await evaluate(`window.__zurSetSelect("sel-shape", "capsule")`);
  await evaluate(`window.__zurSetSelect("sel-count", "16k")`);
  await evaluate(`window.__zurSetRange("rng-size", 3.5)`);
  const capsule = await measure("capsule 3.5 @16k");
  results.capsule = capsule;
  if (!(capsule.meanLuminance < 0.75)) problems.push(`capsule 3.5 @16k meanLuminance ${capsule.meanLuminance.toFixed(3)} >= 0.75`);
  if (!(capsule.meanChroma > 0.35)) problems.push(`capsule 3.5 @16k chroma ${capsule.meanChroma.toFixed(3)} <= 0.35`);
  await shot("capsule-3.5-16k");
  await evaluate(`window.__zurSetRange("rng-size", 1.35)`);
  await evaluate(`window.__zurSetSelect("sel-count", "2k")`);

  // Camera-facing XY formations fill the portrait viewport vertically.
  for (const formation of ["neon-tunnel", "polygon-rings"]) {
    await evaluate(`window.__zurSetSelect("sel-formation", "${formation}")`);
    const m = await measure(`formation ${formation}`, 6000);
    results.span[formation] = m;
    if (!(m.verticalSpanRatio > 0.45)) problems.push(`${formation} verticalSpanRatio ${m.verticalSpanRatio.toFixed(3)} <= 0.45`);
    await shot(`formation-${formation}`);
  }

  // Kaleidoscope mirrors render with no GL errors and keep the neon chroma.
  for (const segments of [4, 6, 8, 12, 16]) {
    await evaluate(`window.__zurSetSelect("sel-kaleido", "${segments}")`);
    const m = await measure(`kaleido ${segments}`);
    results.kaleido[segments] = m;
    if (m.litFraction <= 0) problems.push(`kaleido ${segments} rendered black`);
    if (!(m.meanChroma > 0.35)) problems.push(`kaleido ${segments} chroma ${m.meanChroma.toFixed(3)} <= 0.35`);
    await shot(`kaleido-${segments}`);
  }
  await evaluate(`window.__zurSetSelect("sel-kaleido", "0")`);

  // Pulse field stays intact and hides/shows its layout control with the scene.
  await evaluate(`window.__zurSetSelect("sel-scene", "pulse-field-3d")`);
  if (await evaluate("document.getElementById('sel-pulse-layout').closest('label').hidden")) problems.push("Pulse field layout hidden inside pulse-field-3d");
  const pulse = await measure("pulse-field-3d");
  results.pulse = pulse;
  if (pulse.litFraction <= 0) problems.push("pulse-field-3d rendered black");

  await evaluate(`window.__zurSetSelect("sel-pulse-layout", "wave-grid")`);
  const waveGrid = await measure("wave-grid 32 degree pitch");
  results.waveGrid = waveGrid;
  await shot("stage4-wave-grid");
  if (!(waveGrid.verticalSpanRatio > 0.50)) problems.push(`wave-grid verticalSpanRatio ${waveGrid.verticalSpanRatio.toFixed(3)} <= 0.50`);

  await evaluate(`window.__zurSetSelect("sel-scene", "megastructure-3d")`);
  await evaluate(`window.__zurSetSelect("sel-formation", "fractal-core")`);
  const megaScene = await evaluate("window.__ZUR_DEBUG__.renderHost.resolveScene(window.__ZUR_DEBUG__.state.preset)");
  if (megaScene !== "megastructure-3d") problems.push(`megastructure scene resolved to ${megaScene}`);
  const mega = await measure("megastructure fractal core");
  results.megastructure = mega;
  await shot("stage4-megastructure");
  if (mega.litFraction <= 0) problems.push("megastructure rendered black");
  if (!(mega.minLuma < 0.08)) problems.push(`megastructure minLuma ${mega.minLuma?.toFixed?.(3)} >= 0.08`);
  if (!(mega.maxLuma > 0.55)) problems.push(`megastructure maxLuma ${mega.maxLuma?.toFixed?.(3)} <= 0.55`);
  if (!(mega.lumaStdDev > 0.14)) problems.push(`megastructure lumaStdDev ${mega.lumaStdDev?.toFixed?.(3)} <= 0.14`);

  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);
  await evaluate(`window.__zurSetSelect("sel-formation", "logo-attractor")`);
  await evaluate(`window.__zurSetText("txt-attractor", "MON DAAIN")`);
  const logo = await measure("logo-attractor");
  results.logoAttractor = logo;
  await shot("stage4-logo-attractor");
  if (logo.litFraction <= 0) problems.push("logo-attractor rendered black");

  await evaluate(`window.__zurSetSelect("sel-formation", "free-3d")`);
  await evaluate(`window.__zurSetSelect("sel-flow", "physarum")`);
  const physarum = await measure("physarum chemotaxis");
  results.physarum = physarum;
  await shot("stage4-physarum");
  if (physarum.litFraction <= 0) problems.push("physarum rendered black");

  await evaluate(`window.__zurSetSelect("sel-scene", "spectral-canyon-3d")`);
  const canyonScene = await evaluate("window.__ZUR_DEBUG__.renderHost.resolveScene(window.__ZUR_DEBUG__.state.preset)");
  if (canyonScene !== "spectral-canyon-3d") problems.push(`spectral canyon scene resolved to ${canyonScene}`);
  const swarmHidden = await evaluate("document.getElementById('stage2-controls')?.hidden === true");
  if (!swarmHidden) problems.push("3D SWARM controls still visible on spectral-canyon-3d");
  const canyon = await measure("spectral canyon");
  results.spectralCanyon = canyon;
  await shot("stage4-spectral-canyon");
  if (canyon.litFraction <= 0) problems.push("spectral canyon rendered black");
  if (!(canyon.minLuma < 0.08)) problems.push(`spectral canyon minLuma ${canyon.minLuma?.toFixed?.(3)} >= 0.08 (flat wall?)`);
  if (!(canyon.maxLuma > 0.55)) problems.push(`spectral canyon maxLuma ${canyon.maxLuma?.toFixed?.(3)} <= 0.55`);
  // ZUR-GH-007 synthwave rewrite: palette-filled floor/walls + striped sun replace the obsidian upper-35% sky,
  // so contrast is judged by std-dev + no white blowout (grid density lives in tests/smoke-zur-gh-007.mjs).
  if (!(canyon.lumaStdDev > 0.08)) problems.push(`spectral canyon lumaStdDev ${canyon.lumaStdDev?.toFixed?.(3)} <= 0.08`);
  if (!(canyon.maxLuma < 0.9)) problems.push(`spectral canyon white blowout maxLuma ${canyon.maxLuma?.toFixed?.(3)} >= 0.90`);

  for (const mode of ["static", "orbit-3d", "tunnel-fly", "beat-bank"]) {
    await evaluate(`window.__zurSetSelect("sel-camera-mode", "${mode}")`);
    if (await evaluate("window.__ZUR_DEBUG__.state.preset.visual.cameraMode") !== mode) {
      problems.push(`camera mode ${mode} did not persist`);
    }
  }
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);

  const diag = await evaluate("window.__ZUR_DEBUG__.getDiagnostics()");
  if (diag.destinationConnections !== 0 || diag.silent !== true) problems.push(`not silent ${JSON.stringify(diag)}`);
  results.destinationConnections = diag.destinationConnections;
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
  console.error(`STAGE3.2 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("STAGE3.2 SMOKE PASS");
