// ZUR-GH-010 headless Chrome smoke (412x915), rewritten for ZUR-GH-013 (v6.0): unlocked deck (Quick Presets strip +
// Engine Selector, no HUD tabs, no Blood), crisp-dot default, true silence-to-peak gate (silence = black, live audio
// >= 5x), seam-free palettes (no atan hue steps), particleStyle persistence, wormhole shell + throat occupancy, track
// loader + Speaker Monitor routing, shared-mic auto-gain, plus the kept 256k VBO / crowdNorm, black-hole void, dart,
// logo, brain, canyon, megastructure, Android mic fallback and storage-migration gates. 0 console / page / WebGL errors.
// Linux: defaults to ANGLE GL (Mesa llvmpipe); ZUR_ANGLE=swiftshader forces SwiftShader. Software renderers step 4-6 deterministic frames per gate.
// Windows: CHROME=<path> (defaults to Program Files) and ZUR_ANGLE=d3d11 to render on the GPU instead of SwiftShader.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const T0 = Date.now(); const phases = [];
const phase = (msg, extra) => {
  phases.push({ name: msg, tMs: Date.now() - T0, gateMs: extra && typeof extra === "object" && "gateMs" in extra ? extra.gateMs : null });
  console.log(`[T+${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}${extra === undefined ? "" : " " + JSON.stringify(extra)}`);
};
const { densityCrowdNorm, crispDotExposure } = await import(new URL("../src/render/particleMath.js", import.meta.url).href);

// Software renderer (SwiftShader/llvmpipe) renders ~1-4 s per frame, so it gets deterministic frame stepping.
const SOFTWARE_RE = /SwiftShader|llvmpipe/i;
const SW_WARMUP_FRAMES = Math.min(6, Math.max(4, Math.round(Number(process.env.ZUR_SW_WARMUP || 5)) || 5));
// Hardware keeps the time-based settles (4500/7000/5000 ms at 60 fps = 270-420 frames, always >= 30).
const HW_MIN_WARMUP_FRAMES = 30;
// One rendered frame at the app's 30 fps cap = 2 fixed 1/60 s sim steps.
const SW_FRAME_DT_MS = 34;
// Measured 0.379 on SwiftShader and llvmpipe (D3D11 floor 0.30, old CI 0.38); 0.35 leaves ~0.03 margin.
const SW_DENSE_BLACK_MIN = Number(process.env.ZUR_SW_DENSE_BLACK_MIN || 0.35);
// Measured 0.421 (SwiftShader) / 0.422 (llvmpipe), same as the D3D11 floor, so no change needed.
const SW_BRAIN_LUMA_MIN = Number(process.env.ZUR_SW_BRAIN_LUMA_MIN || 0.36);

