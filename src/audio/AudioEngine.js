/**
 * Analysis-only capture. The graph ends at AnalyserNode.
 * Deliberately absent: source.connect(context.destination);
 * ZUR-GH-013: the ONE exception is a user-loaded audio file (mode "file-track") with Speaker Monitor checked:
 * AudioElement -> MediaElementAudioSourceNode -> AnalyserNode, plus source -> destination through monitorConnect().
 * Tab capture, microphone, Demo Beat and the test oscillator always stay at destinationConnections === 0.
 *
 * resume() and getDisplayMedia()/getUserMedia() are invoked synchronously
 * inside the start functions, before either promise is awaited.
 */

let capture = null;
let context = null;
let source = null;
let analyser = null;
let analyserRight = null;
let frequencyData = null;
let waveformData = null;
let frequencyRightData = null;
let waveformRightData = null;
let liveNodes = [];
let currentMode = "idle";
let videoSink = null;
let destinationRefusals = 0;
let session = 0;
let tail = Promise.resolve();

// ZUR-GH-012 Android mic fallback: "raw" (echo/noise processing off) -> "shared" ({ audio: true }) -> silent "demo" beat.
export const DEMO_BEAT_BPM = 124;
export const MIC_STAGE_LABELS = Object.freeze({
  raw: "",
  shared: "Mic opened in shared mode (raw processing unavailable)",
  demo: "Mic locked by another app — Demo Beat 124 BPM (silent)",
});
// ZUR-GH-013 loaded audio track (WAV / MP3 / OGG) + Speaker Monitor.
export const TRACK_ACCEPT = ".wav,.mp3,.ogg,audio/wav,audio/x-wav,audio/mpeg,audio/ogg";
let trackElement = null;
let trackUrl = "";
let trackName = "";
let speakerMonitor = false;
let monitorConnected = false;
let destinationConnections = 0;
let micStage = "idle";
let micAttempts = [];
let demoBeat = { running: false, bpm: 0 };
let demoTimer = null;

function enqueue(task) {
  const run = tail.then(task, task);
  tail = run.then(() => {}, () => {});
  return run;
}

function isAudioDestination(node) {
  if (!context || !node) return false;
  if (node === context.destination) return true;
  const Ctor = globalThis.AudioDestinationNode;
  return typeof Ctor === "function" && node instanceof Ctor;
}

function connectNode(node, destination) {
  if (isAudioDestination(destination)) {
    destinationRefusals += 1;
    throw new Error("ZUR silent capture refused a connection to AudioContext.destination");
  }
  return node.connect(destination);
}

function remember(node) {
  liveNodes.push(node);
  return node;
}

function makeAnalyser(audioContext, fftSize) {
  const node = audioContext.createAnalyser();
  node.fftSize = fftSize;
  node.smoothingTimeConstant = 0;
  try {
    node.minDecibels = -120;
    node.maxDecibels = -10;
  } catch {
    // Keep the implementation defaults when the range is rejected.
  }
  return node;
}

function allocateBuffers(node, rightNode) {
  analyser = node;
  analyserRight = rightNode;
  frequencyData = new Float32Array(node.frequencyBinCount);
  waveformData = new Float32Array(node.fftSize);
  frequencyRightData = rightNode ? new Float32Array(rightNode.frequencyBinCount) : null;
  waveformRightData = rightNode ? new Float32Array(rightNode.fftSize) : null;
}

