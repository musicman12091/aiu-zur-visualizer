# ZUR STATE

Stage ledger for `musicman12091/aiu-zur-visualizer`.

## Stage 1 — ZUR-GH-001

- status: squash-merged to `main`
- merged_to_main: yes
- main_commit_sha: 052dc4fa1d38ff82106da4fa1c9c938ebd798b21
- PR: https://github.com/musicman12091/aiu-zur-visualizer/pull/1 (merged)
- implementation_commit_sha: dd47857b49d8311afcaffe4c7740cbf214f47c69
- branch: `cursor/zur-stage1-4553` (squash-merged)
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- pages_status: live
- pages_enabled: yes
- pages_source: main / (root)
- pages_verified_http: 200 at https://musicman12091.github.io/aiu-zur-visualizer/ (2026-10-27)
- tests: `node tests/verify-contracts.mjs` 19 passed; headless Chrome smoke passed; `destinationConnections` 0
- contract_tests: PASS — `node tests/verify-contracts.mjs` (19 passed)
- headless_chrome: PASS — page boot, 7 HUD meters, WebGL2 canvas, silent test oscillator driving sub/bass/lowMid/highMid/treble/RMS with `destinationConnections: 0`

Headless Chrome 156 (SwiftShader) loaded `index.html`, compiled `aurora-ribbons.glsl`, and clicked Test Oscillator. Capture mode was `oscillator`, `AudioContext` state was `running` at 44100 Hz, fftSize 2048, and the analyser was not connected to `destination`. Wake Lock is requested with `navigator.wakeLock.request("screen")` and re-acquired on `visibilitychange` when the document becomes visible.

## Stage 2 — ZUR-GH-002

- status: squash-merged to `main` — COMPLETE
- merged_to_main: yes
- pr_branch: `zur-stage2`
- pr_branch_head_sha: 982ac3d (fix(zur): empty shockwave slots at startup; restrict preset sceneId to SCENE_IDS)
- main_commit_sha: db5fad4c846afb1a3d79c1917d4bbdc8760f5428
- state_docs_commit_sha: f45288a795b884649b502f557fd6191180819384
- PR: https://github.com/musicman12091/aiu-zur-visualizer/pull/2 (merged, squash)
- branch: `zur-stage2` (built in `/workspace/aiu-zur-visualizer`, no Cloud Agent, no `cursor/*` branch)
- copilot_review_fixes: (1) negative sentinel / empty `uShockwaves` at startup; (2) `SCENE_IDS` validation rejects unsupported `?preset=` scene IDs
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- pages_status: live (Stage 2 assets)
- pages_source: main / (root)
- pages_verified_http: 200 at index, `ParticleSystem3D.js`, `sim.vert.glsl`, `kaleido.frag.glsl` (2026-10-28 America/Regina; Last-Modified Thu, 29 Oct 2026 00:49:36 GMT)
- pages_live_chrome: PASS — headless Chrome against live github.io (`?debug=1`): boot ok, scene `particle-swarm-3d`, TF varyings 2, flow modes fluid/gas/murmuration/fish non-black, kaleidoscope 0/4/6/8/12/16 non-black, `console.error` 0, `pageerror` 0, WebGL errors 0, `destinationConnections` 0, Test oscillator capture
- scope: WebGL2 transform-feedback particles (65,536 desktop / 16,384 mobile, auto step-down), Fluid / Gas / Murmuration / School of Fish flow modes, instanced 3D darts and velocity capsules with rim lighting, a scene FBO with frame-rate-independent trails, the N-fold kaleidoscope (Off/4/6/8/12/16, beat-synced spin) with `c/(1+c)` tone mapping, HUD controls, and `localStorage` plus `?preset=` persistence
- Stage 1 preserved: AudioEngine, FeatureExtractor, Wake Lock, PWA and `aurora-ribbons.glsl` unchanged. Aurora is still a selectable scene.
- contract_tests: PASS — `node tests/verify-contracts.mjs` (38/38 passed: Stage 1 + Stage 2 + Copilot review fixes)
- node_check: PASS — every `.js` / `.mjs` file
- headless_chrome_stage1: PASS — `node tests/smoke-headless.mjs` (silent oscillator, `destinationConnections` 0)
- headless_chrome_stage2: PASS — `node tests/smoke-stage2.mjs` on `http://localhost:8080`. All 4 programs linked with empty info logs, there were 2 interleaved TF varyings, buffers were 2,097,152 bytes `DYNAMIC_COPY`, TF advanced state, the scene FBO was RGBA16F, all 4 flow modes, 4 sizes and 6 kaleidoscope settings rendered non-black with 0 GL errors, `console.error` was 0, `pageerror` was 0, auto tier stepped down 65,536 → 4,096, and URL plus localStorage persistence worked.
- fps: the ≥ 55 fps gate is report-only on this box because it has no GPU and headless Chrome uses the SwiftShader CPU rasterizer. Stage 1 aurora alone runs at about 21 fps there, and the particle scene at 16,384 ran at about 5 fps. Run `ZUR_STRICT_FPS=1 node tests/smoke-stage2.mjs` on a GPU machine to enforce the gate.
- Copilot review: fixed shockwave ring buffer empty at startup; unsupported scene IDs rejected via `?preset=`.


