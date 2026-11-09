import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createLocalGameHandler} from '../scripts/local-game.mjs';
import {createPractice, shuffleSounds} from '../scripts/local-game/controller.js';
import {pcmFromWav} from '../server/validation.js';
import {analyzeAudio} from '../public/scoring.js';
import {scoreSound, SCORING_VERSION} from '../public/scoring-detail.js';
import {runtime} from '../scripts/runtime.mjs';
import {matchStandingsMarkup} from '../public/match-standings.js';

const sound = {id: 'bleach-ichigo-bankai', duration: 1.607625, title: 'Ichigo · Bankai'};
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
function fixture(overrides = {}) {
  let stopped = 0, captured = 0, scored = 0;
  const states = [], waits = [], track = {enabled: true, stop() {stopped++;}};
  const stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  const reference = new Float32Array(256).fill(.1), attempt = new Float32Array(256).fill(.2);
  const deps = {
    unlock: async () => {}, arm: async () => stream, load: async () => reference,
    play: async () => {assert.equal(track.enabled, false, 'microphone disabled during reference'); return true;},
    stopAudio() {}, sleep: async ms => {waits.push(ms);},
    record: async ({seconds, stream: armed}) => {
      captured++; assert.equal(seconds, Math.max(2, sound.duration + .4)); assert.equal(armed, stream); track.enabled = true;
      return {stop() {track.enabled = false;}, result: Promise.resolve(attempt)};
    },
    score: async (a, b) => {scored++; assert.equal(a, reference); assert.equal(b, attempt); return {total: 78};},
    onState: state => states.push(state), ...overrides,
  };
  return {practice: createPractice(deps), states, waits, stream, track, get stopped() {return stopped;}, get captured() {return captured;}, get scored() {return scored;}};
}

test('local practice uses exact countdown, disabled reference mic, actual take, and cleanup', async () => {
  const f = fixture(), take = await f.practice.run(sound);
  assert.deepEqual(f.states.map(s => s.phase), ['prepare', 'listen', 'countdown', 'countdown', 'countdown', 'countdown', 'record', 'scoring', 'result']);
  assert.deepEqual(f.states.filter(s => s.phase === 'countdown').map(s => s.cue), ['Ready', '3', '2', '1']);
  assert.equal(f.states.find(s => s.phase === 'record').cue, 'Start');
  assert.deepEqual(f.waits, [1000, 1000, 1000, 1000, 0]);
  assert.equal(take.rating.total, 78); assert.equal(f.captured, 1); assert.equal(f.scored, 1); assert.equal(f.stopped, 1); assert.equal(f.practice.busy, false);
});

test('late microphone permission after cancel stops tracks without playback or recording', async () => {
  const permission = deferred(); let playback = 0;
  const f = fixture({arm: () => permission.promise, play: async () => {playback++; return true;}});
  const running = f.practice.run(sound); await flush();
  assert.equal(f.practice.busy, true); assert.equal(await f.practice.run(sound), null, 'duplicate start ignored');
  f.practice.cancel(); permission.resolve(f.stream); await running;
  assert.equal(playback, 0); assert.equal(f.captured, 0); assert.equal(f.scored, 0); assert.equal(f.stopped, 1); assert.equal(f.practice.state.phase, 'idle');
});

test('cancellation in countdown and recorder setup does not leak or commit a score', async () => {
  const delay = deferred(), countdown = fixture({sleep: () => delay.promise});
  const round = countdown.practice.run(sound); await flush(); countdown.practice.cancel(); delay.resolve(); await round;
  assert.equal(countdown.captured, 0); assert.equal(countdown.scored, 0); assert.ok(countdown.stopped > 0);
  const setup = deferred(), decode = deferred(); let stop = 0;
  const f = fixture({record: () => setup.promise});
  const second = f.practice.run(sound); await flush(); assert.equal(f.practice.state.phase, 'record');
  f.practice.cancel(); setup.resolve({stop() {stop++; decode.reject(new Error('cancelled decode'));}, result: decode.promise}); await second;
  assert.equal(stop, 1); assert.equal(f.scored, 0); assert.equal(f.practice.state.phase, 'idle'); assert.ok(f.stopped > 0);
});

test('late cancelled take cannot overwrite a restarted turn', async () => {
  const pending = deferred(); let n = 0, stops = 0;
  const f = fixture({record: async () => ++n === 1 ? {result: pending.promise, stop() {stops++;}} : {result: Promise.resolve(new Float32Array(2)), stop() {}}, score: () => ({total: 65})});
  const old = f.practice.run(sound); await flush(); f.practice.cancel();
  await f.practice.run({...sound, id: 'new'}); pending.resolve(new Float32Array(3)); await old;
  assert.equal(stops, 1); assert.equal(f.states.filter(s => s.phase === 'result').length, 1);
  assert.equal(f.practice.state.result.sound.id, 'new');
});

