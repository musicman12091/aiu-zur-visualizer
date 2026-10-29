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

## Not in this stage

`musicman12091/aiu-dj-player` was not modified. Further scenes and the Butterchurn adapter are later stages.
