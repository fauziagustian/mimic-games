import {decodeAudio, playSamples, stopAudio, unlockAudio, recordAudio, playReaction} from '/audio.js';
import {analyzeAudio} from '/scoring.js';
import {scoreSound, SCORING_VERSION} from '/scoring-detail.js';
import {avatarStage, preferredAvatar} from '/avatar-ui.js';
import {createPractice, shuffleSounds} from './controller.js';
import {createPitchGuide} from '/pitch-guide.js';
import {matchStandingsMarkup} from '/match-standings.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const rules = {profile: 'party', scoringVersion: SCORING_VERSION, perfectThreshold: 98, applauseThreshold: 50};
const audioCache = new Map(), featureCache = new WeakMap();
let sounds = [], deck = [], index = 0, takes = [], lastTake = null, current = {phase: 'idle'};
let previewEpoch = 0, previewing = false, reacting = false, reactionTimer, reactionEpoch = 0;
let name = 'Player';
try {name = localStorage.getItem('mimic-local-name') || name;} catch {}
if (!name.trim() || name.length > 10 || /[\p{C}]/u.test(name)) name = 'Player';
const player = {id: 'local-practice', name, avatarId: preferredAvatar(), total: 0};
$('#playerName').value = name;
$('#nameStatus').textContent = 'Nama tersimpan: ' + name;
const stage = avatarStage();
const pitchGuide = createPitchGuide($('#pitchGuide'));
const activePhases = new Set(['prepare', 'listen', 'countdown', 'record', 'scoring']);
const isActive = () => activePhases.has(current.phase);
const dirtyName = () => $('#playerName').value.trim() !== name;

function stageState() {
  const phase = current.phase === 'result' ? 'reveal' : ['listen', 'countdown'].includes(current.phase) ? 'listen' : current.phase === 'record' ? 'record' : 'lobby';
  // A rendering-only single-player state: never a multiplayer room or membership.
  const room = {phase, me: player.id, players: [{...player}], turnMode: 'sequential-v1', activePlayerId: player.id,
    recordAt: Infinity, revealIndex: 0, revealAt: Date.now() - 6000, recordSeconds: 5,
    results: current.result ? [{playerId: player.id, reaction: current.result.rating.reaction}] : []};
  return {players: room.players, room, showPicker: !deck.length, onSelect: async id => {player.avatarId = id; syncStage();}};
}
function syncStage() {
  stage.sync(stageState());
  const status = $('#stage .avatar-status');
  if (status?.textContent.includes('tersinkron') || status?.textContent.includes('Room-synced')) status.textContent = 'Latihan lokal · 1 pemain · tanpa lip-sync';
}
stage.mount($('#stage'), stageState());

function controls() {
  const active = isActive(), blocked = active || reacting;
  const done = deck.length > 0 && index >= deck.length;
  $('#start').disabled = !sounds.length || blocked || dirtyName();
  $('#start').hidden = done && current.phase === 'result';
  $('#start').textContent = index ? 'Ronde berikutnya →' : deck.length ? 'Coba giliran lagi →' : 'Mulai latihan →';
  $('#cancel').hidden = !active;
  $('#soundChoice').disabled = !sounds.length || blocked || !!deck.length;
  $('#playerName').disabled = blocked || !!deck.length;
  $('#saveName').disabled = blocked || !!deck.length;
  $('#replays').hidden = current.phase !== 'result';
  for (const id of ['hearReference', 'hearAttempt', 'retry']) $('#' + id).disabled = blocked || previewing;
  $('#reset').hidden = !deck.length;
  $('#reset').disabled = blocked;
  document.querySelectorAll('[data-preview]').forEach(button => {button.disabled = blocked;});
}

