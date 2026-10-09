// Deterministic game rubric. Not a biometric identity or scientific similarity measure.
export const SAMPLE_RATE = 16000;
export function normalizeText(text = "") {
  return String(text)
    .toLocaleLowerCase("id")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function wordScore(reference, attempt) {
  const a = normalizeText(reference).split(" ").filter(Boolean),
    b = normalizeText(attempt).split(" ").filter(Boolean);
  if (!a.length) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return Math.max(0, 100 * (1 - row[b.length] / Math.max(a.length, b.length)));
}
const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
function fftPower(input) {
  const n = input.length,
    re = Float64Array.from(input),
    im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    for (let k = 0; k < n; k += size)
      for (let j = 0; j < size / 2; j++) {
        const c = Math.cos(ang * j),
          s = Math.sin(ang * j),
          p = k + j,
          q = p + size / 2,
          tr = re[q] * c - im[q] * s,
          ti = re[q] * s + im[q] * c;
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
      }
  }
  return Array.from(
    { length: n / 2 + 1 },
    (_, i) => (re[i] * re[i] + im[i] * im[i]) / n,
  );
}
function pitch(frame, rms) {
  if (rms < 0.006) return 0;
  const low = 32,
    high = 266,
    corr = [];
  let max = 0;
  for (let lag = low; lag <= high; lag++) {
    let xy = 0,
      xx = 0,
      yy = 0;
    for (let i = 0; i < frame.length - lag; i++) {
      xy += frame[i] * frame[i + lag];
      xx += frame[i] * frame[i];
      yy += frame[i + lag] * frame[i + lag];
    }
    const c = xy / Math.sqrt(xx * yy + 1e-20);
    corr[lag] = c;
    max = Math.max(max, c);
  }
  if (max < 0.65) return 0;
  for (let lag = low + 1; lag < high; lag++)
    if (
      corr[lag] > 0.9 * max &&
      corr[lag] > corr[lag - 1] &&
      corr[lag] >= corr[lag + 1]
    )
      return SAMPLE_RATE / lag;
  return 0;
}
const mel = (f) => 2595 * Math.log10(1 + f / 700),
  hz = (m) => 700 * (10 ** (m / 2595) - 1);
