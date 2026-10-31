# ZUR Frozen Contracts (Stage 1)

Source: Project ZUR Master Blueprint v1.2, Sections 2.2–2.4. These contracts are the Stage 1 surface. Later scenes must consume them instead of inventing parallel audio or render loops.

## Silent capture

`src/audio/AudioEngine.js` is analysis-only. `source` and `analyser` must never connect to `AudioContext.destination`. A runtime guard throws if a connection targets the destination node.

`startTabCapture`, `startMicCapture`, and `startTestOscillator` call `AudioContext.resume()` synchronously, and the media calls also start synchronously, before either promise is awaited:

- Tab: `navigator.mediaDevices.getDisplayMedia`
- Microphone: `navigator.mediaDevices.getUserMedia`
- Oscillator: no media device; five sines at 40, 120, 500, 2000, and 8000 Hz plus a 2 Hz pulse, into the analyser only

Tab constraints:

- `video: true`
- `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`
- `suppressLocalAudioPlayback` from the preset (Mode A default `true`)
- `systemAudio: "exclude"` unless the preset sets `includeSystemAudio`

The video track stays live for the whole tab-capture session. It is played through a muted `<video>` element whose `srcObject` contains only that video track. `stop()` on the video track happens when the whole session stops (`stopCapture`) or when startup fails. The analyser receives `new MediaStream([audioTrack])`.

Microphone constraints:

```js
{
  video: false,
  audio: {
    deviceId: { exact: deviceId }, // omitted for the default device
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 }
  }
}
```

Analyser defaults: `fftSize = 2048` (1024 or 4096 selectable), `smoothingTimeConstant = 0`, `minDecibels = -120`, `maxDecibels = -10`.

## AudioFrame

Every source produces this object once per rendered frame. `timestampSeconds` is `AudioContext.currentTime` while a context is running.

```ts
interface AudioFrame {
  timestampSeconds: number;
  rms: number;
  peak: number;
  sub: number;
  bass: number;
  lowMid: number;
  highMid: number;
  treble: number;
  onset: number;
  beat: number;
  beatConfidence: number;
  isSilent: boolean;
}
```

Stage 1 leaves `beat` and `beatConfidence` at 0. Scenes must tolerate that.

### Bands

Fractional Hz-overlap weights are built only when `sampleRate`, `fftSize`, or the band edges change:

| Band | Hz |
| --- | --- |
| sub | 20–60 |
| bass | 60–250 |
| lowMid | 250–1000 |
| highMid | 1000–4000 |
| treble | 4000–16000 |

FFT window at 48 kHz:

| fftSize | Duration | Bin width |
| --- | --- | --- |
| 1024 | 21.33 ms | 46.875 Hz |
| 2048 | 42.67 ms | 23.4375 Hz |
| 4096 | 85.33 ms | 11.71875 Hz |
| 8192 | 170.67 ms | 5.859375 Hz |

Per bin: non-finite dB becomes -120, then `db = max(-120, rawDb)`, `power = 10^(db/10)`. The band level is the weighted mean power, multiplied by `preAmpGain * preAmpGain`, converted with `10 * log10(max(meanPower, 1e-12))`, then normalized from -85 dB to -10 dB and passed through `clamp01`.

`preAmpGain` is clamped to 1.0–25.0. Mode A defaults to 1. Mode B defaults to 10.

RMS is `sqrt(sumSquares / N) * preAmpGain`. Non-finite samples are skipped. When the right channel is present, energy is `sqrt((rmsL² + rmsR²) / 2)` so opposite polarity does not cancel. `isSilent` becomes true only after post-preamp RMS stays under `noiseGateThreshold` for more than 250 ms.

### Envelopes

`alpha = 1 - exp((-deltaSeconds * 1000) / timeConstantMs)`, using attack when the input rises and release otherwise.

| Envelope | Attack | Release | Drives |
| --- | --- | --- | --- |
| Fast | 10 ms | 90 ms | onset |
| Medium | 25 ms | 180 ms | sub, bass, lowMid |
| Slow | 80 ms | 450 ms | highMid, treble |

Preset `attackMs` / `releaseMs` override the Medium envelope only. Fast and Slow stay frozen. Shipped Mode A and Mode B presets keep Medium at 25/180.

### Onset

