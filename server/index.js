import {database} from './db.js';
import {HttpError,fail,text,integer,id,validateRules,validateLanguage,pcmFromWav,digest,limitedBody} from './validation.js';
import {DEFAULT_RULES,LANGUAGES,CATEGORIES,SEED_SOUNDS,randomQueue} from '../public/catalog.js';
import {analyzeAudio,compareAudio} from '../public/scoring.js';
import {scoreSound,audioQuality,SOUND_KINDS} from '../public/scoring-detail.js';
import {scoringLab} from './scoring-lab.js';
import references from '../work/reference-seeds.json';
import {roomRoutes} from './rooms.js';
import {communityRoutes} from './community.js';
import staticAssets from '../work/static-assets.json';
import {identity,authorizeControl,controlRoutes,enforceOperations} from './control.js';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const parsed=row=>row?JSON.parse(row.data):null;
function requireUser(user){if(!user)fail(401,'Sign in first / Masuk terlebih dahulu.');return user;}
function requireAdmin(user){requireUser(user);if(!user.admin)fail(403,'Admin access only / Khusus admin.');}
async function body(req,max=20000){try{return JSON.parse(new TextDecoder().decode(await limitedBody(req,max)));}catch(e){if(e instanceof HttpError)throw e;fail(400,'Invalid JSON.');}}
async function seed(db){
  if(await db.one("SELECT id FROM config WHERE id='initialized'"))return;
  const ops=[db.statement('INSERT OR IGNORE INTO rules(version,data,created_at) VALUES(?,?,?)',1,JSON.stringify(DEFAULT_RULES),Date.now())];
  for(const c of CATEGORIES)ops.push(db.statement('INSERT OR IGNORE INTO categories(id,data,active) VALUES(?,?,1)',c.id,JSON.stringify(c)));
  for(const l of LANGUAGES)ops.push(db.statement('INSERT OR IGNORE INTO languages(id,data,active) VALUES(?,?,1)',l.id,JSON.stringify(l)));
  for(const s of SEED_SOUNDS)ops.push(db.statement('INSERT OR IGNORE INTO sounds(id,category_id,language,data,active,revision) VALUES(?,?,?,?,1,1)',s.id,s.categoryId,s.language,JSON.stringify({...s,...references[s.id]})));
  ops.push(db.statement("INSERT OR IGNORE INTO config(id,value) VALUES('initialized','1')"));
  await db.batch(ops);
}
const visibleSound=row=>{const {profile,audioHash,audioKey,...data}=parsed(row);return {...data,kind:data.kind||'speech',quality:audioQuality(profile),id:row.id,categoryId:row.category_id,language:row.language,active:!!row.active,revision:row.revision};};
async function catalog(db,admin=false){
  const [categories,languages,sounds,rule]=await Promise.all([
    db.all(`SELECT * FROM categories ${admin?'':'WHERE active=1'}`),db.all(`SELECT * FROM languages ${admin?'':'WHERE active=1'}`),
    db.all(`SELECT s.* FROM sounds s JOIN categories c ON c.id=s.category_id JOIN languages l ON l.id=s.language ${admin?'':"WHERE s.active=1 AND c.active=1 AND l.active=1 AND NOT EXISTS(SELECT 1 FROM community_submissions u WHERE u.sound_id=s.id AND u.status<>'approved')"} ORDER BY s.id`),
    db.one('SELECT * FROM rules ORDER BY version DESC LIMIT 1')]);
  return {categories:categories.map(r=>({...parsed(r),id:r.id,active:!!r.active})),languages:languages.map(r=>({...parsed(r),id:r.id,active:!!r.active})),sounds:sounds.map(visibleSound),rules:{...parsed(rule),version:rule.version}};
}
const log=(db,user,action,target)=>db.statement('INSERT INTO audit(id,actor,action,target,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),user.id,action,target,Date.now());
async function match(db,matchId){const row=await db.one('SELECT * FROM matches WHERE id=?',id(matchId));if(!row)fail(404,'Match not found.');return {...row,...parsed(row)};}
async function member(db,m,user){requireUser(user);const row=await db.one('SELECT * FROM members WHERE match_id=? AND user_id=?',m.id,user.id);if(!row)fail(403,'You are not in this match.');return row;}
async function matchView(db,m){return {id:m.id,code:m.code,status:m.status,categoryId:m.categoryId,language:m.language,rules:m.rules,queue:m.queue||[],clips:m.clips||[],expiresAt:m.expires_at,members:await db.all('SELECT peer_id AS peerId,name FROM members WHERE match_id=?',m.id)};}
async function handle(req,env){
  const u=new URL(req.url),p=u.pathname,method=req.method,user=p.startsWith('/api/')?await identity(req,env,database(env)):null;
  if(p==='/api/me')return json({user:user?{id:user.id,admin:user.admin,role:user.role}:null,adminConfigured:!!env.ADMIN_EMAILS});
  if(!p.startsWith('/api/')){
    if(!['GET','HEAD'].includes(method))return new Response('Method not allowed',{status:405});
    const gamePage=['/','/choose-character','/create-match','/matching'].includes(p)||/^\/room\/[A-Z2-9]{6}$/.test(p);
    const asset=staticAssets[gamePage?'/index.html':['/admin','/leaderboard','/community'].includes(p)?p+'.html':p];
    if(!asset)return new Response('Not found',{status:404});
    return new Response(method==='HEAD'?null:Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.mime,'Cache-Control':p.endsWith('.wav')?'public, max-age=3600':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
  }
  if(!['GET','HEAD'].includes(method)){
    if(req.headers.get('origin')!==u.origin)fail(403,'Cross-origin write denied.');
    const fetchSite=req.headers.get('sec-fetch-site');if(fetchSite&& !['same-origin','none'].includes(fetchSite))fail(403,'Cross-site write denied.');
  }
  const db=database(env);await seed(db);
  if(p.startsWith('/api/admin/'))authorizeControl(p,user);
  const control=await controlRoutes(req,env,db,user,catalog);if(control)return control;
  await enforceOperations(req,db,user);
  if(p==='/api/rooms'||p.startsWith('/api/rooms/')){const response=await roomRoutes(req,env,db,user,catalog);if(response)return response;}
  if(p==='/api/catalog'&&method==='GET')return json(await catalog(db));
  if(p.startsWith('/api/admin/'))requireAdmin(user);
  if(p==='/api/admin/scoring-lab'){const response=await scoringLab(req,db,user,catalog);if(response)return response;}
  if(p==='/api/community'||p.startsWith('/api/community/')||p.startsWith('/api/admin/community')){const response=await communityRoutes(req,env,db,user);if(response)return response;}
  if(p==='/api/admin/catalog'&&method==='GET')return json(await catalog(db,true));
  if(p==='/api/admin/rules'&&method==='POST'){
    const b=await body(req),r=validateRules(b.rules),current=await db.one('SELECT version FROM rules ORDER BY version DESC LIMIT 1');
    if(b.version!==current.version)fail(409,'Rules changed. Reload before saving.');
    const version=current.version+1;
    await db.batch([db.statement('INSERT INTO rules(version,data,created_at) VALUES(?,?,?)',version,JSON.stringify(r),Date.now()),log(db,user,'rules.new-season',String(version))]);
    return json({version});
  }
  if((p==='/api/admin/categories'||p==='/api/admin/languages')&&method==='POST'){
    const b=await body(req);id(b.id);if(typeof b.active!=='boolean')fail(400,'Active flag required.');
    let data,table;
    if(p.endsWith('categories')){table='categories';data={id:b.id,nameId:text(b.nameId,60),nameEn:text(b.nameEn,60),descriptionId:text(b.descriptionId,160,false),descriptionEn:text(b.descriptionEn,160,false)};}
    else {table='languages';validateLanguage(b.id);data={id:b.id,label:text(b.label,60),code:LANGUAGES.find(l=>l.id===b.id).code};}
    await db.batch([db.statement(`INSERT INTO ${table}(id,data,active) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=excluded.active`,b.id,JSON.stringify(data),+b.active),log(db,user,table+'.save',b.id)]);
    return json({ok:true});
  }
  if(p==='/api/admin/upload'&&method==='POST'){
    const bytes=await limitedBody(req,480100),samples=pcmFromWav(bytes),uploadId=crypto.randomUUID(),audioKey=`library/${uploadId}.wav`;
    const profile=analyzeAudio(samples),quality=audioQuality(profile);if(!quality.usable)fail(422,'Sound referensi hening/tidak cukup jelas / Reference sound is silent or unusable.');
    await env.BUCKET.put(audioKey,bytes,{httpMetadata:{contentType:'audio/wav'}});
    const data={audioKey,profile,audioHash:await digest(samples.buffer),duration:samples.length/16000};
    await db.run('INSERT INTO config(id,value) VALUES(?,?)',`upload:${uploadId}`,JSON.stringify(data));
    return json({id:uploadId,url:`/api/media/${uploadId}`,duration:data.duration,quality});
  }
  if(p==='/api/admin/sounds'&&method==='POST'){
    const b=await body(req);id(b.id);id(b.categoryId);validateLanguage(b.language);
    const old=await db.one('SELECT * FROM sounds WHERE id=?',b.id);
    if(old&&b.revision!==old.revision)fail(409,'Sound changed. Reload before saving.');
    if(!await db.one('SELECT id FROM categories WHERE id=?',b.categoryId)||!await db.one('SELECT id FROM languages WHERE id=?',b.language))fail(400,'Unknown category/language.');
    let audio=old?parsed(old):null;
    if(audio?.ugcId&&b.uploadId)fail(400,'Audio UGC tidak dapat diganti. Kirim sound baru / Submit a new sound instead of replacing UGC audio.');
    if(audio?.ugcId&&!await db.one("SELECT id FROM community_submissions WHERE id=? AND status='approved'",audio.ugcId))fail(409,'UGC sudah ditarik / This UGC was withdrawn.');
    if(b.uploadId){id(b.uploadId);const upload=await db.one('SELECT value FROM config WHERE id=?',`upload:${b.uploadId}`);if(!upload)fail(400,'Upload not found.');audio={...JSON.parse(upload.value),url:`/api/media/${b.uploadId}`};}
    if(!audio)fail(400,'Upload audio first.');
    if(!audioQuality(audio.profile).usable)fail(422,'Ganti referensi yang hening/tidak layak / Replace the unusable reference.');
    const kind=b.kind??(old?parsed(old).kind:undefined)??'speech';if(!SOUND_KINDS.includes(kind))fail(400,'Invalid sound type.');
    if(typeof b.active!=='boolean'||typeof b.ranked!=='boolean')fail(400,'Sound status required.');
    const data={title:text(b.title,80),text:text(b.text??'',300,kind==='speech'),kind,source:text(b.source,120),rights:text(b.rights,400),ranked:b.ranked,
      url:audio.url,audioKey:audio.audioKey||null,audioHash:audio.audioHash,profile:audio.profile,duration:audio.duration};
    if(audio.ugcId)Object.assign(data,{ugcId:audio.ugcId,creatorName:audio.creatorName});
    const revision=(old?.revision||0)+1;
    if(audio.ugcId){
      const result=await db.run("UPDATE sounds SET category_id=?,language=?,data=?,active=?,revision=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM community_submissions WHERE id=? AND status='approved')",b.categoryId,b.language,JSON.stringify(data),+b.active,revision,b.id,b.revision,audio.ugcId);
      if(!result.meta.changes)fail(409,'Sound berubah atau ditarik / Sound changed or was withdrawn.');
      await db.batch([log(db,user,'sound.save',b.id)]);return json({id:b.id,revision});
    }
    await db.batch([db.statement('INSERT INTO sounds(id,category_id,language,data,active,revision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,language=excluded.language,data=excluded.data,active=excluded.active,revision=excluded.revision',b.id,b.categoryId,b.language,JSON.stringify(data),+b.active,revision),log(db,user,'sound.save',b.id)]);
    return json({id:b.id,revision});
  }
  if(p.startsWith('/api/media/')&&method==='GET'){
    const mediaId=id(p.split('/').at(-1)),ref=await db.one('SELECT value FROM config WHERE id=?',`upload:${mediaId}`);if(!ref)fail(404,'Audio not found.');
    const obj=await env.BUCKET.get(JSON.parse(ref.value).audioKey);if(!obj)fail(404,'Audio unavailable.');
    return new Response(obj.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
  }
  if(p==='/api/matches'&&method==='POST'){
    requireUser(user);const b=await body(req),c=await catalog(db);if(!c.rules.rankedEnabled)fail(409,'Ranked is currently paused.');
    id(b.categoryId);text(b.language,40);id(b.peerId);if(!/^[A-Z2-9]{6}$/.test(b.code))fail(400,'Invalid room code.');
    const eligible=c.sounds.filter(s=>s.categoryId===b.categoryId&&(b.language==='all'||s.language===b.language)&&s.ranked&&s.duration<=c.rules.recordSeconds);
    if(!eligible.length)fail(400,'No ranked sounds for this category and language.');
    const recent=await db.one('SELECT count(*) AS n FROM matches WHERE host_id=? AND created_at>?',user.id,Date.now()-3600000);if(recent.n>=20)fail(429,'Maximum 20 ranked rooms per hour.');
    const matchId=crypto.randomUUID(),now=Date.now(),data={categoryId:b.categoryId,language:b.language,rules:c.rules};
    await db.batch([db.statement('INSERT INTO matches(id,host_id,code,status,data,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',matchId,user.id,b.code,'lobby',JSON.stringify(data),now,now+7200000),db.statement('INSERT INTO members(id,match_id,user_id,name,peer_id) VALUES(?,?,?,?,?)',crypto.randomUUID(),matchId,user.id,text(b.name,20),b.peerId)]);
    return json(await matchView(db,await match(db,matchId)));
  }
  const matchRoute=p.match(/^\/api\/matches\/([\w-]+)(?:\/(join|start|attempt))?$/);
  if(matchRoute){
    requireUser(user);const m=await match(db,matchRoute[1]),action=matchRoute[2];
    if(m.expires_at<Date.now())fail(410,'Ranked room expired. Create a new room.');
    if(action==='join'&&method==='POST'){
      const b=await body(req);if(b.code!==m.code)fail(403,'Incorrect room code.');
      const existing=await db.one('SELECT * FROM members WHERE match_id=? AND user_id=?',m.id,user.id);
      if(existing){if(existing.peer_id!==b.peerId)fail(409,'This account is already in the room.');return json(await matchView(db,m));}
      if(m.status!=='lobby')fail(409,'Match has already started.');
      const result=await db.run("INSERT INTO members(id,match_id,user_id,name,peer_id) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM members WHERE match_id=?) < ? AND (SELECT status FROM matches WHERE id=?)='lobby'",crypto.randomUUID(),m.id,user.id,text(b.name,20),id(b.peerId),m.id,m.rules.maxPlayers,m.id);
      if(!result.meta.changes)fail(409,'Room full or already started.');return json(await matchView(db,m));
    }
    const player=await member(db,m,user);
    if(!action&&method==='GET')return json(await matchView(db,m));
    if(action==='start'&&method==='POST'){
      if(m.host_id!==user.id)fail(403,'Only the host can start.');
      if(m.status==='started')return json(await matchView(db,m));
      const c=await catalog(db);if(!c.rules.rankedEnabled)fail(409,'Ranked is paused.');
      if(c.rules.version!==m.rules.version)fail(409,'Rules updated. Create a new room for the new season.');
      const eligible=c.sounds.filter(s=>s.categoryId===m.categoryId&&(m.language==='all'||s.language===m.language)&&s.ranked&&s.duration<=m.rules.recordSeconds);
      if(!eligible.length)fail(409,'No eligible sounds.');
      const queue=randomQueue(eligible.map(s=>s.id),m.rules.rounds),clips=eligible.filter(s=>queue.includes(s.id));
      const privateClips=[];for(const s of clips){const row=await db.one('SELECT * FROM sounds WHERE id=?',s.id);privateClips.push({...s,...parsed(row)});}
      const data={categoryId:m.categoryId,language:m.language,rules:m.rules,queue,clips,privateClips};
      await db.run("UPDATE matches SET status='started',data=? WHERE id=? AND status='lobby'",JSON.stringify(data),m.id);
      return json(await matchView(db,await match(db,m.id)));
    }
    if(action==='attempt'&&method==='POST'){
      if(m.status!=='started')fail(409,'Match not started.');
      const round=integer(Number(u.searchParams.get('round')),1,m.queue.length),sound=m.privateClips.find(s=>s.id===m.queue[round-1]);
      const existing=await db.one('SELECT id,status FROM attempts WHERE match_id=? AND round=? AND user_id=?',m.id,round,user.id);if(existing)return json({...existing,duplicate:true});
      const recent=await db.one('SELECT count(*) AS n FROM attempts WHERE user_id=? AND created_at>?',user.id,Date.now()-3600000);if(recent.n>=60)fail(429,'Maximum 60 submissions per hour.');
      const bytes=await limitedBody(req,480100),samples=pcmFromWav(bytes);
      if(samples.length/16000>m.rules.recordSeconds+0.05)fail(400,'Recording exceeds the match limit.');
      const audioHash=await digest(samples.buffer);if(audioHash===sound.audioHash)fail(422,'Reference audio detected. Record your own voice.');
      const duplicate=await db.one('SELECT id FROM attempts WHERE user_id=? AND audio_hash=? LIMIT 1',user.id,audioHash);if(duplicate)fail(422,'This recording was already submitted. Record a new attempt.');
      const attemptId=crypto.randomUUID(),audioKey=`attempts/${attemptId}.wav`,analysis=analyzeAudio(samples);
      await env.BUCKET.put(audioKey,bytes,{httpMetadata:{contentType:'audio/wav'}});
      const data={sound:{id:sound.id,title:sound.title,text:sound.text,url:sound.url,profile:sound.profile,revision:sound.revision},analysis,rules:m.rules};
      try {await db.run('INSERT INTO attempts(id,match_id,round,user_id,name,category_id,sound_id,language,version,status,data,audio_key,audio_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',attemptId,m.id,round,user.id,player.name,sound.categoryId,sound.id,sound.language,m.rules.version,'pending',JSON.stringify(data),audioKey,audioHash,Date.now());}
      catch(e){await env.BUCKET.delete(audioKey);const raced=await db.one('SELECT id,status FROM attempts WHERE match_id=? AND round=? AND user_id=?',m.id,round,user.id);if(raced)return json({...raced,duplicate:true});throw e;}
      return json({id:attemptId,status:'pending'});
    }
  }
  if(p==='/api/my-attempts'&&method==='GET'){
    requireUser(user);const rows=await db.all('SELECT id,category_id,language,status,score,data,created_at,version FROM attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 50',user.id);
    return json({attempts:rows.map(({data,...r})=>({...r,title:JSON.parse(data).sound.title,note:JSON.parse(data).reviewNote||''}))});
  }
  if(p==='/api/admin/attempts'&&method==='GET'){
    const status=u.searchParams.get('status')||'pending';if(!['pending','approved','rejected'].includes(status))fail(400,'Invalid status.');
    const rows=await db.all('SELECT id,name,language,category_id,status,score,data,created_at,version,user_id FROM attempts WHERE status=? ORDER BY created_at DESC LIMIT 50',status);
    return json({attempts:rows.map(({data,user_id,...r})=>({...r,...JSON.parse(data),selfReview:user_id===user.id}))});
  }
  const reviewRoute=p.match(/^\/api\/admin\/attempts\/([\w-]+)(?:\/(audio|review))$/);
  if(reviewRoute){
    const row=await db.one('SELECT * FROM attempts WHERE id=?',reviewRoute[1]);if(!row)fail(404,'Attempt not found.');
    if(reviewRoute[2]==='audio'&&method==='GET'){const obj=await env.BUCKET.get(row.audio_key);if(!obj)fail(404,'Audio unavailable.');return new Response(obj.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store'}});}
    if(reviewRoute[2]==='review'&&method==='POST'){
      if(row.status!=='pending')fail(409,'This attempt was already reviewed.');
      if(row.user_id===user.id)fail(403,'An admin cannot approve their own attempt.');
      const b=await body(req);if(!['approved','rejected'].includes(b.status))fail(400,'Invalid decision.');
      const data=parsed(row),transcript=text(b.transcript??'',300,false),note=text(b.note??'',300,b.status==='rejected');
      const score=b.status==='approved'?scoreSound(data.sound.profile,data.analysis,data.sound.text,transcript,data.rules,data.sound.kind||'speech','admin-verified'):null;
      data.reviewNote=note;data.verifiedTranscript=transcript;data.score=score;
      const changes=await db.batch([db.statement("UPDATE attempts SET status=?,score=?,data=?,reviewed_at=?,reviewer=? WHERE id=? AND status='pending'",b.status,score?.total??null,JSON.stringify(data),Date.now(),user.id,row.id),log(db,user,'attempt.'+b.status,row.id)]);
      if(!changes[0].meta.changes)fail(409,'Another admin already reviewed this attempt.');return json({status:b.status,score});
    }
  }
  if(p==='/api/leaderboard'&&method==='GET'){
    const latest=await db.one('SELECT version FROM rules ORDER BY version DESC LIMIT 1');
    const version=u.searchParams.has('version')?integer(Number(u.searchParams.get('version')),1,latest.version):latest.version;
    const rule=parsed(await db.one('SELECT data FROM rules WHERE version=?',version)),category=u.searchParams.get('category')||'all',language=u.searchParams.get('language')||'all';
    if(category!=='all')id(category);if(language!=='all')validateLanguage(language);
    const rows=await db.all(`WITH best AS (SELECT user_id,category_id,sound_id,MAX(score) AS score FROM attempts WHERE status='approved' AND version=? AND (?='all' OR category_id=?) AND (?='all' OR language=?) GROUP BY user_id,category_id,sound_id), category_scores AS (SELECT user_id,category_id,AVG(score) AS score,COUNT(*) AS sounds FROM best GROUP BY user_id,category_id) SELECT c.user_id,ROUND(AVG(c.score),2) AS score,SUM(c.sounds) AS sounds,COUNT(*) AS categories,(SELECT a.name FROM attempts a WHERE a.user_id=c.user_id AND a.status='approved' ORDER BY a.created_at DESC LIMIT 1) AS name FROM category_scores c GROUP BY c.user_id HAVING SUM(c.sounds)>=? ORDER BY score DESC,sounds DESC,name ASC LIMIT 100`,version,category,category,language,language,rule.minRankedSounds);
    const seasons=await db.all('SELECT version FROM rules ORDER BY version DESC LIMIT 20');
    return json({version,seasons:seasons.map(s=>s.version),minSounds:rule.minRankedSounds,rows:rows.map(({user_id,...r},i)=>({...r,rank:i+1,you:user_id===user?.id}))});
  }
  if(p==='/api/admin/audit'&&method==='GET')return json({entries:await db.all('SELECT action,target,created_at FROM audit ORDER BY created_at DESC LIMIT 50')});
  fail(404,'Not found.');
}
export default {async fetch(req,env){try{return await handle(req,env);}catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);console.error('MIMIC request failed',e?.message);return json({error:'Service unavailable / Layanan belum tersedia. Coba lagi.'},503);}}};
