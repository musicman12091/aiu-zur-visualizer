# aiu-zur-visualizer

Silent WebGL2 visualizer for Project ZUR Stage 1. Audio analysis never connects to the speakers. The intended public URL is https://musicman12091.github.io/aiu-zur-visualizer/ once GitHub Pages is enabled from the `main` branch root.

```bash
python3 -m http.server 4173
node tests/verify-contracts.mjs
```

Open `http://127.0.0.1:4173/`. Mode A is the 720p30 silent tab-capture preset. Mode B is the 720p60 call-speaker preset with a 10× pre-amp. Test Oscillator drives every band without audible output.

Contracts live in `CONTRACTS.md`. Handoff status lives in `STATE.md`.