## Stage 3 — ZUR-GH-003

- status: squash-merged to `main` — COMPLETE
- merged_to_main: yes
- pr_branch: `zur-stage3`
- pr_branch_head_sha: 2f30e0ed1b0407a68285ca5487ee2f35a042b3b5 (feat + Copilot review URL-preset fix)
- main_commit_sha: 3c2e891b4290d5d0264a97f82f1281cf015d7aa5
- PR: https://github.com/musicman12091/aiu-zur-visualizer/pull/3 (merged, squash)
- branch: `zur-stage3` (built in `/workspace/aiu-zur-visualizer` with GitHub Copilot Pro Claude Sonnet 5.5; no Cloud Agent, no `cursor/*` branch)
- copilot_review_fixes: (1) clarified audited `densityTrailScale` JSDoc (v3.1 low-count → shorter trails); (2) `?preset=` encode/decode round-trips Stage 3 keys (`das`/`tl`/`tt`/`form`/`osc`/`oa`/`os`/`pl`)
- scope: portrait-aware Pass 1 FBO + Hor+ projection; neon comet SDF + chroma-preserving tonemap; default palette `neon-tunnel`; count tiers 64…64k (default `1k`) + `densityAutoScale`; `trailLength`/`trailType`; `formationType`/`oscillationType`; Scene 3 `pulse-field-3d` (`band-clouds`/`geodesic-sphere`/`wave-grid`)
- contract_tests: PASS — `node tests/verify-contracts.mjs` (45/45)
- headless_chrome_stage3: PASS — `node tests/smoke-stage3.mjs` (0 console/page/WebGL errors, `destinationConnections` 0, portrait FBO 576×1280 at 450×1000)
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- pages_status: live (Stage 3 assets)
- pages_verified_http: 200; `particleMath.js` serves `pulse-field-3d` / `neon-tunnel` (Last-Modified Thu, 29 Oct 2026 03:11:02 GMT)
- pages_live_chrome: PASS — live github.io `?debug=1`: `pulse-field-3d` + `geodesic-sphere`, palette `neon-tunnel`, count `1k`, formation `neon-tunnel`, osc `helix`, `destinationConnections` 0, console/page errors 0

## Pages

Pages is enabled and serving Stage 3 from the `main` branch root (`/`). https://musicman12091.github.io/aiu-zur-visualizer/ returned HTTP 200 on 2026-10-28 (America/Regina) with Stage 3 markers (`pulse-field-3d`, `neon-tunnel`). Live headless Chrome smoke against github.io passed with 0 console/page/WebGL errors and `destinationConnections` 0.

## Stage 3.2 — ZUR-GH-004 (merged)