const bins = Array.from({ length: 26 }, (_, i) =>
  Math.floor(
    (513 * hz(mel(80) + ((mel(7600) - mel(80)) * i) / 25)) / SAMPLE_RATE,
  ),
);
export function analyzeAudio(samples) {
  if (
    !(samples instanceof Float32Array) ||
    samples.length < 1600 ||
    samples.length > 240000
  )
    throw new Error("Audio harus 0,1–15 detik.");
  let peak = 0,
    sum = 0;
  for (const v of samples) {
    if (!Number.isFinite(v)) throw new Error("Audio tidak valid.");
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length),
    silent = peak < 0.008 || rms < 0.002;
  const threshold = Math.max(0.003, peak * 0.025);
  let start = 0,
    end = samples.length;
  for (; start < end && Math.abs(samples[start]) < threshold; start++);
  for (; end > start && Math.abs(samples[end - 1]) < threshold; end--);
  const trimmed = samples.slice(
    Math.max(0, start - 640),
    Math.min(samples.length, end + 640),
  );
  const frames = [];
  const gain = peak > 0.001 ? Math.min(12, 0.8 / peak) : 1;
  for (let off = 0; off + 1024 <= trimmed.length; off += 320) {
    const frame = new Float64Array(1024);
    let energy = 0;
    for (let i = 0; i < 1024; i++) {
      frame[i] = trimmed[off + i] * gain;
      energy += frame[i] ** 2;
    }
    energy = Math.sqrt(energy / 1024);
    const window = new Float64Array(512);
    for (let i = 0; i < 512; i++)
      window[i] =
        (frame[i] - (i ? frame[i - 1] * 0.97 : 0)) *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 511));
    const pow = fftPower(window),
      bands = [];
    for (let b = 1; b <= 24; b++) {
      let v = 0;
      for (let k = bins[b - 1]; k <= bins[b + 1]; k++) {
        const w =
          k < bins[b]
            ? (k - bins[b - 1]) / Math.max(1, bins[b] - bins[b - 1])
            : (bins[b + 1] - k) / Math.max(1, bins[b + 1] - bins[b]);
        v += (pow[k] || 0) * w;
      }
      bands.push(Math.log(v + 1e-10));
    }
    const mfcc = Array.from(
      { length: 12 },
      (_, k) =>
        bands.reduce(
          (s, v, i) => s + v * Math.cos((Math.PI * (k + 1) * (i + 0.5)) / 24),
          0,
        ) / 24,
    );
    frames.push({ pitch: pitch(frame, energy), energy, mfcc });
  }
  // Bound alignment work for low-powered phones, with time-preserving sampling.
  const compact =
    frames.length <= 180
      ? frames
      : Array.from(
          { length: 180 },
          (_, i) => frames[Math.floor((i * (frames.length - 1)) / 179)],
        );
  return {
    frames: compact,
    duration: trimmed.length / SAMPLE_RATE,
    rms,
    silent,
    voiced: frames.filter((f) => f.pitch > 0).length,
  };
}
function align(a, b, distance) {
  if (!a.length || !b.length) return 1;
  let previous = new Float64Array(b.length + 1).fill(Infinity);
  previous[0] = 0;
  for (let i = 1; i <= a.length; i++) {
    const row = new Float64Array(b.length + 1).fill(Infinity);
    for (let j = 1; j <= b.length; j++)
      row[j] =
        distance(a[i - 1], b[j - 1]) +
        Math.min(previous[j], row[j - 1], previous[j - 1]);
    previous = row;
  }
  return previous[b.length] / Math.max(a.length, b.length);
}
export function reactionFor(score) {
  return score === 100 ? "perfect" : score >= 50 ? "applause" : "roast";
}
export function compareAudio(reference, attempt, expectedText, actualText) {
  const a = reference.frames,
    b = attempt.frames;
  if (attempt.silent || attempt.voiced < 3 || !b.length)
    return {
      total: 0,
      pitch: 0,
      words: 0,
      timbre: 0,
      rhythm: 0,
      transcript: actualText || "",
      reaction: "roast",
      note: "Suara belum cukup jelas atau rekaman hening.",
    };
  const av = a.filter((f) => f.pitch),
    bv = b.filter((f) => f.pitch);
  const pitchLoss = align(av, bv, (x, y) =>
    Math.min(1, Math.abs(12 * Math.log2(x.pitch / y.pitch)) / 10),
  );
  const spectralLoss = align(a, b, (x, y) =>
    Math.min(
      1,
      Math.sqrt(x.mfcc.reduce((s, v, i) => s + (v - y.mfcc[i]) ** 2, 0) / 12) /
        3,
    ),
  );
  const energyLoss = align(a, b, (x, y) =>
    Math.min(
      1,
      Math.abs(Math.log((x.energy + 0.005) / (y.energy + 0.005))) / 3,
    ),
  );
  const durationLoss = Math.min(
    1,
    Math.abs(Math.log(attempt.duration / reference.duration)),
  );
  const values = {
    pitch: clamp(100 * (1 - pitchLoss)),
    words: wordScore(expectedText, actualText),
    timbre: clamp(100 * (1 - spectralLoss)),
    rhythm: clamp(100 * (1 - (0.55 * durationLoss + 0.45 * energyLoss))),
  };
  const weighted =
    0.3 * values.pitch +
    0.35 * values.words +
    0.2 * values.timbre +
    0.15 * values.rhythm;
  const perfect =
    values.words === 100 &&
    values.pitch >= 98 &&
    values.timbre >= 98 &&
    values.rhythm >= 98;
  const total = perfect ? 100 : Math.min(99, Math.round(weighted));
  return {
    ...Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, Math.round(v)]),
    ),
    total,
    transcript: actualText,
    reaction: reactionFor(total),
    note: perfect
      ? "Semua komponen mencapai ambang sempurna."
      : "Skor permainan berbasis analisis audio; mikrofon dan pembacaan kata dapat memengaruhi hasil.",
  };
}
