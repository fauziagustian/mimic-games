import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtime} from '../scripts/runtime.mjs';
import {stageName,matchRequirements} from '../public/match-rules.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const origin='https://mimic.test';
async function fixture(){
  const mf=await runtime(),db=await mf.getD1Database('DB');
  const call=async(path,token,data,who)=>{
    const r=await mf.dispatchFetch(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,...(token?{'X-Room-Token':token}:{}),...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@preview.test'}:{})},body:data?JSON.stringify(data):undefined});
    return {status:r.status,value:await r.json()};
  };
  await call('/api/catalog');
  const create=async(extra={},who)=>(await call('/api/rooms',null,{name:'Host',categoryId:'drama',language:'all',capacity:2,...extra},who));
  return {mf,db,call,create};
}
test('stage name and shared start rules enforce exact capacity, readiness, valid names and sound pool',()=>{
  for(const invalid of ['', ' ', '12345678901', '\n', 'ab\u202ecd', 'ab\u0000cd',null])assert.equal(stageName(invalid),null);
  assert.equal(stageName('  johnuzi  '),'johnuzi');assert.equal(stageName('1234567890'),'1234567890');
  const r={phase:'lobby',capacity:2,matchType:'custom',rules:{maxPlayers:8},players:[{name:'A',ready:true},{name:'B',ready:true}],clips:[{}]};
  assert.equal(matchRequirements(r).canStart,true);
  for(const bad of [{...r,capacity:3},{...r,matchType:'solo'},{...r,phase:'listen'},{...r,clips:[]},{...r,players:[{name:'A',ready:true},{name:'B',ready:false}]},{...r,players:[{name:'12345678901',ready:true},{name:'B',ready:true}]}])assert.equal(matchRequirements(bad).canStart,false);
});
test('lobby markup disables Start for missing slots, missing Ready, or no armed microphone; solo auto-start is explicit',async()=>{
  const source=await readFile('public/app.js','utf8'),fn=source.slice(source.indexOf('function lobbyMarkup()'),source.indexOf('function renderLobby()'));
  const room={phase:'lobby',capacity:2,matchType:'custom',host:true,me:'a',profile:'party',categoryId:'drama',rules:{rounds:3,recordSeconds:15,maxPlayers:8},players:[{id:'a',name:'A',ready:true}],clips:[{}]};
  const context=vm.createContext({room,mic:{},busy:false,matchRequirements,label:x=>x,esc:x=>String(x??''),tr:x=>x,categoryName:()=> 'Drama',catalog:{categories:[{id:'drama'}]}});
  const render=()=>vm.runInContext(fn+';lobbyMarkup()',context);
  assert.match(render(),/id="start" disabled/);assert.match(render(),/Menunggu 1 pemain/);
  room.players.push({id:'b',name:'B',ready:false});assert.match(render(),/id="start" disabled/);
  room.players[1].ready=true;assert.doesNotMatch(render(),/id="start" disabled/);
  context.mic=null;assert.match(render(),/id="start" disabled/);context.mic={};
  room.host=false;assert.doesNotMatch(render(),/id="start"/);
  room.host=true;room.matchType='solo';assert.match(render(),/otomatis mulai setelah 8\/8/);assert.doesNotMatch(render(),/id="start"/);
});
test('Worker: save name syncs all clients and membership, exact custom capacity, host-only start and battle lock',async()=>{
  const {mf,db,call,create}=await fixture();
  try{
    for(const capacity of [0,1,9,2.5,'2'])assert.equal((await create({capacity})).status,400);
    for(const name of ['', '12345678901', 'ab\u202ecd'])assert.equal((await create({name})).status,400);
    assert.equal((await create({practice:true})).status,400);
    const h=(await create({capacity:3,name:'1234567890'})).value,base='/api/rooms/'+h.code;
    assert.equal((await call(base+'/join',null,{name:'TooLongName'})).status,400);
    const g=(await call(base+'/join',null,{name:'Guest'})).value;
    assert.equal((await call(base+'/name',null,{name:'johnuzi'})).status,401);
    assert.equal((await call(base+'/name','0'.repeat(64),{name:'johnuzi'})).status,403);
    assert.equal((await call(base+'/name',h.token,{name:'12345678901'})).status,400);
    assert.equal((await call(base+'/name',h.token,{name:'johnuzi',userId:'other'})).status,200);
    for(const p of [h,g])assert.equal((await call(base,p.token)).value.players[0].name,'johnuzi');
    const member=await db.prepare('SELECT name FROM members WHERE match_id=(SELECT match_id FROM rooms WHERE code=?) AND name=?').bind(h.code,'johnuzi').first();assert.ok(member);
    for(const p of [h,g])await call(base+'/ready',p.token,{});
    assert.equal((await call(base+'/start',h.token,{})).status,409,'2/3 cannot start even if all present players are ready');
    const third=(await call(base+'/join',null,{name:'Third'})).value;
    assert.equal((await call(base+'/start',h.token,{})).status,409,'full but not all ready');
    assert.equal((await call(base+'/join',null,{name:'Overflow'})).status,409);
    await call(base+'/ready',third.token,{});
    assert.equal((await call(base+'/start',g.token,{})).status,403);
    const starts=await Promise.all([call(base+'/start',h.token,{}),call(base+'/start',h.token,{})]);
    assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call(base+'/name',h.token,{name:'Changed'})).status,409);
    const a=(await call(base,h.token)).value,b=(await call(base,g.token)).value;
    assert.equal(a.phase,'listen');assert.deepEqual(a.players,b.players);assert.equal(a.recordAt,b.recordAt);assert.equal(a.players[0].name,'johnuzi');
  }finally{await mf.dispose();}
});
test('Worker: 16 concurrent solo arrivals produce two full rooms; all 8 must ready; same clock and turn order',async()=>{
  const {mf,db,call,create}=await fixture();
  try{
    assert.equal((await create({matchType:'solo',capacity:2})).status,400);
    assert.equal((await create({matchType:'solo',capacity:8,soundIds:['lah-kok-gitu']})).status,400);
    const joined=await Promise.all(Array.from({length:16},(_,i)=>create({matchType:'solo',capacity:8,name:'Player'+i})));
    for(const r of joined)assert.equal(r.status,200,JSON.stringify(r));
    const rooms=Map.groupBy(joined.map(r=>r.value),r=>r.code);assert.equal(rooms.size,2);
    for(const [code,players] of rooms){
      assert.equal(players.length,8);const base='/api/rooms/'+code;
      const before=(await call(base,players[0].token)).value;assert.equal(before.capacity,8);assert.equal(before.players.length,8);assert.equal(before.phase,'lobby');
      assert.equal(new Set(before.players.map(p=>p.id)).size,8);
      assert.equal((await db.prepare('SELECT count(*) n FROM members WHERE match_id=(SELECT match_id FROM rooms WHERE code=?)').bind(code).first()).n,8);
      assert.equal((await call(base+'/join',null,{name:'Invite'})).status,403);
      const readiness=await Promise.all(players.slice(0,7).map(p=>call(base+'/ready',p.token,{})));for(const r of readiness)assert.equal(r.status,200,JSON.stringify(r));
      assert.equal((await call(base,players[0].token)).value.phase,'lobby','7 ready players do not start');
      assert.equal((await call(base+'/ready',players[7].token,{})).status,200);
      const states=await Promise.all(players.map(async p=>(await call(base,p.token)).value));
      for(const s of states){assert.equal(s.phase,'listen');assert.equal(s.recordAt,states[0].recordAt);assert.deepEqual(s.queue,states[0].queue);assert.deepEqual(s.players,states[0].players);assert.equal(s.activePlayerId,s.players[0].id);}
    }
    const one=(await create({matchType:'solo',capacity:8,name:'Wait'})).value,base='/api/rooms/'+one.code;
    await call(base+'/ready',one.token,{});assert.equal((await call(base+'/start',one.token,{})).status,409);
    await call(base+'/leave',one.token,{});assert.equal((await call(base,one.token)).status,403);
    const next=(await create({matchType:'solo',capacity:8,name:'Next'})).value;assert.equal(next.code,one.code);
    const state=(await call(base,next.token)).value;assert.equal(state.players.length,1);assert.equal(state.host,true);assert.equal(state.players[0].name,'Next');
  }finally{await mf.dispose();}
});
test('Worker: solo queue isolates selections and prevents an account joining twice concurrently',async()=>{
  const {mf,call,create}=await fixture();
  try{
    const a=(await create({matchType:'solo',capacity:8})).value;
    for(const selection of [{language:'indonesian'},{categoryId:'chill'},{profile:'precision'}]){
      const b=await create({matchType:'solo',capacity:8,...selection});assert.equal(b.status,200,JSON.stringify(b));assert.notEqual(b.value.code,a.code);
    }
    const duplicate=await Promise.all([create({matchType:'solo',capacity:8},'same'),create({matchType:'solo',capacity:8},'same')]);assert.deepEqual(duplicate.map(r=>r.status).sort(),[200,409]);
    const joined=duplicate.find(r=>r.status===200).value;const state=(await call('/api/rooms/'+joined.code,joined.token,undefined,'same')).value;assert.equal(state.players.filter(p=>p.id==='same').length,1);
    assert.equal((await call('/api/rooms/'+joined.code+'/leave',joined.token,{},'same')).status,200);
    assert.equal((await create({matchType:'solo',capacity:8},'same')).status,200,'account can rejoin after explicitly leaving the lobby');
    const custom=(await create({},'host')).value,base='/api/rooms/'+custom.code;
    const guest=(await call(base+'/join',null,{name:'Guest'},'guest')).value;
    await call(base+'/ready',custom.token,{},'host');await call(base+'/ready',guest.token,{},'guest');
    assert.equal((await call(base+'/leave',guest.token,{},'guest')).status,200);
    assert.equal((await call(base+'/start',custom.token,{},'host')).status,409,'leaving invalidates full-room start eligibility');
    const returned=await call(base+'/join',null,{name:'Guest'},'guest');assert.equal(returned.status,200);
    assert.equal((await call(base+'/start',custom.token,{},'host')).status,409,'rejoined player must ready again');
  }finally{await mf.dispose();}
});
test('Worker: custom capacities 2–8 persist; concurrent arrivals cannot overfill the last slots',async()=>{
  const {mf,db,call,create}=await fixture();
  try{
    for(let capacity=2;capacity<=8;capacity++){
      const response=await create({capacity});assert.equal(response.status,200);
      const h=response.value,base='/api/rooms/'+h.code,state=(await call(base,h.token)).value;
      assert.equal(state.capacity,capacity);assert.equal(state.rules.maxPlayers,capacity);
      if(capacity===8){
        const joins=await Promise.all(Array.from({length:9},(_,i)=>call(base+'/join',null,{name:'P'+i})));
        assert.equal(joins.filter(r=>r.status===200).length,7);assert.equal(joins.filter(r=>r.status===409).length,2);
        assert.equal((await call(base,h.token)).value.players.length,8);
        assert.equal((await db.prepare('SELECT count(*) n FROM members WHERE match_id=(SELECT match_id FROM rooms WHERE code=?)').bind(h.code).first()).n,8);
      }
    }
  }finally{await mf.dispose();}
});
