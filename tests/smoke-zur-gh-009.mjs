// ZUR-GH-009 headless Chrome smoke (412x915 portrait): 256k + logo-attractor / neural-brain stay error-free, every
// Stage 5 style/palette/formation scenario stays lit (blackRatio < 0.85) without white clipping (whiteClip < 0.01),
// and audio reactivity moves the swarm even with Oscillation amount == 0.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.ZUR_PORT || 8089);
const SHOTS = process.env.ZUR_SHOTS || "/workspace/artifacts/zur-gh-009";
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
  `--user-data-dir=/tmp/zur-gh-009-chrome-${Date.now()}`,
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
const results = { stability: {}, scenarios: {}, reactivity: {} };

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
    // whiteClip: share of all canvas pixels with every channel >= 245/255 (blown to white).
    // meanSat: mean HSV saturation (max - min) / max over active pixels (max channel > 0.12).
    window.__zur009 = () => new Promise((resolve) => {
      requestAnimationFrame(() => {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let total = 0; let black = 0; let lit = 0; let white = 0; let nearWhite = 0; let satSum = 0; let desat = 0; let bright = 0; let brightSatSum = 0;
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            const r = buf[i]; const g = buf[i + 1]; const b = buf[i + 2];
            const mx = Math.max(r, g, b) / 255;
            const mn = Math.min(r, g, b) / 255;
            total += 1;
            if (mx <= 0.03) black += 1;
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
          blackRatio: black / total,
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
    // GPU state readback: finite check, mean 3D radius and max |xyz| over the first N live agents.
    window.__zurState = (limit = 65536) => {
      const ps = d.particleSystem;
      const count = Math.min(ps.count, limit);
      const data = new Float32Array(count * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps.buffers[ps.read]);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      let rSum = 0; let bad = 0; let maxAbs = 0;
      for (let i = 0; i < count; i += 1) {
        const x = data[i * 8]; const y = data[i * 8 + 1]; const z = data[i * 8 + 2];
        if (!Number.isFinite(x + y + z)) { bad += 1; continue; }
        rSum += Math.hypot(x, y, z);
        maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z));
      }
      return { count: ps.count, meanRadius: rSum / Math.max(1, count - bad), nonFinite: bad, maxAbs };
    };
    window.__zurFeat = null;
    const extractor = d.extractor;
    const origUpdate = extractor.update.bind(extractor);
    extractor.update = (arg) => {
      const frame = origUpdate(arg);
      if (window.__zurFeat) Object.assign(frame, window.__zurFeat);
      return frame;
    };
    window.__zurWorst009 = async (tries = 4) => {
      let worst = null;
      for (let i = 0; i < tries; i += 1) {
        const m = await window.__zur009();
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
  const measure = async (label, settleMs = 3000) => {
    await sleep(settleMs);
    const metrics = await evaluate("window.__zurWorst009(3)");
    const glErrors = await evaluate("window.__zurGlErrors()");
    if (glErrors.length) problems.push(`${label} GL errors ${glErrors}`);
    return { ...metrics, glErrors };
  };
  const set = (id, value, range = false) => evaluate(`window.__zurSet${range ? "Range" : "Select"}("${id}", ${JSON.stringify(value)})`);
  const compact = (m) => ({ blackRatio: +m.blackRatio.toFixed(3), whiteClip: +m.whiteClip.toFixed(4), meanSat: +m.meanSat.toFixed(3), lit: +m.litFraction.toFixed(3) });

  await evaluate("document.getElementById('btn-oscillator').click()");
  await sleep(2000);
  await set("sel-scene", "particle-swarm-3d");

  // 0) HUD contract: zoom slider range, no orb / preset / audio profile rows, kinetic row sits above Oscillation.
  results.hud = await evaluate(`(() => {
    const zoom = document.getElementById("rng-camera-zoom");
    const styles = [...document.getElementById("sel-particle-style").options].map((o) => o.value);
    const kinetic = document.getElementById("sel-kinetic-mode");
    const osc = document.getElementById("sel-oscillation");
    return {
      zoom: [zoom.min, zoom.max, zoom.step, zoom.value], styles,
      tiers: [...document.getElementById("sel-count").options].map((o) => o.value),
      kineticAboveOsc: Boolean(kinetic.compareDocumentPosition(osc) & Node.DOCUMENT_POSITION_FOLLOWING),
      noPresetRows: !document.getElementById("sel-preset-id") && !document.getElementById("sel-audio-profile"),
      canvasTouch: getComputedStyle(document.getElementById("stage")).touchAction,
      hudTouch: getComputedStyle(document.querySelector(".hud")).touchAction,
    };
  })()`);
  if (results.hud.styles.includes("orb")) problems.push("orb style still in HUD");
  if (results.hud.canvasTouch !== "none" || results.hud.hudTouch !== "pan-y") problems.push(`touch-action ${results.hud.canvasTouch}/${results.hud.hudTouch}`);
  if (!results.hud.kineticAboveOsc || !results.hud.noPresetRows) problems.push(`HUD rows ${JSON.stringify(results.hud)}`);

  // 1) Pinch zoom through real pointer events on the canvas (and HUD pointers are ignored).
  results.zoom = await evaluate(`(() => {
    const c = document.getElementById("stage");
    const zoom = () => window.__ZUR_DEBUG__.state.preset.particles.cameraZoom;
    const fire = (type, id, x, y, target = c) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
    const out = { start: zoom() };
    fire("pointerdown", 1, 150, 400); fire("pointerdown", 2, 250, 400);
    fire("pointermove", 2, 350, 400);
    out.pinchOut = zoom();
    fire("pointermove", 2, 170, 400);
    out.pinchIn = zoom();
    fire("pointerup", 1, 150, 400); fire("pointerup", 2, 170, 400);
    c.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true }));
    out.wheel = zoom();
    fire("pointerdown", 3, 100, 100); fire("pointerup", 3, 100, 100);
    fire("pointerdown", 4, 100, 100); fire("pointerup", 4, 100, 100);
    out.afterDoubleTap = zoom();
    return out;
  })()`);
  const z = results.zoom;
  if (!(z.pinchOut > 1.4 && z.pinchIn < 1.0 && z.wheel > z.pinchIn && Math.abs(z.afterDoubleTap - 1) < 1e-9)) problems.push(`zoom gestures ${JSON.stringify(z)}`);

  // 2) 256k stability: logo-attractor and neural-brain at 256k (VBOs + glyph targets sized for MAX_PARTICLES).
  await set("sel-count", "256k");
  for (const formation of ["logo-attractor", "neural-brain"]) {
    await set("sel-formation", formation);
    const m = await measure(`256k ${formation}`, 6000);
    const st = await evaluate("window.__zurState(262144)");
    results.stability[formation] = { ...compact(m), count: st.count, nonFinite: st.nonFinite, maxAbs: +st.maxAbs.toFixed(2) };
    await shot(`gh009-256k-${formation}`);
    if (st.count !== 262144) problems.push(`256k ${formation}: count ${st.count}`);
    if (st.nonFinite > 0) problems.push(`256k ${formation}: ${st.nonFinite} non-finite agents`);
  }

  // 3) Style / palette / formation scenarios at 64k.
  await set("sel-count", "64k");
  const scenarios = [
    ["blood-splatter", { style: "blood-drop", palette: "blood-red", kinetic: "splatter-run", formation: "free-3d" }],
    ["brain-synapse", { style: "synapse-spark", palette: "true-neon", kinetic: "off", formation: "neural-brain" }],
    ["living-galaxy", { style: "dart3d", palette: "full-spectrum", kinetic: "off", formation: "living-galaxy" }],
    ["blackhole", { style: "dart3d", palette: "true-neon", kinetic: "accretion-warp", formation: "supermassive-blackhole" }],
    ["wormhole-white", { style: "star-streak", palette: "white-static", kinetic: "off", formation: "wormhole" }],
    ["synapse-cascade", { style: "synapse-spark", palette: "true-neon", kinetic: "synapse-cascade", formation: "neural-brain" }],
    ["ribbon-curtain", { style: "dart3d", palette: "true-neon", kinetic: "ribbon-curtain", formation: "free-3d" }],
    ["shock-shatter", { style: "star-streak", palette: "true-neon", kinetic: "shock-shatter", formation: "supernova-shell" }],
  ];
  for (const [name, cfg] of scenarios) {
    await set("sel-particle-style", cfg.style);
    await set("sel-color-palette", cfg.palette);
    await set("sel-kinetic-mode", cfg.kinetic);
    await set("sel-formation", cfg.formation);
    const m = await measure(name, 4500);
    const st = await evaluate("window.__zurState(65536)");
    results.scenarios[name] = { ...compact(m), nonFinite: st.nonFinite, maxAbs: +st.maxAbs.toFixed(2) };
    await shot(`gh009-${name}`);
    if (!(m.blackRatio < 0.85)) problems.push(`${name} blackRatio ${m.blackRatio.toFixed(3)} >= 0.85`);
    if (!(m.whiteClip < 0.01)) problems.push(`${name} whiteClip ${m.whiteClip.toFixed(4)} >= 0.01`);
    if (st.nonFinite > 0) problems.push(`${name}: ${st.nonFinite} non-finite agents`);
  }
  // Zoomed in/out frames keep rendering without GL errors.
  for (const zoomValue of [0.35, 3.5]) {
    await set("rng-camera-zoom", zoomValue, true);
    const m = await measure(`zoom ${zoomValue}`, 2500);
    results.scenarios[`zoom-${zoomValue}`] = compact(m);
    if (!(m.whiteClip < 0.01)) problems.push(`zoom ${zoomValue} whiteClip ${m.whiteClip.toFixed(4)}`);
  }
  await set("rng-camera-zoom", 1, true);

  // 4) Audio reactivity with Oscillation amount == 0: synthetic features move the swarm (radial kick + point size pulse).
  await set("sel-particle-style", "dart3d");
  await set("sel-color-palette", "true-neon");
  await set("sel-kinetic-mode", "off");
  await set("sel-formation", "neon-tunnel");
  await set("rng-osc-amount", 0, true);
  const lumaOf = () => evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
    const gl = window.__ZUR_DEBUG__.shaderHost.gl;
    const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 16) sum += buf[i] + buf[i + 1] + buf[i + 2];
    resolve(sum / (buf.length / 16));
  }))`);
  await evaluate("window.__zurFeat = { sub: 0, bass: 0, onset: 0, rms: 0, treble: 0, lowMid: 0, highMid: 0 }; true");
  await sleep(5000);
  const off = await evaluate("window.__zurState(65536)");
  const lumaOff = await lumaOf();
  await evaluate("window.__zurFeat = { sub: 1, bass: 1, onset: 0.9, rms: 0.8, treble: 0.7, lowMid: 0.6, highMid: 0.6 }; true");
  await sleep(5000);
  const on = await evaluate("window.__zurState(65536)");
  const lumaOn = await lumaOf();
  await evaluate("window.__zurFeat = null; true");
  results.reactivity = {
    meanRadiusOff: +off.meanRadius.toFixed(4), meanRadiusOn: +on.meanRadius.toFixed(4),
    radiusDelta: +(on.meanRadius - off.meanRadius).toFixed(4),
    lumaOff: +lumaOff.toFixed(3), lumaOn: +lumaOn.toFixed(3), lumaDelta: +(lumaOn - lumaOff).toFixed(3),
  };
  if (!(Math.abs(results.reactivity.radiusDelta) > 0.005) && !(Math.abs(results.reactivity.lumaDelta) > 0.05)) {
    problems.push(`audio reactivity delta is zero at oscillationAmount 0: ${JSON.stringify(results.reactivity)}`);
  }
  if (!(Math.abs(results.reactivity.radiusDelta) > 0.005)) problems.push(`no position delta: ${JSON.stringify(results.reactivity)}`);

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
  console.error(`ZUR-GH-009 SMOKE FAIL\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("ZUR-GH-009 SMOKE PASS");