Flux is the sum of positive band deltas. A trigger requires flux above an exponential moving threshold (`meanFlux + multiplier * stdFlux`), a minimum flux, and a 120 ms refractory gap. Silence forces onset to 0. The trigger decays through the Fast envelope.

`clamp01(v)` is `Number.isFinite(v) ? min(1, max(0, v)) : 0`. Every numeric AudioFrame field goes through it.

## ScenePlugin

Scene modules must not own a `requestAnimationFrame` loop, an audio listener, or a global DOM listener. Stage 1's only scene is the GLSL module below; the host is the plugin runner.

```ts
interface ScenePlugin {
  id: string;
  version: number;
  init(host): Promise<void> | void;
  resize(width: number, height: number, pixelRatio: number): void;
  update(frame: AudioFrame, timeSeconds: number, deltaSeconds: number): void;
  render(): void;
  applyParameters(parameters: Record<string, unknown>): void;
  dispose(): void;
}
```

## Shader uniforms

`ShaderHost` supplies `#version 300 es`, `precision highp float`, a fullscreen triangle, the ping-pong trail buffers, and `main()`. `src/scenes/aurora-ribbons.glsl` implements only `vec3 renderScene(vec2 uv)`.

```glsl
uniform float u_time;
uniform float u_delta;
uniform vec2  u_resolution;
uniform float u_rms;
uniform float u_sub;
uniform float u_bass;
uniform float u_mid;        // average of lowMid and highMid
uniform float u_high;       // treble
uniform float u_onset;
uniform float u_beat;
uniform vec3  u_palette[5]; // linear RGB
uniform float u_gain;       // 0.1..5
uniform float u_complexity; // 0.25..1
```

Trail history uses `decay = pow(0.5, (u_delta * 1000.0) / trailHalfLifeMs)` as the weight of the previous frame: `mix(scene, history, decay)`. A static frame stays at the scene's own brightness, and motion fades with that half-life at both 30 and 60 fps.

`webglcontextlost` calls `preventDefault()` and pauses the render loop. `webglcontextrestored` recompiles the shader and reallocates framebuffers. The audio graph is left running.

Aurora favors thick smooth ribbons (bass width, mid curvature, treble highlights) so a Discord encode does not macroblock 1 px noise.

## Preset Schema v1

Presets are JSON data. `validatePreset` rejects functions and out-of-range numbers.

```json
{
  "schemaVersion": 1,
  "sceneId": "aurora-ribbons",
  "sceneVersion": 1,
  "audio": {
    "inputMode": "tab-capture",
    "suppressLocalAudio": true,
    "includeSystemAudio": false,
    "preAmpGain": 1.0,
    "masterGain": 1.0,
    "bandGain": { "sub": 1.0, "bass": 1.2, "lowMid": 0.8, "highMid": 0.7, "treble": 0.5 },
    "attackMs": 15,
    "releaseMs": 180
  },
  "visual": {
    "paletteId": "copper-teal",
    "hueShift": 0.0,
    "bloom": 0.35,
    "trailHalfLifeMs": 220,
    "cameraShake": 0.05,
    "complexity": 0.5
  },
  "transition": {
    "mode": "timer-then-onset",
    "minimumDwellSeconds": 45,
    "blendSeconds": 2
  }
}
```

Stage 1 hardware fields live on `visual`: `width`, `height`, `fps`, `qualityTier`, `gain`. `audio.fftSize` is 1024, 2048, or 4096. `audio.inputMode` is `tab-capture`, `microphone`, or `oscillator`. `transition.minimumDwellSeconds` cannot be below 45.

| Preset | Input | Pre-amp | Frame |
| --- | --- | --- | --- |
| Mode A PC Silent Monitor | tab capture, local playback suppressed, system audio excluded | 1× | 1280×720 @ 30 fps, complexity 0.35, tier `safe` |
| Mode B A57 Call Speaker | raw mic (`echoCancellation` / `noiseSuppression` / `autoGainControl` false) | 10× | 1280×720 @ 60 fps, complexity 0.65, tier `motion` |

## Quality tiers

