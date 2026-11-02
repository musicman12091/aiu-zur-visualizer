// ZUR-GH-010 headless Chrome smoke (412x915): 6-tab context HUD gating, zero blank <option>, multi-hue palettes,
// 256k density budget, and the supermassive-blackhole event-horizon void.
// ZUR-GH-011: + DOM node identity / real slider drag, sticky header overlap, Blood & Swarm default, 3D Brain idle luma.
// Windows: CHROME=<path> (defaults to Program Files) and ZUR_ANGLE=d3d11 to render on the GPU instead of SwiftShader.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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
const base = `http://localhost:${PORT}`;
const debugPort = Number(process.env.ZUR_DEBUG_PORT || 9343);
const chrome = spawn(CHROME_BIN, [
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
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.on("data", () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const consoleErrors = [];
const pageErrors = [];
const webglWarnings = [];
const problems = [];
const results = { tabs: {}, blank: {}, hues: {}, density: {}, blackhole: {} };

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

  const hudError = await evaluate("document.getElementById('hud-error')?.textContent || ''");
  if (hudError) throw new Error(`HUD error after boot: ${hudError}`);
  if (!(await evaluate("Boolean(window.__ZUR_DEBUG__.particleSystem?.ready)"))) throw new Error("particle system not ready after boot");

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
    window.__zurMetrics = (cx, cy, rad) => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let total = 0; let black = 0; let white = 0; let colored = 0;
        let inTotal = 0; let inBlack = 0;
        let lit = 0; let litLuma = 0; let lumaSum = 0;
        const sectors = new Array(12).fill(0);
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = buf[i] / 255; const g = buf[i + 1] / 255; const b = buf[i + 2] / 255;
            const mx = Math.max(r, g, b);
            total += 1;
            if (mx <= 0.03) black += 1;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            lumaSum += luma;
            if (mx > 0.03) { lit += 1; litLuma += luma; }
            if (buf[i] >= 245 && buf[i + 1] >= 245 && buf[i + 2] >= 245) white += 1;
            const [hh, ss, vv] = rgb2hsv(r, g, b);
            if (ss > 0.25 && vv > 0.15) { colored += 1; sectors[Math.min(11, Math.floor(hh * 12))] += 1; }
            if (rad > 0 && Math.hypot(x - cx, y - cy) < rad) { inTotal += 1; if (mx <= 0.03) inBlack += 1; }
          }
        }
        resolve({
          w, h, blackRatio: black / total, whiteClip: white / total,
          hueSectorCount: sectors.filter((n) => colored > 0 && n / colored >= 0.01).length,
          coloredFraction: colored / total,
          centerBlackRatio: inTotal ? inBlack / inTotal : null, centerSamples: inTotal,
          activeMeanLuma: lit ? litLuma / lit : 0, activeFraction: lit / total, frameMeanLuma: lumaSum / total,
        });
      });
    });
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
    await sleep(settleMs);
    let worst = null;
    for (let i = 0; i < 3; i += 1) {
      const m = await evaluate(`window.__zurMetrics(${cx}, ${cy}, ${rad})`);
      if (!worst || m.whiteClip > worst.whiteClip) worst = m;
    }
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return worst;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  await mkdir(SHOTS, { recursive: true });
  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(2000);

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

  // Hostile edits through the HUD are coerced by the active tab.
  await goTab("deep-space");
  await set("sel-flow", "gas");
  let { flat: f } = await flat();
  if (f.flowType === "gas" || f.flowMode === "gas") problems.push("gas flow survived on deep-space");
  await goTab("blood-swarm", "blood-drip");
  await set("sel-trail-type", "none").catch(() => {});
  ({ flat: f } = await flat());
  if (f.trailType !== "comet" || f.trailLength < 0.72 || f.kineticMode !== "splatter-run" || f.particleStyle !== "blood-drop") problems.push(`blood-drip ${JSON.stringify([f.trailType, f.trailLength, f.kineticMode, f.particleStyle])}`);

  // 2) Multi-hue: >= 3 hue sectors per frame.
  const huePass = async (name, tab, palette, formation) => {
    await goTab(tab);
    await set("sel-count", "64k");
    if (formation) await set("sel-formation", formation);
    await set("sel-palette", palette);
    const m = await measure(`hue ${name}`, 4500);
    results.hues[name] = { hueSectorCount: m.hueSectorCount, colored: +m.coloredFraction.toFixed(3), blackRatio: +m.blackRatio.toFixed(3), whiteClip: +m.whiteClip.toFixed(4) };
    await shot(`gh010-hue-${name}`);
    if (!(m.hueSectorCount >= 3)) problems.push(`${name} hueSectorCount ${m.hueSectorCount} < 3`);
  };
  await huePass("full-spectrum", "deep-space", "full-spectrum", "wormhole");
  await huePass("true-neon", "deep-space", "true-neon", "wormhole");
  await huePass("golden-cortex", "brain-3d", "golden-cortex");

  // 3) 256k density on deep-space.
  await goTab("deep-space");
  await set("sel-formation", "wormhole");
  await set("sel-palette", "true-neon");
  await set("sel-count", "256k");
  const dense = await measure("256k deep-space", 7000);
  results.density = { count: await evaluate("window.__ZUR_DEBUG__.particleSystem.count"), blackRatio: +dense.blackRatio.toFixed(3), whiteClip: +dense.whiteClip.toFixed(4) };
  await shot("gh010-256k-deep-space");
  if (results.density.count !== 262144) problems.push(`256k count ${results.density.count}`);
  // ZUR-GH-011: hardware D3D11 (Windows) settles darker trails than CI SwiftShader (~0.32 vs >= 0.38); CI keeps 0.38.
  const denseBlackMin = process.env.ZUR_ANGLE === 'd3d11' ? 0.30 : 0.38;
  results.density.blackRatioMin = denseBlackMin;
  if (!(dense.blackRatio >= denseBlackMin && dense.blackRatio <= 0.82)) problems.push(`256k blackRatio ${dense.blackRatio.toFixed(3)} outside ${denseBlackMin}..0.82`);
  if (dense.whiteClip !== 0) problems.push(`256k whiteClip ${dense.whiteClip}`);

  // 4) Supermassive black hole event horizon at 256k (+ max trails).
  await set("sel-formation", "supermassive-blackhole");
  await set("sel-kinetic-mode", "accretion-warp");
  await evaluate("window.__zurSetRange('rng-trail-length', 1)").catch(() => {});
  await sleep(500);
  const yOff = await evaluate("window.__ZUR_DEBUG__.renderHost.viewportYOffset");
  const dim = await evaluate("window.__zurMetrics(0,0,0)");
  const cx = dim.w / 2;
  const cy = dim.h * (0.5 + yOff / 2);
  const rad = 0.16 * (Math.min(dim.w, dim.h * (1 - yOff / 2 - 0.0)) / 2);
  const bh = await measure("blackhole 256k", 7000, cx, cy, rad);
  results.blackhole = { viewportYOffset: yOff, center: [cx, cy], radiusPx: +rad.toFixed(1), samples: bh.centerSamples, centerBlackRatio: +bh.centerBlackRatio.toFixed(3), blackRatio: +bh.blackRatio.toFixed(3), whiteClip: +bh.whiteClip.toFixed(4) };
  await shot("gh010-blackhole-256k");
  if (!(bh.centerBlackRatio >= 0.9)) problems.push(`blackhole centerBlackRatio ${bh.centerBlackRatio} < 0.90`);
  if (!(bh.whiteClip === 0)) problems.push(`blackhole whiteClip ${bh.whiteClip}`);

  // 5) ZUR-GH-011 3D Brain luminance at idle (capture stopped, u_rms == 0) on the brain entry defaults at 64k.
  // activeMeanLuma = mean Rec.709 luma of lit pixels (max channel > 0.03). The 0.22 floor is the ticket gate; the
  // stricter idle floor (default 0.36, ZUR_BRAIN_LUMA_MIN) separates b431f90 (~0.32) from ZUR-GH-011 (~0.42) on D3D11.
  await evaluate("document.getElementById('btn-stop').click()");
  await goTab("brain-3d");
  await evaluate(`import("/src/render/particleMath.js").then((m) => { window.__ZUR_DEBUG__.state.updatePreset((draft) => {
    draft.particles = m.normalizeParticles({ ...m.DEFAULT_PARTICLES, formationType: "neural-brain", particleStyle: "synapse-spark", kineticMode: "synapse-cascade", colorPalette: "golden-cortex" });
  }); return true; })`);
  {
    const brainMin = Number(process.env.ZUR_BRAIN_LUMA_MIN || 0.36);
    await sleep(5000);
    let worst = null;
    for (let i = 0; i < 3; i += 1) {
      const m = await evaluate("window.__zurMetrics(0, 0, 0)");
      if (!worst || m.activeMeanLuma < worst.activeMeanLuma) worst = m;
      await sleep(300);
    }
    const capture = await evaluate("window.__ZUR_DEBUG__.state.status.capture");
    results.brainLuma = { capture, palette: (await flat()).flat.colorPalette, activeMeanLuma: +worst.activeMeanLuma.toFixed(3), activeFraction: +worst.activeFraction.toFixed(3), frameMeanLuma: +worst.frameMeanLuma.toFixed(4), whiteClip: worst.whiteClip, idleFloor: brainMin };
    await shot("gh011-brain-idle");
    if (capture !== "idle") problems.push(`brain luma measured with capture ${capture}`);
    if (!(worst.activeMeanLuma >= 0.22)) problems.push(`3D Brain activeMeanLuma ${worst.activeMeanLuma.toFixed(3)} < 0.22 (dark smudge)`);
    if (!(worst.activeMeanLuma >= brainMin)) problems.push(`3D Brain idle activeMeanLuma ${worst.activeMeanLuma.toFixed(3)} < ${brainMin}`);
    if (worst.whiteClip !== 0) problems.push(`3D Brain whiteClip ${worst.whiteClip}`);
  }

  const diag = await evaluate("window.__ZUR_DEBUG__.getDiagnostics()");
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
  console.error(`ZUR-GH-010 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ZUR-GH-010 SMOKE PASS");
