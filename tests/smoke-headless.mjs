import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".glsl": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".css": "text/css",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const path = normalize(url.pathname);
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

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const debugPort = 9333;
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=/tmp/zur-chrome-${debugPort}`,
  `--remote-debugging-port=${debugPort}`,
  "--window-size=1280,720",
  `http://127.0.0.1:${port}/?debug=1`,
], { stdio: ["ignore", "ignore", "pipe"] });
const logs = [];
chrome.stderr.on("data", (chunk) => {
  const line = String(chunk);
  if (/ERROR:dbus|TensorFlow|UPower/.test(line)) return;
  logs.push(line.trim());
});
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  let targets = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        targets = pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl);
        if (targets) break;
      }
    } catch {
      await sleep(100);
    }
  }
  if (!targets?.webSocketDebuggerUrl) throw new Error("Chrome DevTools endpoint did not open");
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      logs.push(message.params.args.map((arg) => arg.value || arg.description).join(" "));
    }
    if (message.method === "Runtime.exceptionThrown") {
      logs.push(message.params.exceptionDetails?.text || "exception");
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
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/?debug=1` });
  let boot = "missing";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await send("Runtime.evaluate", {
      expression: "window.__ZUR_BOOT__ || ''",
      returnByValue: true,
    });
    boot = result.result.value;
    if (boot === "ok" || boot === "error") break;
    await sleep(100);
  }
  const before = await send("Runtime.evaluate", {
    expression: `(() => ({
      boot: window.__ZUR_BOOT__ || "",
      meters: document.querySelectorAll("[data-meter]").length,
      canvas: Boolean(document.querySelector("canvas#stage")),
      webgl: document.querySelector("canvas#stage")?.dataset.webgl || "",
      version: window.__ZUR_DEBUG__?.shaderHost?.gl?.getParameter(window.__ZUR_DEBUG__.shaderHost.gl.VERSION) || "",
      error: document.getElementById("hud-error")?.textContent || ""
    }))()`,
    returnByValue: true,
  });
  await send("Runtime.evaluate", {
    expression: "document.getElementById('btn-oscillator').click()",
    returnByValue: true,
  });
  // Poll up to 6 s: software rasterizers (SwiftShader) can run the render loop at a few fps.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(200);
    const active = await send("Runtime.evaluate", {
      expression: "[...document.querySelectorAll('[data-meter]')].some((node) => Number(node.dataset.level) > 0.02)",
      returnByValue: true,
    });
    if (active.result.value && attempt >= 5) break;
  }
  const after = await send("Runtime.evaluate", {
    expression: `(() => {
      const debug = window.__ZUR_DEBUG__;
      const levels = {};
      for (const node of document.querySelectorAll("[data-meter]")) levels[node.dataset.meter] = Number(node.dataset.level);
      const diagnostics = debug?.getDiagnostics?.() || null;
      const context = debug?.getAudioContext?.() || null;
      return {
        levels,
        diagnostics,
        contextState: context?.state || null,
        destinationIsContextDestination: context ? diagnostics && context.destination === context.destination : false,
        shaderError: debug?.shaderHost?.error || "",
        hudError: document.getElementById("hud-error")?.textContent || ""
      };
    })()`,
    returnByValue: true,
  });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const png = Buffer.from(shot.data, "base64");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const shotDir = process.env.ZUR_SHOTS || "/workspace/artifacts/screenshots";
  await mkdir(shotDir, { recursive: true });
  await writeFile(`${shotDir}/zur-stage1-oscillator.png`, png);
  const summary = { boot, before: before.result.value, after: after.result.value, logs };
  console.log(JSON.stringify(summary, null, 2));
  const value = after.result.value;
  const levelValues = Object.values(value.levels || {});
  const problems = [];
  if (boot !== "ok") problems.push(`boot ${boot}`);
  if ((before.result.value?.meters || 0) < 7) problems.push("HUD meters missing");
  if (!before.result.value?.canvas) problems.push("canvas missing");
  if (before.result.value?.webgl !== "webgl2") problems.push(`webgl ${before.result.value?.webgl}`);
  if (!String(before.result.value?.version).includes("WebGL 2")) problems.push("WebGL version");
  if (value.diagnostics?.mode !== "oscillator") problems.push(`mode ${value.diagnostics?.mode}`);
  if (value.diagnostics?.silent !== true || value.diagnostics?.destinationConnections !== 0) problems.push("not silent");
  if (value.contextState !== "running") problems.push(`audio ${value.contextState}`);
  if (!levelValues.some((level) => level > 0.02)) problems.push(`meters stayed quiet ${JSON.stringify(value.levels)}`);
  if (problems.length) {
    console.error(problems.join("; "));
    process.exitCode = 1;
  } else {
    console.log("SMOKE PASS");
  }
  ws.close();
} finally {
  chrome.kill("SIGKILL");
  server.close();
}
