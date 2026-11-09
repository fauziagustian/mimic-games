import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankPlayers, matchStandingsMarkup} from '../public/match-standings.js';
import {runtime} from '../scripts/runtime.mjs';

const players = () => [
  {id: 'a', name: 'Arka', avatarId: 'male-e', total: 155},
  {id: 'b', name: 'Luna', avatarId: 'female-b', total: 180},
  {id: 'c', name: 'Rio', avatarId: 'male-a', total: 125},
];
const state = () => ({phase: 'results', round: 2, rules: {rounds: 4}, players: players(), me: 'a',
  results: [{playerId: 'a', total: 75}, {playerId: 'b', total: 90}, {playerId: 'c', total: 100}]});

test('match ranks use cumulative totals, preserve seating and assign shared ranks for ties', () => {
  const roster = players(), before = structuredClone(roster);
  assert.deepEqual(rankPlayers(roster).map(p => [p.id, p.rank]), [['b', 1], ['a', 2], ['c', 3]]);
  assert.deepEqual(roster, before);
  roster[0].total = 180;
  assert.deepEqual(rankPlayers(roster).map(p => [p.id, p.rank, p.tied]), [['a', 1, true], ['b', 1, true], ['c', 3, false]]);
  assert.deepEqual(rankPlayers(Array.from({length: 8}, (_, i) => ({id: String(i), total: 0}))).map(p => p.rank), Array(8).fill(1));
});

test('round cards show total plus this-round gain, without recomputing scores or premature standings', () => {
  const room = state(), before = structuredClone(room), markup = matchStandingsMarkup(room);
  assert.ok(markup.indexOf('data-player-id="b"') < markup.indexOf('data-player-id="a"'));
  assert.ok(markup.indexOf('data-player-id="a"') < markup.indexOf('data-player-id="c"'), 'last-round 100 is not the winning cumulative score');
  assert.match(markup, /<strong>155<\/strong>/); assert.match(markup, /\+75 ronde ini/);
  assert.doesNotMatch(markup, /155\s*\/\s*100/); assert.match(markup, /RONDE SELESAI · 2 \/ 4/);
  assert.equal(matchStandingsMarkup(room), markup, 'rerender/reconnect does not add points');
  assert.deepEqual(room, before);
  for (const phase of ['lobby', 'listen', 'record', 'collect', 'reveal']) assert.equal(matchStandingsMarkup({...room, phase}), '');
  assert.equal(matchStandingsMarkup(null), '');
});