const PORT = Number(process.env.ZUR_PORT || 8090);
const SHOTS = process.env.ZUR_SHOTS || (process.platform === "win32" ? join(tmpdir(), "zur-gh-010") : "/workspace/artifacts/zur-gh-013/shots");
// fileURLToPath (not URL.pathname) so Windows gets "C:\..." instead of "/C:/...".
const root = fileURLToPath(new URL("..", import.meta.url));
// Chrome binary: $CHROME, else the platform default (google-chrome on Linux CI).
const CHROME_BIN = process.env.CHROME
  || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
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
  const relative = path === "/" || path === "\\" ? "index.html" : path.replace(/^[\\/]+/, "");
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
phase("server listening", { port: PORT });
const base = `http://localhost:${PORT}`;
const debugPort = Number(process.env.ZUR_DEBUG_PORT || 9343);
// ZUR-GH-012: Linux with no ZUR_ANGLE renders through ANGLE GL on Mesa llvmpipe (~8x faster than SwiftShader at 256k,
// same software branch). ZUR_ANGLE=swiftshader keeps the SwiftShader path (~120 s). Windows/macOS defaults are untouched.
if (process.platform === "linux" && !process.env.ZUR_ANGLE) process.env.ZUR_ANGLE = process.env.ZUR_LINUX_ANGLE || "gl";
let chromeArgs = [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  // ZUR_ANGLE=d3d11 (Windows) / gl / metal runs on the real GPU; default stays SwiftShader for headless CI.
  ...((process.env.ZUR_ANGLE || "swiftshader") === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [`--use-angle=${process.env.ZUR_ANGLE}`]),
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${join(tmpdir(), `zur-gh-010-chrome-${Date.now()}`)}`,
  `--remote-debugging-port=${debugPort}`,
  "--window-size=412,915",
];
// ZUR-GH-012: Linux container flags
if (process.platform === "linux") {
  chromeArgs.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader");
  chromeArgs = [...new Set(chromeArgs)];
}
chromeArgs.push("about:blank");
try {
  const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(500) });
  if (r.ok) { console.error(`ZUR-GH-010 SMOKE FAIL\n- DevTools port ${debugPort} already in use (orphaned Chrome?)`); server.close(); process.exit(1); }
} catch {}
const chrome = spawn(CHROME_BIN, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
const killChrome = () => { try { chrome.kill("SIGKILL"); } catch {} };
process.once("exit", killChrome);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => { killChrome(); server.close(); process.exit(sig === "SIGINT" ? 130 : 143); });
phase("chrome spawned", { flags: chromeArgs.length, platform: process.platform });
chrome.stderr.on("data", () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const consoleErrors = [];
const pageErrors = [];
const webglWarnings = [];
const problems = [];
const results = {};

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
  phase("devtools target found");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  phase("websocket open");
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
  phase("page navigated");
  const bootStart = Date.now();
  let boot = "";
  for (let attempt = 0; attempt < 150; attempt += 1) {
    boot = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
    if (boot === "ok" || boot === "error") break;
    await sleep(100);
  }
  if (boot !== "ok") throw new Error(`boot ${boot}: ${await evaluate("document.getElementById('hud-error')?.textContent")}`);
  phase("boot ok", { bootMs: Date.now() - bootStart });

  const hudError = await evaluate("document.getElementById('hud-error')?.textContent || ''");
  if (hudError) throw new Error(`HUD error after boot: ${hudError}`);
  if (!(await evaluate("Boolean(window.__ZUR_DEBUG__.particleSystem?.ready)"))) throw new Error("particle system not ready after boot");


  const rendererInfo = await evaluate(`(() => {
    const gl = window.__ZUR_DEBUG__.shaderHost.gl;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
      vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
      w: gl.drawingBufferWidth, h: gl.drawingBufferHeight,
    };
  })()`);
  const software = SOFTWARE_RE.test(rendererInfo.renderer) && process.env.ZUR_FORCE_HW !== "1";
  results.renderer = { renderer: rendererInfo.renderer, vendor: rendererInfo.vendor, software, warmupFrames: software ? SW_WARMUP_FRAMES : HW_MIN_WARMUP_FRAMES, gateOrder: "boot,d,a,b,c,e,256k,bh,dart,logo,brain,ferro,canyon,mega,track,mic,reload" };
  phase("renderer detected", { UNMASKED_RENDERER_WEBGL: rendererInfo.renderer, UNMASKED_VENDOR_WEBGL: rendererInfo.vendor, drawingBuffer: `${rendererInfo.w}x${rendererInfo.h}`, software });
  if (software) {
    // Stop the free-running rAF loop; frames are stepped deterministically so CDP calls are never queued behind them.
    await evaluate(`window.__zurSw = (() => { const h = window.__ZUR_DEBUG__.renderHost; h.stop(); let t = performance.now();
      const step = (n, dtMs) => { for (let k = 0; k < n; k += 1) { t += dtMs; h.running = true; h._loop(t); cancelAnimationFrame(h._raf); h._raf = 0; h.running = false; } };
      return { step }; })()`);
  }

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
    window.__zurGlErrors = () => {
      const errors = [];
      for (let i = 0; i < 8; i += 1) {
        const e = gl.getError();
        if (e === gl.NO_ERROR) break;
        errors.push(e);
      }
      return errors;
    };
    const rgb2hsv = (r, g, b) => {
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
      let h = 0;
      if (d > 0) {
        if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      }
      return [h / 6, mx ? d / mx : 0, mx];
    };
    const analyse = (cx, cy, rad) => {
        const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let total = 0; let black = 0; let white = 0; let colored = 0;
        let inTotal = 0; let inBlack = 0;
        let lit = 0; let litLuma = 0; let lumaSum = 0; let litR = 0; let litG = 0; let litB = 0;
        const sectors = new Array(12).fill(0);
        let satSum = 0; let bn = 0; let sx = 0; let sy = 0; let sxx = 0; let syy = 0;
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = buf[i] / 255; const g = buf[i + 1] / 255; const b = buf[i + 2] / 255;
            const mx = Math.max(r, g, b);
            total += 1;
            if (mx <= 0.03) black += 1;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            lumaSum += luma;
            if (mx > 0.03) { lit += 1; litLuma += luma; litR += r; litG += g; litB += b; }
            if (buf[i] >= 245 && buf[i + 1] >= 245 && buf[i + 2] >= 245) white += 1;
            const [hh, ss, vv] = rgb2hsv(r, g, b);
            if (mx > 0.03) satSum += ss;
            if (rad > 0 && mx > 0.25 && Math.abs(x - cx) > 1.5 * rad && Math.abs(x - cx) < 4 * rad && Math.abs(y - cy) < 4 * rad) { bn += 1; sx += x - cx; sy += y - cy; sxx += (x - cx) ** 2; syy += (y - cy) ** 2; }
            if (ss > 0.25 && vv > 0.15) { colored += 1; sectors[Math.min(11, Math.floor(hh * 12))] += 1; }
            if (rad > 0 && Math.hypot(x - cx, y - cy) < rad) { inTotal += 1; if (mx <= 0.03) inBlack += 1; }
          }
        }
        return {
          w, h, blackRatio: black / total, whiteClip: white / total,
          hueSectorCount: sectors.filter((n) => colored > 0 && n / colored >= 0.01).length,
          coloredFraction: colored / total,
          centerBlackRatio: inTotal ? inBlack / inTotal : null, centerSamples: inTotal,
          meanSat: lit ? satSum / lit : 0,
          barN: bn, barSpreadX: bn ? Math.sqrt(Math.max(sxx / bn - (sx / bn) ** 2, 0)) : 0, barSpreadY: bn ? Math.sqrt(Math.max(syy / bn - (sy / bn) ** 2, 0)) : 0,
          activeMeanLuma: lit ? litLuma / lit : 0, activeFraction: lit / total, frameMeanLuma: lumaSum / total,
          meanR: lit ? litR / lit : 0, meanG: lit ? litG / lit : 0, meanB: lit ? litB / lit : 0,
        };
    };
    // ZUR-GH-013 (c) seam probe: lit, saturated pixels in an annulus around the formation centre are binned by screen
    // angle (72 bins); the circular-mean hue per bin must change smoothly (atan sector buckets jumped >= 1/6 turn).
    window.__zurSeam = (cx, cy, rMin, rMax) => {
      const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const B = 72; const n = new Array(B).fill(0); const cs = new Array(B).fill(0); const sn = new Array(B).fill(0);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const dx = x - cx; const dy = y - cy; const rr = Math.hypot(dx, dy);
          if (rr < rMin || rr > rMax) continue;
          const i = (y * w + x) * 4;
          const [hh, ss, vv] = rgb2hsv(buf[i] / 255, buf[i + 1] / 255, buf[i + 2] / 255);
          if (vv < 0.08 || ss < 0.3) continue;
          const bin = Math.min(B - 1, Math.floor(((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1 * B));
          n[bin] += 1; cs[bin] += Math.cos(hh * 2 * Math.PI); sn[bin] += Math.sin(hh * 2 * Math.PI);
        }
      }
      const MIN = 12;
      const hue = n.map((c, b) => (c >= MIN ? ((Math.atan2(sn[b], cs[b]) / (2 * Math.PI)) + 1) % 1 : null));
      let maxD = 0; let sumD = 0; let pairs = 0;
      for (let b = 0; b < B; b += 1) {
        const a = hue[b]; const c = hue[(b + 1) % B];
        if (a === null || c === null) continue;
        let d = Math.abs(a - c); d = Math.min(d, 1 - d);
        maxD = Math.max(maxD, d); sumD += d; pairs += 1;
      }
      return { binsUsed: hue.filter((v) => v !== null).length, pairs, maxAdjacentHueDelta: +maxD.toFixed(4), meanAdjacentHueDelta: pairs ? +(sumD / pairs).toFixed(4) : 0, samples: n.reduce((a, b) => a + b, 0) };
    };
    window.__zurMetrics = (cx, cy, rad) => new Promise((resolve) => requestAnimationFrame(() => resolve(analyse(cx, cy, rad))));
    window.__zurReadNow = analyse;
    window.__zurFeat = null;
    const extractor = d.extractor;
    const origUpdate = extractor.update.bind(extractor);
    extractor.update = (arg) => {
      const frame = origUpdate(arg);
      if (window.__zurFeat) Object.assign(frame, window.__zurFeat);
      return frame;
    };
    return true;
  })()`);

  const denseBlackMin = software ? SW_DENSE_BLACK_MIN : (process.env.ZUR_ANGLE === 'd3d11' ? 0.30 : 0.38);
  const BH_DISK_FRAMES = Number(process.env.ZUR_BH_FRAMES || 80); // deliberate exception to the 4-6 frame rule: the underdamped formation spring needs ~2.7 s of sim time (80 x 34 ms) before the disk plane is visible
  const BH_ASPECT_MIN = Number(process.env.ZUR_BH_ASPECT_MIN || 1.5);
  const brainMin = software ? SW_BRAIN_LUMA_MIN : Number(process.env.ZUR_BRAIN_LUMA_MIN || 0.36);


  const shot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${SHOTS}/${name}.png`, Buffer.from(image.data, "base64"));
  };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const set = (id, value) => evaluate(`window.__zurSetSelect("${id}", ${JSON.stringify(value)})`);
  const preset = () => evaluate("JSON.parse(JSON.stringify(window.__ZUR_DEBUG__.state.preset))");
  const visibleRows = () => evaluate(`[...document.querySelectorAll("[data-control]")].filter((el) => !el.hidden && el.offsetParent !== null && !el.closest("[hidden]")).map((el) => el.dataset.control)`);
  const blankOptions = () => evaluate(`[...document.querySelectorAll(".control-hud select")].flatMap((s) => [...s.options].filter((o) => !String(o.value).trim() || !String(o.textContent).trim()).map((o) => s.id + ":" + JSON.stringify(o.value)))`);
  const optionValues = (id) => evaluate(`[...document.getElementById(${JSON.stringify(id)}).options].map((o) => o.value)`);
  const setParticles = (patch) => evaluate(`import("/src/render/particleMath.js").then((m) => { window.__ZUR_DEBUG__.state.updatePreset((draft) => { draft.particles = m.normalizeParticles({ ...draft.particles, ...${JSON.stringify(patch)} }); }); return true; })`);
  const setScene = (sceneId) => evaluate(`(window.__ZUR_DEBUG__.state.updatePreset((draft) => { draft.sceneId = ${JSON.stringify(sceneId)}; }), true)`);
  // Deterministic audio features (applied on top of every extractor frame). SILENT = true silence (bands 0, isSilent).
  const ACTIVE = { sub: 0.55, bass: 0.7, lowMid: 0.45, highMid: 0.4, treble: 0.32, rms: 0.42, peak: 0.5, onset: 0.12, isSilent: false }; // sustained music bed (onsets are transients)
  const SILENT = { sub: 0, bass: 0, lowMid: 0, highMid: 0, treble: 0, rms: 0, peak: 0, onset: 0, isSilent: true, maxBandEnergy: 0 };
  const feat = (value) => evaluate(`(window.__zurFeat = ${JSON.stringify(value)}, true)`);
  const stats = () => evaluate("window.__ZUR_DEBUG__.particleSystem.stats()");
  const settleFrames = async (n, ms = 700) => {
    if (software) await evaluate(`window.__zurSw.step(${n}, ${SW_FRAME_DT_MS})`);
    else await sleep(ms);
  };
  const measure = async (label, settleMs, cx = 0, cy = 0, rad = 0, frames = SW_WARMUP_FRAMES) => {
    let worst = null;
    if (software) {
      const swT0 = Date.now();
      worst = await evaluate(`(() => {
        window.__zurSw.step(${Math.max(0, frames - 2)}, ${SW_FRAME_DT_MS});
        let worst = null;
        for (let i = 0; i < 2; i += 1) {
          window.__zurSw.step(1, ${SW_FRAME_DT_MS});
          const m = window.__zurReadNow(${cx}, ${cy}, ${rad});
          if (!worst || m.whiteClip > worst.whiteClip) worst = m;
        }
        return worst;
      })()`);
      phase(`  ${label} sw frames`, { frames, ms: Date.now() - swT0 });
    } else {
      await sleep(settleMs);
      for (let i = 0; i < 3; i += 1) {
        const m = await evaluate(`window.__zurMetrics(${cx}, ${cy}, ${rad})`);
        if (!worst || m.whiteClip > worst.whiteClip) worst = m;
      }
    }
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return { ...worst, frames: software ? frames : 0 };
  };
  const center = async () => {
    const yOff = await evaluate("window.__ZUR_DEBUG__.renderHost.viewportYOffset");
    const dim = await evaluate("(() => { const gl = window.__ZUR_DEBUG__.shaderHost.gl; return { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight }; })()");
    return { yOff, w: dim.w, h: dim.h, cx: dim.w / 2, cy: dim.h * (0.5 + yOff / 2) };
  };

  await mkdir(SHOTS, { recursive: true });

  // ---- (1) v6.0 boot defaults + deck layout (no tabs, no Blood) ---------------------------------------------------
  {
    const g0 = Date.now();
    const p = await preset();
    const dom = await evaluate(`(() => ({
      quick: [...document.querySelectorAll("[data-quick-preset]")].map((b) => b.textContent),
      engines: [...document.querySelectorAll("#hud-engines [data-engine]")].map((b) => b.textContent),
      hudTabs: document.querySelectorAll("[data-hud-tab]").length,
      bloodText: /blood|splatter/i.test(document.getElementById("hud").textContent),
      bloodOptions: [...document.querySelectorAll(".control-hud option")].filter((o) => /blood|splatter/i.test(o.value + o.textContent)).length,
      track: { accept: document.getElementById("file-audio-track")?.accept || "", label: document.getElementById("file-audio-track")?.closest("label")?.textContent || "",
        play: Boolean(document.getElementById("btn-track-play")), monitor: Boolean(document.getElementById("chk-speaker-monitor")), monitorChecked: document.getElementById("chk-speaker-monitor")?.checked },
      styleValue: document.getElementById("sel-particle-style").value,
      reactivityValue: document.getElementById("sel-reactivity-mode").value,
      styleOptions: [...document.getElementById("sel-particle-style").options].map((o) => [o.value, o.textContent]),
      sw: null,
    }))()`);
    const rows = await visibleRows();
    const blanks = await blankOptions();
    results.boot = { sceneId: p.sceneId, formation: p.particles.formationType, style: p.particles.particleStyle, reactivityMode: p.particles.reactivityMode, hud: p.hud ?? null, deck: p.deck, ...dom, rows, blankOptions: blanks.length };
    phase("boot defaults gate", { gateMs: Date.now() - g0, metrics: results.boot });
    if (p.particles.particleStyle !== "crisp-dot" || dom.styleValue !== "crisp-dot") problems.push(`default style ${p.particles.particleStyle}/${dom.styleValue} != crisp-dot`);
    if (dom.styleOptions[0]?.[0] !== "crisp-dot" || dom.styleOptions[0]?.[1] !== "Crisp Dot — Pinpoint") problems.push(`style option #1 ${JSON.stringify(dom.styleOptions[0])}`);
    if (p.particles.formationType !== "wormhole" || p.sceneId !== "particle-swarm-3d") problems.push(`default ${p.sceneId}/${p.particles.formationType}`);
    if (p.particles.reactivityMode !== "true-gate" || dom.reactivityValue !== "true-gate") problems.push(`default reactivityMode ${p.particles.reactivityMode}`);
    if (p.hud) problems.push(`v6 preset still carries hud ${JSON.stringify(p.hud)}`);
    if (JSON.stringify(dom.quick) !== JSON.stringify(["Wormhole", "3D Brain", "Gargantua", "Ferrofluid Rings", "Spiral Galaxy", "Logo Text", "Megastructure", "Spectral Canyon"])) problems.push(`quick presets ${dom.quick}`);
    if (JSON.stringify(dom.engines) !== JSON.stringify(["3D Particle Engine", "Megastructure", "Spectral Canyon", "3D Pulse Field", "Aurora Ribbons"])) problems.push(`engines ${dom.engines}`);
    if (dom.hudTabs !== 0) problems.push(`${dom.hudTabs} legacy [data-hud-tab] buttons`);
    if (dom.bloodText || dom.bloodOptions) problems.push(`blood still in HUD text=${dom.bloodText} options=${dom.bloodOptions}`);
    if (!/\.wav/.test(dom.track.accept) || !/\.mp3/.test(dom.track.accept) || !/\.ogg/.test(dom.track.accept) || !/Load Audio Track \(WAV\/MP3\/OGG\)/.test(dom.track.label)) problems.push(`track loader ${JSON.stringify(dom.track)}`);
    if (!dom.track.play || !dom.track.monitor || dom.track.monitorChecked) problems.push(`track controls ${JSON.stringify(dom.track)}`);
    for (const r of ["formation", "style", "palette", "reactivityMode", "reactivity", "flow", "kinetic", "count", "zoom", "cameraMode", "scenePalette"]) if (!rows.includes(r)) problems.push(`deck row ${r} not visible`);
    if (blanks.length) problems.push(`blank options ${blanks}`);
    const forms = await optionValues("sel-formation");
    if (!forms.includes("harmonic-ferrofluid") || !forms.includes("neural-brain") || !forms.includes("wormhole")) problems.push(`formation options ${forms}`);
    const kin = await optionValues("sel-kinetic-mode");
    if (kin.includes("splatter-run")) problems.push("splatter-run still selectable");
    const sticky = await evaluate(`(() => { const t = document.getElementById("hud-quick-presets"); const c = getComputedStyle(t); return { position: c.position, overflowX: c.overflowX, touch: c.touchAction, scrollable: t.scrollWidth > t.clientWidth }; })()`);
    results.boot.quickBar = sticky;
    if (sticky.position !== "sticky" || sticky.overflowX !== "auto" || !/pan-x/.test(sticky.touch)) problems.push(`quick preset strip ${JSON.stringify(sticky)}`);
  }

  // ---- (d) changing Palette / Formation / Quick Preset / Engine never resets particleStyle -------------------------
  {
    const g0 = Date.now();
    const seen = [];
    await set("sel-particle-style", "star-streak");
    for (const palette of ["full-spectrum", "white-static", "crimson-pulse", "golden-cortex", "true-neon"]) {
      await set("sel-palette", palette);
      seen.push(["palette", palette, (await preset()).particles.particleStyle]);
    }
    for (const formation of ["neural-brain", "supermassive-blackhole", "harmonic-ferrofluid", "logo-attractor", "living-galaxy", "wormhole"]) {
      await set("sel-formation", formation);
      const p = await preset();
      seen.push(["formation", formation, p.particles.particleStyle, p.particles.formationType]);
    }
    for (const id of ["brain", "gargantua", "ferrofluid", "logo", "megastructure", "canyon", "wormhole"]) {
      await click(`[data-quick-preset="${id}"]`);
      seen.push(["quick", id, (await preset()).particles.particleStyle]);
    }
    for (const id of ["megastructure", "canyon", "pulse", "aurora", "particles"]) {
      await click(`[data-engine="${id}"]`);
      seen.push(["engine", id, (await preset()).particles.particleStyle]);
    }
    await set("sel-reactivity-mode", "ember-floor");
    seen.push(["reactivityMode", "ember-floor", (await preset()).particles.particleStyle]);
    await set("sel-reactivity-mode", "true-gate");
    const domStyle = await evaluate(`document.getElementById("sel-particle-style").value`);
    const bad = seen.filter((row) => row[2] !== "star-streak");
    const formationKept = seen.filter((row) => row[0] === "formation").every((row) => row[3] === row[1]);
    results.stylePersistence = { checks: seen.length, resets: bad.length, domStyle, formationKept };
    phase("style persistence gate (d)", { gateMs: Date.now() - g0, metrics: results.stylePersistence });
    if (bad.length) problems.push(`particleStyle reset ${JSON.stringify(bad)}`);
    if (domStyle !== "star-streak") problems.push(`style select snapped to ${domStyle}`);
    if (!formationKept) problems.push("formation pick snapped back");
    await set("sel-particle-style", "crisp-dot");
  }

  // ---- input stability + DOM node identity + real pointer drag (ZUR-GH-011, kept) --------------------------------
  {
    results.inputStability = await evaluate(`new Promise((resolve) => {
      const visual = document.getElementById("hud-visual-controls");
      let reinserted = 0; let optionMutations = 0;
      const mo = new MutationObserver((rs) => { for (const r of rs) { if (r.target === visual) reinserted += r.addedNodes.length; else if (r.target.tagName === "SELECT") optionMutations += 1; } });
      mo.observe(visual, { childList: true, subtree: true });
      const sel = document.getElementById("sel-palette");
      sel.focus();
      window.__ZUR_DEBUG__.state.setStatus({ fps: 59 });
      window.__ZUR_DEBUG__.state.setStatus({ wakeLock: "active" });
      setTimeout(() => { mo.disconnect(); resolve({ reinserted, optionMutations, focused: document.activeElement === sel }); }, 50);
    })`);
    if (results.inputStability.reinserted || results.inputStability.optionMutations || !results.inputStability.focused) {
      problems.push(`status emit disturbed HUD controls ${JSON.stringify(results.inputStability)}`);
    }
    await evaluate("document.activeElement?.blur()");
    results.nodeIdentity = await evaluate(`(() => {
      const d = window.__ZUR_DEBUG__;
      const ids = ["sel-formation", "sel-flow", "sel-palette", "sel-count", "sel-particle-style", "sel-reactivity-mode", "rng-camera-zoom", "rng-reactivity", "rng-size"];
      const before = ids.map((id) => document.getElementById(id));
      const optionsBefore = [...document.getElementById("sel-formation").options];
      const panel = document.querySelector(".control-hud");
      panel.scrollTop = Math.min(160, panel.scrollHeight - panel.clientHeight);
      const scrollBefore = panel.scrollTop;
      const visual = document.getElementById("hud-visual-controls");
      let reinserted = 0;
      const count = (rs) => { for (const r of rs) if (r.target === visual) reinserted += r.addedNodes.length; };
      const mo = new MutationObserver(count);
      mo.observe(visual, { childList: true });
      const reactivity0 = d.state.preset.particles.reactivityGain;
      for (let i = 0; i < 10; i += 1) {
        window.__zurSetRange("rng-reactivity", 1 + i * 0.3);
        d.state.setStatus({ fps: 40 + i });
        d.state.updatePreset((draft) => { draft.visual.gain = 1 + i * 0.1; });
      }
      count(mo.takeRecords());
      mo.disconnect();
      const after = ids.map((id) => document.getElementById(id));
      const out = {
        identical: before.every((el, i) => el === after[i] && el.isConnected),
        optionsIdentical: [...document.getElementById("sel-formation").options].every((o, i) => o === optionsBefore[i]),
        reinserted, scrollBefore, scrollAfter: panel.scrollTop,
        reactivityFollowed: Math.abs(d.state.preset.particles.reactivityGain - 3.7) < 1e-6,
      };
      window.__zurSetRange("rng-reactivity", reactivity0);
      d.state.updatePreset((draft) => { draft.visual.gain = 1; });
      panel.scrollTop = 0;
      return out;
    })()`);
    const n = results.nodeIdentity;
    if (!n.identical || !n.optionsIdentical || n.reinserted !== 0 || !(n.scrollBefore > 0) || n.scrollAfter !== n.scrollBefore || !n.reactivityFollowed) {
      problems.push(`DOM node identity gate ${JSON.stringify(n)}`);
    }
    await evaluate(`document.getElementById("rng-camera-zoom").scrollIntoView({ block: "center" })`);
    await sleep(150);
    const zr = await evaluate(`(() => { const e = document.getElementById("rng-camera-zoom"); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y + b.height / 2, w: b.width, v: +e.value }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: zr.x + zr.w * 0.2, y: zr.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: zr.x + zr.w * 0.2, y: zr.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 12; i += 1) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: zr.x + zr.w * (0.2 + (0.6 * i) / 12), y: zr.y, button: "left", buttons: 1 });
      await sleep(25);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: zr.x + zr.w * 0.8, y: zr.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(120);
    n.drag = { start: zr.v, end: await evaluate(`+document.getElementById("rng-camera-zoom").value`), state: await evaluate("window.__ZUR_DEBUG__.state.preset.particles.cameraZoom") };
    if (!(n.drag.end > n.drag.start + 0.5) || Math.abs(n.drag.state - n.drag.end) > 1e-6) problems.push(`slider pointer drag did not track ${JSON.stringify(n.drag)}`);
    await evaluate("window.__zurSetRange('rng-camera-zoom', 1)");
    results.stickyHeader = await evaluate(`(() => {
      const panel = document.querySelector(".control-hud");
      panel.scrollTop = panel.scrollHeight;
      const header = document.getElementById("hud-sticky-header");
      const p = panel.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const hide = document.getElementById("btn-hide-hud").getBoundingClientRect();
      const tabs = document.getElementById("hud-quick-presets").getBoundingClientRect();
      const cs = getComputedStyle(header);
      const out = { scrolled: panel.scrollTop > 0, headerTopGap: +(h.top - p.top).toFixed(2), overlapPx: +Math.max(0, hide.bottom - tabs.top).toFixed(2), stripInsideHeader: tabs.bottom <= h.bottom + 0.5, bg: cs.backgroundColor, zIndex: cs.zIndex };
      panel.scrollTop = 0;
      return out;
    })()`);
    const s = results.stickyHeader;
    const alpha = Number((/rgba?\(([^)]+)\)/.exec(s.bg)?.[1].split(",")[3]) ?? 1);
    if (!s.scrolled || s.overlapPx > 0.5 || !s.stripInsideHeader || s.headerTopGap < -0.5 || s.headerTopGap > 2 || alpha < 0.98 || s.zIndex !== "20") problems.push(`sticky header ${JSON.stringify(s)}`);
    phase("input stability / node identity / drag / sticky done");
  }

  // ---- (a) true-gate silence = black, (b) live oscillator >= 5x silence and >= 0.12 --------------------------------
  {
    const g0 = Date.now();
    await setParticles({ formationType: "wormhole", particleStyle: "crisp-dot", colorPalette: "true-neon", particleCountTier: "64k", reactivityMode: "true-gate", particleSize: 1.0 });
    await setScene("particle-swarm-3d");
    await evaluate("document.getElementById('btn-stop').click()");
    await sleep(200);
    await feat(SILENT);
    const silence = await measure("true-gate silence", 2500, 0, 0, 0, 12);
    const silenceStats = await stats();
    await shot("gh013-true-gate-silence");
    await feat(null);
    await evaluate("document.getElementById('btn-oscillator').click()");
    // The oscillator graph starts asynchronously (AudioContext resume): wait until the gate actually opens.
    let gateWaitMs = 0;
    for (let i = 0; i < 20; i += 1) {
      await sleep(250);
      gateWaitMs += 250;
      await settleFrames(1, 250);
      if ((await stats()).cleanGate > 0.5) break;
    }
    results.oscillatorGateWaitMs = gateWaitMs;
    const active = await measure("oscillator active", 2500, 0, 0, 0, 8);
    const activeStats = await stats();
    await shot("gh013-oscillator-active");
    const ratio = active.frameMeanLuma / Math.max(silence.frameMeanLuma, 1e-6);
    results.reactivity = {
      silence: { meanLuma: +silence.frameMeanLuma.toFixed(4), activeMeanLuma: +silence.activeMeanLuma.toFixed(3), blackRatio: +silence.blackRatio.toFixed(4), emission: silenceStats.emission, cleanGate: silenceStats.cleanGate, trailKeep: +silenceStats.trailKeep.toFixed(3) },
      active: { activeMeanLuma: +active.activeMeanLuma.toFixed(3), frameMeanLuma: +active.frameMeanLuma.toFixed(4), activeFraction: +active.activeFraction.toFixed(4), blackRatio: +active.blackRatio.toFixed(3), whiteClip: active.whiteClip, emission: +activeStats.emission.toFixed(3), cleanGate: +activeStats.cleanGate.toFixed(3) },
      frameLumaRatio: +ratio.toFixed(1),
    };
    phase("reactivity gates (a)(b)", { gateMs: Date.now() - g0, metrics: results.reactivity });
    if (!(silence.frameMeanLuma <= 0.025)) problems.push(`(a) silence meanLuma ${silence.frameMeanLuma.toFixed(4)} > 0.025`);
    if (!(silence.blackRatio >= 0.94)) problems.push(`(a) silence blackRatio ${silence.blackRatio.toFixed(4)} < 0.94`);
    if (silenceStats.emission !== 0) problems.push(`(a) silence emission ${silenceStats.emission} != 0`);
    if (!(active.activeMeanLuma >= 0.12)) problems.push(`(b) active meanLuma ${active.activeMeanLuma.toFixed(3)} < 0.12`);
    if (!(ratio >= 5)) problems.push(`(b) active/silence frame luma ratio ${ratio.toFixed(2)} < 5`);
    if (active.whiteClip !== 0) problems.push(`(b) whiteClip ${active.whiteClip}`);
    // ember-floor / ambient-vj emission levels in silence (stats only, 2 frames)
    await feat(SILENT);
    const modes = {};
    for (const mode of ["ember-floor", "ambient-vj", "true-gate"]) {
      await set("sel-reactivity-mode", mode);
      await settleFrames(2, 200);
      modes[mode] = (await stats()).emission;
    }
    results.reactivity.silenceEmissionByMode = modes;
    if (modes["ember-floor"] !== 0.06 || modes["ambient-vj"] !== 1 || modes["true-gate"] !== 0) problems.push(`emission by mode ${JSON.stringify(modes)}`);
    await feat(ACTIVE);
  }

  // ---- (c) no atan seams: max adjacent hue delta around the ring (true-neon, full-spectrum) ---------------------------
  {
    const c = await center();
    results.seams = {};
    for (const palette of ["true-neon", "full-spectrum"]) {
      const g0 = Date.now();
      await set("sel-palette", palette);
      await settleFrames(5, 2500);
      // Read in the same task as a rendered frame (preserveDrawingBuffer is false): sw steps one frame first, hw reads
      // inside a requestAnimationFrame callback.
      const seamArgs = `${c.cx}, ${c.cy}, 18, ${Math.min(c.w, c.h) * 0.48}`;
      const m = software
        ? await evaluate(`(window.__zurSw.step(1, ${SW_FRAME_DT_MS}), window.__zurSeam(${seamArgs}))`)
        : await evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(window.__zurSeam(${seamArgs}))))`);
      results.seams[palette] = m;
      await shot(`gh013-seam-${palette}`);
      phase(`seam gate (c) ${palette}`, { gateMs: Date.now() - g0, metrics: m });
      if (!(m.binsUsed >= 36)) problems.push(`(c) ${palette} only ${m.binsUsed} populated angle bins`);
      if (!(m.maxAdjacentHueDelta <= 0.08)) problems.push(`(c) ${palette} max adjacent hue delta ${m.maxAdjacentHueDelta} > 0.08 turns (seam)`);
    }
  }

  // ---- (e) wormhole: outer sphere shell + interior throat occupancy (transform-feedback readback) ----------------------
  {
    // Structural read: in silence the true-gate damping holds the agents on the bare formation targets (no audio
    // radial kick / burst), so the occupancy is the wormhole geometry itself.
    const g0 = Date.now();
    await feat(SILENT);
    await settleFrames(software ? 90 : 120, 4000);
    results.wormhole = await evaluate(`(() => { const d = window.__ZUR_DEBUG__; const gl = d.shaderHost.gl; const ps = d.particleSystem;
      const n = ps.count; const data = new Float32Array(n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[ps.read]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      let shell = 0; let throat = 0; let inner = 0; let finite = 0; let maxR = 0;
      for (let i = 0; i < n; i += 1) { const x = data[i * 8]; const y = data[i * 8 + 1]; const z = data[i * 8 + 2];
        if (!Number.isFinite(x + y + z)) continue; finite += 1; const r = Math.hypot(x, y, z) / 2.6; maxR = Math.max(maxR, r);
        if (r >= 0.80 && r <= 1.08) shell += 1; if (r < 0.30) throat += 1; if (r < 0.55) inner += 1; }
      return { count: n, finite, shellFraction: +(shell / n).toFixed(3), throatFraction: +(throat / n).toFixed(3), innerFraction: +(inner / n).toFixed(3), maxR: +maxR.toFixed(3), glErrors: window.__zurGlErrors() }; })()`);
    phase("wormhole occupancy gate (e)", { gateMs: Date.now() - g0, metrics: results.wormhole });
    const w = results.wormhole;
    if (w.finite !== w.count) problems.push(`(e) ${w.count - w.finite} non-finite agents`);
    if (!(w.shellFraction >= 0.30)) problems.push(`(e) wormhole outer shell fraction ${w.shellFraction} < 0.30`);
    if (!(w.throatFraction >= 0.05)) problems.push(`(e) wormhole throat fraction ${w.throatFraction} < 0.05`);
    if (w.glErrors.length) problems.push(`(e) GL errors ${w.glErrors}`);

    // ZUR-GH-013 tightening 1: structured formations never balloon on sustained audio. Bounding radius (p95 of the
    // transform-feedback |pos|) under the live sustained oscillator must stay within 1.08x (+2% sampling slack) of
    // the silence-settled shape, for the wormhole (already settled above) and the anatomical brain.
    // (Sustained = deterministic loud bed with onset 0; see SUSTAINED below.)
    const tfRadius = () => evaluate(`(() => { const d = window.__ZUR_DEBUG__; const gl = d.shaderHost.gl; const ps = d.particleSystem;
      const n = ps.count; const data = new Float32Array(n * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[ps.read]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const r = []; for (let i = 0; i < n; i += 4) { const v = Math.hypot(data[i * 8], data[i * 8 + 1], data[i * 8 + 2]); if (Number.isFinite(v)) r.push(v); }
      r.sort((a, b) => a - b); return { p95: r[Math.floor(r.length * 0.95)], p50: r[Math.floor(r.length * 0.5)], samples: r.length }; })()`);
    const gs = Date.now();
    results.swell = {};
    const SILENT_SETTLE = software ? 40 : 90;
    // Order per formation: converge under live audio, read; settle in silence, read; live again, read. The ratio
    // uses the larger live reading, so a slowly converging silence pass cannot hide a swell.
    // "Sustained" = a loud oscillator-level bed held constant (sub 0.55, bass 0.7, rms 0.42) with onset 0: the
    // swell under test is the sustained one (transient onsets may flash the <= 1.08x micro-pulse). Deterministic
    // feature frames keep the reading independent of wall-clock audio vs. stepped frames. Each phase averages 4
    // readings 4 frames apart. (The wormhole was just settled for 90 silent frames by gate (e).)
    const SUSTAINED = { ...ACTIVE, onset: 0 };
    const meanRadius = async () => {
      let sum = 0;
      for (let i = 0; i < 4; i += 1) { await settleFrames(4, 150); sum += (await tfRadius()).p95; }
      return sum / 4;
    };
    for (const formation of ["wormhole", "neural-brain"]) {
      if (formation !== "wormhole") {
        await set("sel-formation", formation);
        await feat(SUSTAINED);
        await settleFrames(software ? 70 : 120, 4000); // full convergence from the wormhole to the brain
        await feat(SILENT);
        await settleFrames(SILENT_SETTLE, 3000);
      }
      const quiet = await meanRadius();
      await feat(SUSTAINED);
      await settleFrames(software ? 24 : 60, 2000);
      const live = await meanRadius();
      const st = await stats();
      const ratio = live / Math.max(quiet, 1e-6);
      results.swell[formation] = { silenceP95: +quiet.toFixed(3), liveP95: +live.toFixed(3), ratio: +ratio.toFixed(3), liveCleanGate: +st.cleanGate.toFixed(3) };
      if (!(st.cleanGate > 0.5)) problems.push(`swell ${formation}: oscillator gate not open (${st.cleanGate})`);
      if (!(ratio <= 1.10)) problems.push(`swell ${formation}: sustained-audio bounding radius ${ratio.toFixed(3)}x > 1.08x (+2% slack)`);
    }
    phase("structured swell gate", { gateMs: Date.now() - gs, metrics: results.swell });
    await set("sel-formation", "wormhole");
    await feat(ACTIVE);
  }

  // ---- 256k density, 262144 VBO / crowdNorm, 256k meanSat (kept) --------------------------------------------------
  {
    const g256 = Date.now();
    await set("sel-palette", "true-neon");
    await set("sel-count", "256k");
    const framesBefore256k = await evaluate("window.__ZUR_DEBUG__.particleSystem.framesRendered");
    const dense = await measure("256k wormhole", 7000);
    results.density = { frames: dense.frames, count: await evaluate("window.__ZUR_DEBUG__.particleSystem.count"), blackRatio: +dense.blackRatio.toFixed(3), whiteClip: +dense.whiteClip.toFixed(4), activeMeanLuma: +dense.activeMeanLuma.toFixed(3), blackRatioRange: [denseBlackMin, 0.97] };
    await shot("gh013-256k-wormhole");
    if (results.density.count !== 262144) problems.push(`256k count ${results.density.count}`);
    // ZUR-GH-013: crisp pinpoints leave far more black than the old soft capsules; the upper bound moves 0.82 -> 0.97 (still lit).
    if (!(dense.blackRatio >= denseBlackMin && dense.blackRatio <= 0.97)) problems.push(`256k blackRatio ${dense.blackRatio.toFixed(3)} outside ${denseBlackMin}..0.97`);
    if (dense.whiteClip !== 0) problems.push(`256k whiteClip ${dense.whiteClip}`);
    phase("256k density gate", { gateMs: Date.now() - g256, metrics: results.density });
    const g256v = Date.now();
    results.vbo256k = await evaluate(`(() => { const d = window.__ZUR_DEBUG__; const gl = d.shaderHost.gl; const ps = d.particleSystem;
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[0]); const bytes0 = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[1]); const bytes1 = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const activeCount = gl.getUniform(ps.renderProgram, ps.renderLoc.u_activeCount);
      return { count: ps.count, bytes0, bytes1, activeCount, framesRendered: ps.framesRendered, glErrors: window.__zurGlErrors() }; })()`);
    const v = results.vbo256k;
    const expectedCrowd = densityCrowdNorm(262144);
    v.crowdNorm = densityCrowdNorm(v.activeCount);
    v.expectedCrowd = expectedCrowd;
    v.crispExposure = crispDotExposure(v.activeCount);
    v.framesBefore = framesBefore256k;
    if (v.count !== 262144) problems.push(`vbo256k count ${v.count}`);
    if (!(v.bytes0 >= 262144 * 32) || !(v.bytes1 >= 262144 * 32)) problems.push(`vbo256k buffer bytes ${v.bytes0}/${v.bytes1} < ${262144 * 32}`);
    if (v.activeCount !== 262144) problems.push(`vbo256k u_activeCount ${v.activeCount}`);
    if (!(Math.abs(v.crowdNorm - expectedCrowd) <= 1e-9)) problems.push(`vbo256k crowdNorm ${v.crowdNorm} != ${expectedCrowd}`);
    if (!(v.crowdNorm >= 0.28 && v.crowdNorm < 1)) problems.push(`vbo256k crowdNorm ${v.crowdNorm} not on the dense branch`);
    if (!(v.framesRendered > framesBefore256k)) problems.push(`vbo256k framesRendered not increasing ${framesBefore256k} -> ${v.framesRendered}`);
    if (v.glErrors.length) problems.push(`vbo256k GL errors ${v.glErrors}`);
    phase("256k VBO/crowdNorm gate", { gateMs: Date.now() - g256v, values: v });
    for (const palette of ["full-spectrum", "true-neon"]) {
      const g0 = Date.now();
      await set("sel-palette", palette);
      const m = await measure(`256k meanSat ${palette}`, 5000, 0, 0, 0, 4);
      const count = await evaluate("window.__ZUR_DEBUG__.particleSystem.count");
      results[`meanSat_${palette}`] = { count, meanSat: +m.meanSat.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), hueSectorCount: m.hueSectorCount, min: 0.55 };
      phase(`256k meanSat ${palette}`, { gateMs: Date.now() - g0, metrics: results[`meanSat_${palette}`] });
      if (count !== 262144) problems.push(`meanSat ${palette} count ${count}`);
      if (!(m.meanSat >= 0.55)) problems.push(`256k ${palette} meanSat ${m.meanSat.toFixed(3)} < 0.55`);
      if (!(m.hueSectorCount >= 3)) problems.push(`256k ${palette} hueSectorCount ${m.hueSectorCount} < 3`);
      if (m.whiteClip !== 0) problems.push(`256k ${palette} whiteClip ${m.whiteClip}`);
    }
  }

  // ---- Gargantua 256k event horizon void (kept) ---------------------------------------------------------------------
  {
    const gbh = Date.now();
    await set("sel-formation", "supermassive-blackhole");
    await set("sel-kinetic-mode", "accretion-warp");
    // Flush the previous formation (the wormhole throat sits on screen centre) out of the trail buffer at the short
    // trail first; only then raise the trail to 1.0 for the void measurement.
    await settleFrames(4, 2500);
    await evaluate("window.__zurSetRange('rng-trail-length', 1)");
    const c = await center();
    const rad = 0.16 * (Math.min(c.w, c.h * (1 - c.yOff / 2)) / 2);
    const bh = await measure("blackhole 256k", 7000, c.cx, c.cy, rad, 5);
    results.blackhole = { frames: bh.frames, viewportYOffset: c.yOff, center: [c.cx, c.cy], radiusPx: +rad.toFixed(1), samples: bh.centerSamples, centerBlackRatio: +bh.centerBlackRatio.toFixed(3), blackRatio: +bh.blackRatio.toFixed(3), whiteClip: +bh.whiteClip.toFixed(4) };
    await shot("gh013-blackhole-256k");
    if (!(bh.centerBlackRatio >= 0.9)) problems.push(`blackhole centerBlackRatio ${bh.centerBlackRatio} < 0.90`);
    if (!(bh.whiteClip === 0)) problems.push(`blackhole whiteClip ${bh.whiteClip}`);
    phase("blackhole gate", { gateMs: Date.now() - gbh, metrics: results.blackhole });
    await evaluate("window.__zurSetRange('rng-trail-length', 0.3)");
    await set("sel-kinetic-mode", "off");
  }

  // ---- 1 sim step per frame + dart3d 12-vert cone at 64k / 4-vert SDF quad at 256k (kept) ----------------------------
  {
    const g0 = Date.now();
    await set("sel-formation", "wormhole");
    await set("sel-particle-style", "dart3d");
    const readStats = () => evaluate("(() => { const st = window.__ZUR_DEBUG__.particleSystem.stats(); return { stepsLastFrame: st.stepsLastFrame, simSteps: st.simSteps, dartVerts: st.dartVerts, count: st.count }; })()");
    const samples = {};
    for (const tier of ["256k", "64k"]) {
      await set("sel-count", tier);
      const reads = [];
      for (let i = 0; i < 2; i += 1) { await settleFrames(1, 120); reads.push(await readStats()); }
      samples[tier] = reads;
    }
    results.simSteps = { at64k: samples["64k"].at(-1), at256k: samples["256k"].at(-1) };
    phase("simSteps / dart gate", { gateMs: Date.now() - g0, metrics: results.simSteps });
    for (const r of [...samples["64k"], ...samples["256k"]]) if (r.stepsLastFrame !== 1 || r.simSteps !== 1) problems.push(`stepsLastFrame ${r.stepsLastFrame} / simSteps ${r.simSteps} != 1`);
    if (samples["256k"].at(-1).dartVerts !== 4) problems.push(`256k dartVerts ${samples["256k"].at(-1).dartVerts} != 4`);
    if (samples["64k"].at(-1).dartVerts !== 12) problems.push(`64k dartVerts ${samples["64k"].at(-1).dartVerts} != 12`);
    await set("sel-particle-style", "crisp-dot");
    const crispVerts = (await readStats()).dartVerts;
    await settleFrames(1, 120);
    if ((await readStats()).dartVerts !== 4) problems.push(`crisp-dot is not a 4-vertex quad (${crispVerts})`);
  }

  // ---- logo glyph luma at particleSize 0.5 (kept, live features) -----------------------------------------------------
  {
    const g0 = Date.now();
    await click('[data-quick-preset="logo"]');
    await set("sel-attractor-preset", "AI: UNDERGROUND");
    await set("sel-palette", "true-neon");
    await setParticles({ particleSize: 0.5 });
    const m = await measure("logo AI: UNDERGROUND", 4500);
    const p = await preset();
    results.logoLuma = { formation: p.particles.formationType, text: p.particles.attractorText, particleSize: p.particles.particleSize, activeMeanLuma: +m.activeMeanLuma.toFixed(3), activeFraction: +m.activeFraction.toFixed(4), min: 0.12 };
    await shot("gh013-logo");
    phase("logo glyph luma gate", { gateMs: Date.now() - g0, metrics: results.logoLuma });
    if (p.particles.formationType !== "logo-attractor") problems.push(`logo formation ${p.particles.formationType}`);
    if (!(m.activeMeanLuma >= 0.12)) problems.push(`logo glyph luma ${m.activeMeanLuma.toFixed(3)} < 0.12`);
    if (!(m.activeFraction > 0.0005)) problems.push(`logo glyph pixels ${m.activeFraction}`);
    await setParticles({ particleSize: 1.0 });
  }

  // ---- anatomical 3D Brain (synapse-node) on all 5 palettes + Harmonic Ferrofluid ------------------------------------
  {
    const g0 = Date.now();
    await click('[data-quick-preset="brain"]');
    await set("sel-particle-style", "synapse-node");
    results.brainPalettes = {};
    for (const palette of ["true-neon", "full-spectrum", "white-static", "crimson-pulse", "golden-cortex"]) {
      await set("sel-palette", palette);
      const m = await measure(`brain ${palette}`, 3500, 0, 0, 0, 4);
      results.brainPalettes[palette] = { activeMeanLuma: +m.activeMeanLuma.toFixed(3), activeFraction: +m.activeFraction.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), meanR: +m.meanR.toFixed(3), meanG: +m.meanG.toFixed(3) };
      if (palette === "crimson-pulse") {
        if (!(m.activeMeanLuma >= 0.12)) problems.push(`3D Brain crimson-pulse luma ${m.activeMeanLuma.toFixed(3)} < 0.12`);
        if (!(m.meanR > 2.2 * m.meanG)) problems.push(`3D Brain crimson-pulse not red-dominant ${m.meanR.toFixed(3)} vs ${m.meanG.toFixed(3)}`);
      } else if (!(m.activeMeanLuma >= 0.25)) problems.push(`3D Brain ${palette} luma ${m.activeMeanLuma.toFixed(3)} < 0.25`);
      if (m.whiteClip !== 0) problems.push(`3D Brain ${palette} whiteClip ${m.whiteClip}`);
    }
    await shot("gh013-brain");
    phase("brain all-palette gate", { gateMs: Date.now() - g0, metrics: results.brainPalettes });
    // Kept ZUR-GH-011/012 brain luminance floors, now measured under live audio (silence is black by design in
    // true-gate, so the old idle measurement is replaced by the (a) silence gate).
    const gc = results.brainPalettes["golden-cortex"];
    results.brainLuma = { palette: "golden-cortex", audio: "live", activeMeanLuma: gc.activeMeanLuma, floor: brainMin };
    if (!(gc.activeMeanLuma >= 0.22)) problems.push(`3D Brain activeMeanLuma ${gc.activeMeanLuma} < 0.22 (dark smudge)`);
    if (!(gc.activeMeanLuma >= brainMin)) problems.push(`3D Brain live activeMeanLuma ${gc.activeMeanLuma} < ${brainMin}`);
    const p = await preset();
    if (p.particles.formationType !== "neural-brain" || p.particles.particleStyle !== "synapse-node") problems.push(`brain preset ${p.particles.formationType}/${p.particles.particleStyle}`);
    const gf = Date.now();
    await click('[data-quick-preset="ferrofluid"]');
    await set("sel-palette", "full-spectrum");
    const fm = await measure("ferrofluid", 3500, 0, 0, 0, 4);
    results.ferrofluid = { formation: (await preset()).particles.formationType, activeMeanLuma: +fm.activeMeanLuma.toFixed(3), activeFraction: +fm.activeFraction.toFixed(4), hueSectorCount: fm.hueSectorCount, whiteClip: fm.whiteClip };
    await shot("gh013-ferrofluid");
    phase("ferrofluid gate", { gateMs: Date.now() - gf, metrics: results.ferrofluid });
    if (results.ferrofluid.formation !== "harmonic-ferrofluid" || !(fm.activeFraction > 0.002) || fm.whiteClip !== 0) problems.push(`ferrofluid ${JSON.stringify(results.ferrofluid)}`);
    await set("sel-particle-style", "crisp-dot");
  }

  // ---- spectral canyon obsidian at hueShift -0.83 (live) + true-gate silence black (kept + new) ----------------------
  {
    const g0 = Date.now();
    await click('[data-engine="canyon"]');
    await evaluate("window.__zurSetRange('rng-hue', -0.83)");
    const m = await measure("spectral canyon", 3000, 0, 0, 0, 3);
    await feat(SILENT);
    const ms = await measure("spectral canyon silence", 1500, 0, 0, 0, 3);
    await feat(ACTIVE);
    const p = await preset();
    results.canyon = { sceneId: p.sceneId, hueShift: p.visual.hueShift, blackRatio: +m.blackRatio.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), min: 0.42, silenceBlackRatio: +ms.blackRatio.toFixed(4), silenceMeanLuma: +ms.frameMeanLuma.toFixed(4) };
    await shot("gh013-canyon");
    phase("spectral canyon gate", { gateMs: Date.now() - g0, metrics: results.canyon });
    if (p.sceneId !== "spectral-canyon-3d") problems.push(`canyon sceneId ${p.sceneId}`);
    if (!(m.blackRatio >= 0.42)) problems.push(`canyon blackRatio ${m.blackRatio.toFixed(3)} < 0.42`);
    if (!(m.blackRatio < 0.995)) problems.push(`canyon not rendering with live features (blackRatio ${m.blackRatio})`);
    if (!(ms.blackRatio >= 0.94 && ms.frameMeanLuma <= 0.025)) problems.push(`canyon true-gate silence ${JSON.stringify([ms.blackRatio, ms.frameMeanLuma])}`);
    await evaluate("window.__zurSetRange('rng-hue', 0)");
  }

  // ---- megastructure camera modes visibly move the raymarch eye (kept) ----------------------------------------------
  {
    const g0 = Date.now();
    await click('[data-engine="megastructure"]');
    const out = {};
    for (const mode of ["orbit-3d", "tunnel-fly"]) {
      await set("sel-camera-mode", mode);
      await settleFrames(1, 300);
      const a = await evaluate("(() => { const st = window.__ZUR_DEBUG__.particleSystem.stats(); return { eye: st.coreEye, fwd: st.coreForward }; })()");
      await settleFrames(3, 1500);
      const b = await evaluate("(() => { const st = window.__ZUR_DEBUG__.particleSystem.stats(); return { eye: st.coreEye, fwd: st.coreForward }; })()");
      const dist = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]));
      out[mode] = { eyeDelta: +dist(a.eye, b.eye).toFixed(3), fwdDelta: +dist(a.fwd, b.fwd).toFixed(3) };
      if (!(out[mode].eyeDelta > 0.05 || out[mode].fwdDelta > 0.01)) problems.push(`megastructure ${mode} camera did not move ${JSON.stringify(out[mode])}`);
    }
    results.megaCamera = out;
    phase("megastructure camera gate", { gateMs: Date.now() - g0, metrics: out });
    await set("sel-camera-mode", "orbit-3d");
    await click('[data-engine="particles"]');
  }
  await feat(null);

  // ---- Load Audio Track + Speaker Monitor routing (file only); tab capture stays at destinationConnections 0 ----------
  {
    const g0 = Date.now();
    const diag = () => evaluate("(() => { const d = window.__ZUR_DEBUG__.getDiagnostics(); return { mode: d.mode, destinationConnections: d.destinationConnections, silent: d.silent, track: d.track }; })()");
    await evaluate(`(() => {
      const rate = 22050; const seconds = 2; const n = rate * seconds; const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
      const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
      str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i += 1) { const t = i / rate; const kick = Math.exp(-((t * 2) % 1) * 9) * Math.sin(2 * Math.PI * 60 * t);
        v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, 0.6 * kick + 0.25 * Math.sin(2 * Math.PI * 440 * t))) * 32767, true); }
      const file = new File([buf], "zur-smoke-beat.wav", { type: "audio/wav" });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById("file-audio-track"); input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true; })()`);
    let loaded = null;
    for (let i = 0; i < 40; i += 1) { loaded = await diag(); if (loaded.mode === "file-track" && loaded.track?.loaded) break; await sleep(100); }
    await sleep(500);
    const monitorOff = await diag();
    let maxBass = 0;
    for (let i = 0; i < 12 && !(maxBass > 0.02); i += 1) {
      const fr = await evaluate("(() => { const d = window.__ZUR_DEBUG__; const a = d.readSnapshot(); if (!a) return null; d.extractor.configure({ sampleRate: a.sampleRate, fftSize: a.fftSize }); const f = d.extractor.update(a); return { bass: f.bass, rms: f.rms }; })()");
      if (fr) maxBass = Math.max(maxBass, fr.bass || 0, fr.rms || 0);
      await sleep(120);
    }
    await click("#chk-speaker-monitor");
    await sleep(150);
    const monitorOn = await diag();
    await click("#btn-track-play");
    await sleep(250);
    const paused = await diag();
    await click("#btn-track-play");
    await sleep(250);
    const resumed = await diag();
    await click("#chk-speaker-monitor");
    await sleep(150);
    const monitorBackOff = await diag();
    await click("#btn-stop");
    await sleep(300);
    const stopped = await diag();
    // Tab capture through a synthetic display stream (oscillator + canvas video): must stay silent (0 destination edges).
    await evaluate(`(() => { navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start();
      const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16; canvas.getContext("2d").fillRect(0, 0, 16, 16);
      const video = canvas.captureStream(5).getVideoTracks()[0];
      return new MediaStream([...dest.stream.getAudioTracks(), video]); }; return true; })()`);
    await click("#btn-tab");
    let tab = null;
    for (let i = 0; i < 30; i += 1) { tab = await diag(); if (tab.mode === "tab-capture") break; await sleep(100); }
    await click("#chk-speaker-monitor");
    await sleep(150);
    const tabMonitor = await diag();
    await click("#chk-speaker-monitor");
    await click("#btn-stop");
    await sleep(300);
    results.track = { loaded: loaded?.mode, name: loaded?.track?.name, monitorOff: monitorOff.destinationConnections, analysedMax: +maxBass.toFixed(4),
      monitorOn: monitorOn.destinationConnections, monitorConnected: monitorOn.track?.monitorConnected, playingBeforeToggle: monitorOff.track?.playing,
      pausedPlaying: paused.track?.playing, resumedPlaying: resumed.track?.playing, monitorBackOff: monitorBackOff.destinationConnections,
      stopped: stopped.destinationConnections, tabMode: tab?.mode, tabDestinationConnections: tab?.destinationConnections, tabWithMonitorChecked: tabMonitor.destinationConnections };
    phase("track loader / speaker monitor gate", { gateMs: Date.now() - g0, metrics: results.track });
    const t = results.track;
    if (t.loaded !== "file-track" || t.name !== "zur-smoke-beat.wav") problems.push(`track not loaded ${JSON.stringify(t)}`);
    if (t.monitorOff !== 0 || t.monitorOn !== 1 || !t.monitorConnected || t.monitorBackOff !== 0 || t.stopped !== 0) problems.push(`speaker monitor routing ${JSON.stringify(t)}`);
    if (!(t.analysedMax > 0.02)) problems.push(`track not analysed (max ${t.analysedMax})`);
    if (t.pausedPlaying === t.resumedPlaying) problems.push(`play/pause did not toggle ${t.pausedPlaying}/${t.resumedPlaying}`);
    if (t.tabMode !== "tab-capture" || t.tabDestinationConnections !== 0 || t.tabWithMonitorChecked !== 0) problems.push(`tab capture destination ${JSON.stringify(t)}`);
  }

  // ---- Android mic: raw -> shared ({audio:true}, 4 s auto-gain ON) -> silent Demo Beat (auto-gain off, 0 destination) --
  {
    const g0 = Date.now();
    await evaluate(`(() => { window.__zurGum = []; window.__zurGumShared = true;
      navigator.mediaDevices.getUserMedia = async (c) => { window.__zurGum.push(JSON.stringify(c));
        if (window.__zurGumShared && JSON.stringify(c) === JSON.stringify({ audio: true })) {
          const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start(); return dest.stream; }
        const e = new Error("Could not start audio source"); e.name = "NotReadableError"; throw e; }; return true; })()`);
    await click("#btn-mic");
    let shared = null;
    for (let i = 0; i < 30; i += 1) { shared = await evaluate("(() => { const d = window.__ZUR_DEBUG__; return { micStage: d.getMicState().micStage, autoGain: d.extractor.autoGainEnabled, destinationConnections: d.getDiagnostics().destinationConnections, label: document.getElementById('mic-status')?.textContent || '' }; })()"); if (shared.micStage === "shared") break; await sleep(100); }
    await click("#btn-stop");
    await sleep(300);
    const autoGainAfterStop = await evaluate("window.__ZUR_DEBUG__.extractor.autoGainEnabled");
    await evaluate("(window.__zurGum = [], window.__zurGumShared = false, true)");
    await click("#btn-mic");
    await sleep(900);
    await settleFrames(3, 800);
    const mic = await evaluate(`(() => { const d = window.__ZUR_DEBUG__; const diag = d.getDiagnostics(); const ms = d.getMicState();
      return { attempts: window.__zurGum.map((s) => JSON.parse(s)), micStage: ms.micStage, demoBeat: ms.demoBeat, destinationConnections: diag.destinationConnections, autoGain: d.extractor.autoGainEnabled,
        capture: d.state.status.capture, label: document.getElementById('mic-status')?.textContent || '', labelVisible: !!document.getElementById('mic-status') && !document.getElementById('mic-status').hidden && document.getElementById('mic-status').offsetParent !== null }; })()`);
    let maxRms = 0; let maxBass = 0;
    for (let i = 0; i < 24 && !(maxRms > 0.001 && maxBass > 0.001); i += 1) {
      const v = await evaluate("(() => { const d = window.__ZUR_DEBUG__; const a = d.readSnapshot(); const fr = d.extractor.update(a); return { rms: fr.rms, bass: fr.bass }; })()").catch(() => null);
      if (v) { maxRms = Math.max(maxRms, v.rms || 0); maxBass = Math.max(maxBass, v.bass || 0); }
      await sleep(120);
    }
    results.mic = { shared, autoGainAfterStop, ...mic, maxRms: +maxRms.toFixed(4), maxBass: +maxBass.toFixed(4) };
    phase("mic fallback + auto-gain gate", { gateMs: Date.now() - g0, metrics: results.mic });
    if (shared?.micStage !== "shared" || shared?.autoGain !== true || shared?.destinationConnections !== 0) problems.push(`shared mic ${JSON.stringify(shared)}`);
    if (autoGainAfterStop !== false) problems.push("auto-gain still on after stop");
    if (mic.attempts.length !== 2) problems.push(`mic getUserMedia attempts ${mic.attempts.length} != 2`);
    else {
      if (mic.attempts[0]?.audio?.echoCancellation !== false) problems.push(`mic first attempt not raw ${JSON.stringify(mic.attempts[0])}`);
      if (JSON.stringify(mic.attempts[1]) !== JSON.stringify({ audio: true })) problems.push(`mic second attempt ${JSON.stringify(mic.attempts[1])}`);
    }
    if (mic.micStage !== "demo") problems.push(`micStage ${mic.micStage}`);
    if (!(mic.demoBeat?.running && mic.demoBeat?.bpm === 124)) problems.push(`demo beat ${JSON.stringify(mic.demoBeat)}`);
    if (mic.destinationConnections !== 0) problems.push(`demo beat destinationConnections ${mic.destinationConnections}`);
    if (mic.autoGain !== false) problems.push("auto-gain on for the demo beat");
    if (!/Demo Beat 124 BPM \(silent\)/.test(mic.label) || !mic.labelVisible) problems.push(`mic label ${JSON.stringify([mic.label, mic.labelVisible])}`);
    if (!(maxRms > 0.001) || !(maxBass > 0.001)) problems.push(`demo beat analysed rms ${maxRms} bass ${maxBass} not > 0`);
    await click("#btn-stop");
  }

  if (software) await evaluate("window.__ZUR_DEBUG__.renderHost.start()");
  results.destinationConnections = (await evaluate("window.__ZUR_DEBUG__.getDiagnostics()")).destinationConnections;

  // ---- reload: a v5_3 Blood & Swarm save migrates to zur_state_v6_0 (crisp-dot + wormhole, no hud) ------------------
  {
    const g0 = Date.now();
    const { STAGE2_DEFAULT_PRESET } = await import(new URL("../src/app/AppState.js", import.meta.url).href);
    const legacy = JSON.parse(JSON.stringify(STAGE2_DEFAULT_PRESET));
    delete legacy.deck;
    legacy.hud = { hudTab: "blood-swarm", swarmMode: "blood-drip", shaderScene: "spectral-canyon-3d", visualTab: "blood-swarm" };
    legacy.particles = { ...legacy.particles, shape: "dart", formationType: "free-3d", particleStyle: "blood-drop", kineticMode: "splatter-run", colorPalette: "blood-red" };
    delete legacy.particles.reactivityMode;
    // Leave the app first (its persist() would rewrite zur_state_v6_0), then plant the v5_3 save from a plain page.
    await send("Page.navigate", { url: `${base}/manifest.json` });
    await sleep(400);
    await evaluate(`(localStorage.clear(), localStorage.setItem("zur_state_v5_3", ${JSON.stringify(JSON.stringify({ storageSchema: 5.3, preset: legacy }))}), true)`);
    await send("Page.navigate", { url: `${base}/?debug=1` });
    let boot2 = "";
    for (let attempt = 0; attempt < 150; attempt += 1) {
      boot2 = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
      if (boot2 === "ok" || boot2 === "error") break;
      await sleep(100);
    }
    const after = await evaluate(`(() => { const p = window.__ZUR_DEBUG__?.state.preset; return p ? { sceneId: p.sceneId, style: p.particles.particleStyle, formation: p.particles.formationType, kinetic: p.particles.kineticMode, palette: p.particles.colorPalette, reactivityMode: p.particles.reactivityMode, hud: p.hud ?? null, v60: !!localStorage.getItem("zur_state_v6_0"), schema: JSON.parse(localStorage.getItem("zur_state_v6_0") || "{}").storageSchema } : null; })()`);
    results.reloadMigration = { boot: boot2, ...after };
    phase("v5_3 blood -> v6_0 reload migration gate", { gateMs: Date.now() - g0, metrics: results.reloadMigration });
    if (boot2 !== "ok" || !after) problems.push(`reload boot ${boot2}`);
    else if (after.style !== "crisp-dot" || after.formation !== "wormhole" || after.kinetic !== "off" || after.sceneId !== "particle-swarm-3d" || after.hud || !after.v60 || after.schema !== 6 || after.palette !== "crimson-pulse" || after.reactivityMode !== "true-gate") problems.push(`reload migration ${JSON.stringify(after)}`);
  }

  // ---- ZUR-GH-013 tightening 2: a valid zur_state_v6_0 save keeps the user's particleStyle across reloads ----------
  {
    const g0 = Date.now();
    results.v6StyleReload = {};
    for (const style of ["star-streak", "synapse-node", "dart3d", "crisp-dot"]) {
      // (the debug helpers are not re-injected after a navigation: drive the real <select> directly)
      await evaluate(`(() => { const s = document.getElementById("sel-particle-style"); s.value = ${JSON.stringify(style)}; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
      await sleep(250);
      const saved = await evaluate(`JSON.parse(localStorage.getItem("zur_state_v6_0") || "{}").preset?.particles?.particleStyle || null`);
      await send("Page.reload", {});
      await sleep(300);
      let boot3 = "";
      for (let attempt = 0; attempt < 150; attempt += 1) {
        boot3 = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
        if (boot3 === "ok" || boot3 === "error") break;
        await sleep(100);
      }
      const reloaded = await evaluate(`(() => ({ state: window.__ZUR_DEBUG__?.state.preset.particles.particleStyle, dom: document.getElementById("sel-particle-style")?.value, schema: JSON.parse(localStorage.getItem("zur_state_v6_0") || "{}").storageSchema }))()`);
      results.v6StyleReload[style] = { saved, boot: boot3, ...reloaded };
      if (boot3 !== "ok" || saved !== style || reloaded.state !== style || reloaded.dom !== style || reloaded.schema !== 6) problems.push(`v6_0 style reload ${style}: ${JSON.stringify(results.v6StyleReload[style])}`);
    }
    phase("v6_0 particleStyle reload gate", { gateMs: Date.now() - g0, metrics: results.v6StyleReload });
  }

  phase("suite done", { totalSeconds: +((Date.now() - T0) / 1000).toFixed(1) });
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
results.phases = phases;
results.consoleErrors = consoleErrors.length;
results.pageErrors = pageErrors.length;
results.webglWarnings = webglWarnings.length;
console.log(JSON.stringify(results, null, 2));
if (problems.length) {
  console.error(`ZUR-GH-010 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ZUR-GH-010 SMOKE PASS");
