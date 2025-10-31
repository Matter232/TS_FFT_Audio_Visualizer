// Visualizer.ts
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let srcNode: MediaStreamAudioSourceNode | null = null;
let rafId = 0;
let mediaStream: MediaStream | null = null;

const specCanvas = document.getElementById('spectrogram') as HTMLCanvasElement;
const specCtx = specCanvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
const scaleCanvas = document.getElementById('scale') as HTMLCanvasElement;
const scaleCtx = scaleCanvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
const statusEl = document.getElementById('status') as HTMLDivElement | null;

const micBtn = document.getElementById('micBtn') as HTMLButtonElement;
const sysBtn = document.getElementById('sysBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const visualModeEl = document.getElementById('visualMode') as HTMLSelectElement;
const fftSizeEl = document.getElementById('fftSize') as HTMLSelectElement;
const smoothingEl = document.getElementById('smoothing') as HTMLInputElement;
const minDbEl = document.getElementById('minDb') as HTMLInputElement;
const maxDbEl = document.getElementById('maxDb') as HTMLInputElement;

type VisualMode = 'spectrogram' | 'bars';
let visualMode: VisualMode = 'spectrogram';
let logBuckets: Array<{ start: number; end: number }> = [];
const BAR_COUNT = 64;
const BAR_X_AXIS_MARGIN = 18;

let floatFreqData: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(0));
let binCount = 0;

micBtn.addEventListener('click', async () => {
  await startCapture('mic');
});
sysBtn.addEventListener('click', async () => {
  await startCapture('system');
});
stopBtn.addEventListener('click', stop);

if (visualModeEl) {
  visualModeEl.addEventListener('change', () => {
    visualMode = (visualModeEl.value as VisualMode) || 'spectrogram';
    // Clear the canvas when switching modes to avoid visual artifacts
    specCtx.fillStyle = '#000';
    specCtx.fillRect(0, 0, specCanvas.width, specCanvas.height);
    updateScaleVisibility();
  });
}

fftSizeEl.addEventListener('change', applyAnalyserSettings);
smoothingEl.addEventListener('input', applyAnalyserSettings);
minDbEl.addEventListener('change', applyAnalyserSettings);
maxDbEl.addEventListener('change', applyAnalyserSettings);

type CaptureKind = 'mic' | 'system';

function setStatus(message: string, isError: boolean = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  (statusEl as HTMLDivElement).style.color = isError ? '#d33' : '#aaa';
}

function isChromiumLike(): boolean {
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) || /Edg\//.test(ua) || (window as any).chrome;
}

async function startCapture(kind: CaptureKind) {
  stop();
  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });

  try {
    if (kind === 'mic') {
      setStatus('Requesting microphone capture...');
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
    } else {
      setStatus('Waiting for display picker (enable Share tab/system audio)...');

      // Build constraints: prefer audio-only on Chromium; use generic on others.
      const chromiumAudioOnly: any = {
        video: false,
        audio: {
          selfBrowserSurface: 'include',
          systemAudio: 'include',
          suppressLocalAudioPlayback: false
        }
      };
      const genericVideoAudio: any = { video: true, audio: true };

      async function tryGetDisplayMedia(constraints: any): Promise<MediaStream> {
        return await (navigator.mediaDevices as any).getDisplayMedia(constraints) as MediaStream;
      }

      // Primary attempt
      try {
        mediaStream = await tryGetDisplayMedia(isChromiumLike() ? chromiumAudioOnly : genericVideoAudio);
      } catch (err) {
        // Fallback: if audio-only failed, try video+audio to satisfy some browsers
        try {
          mediaStream = await tryGetDisplayMedia(genericVideoAudio);
        } catch (err2) {
          throw err2;
        }
      }

      // If no audio track was granted (e.g., unchecked "Share tab audio"), bail gracefully.
      if (!mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
        console.warn('No audio track present in captured display stream.');
        setStatus('No audio track captured. Enable "Share tab audio" (tab) or "Share system audio" (entire screen).', true);
        return;
      }
    }
  } catch (e) {
    console.error('Permission or capture error', e);
    const name = (e as any)?.name || 'Error';
    const secureHint = !window.isSecureContext ? ' This page is not in a secure context; serve over http://localhost or https.' : '';
    let msg = '';
    switch (name) {
      case 'NotAllowedError':
        msg = 'Permission denied. Reclick and allow capture. Make sure audio is enabled in the picker.';
        break;
      case 'NotFoundError':
        msg = 'No capture sources available. Try selecting a tab or screen that has audio.';
        break;
      case 'NotReadableError':
        msg = 'Capture failed. Another app may be using this source, or OS blocked it.';
        break;
      case 'OverconstrainedError':
      case 'TypeError':
        msg = 'Capture constraints not supported by this browser. We tried a fallback; ensure you are on a Chromium browser for audio-only tab capture.';
        break;
      default:
        msg = 'Permission or capture error. Try again and ensure audio is enabled in the picker.';
    }
    setStatus(msg + secureHint, true);
    return;
  }

  if (!audioCtx) return;
  srcNode = audioCtx.createMediaStreamSource(mediaStream!);
  analyser = audioCtx.createAnalyser();

  applyAnalyserSettings();
  srcNode.connect(analyser);

  updateScaleVisibility();

  specCtx.fillStyle = '#000';
  specCtx.fillRect(0, 0, specCanvas.width, specCanvas.height);

  stopBtn.disabled = false;
  micBtn.disabled = true;
  sysBtn.disabled = true;

  setStatus(kind === 'mic' ? 'Capturing microphone audio.' : 'Capturing system/tab audio.');

  loop();
}

