import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from '../scripts/runtime.mjs';
import {updatePresence,PRESENCE_TIMEOUT_MS,HEARTBEAT_WRITE_MS} from '../server/presence.js';
import {turnKey} from '../public/turns.js';
import {roomRoutes} from '../server/rooms.js';
import {database} from '../server/db.js';

async function fixture(){
  const mf=await runtime(),db=await mf.getD1Database('DB'),origin='https://mimic.test';
  const call=async(path,token,data)=>{
    const raw=ArrayBuffer.isView(data);
    const r=await mf.dispatchFetch(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,...(token?{'X-Room-Token':token}:{})},body:data?(raw?data:JSON.stringify(data)):undefined});
    return {status:r.status,value:await r.json()};
  };
  const stored=async code=>db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();
  const alter=async(code,fn)=>{const row=await stored(code),s=JSON.parse(row.data);fn(s);await db.prepare('UPDATE rooms SET data=? WHERE code=?').bind(JSON.stringify(s),code).run();};
  const create=async(extra={})=>{const r=await call('/api/rooms',null,{name:'P0',categoryId:'drama',language:'all',capacity:3,...extra});assert.equal(r.status,200,JSON.stringify(r));return r.value;};
  const room=async(n=3,start=true)=>{
    const h=await create({capacity:n}),base='/api/rooms/'+h.code,clients=[h];
    for(let i=1;i<n;i++){const r=await call(base+'/join',null,{name:'P'+i});assert.equal(r.status,200);clients.push(r.value);}
    for(const p of clients)assert.equal((await call(base+'/ready',p.token,{})).status,200);
    if(start)assert.equal((await call(base+'/start',h.token,{})).status,200);
    return {code:h.code,base,clients};
  };
  const get=async(r,i=1)=>{const response=await call(r.base,r.clients[i].token);assert.equal(response.status,200,JSON.stringify(response));return response.value;};
  const expire=async(r,names)=>alter(r.code,s=>{for(const p of s.players)p.lastSeenAt=Date.now()-(names.includes(p.name)?31000:0);});
  return {mf,db,call,stored,alter,create,room,get,expire};
}

test('presence leases: exact deadline, receipt clock, write throttle, legacy grace and immutable completed standings',()=>{
  const now=100000,s={phase:'lobby',players:[{id:'a',lastSeenAt:now-29999},{id:'b',lastSeenAt:now-30000},{id:'legacy'}]};
  let result=updatePresence(s,'a',now);assert.deepEqual(result.expired,['b']);assert.equal(s.players[0].lastSeenAt,now);assert.equal(s.players[2].lastSeenAt,now);
  assert.equal(updatePresence(s,'a',now+HEARTBEAT_WRITE_MS-1).touched,false);
  assert.equal(updatePresence(s,'a',now+HEARTBEAT_WRITE_MS).touched,true);
  result=updatePresence({phase:'lobby',players:[{id:'a',lastSeenAt:now-PRESENCE_TIMEOUT_MS}]},'a',now);
  assert.deepEqual(result.expired,['a'],'late reconnect does not revive an expired seat');
  assert.deepEqual(updatePresence({...s,phase:'finished'},'a',now+90000),{expired:[],touched:false});
});

