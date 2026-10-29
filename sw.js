const CACHE = "zur-shell-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./sw.js",
  "./src/app/main.js",
  "./src/app/AppState.js",
  "./src/audio/AudioEngine.js",
  "./src/audio/FeatureExtractor.js",
  "./src/render/RenderHost.js",
  "./src/render/ShaderHost.js",
  "./src/render/TransitionController.js",
  "./src/controls/ControlHUD.js",
  "./src/controls/palettes.js",
  "./src/scenes/aurora-ribbons.glsl",
  "./src/render/ParticleSystem3D.js",
  "./src/render/particleMath.js",
  "./src/shaders/sim.vert.glsl",
  "./src/shaders/sim.frag.glsl",
  "./src/shaders/render.vert.glsl",
  "./src/shaders/render.frag.glsl",
  "./src/shaders/post.vert.glsl",
  "./src/shaders/trail.frag.glsl",
  "./src/shaders/kaleido.frag.glsl",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html"))),
  );
});