function attachAnalyser(audioContext, sourceNode, fftSize, channelCount) {
  if (channelCount >= 2) {
    const splitter = remember(audioContext.createChannelSplitter(2));
    const left = remember(makeAnalyser(audioContext, fftSize));
    const right = remember(makeAnalyser(audioContext, fftSize));
    connectNode(sourceNode, splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    allocateBuffers(left, right);
    return left;
  }
  const node = remember(makeAnalyser(audioContext, fftSize));
  connectNode(sourceNode, node);
  allocateBuffers(node, null);
  return node;
}

function holdVideoTrack(stream) {
  if (!videoSink) return;
  const [videoTrack] = stream.getVideoTracks();
  videoSink.muted = true;
  videoSink.volume = 0;
  videoSink.srcObject = videoTrack ? new MediaStream([videoTrack]) : null;
  const playback = videoSink.play?.();
  if (playback?.catch) playback.catch(() => {});
}

function releaseVideoSink() {
  if (!videoSink) return;
  videoSink.srcObject = null;
}

async function failStart(nextCapture, nextContext, error) {
  stopDemoBeat();
  monitorDisconnect();
  releaseTrack();
  micStage = "idle";
  const nodes = liveNodes;
  liveNodes = [];
  capture = null;
  context = null;
  source = null;
  analyser = null;
  analyserRight = null;
  frequencyData = null;
  waveformData = null;
  frequencyRightData = null;
  waveformRightData = null;
  currentMode = "idle";
  for (const node of nodes) {
    try {
      node.stop?.();
    } catch {
      // Oscillators throw if stop() is called twice.
    }
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  releaseVideoSink();
  nextCapture?.getTracks().forEach((track) => track.stop());
  if (nextContext && nextContext.state !== "closed") await nextContext.close();
  throw error;
}

// The only code path allowed to reach AudioContext.destination: a loaded file track with Speaker Monitor checked.
function monitorConnect() {
  if (currentMode !== "file-track" || !source || !context || monitorConnected) return false;
  source.connect(context.destination);
  monitorConnected = true;
  destinationConnections = 1;
  return true;
}

function monitorDisconnect() {
  if (!monitorConnected) return false;
  try {
    source?.disconnect(context.destination);
  } catch {
    // Already disconnected.
  }
  monitorConnected = false;
  destinationConnections = 0;
  return true;
}

function applySpeakerMonitor() {
  if (currentMode === "file-track" && speakerMonitor) monitorConnect();
  else monitorDisconnect();
}

function releaseTrack() {
  if (trackElement) {
    try {
      trackElement.pause();
    } catch {
      // Not playing.
    }
    trackElement.removeAttribute?.("src");
    try {
      trackElement.load?.();
    } catch {
      // Detached element.
    }
  }
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackElement = null;
  trackUrl = "";
  trackName = "";
  monitorConnected = false;
  destinationConnections = 0;
}

export function setVideoSink(element) {
  videoSink = element;
}

export function getAudioContext() {
  return context;
}

function stopDemoBeat() {
  if (demoTimer !== null) clearInterval(demoTimer);
  demoTimer = null;
  demoBeat = { running: false, bpm: 0 };
}

export async function stopCapture() {
  session += 1;
  stopDemoBeat();
  monitorDisconnect();
  releaseTrack();
  micStage = "idle";
  const oldCapture = capture;
  const oldContext = context;
  const nodes = liveNodes;
  capture = null;
  context = null;
  source?.disconnect();
  analyser?.disconnect();
  analyserRight?.disconnect();
  source = null;
  analyser = null;
  analyserRight = null;
  frequencyData = null;
  waveformData = null;
  frequencyRightData = null;
  waveformRightData = null;
  liveNodes = [];
  currentMode = "idle";
  for (const node of nodes) {
    try {
      node.stop?.();
    } catch {
      // Oscillators throw if stop() is called twice.
    }
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  releaseVideoSink();
  oldCapture?.getTracks().forEach((track) => track.stop());
  if (oldContext && oldContext.state !== "closed") {
    await oldContext.close();
  }
}

export function startTabCapture({
  suppressLocalAudio = true,
  includeSystemAudio = false,
  fftSize = 2048,
} = {}) {
  const nextContext = new AudioContext({ latencyHint: "interactive" });
  const resumePromise = nextContext.resume();
  const capturePromise = navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: Boolean(suppressLocalAudio),
    },
    systemAudio: includeSystemAudio ? "include" : "exclude",
  });
  return enqueue(() => finishTabCapture(nextContext, resumePromise, capturePromise, fftSize));
}

async function finishTabCapture(nextContext, resumePromise, capturePromise, fftSize) {
  await stopCapture();
  const token = ++session;
  let nextCapture = null;
  try {
    nextCapture = await capturePromise;
    await resumePromise;
    if (token !== session) {
      nextCapture?.getTracks().forEach((track) => track.stop());
      if (nextContext.state !== "closed") await nextContext.close();
      return null;
    }
    const [audioTrack] = nextCapture.getAudioTracks();
    if (!audioTrack) {
      throw new Error("No audio track found. Select the target tab and enable tab-audio sharing.");
    }
    capture = nextCapture;
    context = nextContext;
    const channelCount = audioTrack.getSettings?.().channelCount ?? 1;
    source = context.createMediaStreamSource(new MediaStream([audioTrack]));
    remember(source);
    attachAnalyser(context, source, fftSize, channelCount);
    holdVideoTrack(capture);
    currentMode = "tab-capture";
    for (const track of capture.getTracks()) {
      track.addEventListener("ended", () => {
        if (token === session) void stopCapture();
      }, { once: true });
    }
    return { context, source, analyser, audioSettings: audioTrack.getSettings() };
  } catch (error) {
    if (token !== session) throw error;
    return failStart(nextCapture, nextContext, error);
  }
}

