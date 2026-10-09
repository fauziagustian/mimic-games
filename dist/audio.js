import { SAMPLE_RATE } from "./scoring.js";
let context,
  playing,
  muted = false;
export function audioContext() {
  if (!context)
    context = new (window.AudioContext || window.webkitAudioContext)();
  return context;
}
export async function unlockAudio() {
  const ctx = audioContext();
  if (ctx.state === "running") return;
  let timer;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Audio diblokir browser. Ketuk Putar lagi, atau buka game di Chrome/Safari.",
              ),
            ),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function setMuted(value) {
  muted = value;
  if (value) stopAudio();
}
export function stopAudio() {
  if (playing) {
    const previous = playing;
    playing = null;
    previous.onended = null;
    try {
      previous.stop();
    } catch {}
    previous.complete?.(false);
  }
}
export async function decodeAudio(arrayBuffer) {
  const decoded = await audioContext().decodeAudioData(arrayBuffer.slice(0));
  if (decoded.duration > 15 || decoded.duration < 0.25)
    throw new Error("Pilih cuplikan sepanjang 0,25–15 detik.");
  const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    ),
    source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0).slice();
}
export function wavBytes(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(buf);
  const s = (off, text) => {
    for (let i = 0; i < text.length; i++)
      v.setUint8(off + i, text.charCodeAt(i));
  };
  s(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return buf;
}
export function pack(samples) {
  const bytes = new Uint8Array(wavBytes(samples));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function unpack(encoded) {
  if (typeof encoded !== "string" || encoded.length > 660000)
    throw new Error("Klip terlalu besar.");
  const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return decodeAudio(data.buffer);
}
export async function playSamples(samples) {
  stopAudio();
  await unlockAudio();
  const ctx = audioContext(),
    buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  playing = source;
  return new Promise((resolve) => {
    source.complete = resolve;
    source.onended = () => {
      if (playing === source) playing = null;
      resolve(true);
    };
    source.start();
  });
}
export function drawWave(canvas, samples, color = "#141515") {
  if (!canvas || !samples?.length) return;
  const w = canvas.clientWidth || 320,
    h = canvas.clientHeight || 66,
    ratio = devicePixelRatio || 1;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const c = canvas.getContext("2d");
  c.scale(ratio, ratio);
  c.clearRect(0, 0, w, h);
  c.fillStyle = color;
  const bars = Math.floor(w / 6),
    stride = Math.max(1, Math.floor(samples.length / bars));
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += (samples[i * stride + j] || 0) ** 2;
    const amp = Math.max(2, (Math.sqrt(sum / stride) / (peak || 1)) * h * 1.8);
    c.fillRect(i * 6, (h - amp) / 2, 3, amp);
  }
}
export async function recordAudio({ seconds = 15, onLevel = () => {} } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Browser ini belum mendukung rekaman. Gunakan Chrome, Edge, atau Safari terbaru melalui HTTPS.",
    );
  await unlockAudio();
  stopAudio();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  let recorder,
    interval,
    timer,
    closed = false;
  const chunks = [];
  const ctx = audioContext(),
    source = ctx.createMediaStreamSource(stream),
    analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const frame = new Float32Array(1024),
    started = performance.now();
  const release = () => {
    clearTimeout(timer);
    clearInterval(interval);
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };
  try {
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    );
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  } catch (e) {
    release();
    throw e;
  }
  const result = new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => {
      release();
      reject(new Error("Rekaman gagal. Coba izin mikrofon lagi."));
    };
    recorder.onstop = async () => {
      release();
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        resolve(await decodeAudio(await blob.arrayBuffer()));
      } catch (e) {
        reject(e);
      }
    };
  });
  recorder.start();
  interval = setInterval(() => {
    analyser.getFloatTimeDomainData(frame);
    onLevel(frame, (performance.now() - started) / 1000);
  }, 90);
  const stop = () => {
    if (!closed) {
      closed = true;
      if (recorder.state !== "inactive") recorder.stop();
      else release();
    }
  };
  timer = setTimeout(stop, seconds * 1000);
  return { stop, result };
}
export async function playReaction(kind, roastIndex = 0) {
  if (muted) return;
  try {
    await unlockAudio();
    const ctx = audioContext(),
      at = ctx.currentTime;
    const tone = (hz, start, duration, volume = 0.15, type = "triangle") => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = type;
      o.frequency.value = hz;
      g.gain.setValueAtTime(volume, at + start);
      g.gain.exponentialRampToValueAtTime(0.001, at + start + duration);
      o.connect(g).connect(ctx.destination);
      o.start(at + start);
      o.stop(at + start + duration);
    };
    if (kind === "perfect") {
      [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((hz, i) =>
        tone(hz, i * 0.14, 1.6, 0.1, "sawtooth"),
      );
      [523.25, 659.25, 783.99].forEach((hz) => tone(hz, 1.1, 2, 0.08));
    } else if (kind === "applause") {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2.4, ctx.sampleRate),
        d = buffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / ctx.sampleRate;
        let envelope = 0;
        for (let j = 0; j < 26; j++) {
          const delta = t - j * 0.08;
          if (delta >= 0 && delta < 0.14)
            envelope += Math.exp(-delta * 50) * (0.4 + (j % 4) * 0.08);
        }
        d[i] = (Math.random() * 2 - 1) * envelope * 0.22;
      }
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(ctx.destination);
      s.start();
      tone(660, 0.2, 0.5, 0.05);
      tone(880, 0.5, 0.7, 0.05);
    } else {
      tone(220, 0, 0.3, 0.13, "sawtooth");
      tone(165, 0.3, 0.35, 0.13, "sawtooth");
      tone(110, 0.65, 0.7, 0.13, "sawtooth");
      const r = await fetch(`audio/roast-${roastIndex % 3}.wav`);
      if (r.ok && !muted)
        await playSamples(await decodeAudio(await r.arrayBuffer()));
    }
  } catch {
    /* Autoplay may be blocked on spectators. The visible replay action remains available. */
  }
}
