/**
 * Analysis-only capture. The graph ends at AnalyserNode.
 * Deliberately absent: source.connect(context.destination);
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

export function setVideoSink(element) {
  videoSink = element;
}

export function getAudioContext() {
  return context;
}

export async function stopCapture() {
  session += 1;
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
  try {
    nextCapture = await capturePromise;
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
    return { context, source, analyser, audioSettings: audioTrack.getSettings() };
  } catch (error) {
    if (token !== session) throw error;
    return failStart(nextCapture, nextContext, error);
  }
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

export function getDiagnostics() {
  const audioTrack = capture?.getAudioTracks?.()[0] ?? null;
  const videoTracks = capture?.getVideoTracks?.() ?? [];
  return {
    mode: currentMode,
    contextState: context?.state ?? "closed",
    sampleRate: context?.sampleRate ?? null,
    fftSize: analyser?.fftSize ?? null,
    silent: true,
    destinationConnections: 0,
    destinationRefusals,
    videoTrackLive: videoTracks.some((track) => track.readyState === "live"),
    audioSettings: audioTrack?.getSettings?.() ?? null,
    trackCount: capture?.getTracks?.().length ?? 0,
  };
}
