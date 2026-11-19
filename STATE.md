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

## Fix — ZUR-GH-008 (Stage 4.2 high-trail chroma guard, formation ghosting clear, dart3d seams)

- status: squash-merged to `main` — COMPLETE
- commit_sha (main, squash): `8a356583320f2074489684ff0e98745995fe1b37` — PR https://github.com/musicman12091/aiu-zur-visualizer/pull/8 (branch `fix/zur-gh-008` head `34f14e3`; branch deleted)
- branch: `fix/zur-gh-008` (direct `/workspace` patch; no Cursor Cloud Agent, no `cursor/*`, no Copilot CLI wait, no `@copilot` PR review)
- pre-flight: `ZUR_v41_Sheet_01..08.jpg` were not present in `/workspace` or Google Drive (search `name contains 'ZUR_v41'` returned nothing); sheets 01–05 could not be re-inspected — proceeded with the 4 coded fixes from the ticket.
- Fixes:
  1. Steady-state trail energy: keep capped at 0.90 for >= 16k agents, `u_trailEnergyNorm = clamp((1 - k) / 0.45, 0.18, 1)` on dart + premultiplied capsule radiance/alpha, `sizeNorm` on the hot core above 1.5x; kaleido chroma-preserving peak tone map + high-luma chroma floor (sat 0.6; megastructure core specular exempt via `u_coreSpecular`).
  2. Formation / flow / scene change: 250 ms trail clear window, keep <= 0.45 (`TrailTransitionGuard` in `PostProcessPass.js`).
  3. Dart3D: particle splat runs with `gl.disable(gl.DEPTH_TEST)` + `gl.depthMask(false)`; `invariant gl_Position` + shared-index vertices.
  4. School of Fish: 6 bait-ball leaders, Y offsets sum to zero. Gas: toroidal circulation + radial curl + Y / spherical wrap.
- Ori audit: pre-merge `git diff` + shader audit in `/workspace` (no `@copilot` review). Megastructure first lost contrast under the floor (stage3.2 `lumaStdDev` 0.139 vs 0.14 gate; main 0.224). Fixed by gating the white shoulder + floor with `u_coreSpecular` (megastructure only); after the fix stage3.2 reads 0.235 / max luma 0.90.
- contracts: `node tests/verify-contracts.mjs` → 105 passed (was 101).
- headless @ 412×915 (SwiftShader): `tests/smoke-zur-gh-008.mjs` PASS. At 64k + Trail 1.00 + size 3.35x + 3D Fish/Bird Dart + God rays 0.35, across free-3d / supernova-shell × murmuration / fish / gas / fluid: whiteClip 0.00%, nearWhite 0.00%, meanSat 0.689–0.711. The pre-fix baseline on `07821e6` was meanSat 0.358–0.493 with a white-lavender wash. Megastructure stress: whiteClip 0%, nearWhite 0.78%. Formation switch Polygon Rings → Supernova Shell at Trail 0.76: 1 transition, keep 0.45 inside the window, 0.832 after it. GPU readback: fish 50.5% above Y = 0 (mean Y 0.006); gas central-column 6%, mean XZ radius 2.6. console.error / pageerror / WebGL 0; destinationConnections 0.
- regression: `smoke:gh007` PASS (one run gave 5/6 logo glyph runs; two re-runs gave 7 — flaky metric), `smoke:stage3.2` PASS, `smoke` PASS.
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/ — HTTP 200; Pages build `built 8a35658`. Live markers: `TRAIL_KEEP_CAP = 0.90`, `u_trailEnergyNorm`, `chromaFloor` / `u_coreSpecular`, `gl.depthMask(false)`, `TrailTransitionGuard`, `FISH_LEADER_Y` / `GAS_TORUS_RADIUS`, `invariant gl_Position`, and sw.js `zur-shell-v5` + `PostProcessPass.js`.

