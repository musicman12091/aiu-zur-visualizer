// ZUR-GH-008 headless Chrome smoke (Galaxy A57 portrait 412x915): 64k agents + Trail length 1.00 + Particle size 3.35x
// + 3D Fish/Bird Dart + God rays 0.35 must stay chromatic (whiteClip < 1%, meanSat >= 0.55), formation switches at high
// trail must clear the stale silhouette within the 250 ms transition window, and the AudioEngine stays silent.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.ZUR_PORT || 8088);
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-gh-008";
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
const debugPort = Number(process.env.ZUR_DEBUG_PORT || 9342);
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
  `--user-data-dir=/tmp/zur-gh-008-chrome-${Date.now()}`,
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
const results = { stress: {}, transition: {} };

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
    window.__zurGlErrors = () => {
      const errors = [];
      for (let i = 0; i < 8; i += 1) {
        const e = gl.getError();
        if (e === gl.NO_ERROR) break;
        errors.push(e);
      }
      return errors;
    };
    // whiteClip: share of all canvas pixels with every channel >= 245/255 (blown to white).
    // meanSat: mean HSV saturation (max - min) / max over active pixels (max channel > 0.12).
    window.__zur008 = () => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let total = 0; let lit = 0; let white = 0; let nearWhite = 0; let satSum = 0; let desat = 0; let bright = 0; let brightSatSum = 0;
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = buf[i]; const g = buf[i + 1]; const b = buf[i + 2];
            const mx = Math.max(r, g, b) / 255;
            const mn = Math.min(r, g, b) / 255;
            total += 1;
            if (r >= 245 && g >= 245 && b >= 245) white += 1;
            if (mn >= 0.8 && (mx - mn) / mx < 0.15) nearWhite += 1;
            if (mx > 0.12) {
              lit += 1;
              const s = (mx - mn) / mx;
              satSum += s;
              if (s < 0.3) desat += 1;
              if (mx > 0.65) { bright += 1; brightSatSum += s; }
            }
          }
        }
        resolve({
          w, h,
          litFraction: lit / total,
          whiteClip: white / total,
          nearWhite: nearWhite / total,
          meanSat: lit ? satSum / lit : 0,
          desatLitFraction: lit ? desat / lit : 0,
          brightFraction: bright / total,
          brightMeanSat: bright ? brightSatSum / bright : 1,
        });
      });
    });
    // GPU state readback: Y balance (fraction above 0, mean Y) and XZ radial spread of the live agents.
    window.__zurDistribution = () => {
      const ps = d.particleSystem;
      const count = Math.min(ps.count, 65536);
      const data = new Float32Array(count * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[ps.read]);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      let above = 0; let ySum = 0; let core = 0; let rSum = 0;
      for (let i = 0; i < count; i += 1) {
        const x = data[i * 8]; const y = data[i * 8 + 1]; const z = data[i * 8 + 2];
        if (y > 0) above += 1;
        ySum += y;
        const r = Math.hypot(x, z);
        rSum += r;
        if (r < 1.0) core += 1;
      }
      return { count, aboveFraction: above / count, meanY: ySum / count, meanRadiusXZ: rSum / count, centralColumnFraction: core / count };
    };
    window.__zurWorst008 = async (tries = 4) => {
      let worst = null;
      for (let i = 0; i < tries; i += 1) {
        const m = await window.__zur008();
        if (!worst || m.whiteClip > worst.whiteClip) worst = m;
      }
      return worst;
    };
    return true;
  })()`);

  await mkdir(SHOTS, { recursive: true });
  const shot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${SHOTS}/${name}.png`, Buffer.from(image.data, "base64"));
  };
  const measure = async (label, settleMs = 2500) => {
    await sleep(settleMs);
    const metrics = await evaluate("window.__zurWorst008()");
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return { ...metrics, glErrors };
  };

  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(2500);

  // 1) Stress: 64k + Trail 1.00 + size 3.35x + 3D Fish/Bird Dart + God rays 0.35 across flows (HUD open, then hidden).
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);
  await evaluate(`window.__zurSetSelect("sel-count", "64k")`);
  await evaluate(`window.__zurSetSelect("sel-shape", "dart")`);
  await evaluate(`window.__zurSetSelect("sel-trail-type", "comet")`);
  await evaluate(`window.__zurSetRange("rng-trail-length", 1)`);
  await evaluate(`window.__zurSetRange("rng-size", 3.35)`);
  await evaluate(`window.__zurSetRange("rng-god-rays", 0.35)`);
  const flows = (process.env.ZUR_FLOWS || "murmuration,fish,gas,fluid").split(",");
  const formations = (process.env.ZUR_FORMS || "free-3d,supernova-shell").split(",");
  for (const formation of formations) {
    await evaluate(`window.__zurSetSelect("sel-formation", "${formation}")`);
    for (const flow of flows) {
      await evaluate(`window.__zurSetSelect("sel-flow", "${flow}")`);
      const label = `${formation}/${flow}`;
      const m = await measure(label);
      results.stress[label] = {
        whiteClip: +m.whiteClip.toFixed(4), nearWhite: +m.nearWhite.toFixed(4), meanSat: +m.meanSat.toFixed(3), lit: +m.litFraction.toFixed(3),
        brightMeanSat: +m.brightMeanSat.toFixed(3), desat: +m.desatLitFraction.toFixed(3),
      };
      await shot(`gh008-${formation}-${flow}-64k-trail1-size335-dart`);
      if (!(m.nearWhite < 0.01)) problems.push(`${label} nearWhite ${(m.nearWhite * 100).toFixed(2)}% >= 1%`);
      if (!(m.whiteClip < 0.01)) problems.push(`${label} whiteClip ${(m.whiteClip * 100).toFixed(2)}% >= 1%`);
      if (!(m.meanSat >= 0.55)) problems.push(`${label} meanSat ${m.meanSat.toFixed(3)} < 0.55`);
    }
  }

  // 1a) megastructure-3d under the same stress: core keeps its specular (meanSat report-only), whiteClip still < 1%.
  await evaluate(`window.__zurSetSelect("sel-scene", "megastructure-3d")`);
  await evaluate(`window.__zurSetSelect("sel-formation", "fractal-core")`);
  const mega = await measure("megastructure stress");
  results.megastructure = { whiteClip: +mega.whiteClip.toFixed(4), nearWhite: +mega.nearWhite.toFixed(4), meanSat: +mega.meanSat.toFixed(3) };
  await shot("gh008-megastructure-64k-trail1-size335-dart");
  if (!(mega.whiteClip < 0.01)) problems.push(`megastructure whiteClip ${(mega.whiteClip * 100).toFixed(2)}% >= 1%`);
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);

  // 1b) Fix 4: School of Fish balanced across +/-Y; Gas circulates the volume instead of one central column.
  await evaluate(`window.__zurSetSelect("sel-formation", "free-3d")`);
  results.distribution = {};
  for (const flow of ["fish", "gas"]) {
    await evaluate(`window.__zurSetSelect("sel-flow", "${flow}")`);
    await sleep(6000);
    const dist = await evaluate("window.__zurDistribution()");
    results.distribution[flow] = Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, +Number(v).toFixed(3)]));
  }
  if (!(Math.abs(results.distribution.fish.aboveFraction - 0.5) <= 0.12)) problems.push(`fish Y imbalance: ${results.distribution.fish.aboveFraction} above 0`);
  if (!(results.distribution.gas.centralColumnFraction <= 0.35)) problems.push(`gas central column ${results.distribution.gas.centralColumnFraction} > 0.35`);
  if (!(results.distribution.gas.meanRadiusXZ >= 1.5)) problems.push(`gas radial spread ${results.distribution.gas.meanRadiusXZ} < 1.5`);

  // 2) Formation switch at Trail 0.76: Polygon Rings -> Supernova Shell clears within the 250 ms transition window.
  await evaluate(`window.__zurSetSelect("sel-flow", "murmuration")`);
  await evaluate(`window.__zurSetRange("rng-trail-length", 0.76)`);
  await evaluate(`window.__zurSetSelect("sel-formation", "polygon-rings")`);
  await sleep(3000);
  // Records the keepFactor the particle pass actually used each frame, relative to the guard's window start
  // (SwiftShader runs at ~2-3 fps, so wall-clock sampling alone cannot see a 250 ms window).
  const transition = await evaluate(`(async () => {
    const host = window.__ZUR_DEBUG__.renderHost;
    const ps = window.__ZUR_DEBUG__.particleSystem;
    const before = host.trailTransition.count;
    window.__zurSetSelect("sel-formation", "supernova-shell");
    const frames = [];
    let lastRendered = ps.framesRendered;
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (ps.framesRendered === lastRendered) continue;
      lastRendered = ps.framesRendered;
      frames.push({ sinceStart: Math.round(host.lastStamp - host.trailTransition.startedAt), keep60: ps.lastKeep60, norm: ps.lastTrailEnergyNorm });
    }
    return { frames, triggered: host.trailTransition.count - before };
  })()`);
  const inWindow = transition.frames.filter((f) => f.sinceStart >= 0 && f.sinceStart < 250);
  const afterWindow = transition.frames.filter((f) => f.sinceStart >= 250);
  results.transition = {
    triggered: transition.triggered,
    windowFrames: inWindow.length,
    windowMaxKeep: inWindow.length ? Math.max(...inWindow.map((f) => f.keep60)) : null,
    afterKeep: afterWindow.length ? +afterWindow.at(-1).keep60.toFixed(3) : null,
    afterNorm: afterWindow.length ? +afterWindow.at(-1).norm.toFixed(3) : null,
  };
  if (!(transition.triggered === 1)) problems.push(`formation change triggered ${transition.triggered} trail transitions (want 1)`);
  if (!(inWindow.length >= 1)) problems.push("no particle frame rendered inside the 250 ms transition window");
  if (inWindow.some((f) => f.keep60 > 0.45 + 1e-9)) problems.push(`keepFactor not clamped <= 0.45 inside the window: ${JSON.stringify(inWindow)}`);
  if (!afterWindow.length || afterWindow.some((f) => f.keep60 <= 0.45)) problems.push(`keepFactor did not release after 250 ms: ${JSON.stringify(afterWindow.slice(0, 3))}`);
  const afterSwitch = await measure("supernova after switch", 600);
  results.transition.whiteClip = +afterSwitch.whiteClip.toFixed(4);
  results.transition.meanSat = +afterSwitch.meanSat.toFixed(3);
  await shot("gh008-polygon-to-supernova-trail076");

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
  console.error(`ZUR-GH-008 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ZUR-GH-008 SMOKE PASS");
