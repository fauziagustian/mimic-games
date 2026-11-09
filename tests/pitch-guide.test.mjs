import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {waveformTrack, waveformBars, createPitchGuide, WAVE_COLORS} from '../public/pitch-guide.js';
import {createPractice} from '../scripts/local-game/controller.js';
const tone = (hz, rate = 16000, seconds = .1, volume = .3) => Float32Array.from({length: Math.ceil(rate * seconds)}, (_, i) => volume * Math.sin(2 * Math.PI * hz * i / rate));

test('wave envelope handles device sample rates without inventing activity in silence/DC/invalid input', () => {
  for (const rate of [16000, 44100, 48000, 96000]) {
    const wave = waveformTrack(tone(220, rate, 1), rate);
    assert.ok(wave.length >= 83 && wave.length <= 84);
    assert.ok(wave.some(p => p.level > .2));
    assert.ok(waveformTrack(new Float32Array(rate), rate).every(p => p.level === 0));
    assert.ok(waveformTrack(new Float32Array(rate).fill(.3), rate).every(p => p.level === 0));
  }
  assert.deepEqual(waveformTrack(undefined), []);
  assert.deepEqual(waveformTrack(tone(220), 0), []);
  assert.deepEqual(waveformTrack(tone(220), Infinity), []);
  assert.ok(waveformTrack(new Float32Array(2000).fill(NaN)).every(p => p.level === 0));
});

test('wave envelope retains original time, quiet rests and finite short clips', () => {
  const raw = new Float32Array(16000 * 2); raw.set(tone(220, 16000, .5), 8000);
  const track = waveformTrack(raw);
  assert.equal(track[0].t, .006);
  assert.ok(track.filter(p => p.t < .49 || p.t > 1.02).every(p => p.level === 0));
  const first = track.find(p => p.level > 0); assert.ok(first.t >= .49 && first.t < .52);
  assert.deepEqual(waveformTrack(new Float32Array(16000 * 16)), []);
  assert.ok(waveformTrack(new Float32Array([1])).every(p => Number.isFinite(p.level)));
});

test('visual waveform shows amplitude, not pitch or a fabricated similarity score', () => {
  const average = points => points.reduce((sum, p) => sum + p.level, 0) / points.length;
  const low = average(waveformTrack(tone(100, 16000, 1))), high = average(waveformTrack(tone(400, 16000, 1)));
  assert.ok(Math.abs(high - low) < .02, 'different pitch, same amplitude gives similar envelope');
  assert.ok(average(waveformTrack(tone(220, 16000, 1, .05))) < low / 3, 'quiet microphone stays visibly quieter');
});

test('wave bars use a shared bounded time/height scale and actual gray/blue colors', () => {
  const bars = waveformBars([{t: .1, level: .2}, {t: .2, level: .1}, {t: .3, level: NaN}, {t: Infinity, level: 1}], {width: 300, duration: 1});
  assert.equal(bars.length, 75); assert.equal(bars.filter(b => b.height > 0).length, 2);
  assert.ok(bars.every(b => b.x >= 0 && b.x <= 300 && b.height >= 0 && b.height <= 1));
  assert.deepEqual(waveformBars([], {width: 0, duration: 0}), []);
  assert.equal(WAVE_COLORS.reference, '#a5a8b0'); assert.equal(WAVE_COLORS.player, '#38bdf8');
});

