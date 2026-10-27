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