| Tier | Name | Size | FPS | Complexity | Raymarch ceiling |
| --- | --- | --- | --- | --- | --- |
| 1 | Safe Baseline | 1280×720 | 30 | 0.35 | 32 |
| 2 | Motion Target | 1280×720 | 60 | 0.65 | 48 |
| 3 | Enhanced | 1600×900 | 60 | 0.85 | 64 |
| 4 | High | 1920×1080 | 60 | 1.0 | 80 |

Aurora does not raymarch. The ceilings are reserved for later SDF scenes. The uniform complexity floor remains 0.25.

## Wake lock

On startup, on the first capture gesture, and whenever `document.visibilityState === "visible"`, the page calls `navigator.wakeLock.request("screen")` and keeps the released sentinel from blocking a later reacquire.

## Render loop

One `requestAnimationFrame` loop in `RenderHost` caps FPS from the preset, sets the drawing buffer to the tier size, and samples the analyser only on rendered frames. `TransitionController` uses `timer-then-onset` with a 45 s dwell. Stage 1 has a single scene, so a passed gate does not swap shaders.

# Stage 2 Contracts (ZUR-GH-002)

Source: ZUR Blueprint v2.1 Part 4 and the ZUR-GH-002 ticket. Stage 2 adds a second scene; every Stage 1 contract above still holds (silent AudioEngine, FeatureExtractor, Wake Lock, PWA, `aurora-ribbons.glsl`).

## Scenes

`preset.sceneId` is `particle-swarm-3d` (Stage 2 default) or `aurora-ribbons` (Stage 1). `RenderHost` draws the particle scene only when `ParticleSystem3D` is ready; otherwise it falls back to aurora. Mode A / Mode B keep the current scene and particle settings (`applyModeKeepingScene`).

## Preset `particles` (optional)

| Field | Values |
| --- | --- |
| `flowMode` | `fluid`, `gas`, `murmuration`, `fish` |
| `shape` | `dart` (12-vertex 3D dart), `capsule` (4-vertex velocity capsule) |
| `particleSize` | 0.5 – 4.0 (× base size) |
| `kaleidoSegments` | 0 (off), 4, 6, 8, 12, 16 |
| `kaleidoSpin` | boolean — beat-synced rotation |
| `particleCountTier` | `auto`, 64, 128, 256, 512, 1k, 2k, 4k, 16k, 32k, 64k (default `1k`); Stage 3 also adds densityAutoScale, trailLength, trailType, formationType, oscillationType, oscillationAmount, oscillationSpeed, pulseLayout |

Settings persist in `localStorage["zur_state_v3_2"]` (older keys migrate, see Stage 3.2) and in the URL as `?preset=scene:particles_flow:fish_shape:dart_size:1.5_k:6_spin:1_count:auto` (a bare flow name such as `?preset=gas` also works). URL state wins over storage on load.

## Transform-feedback state