- commit_sha (main, squash): `4cbf1f5c7b436fa6129a7b94befe772027b94755` — PR https://github.com/musicman12091/aiu-zur-visualizer/pull/4 (branch `zur-stage3.2` heads `5ef3a6e` Copilot codegen + `7a03321` smoke harness hardening; branch deleted)
- Six fixes: `zur_state_v3_2` migration (copper-teal / pre-v3.2 → neon-tunnel, 2k, 1.35, 0.28, comet); neon palettes all stops HSV sat ≥ 0.85, no `#FFFFFF`; Palette + Hue shift under Scene, sticky "▼ Hide HUD / Fullscreen" + tap-canvas toggle, Pulse field layout hidden unless `pulse-field-3d`; bounded `crowdNorm` radiance, premultiplied capsules (alpha 0.40·crowdNorm), pinprick core exp(-r2·42)·0.30; chromatic dart3d shading; camera-facing XY tunnel/rings with 12° tilt; kaleido mirrored radius fold + smoothstep(1.12, 0.82) vignette; `u_viewportYOffset` (+0.38 portrait drawer open, lerped to 0).
- Contracts: `node tests/verify-contracts.mjs` → 61 passed (was 45).
- Headless Chrome 412×915 (`tests/smoke-stage3.2.mjs`, SwiftShader): PASS — mean chroma 0.38–0.49 (> 0.35), Velocity Capsule 3.5× @16k meanLuminance 0.156 (< 0.75), neon-tunnel verticalSpanRatio 0.592 / polygon-rings 0.595 (> 0.45), console.error 0, pageerror 0, WebGL errors 0, destinationConnections 0. `smoke-stage3`, `smoke-stage2`, `smoke-headless` PASS.
- Pages: https://musicman12091.github.io/aiu-zur-visualizer/ HTTP 200 on 2026-10-29 (America/Regina), build `built` at `4cbf1f5`; live markers `zur_state_v3_2`, `u_viewportYOffset`, `crowdNorm`, neon palette stops, `zur-shell-v4`.
- No `@copilot` PR review (parked). Codegen offloaded to Copilot CLI `claude-sonnet-5.5`.

## Not in this stage

`musicman12091/aiu-dj-player` was not modified. Further scenes and the Butterchurn adapter are later stages.

## Stage 4 — ZUR-GH-005 (merged)

- status: squash-merged to `main` — COMPLETE
- commit_sha (main, squash): `aff89982c8864079397db39f690a6530abd2b22f` — PR https://github.com/musicman12091/aiu-zur-visualizer/pull/5 (branch `copilot/zur-stage4` heads through `a313045` greenlight fixes; branch deleted)
- Ori 6-point pre-merge audit: PASS A–F (VAO dual logoTargetVBO, analytic physarum / no FBO feedback, ≤9 kaleido taps, `zur-shell-v5` + `zur_state_v4_0`, HUD/scenes/autopilot, contracts+smoke). No `@copilot` PR review.
- Greenlight fixes on merge head: Mode/blueprint presets default `neon-tunnel` (`hueShift: 0`); `logo-attractor` floors active agents at 16,384 with pull 16 / damp 5.5 / curl×0.05.
- scope: Physarum Neural Web; fractal-core + megastructure-3d Mandelbulb; logo-attractor dual-VAO; spectral-canyon-3d waterfall; cameraMode + CA/GodRays ≤9 taps; VJAutopilot.
- state: `zur_state_v4_0` / schema 4.0, `zur_v4_neon_forced`, `zur-shell-v5` Network-First for navigations / `.html` / `.js` / `.glsl`.
- contracts: `node tests/verify-contracts.mjs` → 86 passed (was 61 at Stage 3.2).
- headless: `tests/smoke-stage3.2.mjs` @ 412×915 PASS — console.error 0, pageerror 0, WebGL warnings 0; Stage 4 scenes included.
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- pages_verified_http: 200 on 2026-10-30 (America/Regina); live markers `zur_state_v4_0`, `zur-shell-v5`, Mode presets `neon-tunnel` (Last-Modified Fri, 30 Oct 2026 22:00:44 GMT).

## Hotfix — ZUR-GH-006 (merged)