async function load(sound) {
  if (audioCache.has(sound.id)) return audioCache.get(sound.id);
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(sound.url, {signal: abort.signal});
    if (!response.ok) throw new Error('Sample tidak bisa dimuat. Pastikan server lokal masih berjalan.');
    const samples = await decodeAudio(await response.arrayBuffer());
    audioCache.set(sound.id, samples);
    return samples;
  } finally {clearTimeout(timeout);}
}
function messageFor(error) {
  if (error?.name === 'NotAllowedError') return 'Izin mikrofon ditolak. Izinkan microphone pada pengaturan situs browser, lalu klik coba lagi. Tidak ada rekaman yang dikirim.';
  if (error?.name === 'NotFoundError') return 'Mikrofon tidak ditemukan. Sambungkan mikrofon/headset dan coba lagi.';
  if (error?.name === 'NotReadableError') return 'Mikrofon tidak bisa dibuka. Periksa izin sistem atau tutup aplikasi lain yang memakai mikrofon.';
  if (error?.name === 'AbortError') return 'Sample terlalu lama dimuat. Periksa server lokal lalu coba lagi.';
  return error?.message || 'Latihan gagal. Coba lagi.';
}
function showError(message) {$('#error').textContent = message; $('#error').hidden = !message;}
function renderRating(take) {
  const rating = take.rating, labels = {pitch: 'Kontur nada relatif', rhythm: 'Ritme', timbre: 'Warna suara', words: 'Kata'};
  const reactions = {perfect: 'Bankai sempurna! ✦', applause: 'Panggung kasih tepuk tangan!', roast: 'Bankai-nya masih loading… coba lagi!'};
  const warnings = {silent: 'Suara terlalu pelan atau hening. Dekatkan mikrofon dan coba lagi.', clipped: 'Suara pecah/clipping; kurangi volume atau menjauh sedikit.', 'no-pitch': 'Nada suara belum cukup terdeteksi.', 'invalid-reference': 'Referensi audio tidak layak dinilai.'};
  $('#result').innerHTML = `<div class="score-total"><strong>${rating.total}</strong><span>/ 100</span></div><h3>${reactions[rating.reaction]}</h3><details class="score-details"><summary>Rincian skor</summary>${Object.entries(rating.weights).filter(([, weight]) => weight > 0).map(([key, weight]) => `<div class="metric"><span>${labels[key]} <small>· bobot ${Math.round(weight)}%</small></span><b>${rating[key]}/100</b><progress max="100" value="${rating[key]}" aria-label="${labels[key]}"></progress></div>`).join('')}<p class="score-note">Kata/transkrip: tidak dinilai. Nilai 100 diberikan jika semua komponen aktif mencapai ambang 98; bukan kecocokan suara identik.</p></details>${rating.warnings.map(w => `<p class="score-note">${esc(warnings[w] || w)}</p>`).join('')}`;
}
function renderHistory() {
  $('#historySection').hidden = !takes.length;
  let total = 0;
  $('#history').innerHTML = takes.map((take, round) => {
    total += take.rating.total;
    return `<li><span>Ronde ${round + 1} · ${esc(take.sound.title)}<small>+${take.rating.total} poin</small></span><strong>${total}</strong></li>`;
  }).join('');
  $('#summary').textContent = `Rincian ${takes.length} ronde · ${total} total poin`;
  $('#practiceStandings').innerHTML = takes.length ? matchStandingsMarkup({
    phase: takes.length === deck.length ? 'finished' : 'results', round: takes.length, rules: {rounds: deck.length},
    me: player.id, players: [{...player, total}], results: [{playerId: player.id, total: takes.at(-1).rating.total}],
  }, {practice: true}) : '';
}
function stopPreview() {previewEpoch++; previewing = false; stopAudio();}
function reaction(kind) {
  reacting = true;
  const epoch = ++reactionEpoch;
  void playReaction(kind, -1);
  // Shared synthesized reactions last at most 3.1s. Keep them out of the next take.
  clearTimeout(reactionTimer);
  reactionTimer = setTimeout(() => {if (epoch === reactionEpoch) {reacting = false; controls();}}, 3300);
}