test('final ties, zero/no-take, departure history, escaping, avatar allowlist and English', () => {
  const room = state(); room.phase = 'finished'; room.players[0].total = 180;
  room.players[0].name = '<img src=x>'; room.players[0].avatarId = 'https://bad.test/x';
  room.departedPlayers = [{id: 'd', name: '<script>x</script>', total: 999}];
  let markup = matchStandingsMarkup(room);
  assert.match(markup, /Juara bersama!/); assert.equal((markup.match(/#1 · SERI/g) || []).length, 2);
  assert.match(markup, /#3/); assert.match(markup, /&lt;img src=x&gt;/); assert.match(markup, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /https:\/\/bad|<script>|data-player-id="d"/);
  assert.match(markup, /<b>999 poin<\/b>/); assert.match(markup, /Pemain keluar \(1\)/);
  const english = matchStandingsMarkup(room, {language: 'en'});
  assert.match(english, /Joint winners!/); assert.match(english, /\+75 this round/); assert.match(english, /Players who left/);
  room.results = [{playerId: 'a', total: 0}]; markup = matchStandingsMarkup(room);
  assert.match(markup, /\+0 ronde ini/); assert.match(markup, /Tidak ada skor ronde ini/);
  room.players = []; markup = matchStandingsMarkup(room);
  assert.match(markup, /Tidak ada pemain yang tersisa/); assert.doesNotMatch(markup, /undefined|Juara|juara/);
});

test('Worker: three clients, two complete rounds, reordered totals, concurrent polls credit each take exactly once', async () => {
  const mf = await runtime(), db = await mf.getD1Database('DB'), origin = 'https://mimic.test';
  const call = async (path, token, body) => {
    const response = await mf.dispatchFetch(origin + path, {method: body ? 'POST' : 'GET',
      headers: {Origin: origin, ...(token ? {'X-Room-Token': token} : {})}, body: body ? JSON.stringify(body) : undefined});
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  const row = code => db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();
  const alter = async (code, fn) => {
    const saved = await row(code), room = JSON.parse(saved.data); fn(room);
    await db.prepare('UPDATE rooms SET data=? WHERE code=?').bind(JSON.stringify(room), code).run();
  };
  try {
    const host = await call('/api/rooms', null, {name: 'Arka', categoryId: 'drama', language: 'all', capacity: 3});
    const base = '/api/rooms/' + host.code, clients = [host];
    for (const name of ['Luna', 'Rio']) clients.push(await call(base + '/join', null, {name}));
    await alter(host.code, s => {s.rules.rounds = 2;});
    for (const client of clients) await call(base + '/ready', client.token, {});
    await call(base + '/start', host.token, {});
    let current = await call(base, host.token);
    const ids = current.players.map(p => p.id), totals = [0, 0, 0];
    const sharedPoll = async () => Promise.all(Array.from({length: 6}, (_, i) => call(base, clients[i % 3].token)));
    for (const [roundIndex, scores] of [[40, 80, 60], [100, 10, 40]].entries()) {
      for (let seat = 0; seat < 3; seat++) {
        assert.equal(current.phase, 'listen'); assert.equal(current.activePlayerId, ids[seat]);
        assert.equal(matchStandingsMarkup(current), '');
        const saved = await row(host.code), takeId = `score-fixture-${roundIndex}-${seat}`;
        // State-machine fixture, not an audio-quality claim. Actual take/scoring
        // validation is covered by scoring and turns tests.
        await db.prepare('INSERT INTO takes(id,match_id,round,user_id,data,audio_key) VALUES(?,?,?,?,?,?)')
          .bind(takeId, saved.match_id, roundIndex + 1, ids[seat], JSON.stringify({id: takeId, score: {total: scores[seat], reaction: 'applause'}}), 'test-only').run();
        await alter(host.code, s => {s.phase = 'collect'; s.collectUntil = Date.now() + 60000; for (const p of s.players) p.lastSeenAt = Date.now();});
        totals[seat] += scores[seat];
        for (const snapshot of await sharedPoll()) {
          assert.equal(snapshot.phase, 'reveal'); assert.equal(snapshot.results.length, seat + 1);
          assert.deepEqual(snapshot.players.map(p => p.total), totals);
          assert.equal(matchStandingsMarkup(snapshot), '', 'even the last reveal finishes before showing standings');
        }
        await alter(host.code, s => {s.revealEnd = Date.now() - 1;});
        const snapshots = await sharedPoll(); current = snapshots[0];
        for (const snapshot of snapshots) {
          assert.deepEqual(snapshot.players.map(p => p.total), totals);
          assert.equal(snapshot.phase, seat < 2 ? 'listen' : roundIndex ? 'finished' : 'results');
          assert.equal(snapshot.nextAt, current.nextAt);
        }
      }
      assert.deepEqual(rankPlayers(current.players).map(p => p.id), roundIndex ? [ids[0], ids[2], ids[1]] : [ids[1], ids[2], ids[0]]);
      assert.match(matchStandingsMarkup(current), /standings-cards/);
      if (!roundIndex) {
        await alter(host.code, s => {s.nextAt = Date.now() - 1;}); current = await call(base, host.token);
        assert.equal(current.round, 2); assert.deepEqual(current.results, []); assert.deepEqual(current.submitted, []);
        assert.deepEqual(current.players.map(p => p.total), [40, 80, 60]);
      }
    }
    assert.deepEqual(current.players.map(p => p.total), [140, 90, 100]);
    for (const snapshot of await sharedPoll()) {
      assert.equal(snapshot.phase, 'finished'); assert.deepEqual(snapshot.players.map(p => p.total), [140, 90, 100]);
    }
  } finally {await mf.dispose();}
});
