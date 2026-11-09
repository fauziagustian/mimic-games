import {api,t,escapeHTML as esc,categoryName,uiLanguage,mountNavigation} from './platform.js';
import {decodeAudio,playSamples,drawWave,recordAudio,wavBytes,stopAudio,unlockAudio,setMuted,playReaction} from './audio.js';
import {requestTranscription,modelReadyFor} from './transcriber.js';
import {scoreReportMarkup} from './score-report.js';
import {avatarStage,preferredAvatar,avatarImage} from './avatar-ui.js';
import {loadSite} from './site-ui.js';
import {soundPicker} from './sound-picker.js';
import {isSequential,isMyTurn,turnKey,mayCapture,turnCue} from './turns.js';
import {gameRoute,characterUrl,matchingUrl,roomUrl,parseRoomSession} from './game-routing.js';
import {homePage,characterPage,createPage,matchingPage,activeRoomPage,pageHeading} from './game-pages.js';
import {stageName,matchRequirements,roomCapacity} from './match-rules.js';
import {categoryScope} from './categories.js';
import {rankPlayers,matchStandingsMarkup} from './match-standings.js';
import {soundEligibleForProfile} from './catalog.js';
const $=s=>document.querySelector(s),app=$('#app'),tr=t,label=(id,en)=>esc(t(id,en));
const avatars=avatarStage();
let catalog,account,site,picker,session=null,room=null,mic=null,capture=null,polling=false,offset=0,muted=false,busy=false,lastRender='',pendingTake=null,creating=false,joining=false;
let lastContact=0,pollController=null;
const clips=new Map(),cues=new Set();
let setup={categoryId:'drama',language:'all',mode:'casual',profile:'party',matchType:'custom',capacity:8};
const route=()=>gameRoute(location.href);
const onRoomPage=()=>{const r=route();return !!session&&(r.page==='play'&&r.code===session.code||r.page==='matching'&&(!r.code||r.code===session.code));};
const onPlayPage=()=>route().page==='play'&&route().code===session?.code;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),6500);}
function bind(selector,fn){const el=$(selector);if(el)el.onclick=async()=>{try{await fn();}catch(e){toast(e.message);}};}
async function roomApi(action='',options={}){return api(`/rooms/${session.code}${action?'/'+action:''}`,{...options,headers:{'X-Room-Token':session.token,...options.headers}});}
async function loadClip(c){if(!clips.has(c.id)){const response=await fetch(c.url);if(!response.ok)throw new Error(tr('Sound gagal dimuat.','Sound could not load.'));clips.set(c.id,await decodeAudio(await response.arrayBuffer()));}return clips.get(c.id);}
function name(){const value=stageName(localStorage.getItem('mimic-name'));if(!value)throw new Error(tr('Simpan nama panggung 1–10 karakter dulu.','Save a 1–10 character stage name first.'));return value;}
function navigate(url,replace=false){
 const target=new URL(url,location.origin);if(target.origin!==location.origin||gameRoute(target.href).page==='unknown')return;
 if(location.pathname+location.search!==target.pathname+target.search)history[replace?'replaceState':'pushState']({},'',target.pathname+target.search);
 stopAudio();if(!onPlayPage())capture?.stop();lastRender='';renderScreen();window.scrollTo({top:0,behavior:'instant'});app.focus({preventScroll:true});
}
function renderScreen(){
 if(!catalog)return;
 const r=route();app.dataset.page=r.page;avatars.detach();
 if(r.page==='home'){home();return;}
 if(r.page==='character'){chooseCharacter();return;}
 if(r.page==='create'){
   if(session){app.innerHTML=activeRoomPage(session);bind('#leave',()=>leave('/create-match'));return;}
   if(!stageName(localStorage.getItem('mimic-name'))){navigate(characterUrl('create'),true);return;}
   renderCreate();return;
 }
 if(r.page==='play'&&!session){navigate(matchingUrl(r.code),true);return;}
 if(r.page==='matching'||r.page==='play'){
   if(session&&r.code&&r.code!==session.code){app.innerHTML=activeRoomPage(session);bind('#leave',()=>leave(matchingUrl(r.code)));return;}
   if(session){
     if(!room){app.innerHTML=`<section class="panel"><h2>${label('Menyambungkan room…','Connecting to room…')}</h2><button class="button light" id="retryRoom">${label('Coba lagi','Retry')}</button></section>`;bind('#retryRoom',poll);return;}
     const wanted=roomUrl(room);if(location.pathname+location.search!==wanted){navigate(wanted,true);return;}
     renderRoom(true);return;
   }
   const operator=['owner','admin'].includes(account.user?.role);
   app.innerHTML=matchingPage({code:r.code,name:localStorage.getItem('mimic-name')||'',avatarId:preferredAvatar(),paused:(!site.settings.acceptNewRooms||!site.settings.allowJoins)&&!operator});
   // Keep invite context when changing identity.
   const edit=$('.identity-summary a');if(edit)edit.href=characterUrl('matching',r.code);
   $('#joinForm').onsubmit=e=>{e.preventDefault();join().catch(e=>toast(e.message));};return;
 }
 navigate('/',true);
}
function home(){
 avatars.detach();app.innerHTML=homePage({site,session,name:localStorage.getItem('mimic-name')||''});
}
function chooseCharacter(){
 const r=route(),inRoom=!!session&&room?.phase==='lobby';
 if(session&&room&&room.phase!=='lobby'){navigate(roomUrl(room),true);return;}
 const player=inRoom?room.players.find(p=>p.id===room.me):null;
 let savedName=player?.name||localStorage.getItem('mimic-name')||'',saving=false;
 app.innerHTML=characterPage({name:savedName,inRoom,next:inRoom?'lobby':r.next,code:inRoom?session.code:r.code});
 avatars.mount($('#characterStage'),{room:inRoom?room:null,players:inRoom?room.players:[{id:'you',name:savedName||tr('Kamu','You'),avatarId:preferredAvatar()}],offset,showPicker:true,
   onSelect:inRoom?async avatarId=>{await roomApi('avatar',{method:'POST',body:{avatarId}});await poll();avatars.sync({room,players:room.players,offset});}:undefined,onError:e=>toast(e.message)});
 const input=$('#nickname'),form=$('#characterForm'),save=$('#saveName'),next=$('#continueCharacter'),status=$('#nameStatus'),counter=$('#nameCount');
 const update=()=>{
   const value=stageName(input.value),dirty=value!==savedName;
   counter.textContent=input.value.length+'/10';
   input.setAttribute('aria-invalid',String(!value));
   save.disabled=saving||!value||!dirty;next.disabled=saving||!value||dirty;
   input.readOnly=saving;
   save.textContent=saving?tr('Menyimpan…','Saving…'):tr('Simpan nama','Save name');
   status.textContent=saving?tr('Menyimpan nama ke panggung…','Saving your stage name…'):!value?tr('Nama wajib 1–10 karakter.','Name must be 1–10 characters.'):dirty?tr('Belum disimpan. Klik Simpan nama untuk memperbarui panggung.','Unsaved. Click Save name to update the stage.'):tr('✓ Nama tersimpan dan tampil di panggung.','✓ Name saved and displayed on stage.');
 };
 input.oninput=update;
 save.onclick=async()=>{
   const value=stageName(input.value);if(saving||!value)return;
   const activeSession=session;saving=true;update();
   try{
     if(inRoom){
       await roomApi('name',{method:'POST',body:{name:value}});
       const updated=await roomApi();if(session===activeSession&&(!room||updated.revision>=room.revision))room=updated;
     }
     savedName=value;localStorage.setItem('mimic-name',value);
     if(form.isConnected&&route().page==='character'){
       input.value=value;
       avatars.sync(inRoom?{room,players:room.players,offset}:{players:[{id:'you',name:value,avatarId:preferredAvatar()}]});
     }
   }catch(e){toast(e.message);}
   finally{saving=false;if(form.isConnected)update();}
 };
 form.onsubmit=e=>{e.preventDefault();if(next.disabled)return;localStorage.setItem('mimic-name',savedName);navigate(inRoom?roomUrl(room):r.next==='create'?'/create-match':matchingUrl(r.code));};
 update();
}
function renderCreate(){
 app.innerHTML=createPage({catalog,setup,name:localStorage.getItem('mimic-name')||'',avatarId:preferredAvatar(),manual:!!picker.payload().soundIds});
 const refresh=()=>{
   setup={categoryId:$('#subcategory')?.value||$('#category').value,language:$('#language').value,mode:'casual',profile:$('#profile').value,matchType:$('#matchType').value,capacity:Number($('#capacity').value)};
   sessionStorage.setItem('mimic-setup',JSON.stringify(setup));
   const themeIds=new Set(categoryScope(catalog.categories,setup.categoryId));
   const sounds=catalog.sounds.filter(c=>c.quality?.usable!==false&&themeIds.has(c.categoryId)&&(setup.language==='all'||c.language===setup.language)&&soundEligibleForProfile(c,setup.profile)&&c.duration<=catalog.rules.recordSeconds);
   $('#soundCount').textContent=' · '+sounds.length;
   $('#soundCards').innerHTML=sounds.length?sounds.map(c=>`<article class="clip-card"><div class="clip-top"><span>${esc(catalog.languages.find(l=>l.id===c.language)?.label||c.language)}</span><button class="play-circle" data-play="${esc(c.id)}" aria-label="Play ${esc(c.title)}">▶</button></div><h3>${esc(c.title)}</h3><p class="quote-text">${esc(c.text)}</p><span class="small">${c.duration.toFixed(1)}s · ${esc(c.source)}</span></article>`).join(''):`<div class="empty">${label('Belum ada sound. Coba kategori atau bahasa lain.','No sounds here. Try another category or language.')}</div>`;
   document.querySelectorAll('[data-play]').forEach(b=>b.onclick=async()=>{try{const samples=await loadClip(sounds.find(c=>c.id===b.dataset.play));if(route().page==='create')await playSamples(samples);}catch(e){toast(e.message);}});
   picker.render();if(creating)$('#create').disabled=true;
 };
 $('#category').onchange=()=>{setup.categoryId=$('#category').value;picker.reset?.();renderCreate();};
 for(const id of ['subcategory','language','profile','capacity'])$('#'+id).onchange=refresh;
 $('#matchType').onchange=()=>{setup.matchType=$('#matchType').value;if(setup.matchType==='solo')setup.capacity=8;renderCreate();};
 refresh();bind('#create',create);
}
function saveSession(s){session=s;room=null;lastContact=0;pendingTake=null;sessionStorage.setItem('mimic-room',JSON.stringify(s));cues.clear();lastRender='';}
async function create(){
 if(creating)return;if(session)throw new Error(tr('Keluar dari room aktif terlebih dahulu.','Leave the current room first.'));
 const nickname=name();creating=true;$('#create').disabled=true;
 try{saveSession(await api('/rooms',{method:'POST',body:{...setup,...(setup.matchType==='solo'?{}:picker.payload()),name:nickname,avatarId:preferredAvatar(),mode:'casual'}}));navigate(matchingUrl(session.code));await poll();}
 finally{creating=false;if(route().page==='create')renderCreate();}
}
async function join(){
 if(joining)return;
 if(session)throw new Error(tr('Keluar dari room aktif terlebih dahulu.','Leave the current room first.'));
 const code=$('#code').value.trim().toUpperCase();
 if(!/^[A-Z2-9]{6}$/.test(code))throw new Error(tr('Kode room terdiri dari 6 huruf/angka.','Enter a six-character room code.'));
 if(!stageName(localStorage.getItem('mimic-name'))){navigate(characterUrl('matching',code));return;}
 const button=$('#joinForm button');joining=true;button.disabled=true;
 try{saveSession(await api(`/rooms/${code}/join`,{method:'POST',body:{name:name(),avatarId:preferredAvatar()}}));navigate(matchingUrl(session.code));await poll();}
 finally{joining=false;if(button.isConnected)button.disabled=false;}
}
async function ready(){const activeSession=session,current=room;busy=true;renderRoom(true);try{await unlockAudio();await Promise.all(current.clips.map(loadClip));if(current.profile==='precision'&&current.clips.some(c=>c.kind!=='sound')&&!modelReadyFor(current.rules.asrModel)){toast(tr('Menyiapkan pengenal kata. Unduhan model pertama bisa cukup besar.','Preparing local speech recognition. The first model download can be large.'));await requestTranscription('load',null,p=>{if($('#readyStatus'))$('#readyStatus').textContent=p.progress?`${tr('Mengunduh','Downloading')} ${Math.round(p.progress)}%`:tr('Menyiapkan model…','Preparing model…');},'indonesian',current.rules.asrModel||'tiny');}if(session!==activeSession||!onRoomPage())return;mic?.getTracks().forEach(t=>t.stop());const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});if(session!==activeSession||!onRoomPage()){stream.getTracks().forEach(t=>t.stop());return;}mic=stream;mic.getAudioTracks().forEach(t=>t.enabled=false);if(room.phase==='lobby')await roomApi('ready',{method:'POST'});}finally{busy=false;renderRoom(true);}}
function playersMarkup(){
 const completed=['results','finished'].includes(room.phase),players=completed?rankPlayers(room.players):room.players;
 return players.map(p=>{const index=room.players.findIndex(x=>x.id===p.id),active=isSequential(room)&&room.activePlayerId===p.id,done=room.results?.some(r=>r.playerId===p.id);
 const status=room.phase==='lobby'?(p.ready?tr('Siap','Ready'):tr('Belum siap','Not ready')):active?tr('Giliran sekarang','On stage now'):done?tr('Selesai','Done'):room.submitted.includes(p.id)?tr('Rekaman masuk','Take received'):isSequential(room)?tr('Menunggu giliran','Waiting for turn'):tr('Di arena','In the arena');
 return `<div class="player ${active?'active':''}"><span class="turn-number">${completed?'#'+p.rank:index+1}</span><span class="avatar">${avatarImage(p.avatarId)}</span><div class="player-info"><b>${esc(p.name)}${p.id===room.me?' · '+tr('kamu','you'):''}${p.id===room.hostId?' · host':''}</b><span class="small">${esc(status)}</span></div><span class="player-score">${p.total}</span></div>`;}).join('');
}
function presenceMarkup(){
 const event=room.lastDeparture;if(!event||event.round===0||room.phase==='finished')return '';
 return `<p class="notice" role="status">${esc(event.names.join(', '))} · ${event.reason==='disconnected'?label('terputus','disconnected'):label('keluar','left')}. ${room.players.length} ${label('pemain tersisa. Permainan dilanjutkan tanpa menunggu room penuh.','players remain. The match continues without refilling the room.')}</p>`;
}
function lobbyMarkup(){
 const requirements=matchRequirements(room),solo=room.matchType==='solo',ownReady=room.players.find(p=>p.id===room.me)?.ready;
 return `<span class="eyebrow">BACKSTAGE / ${room.profile.toUpperCase()}</span><h2>${esc(categoryName(room.theme||catalog.categories.find(x=>x.id===room.categoryId)))}</h2><div class="rules-banner"><span>${room.rules.rounds} ${label('ronde','rounds')}</span><span>${label('Maks.','Max.')} ${room.rules.recordSeconds}s</span><span>${room.clips.length} sounds</span></div><p>${label('Ready → 3 → 2 → 1 → Start. Satu pemain, satu take. Bergiliran sesuai urutan lobby.','Ready → 3 → 2 → 1 → Start. One player, one take. Take turns in lobby order.')}</p><div class="match-gates" aria-live="polite"><b>${solo?'SOLO MATCHMAKING':'CUSTOM MATCH'} · ${room.players.length}/${requirements.capacity} ${label('pemain','players')}</b><p>${requirements.full?label('✓ Room penuh','✓ Room full'):label(`Menunggu ${Math.max(0,requirements.capacity-room.players.length)} pemain lagi. Room wajib penuh.`,`Waiting for ${Math.max(0,requirements.capacity-room.players.length)} more players. Every slot must be filled.`)}</p><p>${requirements.ready}/${requirements.capacity} ${label('pemain siap','players ready')}${!requirements.namesValid?' · '+label('Ada nama yang harus diperbarui (maks. 10 karakter).','A name needs updating (max. 10 characters).'):''}</p><span class="small">${solo?label('Battle otomatis mulai setelah 8/8 pemain siap. Sound acak sesuai pilihan kategori.','Battle starts automatically when all 8/8 players are ready. Random sounds from your selected category.'):label('Hanya host yang bisa mulai setelah room penuh dan semua pemain siap.','Only the host can start once the room is full and everyone is ready.')}</span></div><div class="notice">${label('Siap meminta izin mikrofon. Rekaman hanya aktif saat giliranmu, lalu dibagikan ke pemain room. Gunakan headset.','Ready requests microphone access. Recording is active only on your turn, then shared with room players. Use headphones.')}</div><p id="readyStatus" role="status">${busy?label('Menyiapkan sound & mikrofon…','Preparing sounds & microphone…'):mic?(solo?label('Mikrofon siap. Menunggu 8 pemain siap.','Microphone armed. Waiting for all 8 players.'):label('Mikrofon siap. Tunggu host memulai.','Microphone armed. Waiting for the host.')):''}</p><div class="match-actions"><button class="button green" id="ready" ${busy||(mic&&ownReady)?'disabled':''}>${mic?'✓ '+label('Mikrofon siap','Microphone armed'):label('Siap & izinkan mikrofon','Ready & allow microphone')}</button>${room.host&&!solo?`<button class="button primary" id="start" ${!requirements.canStart||!mic||busy?'disabled':''}>${label('Mulai battle','Start battle')} →</button>`:''}</div><p class="small">${label('Jaga tab tetap aktif. Koneksi terputus sekitar 30 detik akan mengosongkan slot; sebelum mulai, room tetap wajib penuh.','Keep this tab active. A disconnect of about 30 seconds frees your slot; the lobby must still be full to start.')}</p><details><summary>${label('Penilaian & privasi rekaman','Scoring & recording privacy')}</summary><p>${room.profile==='party'?label('Party: pola nada relatif 60% + ritme 40%.','Party: relative pitch pattern 60% + rhythm 40%.'):label(`Precision: nada ${room.rules.weights.pitch}%, kata ${room.rules.weights.words}%, karakter ${room.rules.weights.timbre}%, ritme ${room.rules.weights.rhythm}%.`,`Precision: pitch ${room.rules.weights.pitch}%, words ${room.rules.weights.words}%, timbre ${room.rules.weights.timbre}%, rhythm ${room.rules.weights.rhythm}%.`)}</p>${room.rules.scoringVersion?`<p>${label('Efek/nonverbal: karakter bunyi 60% + ritme 40%. Jika nada referensi tidak cukup terdeteksi, bobot nada dikeluarkan; rincian bobot tampil pada hasil.','Non-verbal effects: timbre 60% + rhythm 40%. Insufficient reference pitch is excluded; actual weights appear in the results.')}</p>`:''}<p>${label('Take disimpan di server untuk playback room. Pembersihan otomatis belum tersedia. Jangan rekam ucapan sensitif. Skor merupakan rubrik permainan, bukan akurasi identitas suara.','Takes are stored on the server for room playback. Automatic deletion is not available. Do not record sensitive speech. Scores are a game rubric, not voice identity accuracy.')}</p></details>`;
}
function renderLobby(){
 app.dataset.page='matching';app.innerHTML=`<section class="flow-page lobby-page">${pageHeading('03 / GAME MATCHING',label('GENG SUDAH SIAP?','IS THE CREW READY?'),(room.matchType==='solo'?label('Mencari 8 pemain dengan kategori, bahasa, dan profil yang sama. Semua harus tekan Siap.','Finding 8 players with the same category, language and profile. Everyone must press Ready.'):label('Bagikan kode, tunggu teman, lalu semua tekan Siap.','Share the code, wait for friends, then everyone gets Ready.')))}<div class="lobby-layout"><section class="panel">${lobbyMarkup()}</section><aside class="stack"><section class="panel invite-panel"><span class="eyebrow">${room.matchType==='solo'?'SOLO QUEUE':'ROOM CODE'}</span><strong class="room-code">${esc(room.code)}</strong>${room.matchType!=='solo'?`<button class="button light" id="copy">${label('Salin undangan','Copy invite')}</button>`:'<p class="small">'+label('Pemain masuk melalui antrean solo, bukan kode undangan.','Players join through solo matchmaking, not an invite code.')+'</p>'}</section><section class="panel"><div class="section-heading"><h3>${label('Urutan pemain','Player order')}</h3><span class="tag">${room.players.length}/${roomCapacity(room)}</span></div>${playersMarkup()}<a class="text-button" data-game-link href="${characterUrl('lobby',room.code)}">${label('Ganti karakter di halaman karakter','Edit on the character page')} →</a></section><button class="text-button" id="leave">${label('Keluar dari room','Leave room')}</button></aside></div></section>`;
 bindRoomActions();
}
function bindRoomActions(r){
 bind('#leave',()=>leave());bind('#newGame',()=>leave('/create-match'));bind('#ready',ready);
 bind('#start',async()=>{await roomApi('start',{method:'POST'});await poll();});
 bind('#copy',async()=>{await navigator.clipboard.writeText(location.origin+matchingUrl(room.code));toast(tr('Undangan disalin.','Invite copied.'));});
 bind('#replay',()=>playTake(r));bind('#retryUpload',sendTake);
}
function resultMarkup(r){return `<span class="eyebrow">${label('PUTAR HASIL','THE REVEAL')} ${room.revealIndex+1} · ${esc(r.name)}</span><div class="result-score">${r.total}<small>/100</small></div><h2>${r.reaction==='perfect'?'100% LEGEND.':r.reaction==='applause'?'RESPECT.':tr('WADUH. KENA ROAST.','OUCH. ROASTED.')}</h2><p>${esc(room.rules[r.reaction+(uiLanguage()==='en'?'En':'Id')])}</p>${r.scoringVersion?scoreReportMarkup(r):`<div class="metrics">${(room.profile==='party'?[['pitch',tr('Pola nada','Pitch pattern')],['rhythm',tr('Ritme','Rhythm')]]:[['pitch',tr('Nada','Pitch')],['words',tr('Kata','Words')],['timbre',tr('Karakter','Timbre')],['rhythm',tr('Ritme','Rhythm')]]).map(([k,l])=>`<div class="metric"><span>${esc(l)}</span><b>${r[k]||0}/100</b></div>`).join('')}</div>${room.profile==='precision'?`<p class="transcript">${label('Terdengar:','Heard:')} ${esc(r.transcript||'—')}</p>`:''}`}<canvas class="waveform" id="stageWave"></canvas><button class="button light" id="replay" ${r.takeId?'':'disabled'}>▶ ${label('Putar ulang','Replay')}</button><p class="small">${r.rankedStatus==='pending'?label('Menunggu verifikasi admin.','Awaiting admin verification.'):r.rankedStatus==='rejected-replay'?label('Tidak masuk leaderboard: terdeteksi audio referensi/rekaman berulang.','Not ranked: reference or reused recording detected.'):''}</p>`;}
function playStageMarkup(c){
 const active=room.players.find(p=>p.id===room.activePlayerId),mine=isMyTurn(room);
 return `<div class="section-heading"><span class="eyebrow">${label('RONDE','ROUND')} ${room.round}/${room.rules.rounds}</span><span class="tag">${isSequential(room)?label('GILIRAN','TURN')+' '+(room.players.findIndex(p=>p.id===room.activePlayerId)+1)+'/'+room.players.length:label('BERSAMA','TOGETHER')}</span></div>
 ${active?`<div class="turn-spotlight"><span class="eyebrow">${mine?label('GILIRAN KAMU','YOUR TURN'):label('DI PANGGUNG','ON STAGE')}</span><h2>${esc(active.name)}</h2><p>${mine?label('Satu kesempatan. Tunjukkan versi terbaikmu.','One take. Give us your best version.'):label('Tonton dulu. Mikrofonmu tidak merekam di giliran ini.','Watch this turn. Your microphone is not recording.')}</p></div>`:''}
 <h2>${esc(c?.title)}</h2><p class="quote">“${esc(c?.text)}”</p><canvas class="waveform" id="stageWave"></canvas>
 <div class="turn-countdown"><div class="big-count" id="countdown" role="status" aria-live="polite" aria-atomic="true"></div><p id="captureStatus"></p></div>
 ${!mic?`<button class="button green" id="ready" ${busy?'disabled':''}>${label('Aktifkan kembali mikrofon','Re-arm microphone')}</button>`:''}
 ${pendingTake?.status==='error'&&pendingTake.round===room.round&&mine?`<button class="button light" id="retryUpload">${label('Kirim ulang rekaman yang sama','Retry the same recording')}</button>`:''}
 <p class="small">${label('Tetap buka tab ini. Koneksi terputus sekitar 30 detik membuatmu keluar, termasuk saat browser menghentikan tab di latar belakang. Pemain lain tetap lanjut.','Keep this tab active. About 30 seconds without a connection removes you, including when a browser suspends a background tab. Others keep playing.')}</p>`;
}
function renderRoom(force=false){if(!room||!onRoomPage())return;if(room.phase==='lobby'){const key=JSON.stringify([room.revision,busy,!!mic,uiLanguage()]);if(!force&&key===lastRender)return;lastRender=key;avatars.detach();renderLobby();return;}app.dataset.page='play';avatars.sync({room,players:room.players,offset});const key=JSON.stringify([room.revision,room.submitted,busy,!!mic,uiLanguage(),pendingTake?.status]);if(!force&&key===lastRender)return;lastRender=key;avatars.detach();const c=room.clips.find(c=>c.id===room.queue[room.round-1]),r=room.results?.[room.revealIndex],lobby=room.phase==='lobby',finished=room.phase==='finished';
 const stage=lobby?lobbyMarkup():finished?`${matchStandingsMarkup(room,{language:uiLanguage()})}<button class="button primary standings-rematch" id="newGame">${label('Kembali ke arena','Back to the arena')}</button>`:room.phase==='reveal'&&r?resultMarkup(r):room.phase==='results'?`${matchStandingsMarkup(room,{language:uiLanguage()})}<div class="round-next"><span>${label('Ronde berikutnya dalam','Next round in')}</span><span id="countdown"></span></div>`:playStageMarkup(c);

 app.innerHTML=`<div class="game-topline"><span class="eyebrow">ROOM ${esc(room.code)} / ${room.profile.toUpperCase()} · ${room.players.length} ${label('PEMAIN AKTIF','ACTIVE PLAYERS')}</span><button class="text-button" id="leave">${label('Keluar','Leave')}</button></div>${presenceMarkup()}<div class="battle-grid gameplay-layout"><section class="stage ${finished||room.phase==='results'?'round-standings-stage':''} ${r?.total===100&&room.phase==='reveal'?'perfect':''}">${stage}</section><aside class="stack"><div id="roomStage" class="room-stage-compact"></div><details class="panel game-standings" ${finished?'open':''}><summary>${label('Pemain & poin room','Players & room points')} · ${room.players.length}</summary>${playersMarkup()}</details></aside></div>`;
 avatars.mount($('#roomStage'),{room,players:room.players,offset,showPicker:false,onError:e=>toast(e.message)});
 bindRoomActions(r);if(c&&room.phase==='listen')drawWave($('#stageWave'),clips.get(c.id),'#d2eb61');tick();
}
async function poll(){
 if(!session||polling)return;polling=true;const activeSession=session,start=Date.now();
 const controller=new AbortController();pollController=controller;const timeout=setTimeout(()=>controller.abort(),8000);
 try{
   const state=await roomApi('',{signal:controller.signal});if(session!==activeSession||room&&state.revision<room.revision)return;
   if(room&&turnKey(room)!==turnKey(state)){stopAudio();capture?.stop();}
   offset=state.serverTime-(start+Date.now())/2;room=state;lastContact=Date.now();$('#networkStatus').textContent=room.code;$('#networkStatus').classList.add('online');
   if(onRoomPage()){
     const wanted=roomUrl(room);
     if(location.pathname+location.search!==wanted)navigate(wanted,true);else renderRoom();
   }else if(route().page==='character'){
     if(room.phase!=='lobby')navigate(roomUrl(room),true);else avatars.sync({room,players:room.players,offset});
   }
 }catch(e){
   if(session!==activeSession)return;$('#networkStatus').textContent=tr('Menghubungkan ulang…','Reconnecting…');$('#networkStatus').classList.remove('online');
   if([401,403,404,410].includes(e.status)){
     const oldCode=session.code;toast(e.message);capture?.stop();mic?.getTracks().forEach(t=>t.stop());mic=null;stopAudio();sessionStorage.removeItem('mimic-room');session=null;room=null;pendingTake=null;
     if(['play','matching'].includes(route().page))navigate(matchingUrl(oldCode),true);else renderScreen();
   }
 }finally{clearTimeout(timeout);if(pollController===controller)pollController=null;polling=false;}
}
async function playTake(r){if(!r.takeId)return true;const activeSession=session,key=turnKey(room),route=`/api/rooms/${room.code}/audio?id=${encodeURIComponent(r.takeId)}`,url='/.netlify/functions/game?route='+encodeURIComponent(route);const response=await fetch(url,{headers:{'X-Room-Token':session.token}});if(!response.ok)throw new Error(tr('Rekaman belum tersedia.','Recording unavailable.'));const samples=await decodeAudio(await response.arrayBuffer());if(session!==activeSession||!onPlayPage()||!room||turnKey(room)!==key||room.phase!=='reveal')return false;drawWave($('#stageWave'),samples,'#ff6038');return playSamples(samples);}
async function reaction(r){if(muted||!onPlayPage())return;const activeSession=session,key=turnKey(room),index=room.revealIndex,url=room.rules.reactionAudio?.[r.reaction];if(url){const res=await fetch(url);if(res.ok){const samples=await decodeAudio(await res.arrayBuffer());if(session===activeSession&&onPlayPage()&&turnKey(room)===key&&room.phase==='reveal'&&room.revealIndex===index&&!muted)return playSamples(samples);return;}}if(onPlayPage())await playReaction(r.reaction,uiLanguage()==='en'?-1:index);}
async function captureTake(){const current=room,activeSession=session,key=`${session.code}:${room.round}`;if(!onPlayPage()||!mayCapture(room,Date.now()+offset)||!mic||Date.now()+offset>room.recordAt+1800){toast(tr('Terlewat: mikrofon belum siap atau tab terlambat.','Missed take: microphone not ready or tab was late.'));return;}sessionStorage.setItem('mimic-take:'+key,'started');try{capture=await recordAudio({seconds:Math.max(.3,(current.endAt-Date.now()-offset)/1000-.15),stream:mic,onLevel:frame=>drawWave($('#stageWave'),frame,'#ff6038')});if(session!==activeSession||!onPlayPage()||turnKey(room)!==turnKey(current)){capture.stop();return;}let samples=await capture.result;capture=null;if(session!==activeSession||turnKey(room)!==turnKey(current)||!isMyTurn(room))return;samples=samples.slice(0,current.recordSeconds*16000);pendingTake={round:current.round,samples,status:'transcribing',transcript:current.profile==='precision'?null:''};await sendTake();}catch(e){if(session!==activeSession)return;toast(e.message);if(pendingTake)pendingTake.status='error';renderRoom(true);}}
async function sendTake(){
 if(!pendingTake||!room)return;
 const take=pendingTake,activeSession=session;take.status='uploading';
 try{
   if(take.round!==room.round||!isMyTurn(room)||Date.now()+offset>room.collectUntil)throw new Error(tr('Giliran sudah berakhir. Rekaman tidak dikirim.','This turn has ended. The recording was not sent.'));
   const sound=room.clips.find(c=>c.id===room.queue[take.round-1]);
   if(room.profile==='precision'&&take.transcript===null&&sound.kind!=='sound'){
     try{take.transcript=await requestTranscription('transcribe',take.samples,()=>{},sound.language,room.rules.asrModel||'tiny');take.transcriptSource='browser-asr';}
     catch(e){take.transcript='';take.transcriptSource='unavailable';if(session===activeSession)toast(tr('Transkripsi gagal; rekaman tetap dikirim. Kata mendapat 0, audio tetap dinilai.','Transcription failed; the take will still upload. Words receive 0; audio is still scored.'));}
   }
   if(session!==activeSession||take.round!==room.round||!isMyTurn(room))return;
   await roomApi(`take?round=${take.round}`,{method:'POST',headers:{'Content-Type':'audio/wav','X-Transcript':encodeURIComponent((take.transcript||'').slice(0,300)),'X-Transcript-Source':take.transcriptSource||'browser-asr'},body:wavBytes(take.samples)});
   take.status='sent';await poll();
 }catch(e){if(session!==activeSession)return;take.status='error';toast(e.message);renderRoom(true);}
}
function tick(){
 if(!room||!onPlayPage())return;
 if(lastContact&&Date.now()-lastContact>=(room.presenceTimeoutMs||30000)){capture?.stop();stopAudio();return;}
 const now=Date.now()+offset,c=room.clips.find(c=>c.id===room.queue[room.round-1]),el=$('#countdown'),key=turnKey(room),cue=turnCue(room,now),mine=isMyTurn(room);
 let count='',status='';
 if(cue==='listen'){count=tr('Dengarkan','Listen');status=tr('Sound referensi diputar sebelum hitungan giliran.','The reference plays before the turn countdown.');}
 else if(['Ready','3','2','1','Start'].includes(cue)){count=cue;status=mine?(cue==='Start'?tr('Mikrofon merekam. Mulai mimic!','Recording. Start your mimic!'):tr('Giliranmu. Mulai bersuara saat Start.','Your turn. Speak at Start.')):tr('Giliran pemain di panggung. Tunggu giliranmu.','The player on stage is up. Wait for your turn.');}
 else if(cue==='record'){count=Math.max(0,Math.ceil((room.endAt-now)/1000))+'s';status=mine?tr('Sedang merekam take kamu…','Recording your take…'):tr('Pemain sedang merekam. Hasil akan diputar setelah penilaian.','The player is recording. Playback follows scoring.');}
 else if(cue==='collect'){count=tr('Menilai…','Scoring…');status=room.profile==='precision'?tr('Menunggu rekaman dan transkrip. Maksimal 140 detik setelah rekam.','Waiting for the take and transcript. Up to 140 seconds after recording.'):tr('Menunggu rekaman. Maksimal 30 detik setelah rekam.','Waiting for the take. Up to 30 seconds after recording.');}
 else if(room.phase==='results')count=Math.max(0,Math.ceil((room.nextAt-now)/1000))+'s';
 if(el){if(el.textContent!==String(count))el.textContent=count;el.dataset.cue=cue;}
 const statusEl=$('#captureStatus');if(statusEl&&statusEl.textContent!==status)statusEl.textContent=status;
 const readyAt=isSequential(room)?room.readyAt:room.recordAt-1500;
 if(room.phase==='listen'&&now>=room.listenAt&&now<readyAt&&!cues.has('listen'+key)){
   cues.add('listen'+key);const activeSession=session;
   loadClip(c).then(samples=>{if(session===activeSession&&onPlayPage()&&room?.phase==='listen'&&turnKey(room)===key&&Date.now()+offset<readyAt)return playSamples(samples);}).catch(e=>toast(e.message));
 }
 if(['listen','record'].includes(room.phase)&&now>=readyAt&&!cues.has('silence'+key)){cues.add('silence'+key);stopAudio();}
 if(mayCapture(room,now)&&!cues.has('record'+key)){
   cues.add('record'+key);
   if(!room.submitted.includes(room.me)&&!sessionStorage.getItem(`mimic-take:${session.code}:${room.round}`))captureTake();
 }
 if(room.phase==='reveal'&&now>=room.revealAt&&!cues.has('reveal'+room.round+':'+room.revealIndex)){
   cues.add('reveal'+room.round+':'+room.revealIndex);
   const r=room.results[room.revealIndex],round=room.round,index=room.revealIndex;
   playTake(r).then(played=>{if(played!==false&&onPlayPage()&&room?.phase==='reveal'&&room.round===round&&room.revealIndex===index)return reaction(r);}).catch(e=>toast(e.message));
 }
}
async function leave(destination='/'){
 const previous=session;capture?.stop();mic?.getTracks().forEach(t=>t.stop());mic=null;capture=null;stopAudio();room=null;session=null;pendingTake=null;sessionStorage.removeItem('mimic-room');cues.clear();
 if(previous)api(`/rooms/${previous.code}/leave`,{method:'POST',keepalive:true,headers:{'X-Room-Token':previous.token}}).catch(()=>{});
 navigate(destination);
}
mountNavigation();window.addEventListener('languagechange',renderScreen);
document.addEventListener('click',e=>{
 const a=e.target.closest('a');if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target||a.hasAttribute('download'))return;
 const url=new URL(a.href,location.origin);if(url.origin===location.origin&&gameRoute(url.href).page!=='unknown'){e.preventDefault();navigate(url.href);}
});
window.addEventListener('popstate',()=>{stopAudio();if(!onPlayPage())capture?.stop();lastRender='';renderScreen();});
$('#soundToggle').onclick=()=>{muted=!muted;setMuted(muted);$('#soundToggle').textContent=muted?tr('Efek mati','Effects off'):tr('Efek aktif','Effects on');};
window.addEventListener('beforeunload',()=>{capture?.stop();mic?.getTracks().forEach(t=>t.stop());});
async function init(){
 try{
   [catalog,account,site]=await Promise.all([api('/catalog'),api('/me'),loadSite()]);
   try{const saved=JSON.parse(sessionStorage.getItem('mimic-setup'));if(saved)setup={categoryId:saved.categoryId,language:saved.language,mode:'casual',profile:saved.profile==='precision'?'precision':'party',matchType:saved.matchType==='solo'?'solo':'custom',capacity:Number.isInteger(saved.capacity)&&saved.capacity>=2&&saved.capacity<=8?saved.capacity:8};}catch{}
   const query=new URLSearchParams(location.search);
   if(catalog.categories.some(c=>c.id===query.get('category')))setup.categoryId=query.get('category');
   if(!catalog.categories.some(c=>c.id===setup.categoryId))setup.categoryId=catalog.categories[0]?.id||'';
   if(catalog.languages.some(l=>l.id===query.get('language')))setup.language=query.get('language');
   if(setup.language!=='all'&&!catalog.languages.some(l=>l.id===setup.language))setup.language='all';
   sessionStorage.setItem('mimic-setup',JSON.stringify(setup));
   picker=soundPicker({catalog,settings:site.settings,account,getSetup:()=>setup,onChange:renderCreate});
   session=parseRoomSession(sessionStorage.getItem('mimic-room'));
   if(session)await poll();
   if(route().page==='home'&&route().code){navigate(matchingUrl(route().code),true);return;}
   if(route().page==='home'&&query.has('category')){navigate('/create-match',true);return;}
   renderScreen();
 }catch(e){
   app.innerHTML=`<section class="panel"><h2>${label('Arena belum tersambung.','Arena unavailable.')}</h2><p>${esc(e.message)}</p><button class="button primary" id="retry">${label('Coba lagi','Retry')}</button></section>`;bind('#retry',init);
 }
}
init();setInterval(poll,1100);setInterval(tick,80);
window.addEventListener('pagehide',event=>{if(!event.persisted)avatars.dispose();});
// Never treat pagehide/unload as a definitive leave: refresh, bfcache and mobile
// backgrounding can fire them too. The server heartbeat lease is authoritative.
function resumeConnection(){
 if(document.visibilityState==='hidden'||!session)return;
 if(pollController){pollController.abort();return;}
 poll();
}
document.addEventListener('visibilitychange',resumeConnection);
window.addEventListener('pageshow',resumeConnection);
window.addEventListener('online',resumeConnection);
