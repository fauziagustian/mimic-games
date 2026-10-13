import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from '../scripts/runtime.mjs';
import {wavBytes} from '../public/audio.js';
import {SCORING_VERSION} from '../public/scoring-detail.js';

test('Worker scoring lab: protected, real server scores, source labeling, no retained audio/takes, sound validation',async()=>{
  const mf=await runtime(),db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET'),origin='https://mimic.test';
  const call=async(path,{who='admin',body,raw,headers={}}={})=>{const r=await mf.dispatchFetch(origin+path,{method:body||raw?'POST':'GET',headers:{Origin:origin,...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@preview.test'}:{}),...headers},body:raw??(body?JSON.stringify(body):undefined)});return {status:r.status,data:await r.json()};};
  try{
    const catalog=(await call('/api/admin/catalog')).data,clip=catalog.sounds.find(s=>s.id==='lah-kok-gitu'),raw=await readFile('public/audio/lah-kok-gitu.wav'),url='/api/admin/scoring-lab?sound='+clip.id+'&profile=precision';
    assert.equal((await call(url,{who:null,raw})).status,401);assert.equal((await call(url,{who:'player',raw})).status,403);
    await db.prepare('INSERT INTO config(id,value) VALUES(?,?)').bind('staff:mod@preview.test',JSON.stringify({role:'moderator',active:true})).run();assert.equal((await call(url,{who:'mod',raw})).status,403);
    assert.equal((await call(url,{raw,headers:{Origin:'https://evil.test'}})).status,403);
    const before=(await bucket.list()).objects.length;
    const identical=await call(url,{raw,headers:{'X-Transcript':encodeURIComponent(clip.text),'X-Transcript-Source':'manual'}});assert.equal(identical.status,200);assert.equal(identical.data.score.total,100);assert.equal(identical.data.score.scoringVersion,SCORING_VERSION);assert.equal(identical.data.storage,'not-stored');assert.equal(identical.data.score.transcriptSource,'manual');
    const wrong=await call(url,{raw,headers:{'X-Transcript':'wrong','X-Transcript-Source':'browser-asr'}});assert.ok(wrong.data.score.total<identical.data.score.total);
    const missing=await call(url,{raw,headers:{'X-Transcript':encodeURIComponent(clip.text),'X-Transcript-Source':'unavailable'}});assert.equal(missing.data.score.words,0);
    assert.equal((await call(url,{raw,headers:{'X-Transcript-Source':'admin-verified'}})).status,400);
    const silent=wavBytes(new Float32Array(16000));assert.equal((await call(url,{raw:silent})).data.score.total,0);assert.equal((await call('/api/admin/upload',{raw:silent})).status,422);
    assert.equal((await call(url,{raw:new TextEncoder().encode('bad')})).status,400);
    assert.equal((await bucket.list()).objects.length,before);assert.equal((await db.prepare('SELECT count(*) n FROM takes').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM attempts').first()).n,0);
    const asset=(await call('/api/admin/upload',{raw})).data;
    const metadata={id:'effect-test',kind:'sound',title:'Effect',text:'',categoryId:'drama',language:'indonesian',active:true,ranked:false,source:'QA',rights:'Original',uploadId:asset.id};
    assert.equal((await call('/api/admin/sounds',{body:{...metadata,kind:'unknown'}})).status,400);assert.equal((await call('/api/admin/sounds',{body:metadata})).status,200);
    const effect=await call('/api/admin/scoring-lab?sound=effect-test',{raw});assert.equal(effect.data.score.assessed.words,false);assert.equal(effect.data.score.total,100);
    const saved=(await call('/api/catalog')).data.sounds.find(s=>s.id==='effect-test');assert.equal(saved.kind,'sound');assert.ok(saved.quality.usable);assert.equal(saved.profile,undefined);
    const host=(await call('/api/rooms',{who:null,body:{name:'Host',capacity:2,categoryId:'drama',language:'all',profile:'precision',soundIds:['effect-test']}})).data;
    const r=(await call('/api/rooms/'+host.code,{who:null,headers:{'X-Room-Token':host.token}})).data;assert.equal(r.rules.scoringVersion,SCORING_VERSION);assert.equal(r.rules.asrModel,'tiny');assert.equal(r.clips[0].kind,'sound');
    assert.equal((await call('/api/admin/rules',{body:{version:catalog.rules.version,rules:{...catalog.rules,asrModel:'base'}}})).status,200);
    const baseHost=(await call('/api/rooms',{who:null,body:{name:'Base',capacity:2,categoryId:'drama',language:'all',profile:'precision'}})).data;
    const baseRoom=(await call('/api/rooms/'+baseHost.code,{who:null,headers:{'X-Room-Token':baseHost.token}})).data;assert.equal(baseRoom.rules.asrModel,'base');
    const frozen=(await call('/api/rooms/'+host.code,{who:null,headers:{'X-Room-Token':host.token}})).data;assert.equal(frozen.rules.asrModel,'tiny','ASR configuration is frozen per room');
    const ugc=await call('/api/community/submissions',{who:'creator',body:{requestId:crypto.randomUUID(),title:'Nonverbal UGC',creatorName:'Tester',kind:'sound',text:'',categoryId:'drama',language:'indonesian',source:'Original',rights:'Original QA',consent:true,audio:raw.toString('base64')}});
    assert.equal(ugc.status,201);assert.equal(ugc.data.item.kind,'sound');
    const reviewPath='/api/admin/community/'+ugc.data.item.id+'/review';
    assert.equal((await call(reviewPath,{body:{status:'approved',checked:true,kind:'speech'}})).status,400,'cannot classify nonverbal as speech without a transcript');
    const approved=await call(reviewPath,{body:{status:'approved',checked:true,kind:'sound'}});assert.equal(approved.status,200);
    const published=(await call('/api/catalog')).data.sounds.find(s=>s.id===approved.data.soundId);assert.equal(published.kind,'sound');assert.equal(published.text,'');
  }finally{await mf.dispose();}
});