- Two preallocated interleaved Float32 VBOs (`gl.DYNAMIC_COPY`), 65,536 agents × 32 bytes: `vec4 a_pos` (xyz + size/seed) at location 0, `vec4 a_vel` (xyz + phase/life) at location 1.
- Update VAOs use divisor 0 with `RASTERIZER_DISCARD`; render VAOs use divisor 1 with `drawArraysInstanced`.
- After `endTransformFeedback()` the code unbinds `TRANSFORM_FEEDBACK` and `bindBufferBase(TRANSFORM_FEEDBACK_BUFFER, 0, null)` before the buffer is read as vertex input.
- Fixed `1/60 s` steps, at most 4 per frame. Drag uses the exact frozen-force integrator (`integrateFrozenDrag`) with a Taylor fallback when `|k·dt| < 1e-3`. Ticket damping factors (fluid 0.985, gas 0.94 per step) are converted to continuous rates.
- Murmuration / fish read a 6-neighbor topological ring (id ± 1..3) from an RGBA32F texture filled GPU-side from the read buffer through `PIXEL_UNPACK_BUFFER`. There is no CPU readback in the loop.
- Auto tier: 65,536 on desktop, 16,384 on mobile. It halves after 2 one-second windows under the step-down threshold (50 fps at a 60 fps cap, 25 at Mode A's 30 fps cap). A window under half the threshold quarters it immediately. It never drops below 4,096.

## Flow modes (`src/shaders/sim.vert.glsl`)

| Mode | Forces |
| --- | --- |
| Fluid | unnormalized analytic simplex curl (divergence-free) + laminar swirl about Y + bass × onset radial impulse; retention 0.985 |
| Gas | 2-octave high-frequency curl + thermal buoyancy (life/heat + onset) + treble burst dispersion + respawn at the base; retention 0.94 |
| Murmuration | curl flow + 5 Lissajous attractors with retarded-time delay + causal Gaussian predator shockwaves (4-slot ring, onset-triggered or ambient every 7 s in silence) + ring separation/alignment/cohesion |
| Fish | horizontal banking torus + tangential swim + random darting bursts + strong ring alignment + `u_high` lateral shimmer |

## Rendering

- Pass 1 (scene FBO, RGBA16F when renderable, RGBA8 fallback, `DEPTH_COMPONENT24`): the trail fade (`ONE, ONE_MINUS_SRC_ALPHA`, alpha `1 − exp(−dt/τ)`) is followed by additive particles. Particle radiance is scaled by `(1 − E) / (1 − exp(−1/(60τ)))` so 30 fps and 60 fps glow match, and depth is invalidated afterward.
- Darts use a singularity-free `velocityFrame` (the up hint blends away from +Y when `|forward.y|` is between 0.85 and 0.99) with face-normal rim lighting. Capsules are screen-space velocity-stretched SDFs with `fwidth` antialiasing. Both keep the capture-space radius floor `1.6 px × H/720 / max(zoom, 0.25)` and hash32 ID thinning (75% visible at tier `safe`).
- Pass 2 (default framebuffer): an aspect-correct polar N-fold mirror kaleidoscope (`u_kaleidoSegments ≤ 1` is a 1:1 bypass) runs first, then `c / (1 + c)` tone mapping, then a single sRGB encode.

## Tests

- `node tests/verify-contracts.mjs`: Stage 1 and Stage 2 math and source contracts.
- `node tests/smoke-headless.mjs`: Stage 1 headless oscillator smoke.
- `node tests/smoke-stage2.mjs`: serves `http://localhost:8080` and checks that the TF and render programs link with empty info logs, that TF advances state, that all 4 modes, 4 sizes and 6 kaleidoscope settings render non-black with 0 GL errors, 0 `console.error` and 0 page errors, and that persistence and `?preset=` work. The FPS gate (≥ 55 fps) is enforced on hardware GPUs. On software rasterizers (SwiftShader) it is report-only unless `ZUR_STRICT_FPS=1`.

## Stage 3.2 — neon saturation, XY formations, HUD viewport (ZUR-GH-004)

### Storage migration

- Key `zur_state_v3_2`, payload `{ "storageSchema": 3.2, "preset": <preset> }`. On load the key is read first, then the legacy keys `zur_state_v3`, `zur_state_v2`, `zur_state_v1`, `zur.preset.v2`, `zur.preset.v1` (bare presets, schema 0).
- Any payload with `storageSchema < 3.2`, or a cached `paletteId === "copper-teal"`, is force-upgraded to `paletteId: "neon-tunnel"`, `particleCountTier: "2k"`, `particleSize: 1.35`, `trailLength: 0.28`, `trailType: "comet"`. `copper-teal` stays available for Mode A/B presets but is never the migrated default.
- With no stored state the Stage 3 defaults still apply.

### Neon palettes

`neon-tunnel`, `cyber-laser`, `solar-plasma`, `biolum-ocean` and `emerald-matrix` have HSV saturation ≥ 0.85 on every stop and no `#FFFFFF` stop (the 5th stop is hyper-saturated neon such as `#FF00FF`, `#00FFFF` or `#39FF14`).

### Bounded radiance (RGBA8 FBO safe)

- `crowdNorm = 1 / (1 + 0.32 · u_particleSize² · sqrt(max(u_activeCount, 64) / 1024))` (`render.frag.glsl`, mirrored by `crowdNorm()` in `particleMath.js`). `u_particleSize` and `u_activeCount` are render uniforms.
- Sprite profile: `halo = exp(-r² · 4.5)` keeps 100% saturated palette colour; the white-hot core is a pinprick `core = exp(-r² · 42) · 0.30`.
- Velocity Capsule: premultiplied blend `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`, alpha `halo · 0.40 · crowdNorm`, colour scaled by the same alpha. Darts stay additive (`ONE, ONE`).
- Dart shading is chromatic: `dartColor = paletteColor · (0.45 + 0.85 · normalShade) + paletteColorSecondary · (0.65 · rim)`; there is no white/grey specular.
- Post pass: the grey component `min(r,g,b)` is attenuated before the tone map so overlapping hues stay electric.

### Camera-facing formations (`sim.vert.glsl`)

`formationType == 1` (neon-tunnel) and `== 2` (polygon-rings) live in the XY plane: `pos.xy = ringRadius * vec2(cos(theta), sin(theta))`, streaming along Z toward the camera with a ~12° perspective tilt. The formation spring dominates the flow mode (flow forces ×0.15) and ring angles derive from the agent seed, not the flow `phase`.

### Kaleidoscope clamp fix (`kaleido.frag.glsl`)

When `u_kaleidoSegments > 1`: mirrored polar radius `r = 1.0 - abs(fract(r · 0.5) · 2.0 - 1.0)` and outer vignette `smoothstep(1.12, 0.82, rawRadius)`, so FBO border pixels never stretch into corner rays.

### `u_viewportYOffset`

- `float`, NDC units, declared in `render.vert.glsl` (`gl_Position.y += u_viewportYOffset * gl_Position.w`) and `kaleido.frag.glsl` (fold centre), set from `ParticleSystem3D.js`.
- `RenderHost` computes the target: `+0.38` while the HUD drawer is open AND the viewport is portrait (`height > width`), otherwise `0.0`, and glides toward it exponentially (`stepViewportYOffset`, rate 7 s⁻¹). The swarm therefore centres in the visible upper viewport above the drawer and recentres smoothly when the HUD is hidden.
- HUD: Scene, Palette and Hue shift sit at the top; the sticky `[▼ Hide HUD / Fullscreen]` button and a tap on the canvas toggle the drawer; `Pulse field layout` is hidden unless `sceneId === "pulse-field-3d"`.

### Tests

- `node tests/smoke-stage3.2.mjs`: Galaxy A57 portrait `412×915` (port 8082) — chromatic saturation `mean(max(R,G,B) − min(R,G,B)) > 0.35` on non-black pixels, Velocity Capsule `particleSize 3.5` at 16k `meanLuminance < 0.75`, tunnel/rings `verticalSpanRatio > 0.45`, kaleidoscope 4/6/8/12/16, viewport offset glide, and 0 console/page/WebGL errors with `destinationConnections === 0`. Screenshots go to `ZUR_SHOTS` (default `/workspace/artifacts/zur-stage3.2`).

## Stage 4 — ZUR-GH-005

### Particle systems

- `FLOW_MODES` appends `physarum` (`u_mode == 4`), a three-sensor chemotaxis mode. The left/forward/right sensors use ±0.45 radians and 0.14 world-unit lookahead against three analytic cellular-ridge octaves; `u_onset` changes the branch jitter. `sim.vert.glsl` never samples a scene framebuffer.
- `FORMATION_TYPES` appends `fractal-core` and `logo-attractor`. Logo targets are vec4 points from a 512×128 browser canvas; Node uses the deterministic 5×7 bitmap fallback. `aLogoTarget` is location 2 on both update VAOs with divisor 0; render VAOs do not enable it.
- The `megastructure-3d` Pass 1 draws a bounded Mandelbulb before the particle swarm. Its marcher uses 16 steps in Tier 1 and 24 in higher tiers, and uses the five palette stops. A matching analytic core SDF pushes particles outside and reflects their velocities. No scene-color texture is read by the update shader.
- `spectral-canyon-3d` is a `SpectralCanyon3D` ScenePlugin with `init`, `resize`, `render`, and `dispose`. It writes one 128×1 row per frame into its 128×64 waterfall texture. Rows use live FFT bins, or a smoothed five-band curve; canyon terrain and Scene 3 wave-grid pitch are 32°.

### Post-FX, camera and autopilot

- Camera modes are `static`, `orbit-3d` (default), `tunnel-fly`, and `beat-bank`.
- `chromaticAberration` and `godRays` are 0..1 controls, defaulting to 0.30 and 0.35. Kaleidoscope post uses three radial RGB samples and six additive shaft samples (nine `u_scene` reads maximum, without nested loops).
- `vjAutopilot` defaults false. When enabled it cycles Breakdown → Build-Up → Drop at 12-second dwell intervals, applies a neon palette/formation/kaleidoscope combination, and adds a shockwave on Drop. Manual HUD pointer interaction pauses the cycle for 45 seconds.

### Persistence and offline shell

- Persisted state uses `zur_state_v4_0` / schema 4.0 and reads older keys. The `zur_v4_neon_forced` one-time flag resets a cached copper-teal palette to neon-tunnel with hue shift 0.
- The `zur-shell-v5` worker skips waiting, claims clients, and uses network-first for `.html`, `.js`, and `.glsl` resources.

### Stage 4 checks

- `node tests/verify-contracts.mjs` contains 75+ passing contract checks for state, shaders, plugin lifecycle, logo fallback, post sample budget, and autopilot timing.
- Existing browser smoke tests remain available as `npm run smoke`, `npm run smoke:stage2`, `npm run smoke:stage3`, and `npm run smoke:stage3.2`.

## ZUR-GH-007 — Stage 4 visual & geometry fixes (Galaxy A57 7-minute capture on `0c8966a`)

- **Shared optical centre.** `core.frag.glsl` (megastructure raymarcher), the swarm (`render.vert.glsl`
  `gl_Position.y += u_viewportYOffset * w`) and `kaleido.frag.glsl` all use NDC `(0.0, u_viewportYOffset)` =
  uv `(0.5, 0.5 + 0.5 * u_viewportYOffset)` (`opticalCenterUv()` in `particleMath.js`): `+0.38` with the portrait
  HUD drawer open, `0.0` when hidden. `ParticleSystem3D` sets `u_viewportYOffset` on the core program, so 4/6/8/12/16
  mirrors fold around the core instead of over empty space.
- **Fractal Core formation** (`u_formationType == 4`): `fractalCoreTarget()` — per-agent golden-spiral sphere
  (`theta = i * 2.39996323`, `phi = acos(1 - 2i/n)`), five counter-rotating tilted orbital planes (`uid % 5`),
  depth layers, audio breathing that dives into the `sdCore()` valleys, and 30% lobe streams flowing out along the
  7 lobes. Flow force is scaled by 0.25 so the volume holds; X/Y/Z spread is equal from every orbit angle.
- **Logo Attractor** (`u_formationType == 5`): oscillation on glyph targets scaled by `LOGO_OSCILLATION_SCALE = 0.08`;
  `effectiveTrailLength()` clamps the trail to `LOGO_TRAIL_LENGTH_MAX = 0.2` (fade + capsule stretch); glyph plane
  billboarded onto the camera via `u_billboardRight` / `u_billboardUp` (`billboardBasis()`); the murmuration/fish
  minimum-speed clamp is released (`lo = 0`) so agents settle on their glyph pixels.
- **HUD:** `Logo / Attractor Text` select (`sel-attractor-preset`: AI: UNDERGROUND, MON DAAIN, TENTH GATE, ZUR,
  Custom…) sits directly under `Formation`, visible only while Logo Attractor is active; `txt-attractor` is the
  custom input (shown for Custom…).
- **Spectral Canyon 3D** rewritten as a raycast synthwave canyon: flat floor + twin walls (`wallMask(abs(x))`),
  `z` scroll `u_time * 2.5`, x-frequency ridges displaced by `u_waterfallTex` + `u_bands[5]` (sub→treble across
  |x|), anti-aliased grid (`GRID_SPACING = 0.5`) on floor and walls, striped palette sun, fog to `u_palette[1]`.
  Every colour is from `u_palette[0..4]`, sRGB-encoded, luma-capped by `guardNeon()` (`LUMA_CAP = 0.86`): no white.
- **Tests:** `tests/smoke-zur-gh-007.mjs` (`npm run smoke:gh007`) at 412×915 — core disk lit inside 0/4/8/16 mirrors
  (HUD open + hidden), fractal-core GPU axis-spread ratio > 0.55 and lit width > 0.35 at a 90° orbit, logo agents on
  target + ≥ 6 glyph runs under Oscillation 3.00 + Comet 0.81, canyon ≥ 35% upper-viewport pixels with
  0.15 < luma < 0.90, ≥ 12 grid crossings and max luma < 0.90.
