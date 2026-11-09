import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from '../scripts/runtime.mjs';
import {wavBytes} from '../public/audio.js';

test('UGC: private upload → moderation → catalog/game → ranked curation → withdrawal',async t=>{
  const mf=await runtime(),db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET'),origin='https://mimic.test';
  const audio=(await readFile('public/audio/lah-kok-gitu.wav')).toString('base64');
  const payload=(overrides={})=>({requestId:crypto.randomUUID(),title:'Kok bisa begitu?',creatorName:'QA creator',text:'Lah kok bisa gitu',categoryId:'ugc-test',language:'english',source:'Original QA voice',rights:'Original recording, permitted for this test.',consent:true,audio,...overrides});
  const call=async(path,{who,method='GET',data,headers={}}={})=>{
    const r=await mf.dispatchFetch(origin+path,{method,headers:{...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who==='admin'?'admin@preview.test':who+'@preview.test'}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    if(r.headers.get('Content-Type')==='audio/wav')return {status:r.status,value:new Uint8Array(await r.arrayBuffer()),cache:r.headers.get('Cache-Control')};
    const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value};
  };
  const post=(path,who,data)=>call(path,{who,method:'POST',data});
  const submit=(who='creator',overrides={})=>post('/api/community/submissions',who,payload(overrides));
  const review=(item,status='approved',overrides={})=>post(`/api/admin/community/${item.id}/review`,'admin',{status,checked:true,note:status==='rejected'?'Transcript does not match the audio.':'QA checked',...overrides});
  let item,sound;
  try{
    await t.test('new page, identity, CSRF, bounded validation',async()=>{
      for(const path of ['/community','/community.js','/community.css','/admin-community.js'])assert.equal((await call(path)).status,200,path);
      assert.equal((await call('/api/community')).value.items.length,0);
      assert.equal((await call('/api/community/mine')).status,401);
      assert.equal((await call('/api/admin/community',{who:'creator'})).status,403);
      assert.equal((await submit(null)).status,401);
      assert.equal((await call('/api/community/submissions',{who:'creator',method:'POST',data:payload(),headers:{Origin:'https://other.test'}})).status,403);
      assert.equal((await post('/api/community/submissions','creator',null)).status,400);
      await post('/api/admin/categories','admin',{id:'ugc-test',nameId:'UGC uji',nameEn:'UGC test',descriptionId:'',descriptionEn:'',active:true});
      assert.equal((await submit('creator',{consent:false})).status,400);
      assert.equal((await submit('creator',{audio:'not_base64'})).status,400);
      assert.equal((await submit('creator',{audio:Buffer.from('invalid WAV').toString('base64')})).status,400);
      assert.equal((await submit('creator',{audio:Buffer.from(wavBytes(new Float32Array(8000))).toString('base64')})).status,422);
      assert.equal((await submit('creator',{language:'fake-language'})).status,400);
      assert.equal((await submit('creator',{categoryId:'absent'})).status,400);
      assert.equal((await submit('creator',{title:'x'.repeat(81)})).status,400);
      assert.equal((await submit('creator',{audio:'a'.repeat(660000)})).status,413);
      assert.equal((await call('/api/community/mine',{who:'creator'})).value.remaining,5);
    });
    await t.test('pending uploads stay private and retries are idempotent',async()=>{
      const b=payload({ranked:true,status:'approved',ownerId:'admin',creatorName:'<img src=x onerror=alert(1)>'});
      const r=await post('/api/community/submissions','creator',b);assert.equal(r.status,201,JSON.stringify(r.value));item=r.value.item;
      assert.equal(item.status,'pending');assert.equal(item.ranked,false);
      for(const key of ['ownerId','owner_id','reviewer','profile','audioKey','audioHash','requestId'])assert.equal(item[key],undefined,key);
      const retry=await post('/api/community/submissions','creator',b);assert.equal(retry.value.duplicate,true);assert.equal(retry.value.item.id,item.id);
      assert.equal((await call('/api/community/mine',{who:'creator'})).value.items.length,1);
      assert.equal((await call('/api/community/mine',{who:'stranger'})).value.items.length,0);
      assert.equal((await call(item.url)).status,404);assert.equal((await call(item.url,{who:'stranger'})).status,404);
      assert.equal((await call(item.url,{who:'creator'})).status,200);assert.equal((await call(item.url,{who:'admin'})).cache,'private, no-store');
      assert.equal((await call('/api/media/'+item.id)).status,404);
      assert.equal((await call('/api/community')).value.items.length,0);
      assert.equal((await call('/api/catalog')).value.sounds.length,23);
      assert.equal((await post(`/api/admin/community/${item.id}/review`,'creator',{status:'approved',checked:true})).status,403);
      assert.equal((await review(item,'approved',{checked:false})).status,400);
      assert.equal((await review(item,'rejected',{note:''})).status,400);
    });
    await t.test('approval publishes a casual-only sound; no score is granted',async()=>{
      const r=await review(item);assert.equal(r.status,200,JSON.stringify(r.value));
      assert.equal((await review(item)).status,409);
      const lib=(await call('/api/community?category=ugc-test&language=english')).value.items;assert.equal(lib.length,1);
      assert.equal(lib[0].creatorName,'<img src=x onerror=alert(1)>');assert.equal(lib[0].ranked,false);
      for(const key of ['owner_id','profile','audioKey','note','reviewer','audioHash'])assert.equal(lib[0][key],undefined,key);
      assert.equal((await call(item.url)).status,200);assert.equal((await call('/api/community?language=indonesian')).value.items.length,0);
      sound=(await call('/api/catalog')).value.sounds.find(s=>s.ugcId===item.id);assert.ok(sound);assert.equal(sound.ranked,false);assert.equal(sound.creatorName,lib[0].creatorName);
      const casual=await post('/api/rooms',null,{name:'Guest',categoryId:'ugc-test',language:'english',mode:'casual',profile:'party',capacity:2});assert.equal(casual.status,200,JSON.stringify(casual.value));
      const room=(await call('/api/rooms/'+casual.value.code,{headers:{'X-Room-Token':casual.value.token}})).value;assert.ok(room.clips.some(s=>s.id===sound.id));assert.ok(room.queue.every(id=>id===sound.id));
      assert.equal((await post('/api/rooms','player',{name:'Player',categoryId:'ugc-test',language:'english',mode:'ranked',capacity:2})).status,400);
      assert.equal((await call('/api/leaderboard')).value.rows.length,0);
      assert.equal((await call('/api/community/mine',{who:'creator'})).value.items[0].note,'QA checked');
    });
    await t.test('admin retains creator credits, curates ranked, hides disabled sounds',async()=>{
      const changed=await post('/api/admin/sounds','admin',{...sound,ranked:true,active:true});assert.equal(changed.status,200,JSON.stringify(changed.value));
      sound=(await call('/api/catalog')).value.sounds.find(s=>s.id===sound.id);assert.equal(sound.ugcId,item.id);assert.equal(sound.creatorName,'<img src=x onerror=alert(1)>');
      assert.equal((await post('/api/rooms','player',{name:'Player',categoryId:'ugc-test',language:'english',mode:'ranked',capacity:2})).status,200);
      assert.equal((await post('/api/admin/sounds','admin',{...sound,uploadId:'replace'})).status,400);
      assert.equal((await post('/api/admin/sounds','admin',{...sound,active:false})).status,200);
      assert.equal((await call('/api/community')).value.items.length,0);assert.equal((await call(item.url)).status,404);assert.equal((await call(item.url,{who:'creator'})).status,200);
      sound=(await call('/api/admin/catalog',{who:'admin'})).value.sounds.find(s=>s.id===sound.id);
      assert.equal((await post('/api/admin/sounds','admin',{...sound,active:true})).status,200);
      await post('/api/admin/categories','admin',{id:'ugc-test',nameId:'UGC uji',nameEn:'UGC test',descriptionId:'',descriptionEn:'',active:false});
      assert.equal((await call('/api/community')).value.items.length,0);assert.equal((await call(item.url)).status,404);assert.equal((await submit('creator')).status,400);
      await post('/api/admin/categories','admin',{id:'ugc-test',nameId:'UGC uji',nameEn:'UGC test',descriptionId:'',descriptionEn:'',active:true});
    });
    await t.test('withdrawal is owner-only and cannot be reactivated by a stale admin edit',async()=>{
      sound=(await call('/api/catalog')).value.sounds.find(s=>s.id===sound.id);
      assert.equal((await post(`/api/community/submissions/${item.id}/withdraw`,'stranger',{})).status,404);
      assert.equal((await post(`/api/community/submissions/${item.id}/withdraw`,'creator',{})).status,200);
      assert.equal((await post(`/api/community/submissions/${item.id}/withdraw`,'creator',{})).status,200);
      assert.equal((await call(item.url)).status,404);assert.equal((await call(item.url,{who:'creator'})).status,200);
      assert.equal((await call('/api/community')).value.items.length,0);
      assert.equal((await call('/api/catalog')).value.sounds.some(s=>s.id===sound.id),false);
      assert.equal((await post('/api/admin/sounds','admin',{...sound,active:true})).status,409);
      const current=(await call('/api/admin/catalog',{who:'admin'})).value.sounds.find(s=>s.id===sound.id);
      assert.equal((await post('/api/admin/sounds','admin',{...current,active:true})).status,409);
    });
    await t.test('rejection notes are private; approval/withdrawal races are safe',async()=>{
      const rejected=(await submit('rejectee')).value.item;assert.equal((await review(rejected,'rejected')).status,200);
      assert.equal((await call('/api/community/mine',{who:'rejectee'})).value.items[0].status,'rejected');assert.equal((await call(rejected.url)).status,404);
      const contender=(await submit('race-review')).value.item;
      const responses=await Promise.all([review(contender),review(contender,'rejected')]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
      const row=await db.prepare('SELECT * FROM community_submissions WHERE id=?').bind(contender.id).first();
      const made=await db.prepare('SELECT * FROM sounds WHERE id=?').bind('ugc-'+contender.id).first();assert.equal(!!made,row.status==='approved');
      const logs=await db.prepare("SELECT count(*) AS n FROM audit WHERE target=? AND action IN ('community.approved','community.rejected')").bind(contender.id).first();assert.equal(logs.n,1);
      const withdrawRace=(await submit('race-withdraw')).value.item;
      await Promise.all([review(withdrawRace),post(`/api/community/submissions/${withdrawRace.id}/withdraw`,'race-withdraw',{})]);
      assert.equal((await call('/api/community/mine',{who:'race-withdraw'})).value.items[0].status,'withdrawn');assert.equal((await call(withdrawRace.url)).status,404);
      assert.equal((await call('/api/catalog')).value.sounds.some(s=>s.ugcId===withdrawRace.id),false);
    });
    await t.test('concurrent requests obey quota and do not leave orphan audio',async()=>{
      const before=(await bucket.list({prefix:'community/'})).objects.length;
      const shared=payload(),duplicate=await Promise.all([post('/api/community/submissions','duplicate',shared),post('/api/community/submissions','duplicate',shared)]);
      assert.deepEqual(duplicate.map(r=>r.status).sort(),[200,201]);assert.equal(duplicate[0].value.item.id,duplicate[1].value.item.id);
      assert.equal((await bucket.list({prefix:'community/'})).objects.length,before+1);
      const results=await Promise.all(Array.from({length:7},()=>submit('quota')));assert.equal(results.filter(r=>r.status===201).length,5);assert.equal(results.filter(r=>r.status===429).length,2);
      assert.equal((await call('/api/community/mine',{who:'quota'})).value.remaining,0);
      assert.equal((await bucket.list({prefix:'community/'})).objects.length,before+6);
      const own=(await call('/api/community/mine',{who:'quota'})).value.items[0];await post(`/api/community/submissions/${own.id}/withdraw`,'quota',{});
      assert.equal((await submit('quota')).status,429,'Withdrawal must not reset the daily quota');
    });
    await t.test('pagination is bounded and private details are owner-scoped',async()=>{
      const template=await db.prepare('SELECT * FROM community_submissions WHERE id=?').bind(item.id).first();
      await db.batch(Array.from({length:26},(_,i)=>db.prepare('INSERT INTO community_submissions(id,owner_id,request_id,category_id,language,data,audio_key,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('page-'+i,'pages','request-'+i,'ugc-test','english',template.data,template.audio_key,Date.now()+i)));
      const first=(await call('/api/community/mine',{who:'pages'})).value,second=(await call('/api/community/mine?page=1',{who:'pages'})).value;
      assert.equal(first.items.length,24);assert.equal(first.nextPage,1);assert.equal(second.items.length,2);assert.equal(second.nextPage,null);assert.equal(first.remaining,0);
      assert.equal(new Set([...first.items,...second.items].map(s=>s.id)).size,26);
      assert.equal((await call('/api/community/mine?page=-1',{who:'pages'})).status,400);
      assert.equal((await call('/api/admin/community?status=unknown',{who:'admin'})).status,400);
      assert.equal((await call('/api/community?page=NaN')).status,400);
      // Old pending entries still consume the pending quota after the daily window expires.
      await db.prepare('UPDATE community_submissions SET created_at=? WHERE owner_id=?').bind(Date.now()-172800000,'pages').run();
      assert.equal((await call('/api/community/mine',{who:'pages'})).value.remaining,0);
      assert.equal((await submit('pages')).status,429);
    });
  }finally{await mf.dispose();}
});
