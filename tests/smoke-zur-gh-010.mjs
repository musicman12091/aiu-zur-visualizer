// ZUR-GH-010 headless Chrome smoke (412x915): 6-tab context HUD gating, zero blank <option>, multi-hue palettes,
// 256k density budget, and the supermassive-blackhole event-horizon void.
// ZUR-GH-011: + DOM node identity / real slider drag, sticky header overlap, Blood & Swarm default, 3D Brain idle luma.
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
const { densityCrowdNorm } = await import(new URL("../src/render/particleMath.js", import.meta.url).href);

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
const SHOTS = process.env.ZUR_SHOTS || (process.platform === "win32" ? join(tmpdir(), "zur-gh-010") : "/workspace/artifacts/zur-gh-010");
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
const results = { tabs: {}, blank: {}, hues: {}, density: {}, blackhole: {}, gh012: {} };

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

  const bootSync = await evaluate(`import("/src/app/AppState.js").then((m) => { const p = window.__ZUR_DEBUG__.state.preset; return { hudTab: p.hud?.hudTab, sceneId: p.sceneId, derived: m.sceneForHud(p.hud?.hudTab, p.hud?.shaderScene, p.hud?.visualTab) }; })`);
  results.gh012.bootSync = bootSync;

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
  results.renderer = { renderer: rendererInfo.renderer, vendor: rendererInfo.vendor, software, warmupFrames: software ? SW_WARMUP_FRAMES : HW_MIN_WARMUP_FRAMES, gateOrder: software ? "sw: fs,tn,256k,bh,gc,brain" : "hw: fs,tn,gc,256k,bh,brain" };
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
  const goTab = async (id, sub = "") => {
    await click(`[data-hud-tab="${id}"]`);
    if (sub) await click(`[data-swarm-mode="${sub}"], [data-shader-scene="${sub}"]`);
    await sleep(250);
  };
  const set = (id, value) => evaluate(`window.__zurSetSelect("${id}", ${JSON.stringify(value)})`);
  const flat = () => evaluate(`import("/src/app/AppState.js").then((m) => ({ flat: m.flattenPreset(window.__ZUR_DEBUG__.state.preset), enforced: m.enforceTabConstraints(m.flattenPreset(window.__ZUR_DEBUG__.state.preset)) }))`);
  const visibleRows = () => evaluate(`[...document.querySelectorAll("[data-control]")].filter((el) => !el.hidden && el.offsetParent !== null && !el.closest("[hidden]")).map((el) => el.dataset.control)`);
  const blankOptions = () => evaluate(`[...document.querySelectorAll(".control-hud select")].flatMap((s) => [...s.options].filter((o) => !String(o.value).trim() || !String(o.textContent).trim()).map((o) => s.id + ":" + JSON.stringify(o.value)))`);
  const optionValues = (id) => evaluate(`[...document.getElementById(${JSON.stringify(id)}).options].map((o) => o.value)`);
  const measure = async (label, settleMs, cx = 0, cy = 0, rad = 0) => {
    let worst = null;
    let frames = 0;
    if (software) {
      const swT0 = Date.now();
      const m = await evaluate(`(() => {
        window.__zurSw.step(${SW_WARMUP_FRAMES - 2}, ${SW_FRAME_DT_MS});
        let worst = null;
        for (let i = 0; i < 2; i += 1) {
          window.__zurSw.step(1, ${SW_FRAME_DT_MS});
          const m = window.__zurReadNow(${cx}, ${cy}, ${rad});
          if (!worst || m.whiteClip > worst.whiteClip) worst = m;
        }
        return worst;
      })()`);
      phase(`  ${label} sw frames`, { frames: SW_WARMUP_FRAMES, ms: Date.now() - swT0 });
      worst = m;
      frames = SW_WARMUP_FRAMES;
    } else {
      await sleep(settleMs);
      for (let i = 0; i < 3; i += 1) {
        const m = await evaluate(`window.__zurMetrics(${cx}, ${cy}, ${rad})`);
        if (!worst || m.whiteClip > worst.whiteClip) worst = m;
      }
    }
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return { ...worst, frames };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  await mkdir(SHOTS, { recursive: true });
  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(software ? 300 : 2000);
  phase("oscillator started");

  // 1) Tabs: state === enforceTabConstraints(state), row gating, zero blank options.
  const visuals = [
    ["deep-space", "", "particle-swarm-3d"],
    ["brain-3d", "", "particle-swarm-3d"],
    ["blood-swarm", "blood-drip", "particle-swarm-3d"],
    ["blood-swarm", "logo-text", "particle-swarm-3d"],
    ["blood-swarm", "free-swarm", "particle-swarm-3d"],
    ["megastructure", "", "megastructure-3d"],
    ["canyon-pulse", "spectral-canyon-3d", "spectral-canyon-3d"],
    ["canyon-pulse", "pulse-field-3d", "pulse-field-3d"],
    ["canyon-pulse", "aurora-ribbons", "aurora-ribbons"],
    ["audio-rig", "", null],
  ];
  const expectRows = {
    "deep-space": { has: ["formation", "flow", "style", "kinetic", "palette", "count", "zoom", "reactivity", "size"], not: ["oscillation", "logoText", "pulseLayout", "hueShift", "chromatic"] },
    "brain-3d": { has: ["kinetic", "flow", "style", "palette", "oscSpeed", "reactivity"], not: ["formation", "logoText", "pulseLayout", "oscillation"] },
    "blood-swarm:blood-drip": { has: ["palette", "reactivity", "oscSpeed", "trailLength", "count", "size", "zoom"], not: ["formation", "flow", "style", "kinetic", "logoText", "kaleido"] },
    "blood-swarm:logo-text": { has: ["logoText", "style", "palette", "reactivity", "zoom", "count", "size"], not: ["kinetic", "formation", "flow", "trailLength"] },
    "blood-swarm:free-swarm": { has: ["formation", "flow", "style", "kinetic", "oscillation", "palette", "kaleido"], not: ["logoText", "pulseLayout"] },
    megastructure: { has: ["palette", "cameraMode", "zoom", "reactivity", "kaleido", "chromatic", "godRays", "count", "trailLength"], not: ["formation", "flow", "style", "kinetic", "size"] },
    "canyon-pulse:spectral-canyon-3d": { has: ["palette", "hueShift", "cameraMode", "reactivity", "kaleido", "chromatic", "godRays"], not: ["zoom", "count", "style", "pulseLayout"] },
    "canyon-pulse:pulse-field-3d": { has: ["pulseLayout", "palette", "cameraMode", "zoom", "reactivity", "trailLength"], not: ["hueShift", "godRays", "count", "style"] },
    "canyon-pulse:aurora-ribbons": { has: ["palette", "hueShift", "reactivity", "trailLength", "kaleido"], not: ["cameraMode", "zoom", "pulseLayout", "count"] },
    "audio-rig": { has: [], not: ["formation", "flow", "style", "kinetic", "palette", "pulseLayout", "logoText", "zoom"] },
  };
  for (const [tab, sub, scene] of visuals) {
    const key = sub && tab !== "audio-rig" ? `${tab}:${sub}` : tab;
    await goTab(tab, sub);
    const { flat: f, enforced } = await flat();
    const rows = await visibleRows();
    const blanks = await blankOptions();
    results.blank[key] = blanks.length;
    if (blanks.length) problems.push(`${key} blank options ${blanks}`);
    const active = await evaluate(`document.querySelector('[data-hud-tab].active, [data-hud-tab][aria-selected="true"]')?.dataset.hudTab`);
    const rigVisible = await evaluate(`Boolean(document.getElementById("hud-audio-rig") && !document.getElementById("hud-audio-rig").hidden && document.getElementById("hud-audio-rig").offsetParent)`);
    results.tabs[key] = { sceneId: f.sceneId, formation: f.formationType, style: f.particleStyle, kinetic: f.kineticMode, active, rigVisible, rows };
    if (active !== tab) problems.push(`${key}: active tab ${active}`);
    if (!same(f, enforced)) problems.push(`${key}: state differs from enforceTabConstraints`);
    if (f.formation !== f.formationType) problems.push(`${key}: formation !== formationType`);
    if (scene && f.sceneId !== scene) problems.push(`${key}: scene ${f.sceneId} != ${scene}`);
    if (tab === "audio-rig" !== rigVisible) problems.push(`${key}: rig panel visibility ${rigVisible}`);
    const exp = expectRows[key];
    for (const r of exp.has) if (!rows.includes(r)) problems.push(`${key}: row ${r} should be visible`);
    for (const r of exp.not) if (rows.includes(r)) problems.push(`${key}: row ${r} should be hidden`);
    if (tab === "audio-rig") {
      const ids = ["rng-preamp", "rng-gate", "btn-mode-a", "btn-mode-b", "sel-fft", "sel-tier", "rng-gain"];
      for (const id of ids) if (!(await evaluate(`Boolean(document.getElementById("${id}")?.offsetParent)`))) problems.push(`audio-rig: #${id} not visible`);
    }
    if (tab === "deep-space") {
      const flows = await optionValues("sel-flow");
      results.tabs[key].flows = flows;
      if (flows.includes("gas") || flows.includes("fluid")) problems.push(`deep-space flow options ${flows}`);
      const forms = await optionValues("sel-formation");
      if (forms.length !== 6 || !forms.includes("wormhole")) problems.push(`deep-space formations ${forms}`);
    }
    if (tab === "blood-swarm" && sub === "free-swarm") {
      const flows = await optionValues("sel-flow");
      if (!flows.includes("gas") || !flows.includes("fluid")) problems.push(`free-swarm flow options ${flows}`);
    }
    const sticky = await evaluate(`(() => { const t = document.querySelector(".hud-tabs"); const c = getComputedStyle(t); return { position: c.position, overflowX: c.overflowX, touch: c.touchAction, scrollable: t.scrollWidth > t.clientWidth }; })()`);
    if (sticky.position !== "sticky" || sticky.overflowX !== "auto" || !/pan-x/.test(sticky.touch) || !sticky.scrollable) problems.push(`tab bar ${JSON.stringify(sticky)}`);
  }
  phase("tabs loop done");
  // Real-input stability: a status emit (1 Hz FPS / wake-lock on every pointerdown) must not re-insert rows, rebuild
  // <select> options or blur the focused control; doing so closed native pickers and cancelled slider drags.
  await goTab("deep-space");
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
  phase("input stability done");

  // ZUR-GH-011 DOM node identity gate: 10 slider input events + AppState/status updates inside one tab keep every
  // <select> / <input type="range"> node (and its <option>s) identical, never re-insert a row, and keep scrollTop.
  await goTab("deep-space");
  results.nodeIdentity = await evaluate(`(() => {
    const d = window.__ZUR_DEBUG__;
    const ids = ["sel-formation", "sel-flow", "sel-palette", "sel-count", "rng-camera-zoom", "rng-reactivity", "rng-size"];
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
    return out;
  })()`);
  {
    const n = results.nodeIdentity;
    if (!n.identical || !n.optionsIdentical || n.reinserted !== 0 || !(n.scrollBefore > 0) || n.scrollAfter !== n.scrollBefore || !n.reactivityFollowed) {
      problems.push(`DOM node identity gate ${JSON.stringify(n)}`);
    }
  }
  // Real pointer drag (CDP mouse) across Camera Zoom: the b431f90 HUD cancelled it on the first status emit.
  await evaluate(`document.getElementById("rng-camera-zoom").scrollIntoView({ block: "center" })`);
  await sleep(200);
  const zr = await evaluate(`(() => { const e = document.getElementById("rng-camera-zoom"); const b = e.getBoundingClientRect(); return { x: b.x, y: b.y + b.height / 2, w: b.width, v: +e.value }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: zr.x + zr.w * 0.2, y: zr.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: zr.x + zr.w * 0.2, y: zr.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i += 1) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: zr.x + zr.w * (0.2 + (0.6 * i) / 12), y: zr.y, button: "left", buttons: 1 });
    await sleep(30);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: zr.x + zr.w * 0.8, y: zr.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
  results.nodeIdentity.drag = { start: zr.v, end: await evaluate(`+document.getElementById("rng-camera-zoom").value`), state: await evaluate("window.__ZUR_DEBUG__.state.preset.particles.cameraZoom") };
  if (!(results.nodeIdentity.drag.end > results.nodeIdentity.drag.start + 0.5) || Math.abs(results.nodeIdentity.drag.state - results.nodeIdentity.drag.end) > 1e-6) {
    problems.push(`slider pointer drag did not track ${JSON.stringify(results.nodeIdentity.drag)}`);
  }
  await evaluate("window.__zurSetRange('rng-camera-zoom', 1)");
  phase("node identity + drag done");

  // ZUR-GH-011 sticky header: scrolled to the bottom, Hide HUD and the tab bar never overlap and the header is solid.
  results.stickyHeader = await evaluate(`(() => {
    const panel = document.querySelector(".control-hud");
    panel.scrollTop = panel.scrollHeight;
    const header = document.getElementById("hud-sticky-header");
    const p = panel.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    const hide = document.getElementById("btn-hide-hud").getBoundingClientRect();
    const tabs = document.getElementById("hud-tabs").getBoundingClientRect();
    const cs = getComputedStyle(header);
    const out = { scrolled: panel.scrollTop > 0, headerTopGap: +(h.top - p.top).toFixed(2), overlapPx: +Math.max(0, hide.bottom - tabs.top).toFixed(2), tabsInsideHeader: tabs.bottom <= h.bottom + 0.5, bg: cs.backgroundColor, zIndex: cs.zIndex };
    panel.scrollTop = 0;
    return out;
  })()`);
  {
    const s = results.stickyHeader;
    const alpha = Number((/rgba?\(([^)]+)\)/.exec(s.bg)?.[1].split(",")[3]) ?? 1);
    if (!s.scrolled || s.overlapPx > 0.5 || !s.tabsInsideHeader || s.headerTopGap < -0.5 || s.headerTopGap > 2 || alpha < 0.98 || s.zIndex !== "20") {
      problems.push(`sticky header ${JSON.stringify(s)}`);
    }
  }

  phase("sticky header done");
  // ZUR-GH-011 Blood-Swarm default gate: Blood & Swarm tapped from 3D Brain lands on blood-drip even if free-swarm was
  // the last sub-mode used.
  await goTab("blood-swarm", "free-swarm");
  await goTab("brain-3d");
  await goTab("blood-swarm");
  {
    const { flat: fb } = await flat();
    const activeSub = await evaluate(`document.querySelector("#swarm-pills .hud-subpill.is-active")?.dataset.swarmMode || ""`);
    results.bloodDefault = { swarmMode: fb.swarmMode, style: fb.particleStyle, kinetic: fb.kineticMode, palette: fb.colorPalette, trailType: fb.trailType, trailLength: fb.trailLength, activeSub };
    if (fb.swarmMode !== "blood-drip" || fb.particleStyle !== "blood-drop" || fb.kineticMode !== "splatter-run" || fb.colorPalette !== "blood-red" || fb.trailType !== "comet" || !(fb.trailLength >= 0.72) || activeSub !== "blood-drip") {
      problems.push(`blood-swarm default ${JSON.stringify(results.bloodDefault)}`);
    }
  }

  phase("blood default done");
  // Hostile edits through the HUD are coerced by the active tab.
  await goTab("deep-space");
  await set("sel-flow", "gas");
  let { flat: f } = await flat();
  if (f.flowType === "gas" || f.flowMode === "gas") problems.push("gas flow survived on deep-space");
  await goTab("blood-swarm", "blood-drip");
  await set("sel-trail-type", "none").catch(() => {});
  ({ flat: f } = await flat());
  if (f.trailType !== "comet" || f.trailLength < 0.72 || f.kineticMode !== "splatter-run" || f.particleStyle !== "blood-drop") problems.push(`blood-drip ${JSON.stringify([f.trailType, f.trailLength, f.kineticMode, f.particleStyle])}`);

  phase("hostile edits done");
  // 2) Multi-hue: >= 3 hue sectors per frame.
  const huePass = async (name, tab, palette, formation) => {
    const g0 = Date.now();
    await goTab(tab);
    await set("sel-count", "64k");
    if (formation) await set("sel-formation", formation);
    await set("sel-palette", palette);
    const m = await measure(`hue ${name}`, 4500);
    results.hues[name] = { hueSectorCount: m.hueSectorCount, colored: +m.coloredFraction.toFixed(3), blackRatio: +m.blackRatio.toFixed(3), whiteClip: +m.whiteClip.toFixed(4) };
    await shot(`gh010-hue-${name}`);
    phase(`hue pass ${name}`, { gateMs: Date.now() - g0, metrics: results.hues[name] });
    if (!(m.hueSectorCount >= 3)) problems.push(`${name} hueSectorCount ${m.hueSectorCount} < 3`);
  };
  await huePass("full-spectrum", "deep-space", "full-spectrum", "wormhole");
  await huePass("true-neon", "deep-space", "true-neon", "wormhole");
  if (!software) await huePass("golden-cortex", "brain-3d", "golden-cortex");

  // 3) 256k density on deep-space.
  const g256 = Date.now();
  await goTab("deep-space");
  await set("sel-formation", "wormhole");
  await set("sel-palette", "true-neon");
  await set("sel-count", "256k");
  const framesBefore256k = await evaluate("window.__ZUR_DEBUG__.particleSystem.framesRendered");
  const dense = await measure("256k deep-space", 7000);
  results.density = { frames: dense.frames, count: await evaluate("window.__ZUR_DEBUG__.particleSystem.count"), blackRatio: +dense.blackRatio.toFixed(3), whiteClip: +dense.whiteClip.toFixed(4) };
  await shot("gh010-256k-deep-space");
  if (results.density.count !== 262144) problems.push(`256k count ${results.density.count}`);
  // ZUR-GH-011: hardware D3D11 (Windows) settles darker trails than CI SwiftShader (~0.32 vs >= 0.38); CI keeps 0.38.
  results.density.blackRatioMin = denseBlackMin;
  if (!(dense.blackRatio >= denseBlackMin && dense.blackRatio <= 0.82)) problems.push(`256k blackRatio ${dense.blackRatio.toFixed(3)} outside ${denseBlackMin}..0.82`);
  if (dense.whiteClip !== 0) problems.push(`256k whiteClip ${dense.whiteClip}`);
  phase("256k density gate", { gateMs: Date.now() - g256, metrics: results.density });

  // 262144-particle VBO / crowd-norm gate (hardware and software).
  const g256v = Date.now();
  results.vbo256k = await evaluate(`(() => { const d = window.__ZUR_DEBUG__; const gl = d.shaderHost.gl; const ps = d.particleSystem;
    gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[0]); const bytes0 = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
    gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[1]); const bytes1 = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const activeCount = gl.getUniform(ps.renderProgram, ps.renderLoc.u_activeCount);
    return { count: ps.count, bytes0, bytes1, activeCount, framesRendered: ps.framesRendered, glErrors: window.__zurGlErrors() }; })()`);
  {
    const v = results.vbo256k;
    const expectedCrowd = densityCrowdNorm(262144);
    v.crowdNorm = densityCrowdNorm(v.activeCount);
    v.expectedCrowd = expectedCrowd;
    v.framesBefore = framesBefore256k;
    if (v.count !== 262144) problems.push(`vbo256k count ${v.count}`);
    if (!(v.bytes0 >= 262144 * 32) || !(v.bytes1 >= 262144 * 32)) problems.push(`vbo256k buffer bytes ${v.bytes0}/${v.bytes1} < ${262144 * 32}`);
    if (v.activeCount !== 262144) problems.push(`vbo256k u_activeCount ${v.activeCount}`);
    if (!(Math.abs(v.crowdNorm - expectedCrowd) <= 1e-9)) problems.push(`vbo256k crowdNorm ${v.crowdNorm} != ${expectedCrowd}`);
    if (!(v.crowdNorm >= 0.28 && v.crowdNorm < 1)) problems.push(`vbo256k crowdNorm ${v.crowdNorm} not on the dense branch`);
    if (!(v.framesRendered > framesBefore256k)) problems.push(`vbo256k framesRendered not increasing ${framesBefore256k} -> ${v.framesRendered}`);
    if (v.glErrors.length) problems.push(`vbo256k GL errors ${v.glErrors}`);
  }
  phase("256k VBO/crowdNorm gate", { gateMs: Date.now() - g256v, values: results.vbo256k });

  // 4) Supermassive black hole event horizon at 256k (+ max trails).
  await set("sel-formation", "supermassive-blackhole");
  await set("sel-kinetic-mode", "accretion-warp");
  const trailLength0 = await evaluate("(() => { const v = +document.getElementById('rng-trail-length')?.value; return Number.isFinite(v) && v > 0 ? v : 0.5; })()").catch(() => 0.5);
  await evaluate("window.__zurSetRange('rng-trail-length', 1)").catch(() => {});
  await sleep(500);
  const gbh = Date.now();
  const yOff = await evaluate("window.__ZUR_DEBUG__.renderHost.viewportYOffset");
  const dim = await evaluate(software ? "(window.__zurSw.step(1, " + SW_FRAME_DT_MS + "), window.__zurReadNow(0,0,0))" : "window.__zurMetrics(0,0,0)");
  const cx = dim.w / 2;
  const cy = dim.h * (0.5 + yOff / 2);
  const rad = 0.16 * (Math.min(dim.w, dim.h * (1 - yOff / 2 - 0.0)) / 2);
  const bh = await measure("blackhole 256k", 7000, cx, cy, rad);
  results.blackhole = { frames: bh.frames, viewportYOffset: yOff, center: [cx, cy], radiusPx: +rad.toFixed(1), samples: bh.centerSamples, centerBlackRatio: +bh.centerBlackRatio.toFixed(3), blackRatio: +bh.blackRatio.toFixed(3), whiteClip: +bh.whiteClip.toFixed(4) };
  await shot("gh010-blackhole-256k");
  if (!(bh.centerBlackRatio >= 0.9)) problems.push(`blackhole centerBlackRatio ${bh.centerBlackRatio} < 0.90`);
  if (!(bh.whiteClip === 0)) problems.push(`blackhole whiteClip ${bh.whiteClip}`);
  phase("blackhole gate", { gateMs: Date.now() - gbh, metrics: results.blackhole });
  // ---- ZUR-GH-012 edge-on Gargantua: disk pixels around the void form a horizontal bar (equatorial wings vs polar columns, lit-pixel density).
  // Runs at 64k with short trails and extra frames so the formation has time to converge (the 256k void gate above only
  // needs the horizon discard).
  {
    const g0 = Date.now();
    await goTab("deep-space");
    await set("sel-formation", "supermassive-blackhole");
    await set("sel-kinetic-mode", "accretion-warp");
    await set("sel-count", "64k");
    await set("sel-particle-style", "dart3d");
    await evaluate("window.__zurSetRange('rng-trail-length', 0.1)").catch(() => {});
    await evaluate("window.__zurSetRange('rng-size', 0.6)").catch(() => {});
    let d;
    if (software) {
      d = await evaluate(`(() => { window.__zurSw.step(${BH_DISK_FRAMES}, ${SW_FRAME_DT_MS}); return window.__zurReadNow(${cx}, ${cy}, ${rad}); })()`);
    } else {
      await sleep(5000);
      d = await evaluate(`window.__zurMetrics(${cx}, ${cy}, ${rad})`);
    }
    // Vertical spread of the lit pixels in the left/right wing columns (1.5R < |dx| < 4R, |dy| < 4R; the face-on photon ring and
    // the polar jets stay out of them). A uniform face-on disk has sigma_y = 4R / sqrt(3); the edge-on bar is much thinner.
    const aspect = (4 * rad / Math.sqrt(3)) / Math.max(d.barSpreadY, 1);
    results.gh012.blackholeDisk = { frames: software ? BH_DISK_FRAMES : undefined, litPixels: d.barN, spreadX: +d.barSpreadX.toFixed(1), spreadY: +d.barSpreadY.toFixed(1), aspect: +aspect.toFixed(2), centerBlackRatio: +(d.centerBlackRatio ?? 0).toFixed(3), min: BH_ASPECT_MIN };
    await shot("gh012-blackhole-disk");
    phase("blackhole disk orientation gate", { gateMs: Date.now() - g0, metrics: results.gh012.blackholeDisk });
    if (!(d.barN > 200)) problems.push(`blackhole disk lit pixels ${d.barN} <= 200`);
    if (!(aspect >= BH_ASPECT_MIN)) problems.push(`blackhole disk aspect ${aspect.toFixed(2)} < ${BH_ASPECT_MIN}`);
    if (!(d.centerBlackRatio >= 0.9)) problems.push(`blackhole disk run centerBlackRatio ${d.centerBlackRatio}`);
    if (!(d.whiteClip === 0)) problems.push(`blackhole disk whiteClip ${d.whiteClip}`);
    await evaluate("window.__zurSetRange('rng-size', 1)").catch(() => {});
  }
  if (software) {
    // ZUR-GH-012: SwiftShader runs the 256k gates from the deep-space wormhole state, then golden-cortex (64k).
    await evaluate("window.__zurSetRange('rng-trail-length', " + trailLength0 + ")").catch(() => {});
    await huePass("golden-cortex", "brain-3d", "golden-cortex");
  }

  // 5) ZUR-GH-011 3D Brain luminance at idle (capture stopped, u_rms == 0) on the brain entry defaults at 64k.
  // activeMeanLuma = mean Rec.709 luma of lit pixels (max channel > 0.03). The 0.22 floor is the ticket gate; the
  // stricter idle floor (default 0.36, ZUR_BRAIN_LUMA_MIN) separates b431f90 (~0.32) from ZUR-GH-011 (~0.42) on D3D11.
  await evaluate("document.getElementById('btn-stop').click()");
  await goTab("brain-3d");
  await evaluate(`import("/src/render/particleMath.js").then((m) => { window.__ZUR_DEBUG__.state.updatePreset((draft) => {
    draft.particles = m.normalizeParticles({ ...m.DEFAULT_PARTICLES, formationType: "neural-brain", particleStyle: "synapse-spark", kineticMode: "synapse-cascade", colorPalette: "golden-cortex" });
  }); return true; })`);
  {
    const gbr = Date.now();
    let worst = null;
    if (software) {
      worst = await evaluate(`(() => {
        window.__zurSw.step(${SW_WARMUP_FRAMES - 2}, ${SW_FRAME_DT_MS});
        let worst = null;
        for (let i = 0; i < 2; i += 1) {
          window.__zurSw.step(1, ${SW_FRAME_DT_MS});
          const m = window.__zurReadNow(0, 0, 0);
          if (!worst || m.activeMeanLuma < worst.activeMeanLuma) worst = m;
        }
        return worst;
      })()`);
    } else {
      await sleep(5000);
      for (let i = 0; i < 3; i += 1) {
        const m = await evaluate("window.__zurMetrics(0, 0, 0)");
        if (!worst || m.activeMeanLuma < worst.activeMeanLuma) worst = m;
        await sleep(300);
      }
    }
    const capture = await evaluate("window.__ZUR_DEBUG__.state.status.capture");
    results.brainLuma = { capture, palette: (await flat()).flat.colorPalette, activeMeanLuma: +worst.activeMeanLuma.toFixed(3), activeFraction: +worst.activeFraction.toFixed(3), frameMeanLuma: +worst.frameMeanLuma.toFixed(4), whiteClip: worst.whiteClip, idleFloor: brainMin, frames: software ? SW_WARMUP_FRAMES : undefined };
    await shot("gh011-brain-idle");
    if (capture !== "idle") problems.push(`brain luma measured with capture ${capture}`);
    if (!(worst.activeMeanLuma >= 0.22)) problems.push(`3D Brain activeMeanLuma ${worst.activeMeanLuma.toFixed(3)} < 0.22 (dark smudge)`);
    if (!(worst.activeMeanLuma >= brainMin)) problems.push(`3D Brain idle activeMeanLuma ${worst.activeMeanLuma.toFixed(3)} < ${brainMin}`);
    if (worst.whiteClip !== 0) problems.push(`3D Brain whiteClip ${worst.whiteClip}`);
    phase("brain luma gate", { gateMs: Date.now() - gbr, metrics: results.brainLuma });
  }


  // ================= ZUR-GH-012 gates =================
  // ---- tab/scene sync: boot, Mode B, Mode A
  {
    const g0 = Date.now();
    const sync = () => evaluate(`import("/src/app/AppState.js").then((m) => { const s = window.__ZUR_DEBUG__.state.preset; return { hudTab: s.hud?.hudTab, sceneId: s.sceneId, derived: m.sceneForHud(s.hud?.hudTab, s.hud?.shaderScene, s.hud?.visualTab), formation: s.particles.formationType, tier: s.particles.particleCountTier, size: s.particles.particleSize, activeTab: document.querySelector('.hud-tab[aria-selected="true"], .hud-tab.is-active')?.dataset.hudTab }; })`);
    await goTab("megastructure");
    const mega = await sync();
    await click("#btn-mode-b");
    await sleep(300);
    const modeB = await sync();
    await click("#btn-mode-a");
    await sleep(300);
    const modeA = await sync();
    results.gh012.tabSceneSync = { boot: bootSync, mega, modeB, modeA };
    phase("tabSceneSync gate", { gateMs: Date.now() - g0, metrics: results.gh012.tabSceneSync });
    if (bootSync.sceneId !== bootSync.derived) problems.push(`boot hudTab ${bootSync.hudTab} != sceneId ${bootSync.sceneId}`);
    if (mega.sceneId !== "megastructure-3d" || mega.hudTab !== "megastructure") problems.push(`megastructure tab desync ${JSON.stringify(mega)}`);
    if (modeB.hudTab !== "deep-space" || modeB.sceneId !== "particle-swarm-3d" || modeB.formation !== "wormhole" || modeB.tier !== "64k" || modeB.size !== 1) problems.push(`Mode B ${JSON.stringify(modeB)}`);
    if (modeA.sceneId !== modeA.derived) problems.push(`Mode A tab/scene desync ${JSON.stringify(modeA)}`);
    if (modeB.activeTab && modeB.activeTab !== "deep-space") problems.push(`Mode B highlighted tab ${modeB.activeTab}`);
  }

  const settleFrames = async (n, ms = 700) => {
    if (software) await evaluate(`window.__zurSw.step(${n}, ${SW_FRAME_DT_MS})`);
    else await sleep(ms);
  };
  const setParticles = (patch) => evaluate(`import("/src/render/particleMath.js").then((m) => { window.__ZUR_DEBUG__.state.updatePreset((draft) => { draft.particles = m.normalizeParticles({ ...draft.particles, ...${JSON.stringify(patch)} }); }); return true; })`);

  // ---- 1 sim step per frame + 256k dart quad
  {
    const g0 = Date.now();
    await goTab("deep-space");
    await set("sel-formation", "wormhole");
    await set("sel-particle-style", "dart3d");
    await set("sel-palette", "true-neon");
    const readStats = () => evaluate("(() => { const st = window.__ZUR_DEBUG__.particleSystem.stats(); return { stepsLastFrame: st.stepsLastFrame, simSteps: st.simSteps, dartVerts: st.dartVerts, count: st.count ?? window.__ZUR_DEBUG__.particleSystem.count }; })()");
    const samples = {};
    for (const tier of ["64k", "256k"]) {
      await set("sel-count", tier);
      const reads = [];
      for (let i = 0; i < 4; i += 1) { await settleFrames(1, 120); reads.push(await readStats()); }
      samples[tier] = reads;
    }
    results.gh012.simSteps = { at64k: samples["64k"].at(-1), at256k: samples["256k"].at(-1), allSteps: [...samples["64k"], ...samples["256k"]].map((r) => r.stepsLastFrame) };
    phase("simSteps / dart quad gate", { gateMs: Date.now() - g0, metrics: results.gh012.simSteps });
    for (const r of [...samples["64k"], ...samples["256k"]]) {
      if (r.stepsLastFrame !== 1 || r.simSteps !== 1) problems.push(`stepsLastFrame ${r.stepsLastFrame} / simSteps ${r.simSteps} != 1`);
    }
    const last = samples["256k"].at(-1);
    if (last.count !== 262144) problems.push(`simSteps gate count ${last.count}`);
    if (last.dartVerts !== 4) problems.push(`256k dartVerts ${last.dartVerts} != 4`);
    if (samples["64k"].at(-1).dartVerts !== 12) problems.push(`64k dartVerts ${samples["64k"].at(-1).dartVerts} != 12`);
  }

  // ---- 256k meanSat for the rainbow palettes
  for (const palette of ["full-spectrum", "true-neon"]) {
    const g0 = Date.now();
    await set("sel-palette", palette);
    const m = await measure(`256k meanSat ${palette}`, 7000);
    const count = await evaluate("window.__ZUR_DEBUG__.particleSystem.count");
    results.gh012[`meanSat_${palette}`] = { count, meanSat: +m.meanSat.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), hueSectorCount: m.hueSectorCount, min: 0.55 };
    phase(`256k meanSat ${palette}`, { gateMs: Date.now() - g0, metrics: results.gh012[`meanSat_${palette}`] });
    if (count !== 262144) problems.push(`meanSat ${palette} count ${count}`);
    if (!(m.meanSat >= 0.55)) problems.push(`256k ${palette} meanSat ${m.meanSat.toFixed(3)} < 0.55`);
    if (m.whiteClip !== 0) problems.push(`256k ${palette} whiteClip ${m.whiteClip}`);
  }

  // ---- logo-attractor glyph luma at inherited particleSize 0.5
  {
    const g0 = Date.now();
    await evaluate("document.getElementById('btn-stop')?.click()");
    await goTab("blood-swarm", "logo-text");
    await set("sel-count", "64k");
    await set("sel-attractor-preset", "AI: UNDERGROUND");
    await set("sel-palette", "true-neon");
    await setParticles({ particleSize: 0.5 });
    await sleep(400);
    const m = await measure("logo AI: UNDERGROUND", 4500);
    const f = (await flat()).flat;
    results.gh012.logoLuma = { formation: f.formationType, text: f.attractorText, particleSize: f.particleSize, activeMeanLuma: +m.activeMeanLuma.toFixed(3), activeFraction: +m.activeFraction.toFixed(4), min: 0.12 };
    await shot("gh012-logo");
    phase("logo glyph luma gate", { gateMs: Date.now() - g0, metrics: results.gh012.logoLuma });
    if (f.formationType !== "logo-attractor") problems.push(`logo formation ${f.formationType}`);
    if (!(m.activeMeanLuma >= 0.12)) problems.push(`logo glyph luma ${m.activeMeanLuma.toFixed(3)} < 0.12`);
    if (!(m.activeFraction > 0.0005)) problems.push(`logo glyph pixels ${m.activeFraction}`);
  }

  // ---- 3D Brain on all 5 palettes
  {
    const g0 = Date.now();
    await goTab("brain-3d");
    await setParticles({ formationType: "neural-brain", particleStyle: "synapse-spark", kineticMode: "synapse-cascade", particleCountTier: "64k", particleSize: 1.0 });
    results.gh012.brainPalettes = {};
    for (const palette of ["true-neon", "full-spectrum", "white-static", "blood-red", "golden-cortex"]) {
      await set("sel-palette", palette);
      const m = await measure(`brain ${palette}`, 4500);
      results.gh012.brainPalettes[palette] = { activeMeanLuma: +m.activeMeanLuma.toFixed(3), activeFraction: +m.activeFraction.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), meanR: +m.meanR.toFixed(3), meanG: +m.meanG.toFixed(3), meanB: +m.meanB.toFixed(3) };
      if (palette === "blood-red") {
        // Option B: deep arterial crimson. Pure #FF0000 caps at 0.2126 Rec.709 luma, so gate luma >= 0.12 + red dominance.
        if (!(m.activeMeanLuma >= 0.12)) problems.push(`3D Brain blood-red luma ${m.activeMeanLuma.toFixed(3)} < 0.12`);
        if (!(m.meanR > 2.2 * m.meanG)) problems.push(`3D Brain blood-red not red-dominant: meanR ${m.meanR.toFixed(3)} <= 2.2 * meanG ${m.meanG.toFixed(3)}`);
      } else if (!(m.activeMeanLuma >= 0.25)) problems.push(`3D Brain ${palette} luma ${m.activeMeanLuma.toFixed(3)} < 0.25`);
      if (m.whiteClip !== 0) problems.push(`3D Brain ${palette} whiteClip ${m.whiteClip}`);
    }
    phase("brain all-palette luma gate", { gateMs: Date.now() - g0, metrics: results.gh012.brainPalettes });
  }

  // ---- spectral canyon obsidian at hueShift -0.83
  {
    const g0 = Date.now();
    await goTab("canyon-pulse", "spectral-canyon-3d");
    await evaluate("window.__zurSetRange('rng-hue', -0.83)");
    const m = await measure("spectral canyon", 3000);
    const scene = (await flat()).flat;
    results.gh012.canyon = { sceneId: scene.sceneId, hueShift: scene.hueShift, blackRatio: +m.blackRatio.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), min: 0.42 };
    await shot("gh012-canyon");
    phase("spectral canyon obsidian gate", { gateMs: Date.now() - g0, metrics: results.gh012.canyon });
    if (scene.sceneId !== "spectral-canyon-3d") problems.push(`canyon sceneId ${scene.sceneId}`);
    if (!(m.blackRatio >= 0.42)) problems.push(`canyon blackRatio ${m.blackRatio.toFixed(3)} < 0.42`);
    await evaluate("window.__zurSetRange('rng-hue', 0)");
  }

  // ---- megastructure camera modes visibly move the raymarch eye
  {
    const g0 = Date.now();
    await goTab("megastructure");
    const out = {};
    for (const mode of ["orbit-3d", "tunnel-fly"]) {
      await set("sel-camera-mode", mode).catch(() => {});
      await settleFrames(2, 300);
      const a = await evaluate("(() => { const st = window.__ZUR_DEBUG__.particleSystem.stats(); return { eye: st.coreEye, fwd: st.coreForward }; })()");
      await settleFrames(5, 1500);
      const b = await evaluate("(() => { const st = window.__ZUR_DEBUG__.particleSystem.stats(); return { eye: st.coreEye, fwd: st.coreForward }; })()");
      const dist = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]));
      out[mode] = { eyeDelta: +dist(a.eye, b.eye).toFixed(3), fwdDelta: +dist(a.fwd, b.fwd).toFixed(3) };
      if (!(out[mode].eyeDelta > 0.05 || out[mode].fwdDelta > 0.01)) problems.push(`megastructure ${mode} camera did not move ${JSON.stringify(out[mode])}`);
    }
    results.gh012.megaCamera = out;
    phase("megastructure camera gate", { gateMs: Date.now() - g0, metrics: out });
  }

  // ---- Android mic fallback: raw -> {audio:true} -> silent Demo Beat
  {
    const g0 = Date.now();
    await evaluate("document.getElementById('btn-stop')?.click()");
    await goTab("deep-space");
    await evaluate(`(() => { window.__zurGum = []; navigator.mediaDevices.getUserMedia = (c) => { window.__zurGum.push(JSON.stringify(c)); const e = new Error("Could not start audio source"); e.name = "NotReadableError"; return Promise.reject(e); }; return true; })()`);
    await evaluate("document.getElementById('btn-mic').click()");
    await sleep(900);
    await settleFrames(5, 800);
    const mic = await evaluate(`(() => { const d = window.__ZUR_DEBUG__; const diag = d.getDiagnostics(); const ms = d.getMicState();
      const snap = d.readSnapshot ? d.readSnapshot() : null; const f = d.extractor?.update ? null : null;
      return { attempts: window.__zurGum.map((s) => JSON.parse(s)), micStage: ms.micStage, demoBeat: ms.demoBeat, destinationConnections: diag.destinationConnections,
        capture: d.state.status.capture, label: document.getElementById('mic-status')?.textContent || '', labelVisible: !!document.getElementById('mic-status') && !document.getElementById('mic-status').hidden && document.getElementById('mic-status').offsetParent !== null,
        hudError: document.getElementById('hud-error')?.textContent || '', rms: diag.rms ?? null }; })()`);
    const feat = await evaluate("(() => { const f = window.__ZUR_DEBUG__.extractor.last || window.__ZUR_DEBUG__.extractor.frame || null; return f ? { rms: f.rms, bass: f.bass, mid: f.mid, treble: f.treble } : null; })()");
    // sample analysed features over several frames (beat is periodic; take the max)
    let maxRms = 0; let maxBass = 0;
    for (let i = 0; i < 24 && !(maxRms > 0.001 && maxBass > 0.001); i += 1) {
      await settleFrames(1, 120);
      const v = await evaluate("(() => { const d = window.__ZUR_DEBUG__; const a = d.readSnapshot(); const fr = d.extractor.update(a); return { rms: fr.rms, bass: fr.bass, mid: fr.mid, treble: fr.treble }; })()").catch(() => null);
      if (v) { maxRms = Math.max(maxRms, v.rms || 0); maxBass = Math.max(maxBass, v.bass || 0); }
      await sleep(150); // audio runs in real time, even when the renderer is stepped deterministically
    }
    results.gh012.mic = { ...mic, feat, maxRms: +maxRms.toFixed(4), maxBass: +maxBass.toFixed(4) };
    phase("mic fallback gate", { gateMs: Date.now() - g0, metrics: results.gh012.mic });
    if (mic.attempts.length !== 2) problems.push(`mic getUserMedia attempts ${mic.attempts.length} != 2`);
    else {
      if (mic.attempts[0]?.audio?.echoCancellation !== false) problems.push(`mic first attempt not raw ${JSON.stringify(mic.attempts[0])}`);
      if (JSON.stringify(mic.attempts[1]) !== JSON.stringify({ audio: true })) problems.push(`mic second attempt ${JSON.stringify(mic.attempts[1])}`);
    }
    if (mic.micStage !== "demo") problems.push(`micStage ${mic.micStage}`);
    if (!(mic.demoBeat?.running && mic.demoBeat?.bpm === 124)) problems.push(`demo beat ${JSON.stringify(mic.demoBeat)}`);
    if (mic.destinationConnections !== 0) problems.push(`demo beat destinationConnections ${mic.destinationConnections}`);
    if (!/Demo Beat 124 BPM \(silent\)/.test(mic.label) || !mic.labelVisible) problems.push(`mic label ${JSON.stringify([mic.label, mic.labelVisible])}`);
    if (!(maxRms > 0.001) || !(maxBass > 0.001)) problems.push(`demo beat analysed rms ${maxRms} bass ${maxBass} not > 0`);
    await evaluate("document.getElementById('btn-stop')?.click()");
  }

  if (software) await evaluate("window.__ZUR_DEBUG__.renderHost.start()");

  const diag = await evaluate("window.__ZUR_DEBUG__.getDiagnostics()");
  results.destinationConnections = diag.destinationConnections;

  // ---- reload from a stored desynced zur_state_v5_2 -> repaired by the v5_3 migration
  {
    const g0 = Date.now();
    await send("Page.navigate", { url: `${base}/sw.js` });
    await sleep(500);
    await evaluate(`import("/src/app/AppState.js").then((m) => { localStorage.clear(); const p = JSON.parse(JSON.stringify(m.STAGE2_DEFAULT_PRESET)); p.hud.hudTab = "deep-space"; p.sceneId = "megastructure-3d";
      localStorage.setItem("zur_state_v5_2", JSON.stringify({ storageSchema: 5.2, preset: p })); return true; })`).catch(async () => {
      // 404 document has no module base: write the raw envelope instead
      await evaluate(`localStorage.setItem("zur_state_v5_2", JSON.stringify({ storageSchema: 5.2, preset: { __raw: true } }))`);
    });
    await send("Page.navigate", { url: `${base}/?debug=1` });
    let boot2 = "";
    for (let attempt = 0; attempt < 150; attempt += 1) {
      boot2 = await evaluate("window.__ZUR_BOOT__ || ''").catch(() => "");
      if (boot2 === "ok" || boot2 === "error") break;
      await sleep(100);
    }
    const after = await evaluate(`(() => { const p = window.__ZUR_DEBUG__?.state.preset; return p ? { hudTab: p.hud?.hudTab, sceneId: p.sceneId, key: !!localStorage.getItem("zur_state_v5_3") } : null; })()`);
    results.gh012.reloadMigration = { boot: boot2, ...after };
    phase("v5_2 -> v5_3 reload migration gate", { gateMs: Date.now() - g0, metrics: results.gh012.reloadMigration });
    if (boot2 !== "ok" || !after) problems.push(`reload boot ${boot2}`);
    else if (after.hudTab !== "deep-space" || after.sceneId !== "particle-swarm-3d") problems.push(`reload migration ${JSON.stringify(after)}`);
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