export function startMicCapture({ deviceId = null, fftSize = 2048 } = {}) {
  const nextContext = new AudioContext({ latencyHint: "interactive" });
  const resumePromise = nextContext.resume();
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  micAttempts = [{ stage: "raw", constraints: { video: false, audio } }];
  const capturePromise = navigator.mediaDevices.getUserMedia({
    video: false,
    audio,
  });
  return enqueue(() => finishMicCapture(nextContext, resumePromise, capturePromise, fftSize));
}

async function finishMicCapture(nextContext, resumePromise, capturePromise, fftSize) {
  await stopCapture();
  const token = ++session;
  let nextCapture = null;
  let stage = "raw";
  try {
    try {
      nextCapture = await capturePromise;
    } catch (rawError) {
      if (token !== session) throw rawError;
      // Stage 2: some Android builds refuse the raw constraint set (or hand the mic to another app): plain { audio: true }.
      try {
        micAttempts.push({ stage: "shared", constraints: { audio: true }, rawError: rawError?.name || String(rawError) });
        nextCapture = await navigator.mediaDevices.getUserMedia({ audio: true });
        stage = "shared";
      } catch {
        if (token !== session) throw rawError;
        await resumePromise;
        if (token !== session) {
          if (nextContext.state !== "closed") await nextContext.close();
          return null;
        }
        return startDemoBeat(nextContext, fftSize);
      }
    }
    await resumePromise;
    if (token !== session) {
      nextCapture?.getTracks().forEach((track) => track.stop());
      if (nextContext.state !== "closed") await nextContext.close();
      return null;
    }
    const [audioTrack] = nextCapture.getAudioTracks();
    if (!audioTrack) throw new Error("No microphone audio track was opened.");
    capture = nextCapture;
    context = nextContext;
    micStage = stage;
    const channelCount = audioTrack.getSettings?.().channelCount ?? 1;
    source = context.createMediaStreamSource(new MediaStream([audioTrack]));
    remember(source);
    attachAnalyser(context, source, fftSize, channelCount);
    currentMode = "microphone";
    for (const track of capture.getTracks()) {
      track.addEventListener("ended", () => {
        if (token === session) void stopCapture();
      }, { once: true });
    }
    return { context, source, analyser, micStage: stage, audioSettings: audioTrack.getSettings() };
  } catch (error) {
    if (token !== session) throw error;
    return failStart(nextCapture, nextContext, error);
  }
}

/**
 * Built-in silent Demo Beat: 124 BPM kick + bass + synth oscillators that feed the analyser only. Nothing here is ever
 * connected to AudioContext.destination (connectNode refuses it), so the beat is analysed but never heard.
 */
