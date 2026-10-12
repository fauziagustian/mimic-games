import {fail,text,id,integer,limitedBody,pcmFromWav,digest} from './validation.js';
import {randomQueue} from '../public/catalog.js';
import {analyzeAudio,compareAudio} from '../public/scoring.js';
import {DEFAULT_AVATAR,isAvatar} from '../public/avatars.js';
import {siteSettings} from './control.js';
import {isSequential} from '../public/turns.js';
const avatar=value=>{if(value===undefined)return DEFAULT_AVATAR;if(!isAvatar(value))fail(400,'Avatar tidak dikenal / Unknown avatar.');return value;};
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
const body=async req=>{try{return JSON.parse(new TextDecoder().decode(await limitedBody(req,10000)));}catch(e){if(e.status)throw e;fail(400,'Invalid request.');}};
const newToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hashToken=token=>digest(new TextEncoder().encode(token));
const roomCode=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return [...crypto.getRandomValues(new Uint8Array(6))].map(n=>a[n%a.length]).join('');};
const publicClip=s=>{const {profile,audioKey,audioHash,...rest}=s;return rest;};
function nextRound(s){
  s.round++;s.phase='listen';s.revealIndex=0;s.results=[];
  if(isSequential(s)){s.turnIndex=0;nextTurn(s);return;}
  const clip=s.clips.find(c=>c.id===s.queue[s.round-1]);
  s.listenAt=Date.now()+3500;s.recordAt=s.listenAt+Math.ceil(clip.duration*1000)+3000;
  s.recordSeconds=Math.min(s.rules.recordSeconds,Math.ceil(clip.duration)+2);
  s.endAt=s.recordAt+s.recordSeconds*1000;s.collectUntil=s.endAt+140000;
}
function nextTurn(s){
  const clip=s.clips.find(c=>c.id===s.queue[s.round-1]);
  s.phase='listen';s.activePlayerId=s.players[s.turnIndex].id;
  s.listenAt=Date.now()+2500;
  s.readyAt=s.listenAt+Math.ceil(clip.duration*1000)+1000;
  // Ready (1s), 3 (1s), 2 (1s), 1 (1s). Start is the first recording second.
  s.recordAt=s.readyAt+4000;
  s.recordSeconds=Math.min(s.rules.recordSeconds,Math.ceil(clip.duration)+2);
  s.endAt=s.recordAt+s.recordSeconds*1000;
  s.collectUntil=s.endAt+(s.profile==='precision'?140000:30000);
}
function takeResult(p,take){
  const data=take?JSON.parse(take.data):null;
  return {playerId:p.id,name:p.name,...(data?.score||{total:0,pitch:0,words:0,timbre:0,rhythm:0,reaction:'roast',note:'No recording / Tidak ada rekaman.'}),takeId:data?.id||null,rankedStatus:data?.rankedStatus||null};
}
async function advanceTurns(db,s,row,now){
  let changed=false;
  if(s.phase==='listen'&&now>=s.recordAt){s.phase='record';changed=true;}
  if(s.phase==='record'&&now>=s.endAt){s.phase='collect';changed=true;}
  if(s.phase==='collect'){
    const take=await db.one('SELECT data FROM takes WHERE match_id=? AND round=? AND user_id=?',row.match_id,s.round,s.activePlayerId);
    if(take||now>=s.collectUntil){
      const player=s.players[s.turnIndex],result=takeResult(player,take);
      s.results.push(result);player.total+=result.total;
      s.phase='reveal';s.revealIndex=s.turnIndex;s.revealAt=now+1500;
      s.revealEnd=s.revealAt+(result.takeId?s.recordSeconds+6:4)*1000;changed=true;
    }
  }
  if(s.phase==='reveal'&&now>=s.revealEnd){
    if(s.turnIndex+1<s.players.length){s.turnIndex++;nextTurn(s);}
    else{s.activePlayerId=null;s.phase=s.round>=s.rules.rounds?'finished':'results';s.nextAt=now+12000;}
    changed=true;
  }
  if(s.phase==='results'&&now>=s.nextAt){nextRound(s);changed=true;}
  return changed;
}
async function view(db,row,player){
  const s=JSON.parse(row.data),takes=await db.all('SELECT user_id,data FROM takes WHERE match_id=? AND round=?',row.match_id,s.round||0);
  return {...s,clips:s.clips.map(publicClip),revision:row.revision,code:row.code,me:player.user_id,host:s.hostId===player.user_id,serverTime:Date.now(),submitted:takes.map(t=>t.user_id),results:s.results||[]};
}
async function mutate(db,code,fn){
  for(let i=0;i<6;i++){
    const row=await db.one('SELECT * FROM rooms WHERE code=?',code);if(!row)fail(404,'Room not found / Room tidak ditemukan.');
    const state=JSON.parse(row.data);const changed=await fn(state,row);
    if(changed===false)return row;
    const result=await db.run('UPDATE rooms SET data=?,revision=revision+1 WHERE code=? AND revision=?',JSON.stringify(state),code,row.revision);
    if(result.meta.changes)return {...row,data:JSON.stringify(state),revision:row.revision+1};
  }
  fail(409,'Room changed. Please try again.');
}
async function advance(db,code){return mutate(db,code,async(s,row)=>{
  const now=Date.now();let changed=false;
  if(isSequential(s))return advanceTurns(db,s,row,now);
  if(s.phase==='listen'&&now>=s.recordAt){s.phase='record';changed=true;}
  if(s.phase==='record'&&now>=s.endAt){s.phase='collect';changed=true;}
  if(s.phase==='collect'){
    const takes=await db.all('SELECT user_id,data FROM takes WHERE match_id=? AND round=?',row.match_id,s.round);
    if(takes.length>=s.players.length||now>=s.collectUntil){
      s.results=s.players.map(p=>{const take=takes.find(t=>t.user_id===p.id),data=take?JSON.parse(take.data):null;return {playerId:p.id,name:p.name,...(data?.score||{total:0,pitch:0,words:0,timbre:0,rhythm:0,reaction:'roast',note:'No recording / Tidak ada rekaman.'}),takeId:data?.id||null,rankedStatus:data?.rankedStatus||null};});
      for(const p of s.players)p.total+=(s.results.find(r=>r.playerId===p.id)?.total||0);
      s.phase='reveal';s.revealIndex=0;s.revealAt=now+1500;s.revealEnd=s.revealAt+(s.recordSeconds+6)*1000;changed=true;
    }
  }
  if(s.phase==='reveal'&&now>=s.revealEnd){s.revealIndex++;if(s.revealIndex>=s.results.length){s.phase=s.round>=s.rules.rounds?'finished':'results';s.nextAt=now+12000;}else{s.revealAt=now+1000;s.revealEnd=s.revealAt+(s.recordSeconds+6)*1000;}changed=true;}
  if(s.phase==='results'&&now>=s.nextAt){nextRound(s);changed=true;}
  return changed;
});}
export async function roomRoutes(req,env,db,user,getCatalog){
  const url=new URL(req.url),path=url.pathname,method=req.method;
  if(path==='/api/rooms'&&method==='POST'){
    const b=await body(req),catalog=await getCatalog(db),mode=b.mode==='ranked'?'ranked':'casual',profile=mode==='ranked'?'precision':b.profile==='precision'?'precision':'party';
    if(mode==='ranked'&&!user)fail(401,'Sign in for ranked / Masuk untuk mode kompetitif.');
    if(mode==='ranked'&&!catalog.rules.rankedEnabled)fail(409,'Ranked is paused.');
    const ip=await hashToken(req.headers.get('cf-connecting-ip')||'local'),bucket=`room-limit:${ip}:${Math.floor(Date.now()/3600000)}`;
    await db.run("INSERT INTO config(id,value) VALUES(?,'1') ON CONFLICT(id) DO UPDATE SET value=CAST(value AS INTEGER)+1",bucket);
    if(Number((await db.one('SELECT value FROM config WHERE id=?',bucket)).value)>30)fail(429,'Too many rooms. Try again later.');
    let sounds=catalog.sounds.filter(s=>s.categoryId===b.categoryId&&(b.language==='all'||s.language===b.language)&&(mode!=='ranked'||s.ranked)&&s.duration<=catalog.rules.recordSeconds);
    if(b.soundIds!==undefined){
      if(mode==='ranked')fail(400,'Kompetitif selalu acak / Ranked always uses random selection.');
      if(!(await siteSettings(db)).settings.manualSoundSelectionEnabled)fail(403,'Pemilihan manual dinonaktifkan / Manual selection is disabled.');
      if(!Array.isArray(b.soundIds)||!b.soundIds.length||b.soundIds.length>50||new Set(b.soundIds).size!==b.soundIds.length||b.soundIds.some(x=>typeof x!=='string'||!sounds.some(s=>s.id===x)))fail(400,'Pilih 1–50 sound aktif yang sesuai kategori/bahasa / Choose 1–50 eligible active sounds.');
      sounds=sounds.filter(s=>b.soundIds.includes(s.id));
    }
    if(!sounds.length)fail(400,'No sounds match this selection / Pilihan ini belum memiliki sound.');
    const token=newToken(),uid=user?.id||'guest-'+crypto.randomUUID(),matchId=crypto.randomUUID(),code=roomCode(),name=text(b.name,20),rules={...catalog.rules,profile};
    const clips=[];for(const sound of sounds){const row=await db.one('SELECT data FROM sounds WHERE id=?',sound.id);clips.push({...sound,...JSON.parse(row.data)});}
    const state={hostId:uid,phase:'lobby',players:[{id:uid,name,total:0,ready:false,avatarId:avatar(b.avatarId)}],mode,profile,categoryId:b.categoryId,language:b.language,practice:!!b.practice,rules,clips,queue:[],round:0};
    const expires=Date.now()+7200000;
    await db.batch([
      db.statement('INSERT INTO matches(id,host_id,code,status,data,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',matchId,uid,code,'lobby',JSON.stringify({room:true}),Date.now(),expires),
      db.statement('INSERT INTO members(id,match_id,user_id,name,peer_id) VALUES(?,?,?,?,?)',crypto.randomUUID(),matchId,uid,name,await hashToken(token)),
      db.statement('INSERT INTO rooms(code,match_id,revision,data,expires_at) VALUES(?,?,0,?,?)',code,matchId,JSON.stringify(state),expires)
    ]);
    return json({code,token});
  }
  const route=path.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|avatar|ready|start|take|audio|leave))?$/);if(!route)return null;
  const code=route[1],action=route[2];let row=await db.one('SELECT * FROM rooms WHERE code=?',code);
  if(!row)fail(404,'Room not found / Room tidak ditemukan.');if(row.expires_at<Date.now())fail(410,'Room expired / Room kedaluwarsa.');
  const state=JSON.parse(row.data);if(state.mode==='ranked'&&!user)fail(401,'Sign in for ranked / Room kompetitif memerlukan login.');
  if(action==='join'&&method==='POST'){
    if(state.practice)fail(403,'Practice room / Room latihan.');
    const b=await body(req),name=text(b.name,20),avatarId=avatar(b.avatarId),token=newToken(),uid=user?.id||'guest-'+crypto.randomUUID(),tokenHash=await hashToken(token);
    const existing=await db.one('SELECT user_id FROM members WHERE match_id=? AND user_id=?',row.match_id,uid);if(existing)fail(409,'Already joined. Resume your existing room / Lanjutkan room yang sudah dibuka.');
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'The match has started / Permainan sudah mulai.');if(s.players.some(p=>p.id===uid))fail(409,'This account has already joined.');if(s.players.length>=s.rules.maxPlayers)fail(409,'Room full / Room penuh.');s.players.push({id:uid,name,total:0,ready:false,avatarId});});
    await db.run('INSERT INTO members(id,match_id,user_id,name,peer_id) VALUES(?,?,?,?,?)',crypto.randomUUID(),row.match_id,uid,name,tokenHash);
    return json({code,token});
  }
  const token=req.headers.get('X-Room-Token');if(!token||!/^[a-f0-9]{64}$/.test(token))fail(401,'Room token required.');
  const player=await db.one('SELECT * FROM members WHERE match_id=? AND peer_id=?',row.match_id,await hashToken(token));
  if(!player||(state.mode==='ranked'&&player.user_id!==user?.id))fail(403,'Room access denied.');
  if(action==='avatar'&&method==='POST'){
    const b=await body(req),avatarId=avatar(b.avatarId);
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'Avatar terkunci selama pertandingan / Avatar is locked during a match.');const p=s.players.find(p=>p.id===player.user_id);if(!p)fail(403,'Player left.');if(p.avatarId===avatarId)return false;p.avatarId=avatarId;});
    return json({ok:true,avatarId});
  }
  if(action==='ready'&&method==='POST'){
    await mutate(db,code,s=>{if(s.phase!=='lobby')fail(409,'Match already started.');const p=s.players.find(p=>p.id===player.user_id);if(!p)fail(403,'Player left.');p.ready=true;});
    return json({ok:true});
  }
  if(action==='start'&&method==='POST'){
    await mutate(db,code,s=>{if(s.hostId!==player.user_id)fail(403,'Host only.');if(s.phase!=='lobby')fail(409,'Match already started.');if(s.players.length<(s.practice?1:2)||s.players.some(p=>!p.ready))fail(409,'All players must be ready / Semua pemain harus siap.');s.turnMode='sequential-v1';s.queue=randomQueue(s.clips.map(c=>c.id),s.rules.rounds);nextRound(s);});
    return json({ok:true});
  }
  if(action==='leave'&&method==='POST'){
    await mutate(db,code,s=>{if(s.phase==='lobby'){s.players=s.players.filter(p=>p.id!==player.user_id);if(s.hostId===player.user_id)s.hostId=s.players[0]?.id||'';}return true;});return json({ok:true});
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
    const sound=state.clips.find(s=>s.id===state.queue[round-1]),analysis=analyzeAudio(samples),score=compareAudio(sound.profile,analysis,sound.text,transcript,state.rules),audioHash=await digest(samples.buffer);
    const takeId=crypto.randomUUID(),audioKey=`attempts/${takeId}.wav`,data={id:takeId,score};
    let eligible=true;
    if(state.mode==='ranked'){
      if(audioHash===sound.audioHash)eligible=false;
      if(await db.one('SELECT id FROM attempts WHERE user_id=? AND audio_hash=? LIMIT 1',player.user_id,audioHash))eligible=false;
      data.rankedStatus=eligible?'pending':'rejected-replay';
    }
    await env.BUCKET.put(audioKey,bytes,{httpMetadata:{contentType:'audio/wav'}});
    const ops=[db.statement('INSERT INTO takes(id,match_id,round,user_id,data,audio_key) VALUES(?,?,?,?,?,?)',takeId,row.match_id,round,player.user_id,JSON.stringify(data),audioKey)];
    if(state.mode==='ranked'&&eligible){const review={sound:{id:sound.id,title:sound.title,text:sound.text,url:sound.url,profile:sound.profile,revision:sound.revision},analysis,rules:state.rules,suggestedTranscript:transcript};ops.push(db.statement('INSERT INTO attempts(id,match_id,round,user_id,name,category_id,sound_id,language,version,status,data,audio_key,audio_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',takeId,row.match_id,round,player.user_id,player.name,sound.categoryId,sound.id,sound.language,state.rules.version,'pending',JSON.stringify(review),audioKey,audioHash,Date.now()));}
    try{await db.batch(ops);}catch(e){await env.BUCKET.delete(audioKey);if(await db.one('SELECT id FROM takes WHERE match_id=? AND round=? AND user_id=?',row.match_id,round,player.user_id))return json({received:true,duplicate:true});throw e;}
    return json({received:true,rankedStatus:data.rankedStatus});
  }
  if(!action&&method==='GET'){row=await advance(db,code);return json(await view(db,row,player));}
  fail(404,'Not found.');
}