function applyAnalyserSettings() {
  if (!analyser) return;
  analyser.fftSize = parseInt(fftSizeEl.value, 10);
  analyser.smoothingTimeConstant = parseFloat(smoothingEl.value);
  analyser.minDecibels = parseFloat(minDbEl.value);
  analyser.maxDecibels = parseFloat(maxDbEl.value);

  binCount = analyser.frequencyBinCount;
  floatFreqData = new Float32Array(new ArrayBuffer(binCount * 4));

  // Recompute log buckets for bars mode
  logBuckets = makeLogBuckets(binCount, BAR_COUNT);

  if (visualMode === 'spectrogram') {
    drawFrequencyScale();
  }
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!analyser) return;

  analyser.getFloatFrequencyData(floatFreqData);
  const w = specCanvas.width;
  const h = specCanvas.height;

  if (visualMode === 'spectrogram') {
    const imageData = specCtx.getImageData(1, 0, w - 1, h);
    specCtx.putImageData(imageData, 0, 0);
    for (let i = 0; i < binCount; i++) {
      const y = binToY(i, binCount, h);
      const db = floatFreqData[i];
      const color = dbToColor(db, analyser.minDecibels, analyser.maxDecibels);
      specCtx.fillStyle = color;
      specCtx.fillRect(w - 1, y, 1, 1);
    }
  } else {
    drawBars(
      specCtx,
      floatFreqData as unknown as Float32Array,
      logBuckets,
      analyser.minDecibels,
      analyser.maxDecibels,
      w,
      h,
      BAR_X_AXIS_MARGIN
    );
    if (audioCtx) {
      drawBarsXAxis(
        specCtx,
        logBuckets,
        audioCtx.sampleRate,
        binCount,
        w,
        h,
        BAR_X_AXIS_MARGIN
      );
    }
  }
}

function stop() {
  cancelAnimationFrame(rafId);
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  if (srcNode) srcNode.disconnect();
  if (analyser) analyser.disconnect();
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();

  mediaStream = null;
  srcNode = null;
  analyser = null;
  audioCtx = null;

  stopBtn.disabled = true;
  micBtn.disabled = false;
  sysBtn.disabled = false;

  setStatus('Stopped.');
}

function dbToColor(db: number, minDb: number, maxDb: number): string {
  let norm = (db - minDb) / (maxDb - minDb);
  norm = Math.min(1, Math.max(0, norm));
  norm = Math.pow(norm, 0.5);
  const hue = (1 - norm) * 260;
  const sat = 100;
  const light = 10 + norm * 50;
  return `hsl(${hue.toFixed(1)} ${sat}% ${light.toFixed(1)}%)`;
}