function startDemoBeat(nextContext, fftSize) {
  context = nextContext;
  const master = remember(context.createGain());
  master.gain.value = 0.8;
  master.channelCount = 1;
  master.channelCountMode = "explicit";
  const voice = (type, frequency) => {
    const osc = remember(context.createOscillator());
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = remember(context.createGain());
    gain.gain.value = 0;
    return { osc, gain };
  };
  const kick = voice("sine", 50);
  const bass = voice("sawtooth", 55);
  const bassFilter = remember(context.createBiquadFilter());
  bassFilter.type = "lowpass";
  bassFilter.frequency.value = 240;
  const lead = voice("square", 220);
  connectNode(kick.osc, kick.gain);
  connectNode(kick.gain, master);
  connectNode(bass.osc, bassFilter);
  connectNode(bassFilter, bass.gain);
  connectNode(bass.gain, master);
  connectNode(lead.osc, lead.gain);
  connectNode(lead.gain, master);
  for (const part of [kick, bass, lead]) part.osc.start();

  const sixteenth = 60 / DEMO_BEAT_BPM / 4;
  const bassNotes = [55, 55, 73.42, 65.41];
  const leadNotes = [220, 277.18, 329.63, 440, 329.63, 277.18, 246.94, 293.66];
  let nextStep = 0;
  let nextTime = context.currentTime + 0.05;
  const pluck = (gain, t, peak, length) => {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
  };
  const scheduleAhead = () => {
    if (!context) return;
    while (nextTime < context.currentTime + 1.2) {
      const t = nextTime;
      if (nextStep % 4 === 0) {
        kick.osc.frequency.cancelScheduledValues(t);
        kick.osc.frequency.setValueAtTime(150, t);
        kick.osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        pluck(kick.gain, t, 0.95, 0.38);
      }
      if (nextStep % 2 === 1) {
        bass.osc.frequency.setValueAtTime(bassNotes[(nextStep >> 1) % bassNotes.length], t);
        pluck(bass.gain, t, 0.5, sixteenth * 1.9);
      }
      lead.osc.frequency.setValueAtTime(leadNotes[nextStep % leadNotes.length], t);
      pluck(lead.gain, t, 0.14, sixteenth * 0.9);
      nextStep += 1;
      nextTime += sixteenth;
    }
  };
  scheduleAhead();
  demoTimer = setInterval(scheduleAhead, 200);
  demoBeat = { running: true, bpm: DEMO_BEAT_BPM };
  source = master;
  attachAnalyser(context, master, fftSize, 1);
  micStage = "demo";
  currentMode = "demo-beat";
  return {
    context,
    source,
    analyser,
    micStage: "demo",
    label: MIC_STAGE_LABELS.demo,
    audioSettings: { demoBeat: true, bpm: DEMO_BEAT_BPM },
  };
}

export function startTestOscillator({
  frequencies = [40, 120, 500, 2000, 8000],
  pulseHz = 2,
  fftSize = 2048,
} = {}) {
  const nextContext = new AudioContext({ latencyHint: "interactive" });
  const resumePromise = nextContext.resume();
  return enqueue(() => finishTestOscillator(nextContext, resumePromise, { frequencies, pulseHz, fftSize }));
}

async function finishTestOscillator(nextContext, resumePromise, { frequencies, pulseHz, fftSize }) {
  await stopCapture();
  const token = ++session;
  try {
    await resumePromise;
    if (token !== session) {
      if (nextContext.state !== "closed") await nextContext.close();
      return null;
    }
    context = nextContext;
    const master = remember(context.createGain());
    master.gain.value = 0.8;
    master.channelCount = 1;
    master.channelCountMode = "explicit";
    for (const frequency of frequencies) {
      const oscillator = remember(context.createOscillator());
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const gain = remember(context.createGain());
      gain.gain.value = 0.18;
      connectNode(oscillator, gain);
      connectNode(gain, master);
      oscillator.start();
    }
    const pulse = remember(context.createOscillator());
    pulse.type = "square";
    pulse.frequency.value = pulseHz;
    const pulseAmount = remember(context.createGain());
    pulseAmount.gain.value = 0.35;
    connectNode(pulse, pulseAmount);
    pulseAmount.connect(master.gain);
    pulse.start();
    source = master;
    attachAnalyser(context, master, fftSize, 1);
    currentMode = "oscillator";
    return { context, source, analyser, audioSettings: { testOscillator: true, frequencies, pulseHz } };
  } catch (error) {
    if (token !== session) throw error;
    return failStart(null, nextContext, error);
  }
}

/**
 * ZUR-GH-013 "Load Audio Track (WAV/MP3/OGG)": AudioElement -> MediaElementAudioSourceNode -> AnalyserNode.
 * The element's own output is captured by the source node, so the track is silent unless Speaker Monitor is checked.
 */
export function startFileTrack({ file, fftSize = 2048, speakerMonitor: monitor = speakerMonitor } = {}) {
  if (!file) return Promise.reject(new Error("Choose a WAV, MP3 or OGG file first."));
  const nextContext = new AudioContext({ latencyHint: "interactive" });
  const resumePromise = nextContext.resume();
  speakerMonitor = Boolean(monitor);
  return enqueue(() => finishFileTrack(nextContext, resumePromise, file, fftSize));
}