test('permission denial, stopped reference, decoding and score failures permit recovery', async () => {
  const denied = fixture({arm: async () => {throw Object.assign(new Error('denied'), {name: 'NotAllowedError'});}});
  assert.equal(await denied.practice.run(sound), null); assert.equal(denied.practice.state.error.name, 'NotAllowedError'); assert.equal(denied.captured, 0); assert.equal(denied.practice.busy, false);
  const stopped = fixture({play: async () => false}); await stopped.practice.run(sound); assert.equal(stopped.practice.state.phase, 'idle'); assert.equal(stopped.captured, 0);
  for (const failAt of ['load', 'record', 'score']) {
    const f = fixture({[failAt]: async () => {throw new Error(failAt);}}); await f.practice.run(sound);
    assert.equal(f.practice.state.phase, 'error'); assert.equal(f.practice.state.error.message, failAt); assert.equal(f.practice.busy, false);
    if (failAt !== 'load') assert.ok(f.stopped > 0);
  }
});

test('shuffle is non-mutating and contains four unique samples', () => {
  const source = ['Shunsui', 'Ichigo', 'Shinji', 'Byakuya'];
  const deck = shuffleSounds(source, () => 0);
  assert.deepEqual(source, ['Shunsui', 'Ichigo', 'Shinji', 'Byakuya']); assert.notDeepEqual(deck, source);
  assert.deepEqual([...deck].sort(), [...source].sort()); assert.equal(new Set(deck).size, 4);
});

