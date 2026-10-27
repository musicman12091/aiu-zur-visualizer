# ZUR STATE

Stage 1 ledger for `musicman12091/aiu-zur-visualizer`.

## Stage 1 — ZUR-GH-001

- status: squash-merged to `main`
- merged_to_main: yes
- main_commit_sha: 052dc4fa1d38ff82106da4fa1c9c938ebd798b21
- PR: https://github.com/musicman12091/aiu-zur-visualizer/pull/1 (merged)
- implementation_commit_sha: dd47857b49d8311afcaffe4c7740cbf214f47c69
- branch: `cursor/zur-stage1-4553` (squash-merged)
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- pages_status: not enabled — host must enable Pages (this credential has no admin right)
- tests: `node tests/verify-contracts.mjs` 19 passed; headless Chrome smoke passed; `destinationConnections` 0
- contract_tests: PASS — `node tests/verify-contracts.mjs` (19 passed)
- headless_chrome: PASS — page boot, 7 HUD meters, WebGL2 canvas, silent test oscillator driving sub/bass/lowMid/highMid/treble/RMS with `destinationConnections: 0`

Headless Chrome 156 (SwiftShader) loaded `index.html`, compiled `aurora-ribbons.glsl`, and clicked Test Oscillator. Capture mode was `oscillator`, `AudioContext` state was `running` at 44100 Hz, fftSize 2048, and the analyser was not connected to `destination`. Wake Lock is requested with `navigator.wakeLock.request("screen")` and re-acquired on `visibilitychange` when the document becomes visible.

## Pages

GitHub still reports `has_pages: false`. Enabling Pages needs repository admin, which this credential does not have, so the API cannot turn it on.

Stage 1 is already on `main` (`052dc4fa1d38ff82106da4fa1c9c938ebd798b21`). The host still needs to enable Pages:

1. Open https://github.com/musicman12091/aiu-zur-visualizer/settings/pages
2. Under Build and deployment, set Source to **Deploy from a branch**.
3. Set Branch to `main` and folder to `/` (root).
4. Save, then wait until the Pages deployment is green.
5. Confirm https://musicman12091.github.io/aiu-zur-visualizer/ serves the visualizer.

Do not point Pages at `/docs`. Stage 1 is served from the repository root.

## Not in this stage

`musicman12091/aiu-dj-player` was not modified. Scenes 2–4 and the Butterchurn adapter are later stages.
