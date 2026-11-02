// ZUR-GH-010 headless Chrome smoke (412x915): 6-tab context HUD gating, zero blank <option>, multi-hue palettes,
// 256k density budget, and the supermassive-blackhole event-horizon void.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.ZUR_PORT || 8090);
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-gh-010";
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
const debugPort = Number(process.env.ZUR_DEBUG_PORT || 9343);
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
  `--user-data-dir=/tmp/zur-gh-010-chrome-${Date.now()}`,
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
        const sectors = new Array(12).fill(0);
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = buf[i] / 255; const g = buf[i + 1] / 255; const b = buf[i + 2] / 255;
            const mx = Math.max(r, g, b);
            total += 1;
            if (mx <= 0.03) black += 1;
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
  if (!(dense.blackRatio >= 0.38 && dense.blackRatio <= 0.82)) problems.push(`256k blackRatio ${dense.blackRatio.toFixed(3)} outside 0.38..0.82`);
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