test('loopback sample router serves actual WAVs, no transcript/ASR, read-only and same-origin', async () => {
  const handler = await createLocalGameHandler();
  const server = createServer((req, res) => {if (!handler(req, res, new URL(req.url, 'http://' + req.headers.host))) res.writeHead(404).end();});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await fetch(origin + '/_preview/bleach'); assert.equal(page.status, 200); assert.match(await page.text(), /Bankai battle/);
    const response = await fetch(origin + '/_preview/bleach/catalog.json'); assert.equal(response.headers.get('cache-control'), 'no-store');
    const catalog = await response.json(); assert.equal(catalog.localOnly, true); assert.equal(catalog.sounds.length, 4);
    for (const clip of catalog.sounds) {
      assert.equal(clip.text, undefined); assert.equal(clip.transcript, undefined);
      const r = await fetch(origin + clip.url); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav');
      const samples = pcmFromWav(await r.arrayBuffer()); assert.equal(samples.length / 16000, clip.duration);
      const profile = analyzeAudio(samples), rules = {profile: 'party', scoringVersion: SCORING_VERSION};
      const score = scoreSound(profile, profile, '', '', rules, 'speech', 'not-used');
      assert.equal(score.total, 100, 'identical supplied PCM fixture'); assert.equal(score.assessed.words, false); assert.equal(score.weights.words, 0);
      assert.equal(scoreSound(profile, analyzeAudio(new Float32Array(samples.length)), '', '', rules, 'speech', 'not-used').total, 0);
      assert.equal((await fetch(origin + clip.url, {method: 'HEAD'})).status, 200);
    }
    for (const path of ['/audio/../../private-assets/bleach/manifest.json', '/audio/nope.wav', '/not-allowed.js']) {
      assert.equal((await fetch(origin + '/_preview/bleach' + path)).status, 404);
    }
    assert.equal((await fetch(origin + '/_preview/bleach/catalog.json', {method: 'POST', body: 'audio'})).status, 405);
    assert.equal((await fetch(origin + '/_preview/bleach/catalog.json', {headers: {Origin: 'https://foreign.test'}})).status, 403);
    assert.equal((await fetch(origin + catalog.sounds[0].url, {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
    const js = await (await fetch(origin + '/_preview/bleach/game.js')).text();
    assert.doesNotMatch(js, /transcriber|FormData|JSON\.stringify|pack\(/);
    assert.match(js, /visibilitychange/); assert.match(js, /pagehide/);
  } finally {await new Promise(resolve => server.close(resolve));}
});

test('hosted Worker cannot serve local practice or its private sample route', async () => {
  const mf = await runtime();
  try {
    for (const path of ['/_preview/bleach', '/_preview/bleach/game.js', '/_preview/bleach/catalog.json', '/_preview/bleach/audio/bleach-ichigo-bankai.wav']) {
      const r = await mf.dispatchFetch('https://mimic.test' + path); assert.equal(r.status, 404, path);
    }
    const catalog = await (await mf.dispatchFetch('https://mimic.test/api/catalog')).json();
    assert.equal(catalog.sounds.filter(s => s.categoryId === 'bleach').length, 4);
    const r = await mf.dispatchFetch('https://mimic.test/api/rooms', {method: 'POST', headers: {Origin: 'https://mimic.test'}, body: JSON.stringify({name: 'Tester', capacity: 1, practice: true})});
    assert.equal(r.status, 400, 'production single-player creation stays blocked');
  } finally {await mf.dispose();}
});

test('local UI wiring: saved name, four-round sequence, retry, reset and visibility cancellation (DOM doubles)', async () => {
  const nodes = new Map(), listeners = {}, storage = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, classList: {toggle() {}}});
    return nodes.get(selector);
  };
  const sampleList = ['shunsui', 'ichigo', 'shinji', 'byakuya'].map(id => ({id, title: id + ' · Bankai', duration: 2, url: '/' + id}));
  let controllerDeps, busy = false, cancellations = 0, lastSound, stageData, serial = 0;
  const pitchCalls = [];
  const controller = {get busy() {return busy;}, run(sound) {lastSound = sound; busy = true; controllerDeps.onState({phase: 'prepare', sound});}, cancel(message) {busy = false; cancellations++; controllerDeps.onState({phase: 'idle', message});}};
  const context = vm.createContext({
    document: {querySelector: node, querySelectorAll: () => [], addEventListener: (name, fn) => {listeners[name] = fn;}, hidden: false},
    window: {addEventListener: (name, fn) => {listeners[name] = fn;}},
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    avatarStage: () => ({mount(_target, data) {stageData = data;}, sync(data) {stageData = data;}, dispose() {}}), preferredAvatar: () => 'male-a',
    createPitchGuide: () => Object.fromEntries(['clear','setReference','begin','push','seek','finish','pause','dispose'].map(key => [key, (...args) => pitchCalls.push([key,...args])])),
    createPractice: deps => {controllerDeps = deps; return controller;}, shuffleSounds: x => x,
    fetch: async () => ({ok: true, json: async () => ({localOnly: true, sounds: sampleList})}),
    playReaction: async () => {}, stopAudio() {}, unlockAudio: async () => {}, recordAudio() {}, playSamples: async () => true,
    analyzeAudio() {}, scoreSound() {}, decodeAudio() {}, drawWave() {}, SCORING_VERSION, matchStandingsMarkup,
    setTimeout: fn => {listeners['timer' + (++serial)] = fn; return serial;}, clearTimeout() {},
  });
  const source = (await readFile('scripts/local-game/game.js', 'utf8')).replace(/^import .*;\n/gm, '');
  await vm.runInContext('(async()=>{' + source + '\n})()', context);
  assert.equal(node('#start').disabled, false); assert.match(node('#samples').innerHTML, /shunsui/);
  node('#playerName').value = 'Bankai'; node('#playerName').oninput(); assert.equal(node('#start').disabled, true);
  node('#nameForm').onsubmit({preventDefault() {}}); assert.equal(stageData.players[0].name, 'Bankai'); assert.equal(node('#start').disabled, false);
  node('#soundChoice').value = 'all'; node('#start').onclick(); assert.equal(lastSound.id, 'shunsui'); assert.equal(node('#soundChoice').disabled, true);
  const ref = new Float32Array(100), frame = new Float32Array(4096);
  controllerDeps.onState({phase: 'listen', sound: lastSound, reference: ref});
  controllerDeps.onState({phase: 'record', sound: lastSound, seconds: 2.4});
  controllerDeps.onPitch(frame, .1, 48000);
  assert.ok(pitchCalls.some(([name,a]) => name === 'setReference' && a === ref));
  assert.ok(pitchCalls.some(([name,a,b,c]) => name === 'push' && a === frame && b === .1 && c === 48000));
  const complete = () => {
    busy = false;
    controllerDeps.onState({phase: 'result', sound: lastSound, result: {sound: lastSound, reference: new Float32Array(1), attempt: new Float32Array(1), rating: {total: 72, pitch: 80, rhythm: 60, reaction: 'applause', weights: {pitch: 60, rhythm: 40, words: 0, timbre: 0}, warnings: []}}});
    listeners['timer' + serial]();
  };
  complete(); assert.match(node('#result').innerHTML, /72/); assert.equal(node('#start').hidden, false);
  assert.match(node('#practiceStandings').innerHTML, /<strong>72<\/strong>/);
  assert.match(node('#practiceStandings').innerHTML, /\+72 ronde ini/);
  assert.ok(pitchCalls.some(([name]) => name === 'finish'));
  node('#retry').onclick(); assert.equal(lastSound.id, 'shunsui'); complete();
  assert.match(node('#summary').textContent, /1 ronde · 72 total poin/, 'retry replaces the previous score, never adds it twice');
  for (const id of ['ichigo', 'shinji', 'byakuya']) {node('#start').onclick(); assert.equal(lastSound.id, id); complete();}
  assert.equal(node('#start').hidden, true); assert.match(node('#instruction').textContent, /selesai/); assert.equal((node('#history').innerHTML.match(/<li>/g) || []).length, 4);
  assert.match(node('#practiceStandings').innerHTML, /<strong>288<\/strong>/);
  assert.match(node('#summary').textContent, /4 ronde · 288 total poin/);
  assert.match(node('#history').innerHTML, /<strong>144<\/strong>/);
  node('#reset').onclick(); assert.equal(node('#start').hidden, false); assert.equal(node('#soundChoice').disabled, false); assert.equal(node('#historySection').hidden, true);
  assert.equal(node('#practiceStandings').innerHTML, '');
  node('#start').onclick(); context.document.hidden = true; listeners.visibilitychange(); assert.ok(cancellations >= 2); assert.equal(busy, false); assert.match(node('#instruction').textContent, /dijeda/);
});