## ZUR-GH-009 — Stage 5 "ZUR v5.0 — Blood, Brain & Deep Space"
- status: squash-merged to `main` — main_commit_sha `a1518f3` (PR https://github.com/musicman12091/aiu-zur-visualizer/pull/9); implementation `eaf00f2` on `feat/zur-gh-009`. Codegen: Copilot CLI `claude-sonnet-5.5` (session 53705344-59c1-4f47-9a81-f5c83316147e); Ori 6-point audit 6/6; no @copilot review.
- Storage `zur_state_v5_0` (v4 key migrated), sw.js `zur-shell-v7`.
- Density: tiers 64k/96k/128k/160k/256k (default 64k, `auto` + small tiers removed, migrated to 64k); `MAX_PARTICLES = 262144` sizes all TF VBOs + logo targets; glyph targets wrap with `sampledPoints[i % sampledPoints.length]`.
- Pinch zoom: `cameraZoom` 0.35..3.50 (`u_cameraZoom` in render.vert + core.frag); canvas-only `touch-action: none`, HUD `pan-y`; 2-finger pinch, wheel, double-tap reset.
- Styles `dart3d | blood-drop | synapse-spark | star-streak` (`orb` removed), palettes `true-neon | full-spectrum | white-static | blood-red`, 4 formations (`neural-brain`, `living-galaxy`, `supermassive-blackhole`, `wormhole`), `kineticMode` (6 modes), "Reactivity Punch" (`reactivityGain` 2.5), noise gate default 0.015 (0..0.1).
- Notes: tree had no Visual Preset / Audio Profile rows, no `oVelocityAux` and no dart banking roll; the blood pin flag rides in the sim phase channel (+2.6). `v_neuralPulse` is a dedicated render.vert varying.
- contracts: 124 passed. `tests/smoke-zur-gh-009.mjs` (`npm run smoke:gh009`) PASS at 412x915: 256k logo-attractor + neural-brain clean; all scenarios blackRatio < 0.85, whiteClip 0; audio-reactivity radius delta +0.22 at oscillationAmount 0.
- Ori re-run (pre-merge): contracts 124/124; smoke:gh009 PASS — 256k logo blackRatio 0.449 / brain 0.823, scenarios blackRatio 0.436–0.74, whiteClip 0 everywhere, reactivity radiusDelta +0.204 / lumaDelta +97.8, console/page/WebGL errors 0, destinationConnections 0.
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/ — HTTP 200, Pages build success; live markers sw.js `zur-shell-v7`, `zur_state_v5_0`, `MAX_PARTICLES = 262144`.

## ZUR-GH-010 — Stage 5.1 Context-Gated 6-Tab HUD + Visual & Shader Polish
- status: squash-merged to `main` — main_commit_sha `b431f90` (PR https://github.com/musicman12091/aiu-zur-visualizer/pull/10; branch `feat/zur-gh-010` deleted). Codegen: Copilot CLI `claude-sonnet-5.5` (session abcfc2d0-0d9e-440e-b47c-312000d0a69e, stopped by Ori at ~44 min while tuning the 256k density gate); Ori audit + GH-010 contracts + brain entry defaults in `/workspace`. No Cursor agent, no `@copilot` review.
- Storage `zur_state_v5_1` (v5.0 / v4 keys migrated), sw.js `zur-shell-v8`.
- HUD: sticky tab bar `deep-space | brain-3d | blood-swarm (blood-drip | logo-text | free-swarm) | megastructure | canyon-pulse (spectral-canyon-3d | pulse-field-3d | aurora-ribbons) | audio-rig`. `enforceTabConstraints` (pure, idempotent) + `switchHudTab` in AppState.js; per-tab rows from `CONTROL_LAYOUT` in `src/controls/hudTabs.js`; one `normalizeOption` / `fillSelect` path, so no option is ever blank; dark `.control-hud select` CSS; `3D shape` row and duplicate palette row removed. The VJ autopilot output goes through the tab constraints. Audio & Rig keeps the last visual tab's scene.
- Render: dart3d draws `TRIANGLES` x 12 and every other style draws `TRIANGLE_STRIP` x 4; crowdNorm reaches 262144; zoom damp `1/pow(zoom,0.35)` with 14 px / 28 px (blood) ceilings; multi-hue spatial palettes; `golden-cortex` (index 4: 80% gold soma at alpha 0.26, cyan-white pulse > 0.55 at 2.8x).
- Sim: 40% blood glass runners `(gl_VertexID % 5) < 2` (pin at z 0.79, streak clamp 0.55..2.8, respawn below y -1.18; `oVelocityAux.w = 2.8` mapped onto the phase channel); tether at least 4.2 and curl at most 0.18 x R for formations 6 and up; Gargantua (formation 8): r < 0.24 void, 14-degree disk 60%, Einstein ring 28%, jets 12%.
- contracts: 144 passed (was 124).
- smoke:gh010 PASS @ 412x915 (SwiftShader, two runs). Blank options 0 on all tabs and sub-modes. hueSectorCount 12 for full-spectrum, 12 for true-neon, 7 for golden-cortex. At 256k (262144): blackRatio 0.388 / 0.39, whiteClip 0. Black hole centre blackRatio 1.00, whiteClip 0. console, page and WebGL errors 0; destinationConnections 0. smoke:gh009 PASS (reactivity radiusDelta +0.48).
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/ — HTTP 200, Pages build success; live `zur-shell-v8` and `zur_state_v5_1`.
- residual: the 256k blackRatio sits right at the 0.38 floor. SwiftShader runs at about 1 FPS, so the Gargantua disk, ring and jets are not converged in the smoke and only the void is proven. The count pill can lag the tier change. A57 FPS at 256k still needs checking.

## ZUR-GH-011 — Stage 5.2 Mobile Touch DOM Stability, Sticky Header, Blood-Drip Default & 3D Brain Idle Thalamic Pulse
- status: pushed to `main` — COMPLETE (shipped via Google Antigravity Claude Opus 5.5 Thinking on Velocity PC; Ori `/workspace` fast-forwarded 2026-11-05)
- commit_sha (main): `aa9c756d0c6fcd126afe3ee1b94cb37873a8826c`
- previous: `90531d2` (docs) / `b431f90` (ZUR-GH-010)
- Storage `zur_state_v5_2` (migrates `zur_state_v5_1`), sw.js `zur-shell-v9`
- Fixes:
  1. ControlHUD status ticks no longer rebuild `<select>` / range DOM; layout keyed on `hudTab|swarmMode|shaderScene`; focused select and active drag ranges preserved; scroll preserved
  2. Sticky HUD header: Hide HUD + 6-tab bar in `.hud-sticky` (z-20 solid bg)
  3. Blood & Swarm tab entry defaults to `blood-drip` (`blood-drop` / `splatter-run` / `blood-red` / comet trail >= 0.72); sub-mode preserved on re-tap / Audio & Rig return
  4. `golden-cortex` idle thalamic pulse peaks at 0.78 (above 0.55 fire threshold); resting soma alpha ~0.52 with stronger firing boost
  5. smoke:gh010 `blackRatio` floor: `ZUR_ANGLE=d3d11` → 0.30, else SwiftShader 0.38
- contracts: `node tests/verify-contracts.mjs` → 150 passed (Ori re-verify 2026-11-05 America/Regina)
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/ — HTTP 200; live `zur-shell-v9` and `zur_state_v5_2` (Last-Modified Mon, 02 Nov 2026 23:50:54 GMT)
- next gate (user / A57): Termux grind of live `zur-shell-v9` recording into `ZUR_v52_Part*.mp4` + `ZUR_v52_Sheet_*.jpg`, then sign-off Stage 5.2 or scope ZUR-GH-012
- No `@copilot` PR review. No Cursor Cloud Agent.

## ZUR-GH-012-PREP — Linux software-renderer smoke (llvmpipe default, 256k VBO gate)
- status: fast-forward merged to `main` — COMPLETE (Option A approved: Mesa llvmpipe is the Linux default). Merge commit `19dc8dc36351a7b3c96543c7461b401dc574d1ff` (branch `fix/zur-gh-012-swiftshader-smoke`; no PR). Codegen: Copilot CLI `claude-sonnet-5.5`. Ori re-verify 2026-11-17 America/Regina.
- previous: `a8bab2c` (ZUR-GH-011 docs) / `aa9c756` (ZUR-GH-011)
- scope: tests only (`tests/smoke-zur-gh-010.mjs`, `tests/verify-contracts.mjs`). App shell (`zur-shell-v9` / `zur_state_v5_2`) unchanged.
- Smoke upgrades:
  1. Unbuffered `[T+Xs]` phase logs (server listen, Chrome connect, `UNMASKED_RENDERER_WEBGL`, per-gate elapsed ms + metrics)
  2. Linux container flags add `--disable-setuid-sandbox` (with `--no-sandbox`, `--disable-dev-shm-usage`, `--enable-unsafe-swiftshader`); Windows / `ZUR_ANGLE=d3d11` untouched
  3. Linux default is Mesa llvmpipe (`ZUR_ANGLE=gl`); `ZUR_ANGLE=swiftshader` forces SwiftShader (~128s). Software path (`/SwiftShader|llvmpipe/i`) steps 5 deterministic frames per gate (vs 270–420 hardware frames)
  4. 262,144 VBO / `crowdNorm` gate on both software and hardware paths (count 262144, two 8 MB TF buffers, shader `activeCount` 262144, `crowdNorm` 0.4475, 0 GL errors)
  5. Chrome reaper for debug port 9343 plus busy-port refusal (timeout leftovers no longer pin CPU)
  6. Software-only 256k `blackRatio` floor 0.35 (measured 0.379 on earlier SwiftShader / llvmpipe calibration runs). Hardware floors unchanged (`ZUR_ANGLE=d3d11` 0.30; prior SwiftShader 0.38). Error checks unchanged.
- contracts: `node tests/verify-contracts.mjs` → 156/156 PASS (was 150)
- smoke:gh010 PASS @ 412×915 in 19.9s (`timeout 90s`, exit 0) on Mesa llvmpipe (`ANGLE (Mesa, llvmpipe (LLVM 19.1.7 256 bits), OpenGL 4.5)`): 256k `blackRatio` 0.38 (floor 0.35), `whiteClip` 0, VBO 8388608 × 2, `crowdNorm` 0.4475, black-hole `blackRatio` 0.434 / centre 1.00, brain idle luma 0.422 (gate 0.36), console/page/WebGL errors 0, `destinationConnections` 0. Earlier calibration: `blackRatio` 0.379 / `brainLuma` 0.421.
- No `@copilot` PR review. No Cursor Cloud Agent. Local branch `fix/zur-gh-012-swiftshader-smoke` deleted after push.

## ZUR-GH-012 — Galaxy A57 live-video audit: 8 defects (zur-shell-v10 / zur_state_v5_3)
- status: fast-forward merged to `main` — COMPLETE. Merge commit `d29d8fa` (branch `feat/zur-gh-012`; no PR). Codegen: Copilot CLI `claude-sonnet-5.5` (405.68 AI credits, 40 min); Option B blood-red brain edit by Ori by hand (0 credits). Ori verify 2026-11-17 America/Regina.
- previous: `7adac1d` (ZUR-GH-012-PREP docs)
- Storage `zur_state_v5_3` (migrates `zur_state_v5_2`, repairs hudTab/sceneId desync), sw.js `zur-shell-v10`
- Fixes:
  1. hudTab is the single source of truth: `sceneForHud()` derives sceneId on boot, restore (`upgradeToV53`) and Mode A/B. Mode B = deep-space / particle-swarm-3d / wormhole / 64k / size 1.0
  2. Strictly 1 transform-feedback step per frame (`planSimStep`, simDt = min(dt, 1/30), `MAX_STEPS_PER_FRAME` 1). dart3d draws a 4-vertex dart SDF quad (`TRIANGLE_STRIP`) at >= 131072 agents
  3. full-spectrum / true-neon hue from coherent spatial bands (`atan(y,x)` sectors + radial/Z bands, ±0.014 jitter)
  4. Gargantua edge-on disk, `diskNormal = normalize(vec3(0.08, 0.96, -0.26))`, jets along the normal, camera-right Doppler beaming (60/28/12 split kept)
  5. logo-attractor bypasses crowdNorm: min radius 2.6 px, alpha >= 0.88, 1.9x radiance
  6. Blood glass runners 2.6x (#FF0A22 core, #FF8A96 specular, >= 3.2 px). 3D Brain 0.52 soma alpha / 0.78 thalamic pulse / 3.2x flash on all 5 palettes
  7. Megastructure swarm r >= coreRadius + 0.62 at 0.35x alpha; Orbit 3D / Tunnel Fly move the raymarch eye. Spectral canyon sky / floor / fog clamped to obsidian (<= 0.03), hue only on emissive lines / sun
  8. Mic raw -> `{audio:true}` -> silent 124 BPM kick+bass+synth Demo Beat (analyser only, destinationConnections 0) with HUD status label
- Decision (Option B, approved): blood-red 3D Brain stays arterial crimson (#C8000A -> #FF0818 soma); white-scarlet #FF5566 only on v_neuralPulse > 0.65 (soma and dendrite flashes; no cyan, no pink blend). Smoke gate for blood-red brain: luma >= 0.12 AND meanR > 2.2 x meanG (pure red caps at 0.2126 Rec.709 luma). Other 4 palettes keep luma >= 0.25.
- contracts: `node tests/verify-contracts.mjs` -> 169/169 PASS (was 156)
- smoke:gh010 PASS @ 412x915 on Mesa llvmpipe, 43.4s (`timeout 90s`, exit 0), console/page/WebGL errors 0: tabSceneSync ok; simSteps 1 (64k + 256k), dartVerts 4 @ 256k; 256k meanSat full-spectrum 0.613 / true-neon 0.607 (>= 0.55); logo glyph luma 0.207 (>= 0.12); brain luma true-neon 0.295, full-spectrum 0.305, white-static 0.436, golden-cortex 0.41 (>= 0.25), blood-red 0.136 with meanR 0.49 / meanG 0.037; canyon blackRatio 0.669 @ hueShift -0.83 (>= 0.42); disk aspect 1.75–1.84 (>= 1.5); megastructure eye delta 0.384 / 0.397; mic fallback 2 attempts -> demo 124 BPM; v5_2 reload repaired; existing gates unchanged (256k blackRatio 0.375–0.378, VBO 8388608 x 2, crowdNorm 0.4475, BH centre 1.00).
- smoke:gh009: stock script (hardcoded SwiftShader) times out at 300s on Linux; a temporary llvmpipe copy PASSED in 108s, 0 errors (not committed).
- residual: new gates are unverified on a hardware GPU and on the A57 by eye; the shared `{audio:true}` retry runs after an await (outside the tap); Mode B detected by preset name; black-hole disk gate steps 80 frames (~8.5s); blood-red brain luma margin is thin (0.136 vs 0.12).
- No `@copilot` PR review. No Cursor Cloud Agent. Local branch `feat/zur-gh-012` deleted after push.

## ZUR-GH-013 — v6.0 true silence-to-peak reactivity, Blood deleted, unlocked deck (zur-shell-v11 / zur_state_v6_0)
- status: squash-merged to `main` — COMPLETE. Merge commit `1ed6cf0` (squash of `feat/zur-gh-013-v6-modular`: `7d6941e`, `a2aacda`, `7dca947`; baseline `3eb4f09`; no PR). All GLSL / JS / HTML written by hand by Ori (0 Copilot credits, no Cursor Cloud Agent). Ori verify 2026-11-18 America/Regina.
- previous: `3eb4f09` (ZUR-GH-012 STATE docs)
- Storage `zur_state_v6_0` (schema 6.0; migrates v5_3, v5_2, v5_1, v5_0, v4 and older; `hud` deleted; every save moves to crisp-dot + true-gate; Blood saves -> wormhole / kinetic off / crimson-pulse / particle scene). sw.js `zur-shell-v11`.
- Changes:
  1. `reactivityMode` true-gate (default, silence = black) / ember-floor (0.06 outline) / ambient-vj. `cleanGate = smoothstep(0.018, 0.13, maxBandEnergy * u_reactivityGain)` in JS (FeatureExtractor / particleMath) and GLSL (render.vert). Emission multiplies every engine (particles, megastructure core alpha, spectral canyon, aurora present pass). Closed gate: 120 ms trail decay (`gatedTrailKeep`), +5 motion damping. Beats: onset-dominated radial velocity burst + displacement + brightness boost. Idle thalamic pulse / idle shock only in ambient-vj.
  2. "Load Audio Track (WAV/MP3/OGG)" + Play/Pause + Speaker Monitor: AudioElement -> MediaElementSource -> Analyser; `monitorConnect()` is the single destination path (file track + monitor checked). Mic / tab / demo / oscillator stay at destinationConnections 0. 4 s rolling-peak auto-gain (16 buckets, target 0.9, 1x..8x) on the shared Android mic only.
  3. Blood & Swarm tab, blood-drip, blood-drop, splatter-run and `enforceTabConstraints` deleted. HUD = Quick Presets strip (Wormhole, 3D Brain, Gargantua, Ferrofluid Rings, Spiral Galaxy, Logo Text, Megastructure, Spectral Canyon) + Engine Selector (3D Particle Engine | Megastructure | Spectral Canyon | 3D Pulse Field | Aurora Ribbons) + one unlocked deck; quick presets / engines / palettes / formations never touch particleStyle.
  4. Styles: crisp-dot ("Crisp Dot — Pinpoint", default, exp(-r2*16) hard cutoff, exposure clamp(pow(16384/N, 0.52), 0.16, 1)), star-streak (energy-conserving stretch), synapse-node (crisp soma + 15% axon sparks), dart3d 0.55x. Velocity Capsule shading removed; all styles additive.
  5. No atan seams: render.frag / core.frag palettes are smooth iq-cosine / mix() gradients over radialNorm, depthNorm, speedNorm and spectralCentroid.
  6. Formations: wormhole horned torus (22 deg tilt, R 0.94, throat 0.08, default), anatomical neural-brain (82/11/7, 0.045 fissure, ±0.03 gyri, 32 deg view, audio-only waves), new harmonic-ferrofluid (index 10: 70% spherical-harmonic shell on 5 bands + 30% EQ rings).
- Approved spec deviations (M'lord, 2026-11-18):
  1. gate (a) silence measured as frame mean luma (0.000) + blackRatio 1.0; gate (b) uses activeMeanLuma >= 0.12 plus a >= 5x frame-luma ratio vs silence.
  2. 256k wormhole blackRatio ceiling raised to 0.97 (true-gate black background).
  3. Brain luma floors measured with live audio (no idle brightness to measure in true-gate).
  4. Beat velocity burst is onset-driven (bass only a minor term, removed on structured formations).
  5. All pre-v6 saves migrate to crisp-dot + true-gate.
- Tightening 1 (sim.vert swell): on wormhole / neural-brain / logo-attractor / supermassive-blackhole (`structuredFormation()`, types 5/6/8/9) the legacy 1.42x sustained radial kick is replaced by a transient `kick = 1 + 0.08 * u_onset * u_cleanGate` (<= 1.08x, `STRUCTURED_ONSET_PULSE`); brain soma swell onset-only (0.04); curl cap 0.33x and onset impulses 0.35x on structured formations; sustained bass burst 0 there. Sustained bass / RMS now drive brightness (`beatBoost += 0.5 bass + 0.35 rms`), synapse tracer speed (+4 bass +3 rms), star-streak stretch (+2.5 (bass+rms), cap 19) and harmonic-ferrofluid spike amplitude (+0.30 bass +0.35 rms). JS mirror `formationKick()` in particleMath. Smoke "structured swell gate" (sustained features, onset 0, p95 |pos| from the TF buffer): wormhole 2.595 -> 2.677 = 1.032x, neural-brain 2.241 -> 2.351 = 1.049x (gate <= 1.10 = 1.08 + 2% slack).
- Tightening 2 (AppState style reset): `upgradeToV60()` (crisp-dot reset) runs only when `schema < 6.0` (v5_3 and older). A valid `zur_state_v6_0` save keeps crisp-dot / star-streak / synapse-node / dart3d across reloads. Contract: all 4 styles round-trip with migrated=false; v5_3 / v5_2 / v4_0 envelopes -> crisp-dot. Smoke "v6_0 particleStyle reload gate": all 4 styles saved -> Page.reload -> state + DOM value kept, schema 6.
- contracts: `node tests/verify-contracts.mjs` -> 173/173 PASS (was 169 at ZUR-GH-012; obsolete Blood / tab / idle-luma / capsule tests replaced, 14 new ZUR-GH-013 contracts incl. both tightenings).
- smoke:gh010 rewritten for v6.0: PASS @ 412x915 on Mesa llvmpipe in 44.5 s (`timeout 90s`, exit 0), console/page/WebGL errors 0. Metrics: (a) silence meanLuma 0.000, blackRatio 1.0, cleanGate 0; (b) active activeMeanLuma 0.36, ratio vs silence ≫5x; (c) maxAdjacentHueDelta true-neon 0.0112 / full-spectrum 0.0253; (d) style persistence 24 checks, 0 resets; (e) wormhole shell 0.439 / throat 0.195; 256k blackRatio 0.52 (0.35–0.97), VBO 8388608 x 2, crowdNorm 0.4475; 256k meanSat 0.837 / 0.86; BH centre 1.00; simSteps 1, dartVerts 4 @ 256k; logo luma 0.411; brain luma true-neon 0.365, full-spectrum 0.474, white-static 0.551, golden-cortex 0.52, crimson-pulse 0.212 (meanR 0.612 / meanG 0.099); ferrofluid 0.494, 6 hue sectors; canyon blackRatio 0.669, silence 1.0; track monitor 0/1/0, tab destination 0; mic shared auto-gain on -> off after stop; v5_3 Blood -> v6_0 migration ok.
- smoke:gh009: minimally patched (goTab -> 3D Particle Engine, blood scenario -> crimson-pulse wormhole, synapse-spark -> synapse-node). Stock SwiftShader script still too slow on Linux (pre-existing); a temporary llvmpipe copy PASSED in 86 s, 0 errors (copy not committed).
- residual: no hardware-GPU or Galaxy A57 by-eye verification; smokes stage2 / stage3 / stage3.2 / gh007 / gh008 likely broken by the HUD-tab and Blood removal (not run); the 256k wormhole looks cubic after only 5 software frames; the swell gate uses deterministic injected features (live-oscillator radius readings are noisy, 0.86–1.17); brain activeFraction is lower (~0.08) with the tighter swell; smoke time 44.5 s.
- No `@copilot` PR review. No Cursor Cloud Agent. Local branch `feat/zur-gh-013-v6-modular` deleted after push.

## ZUR-GH-014 — v6.1 polish: context HUD, staccato Test Beat, crisp dots, viewport presence (zur-shell-v12 / zur_state_v6_1)
- status: squash-merged to `main` — COMPLETE. Merge commit `94107ae` (squash of `feat/zur-gh-014-v61-polish`: `f1029d8`, `19c7326`, `2fd4a69`, `dd904db` (approved), `69e8a20` (2 polishes); baseline `9b1cdd9`; no PR). All GLSL / JS / HTML written by hand by Ori (0 Copilot credits, no Cursor Cloud Agent). Ori verify 2026-11-18 America/Regina.
- previous: `9b1cdd9` (ZUR-GH-013 STATE docs)
- Storage `zur_state_v6_1` (schema 6.1; v6_0 saves keep particleStyle; v5_3 and older get the v6.0 crisp-dot reset; every pre-v6_1 save with cameraZoom < 0.75 loads at 1.00). sw.js `zur-shell-v12`.
- Changes:
  1. Context HUD: any Formation pick or particle Quick Preset sets sceneId particle-swarm-3d (style / palette / flow kept); Formation / Style / Flow / Kinetic hidden off the particle engine, Logo Text only on logo-attractor, Pulse Field Layout only on pulse-field-3d; one universal Palette + Hue Shift row drives all 5 engines (Scene Palette row deleted); Quick Preset pill derived from sceneId + formation (`quickPresetForState`, never stuck on Gargantua); preset taps reset zoom 1.00 / trail 0.08 / physarum; ParticleSystem3D sim + draw paused on canyon / aurora, sim paused on pulse-field-3d.
  2. "Test Beat (Silence + Hits)": true 120 BPM, 500 ms = 85 ms hit + 415 ms pure 0.000 silence, hits alternate kick / snare+arp (1000 ms loop), analyser only (destinationConnections 0). FeatureExtractor digital-silence snap: an exact-zero waveform is silent on the first frame and the envelopes snap to 0.
  3. Crisp dots: AA disc `smoothstep(1.0, 0.50, r)`, no skirt, 1.4 px @ 64k -> 0.95 px @ 256k (log2 interp). Ball spawn seed + smooth tanh spherical containment (R_soft 8.0, R_max 9.0), spherical NaN reseed. Surface formations (wormhole, brain, logo, black hole, ferrofluid): Flow turbulence = surface-tangent drift <= 0.035 x radius x pull.
  4. Viewport presence (per-formation factors): wormhole 1.48, neural-brain 1.62, logo 1.2, Gargantua 1.0, ferrofluid / galaxy 1.0. Wormhole tilt 38 deg, 75% of agents on 64 geodesic meridian tracks over the polar rims into the throat.
  5. Pulse field: Band Clouds (5 x 13^3 balls), Geodesic Sphere (4000 Fibonacci nodes), Wave Grid (72 x 72) drawn as neon dot-lattice nodes on black, gated by reactivityMode.
- Polishes (M'lord, approved on `dd904db`):
  1. synapse-cascade on surface formations: outward push removed in sim.vert (radial part stripped, tangent <= 3x drift cap); render.vert routes kineticMode synapse-cascade into a crisp brainstem -> cortex front (`CASCADE_PULSE_GAIN` 2.4x tint, v_neuralPulse firing colour) on hits only (cleanGate), geometry untouched.
  2. True 120 BPM Test Beat (above); smoke samples a 1.15 s real-time window.
- Deviations: per-formation presence instead of a flat 1.8x (1.8x put wormhole / brain at ~95% and Gargantua off-screen); there were no literal cubic clamps (the "square box" was the cube spawn seed); pulse-field sim paused but its lattice is still drawn by ParticleSystem3D; 7a frame luma = p99 pixel luma per real-time frame (full-frame mean on a hit is only ~0.05); visual.paletteId now legacy; megastructure forces fractal-core at render time.
- contracts: `node tests/verify-contracts.mjs` -> 186/186 PASS (was 173; GH-013 contracts updated where v6.1 changes them + 13 new ZUR-GH-014 contracts).
- smoke:gh010 PASS @ 412x915 on Mesa llvmpipe in 77.4 s (`timeout 90s`, exit 0), console/page/WebGL errors 0. Metrics: (7a) Test Beat 14 real-time frames / 1183 ms, min frame luma 0.000, peak hit 0.4157, destinationConnections 0; (b) presence span wormhole 0.715, brain 0.715, Gargantua 0.679 (pixel 0.764 / 0.785 / 0.807); (c) Formation on Megastructure -> particle-swarm-3d, highlight brain; (d) 256k fluid cube-corner 0, face pile-up < 0.0002; swell wormhole 1.010x, brain 1.003x (with synapse-cascade on); brain cascade p99.9 luma 0.655 -> 0.702 (1.07x), p99 0.526 -> 0.596, whiteClip 0; (e) wormhole shell 0.596 / throat 0.15 (radii / 2.6 x 1.48); 256k blackRatio 0.76, meanSat 0.935 / 0.98; BH centre 1.00; logo 0.49; brain palettes 0.18–0.55, whiteClip 0; ferrofluid 0.44; canyon 0.671 + particle pause; pulse lattice 0.22 / 0.134 / 0.125, 0 sim steps; reload migrations v5_3 -> v6_1, v6_1 style round-trip, v6_0 zoom 0.2 -> 1.00 (style kept).
- residual: Test Beat peak 0.416 vs 0.40 floor and only 1–2 hit frames per window on llvmpipe; wave-grid pulse luma 0.125 vs 0.12; smoke 77.4 s of the 90 s budget; cascade gain modest (1.07x p99.9) on llvmpipe; synapse-cascade weaker on brain geometry by design; no hardware-GPU / Galaxy A57 by-eye check.
- No `@copilot` PR review. No Cursor Cloud Agent. Local branch `feat/zur-gh-014-v61-polish` deleted after push.