const practice = createPractice({
  unlock: unlockAudio, load, play: samples => playSamples(samples, {onProgress: seconds => pitchGuide.seek(seconds)}), stopAudio,
  arm: async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Rekaman belum didukung di browser ini. Buka URL lokal di Chrome atau Safari pada laptop.');
    return navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: false}});
  },
  record: recordAudio,
  score: (reference, attempt) => {
    if (!featureCache.has(reference)) featureCache.set(reference, analyzeAudio(reference));
    return scoreSound(featureCache.get(reference), analyzeAudio(attempt), '', '', rules, 'speech', 'not-used');
  },
  onLevel: (frame, elapsed, seconds) => {
    $('#recordProgress').value = Math.min(1, elapsed / seconds);
    $('#recordTime').textContent = `${Math.max(0, seconds - elapsed).toFixed(1)} detik tersisa · sedang merekam`;
    if (elapsed >= 1) $('#cue').textContent = 'Mimic!';
  },
  onPitch: (frame, elapsed, sampleRate) => pitchGuide.push(frame, elapsed, sampleRate),
  onState: state => {
    current = state;
    if (state.phase === 'prepare') pitchGuide.clear();
    if (state.phase === 'listen') {
      pitchGuide.setReference(state.reference, Math.min(15, Math.max(2, state.sound.duration + .4)));
      $('#cue').scrollIntoView?.({block: 'start', behavior: 'auto'});
    }
    if (state.phase === 'record') pitchGuide.begin(state.seconds);
    if (state.phase === 'result') pitchGuide.finish(state.result.attempt);
    if (state.phase === 'error' || state.phase === 'idle' && deck.length) pitchGuide.pause();
    if (state.phase === 'idle' && !deck.length) pitchGuide.clear();
    const active = isActive();
    $('#roundCount').textContent = deck.length ? `Ronde ${Math.min(index + 1, deck.length)} / ${deck.length}` : '4 sample tersedia';
    $('#roundTitle').textContent = active || state.phase === 'result' || state.phase === 'error' ? state.sound.title : 'Panggung milikmu.';
    const instruction = {
      idle: state.message || 'Gunakan headphone agar contoh suara tidak ikut terekam.',
      prepare: 'Menyiapkan audio dan izin mikrofon. Belum merekam.',
      listen: 'Dengarkan contoh sampai selesai. Mikrofon masih nonaktif.',
      countdown: 'Ikuti nada dan ritmenya. Mulai bersuara saat Start.',
      record: `Giliran ${name}! Rekaman berhenti otomatis.`,
      scoring: 'Menghitung skor audio di browser…',
      result: 'Dengarkan rekamanmu, ulangi sound, atau lanjut ke ronde berikutnya.',
      error: 'Giliran belum dinilai. Perbaiki kendala di bawah lalu coba lagi.',
    };
    $('#instruction').textContent = instruction[state.phase];
    $('#cue').textContent = {idle: 'Siap?', prepare: '…', listen: 'Listen', countdown: state.cue, record: 'Start', scoring: '…', error: 'Oops'}[state.phase] || '';
    $('#cue').hidden = state.phase === 'result';
    $('#cue').classList.toggle('recording', state.phase === 'record');
    $('#captureView').hidden = state.phase !== 'record';
    if (state.phase === 'record') {$('#recordProgress').value = 0; $('#recordTime').textContent = 'Mulai bersuara sekarang';}
    $('#result').hidden = state.phase !== 'result';
    showError(state.phase === 'error' ? messageFor(state.error) : '');
    if (state.phase === 'result') {
      lastTake = state.result;
      takes[index] = lastTake;
      index++;
      player.total = takes.reduce((sum, take) => sum + take.rating.total, 0);
      renderRating(lastTake); renderHistory(); reaction(lastTake.rating.reaction);
      if (index === deck.length) $('#instruction').textContent = 'Latihan selesai! Cek rincian skor atau mulai sesi baru.';
    }
    syncStage(); controls();
  },
});

$('#nameForm').onsubmit = event => {
  event.preventDefault();
  if (isActive() || reacting || deck.length) return;
  const value = $('#playerName').value.trim();
  if (!value || value.length > 10 || /[\p{C}]/u.test(value)) {$('#nameStatus').textContent = 'Isi nama 1–10 karakter tanpa karakter kontrol.'; return;}
  name = player.name = value; $('#playerName').value = value;
  try {localStorage.setItem('mimic-local-name', value);} catch {}
  $('#nameStatus').textContent = 'Nama tersimpan: ' + value; syncStage(); controls();
};
$('#playerName').oninput = () => {$('#nameStatus').textContent = dirtyName() ? 'Simpan nama sebelum mulai.' : 'Nama tersimpan: ' + name; controls();};

