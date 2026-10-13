import {fail,text,id,integer,limitedBody,pcmFromWav,digest} from './validation.js';
import {randomQueue} from '../public/catalog.js';
import {analyzeAudio} from '../public/scoring.js';
import {scoreSound,SCORING_VERSION} from '../public/scoring-detail.js';
import {DEFAULT_AVATAR,isAvatar} from '../public/avatars.js';
import {siteSettings} from './control.js';
import {isSequential} from '../public/turns.js';
import {stageName,roomCapacity,matchRequirements} from '../public/match-rules.js';
import {updatePresence,PRESENCE_TIMEOUT_MS} from './presence.js';
const validName=value=>{const name=stageName(value);if(!name)fail(400,'Nama panggung wajib 1–10 karakter / Stage name must be 1–10 characters.');return name;};
function startBattle(s){
  if(!matchRequirements(s).canStart)fail(409,'Room wajib penuh, semua pemain siap, nama valid, dan sound tersedia / Fill every slot and get everyone ready with valid names and sounds.');
  s.turnMode='sequential-v1';s.queue=randomQueue(s.clips.map(c=>c.id),s.rules.rounds);nextRound(s);
}
const avatar=value=>{if(value===undefined)return DEFAULT_AVATAR;if(!isAvatar(value))fail(400,'Avatar tidak dikenal / Unknown avatar.');return value;};
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
const body=async req=>{try{return JSON.parse(new TextDecoder().decode(await limitedBody(req,10000)));}catch(e){if(e.status)throw e;fail(400,'Invalid request.');}};
const newToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hashToken=token=>digest(new TextEncoder().encode(token));
const roomCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return [...crypto.getRandomValues(new Uint8Array(6))].map(n=>a[n%a.length]).join('');};
const publicClip=s=>{const {profile,audioKey,audioHash,...rest}=s;return rest;};
function nextRound(s){
  s.round++;s.phase='listen';s.revealIndex=0;s.results=[];
  if(isSequential(s)){s.turnOrder=s.players.map(p=>p.id);s.turnIndex=0;nextTurn(s);return;}
  const clip=s.clips.find(c=>c.id===s.queue[s.round-1]);
  s.listenAt=Date.now()+3500;s.recordAt=s.listenAt+Math.ceil(clip.duration*1000)+3000;
  s.recordSeconds=Math.min(s.rules.recordSeconds,Math.ceil(clip.duration)+2);
  s.endAt=s.recordAt+s.recordSeconds*1000;s.collectUntil=s.endAt+140000;
}
function nextTurn(s){
  const clip=s.clips.find(c=>c.id===s.queue[s.round-1]);
  s.turnOrder??=s.players.map(p=>p.id);
  s.phase='listen';s.activePlayerId=s.turnOrder[s.turnIndex];
  s.listenAt=Date.now()+2500;
  s.readyAt=s.listenAt+Math.ceil(clip.duration*1000)+1000;
  // Ready (1s), 3 (1s), 2 (1s), 1 (1s). Start is the first recording second.
  s.recordAt=s.readyAt+4000;
  s.recordSeconds=Math.min(s.rules.recordSeconds,Math.ceil(clip.duration)+2);
  s.endAt=s.recordAt+s.recordSeconds*1000;
  s.collectUntil=s.endAt+(s.profile==='precision'?140000:30000);
}
function followingTurn(s,now=Date.now()){
  s.turnOrder??=s.players.map(p=>p.id);
  do{s.turnIndex++;}while(s.turnIndex<s.turnOrder.length&&!s.players.some(p=>p.id===s.turnOrder[s.turnIndex]));
  if(s.turnIndex<s.turnOrder.length)nextTurn(s);
  else{s.activePlayerId=null;s.phase=s.round>=s.rules.rounds?'finished':'results';s.nextAt=now+12000;}
}
function removePlayers(s,ids,reason){
  const departing=s.players.filter(p=>ids.includes(p.id));if(!departing.length)return false;
  // Completed standings are a snapshot, not a live roster.
  if(s.phase==='finished')return true;
  if(isSequential(s))s.turnOrder??=s.players.map(p=>p.id);
  const now=Date.now();
  s.players=s.players.filter(p=>!ids.includes(p.id));
  s.lastDeparture={at:now,round:s.round,reason,names:departing.map(p=>p.name)};
  if(s.phase!=='lobby')s.departedPlayers=[...(s.departedPlayers||[]),...departing.map(({lastSeenAt,...p})=>({...p,leftAt:now,reason}))];
  if(!s.players.some(p=>p.id===s.hostId))s.hostId=s.players[0]?.id||'';
  if(s.phase!=='lobby'){
    if(!s.players.length){s.phase='finished';s.activePlayerId=null;s.endedReason='empty';}
    else if(isSequential(s)&&ids.includes(s.activePlayerId))followingTurn(s,now);
  }
  return true;
}
function takeResult(p,take){
  const data=take?JSON.parse(take.data):null;
  return {playerId:p.id,name:p.name,...(data?.score||{total:0,pitch:0,words:0,timbre:0,rhythm:0,reaction:'roast',note:'No recording / Tidak ada rekaman.'}),takeId:data?.id||null,rankedStatus:data?.rankedStatus||null};
}
async function advanceTurns(db,s,row,now){
  s.turnOrder??=s.players.map(p=>p.id);
  let changed=false;
  if(s.phase==='listen'&&now>=s.recordAt){s.phase='record';changed=true;}
  if(s.phase==='record'&&now>=s.endAt){s.phase='collect';changed=true;}
  if(s.phase==='collect'){
    const take=await db.one('SELECT data FROM takes WHERE match_id=? AND round=? AND user_id=?',row.match_id,s.round,s.activePlayerId);
    if(take||now>=s.collectUntil){
      const player=s.players.find(p=>p.id===s.activePlayerId),result=takeResult(player,take);
      s.results.push(result);player.total+=result.total;
      s.phase='reveal';s.revealIndex=s.results.length-1;s.revealAt=now+1500;
      s.revealEnd=s.revealAt+(result.takeId?s.recordSeconds+6:4)*1000;changed=true;
    }
  }
  if(s.phase==='reveal'&&now>=s.revealEnd){
    followingTurn(s,now);
    changed=true;
  }
  if(s.phase==='results'&&now>=s.nextAt){nextRound(s);changed=true;}
  return changed;
}
async function view(db,row,player){
  const s=JSON.parse(row.data),takes=await db.all('SELECT user_id,data FROM takes WHERE match_id=? AND round=?',row.match_id,s.round||0);
  if(!s.players.some(p=>p.id===player.user_id))fail(403,'Kamu sudah keluar dari room / You have left this room.');
  return {...s,players:s.players.map(({lastSeenAt,...p})=>p),presenceTimeoutMs:PRESENCE_TIMEOUT_MS,clips:s.clips.map(publicClip),revision:row.revision,code:row.code,me:player.user_id,host:s.hostId===player.user_id,serverTime:Date.now(),submitted:takes.map(t=>t.user_id),results:s.results||[]};
}
async function mutate(db,code,fn,after){
  for(let i=0;i<16;i++){
    const row=await db.one('SELECT * FROM rooms WHERE code=?',code);if(!row)fail(404,'Room not found / Room tidak ditemukan.');
    if(row.expires_at<Date.now())fail(410,'Room expired / Room kedaluwarsa.');
    const state=JSON.parse(row.data);const changed=await fn(state,row);
    if(changed===false)return row;
    // Heartbeats share the CAS with gameplay, without triggering UI re-renders.
    // Comparing data as well as revision prevents a stale heartbeat overwriting a leave/join/turn.
    const delta=changed==='heartbeat'?0:1;
    const data=JSON.stringify(state),write=db.statement('UPDATE rooms SET data=?,revision=revision+? WHERE code=? AND revision=? AND data=? AND expires_at>?',data,delta,code,row.revision,row.data,Date.now());
    const [result]=await db.batch([write,...(after&&delta?after(state,row,data):[])]);
    if(result.meta.changes)return {...row,data,revision:row.revision+delta};
  }
  fail(409,'Room changed. Please try again.');
}
async function reconcilePresence(db,code,userId){
  return mutate(db,code,s=>{
    const {expired,touched}=updatePresence(s,userId);
    if(expired.length){removePlayers(s,expired,'disconnected');return true;}
    return touched?'heartbeat':false;
  },(s,row,data)=>[
    db.statement("DELETE FROM members WHERE match_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?,'$.players') WHERE json_extract(value,'$.id')=members.user_id) AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND revision=? AND data=?)",row.match_id,data,code,row.revision+1,data),
    db.statement('UPDATE matches SET host_id=?,status=? WHERE id=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND revision=? AND data=?)',s.hostId,s.phase,row.match_id,code,row.revision+1,data)
  ]);
}
async function advance(db,code){return mutate(db,code,async(s,row)=>{
  const now=Date.now();let changed=false;
  if(isSequential(s))return advanceTurns(db,s,row,now);
  if(s.phase==='listen'&&now>=s.recordAt){s.phase='record';changed=true;}
  if(s.phase==='record'&&now>=s.endAt){s.phase='collect';changed=true;}
  if(s.phase==='collect'){
    const takes=await db.all('SELECT user_id,data FROM takes WHERE match_id=? AND round=?',row.match_id,s.round);
    if(s.players.every(p=>takes.some(t=>t.user_id===p.id))||now>=s.collectUntil){
      s.results=s.players.map(p=>{const take=takes.find(t=>t.user_id===p.id),data=take?JSON.parse(take.data):null;return {playerId:p.id,name:p.name,...(data?.score||{total:0,pitch:0,words:0,timbre:0,rhythm:0,reaction:'roast',note:'No recording / Tidak ada rekaman.'}),takeId:data?.id||null,rankedStatus:data?.rankedStatus||null};});
      for(const p of s.players)p.total+=(s.results.find(r=>r.playerId===p.id)?.total||0);
      s.phase='reveal';s.revealIndex=0;s.revealAt=now+1500;s.revealEnd=s.revealAt+(s.recordSeconds+6)*1000;changed=true;
    }
  }
  if(s.phase==='reveal'&&now>=s.revealEnd){s.revealIndex++;if(s.revealIndex>=s.results.length){s.phase=s.round>=s.rules.rounds?'finished':'results';s.nextAt=now+12000;}else{s.revealAt=now+1000;s.revealEnd=s.revealAt+(s.recordSeconds+6)*1000;}changed=true;}
  if(s.phase==='results'&&now>=s.nextAt){nextRound(s);changed=true;}
  return changed;
});}
// One D1 transaction chooses/creates the queue room and inserts its membership.
// Concurrent arrivals cannot create separate half-empty rooms or overfill a room.
async function joinSolo(db,state,uid,tokenHash){
  const now=Date.now(),expires=now+7200000,code=roomCode(),matchId=crypto.randomUUID(),memberId=crypto.randomUUID(),p=state.players[0];
  state.queueKey=await hashToken(JSON.stringify([state.categoryId,state.language,state.mode,state.profile,state.rules,state.clips.map(c=>[c.id,c.revision])]));
  // Reclaim deserted queue slots even when no old client remains to poll them.
  const queues=await db.all("SELECT code FROM rooms WHERE expires_at>? AND json_extract(data,'$.phase')='lobby' AND json_extract(data,'$.matchType')='solo' AND (json_extract(data,'$.queueKey')=? OR EXISTS(SELECT 1 FROM json_each(data,'$.players') WHERE json_extract(value,'$.id')=?))",now,state.queueKey,uid);
  for(const q of queues)await reconcilePresence(db,q.code);
  const available="expires_at>? AND json_extract(data,'$.queueKey')=? AND json_extract(data,'$.phase')='lobby' AND json_array_length(data,'$.players')<8";
  const args=[now,state.queueKey];
  const notJoined="NOT EXISTS(SELECT 1 FROM members m JOIN rooms r ON r.match_id=m.match_id WHERE m.user_id=? AND r.expires_at>? AND json_extract(r.data,'$.matchType')='solo' AND json_extract(r.data,'$.phase')='lobby' AND EXISTS(SELECT 1 FROM json_each(r.data,'$.players') WHERE json_extract(value,'$.id')=m.user_id))";
  const eligible=[uid,now];
  const empty={...state,players:[]};
  await db.batch([
    db.statement(`INSERT INTO matches(id,host_id,code,status,data,created_at,expires_at) SELECT ?,?,?,'lobby',?,?,? WHERE NOT EXISTS(SELECT 1 FROM rooms WHERE ${available}) AND ${notJoined}`,matchId,uid,code,JSON.stringify({room:true}),now,expires,...args,...eligible),
    db.statement('INSERT INTO rooms(code,match_id,revision,data,expires_at) SELECT ?,?,0,?,? WHERE EXISTS(SELECT 1 FROM matches WHERE id=?)',code,matchId,JSON.stringify(empty),expires,matchId),
    db.statement(`INSERT INTO members(id,match_id,user_id,name,peer_id) SELECT ?,match_id,?,?,? FROM rooms WHERE ${available} AND ${notJoined} ORDER BY expires_at,code LIMIT 1`,memberId,uid,p.name,tokenHash,...args,...eligible),
    db.statement("UPDATE rooms SET data=json_set(data,'$.players',json_insert(json_extract(data,'$.players'),'$[#]',json(?)),'$.hostId',CASE WHEN json_array_length(data,'$.players')=0 THEN ? ELSE json_extract(data,'$.hostId') END),revision=revision+1 WHERE match_id=(SELECT match_id FROM members WHERE id=?)",JSON.stringify(p),uid,memberId)
  ]);
  const joined=await db.one('SELECT r.code FROM rooms r JOIN members m ON m.match_id=r.match_id WHERE m.id=?',memberId);
  if(!joined)fail(409,'Kamu sudah ada di antrean solo. Lanjutkan room sebelumnya / Resume your existing solo queue.');
  return joined.code;
}
export async function roomRoutes(req,env,db,user,getCatalog){
  const url=new URL(req.url),path=url.pathname,method=req.method;
  if(path==='/api/rooms'&&method==='POST'){
    const b=await body(req),catalog=await getCatalog(db),mode=b.mode==='ranked'?'ranked':'casual',profile=mode==='ranked'?'precision':b.profile==='precision'?'precision':'party';
    const matchType=b.matchType??'custom';if(!['custom','solo'].includes(matchType))fail(400,'Invalid match type.');
    if(b.practice)fail(400,'Latihan solo sudah diganti matchmaking 8 pemain / Solo now requires 8 players.');
    const capacity=matchType==='solo'?8:integer(b.capacity??catalog.rules.maxPlayers,2,8);
    if(matchType==='solo'&&b.capacity!==undefined&&b.capacity!==8)fail(400,'Solo wajib 8 pemain / Solo requires 8 players.');
    if(matchType==='solo'&&!(await siteSettings(db)).settings.allowJoins&&!['owner','admin'].includes(user?.role))fail(503,'Matchmaking sedang dijeda / Matchmaking is paused.');
    if(mode==='ranked'&&!user)fail(401,'Sign in for ranked / Masuk untuk mode kompetitif.');
    if(mode==='ranked'&&!catalog.rules.rankedEnabled)fail(409,'Ranked is paused.');
    // Solo counts individual queue entries; allow multiple 8-player rematches on a shared Wi-Fi.
    const ip=await hashToken(req.headers.get('cf-connecting-ip')||'local'),bucket=`${matchType==='solo'?'solo':'room'}-limit:${ip}:${Math.floor(Date.now()/3600000)}`;
    await db.run("INSERT INTO config(id,value) VALUES(?,'1') ON CONFLICT(id) DO UPDATE SET value=CAST(value AS INTEGER)+1",bucket);
    if(Number((await db.one('SELECT value FROM config WHERE id=?',bucket)).value)>(matchType==='solo'?240:30))fail(429,'Terlalu banyak permintaan match. Coba lagi nanti / Too many match requests. Try again later.');
    let sounds=catalog.sounds.filter(s=>s.categoryId===b.categoryId&&(b.language==='all'||s.language===b.language)&&(mode!=='ranked'||s.ranked)&&s.duration<=catalog.rules.recordSeconds&&s.quality?.usable!==false);
    if(b.soundIds!==undefined){
      if(matchType==='solo')fail(400,'Solo menggunakan sound acak sesuai kategori / Solo uses a random category pool.');
      if(mode==='ranked')fail(400,'Kompetitif selalu acak / Ranked always uses random selection.');
      if(!(await siteSettings(db)).settings.manualSoundSelectionEnabled)fail(403,'Pemilihan manual dinonaktifkan / Manual selection is disabled.');
      if(!Array.isArray(b.soundIds)||!b.soundIds.length||b.soundIds.length>50||new Set(b.soundIds).size!==b.soundIds.length||b.soundIds.some(x=>typeof x!=='string'||!sounds.some(s=>s.id===x)))fail(400,'Pilih 1–50 sound aktif yang sesuai kategori/bahasa / Choose 1–50 eligible active sounds.');
      sounds=sounds.filter(s=>b.soundIds.includes(s.id));
    }
    if(!sounds.length)fail(400,'No sounds match this selection / Pilihan ini belum memiliki sound.');
    const token=newToken(),uid=user?.id||'guest-'+crypto.randomUUID(),matchId=crypto.randomUUID(),code=roomCode(),name=validName(b.name),rules={...catalog.rules,asrModel:catalog.rules.asrModel||'tiny',scoringVersion:SCORING_VERSION,profile,maxPlayers:capacity};
    const clips=[];for(const sound of sounds){const row=await db.one('SELECT data FROM sounds WHERE id=?',sound.id);clips.push({...JSON.parse(row.data),...sound});}
    const state={hostId:uid,phase:'lobby',players:[{id:uid,name,total:0,ready:false,avatarId:avatar(b.avatarId),lastSeenAt:Date.now()}],mode,profile,categoryId:b.categoryId,language:b.language,matchType,capacity,practice:false,rules,clips,queue:[],round:0};
    if(matchType==='solo')return json({code:await joinSolo(db,state,uid,await hashToken(token)),token});
    const expires=Date.now()+7200000;
    await db.batch([
      db.statement('INSERT INTO matches(id,host_id,code,status,data,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',matchId,uid,code,'lobby',JSON.stringify({room:true}),Date.now(),expires),
      db.statement('INSERT INTO members(id,match_id,user_id,name,peer_id) VALUES(?,?,?,?,?)',crypto.randomUUID(),matchId,uid,name,await hashToken(token)),
      db.statement('INSERT INTO rooms(code,match_id,revision,data,expires_at) VALUES(?,?,0,?,?)',code,matchId,JSON.stringify(state),expires)
    ]);
    return json({code,token});
  }
  const route=path.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|name|avatar|ready|start|take|audio|leave))?$/);if(!route)return null;
  const code=route[1],action=route[2];let row=await db.one('SELECT * FROM rooms WHERE code=?',code);
  if(!row)fail(404,'Room not found / Room tidak ditemukan.');if(row.expires_at<Date.now())fail(410,'Room expired / Room kedaluwarsa.');
  let state=JSON.parse(row.data);if(state.mode==='ranked'&&!user)fail(401,'Sign in for ranked / Room kompetitif memerlukan login.');
  if(action==='join'&&method==='POST'){
    if(state.practice||state.matchType==='solo')fail(403,'Gunakan antrean solo untuk room ini / Use solo matchmaking for this room.');
    const b=await body(req),name=validName(b.name),avatarId=avatar(b.avatarId),token=newToken(),uid=user?.id||'guest-'+crypto.randomUUID(),tokenHash=await hashToken(token);
    await reconcilePresence(db,code);
    const existing=await db.one('SELECT user_id FROM members WHERE match_id=? AND user_id=?',row.match_id,uid);if(existing)fail(409,'Already joined. Resume your existing room / Lanjutkan room yang sudah dibuka.');
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'The match has started / Permainan sudah mulai.');if(s.players.some(p=>p.id===uid))fail(409,'This account has already joined.');if(s.players.length>=roomCapacity(s))fail(409,'Room full / Room penuh.');s.players.push({id:uid,name,total:0,ready:false,avatarId,lastSeenAt:Date.now()});if(!s.hostId)s.hostId=uid;},(s,row,data)=>[
      db.statement('INSERT INTO members(id,match_id,user_id,name,peer_id) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND revision=? AND data=?)',crypto.randomUUID(),row.match_id,uid,name,tokenHash,code,row.revision+1,data)
    ]);
    return json({code,token});
  }
  const token=req.headers.get('X-Room-Token');if(!token||!/^[a-f0-9]{64}$/.test(token))fail(401,'Room token required.');
  const player=await db.one('SELECT * FROM members WHERE match_id=? AND peer_id=?',row.match_id,await hashToken(token));
  if(!player||!state.players.some(p=>p.id===player.user_id)||(state.mode==='ranked'&&player.user_id!==user?.id))fail(403,'Room access denied.');
  row=await reconcilePresence(db,code,player.user_id);state=JSON.parse(row.data);
  if(!state.players.some(p=>p.id===player.user_id))fail(403,'Koneksi terputus lebih dari 30 detik. Kamu dikeluarkan; pemain lain tetap lanjut / Disconnected for over 30 seconds. You left; others continue.');
  if(action==='name'&&method==='POST'){
    const name=validName((await body(req)).name);
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'Nama terkunci selama battle / Name is locked during battle.');const p=s.players.find(p=>p.id===player.user_id);if(!p)fail(403,'Player left.');p.name=name;},(s,row,data)=>[
      db.statement('UPDATE members SET name=? WHERE id=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND revision=? AND data=?)',name,player.id,code,row.revision+1,data)
    ]);
    return json({ok:true,name});
  }
  if(action==='avatar'&&method==='POST'){
    const b=await body(req),avatarId=avatar(b.avatarId);
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'Avatar terkunci selama pertandingan / Avatar is locked during a match.');const p=s.players.find(p=>p.id===player.user_id);if(!p)fail(403,'Player left.');if(p.avatarId===avatarId)return false;p.avatarId=avatarId;});
    return json({ok:true,avatarId});
  }
  if(action==='ready'&&method==='POST'){
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'Match already started.');const p=s.players.find(p=>p.id===player.user_id);if(!p)fail(403,'Player left.');validName(p.name);p.ready=true;if(s.matchType==='solo'&&matchRequirements(s).canStart)startBattle(s);});
    return json({ok:true});
  }
  if(action==='start'&&method==='POST'){
    await mutate(db,code,s=>{if(s.hostId!==player.user_id)fail(403,'Host only.');if(s.phase!=='lobby')fail(409,'Match already started.');startBattle(s);});
    return json({ok:true});
  }
  if(action==='leave'&&method==='POST'){
    await mutate(db,code,s=>removePlayers(s,[player.user_id],'left'),(s,row,data)=>[
      db.statement('DELETE FROM members WHERE id=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND revision=? AND data=?)',player.id,code,row.revision+1,data),
      db.statement('UPDATE matches SET host_id=?,status=? WHERE id=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND revision=? AND data=?)',s.hostId,s.phase,row.match_id,code,row.revision+1,data)
    ]);return json({ok:true});
  }
  if(action==='audio'&&method==='GET'){
    const takeId=id(url.searchParams.get('id')),take=await db.one('SELECT * FROM takes WHERE id=? AND match_id=?',takeId,row.match_id);if(!take)fail(404,'Recording unavailable.');
    if(take.round>=state.round&&['listen','record','collect'].includes(state.phase))fail(403,'Playback is available during the reveal.');
    const audio=await env.BUCKET.get(take.audio_key);if(!audio)fail(404,'Audio unavailable.');return new Response(audio.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store'}});
  }
  if(action==='take'&&method==='POST'){
    const round=integer(Number(url.searchParams.get('round')),1,10),now=Date.now();
    const existing=await db.one('SELECT data FROM takes WHERE match_id=? AND round=? AND user_id=?',row.match_id,round,player.user_id);if(existing)return json({received:true,duplicate:true});
    if(!state.players.some(p=>p.id===player.user_id)||round!==state.round||!['listen','record','collect'].includes(state.phase)||now<state.recordAt||now>state.collectUntil)fail(409,'Recording window closed / Waktu rekaman sudah berakhir.');
    if(isSequential(state)&&state.activePlayerId!==player.user_id)fail(409,'Belum giliran kamu / It is not your turn.');
    const bytes=await limitedBody(req,480100),samples=pcmFromWav(bytes);if(samples.length/16000>state.recordSeconds+0.5)fail(400,'Recording too long.');
    let transcript='';try{transcript=text(decodeURIComponent(req.headers.get('X-Transcript')||''),300,false);}catch{fail(400,'Invalid transcript.');}
    const transcriptSource=req.headers.get('X-Transcript-Source')==='unavailable'?'unavailable':'browser-asr';
    if(transcriptSource==='unavailable')transcript='';
    const sound=state.clips.find(s=>s.id===state.queue[round-1]),analysis=analyzeAudio(samples),score=scoreSound(sound.profile,analysis,sound.text,transcript,state.rules,sound.kind||'speech',transcriptSource),audioHash=await digest(samples.buffer);
    const takeId=crypto.randomUUID(),audioKey=`attempts/${takeId}.wav`,data={id:takeId,score};
    let eligible=true;
    if(state.mode==='ranked'){
      if(audioHash===sound.audioHash)eligible=false;
      if(await db.one('SELECT id FROM attempts WHERE user_id=? AND audio_hash=? LIMIT 1',player.user_id,audioHash))eligible=false;
      data.rankedStatus=eligible?'pending':'rejected-replay';
    }
    await env.BUCKET.put(audioKey,bytes,{httpMetadata:{contentType:'audio/wav'}});
    // Upload/scoring can overlap a leave. Recheck membership and the live turn
    // inside the insert transaction; never accept an orphan take after eviction.
    const liveTurn="EXISTS(SELECT 1 FROM rooms r JOIN members m ON m.match_id=r.match_id WHERE r.code=? AND m.id=? AND r.expires_at>? AND json_extract(r.data,'$.round')=? AND json_extract(r.data,'$.phase') IN ('listen','record','collect') AND json_extract(r.data,'$.collectUntil')>=? AND (json_extract(r.data,'$.turnMode') IS NOT 'sequential-v1' OR json_extract(r.data,'$.activePlayerId')=m.user_id) AND EXISTS(SELECT 1 FROM json_each(r.data,'$.players') WHERE json_extract(value,'$.id')=m.user_id))";
    const ops=[db.statement(`INSERT INTO takes(id,match_id,round,user_id,data,audio_key) SELECT ?,?,?,?,?,? WHERE ${liveTurn}`,takeId,row.match_id,round,player.user_id,JSON.stringify(data),audioKey,code,player.id,Date.now(),round,Date.now())];
    if(state.mode==='ranked'&&eligible){const review={sound:{id:sound.id,title:sound.title,text:sound.text,kind:sound.kind||'speech',url:sound.url,profile:sound.profile,revision:sound.revision},analysis,rules:state.rules,suggestedTranscript:transcript};ops.push(db.statement('INSERT INTO attempts(id,match_id,round,user_id,name,category_id,sound_id,language,version,status,data,audio_key,audio_hash,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM takes WHERE id=?)',takeId,row.match_id,round,player.user_id,player.name,sound.categoryId,sound.id,sound.language,state.rules.version,'pending',JSON.stringify(review),audioKey,audioHash,Date.now(),takeId));}
    try{const [written]=await db.batch(ops);if(!written.meta.changes)fail(409,'Giliran sudah berakhir atau pemain sudah keluar / Turn ended or player left.');}catch(e){await env.BUCKET.delete(audioKey);if(await db.one('SELECT id FROM takes WHERE match_id=? AND round=? AND user_id=?',row.match_id,round,player.user_id))return json({received:true,duplicate:true});throw e;}
    return json({received:true,rankedStatus:data.rankedStatus});
  }
  if(!action&&method==='GET'){row=await advance(db,code);return json(await view(db,row,player));}
  fail(404,'Not found.');
}