test('simple waveform canvas: mirrored lines, real blue input, no numerical labels and lifecycle cleanup', () => {
  const strokes = [], texts = [], nodes = new Map(); let observerDisposed = false, path = [];
  const context = new Proxy({
    beginPath() {path = [];}, moveTo(x,y) {path.push(['M',x,y]);}, lineTo(x,y) {path.push(['L',x,y]);},
    stroke() {strokes.push({color: this.strokeStyle, path: [...path]});}, fillText(text) {texts.push(text);},
  }, {get(target, name) {return target[name] ?? (() => {});}});
  const canvas = {width: 0, height: 0, clientWidth: 280, getContext: () => context};
  const root = {classList: {add() {}}, innerHTML: '', querySelector(selector) {if (selector === 'canvas') return canvas; if (!nodes.has(selector)) nodes.set(selector, {textContent: ''}); return nodes.get(selector);}};
  const OriginalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {observe() {} disconnect() {observerDisposed = true;}};
  try {
    const guide = createPitchGuide(root), reference = tone(220, 16000, 1);
    assert.match(root.innerHTML, /Contoh/); assert.match(root.innerHTML, /Kamu/);
    assert.doesNotMatch(root.innerHTML, /Hz|frekuensi|semitone|median|pitch-readings|pitch-note|PITCH GUIDE/);
    guide.setReference(reference, 1.4); guide.seek(.2);
    const referencePath = strokes.filter(s => s.color === WAVE_COLORS.reference).at(-1).path;
    assert.ok(referencePath.length > 2);
    for (let i = 0; i < referencePath.length; i += 2) assert.equal(referencePath[i][2] + referencePath[i + 1][2], 112, 'symmetric around horizontal center');
    assert.equal(strokes.filter(s => s.color === WAVE_COLORS.player).at(-1).path.length, 0, 'blue cannot appear before recording');
    guide.begin(1.4); guide.push(new Float32Array(4096), .09, 48000);
    assert.equal(strokes.filter(s => s.color === WAVE_COLORS.player).at(-1).path.length, 0, 'silent microphone must not copy reference');
    guide.push(tone(110, 48000), .2, 48000);
    const livePath = strokes.filter(s => s.color === WAVE_COLORS.player).at(-1).path;
    assert.ok(livePath.length > 0); assert.ok(livePath.every(p => p[1] < 55), 'blue does not draw ahead of microphone time');
    assert.equal(nodes.get('.wave-phase').textContent, 'Giliranmu!');
    guide.finish(reference); assert.equal(nodes.get('.wave-phase').textContent, 'Selesai!');
    const rendered = strokes.length; guide.push(tone(110), .5, 16000); assert.equal(strokes.length, rendered);
    guide.pause(); guide.clear(); assert.equal(nodes.get('.wave-phase').textContent, 'Siap?');
    assert.equal(strokes.filter(s => s.color === WAVE_COLORS.player).at(-1).path.length, 0);
    guide.dispose(); assert.equal(observerDisposed, true); const before = strokes.length; guide.begin(1); guide.seek(.2); assert.equal(strokes.length, before);
    assert.deepEqual(texts, [], 'no Hz, time ticks or numeric axes painted onto the canvas');
  } finally {globalThis.ResizeObserver = OriginalObserver;}
});

test('waveform callbacks retain device sample rate and are discarded after turn cancellation', async () => {
  let input, calls = [], resolve;
  const take = new Promise(r => {resolve = r;}), stream = {getTracks: () => [], getAudioTracks: () => []};
  const practice = createPractice({unlock: async () => {}, arm: async () => stream, load: async () => tone(220), play: async () => true,
    sleep: async () => {}, stopAudio() {}, onState() {}, onPitch: (...args) => calls.push(args),
    record: async options => {input = options; return {stop() {}, result: take};}, score: () => ({total: 80})});
  const run = practice.run({duration: 1}); await new Promise(r => setImmediate(r));
  const frame = tone(220, 48000); input.onPitch(frame, .1, 48000); assert.deepEqual(calls[0], [frame, .1, 48000]);
  practice.cancel(); input.onPitch(frame, .2, 48000); resolve(frame); await run; assert.equal(calls.length, 1);
});