$('#start').onclick = () => {
  if (practice.busy || reacting || dirtyName() || !sounds.length) return;
  stopPreview();
  if (!deck.length) deck = $('#soundChoice').value === 'all' ? shuffleSounds(sounds) : sounds.filter(sound => sound.id === $('#soundChoice').value);
  if (index < deck.length) void practice.run(deck[index]);
};
$('#cancel').onclick = () => practice.cancel('Giliran dibatalkan. Mikrofon sudah dimatikan; kamu bisa mencoba lagi.');
$('#reset').onclick = () => {
  if (isActive() || reacting) return;
  stopPreview(); deck = []; index = 0; takes = []; lastTake = null; player.total = 0;
  practice.cancel(); renderHistory(); syncStage(); controls();
};
$('#retry').onclick = () => {
  if (practice.busy || reacting || previewing || !lastTake) return;
  stopPreview(); index = Math.max(0, index - 1); takes.length = index; renderHistory();
  player.total = takes.reduce((sum, take) => sum + take.rating.total, 0);
  void practice.run(deck[index]);
};

async function preview(getSamples, label, {showReference = false} = {}) {
  if (isActive() || reacting) return;
  stopPreview();
  const epoch = previewEpoch;
  previewing = true; controls(); showError('');
  $('#instruction').textContent = label + ' · mikrofon tidak merekam.';
  try {
    await unlockAudio();
    const samples = await getSamples();
    if (epoch !== previewEpoch) return;
    if (showReference) pitchGuide.setReference(samples);
    await playSamples(samples, {onProgress: seconds => {if (epoch === previewEpoch) pitchGuide.seek(seconds);}});
  } catch (error) {if (epoch === previewEpoch) showError(messageFor(error));}
  finally {if (epoch === previewEpoch) {
    previewing = false;
    if (showReference && current.phase === 'result' && lastTake) {
      pitchGuide.setReference(lastTake.reference, Math.min(15, Math.max(2, lastTake.sound.duration + .4)));
      pitchGuide.finish(lastTake.attempt);
    }
    controls(); $('#instruction').textContent = 'Preview selesai. Gunakan headphone, lalu mulai atau lanjutkan latihan.';
  }}
}
$('#hearReference').onclick = () => preview(() => lastTake.reference, 'Memutar contoh');
$('#hearAttempt').onclick = () => preview(() => lastTake.attempt, 'Memutar mimic kamu');
$('#samples').onclick = event => {
  const button = event.target.closest('[data-preview]');
  if (!button || button.disabled) return;
  const sound = sounds.find(sound => sound.id === button.dataset.preview);
  if (sound) void preview(() => load(sound), sound.title, {showReference: true});
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  stopPreview();
  if (practice.busy) practice.cancel('Latihan dijeda karena tab ditinggalkan. Kembali ke tab ini dan coba giliran lagi.');
});
window.addEventListener('pagehide', () => {stopPreview(); practice.cancel(); stage.dispose(); pitchGuide.dispose();});
window.addEventListener('pageshow', event => {if (event.persisted) location.reload();});

try {
  const response = await fetch('/_preview/bleach/catalog.json');
  if (!response.ok) throw new Error('Sample lokal tidak tersedia. Jalankan npm run dev:bleach.');
  const catalog = await response.json(); sounds = catalog.sounds;
  if (!catalog.localOnly || !sounds?.length) throw new Error('Katalog latihan lokal tidak valid.');
  $('#soundChoice').innerHTML = '<option value="all">Acak semua · 4 ronde tanpa pengulangan</option>' + sounds.map(sound => `<option value="${esc(sound.id)}">${esc(sound.title)} · 1 ronde</option>`).join('');
  $('#samples').innerHTML = sounds.map((sound, i) => `<article class="sample"><span class="number">0${i + 1} / BLEACH</span><h3>${esc(sound.title.split(' · ')[0])}</h3><p>Bankai · Japanese · ${sound.duration.toFixed(1)} detik</p><button data-preview="${esc(sound.id)}">▶ Dengar sample</button></article>`).join('');
  controls();
} catch (error) {showError(messageFor(error));}
