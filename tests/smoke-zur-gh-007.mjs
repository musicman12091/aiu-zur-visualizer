// ZUR-GH-007 headless Chrome smoke (Galaxy A57 portrait 412x915): megastructure core centred inside 16-mirror
// kaleidoscopes (shared u_viewportYOffset optical centre), volumetric fractal-core at a 90-degree orbit,
// logo-attractor readability under Oscillation 3.00 + Comet 0.81, and synthwave spectral-canyon grid density.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

// ZUR_ONLY=mega,fractal,logo,canyon runs a subset while iterating.
const ONLY = process.env.ZUR_ONLY ? process.env.ZUR_ONLY.split(",") : null;
const PORT = Number(process.env.ZUR_PORT || 8087);
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-gh-007";
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
const debugPort = Number(process.env.ZUR_DEBUG_PORT || 9341);
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
  `--user-data-dir=/tmp/zur-gh-007-chrome-${Date.now()}`,
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

  await evaluate(`(() => {
    const d = window.__ZUR_DEBUG__;
    const gl = d.shaderHost.gl;
    const lumaAt = (buf, w, x, y) => {
      const i = (y * w + x) * 4;
      return 0.2126 * buf[i] / 255 + 0.7152 * buf[i + 1] / 255 + 0.0722 * buf[i + 2] / 255;
    };
    // Counts distinct bright grid lines crossed along a 1-D luma profile (rising edges above a local mean).
    const crossings = (profile) => {
      const n = profile.length;
      const win = 9;
      let count = 0;
      let inLine = false;
      for (let i = 0; i < n; i += 1) {
        let sum = 0; let k = 0;
        for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j += 1) { sum += profile[j]; k += 1; }
        const local = sum / k;
        const on = profile[i] > local + 0.035 && profile[i] > 0.12;
        if (on && !inLine) count += 1;
        inLine = on ? true : (profile[i] < local + 0.01 ? false : inLine);
      }
      return count;
    };
    // Rich frame analysis: optical-centre disk, upper-viewport mid-luma, grid crossings, lit bounding box, row runs.
    window.__zur007 = (opts = {}) => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const offset = d.renderHost.viewportYOffset || 0;
        const cx = Math.floor(w * 0.5);
        const cy = Math.floor(h * (0.5 + 0.5 * offset)); // GL rows grow upward
        const diskR = Math.floor(h * (opts.diskRadius || 0.06));
        let diskLit = 0; let diskTotal = 0; let diskLuma = 0;
        for (let y = cy - diskR; y <= cy + diskR; y += 2) {
          for (let x = cx - diskR; x <= cx + diskR; x += 2) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if ((x - cx) ** 2 + (y - cy) ** 2 > diskR * diskR) continue;
            const l = lumaAt(buf, w, x, y);
            diskLuma += l; diskTotal += 1;
            if (l > 0.08) diskLit += 1;
          }
        }
        // Upper viewport = rows above the HUD drawer (GL y >= 0.38 h when the drawer is open).
        const upperFloor = Math.floor(h * (offset > 0.01 ? 0.38 : 0.0));
        let mid = 0; let upperTotal = 0; let upperMax = 0; let zenithMax = 0; let minLuma = 1;
        let minX = w; let maxX = -1; let minY = h; let maxY = -1;
        for (let y = upperFloor; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const l = lumaAt(buf, w, x, y);
            upperTotal += 1;
            if (l > 0.15 && l < 0.90) mid += 1;
            upperMax = Math.max(upperMax, l);
            minLuma = Math.min(minLuma, l);
            if (y >= h * 0.93) zenithMax = Math.max(zenithMax, l);
            if (l > 0.10) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
          }
        }
        const col = [];
        for (let y = upperFloor; y < h; y += 1) col.push(lumaAt(buf, w, cx, y));
        const rowYs = [0.45, 0.52].map((f) => Math.floor(upperFloor + (h - upperFloor) * f));
        const rows = rowYs.map((y) => { const r = []; for (let x = 0; x < w; x += 1) r.push(lumaAt(buf, w, x, y)); return r; });
        const vertical = crossings(col);
        const horizontal = Math.max(...rows.map(crossings));
        // Text readability: lit runs along the brightest row band through the glyph centre.
        let bestRuns = 0;
        for (let y = upperFloor; y < h; y += 4) {
          let runs = 0; let on = false; let gap = 0;
          for (let x = 0; x < w; x += 1) {
            const lit = lumaAt(buf, w, x, y) > 0.10;
            if (lit) { if (!on && gap >= 3) runs += 1; if (!on && runs === 0) runs = 1; on = true; gap = 0; }
            else { on = false; gap += 1; }
          }
          bestRuns = Math.max(bestRuns, runs);
        }
        resolve({
          w, h, offset,
          diskLitFraction: diskTotal ? diskLit / diskTotal : 0,
          diskMeanLuma: diskTotal ? diskLuma / diskTotal : 0,
          upperMidLumaFraction: upperTotal ? mid / upperTotal : 0,
          upperMaxLuma: upperMax,
          upperMinLuma: minLuma,
          zenithMaxLuma: zenithMax,
          gridCrossingsVertical: vertical,
          gridCrossingsHorizontal: horizontal,
          gridCrossings: vertical + horizontal,
          litWidthRatio: maxX >= minX ? (maxX - minX) / w : 0,
          litHeightRatio: maxY >= minY ? (maxY - minY) / h : 0,
          textRuns: bestRuns,
        });
      });
    });
    // Reads the live transform-feedback state buffer and returns per-axis std-dev of active agents.
    window.__zurAxisSpread = () => {
      const ps = d.particleSystem;
      const count = Math.min(ps.count, 65536);
      const data = new Float32Array(count * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[ps.read]);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const mean = [0, 0, 0]; const sq = [0, 0, 0];
      for (let i = 0; i < count; i += 1) for (let a = 0; a < 3; a += 1) { const v = data[i * 8 + a]; mean[a] += v; sq[a] += v * v; }
      const std = mean.map((m, a) => Math.sqrt(Math.max(0, sq[a] / count - (m / count) ** 2)));
      return { count, std, minRatio: Math.min(...std) / Math.max(...std, 1e-6) };
    };
    // Median distance (world units) between logo agents and their camera-billboarded glyph targets.
    window.__zurLogoError = () => {
      const ps = d.particleSystem;
      const count = ps.count;
      const data = new Float32Array(count * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[ps.read]);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const t = ps.logoTargets; const r = ps.billboardRight; const u = ps.billboardUp;
      const errs = [];
      for (let i = 0; i < count; i += 7) {
        const x = t[i * 4]; const y = t[i * 4 + 1];
        errs.push(Math.hypot(data[i * 8] - (r[0] * x + u[0] * y), data[i * 8 + 1] - (r[1] * x + u[1] * y), data[i * 8 + 2] - (r[2] * x + u[2] * y)));
      }
      errs.sort((a, b) => a - b);
      return { count, simTime: ps.simTime, median: errs[errs.length >> 1], p90: errs[Math.floor(errs.length * 0.9)] };
    };
    window.__zurBest007 = async (key = "diskLitFraction", tries = 4) => {
      let best = null;
      for (let i = 0; i < tries; i += 1) {
        const m = await window.__zur007();
        if (!best || m[key] > best[key]) best = m;
      }
      return best;
    };
    return true;
  })()`);
  const m007 = async (label, key, settleMs = 1500) => {
    await sleep(settleMs);
    const metrics = await evaluate(`window.__zurBest007("${key}")`);
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return { ...metrics, glErrors };
  };
  results.mega = {};
  results.fractal = {};

  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(2500);

  if (!ONLY || ONLY.includes("mega")) {
  // 1) megastructure-3d: the raymarched core stays at the shared optical centre inside every mirror count.
  await evaluate(`window.__zurSetSelect("sel-scene", "megastructure-3d")`);
  await evaluate(`window.__zurSetSelect("sel-formation", "fractal-core")`);
  for (const segments of [0, 4, 8, 16]) {
    await evaluate(`window.__zurSetSelect("sel-kaleido", "${segments}")`);
    const m = await m007(`mega kaleido ${segments}`, "diskLitFraction");
    results.mega[`k${segments}`] = { disk: m.diskLitFraction, diskLuma: m.diskMeanLuma, offset: m.offset };
    if (!(m.diskLitFraction > 0.6)) problems.push(`megastructure core not centred @${segments} mirrors: disk lit ${m.diskLitFraction.toFixed(3)} <= 0.6 (offset ${m.offset})`);
    if (segments === 16) await shot("gh007-megastructure-16-mirrors-hud-open");
  }
  await evaluate("document.getElementById('btn-hide-hud').click()");
  await sleep(1800);
  const megaHidden = await m007("mega kaleido 16 hud hidden", "diskLitFraction");
  results.mega.k16hidden = { disk: megaHidden.diskLitFraction, offset: megaHidden.offset };
  if (Math.abs(megaHidden.offset) > 0.01) problems.push(`HUD hidden offset ${megaHidden.offset}`);
  if (!(megaHidden.diskLitFraction > 0.6)) problems.push(`megastructure core not centred @16 mirrors HUD hidden: ${megaHidden.diskLitFraction.toFixed(3)}`);
  await shot("gh007-megastructure-16-mirrors-hud-hidden");
  await evaluate("document.getElementById('stage').click()");
  await sleep(1800);
  await evaluate(`window.__zurSetSelect("sel-kaleido", "0")`);

  }

  if (!ONLY || ONLY.includes("fractal")) {
  // 2) fractal-core: volumetric in X, Y, Z (GPU state readback) and round at a 90-degree orbit.
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);
  await evaluate(`window.__zurSetSelect("sel-count", "64k")`);
  await evaluate(`window.__zurSetSelect("sel-formation", "fractal-core")`);
  await sleep(5000);
  const spread = await evaluate("window.__zurAxisSpread()");
  results.fractal.axisStd = spread.std;
  results.fractal.minAxisRatio = spread.minRatio;
  if (!(spread.minRatio > 0.55)) problems.push(`fractal-core is planar: axis std ${spread.std.map((v) => v.toFixed(2))} ratio ${spread.minRatio.toFixed(3)}`);
  // Jump the slow orbit (t * 0.06 rad) to 90 degrees: the camera now looks along X (old ring = edge-on).
  await evaluate("window.__ZUR_DEBUG__.particleSystem.simTime = (Math.PI / 2) / 0.06");
  const f90 = await m007("fractal-core 90deg", "litWidthRatio", 2500);
  results.fractal.orbit90 = { widthRatio: f90.litWidthRatio, heightRatio: f90.litHeightRatio };
  const orbitAngle = await evaluate("((window.__ZUR_DEBUG__.particleSystem.simTime * 0.06) * 180 / Math.PI) % 360");
  results.fractal.orbitDegrees = orbitAngle;
  await shot("gh007-fractal-core-orbit-90");
  // Edge-on ring = a 1-px vertical line; a shell must span a comparable width (w is ~0.45 h in portrait).
  if (!(f90.litWidthRatio > 0.35)) problems.push(`fractal-core edge-on at 90deg: litWidthRatio ${f90.litWidthRatio.toFixed(3)} <= 0.35`);
  if (!(f90.litHeightRatio > 0.15)) problems.push(`fractal-core 90deg litHeightRatio ${f90.litHeightRatio.toFixed(3)} <= 0.15`);

  }

  if (!ONLY || ONLY.includes("logo")) {
  // 3) logo-attractor readability under Oscillation 3.00 (wave) + Comet 0.81 at a 90-degree orbit (billboard).
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);
  await evaluate(`window.__zurSetSelect("sel-count", "${process.env.ZUR_LOGO_COUNT || "16k"}")`);
  await evaluate(`window.__zurSetSelect("sel-formation", "logo-attractor")`);
  const selectorPlacement = await evaluate(`(() => {
    const formation = document.getElementById("sel-formation").closest("label");
    const preset = document.getElementById("sel-attractor-preset");
    const next = formation.nextElementSibling;
    return {
      exists: Boolean(preset),
      visible: Boolean(preset) && !preset.closest("label").hidden,
      directlyBelow: next === preset?.closest("label"),
      options: preset ? [...preset.options].map((o) => o.value) : [],
    };
  })()`);
  results.logoSelector = selectorPlacement;
  if (!selectorPlacement.exists || !selectorPlacement.visible || !selectorPlacement.directlyBelow) {
    problems.push(`Logo / Attractor Text selector not directly below Formation ${JSON.stringify(selectorPlacement)}`);
  }
  for (const name of ["AI: UNDERGROUND", "MON DAAIN", "TENTH GATE", "ZUR", "custom"]) {
    if (!selectorPlacement.options.includes(name)) problems.push(`logo preset ${name} missing`);
  }
  await evaluate(`window.__zurSetSelect("sel-attractor-preset", "MON DAAIN")`);
  if (await evaluate("window.__ZUR_DEBUG__.state.preset.particles.attractorText") !== "MON DAAIN") problems.push("logo preset did not set attractorText");
  await evaluate(`window.__zurSetSelect("sel-attractor-preset", "custom")`);
  if (await evaluate("document.getElementById('txt-attractor').closest('label').hidden")) problems.push("custom logo input hidden after choosing Custom");
  await evaluate(`window.__zurSetText("txt-attractor", "ZUR 007")`);
  if (await evaluate("window.__ZUR_DEBUG__.state.preset.particles.attractorText") !== "ZUR 007") problems.push("custom logo text not applied");
  await evaluate(`window.__zurSetSelect("sel-attractor-preset", "MON DAAIN")`);
  await evaluate(`window.__zurSetSelect("sel-oscillation", "off")`);
  await evaluate("window.__ZUR_DEBUG__.particleSystem.simTime = (Math.PI / 2) / 0.06");
  // Headless SwiftShader runs the sim at ~0.2x real time (4-step cap per slow frame): wait on the GPU state
  // until glyph agents actually sit on their camera-billboarded targets (static glyph, oscillation off).
  let logoError = null;
  for (let k = 0; k < 40; k += 1) {
    await sleep(1000);
    logoError = await evaluate("window.__zurLogoError()");
    if (logoError.median < 0.06) break;
  }
  results.logoTargetErrorStatic = logoError;
  if (!(logoError.median < 0.1)) problems.push(`logo agents off-glyph: median target error ${logoError.median.toFixed(3)}`);
  // Worst case from the Galaxy capture: Oscillation wave 3.00 + Comet trail 0.81.
  await evaluate(`window.__zurSetSelect("sel-oscillation", "${process.env.ZUR_LOGO_OSC || "wave"}")`);
  await evaluate(`window.__zurSetRange("rng-osc-amount", 3)`);
  await evaluate(`window.__zurSetSelect("sel-trail-type", "comet")`);
  await evaluate(`window.__zurSetRange("rng-trail-length", 0.81)`);
  await sleep(8000);
  const logoErrorOsc = await evaluate("window.__zurLogoError()");
  results.logoTargetErrorOsc3 = logoErrorOsc;
  // 3.00 x 0.08 scale -> <= ~0.3 world units of coherent wave; unscaled 3.00 would be ~2-3 units.
  if (!(logoErrorOsc.median < 0.35)) problems.push(`logo oscillation not scaled: median offset ${logoErrorOsc.median.toFixed(3)} >= 0.35`);
  const logo = await m007("logo-attractor", "textRuns", 300);
  results.logo = { textRuns: logo.textRuns, widthRatio: logo.litWidthRatio, heightRatio: logo.litHeightRatio };
  results.logo.orbitDegrees = await evaluate("((window.__ZUR_DEBUG__.particleSystem.simTime * 0.06) * 180 / Math.PI) % 360");
  results.logo.billboard = await evaluate("({ eye: [...window.__ZUR_DEBUG__.particleSystem.eye], right: [...window.__ZUR_DEBUG__.particleSystem.billboardRight], up: [...window.__ZUR_DEBUG__.particleSystem.billboardUp] })");
  await shot("gh007-logo-attractor-mon-daain-osc3-comet081");
  if (!(logo.textRuns >= 6)) problems.push(`logo-attractor unreadable: ${logo.textRuns} glyph runs < 6`);
  if (!(logo.litWidthRatio > 0.5)) problems.push(`logo not billboarded at 90deg: width ${logo.litWidthRatio.toFixed(3)}`);
  if (!(logo.litHeightRatio < 0.3)) problems.push(`logo smeared vertically: height ${logo.litHeightRatio.toFixed(3)} >= 0.3`);
  await evaluate(`window.__zurSetSelect("sel-oscillation", "off")`);
  await evaluate(`window.__zurSetRange("rng-trail-length", 0.4)`);

  }

  if (!ONLY || ONLY.includes("canyon")) {
  // 4) spectral-canyon-3d synthwave grid density + palette-only mid-luma fill (HUD open, 412x915).
  await evaluate(`window.__zurSetSelect("sel-scene", "spectral-canyon-3d")`);
  const canyon = await m007("spectral canyon", "upperMidLumaFraction", 2000);
  results.canyon = canyon;
  await shot("gh007-spectral-canyon-hud-open");
  if (!(canyon.upperMidLumaFraction >= 0.35)) problems.push(`canyon upper mid-luma ${canyon.upperMidLumaFraction.toFixed(3)} < 0.35`);
  if (!(canyon.gridCrossings >= 12)) problems.push(`canyon grid crossings ${canyon.gridCrossings} < 12`);
  if (!(canyon.upperMaxLuma < 0.9)) problems.push(`canyon white blowout: max luma ${canyon.upperMaxLuma.toFixed(3)} >= 0.90`);
  await evaluate("document.getElementById('btn-hide-hud').click()");
  await sleep(1800);
  const canyonHidden = await m007("spectral canyon hud hidden", "upperMidLumaFraction", 500);
  results.canyonHidden = canyonHidden;
  await shot("gh007-spectral-canyon-hud-hidden");
  if (!(canyonHidden.upperMidLumaFraction >= 0.35)) problems.push(`canyon (HUD hidden) mid-luma ${canyonHidden.upperMidLumaFraction.toFixed(3)} < 0.35`);
  if (!(canyonHidden.gridCrossings >= 12)) problems.push(`canyon (HUD hidden) grid crossings ${canyonHidden.gridCrossings} < 12`);
  if (!(canyonHidden.upperMaxLuma < 0.9)) problems.push(`canyon (HUD hidden) blowout ${canyonHidden.upperMaxLuma.toFixed(3)}`);
  await evaluate("document.getElementById('stage').click()");
  await sleep(800);
  await evaluate(`window.__zurSetSelect("sel-scene", "particle-swarm-3d")`);

  }

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
  console.error(`ZUR-GH-007 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ZUR-GH-007 SMOKE PASS");