test('audio hooks use device-rate waveform windows and playback clock; stopping clears callbacks (API doubles)', async () => {
  const oldWindow = globalThis.window, oldOffline = globalThis.OfflineAudioContext, oldRecorder = globalThis.MediaRecorder;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let context, source, fft, stopped = 0, pitchTick;
  class AudioContext {
    state = 'running'; sampleRate = 48000; currentTime = 0; destination = {};
    constructor() {context = this;}
    createBuffer() {return {copyToChannel() {}};}
    createBufferSource() {source = {connect() {}, start() {}, stop() {}}; return source;}
    createMediaStreamSource() {return {connect() {}, disconnect() {}};}
    createAnalyser() {return {set fftSize(value) {fft = value;}, get fftSize() {return fft;}, getFloatTimeDomainData(frame) {frame.set(tone(220, 48000, frame.length / 48000));}};}
    decodeAudioData() {return Promise.resolve({duration: .3});}
  }
  const track = {enabled: false, stop() {stopped++;}}, stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  globalThis.window = {AudioContext};
  globalThis.MediaRecorder = window.MediaRecorder = class {static isTypeSupported() {return true;} state = 'inactive'; mimeType = 'audio/webm'; start() {this.state = 'recording';} stop() {this.state = 'inactive'; this.ondataavailable({data: new Blob(['mock'])}); queueMicrotask(() => this.onstop());}};
  globalThis.OfflineAudioContext = class {createBufferSource() {return {connect() {}, start() {}};} startRendering() {return Promise.resolve({getChannelData: () => new Float32Array(3200)});}};
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: {getUserMedia: async () => stream}}});
  try {
    const {recordAudio, playSamples, stopAudio} = await import('../public/audio.js');
    const capture = await recordAudio({seconds: .2, stream, onPitch: (frame, elapsed, rate) => {pitchTick = {length: frame.length, elapsed, rate, level: waveformTrack(frame, rate)[0].level};}});
    await capture.result; assert.equal(fft, 4096); assert.equal(pitchTick.rate, 48000); assert.equal(pitchTick.length, 4096); assert.ok(pitchTick.elapsed >= .08); assert.ok(pitchTick.level > .1); assert.equal(track.enabled, false); assert.equal(stopped, 0);
    const ticks = [], playback = playSamples(tone(220, 16000, 1), {onProgress: (elapsed, duration) => ticks.push([elapsed, duration])});
    await new Promise(r => setImmediate(r)); assert.deepEqual(ticks[0], [0, 1]);
    context.currentTime = .25; await new Promise(r => setTimeout(r, 90)); assert.ok(ticks.some(([elapsed]) => elapsed === .25));
    stopAudio(); assert.equal(await playback, false); const length = ticks.length; await new Promise(r => setTimeout(r, 90)); assert.equal(ticks.length, length);
    const end = playSamples(tone(220, 16000, .1), {onProgress: (elapsed, duration) => ticks.push([elapsed, duration])});
    await new Promise(r => setImmediate(r)); source.onended(); assert.equal(await end, true); assert.deepEqual(ticks.at(-1), [.1, .1]);
  } finally {
    globalThis.window = oldWindow; globalThis.OfflineAudioContext = oldOffline; globalThis.MediaRecorder = oldRecorder;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
  }
});

test('local HTML loads simple waveform; UI keeps graph after result and no microphone request for preview', async () => {
  const html = await readFile('scripts/local-game/index.html', 'utf8'), js = await readFile('scripts/local-game/game.js', 'utf8');
  assert.match(html, /href="\/pitch-guide\.css"/); assert.match(html, /id="pitchGuide"/);
  assert.match(js, /pitchGuide\.finish\(state\.result\.attempt\)/);
  assert.match(js, /<details class="score-details"><summary>Rincian skor/);
  assert.doesNotMatch(js, /<details[^>]*open/);
  const preview = js.slice(js.indexOf('async function preview('), js.indexOf("$('#hearReference')"));
  assert.doesNotMatch(preview, /getUserMedia|recordAudio/); assert.match(preview, /pitchGuide\.finish\(lastTake\.attempt\)/);
});