test('Worker: 8 → 7 after abrupt host disconnect, automatic turn/host transfer, synced clients and revoked token',async()=>{
  const f=await fixture();try{
    const r=await f.room(8),before=await f.get(r);await f.expire(r,['P0']);
    const states=await Promise.all(Array.from({length:7},(_,i)=>f.get(r,i+1)));
    for(const s of states){assert.equal(s.players.length,7);assert.equal(s.capacity,8);assert.equal(s.phase,'listen');assert.equal(s.activePlayerId,before.players[1].id);assert.equal(s.recordAt,states[0].recordAt);assert.equal(s.departedPlayers.length,1);assert.equal(s.turnIndex,1);assert.equal(s.hostId,before.players[1].id);assert.equal(s.players.some(p=>'lastSeenAt' in p),false);}
    assert.equal(states[0].host,true);assert.equal(states[1].host,false);
    assert.equal((await f.call(r.base,r.clients[0].token)).status,403);
    assert.equal((await f.call(r.base+'/take?round=1',r.clients[0].token,await readFile('public/audio/lah-kok-gitu.wav'))).status,403);
    assert.equal((await f.call(r.base+'/join',null,{name:'New'})).status,409,'no backfill during battle');
    assert.equal((await f.db.prepare('SELECT count(*) n FROM members WHERE match_id=(SELECT match_id FROM rooms WHERE code=?)').bind(r.code).first()).n,7);
    assert.equal((await f.db.prepare('SELECT host_id FROM matches WHERE code=?').bind(r.code).first()).host_id,states[0].hostId);
    const rev=states[0].revision;await f.alter(r.code,s=>{for(const p of s.players)p.lastSeenAt=Date.now()-6000;});
    const beats=await Promise.all(Array.from({length:7},(_,i)=>f.get(r,i+1)));
    assert.ok(beats.every(s=>s.revision===rev),'heartbeat alone does not rebuild the UI');
    assert.ok(JSON.parse((await f.stored(r.code)).data).players.every(p=>Date.now()-p.lastSeenAt<5000),'concurrent heartbeats are not lost');
  }finally{await f.mf.dispose();}
});

test('Worker: explicit leave and timeout skip active listen/record/collect/reveal safely, score history indexes stay valid',async()=>{
  const f=await fixture();try{
    for(const mode of ['leave','timeout'])for(const phase of ['listen','record','collect','reveal']){
      const r=await f.room();await f.alter(r.code,s=>{s.phase=phase;if(phase==='reveal'){s.results=[{playerId:s.players[0].id,name:'P0',total:77,takeId:null}];s.players[0].total=77;s.revealEnd=Date.now()+60000;}});
      if(mode==='leave')assert.equal((await f.call(r.base+'/leave',r.clients[0].token,{})).status,200);else await f.expire(r,['P0']);
      let s=await f.get(r);assert.equal(s.phase,'listen',mode+phase);assert.equal(s.players.length,2);assert.equal(s.activePlayerId,s.me);assert.equal(s.turnIndex,1);assert.equal(s.results.length,phase==='reveal'?1:0);
      assert.equal(s.departedPlayers[0].total,phase==='reveal'?77:0);assert.ok(s.recordAt>Date.now());
      await f.alter(r.code,s=>{s.recordAt=Date.now()-40000;s.endAt=Date.now()-35000;s.collectUntil=Date.now()-1;});
      const many=await Promise.all([f.get(r),f.get(r,2),f.get(r)]);s=many[0];
      assert.equal(s.phase,'reveal');assert.equal(s.revealIndex,s.results.length-1);assert.equal(s.results.at(-1).playerId,s.players[0].id);
      assert.ok(many.every(x=>x.results.length===s.results.length));
      await f.alter(r.code,s=>s.revealEnd=Date.now()-1);s=await f.get(r);assert.equal(s.activePlayerId,s.players[1].id);assert.equal(s.turnIndex,2);
    }
  }finally{await f.mf.dispose();}
});

