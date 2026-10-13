import {t,escapeHTML as esc} from './platform.js';
const messages={
  silent:['Rekaman hening atau terlalu lemah; tidak mendapat poin.','Silent or unusable recording; no points awarded.'],
  clipped:['Audio pecah/clipping. Turunkan volume atau menjauh dari mikrofon.','Clipped audio. Lower the level or move away from the microphone.'],
  'no-pitch':['Nada periodik tidak cukup terdeteksi. Ini bukan pengukuran identitas suara.','Not enough periodic pitch detected. This is not voice identity verification.'],
  'invalid-reference':['Referensi tidak layak dinilai; minta admin mengganti audio.','Unusable reference; ask an admin to replace the audio.'],
  'asr-unavailable':['Transkripsi gagal. Kata mendapat 0; komponen audio tetap dinilai.','Transcription failed. Words receive 0; acoustic components are still scored.'],
};
export function scoreReportMarkup(score){
  if(!score.scoringVersion)return '';
  const names={pitch:t('Nada','Pitch'),words:t('Kata','Words'),timbre:t('Karakter bunyi','Timbre'),rhythm:t('Ritme','Rhythm')};
  const metrics=Object.entries(names).map(([k,label])=>`<div class="metric"><span>${esc(label)} · ${Math.round(score.weights[k]||0)}%</span><b>${score.assessed[k]?`${score[k]}/100`:'—'}</b></div>`).join('');
  const source=score.transcriptSource==='unavailable'?t('Transkripsi tidak tersedia','Transcription unavailable'):score.transcriptSource==='admin-verified'?t('Diperiksa admin','Admin verified'):score.transcriptSource==='manual'?t('Teks uji manual; bukan hasil ASR','Manual test text; not ASR output'):t('ASR perangkat; belum diverifikasi manusia','Device ASR; not human verified');
  return `<section class="score-detail"><div class="metrics">${metrics}</div><p class="small">${esc(t('— = tidak dinilai. Bobot mengikuti jenis sound; total dihitung dari nilai sebelum pembulatan.','— = not assessed. Weights follow the sound type; the total uses unrounded values.'))}</p>${score.assessed.words?`<div class="transcript"><p><b>${esc(t('Referensi','Reference'))}:</b> ${esc(score.expectedTranscript)}</p><p><b>${esc(t('Terdengar','Heard'))}:</b> ${esc(score.transcript||'—')}</p><small>${esc(source)}</small></div>`:''}${(score.warnings||[]).map(w=>messages[w]?`<p class="notice">${esc(t(...messages[w]))}</p>`:'').join('')}<p class="small">${esc(t('Skor kemiripan dalam game, bukan persentase akurasi AI atau identitas suara.','A game similarity score, not AI accuracy or voice identity confidence.'))}</p></section>`;
}
