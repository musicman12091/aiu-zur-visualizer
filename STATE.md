# ZUR STATE

Stage 1 ledger for `musicman12091/aiu-zur-visualizer`.

## Stage 1 — ZUR-GH-001

- status: implemented on `cursor/zur-stage1-4553`, not merged
- branch: `cursor/zur-stage1-4553`
- commit_sha: pending-ledger
- pages_url: https://musicman12091.github.io/aiu-zur-visualizer/
- pages_status: not enabled (`has_pages: false`; this credential has no admin right to turn Pages on)
- contract_tests: PASS — `node tests/verify-contracts.mjs` (19 passed)
- headless_chrome: PASS — page boot, 7 HUD meters, WebGL2 canvas, silent test oscillator driving sub/bass/lowMid/highMid/treble/RMS with `destinationConnections: 0`

Headless Chrome 156 (SwiftShader) loaded `index.html`, compiled `aurora-ribbons.glsl`, and clicked Test Oscillator. Capture mode was `oscillator`, `AudioContext` state was `running` at 44100 Hz, fftSize 2048, and the analyser was not connected to `destination`. Wake Lock is requested with `navigator.wakeLock.request("screen")` and re-acquired on `visibilitychange` when the document becomes visible.

## Pages

GitHub reports `has_pages: false`. The agent token cannot change repository settings.

After this branch is on `main`:

1. Open https://github.com/musicman12091/aiu-zur-visualizer/settings/pages
2. Under Build and deployment, set Source to **Deploy from a branch**.
3. Set Branch to `main` and folder to `/` (root).
4. Save, then wait until the Pages deployment is green.
5. Confirm https://musicman12091.github.io/aiu-zur-visualizer/ serves the visualizer.

Do not point Pages at `/docs`. Stage 1 is served from the repository root.

## Not in this stage

`musicman12091/aiu-dj-player` was not modified. Scenes 2–4 and the Butterchurn adapter are later stages.
