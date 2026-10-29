# aiu-zur-visualizer

Silent WebGL2 visualizer for Project ZUR. Audio analysis never connects to the speakers. Live at https://musicman12091.github.io/aiu-zur-visualizer/ (GitHub Pages, `main` root).

Stage 2 adds a WebGL2 transform-feedback 3D particle swarm (up to 65,536 agents) with Fluid, Gas, Murmuration and School of Fish flow modes, 3D darts or velocity capsules, and a kaleidoscope post pass. Aurora Ribbons from Stage 1 is still selectable.

```bash
python3 -m http.server 4173
node tests/verify-contracts.mjs
node tests/smoke-headless.mjs   # Stage 1 headless Chrome
node tests/smoke-stage2.mjs     # Stage 2 headless Chrome on http://localhost:8080
```

Open `http://127.0.0.1:4173/`. Mode A is the 720p30 silent tab-capture preset. Mode B is the 720p60 call-speaker preset with a 10× pre-amp. Test Oscillator drives every band without audible output. Keys: H hides the HUD, P switches scene, F cycles flow mode, K cycles kaleidoscope. Share a look with `?preset=scene:particles_flow:fish_k:8`.

Contracts live in `CONTRACTS.md`. Handoff status lives in `STATE.md`.