function binToY(i: number, bins: number, height: number): number {
  const idx = i === 0 ? 1 : i;
  const logMin = Math.log(1);
  const logMax = Math.log(bins);
  const t = (Math.log(idx) - logMin) / (logMax - logMin);
  const y = Math.round((1 - t) * (height - 1));
  return y;
}

function drawFrequencyScale() {
  const h = scaleCanvas.height;
  scaleCtx.clearRect(0, 0, scaleCanvas.width, h);
  scaleCtx.fillStyle = '#ddd';
  scaleCtx.font = '12px system-ui';
  scaleCtx.textBaseline = 'middle';

  if (!analyser || !audioCtx) return;

  const sampleRate = audioCtx.sampleRate;
  const bins = analyser.frequencyBinCount;

  const ticks = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  scaleCtx.strokeStyle = '#444';
  scaleCtx.fillStyle = '#aaa';

  for (const f of ticks) {
    if (f > sampleRate / 2) continue;
    const bin = Math.round((f / (sampleRate / 2)) * (bins - 1));
    const y = binToY(bin, bins, h);
    scaleCtx.beginPath();
    scaleCtx.moveTo(0, y + 0.5);
    scaleCtx.lineTo(scaleCanvas.width, y + 0.5);
    scaleCtx.stroke();
    const label = f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${f}`;
    scaleCtx.fillText(label + 'Hz', 6, y);
  }
}

function updateScaleVisibility() {
  if (!scaleCanvas) return;
  if (visualMode === 'spectrogram') {
    (scaleCanvas as HTMLCanvasElement).style.display = '';
    drawFrequencyScale();
  } else {
    (scaleCanvas as HTMLCanvasElement).style.display = 'none';
    scaleCtx.clearRect(0, 0, scaleCanvas.width, scaleCanvas.height);
  }
}

function makeLogBuckets(bins: number, count: number): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  const min = 1;
  const max = bins;
  for (let i = 0; i < count; i++) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    const b0 = Math.max(1, Math.floor(Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * t0)));
    const b1 = Math.max(b0 + 1, Math.floor(Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * t1)));
    result.push({ start: b0, end: Math.min(b1, bins) });
  }
  return result;
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  buckets: Array<{ start: number; end: number }>,
  minDb: number,
  maxDb: number,
  width: number,
  height: number,
  axisBottom: number
) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const usableHeight = Math.max(1, height - axisBottom);
  const barGap = 1;
  const barWidth = Math.max(1, Math.floor((width - (buckets.length - 1) * barGap) / buckets.length));
  let x = 0;
  for (const { start, end } of buckets) {
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i++) {
      sum += data[i];
      n++;
    }
    const db = n > 0 ? sum / n : minDb;
    const norm = Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
    const amplitude = Math.pow(norm, 0.8);
    const barHeight = Math.max(1, Math.round(amplitude * usableHeight));
    const y = usableHeight - barHeight;
    ctx.fillStyle = dbToColor(db, minDb, maxDb);
    ctx.fillRect(x, y, barWidth, barHeight);
    x += barWidth + barGap;
  }
}

function drawBarsXAxis(
  ctx: CanvasRenderingContext2D,
  buckets: Array<{ start: number; end: number }>,
  sampleRate: number,
  bins: number,
  width: number,
  height: number,
  axisBottom: number
) {
  const baselineY = height - axisBottom + 0.5;
  const ticks = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];

  const barGap = 1;
  const barWidth = Math.max(1, Math.floor((width - (buckets.length - 1) * barGap) / buckets.length));

  ctx.strokeStyle = '#444';
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.beginPath();
  ctx.moveTo(0, baselineY);
  ctx.lineTo(width, baselineY);
  ctx.stroke();

  for (const f of ticks) {
    if (f > sampleRate / 2) continue;
    const bin = Math.round((f / (sampleRate / 2)) * (bins - 1));
    let bIndex = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (bin >= b.start && bin < b.end) { bIndex = i; break; }
      if (i === buckets.length - 1) bIndex = i;
    }
    const x = bIndex * (barWidth + barGap) + barWidth / 2;
    const label = f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)}k` : `${f}`;
    ctx.fillText(label, x, baselineY + 2);
  }
}