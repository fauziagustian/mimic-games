import {SAMPLE_RATE} from './scoring.js';

// Keep the existing component API, but show a playful audio envelope rather
// than a frequency chart. Scoring still uses its independent acoustic analysis.
export const WAVE_COLORS = {reference: '#a5a8b0', player: '#38bdf8', cursor: '#fb7185'};
const STEP = .012, clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function waveformTrack(samples, sampleRate = SAMPLE_RATE) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || samples.length / sampleRate > 15) return [];
  const size = Math.max(1, Math.round(sampleRate * STEP)), points = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0, squares = 0, valid = true;
    for (let i = start; i < end; i++) {
      const sample = samples[i];
      if (!Number.isFinite(sample)) {valid = false; break;}
      sum += sample; squares += sample * sample;
    }
    const count = end - start;
    const rms = valid ? Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2)) : 0;
    points.push({t: (start + end) / (2 * sampleRate), level: rms < .003 ? 0 : clamp(rms, 0, 1)});
  }
  return points;
}

export function waveformBars(points, {width, duration}) {
  if (!Number.isFinite(width) || !Number.isFinite(duration) || width <= 0 || duration <= 0) return [];
  const count = Math.max(1, Math.floor(width / 4)), levels = new Array(count).fill(0);
  for (const point of points) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.level) || point.t < 0 || point.t > duration) continue;
    const index = Math.min(count - 1, Math.floor(point.t / duration * count));
    levels[index] = Math.max(levels[index], clamp(point.level, 0, 1));
  }
  // One fixed visual scale for both layers. Quiet input is not inflated to fake a match.
  return levels.map((level, i) => ({x: (i + .5) * width / count, height: Math.min(1, level * 3)}));
}

export function createPitchGuide(root) {
  root.classList.add('pitch-guide');
  root.innerHTML = `<div class="wave-legend"><span><i class="reference-key"></i>Contoh</span><span><i class="player-key"></i>Kamu</span><span class="wave-phase" role="status" aria-live="polite">Siap?</span></div>
    <canvas class="wave-canvas" role="img" aria-label="Gelombang suara: contoh abu-abu, suaramu biru. Keduanya tampil sepanjang waktu rekaman yang sama."></canvas>`;
  const canvas = root.querySelector('canvas'), label = root.querySelector('.wave-phase'), context = canvas.getContext('2d');
  const cache = new WeakMap();
  let reference = [], player = [], duration = 1, cursor = null, phase = 'idle', dead = false, lastElapsed = 0;
  const track = samples => {if (!cache.has(samples)) cache.set(samples, waveformTrack(samples)); return cache.get(samples);};
  function draw() {
    if (!context || dead) return;
    const width = Math.max(160, canvas.clientWidth || 360), height = 112, ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);}
    const c = context, padding = 10, w = width - padding * 2, middle = height / 2, half = middle - 10;
    c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, width, height);
    c.strokeStyle = '#ffffff24'; c.lineWidth = 1; c.beginPath(); c.moveTo(padding, middle); c.lineTo(width - padding, middle); c.stroke();
    const paint = (points, color, lineWidth) => {
      c.strokeStyle = color; c.lineWidth = lineWidth; c.lineCap = 'round'; c.beginPath();
      for (const bar of waveformBars(points, {width: w, duration})) {
        if (!bar.height) continue;
        const size = Math.max(1, bar.height * half);
        c.moveTo(padding + bar.x, middle - size); c.lineTo(padding + bar.x, middle + size);
      }
      c.stroke();
    };
    paint(reference, WAVE_COLORS.reference, 3);
    paint(player, WAVE_COLORS.player, 2);
    if (cursor !== null) {
      const x = padding + clamp(cursor / duration, 0, 1) * w;
      c.strokeStyle = WAVE_COLORS.cursor; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, 7); c.lineTo(x, height - 7); c.stroke();
    }
  }
  const observer = globalThis.ResizeObserver ? new ResizeObserver(draw) : null;
  observer?.observe(root); draw();
  return {
    setReference(samples, seconds = samples.length / SAMPLE_RATE) {
      if (dead) return;
      reference = track(samples); player = []; duration = Math.max(seconds, samples.length / SAMPLE_RATE, .25); cursor = 0; phase = 'listen';
      label.textContent = 'Dengarkan'; draw();
    },
    begin(seconds) {
      if (dead) return;
      player = []; duration = Math.max(duration, seconds); cursor = 0; phase = 'record'; lastElapsed = 0;
      label.textContent = 'Giliranmu!'; draw();
    },
    push(frame, elapsed, sampleRate) {
      if (dead || phase !== 'record' || !frame?.length || !Number.isFinite(elapsed) || elapsed <= lastElapsed || elapsed > duration + .2 || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) return;
      const start = elapsed - frame.length / sampleRate;
      const points = waveformTrack(frame, sampleRate).map(point => ({t: start + point.t, level: point.level}));
      // Retain only new time windows. Reference data is never reused for the blue bars.
      player.push(...points.filter(point => point.t >= lastElapsed && point.t <= duration));
      lastElapsed = elapsed; cursor = Math.min(elapsed, duration); draw();
    },
    seek(seconds) {if (dead || phase === 'record' || !Number.isFinite(seconds)) return; cursor = clamp(seconds, 0, duration); draw();},
    finish(samples) {
      if (dead) return;
      player = track(samples); duration = Math.max(duration, samples.length / SAMPLE_RATE); cursor = null; phase = 'result';
      label.textContent = 'Selesai!'; draw();
    },
    pause() {if (dead) return; phase = 'paused'; cursor = null; label.textContent = 'Dijeda'; draw();},
    clear() {if (dead) return; reference = []; player = []; duration = 1; cursor = null; phase = 'idle'; label.textContent = 'Siap?'; draw();},
    dispose() {dead = true; observer?.disconnect(); reference = []; player = [];},
  };
}
