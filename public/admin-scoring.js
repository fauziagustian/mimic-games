import {api,t,escapeHTML as esc} from './platform.js';
import {decodeAudio,wavBytes} from './audio.js';
import {requestTranscription,cancelTranscriber} from './transcriber.js';
import {scoreReportMarkup} from './score-report.js';
const tr=(id,en)=>esc(t(id,en));
const models=(chosen='tiny')=>`<option value="tiny" ${chosen==='tiny'?'selected':''}>Whisper Tiny · ${tr('ringan','lighter')}</option><option value="base" ${chosen==='base'?'selected':''}>Whisper Base · ${tr('lebih besar, uji di perangkatmu','larger, test on your device')}</option>`;
const description=()=>`<p class="small">${tr('Gratis tanpa API berbayar. Model diunduh dari Hugging Face/CDN dan berjalan di perangkat ini. Base lebih berat; belum ada bukti akurasi pada meme game ini. Audio tidak dikirim ke penyedia ASR. Jangan berikan jawaban referensi sebagai petunjuk ke ASR.','No paid API. Models download from Hugging Face/CDN and run on this device. Base is heavier; accuracy on this game’s memes has not been measured. Audio is not sent to an ASR provider. Never supply the reference answer as an ASR hint.')}</p>`;
async function decodeFile(file){if(!file)throw new Error(t('Pilih file audio dahulu.','Choose an audio file first.'));if(file.size>8*1024*1024)throw new Error(t('Maksimal 8 MB.','Maximum 8 MB.'));return decodeAudio(await file.arrayBuffer());}

export function mountTranscriptAssist(form,{getAudio,getLanguage,onChange}){
  const box=document.createElement('div');box.className='panel';
  box.innerHTML=`<label>${tr('Bantuan transkrip lokal','Local transcript assistant')}<select class="draft-model">${models()}</select></label><button class="button light" type="button">${tr('Buat draft dari audio','Draft from audio')}</button><p role="status"></p>${description()}<p class="small">${tr('Dengarkan dan koreksi draft sebelum menyimpan. Transkrip referensi menjadi kunci penilaian kata.','Listen and correct the draft before saving. The reference transcript is the word-scoring answer key.')}</p>`;
  form.querySelector('#text').after(box);
  let alive=true,busy=false;
  const button=box.querySelector('button'),output=box.querySelector('[role="status"]');
  button.onclick=async()=>{
    if(busy)return;busy=true;button.disabled=true;
    // Preserve the exact form/file/language state used for inference.
    const originalText=form.querySelector('#text').value,file=form.querySelector('#file').files[0],language=getLanguage();
    try{
      output.textContent=t('Memuat model lokal; unduhan pertama bisa cukup besar…','Loading local model; the first download can be large…');
      const samples=await getAudio();if(!alive)return;
      const draft=await requestTranscription('transcribe',samples,()=>{},language,box.querySelector('select').value);
      if(!alive||!form.isConnected)return;
      if(form.querySelector('#text').value!==originalText||form.querySelector('#file').files[0]!==file||getLanguage()!==language){output.textContent=t('Form berubah. Draft tidak diterapkan; coba lagi.','Form changed. Draft was not applied; try again.');return;}
      form.querySelector('#text').value=draft.slice(0,300);onChange();output.textContent=t('Draft siap. Periksa setiap kata sebelum Simpan sound.','Draft ready. Check every word before saving.');
    }catch(e){if(alive)output.textContent=e.message;}finally{busy=false;if(alive)button.disabled=false;}
  };
  return ()=>{alive=false;cancelTranscriber();};
}
export async function soundSamples(file,url){
  if(file)return decodeFile(file);
  if(!url)throw new Error(t('Pilih audio referensi dahulu.','Choose reference audio first.'));
  const r=await fetch(url);if(!r.ok)throw new Error(t('Audio tidak tersedia.','Audio unavailable.'));return decodeAudio(await r.arrayBuffer());
}