async function finishFileTrack(nextContext, resumePromise, file, fftSize) {
  await stopCapture();
  const token = ++session;
  try {
    await resumePromise;
    if (token !== session) {
      if (nextContext.state !== "closed") await nextContext.close();
      return null;
    }
    context = nextContext;
    trackUrl = URL.createObjectURL(file);
    trackName = file.name || "audio track";
    trackElement = new Audio();
    trackElement.preload = "auto";
    trackElement.loop = true;
    trackElement.src = trackUrl;
    source = remember(context.createMediaElementSource(trackElement));
    attachAnalyser(context, source, fftSize, 1);
    currentMode = "file-track";
    applySpeakerMonitor();
    let playing = true;
    try {
      await trackElement.play();
    } catch {
      playing = false; // autoplay refused: the Play button starts it
    }
    return { context, source, analyser, track: getTrackState(), playing, audioSettings: { fileTrack: true, name: trackName } };
  } catch (error) {
    if (token !== session) throw error;
    return failStart(null, nextContext, error);
  }
}

export async function playPauseTrack() {
  if (!trackElement) return getTrackState();
  if (context?.state === "suspended") await context.resume();
  if (trackElement.paused) {
    try {
      await trackElement.play();
    } catch {
      // Still paused.
    }
  } else {
    trackElement.pause();
  }
  return getTrackState();
}

/** Speaker Monitor checkbox: only a loaded file track is ever routed to the speakers. */
export function setSpeakerMonitor(enabled) {
  speakerMonitor = Boolean(enabled);
  applySpeakerMonitor();
  return getTrackState();
}

export function getTrackState() {
  return {
    loaded: Boolean(trackElement),
    name: trackName,
    playing: Boolean(trackElement && !trackElement.paused),
    currentTime: trackElement?.currentTime ?? 0,
    duration: Number.isFinite(trackElement?.duration) ? trackElement.duration : 0,
    speakerMonitor,
    monitorConnected,
  };
}

export async function setSuppressLocalAudioPlayback(enabled) {
  const track = capture?.getAudioTracks?.()[0];
  if (!track?.applyConstraints) return null;
  try {
    await track.applyConstraints({ suppressLocalAudioPlayback: Boolean(enabled) });
  } catch {
    // Chromium may only honor this constraint when the capture starts.
  }
  return track.getSettings?.() ?? null;
}

export function setFftSize(fftSize) {
  if (!analyser || !context) return false;
  if (![1024, 2048, 4096].includes(fftSize)) return false;
  analyser.fftSize = fftSize;
  if (analyserRight) analyserRight.fftSize = fftSize;
  allocateBuffers(analyser, analyserRight);
  return true;
}

export async function resumeContext() {
  if (context && context.state === "suspended") await context.resume();
  return context?.state ?? "closed";
}

export function readSnapshot() {
  if (!context || !analyser || !frequencyData || !waveformData) return null;
  analyser.getFloatFrequencyData(frequencyData);
  analyser.getFloatTimeDomainData(waveformData);
  if (analyserRight && frequencyRightData && waveformRightData) {
    analyserRight.getFloatFrequencyData(frequencyRightData);
    analyserRight.getFloatTimeDomainData(waveformRightData);
  }
  return {
    timestampSeconds: context.currentTime,
    sampleRate: context.sampleRate,
    fftSize: analyser.fftSize,
    frequencyDb: frequencyData,
    frequencyDbRight: frequencyRightData,
    waveform: waveformData,
    waveformRight: waveformRightData,
  };
}

export function getMicState() {
  return {
    micStage,
    label: MIC_STAGE_LABELS[micStage] || "",
    demoBeat: { ...demoBeat },
    attempts: micAttempts.map((entry) => entry.stage),
  };
}

export function getDiagnostics() {
  const audioTrack = capture?.getAudioTracks?.()[0] ?? null;
  const videoTracks = capture?.getVideoTracks?.() ?? [];
  return {
    mode: currentMode,
    contextState: context?.state ?? "closed",
    sampleRate: context?.sampleRate ?? null,
    fftSize: analyser?.fftSize ?? null,
    silent: destinationConnections === 0,
    destinationConnections,
    destinationRefusals,
    micStage,
    demoBeat: { ...demoBeat },
    track: getTrackState(),
    videoTrackLive: videoTracks.some((track) => track.readyState === "live"),
    audioSettings: audioTrack?.getSettings?.() ?? null,
    trackCount: capture?.getTracks?.().length ?? 0,
  };
}