test('Worker: departures before/after current seat preserve its clock and stable key; no repeated turns',async()=>{
  const f=await fixture();try{
    const r=await f.room();await f.alter(r.code,s=>{s.turnIndex=1;s.activePlayerId=s.players[1].id;s.results=[{playerId:s.players[0].id,total:60}];s.players[0].total=60;});
    const before=await f.get(r);
    await f.call(r.base+'/leave',r.clients[0].token,{});let s=await f.get(r);
    assert.equal(s.recordAt,before.recordAt);assert.equal(turnKey(s),turnKey(before));assert.equal(s.turnIndex,1);assert.equal(s.results[0].total,60);
    await f.call(r.base+'/leave',r.clients[2].token,{});s=await f.get(r);
    assert.equal(s.players.length,1);assert.equal(s.recordAt,before.recordAt);assert.equal(s.phase,'listen');
    await f.alter(r.code,s=>{s.phase='collect';s.collectUntil=Date.now()-1;});s=await f.get(r);assert.equal(s.revealIndex,1);
    await f.alter(r.code,s=>s.revealEnd=Date.now()-1);s=await f.get(r);assert.equal(s.phase,'results');
    await f.alter(r.code,s=>s.nextAt=Date.now()-1);s=await f.get(r);assert.equal(s.round,2);assert.equal(s.turnIndex,0);assert.deepEqual(s.turnOrder,[s.me]);
    await f.alter(r.code,s=>{s.rules.rounds=2;s.phase='collect';s.collectUntil=Date.now()-1;});await f.get(r);
    await f.alter(r.code,s=>s.revealEnd=Date.now()-1);s=await f.get(r);assert.equal(s.phase,'finished');
    await f.expire(r,['P1']);assert.equal((await f.get(r)).players.length,1,'finished standings do not expire');
    assert.equal((await f.call(r.base+'/leave',r.clients[1].token,{})).status,200);assert.equal((await f.call(r.base,r.clients[1].token)).status,403);
  }finally{await f.mf.dispose();}
});

test('Worker: all players gone closes active room without crashing or allowing late resurrection',async()=>{
  const f=await fixture();try{
    const r=await f.room(2);await f.expire(r,['P0','P1']);
    assert.equal((await f.call(r.base,r.clients[0].token)).status,403);
    const s=JSON.parse((await f.stored(r.code)).data);assert.equal(s.phase,'finished');assert.equal(s.endedReason,'empty');assert.deepEqual(s.players,[]);assert.equal(s.hostId,'');
    assert.equal((await f.call(r.base+'/join',null,{name:'Late'})).status,409);
  }finally{await f.mf.dispose();}
});

test('Worker: lobby loses readiness/full gate, freed custom/solo slots are reusable without old clients polling',async()=>{
  const f=await fixture();try{
    const r=await f.room(2,false);await f.expire(r,['P1']);
    assert.equal((await f.call(r.base+'/start',r.clients[0].token,{})).status,409);
    const replacement=await f.call(r.base+'/join',null,{name:'New'});assert.equal(replacement.status,200);
    assert.equal((await f.call(r.base+'/start',r.clients[0].token,{})).status,409,'replacement must ready');
    await f.call(r.base+'/ready',replacement.value.token,{});assert.equal((await f.call(r.base+'/start',r.clients[0].token,{})).status,200);
    const solo=[];for(let i=0;i<8;i++)solo.push(await f.create({matchType:'solo',capacity:8,name:'S'+i}));
    const base='/api/rooms/'+solo[0].code;assert.ok(solo.every(p=>p.code===solo[0].code));
    for(const p of solo.slice(0,7))await f.call(base+'/ready',p.token,{});
    await f.alter(solo[0].code,s=>{s.players[7].lastSeenAt=Date.now()-31000;});
    const next=await f.create({matchType:'solo',capacity:8,name:'NewSolo'});assert.equal(next.code,solo[0].code);
    let s=(await f.call(base,next.token)).value;assert.equal(s.phase,'lobby');assert.equal(s.players.length,8);assert.equal(s.players.at(-1).ready,false);
    await f.call(base+'/ready',next.token,{});s=(await f.call(base,next.token)).value;assert.equal(s.phase,'listen');
    const empty=await f.create({matchType:'solo',capacity:8});await f.alter(empty.code,s=>{s.players[0].lastSeenAt=Date.now()-31000;});
    const reused=await f.create({matchType:'solo',capacity:8,name:'Reuse'});assert.equal(reused.code,empty.code);
    assert.equal((await f.call('/api/rooms/'+reused.code,reused.token)).value.host,true);
  }finally{await f.mf.dispose();}
});