- status: squash-merged to `main` — COMPLETE
- commit_sha (main, squash): `0c8966acf97e5d369ba9434ad4e914f41664bf2e` — PR https://github.com/musicman12091/aiu-zur-visualizer/pull/6 (branch `fix/zur-gh-006` head `fdeca8f`; branch deleted)
- Fixes (Galaxy A57 `aff8998` recording):
  1. `spectral-canyon-3d` rewritten as dark obsidian sky (upper ~35% luma ≪ 0.05) + glowing 64×64 neon wireframe/ridge grid with idle baseline wave when `frame.isSilent` / CAPTURE IDLE, and audio frequency peaks when live.
  2. Stage 3 · 3D swarm HUD hidden unless `particle-swarm-3d` / `megastructure-3d` / `pulse-field-3d` (hidden on spectral-canyon & aurora).
  3. Prominent Mic / Test oscillator prompt under status pills while `capture === "idle"`.
- Spatial-contrast smoke gate: `minLuma < 0.08`, `maxLuma > 0.55`, `lumaStdDev > 0.14` for spectral-canyon + megastructure (flat gradient walls cannot pass).
- contracts: `node tests/verify-contracts.mjs` → 89 passed.
- headless: `tests/smoke-stage3.2.mjs` @ 412×915 PASS — spectralCanyon minLuma≈0.008 maxLuma=1.0 lumaStdDev≈0.160 skyMaxLuma≈0.008; megastructure stdDev≈0.198; console/page/WebGL 0.
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- Ori audit: direct `/workspace` patch (no Cursor Cloud Agent, no Copilot CLI wait). No `@copilot` PR review.

## Fix — ZUR-GH-007 (Stage 4 visual & geometry) (merged)

- status: squash-merged to `main` — COMPLETE
- commit_sha (main, squash): `c45065fd7481e008e3a8ae1abb7ceb5a9069f294` — PR https://github.com/musicman12091/aiu-zur-visualizer/pull/7 (branch `fix/zur-gh-007` head `c6c27e1`; branch deleted)
- Fixes (Galaxy A57 7-minute capture on `0c8966a`, sheets `ZUR_v40_Sheet_01..06`):
  1. Kaleidoscope no longer wipes the megastructure core: `core.frag.glsl` + `ParticleSystem3D` share the kaleido optical centre `(0.0, u_viewportYOffset)`.
  2. `fractal-core` = 3D multi-orbital golden-spiral volumetric shell + 7 lobe streams with audio breathing into SDF valleys (no planar ring).
  3. `logo-attractor`: oscillation × 0.08, trail clamped to 0.2, camera billboard, agents settle (lo = 0); HUD `Logo / Attractor Text` selector under Formation.
  4. `spectral-canyon-3d`: synthwave raycast floor + twin walls, `u_time * 2.5` scroll, waterfall + 5-band ridges, palette-only + luma cap.
- Ori audit: direct `/workspace` patch (no Cursor Cloud Agent, no `cursor/*`, no Copilot CLI wait, no `@copilot` PR review).
- contracts: `node tests/verify-contracts.mjs` → 101 passed (was 89).
- headless @ 412×915 (SwiftShader): `tests/smoke-zur-gh-007.mjs` PASS — megastructure core disk lit 1.00 at 0/4/8/16 mirrors (HUD open, offset 0.38) and 16 mirrors HUD hidden (offset 0); fractal-core GPU axis std ≈ 1.65/1.66/1.63 (ratio 0.98), lit width 0.76 at a ~92° orbit; logo `MON DAAIN` agents settle (median target error < 0.06), ≥ 6 glyph runs under Oscillation 3.00 + Comet 0.81, billboarded; canyon upper-viewport mid-luma 0.69 (HUD open) / 0.51 (hidden), grid crossings 35 / 37, max luma 0.62. `tests/smoke-stage3.2.mjs` + `tests/smoke-headless.mjs` PASS; console/page/WebGL 0.
- known pre-existing: `tests/smoke-stage2.mjs` (localStorage particles) + `tests/smoke-stage3.mjs` (default-key drift) fail identically on `1760b29` main — stale vs Stage 4 defaults, not touched here.
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/ — HTTP 200; live markers verified (core `0.5 + 0.5 * u_viewportYOffset`, `fractalCoreTarget`, `LOGO_OSCILLATION_SCALE`, `sel-attractor-preset`, canyon `SCROLL_SPEED = 2.5` + `guardNeon`).