export function mountScoringLab(root,catalog){
  let alive=true,busy=false,generation=0,source='manual',objectUrl;
  root.innerHTML=`<section class="panel"><span class="eyebrow">AUDIO → FEATURES + WORDS → POINTS</span><h2>${tr('Lab Penilaian','Scoring Lab')}</h2><p>${tr('Bandingkan sound katalog dengan rekaman mimic. Tidak mengubah skor pemain, katalog, atau leaderboard. Audio uji dikirim ke server game hanya untuk dihitung, tidak disimpan.','Compare a catalog sound with a mimic recording. Does not change player scores, catalog, or leaderboard. Test audio goes to the game server for scoring only and is not stored.')}</p><form id="scoreLab"><fieldset><label>${tr('Sound referensi','Reference sound')}<select name="sound">${catalog.sounds.map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · ${esc(s.language)}</option>`).join('')}</select></label><div id="labReference"></div><label>${tr('Profil','Profile')}<select name="profile"><option value="precision">Precision</option><option value="party">Party</option></select></label><label>${tr('Rekaman mimic (0,25–15 detik, maks. 8 MB)','Mimic recording (0.25–15 seconds, max. 8 MB)')}<input name="audio" type="file" accept="audio/*" required></label><audio id="labPreview" controls hidden></audio><label>${tr('Model transkripsi untuk uji ini','Transcription model for this test')}<select name="model">${models(catalog.rules.asrModel||'tiny')}</select></label><button type="button" class="button light" id="labTranscribe">${tr('Transkripsikan rekaman mimic','Transcribe mimic recording')}</button><label>${tr('Ucapan pemain yang terdengar','Player words heard')}<textarea name="transcript" maxlength="300" rows="3"></textarea></label><p class="small" id="labSource"></p><button class="button primary" type="submit">${tr('Hitung skor uji','Calculate test score')}</button></fieldset></form><p id="labStatus" role="status"></p>${description()}<p>${tr('Untuk menilai ASR: transkripsikan, simpan hasilnya, lalu koreksi sesuai yang terdengar dan hitung ulang. Selisih skor menunjukkan pengaruh kesalahan transkrip, bukan akurasi keseluruhan model.','To evaluate ASR: transcribe, note the output, then correct it to what you hear and rescore. The score change shows the impact of transcript errors, not overall model accuracy.')}</p></section><div id="labResult" aria-live="polite"></div>`;
  const form=root.querySelector('form'),els=form.elements,output=root.querySelector('#labStatus'),result=root.querySelector('#labResult'),preview=root.querySelector('#labPreview');
  const updateSource=()=>root.querySelector('#labSource').textContent=source==='browser-asr'?t('Hasil ASR otomatis; belum diperiksa.','Automatic ASR output; not verified.'):t('Teks manual/koreksi admin. Bukan hasil ASR otomatis.','Manual/admin-corrected text. Not automatic ASR output.');
  const reset=()=>{generation++;result.innerHTML='';};
  const reference=()=>{const s=catalog.sounds.find(s=>s.id===els.sound.value);root.querySelector('#labReference').innerHTML=s?`<audio controls preload="none" src="${esc(s.url)}"></audio><p>${esc(s.text||t('Sound tanpa kata','Non-verbal sound'))}</p><p class="small">${s.kind==='sound'?tr('Efek/nonverbal: karakter bunyi 60% + ritme 40%.','Non-verbal: timbre 60% + rhythm 40%.'):tr('Ucapan: kata dinilai hanya pada Precision.','Speech: words are assessed only in Precision.')}</p>`:'';reset();};
  const run=async fn=>{if(busy)return;busy=true;const seq=generation;form.querySelector('fieldset').disabled=true;try{await fn(()=>alive&&root.isConnected&&seq===generation);}catch(e){if(alive)output.textContent=e.message;}finally{busy=false;if(alive)form.querySelector('fieldset').disabled=false;}};
  els.sound.onchange=()=>{els.transcript.value='';source='manual';updateSource();reference();};els.profile.onchange=reset;
  els.transcript.oninput=()=>{source='manual';updateSource();reset();};
  els.audio.onchange=()=>{reset();source='manual';els.transcript.value='';updateSource();if(objectUrl)URL.revokeObjectURL(objectUrl);const file=els.audio.files[0];objectUrl=file?URL.createObjectURL(file):null;preview.hidden=!file;preview.src=objectUrl||'';};
  root.querySelector('#labTranscribe').onclick=()=>run(async current=>{
    result.innerHTML='';const s=catalog.sounds.find(s=>s.id===els.sound.value);if(!s||s.kind==='sound')throw new Error(t('Sound nonverbal tidak perlu transkrip. Langsung hitung skor.','Non-verbal sounds need no transcript. Calculate the score directly.'));
    output.textContent=t('Menjalankan ASR lokal. Jangan tutup halaman…','Running local ASR. Keep this page open…');
    const samples=await decodeFile(els.audio.files[0]);if(!current())return;
    const text=await requestTranscription('transcribe',samples,()=>{},s.language,els.model.value);if(!current())return;
    els.transcript.value=text.slice(0,300);source='browser-asr';updateSource();output.textContent=t('Transkripsi selesai. Klik Hitung skor uji.','Transcription finished. Click Calculate test score.');
  });
  form.onsubmit=e=>{e.preventDefault();run(async current=>{
    result.innerHTML='';output.textContent=t('Menganalisis…','Analyzing…');const samples=await decodeFile(els.audio.files[0]);if(!current())return;
    const response=await api('/admin/scoring-lab?'+new URLSearchParams({sound:els.sound.value,profile:els.profile.value}),{method:'POST',headers:{'Content-Type':'audio/wav','X-Transcript':encodeURIComponent(els.transcript.value),'X-Transcript-Source':source},body:wavBytes(samples)});if(!current())return;
    result.innerHTML=`<section class="panel"><h2>${response.score.total}/100</h2>${scoreReportMarkup(response.score)}</section>`;output.textContent=t('Selesai. Audio uji tidak disimpan; skor pertandingan tidak berubah.','Done. Test audio was not stored; match scores are unchanged.');
  });};
  reference();updateSource();if(!catalog.sounds.length)form.querySelector('fieldset').disabled=true;
  return ()=>{alive=false;generation++;preview.pause();if(objectUrl)URL.revokeObjectURL(objectUrl);cancelTranscriber();};
}