test('Worker: near-deadline reconnect survives, legacy room initializes leases, concurrent leaves remove exactly once',async()=>{
  const f=await fixture();try{
    const r=await f.room();await f.alter(r.code,s=>{delete s.turnOrder;for(const p of s.players)delete p.lastSeenAt;});
    let s=await f.get(r);assert.equal(s.players.length,3);
    await f.alter(r.code,s=>s.players[0].lastSeenAt=Date.now()-28000);
    assert.equal((await f.call(r.base,r.clients[0].token)).status,200);s=await f.get(r);assert.equal(s.players.length,3);
    await Promise.all([f.call(r.base+'/leave',r.clients[0].token,{}),f.call(r.base+'/leave',r.clients[0].token,{}),f.get(r),f.call(r.base+'/leave',r.clients[2].token,{})]);
    s=await f.get(r);assert.equal(s.players.length,1);assert.equal(s.activePlayerId,s.me);assert.equal(s.departedPlayers.length,2);assert.equal(s.turnIndex,1);assert.equal(s.host,true);
    assert.equal((await f.db.prepare('SELECT count(*) n FROM members WHERE match_id=(SELECT match_id FROM rooms WHERE code=?)').bind(r.code).first()).n,1);
  }finally{await f.mf.dispose();}
});

test('Worker/D1/R2: leaving while an upload is in flight cannot commit an orphan take or retain its audio',async()=>{
  const f=await fixture();try{
    const r=await f.room(),bucket=await f.mf.getR2Bucket('BUCKET');
    await f.alter(r.code,s=>{s.recordAt=Date.now()-1000;s.endAt=Date.now()+10000;s.collectUntil=Date.now()+40000;s.recordSeconds=15;});
    const env={DB:f.db,BUCKET:{async put(...args){await bucket.put(...args);assert.equal((await f.call(r.base+'/leave',r.clients[0].token,{})).status,200);},delete:key=>bucket.delete(key)}};
    const req=new Request('https://mimic.test'+r.base+'/take?round=1',{method:'POST',headers:{'X-Room-Token':r.clients[0].token},body:await readFile('public/audio/lah-kok-gitu.wav')});
    await assert.rejects(roomRoutes(req,env,database(env),null,()=>{throw Error('unexpected catalog read');}),e=>e.status===409);
    assert.equal((await f.db.prepare('SELECT count(*) n FROM takes').first()).n,0);
    assert.equal((await bucket.list({prefix:'attempts/'})).objects.length,0);
    const s=await f.get(r);assert.equal(s.phase,'listen');assert.equal(s.activePlayerId,s.me);
  }finally{await f.mf.dispose();}
});

test('Worker: legacy simultaneous match waits for every remaining player, not takes belonging to departed players',async()=>{
  const f=await fixture();try{
    const r=await f.room(),before=await f.get(r);
    await f.alter(r.code,s=>{delete s.turnMode;s.phase='collect';s.activePlayerId=null;s.collectUntil=Date.now()+60000;});
    const matchId=(await f.stored(r.code)).match_id;
    const insert=async i=>f.db.prepare('INSERT INTO takes(id,match_id,round,user_id,data,audio_key) VALUES(?,?,?,?,?,?)').bind('take-'+i,matchId,1,before.players[i].id,JSON.stringify({id:'take-'+i,score:{total:35}}),'unused-'+i).run();
    await insert(0);await insert(1);await f.call(r.base+'/leave',r.clients[0].token,{});
    assert.equal((await f.get(r)).phase,'collect');await insert(2);
    const s=await f.get(r);assert.equal(s.phase,'reveal');assert.equal(s.results.length,2);assert.ok(s.results.every(x=>x.playerId!==before.players[0].id));assert.ok(s.players.every(p=>p.total===35));
  }finally{await f.mf.dispose();}
});
