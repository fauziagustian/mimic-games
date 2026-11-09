import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isSequential,isMyTurn,turnKey,mayCapture,turnCue} from '../public/turns.js';
import {visualPose} from '../public/avatars.js';
import {runtime} from '../scripts/runtime.mjs';
import {gameRoute} from '../public/game-routing.js';
import {rankPlayers,matchStandingsMarkup} from '../public/match-standings.js';

const clockRoom=()=>({turnMode:'sequential-v1',turnIndex:0,round:1,phase:'listen',activePlayerId:'a',me:'a',listenAt:1000,readyAt:6000,recordAt:10000,endAt:15000});
test('Ready → 3 → 2 → 1 → Start boundaries derive from the shared server clock',()=>{
  const room=clockRoom();
  for(const [now,want] of [[0,'listen'],[5999,'listen'],[6000,'Ready'],[6999,'Ready'],[7000,'3'],[8000,'2'],[9000,'1'],[9999,'1'],[10000,'Start'],[10999,'Start'],[11000,'record'],[14999,'record'],[15000,'collect']])assert.equal(turnCue(room,now),want);
  assert.equal(turnKey(room),'1:a');assert.equal(turnKey({...room,turnIndex:1}),'1:a');
  assert.equal(turnKey({...room,activePlayerId:'b'}),'1:b');
  assert.equal(mayCapture(room,9999),false);assert.equal(mayCapture(room,10000),true);assert.equal(mayCapture(room,14999),true);assert.equal(mayCapture(room,15000),false);
  assert.equal(mayCapture({...room,me:'b'},10000),false);assert.equal(mayCapture({...room,phase:'collect'},10000),false);
  assert.equal(visualPose(room,{id:'a'},10000),'interact-right');assert.equal(visualPose(room,{id:'b'},10000),'idle');
  assert.equal(turnCue({...room,phase:'finished'},10000),'');
});

test('client markup and tick: escaped active name, cue text and capture only for active player (DOM doubles)',async()=>{
  let source=await readFile('public/app.js','utf8');
  source=source.replace(/^import .*;\n/gm,'').split('mountNavigation();window.addEventListener')[0];
  const elements=new Map();
  const el=()=>({innerHTML:'',textContent:'',dataset:{},before(){},classList:{add(){},remove(){}}});
  for(const id of ['#app','#countdown','#captureStatus','.battle-grid','.stage','#networkStatus'])elements.set(id,el());
  const storage=new Map();let captures=0,now=6500;
  const context=vm.createContext({
    document:{querySelector:s=>elements.get(s)||null,createElement:el},Date:{now:()=>now},
    t:id=>id,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    uiLanguage:()=> 'id',avatarStage:()=>({sync(){},detach(){},mount(){}}),avatarImage:()=>'',categoryName:()=> 'Drama',
    isSequential,isMyTurn,turnKey,mayCapture,turnCue,gameRoute,rankPlayers,matchStandingsMarkup,drawWave(){},stopAudio(){},
    sessionStorage:{getItem:k=>storage.get(k)},URLSearchParams,location:{origin:'https://mimic.test',href:'https://mimic.test/room/ABCDEF'},
  });
  vm.runInContext(source,context);
  context.fixture={...clockRoom(),players:[{id:'a',name:'<img onerror=x>',total:0},{id:'b',name:'Guest',total:0}],rules:{rounds:2,maxPlayers:8,version:1},results:[],revealIndex:0,queue:['s'],clips:[{id:'s',title:'Sound',text:'hello'}],submitted:[],revision:1,code:'ABCDEF',mode:'casual',profile:'party'};
  context.record=()=>captures++;
  vm.runInContext("room=fixture;session={code:room.code,token:'test'};mic={};captureTake=record;cues.add('listen'+turnKey(room));renderRoom(true);",context);
  assert.match(elements.get('#app').innerHTML,/GILIRAN KAMU/);assert.match(elements.get('#app').innerHTML,/&lt;img onerror=x&gt;/);assert.doesNotMatch(elements.get('#app').innerHTML,/<img onerror/);
  assert.equal(elements.get('#countdown').textContent,'Ready');
  now=7500;vm.runInContext('tick()',context);assert.equal(elements.get('#countdown').textContent,'3');
  now=10000;vm.runInContext('tick();tick()',context);assert.equal(elements.get('#countdown').textContent,'Start');assert.equal(captures,1);
  vm.runInContext("room={...room,turnIndex:1,activePlayerId:'b'};renderRoom(true);tick();",context);
  assert.equal(captures,1);assert.match(elements.get('#app').innerHTML,/Mikrofonmu tidak merekam/);
  assert.doesNotMatch(elements.get('#app').innerHTML,/class="match-scoreboard/);
  vm.runInContext("room={...room,phase:'results',activePlayerId:null,results:[{playerId:'a',total:45},{playerId:'b',total:80}],players:room.players.map((p,i)=>({...p,total:i?80:45})),nextAt:Date.now()+12000};renderRoom(true);tick();",context);
  const board=elements.get('#app').innerHTML;
  assert.match(board,/RONDE SELESAI/);assert.ok(board.indexOf('data-player-id="b"')<board.indexOf('data-player-id="a"'));
  assert.match(board,/\+80 ronde ini/);assert.equal(elements.get('#countdown').textContent,'12s');assert.equal(captures,1);
  vm.runInContext("room={...room,phase:'finished',players:room.players.map(p=>({...p,total:125}))};renderRoom(true);",context);
  assert.match(elements.get('#app').innerHTML,/Juara bersama!/);assert.doesNotMatch(elements.get('#app').innerHTML,/Ronde berikutnya dalam/);
  vm.runInContext("room={...room,turnIndex:2,activePlayerId:'a'};location.href='https://mimic.test/choose-character';tick();",context);assert.equal(captures,1);
});

test('Worker: timed-out turns advance once, next round resets, legacy practice ends, legacy matches stay compatible',async()=>{
  const mf=await runtime(),db=await mf.getD1Database('DB'),origin='https://mimic.test';
  const call=async(path,token,data,raw)=>{const r=await mf.dispatchFetch(origin+path,{method:data||raw?'POST':'GET',headers:{Origin:origin,...(token?{'X-Room-Token':token}:{})},body:raw??(data?JSON.stringify(data):undefined)});return {status:r.status,value:await r.json()};};
  const alter=async(code,fn)=>{const row=await db.prepare('SELECT data FROM rooms WHERE code=?').bind(code).first(),s=JSON.parse(row.data);fn(s);await db.prepare('UPDATE rooms SET data=? WHERE code=?').bind(JSON.stringify(s),code).run();};
  const create=async(practice=false)=>{const h=(await call('/api/rooms',null,{name:'Host',categoryId:'drama',language:'all',capacity:2})).value,base='/api/rooms/'+h.code;if(practice)await alter(h.code,s=>{delete s.matchType;delete s.capacity;s.practice=true;});const g=practice?null:(await call(base+'/join',null,{name:'Guest'})).value;for(const p of [h,g].filter(Boolean))await call(base+'/ready',p.token,{});await call(base+'/start',h.token,{});return {h,g,base};};
  try{
    const {h,g,base}=await create();
    await alter(h.code,s=>{s.recordAt=Date.now()-50000;s.endAt=Date.now()-40000;s.collectUntil=Date.now()-1000;});
    const simultaneous=await Promise.all(Array.from({length:4},()=>call(base,h.token)));
    for(const {status,value:s} of simultaneous){assert.equal(status,200);assert.equal(s.phase,'reveal');assert.equal(s.results.length,1);assert.equal(s.results[0].total,0);assert.equal(s.results[0].takeId,null);}
    await alter(h.code,s=>{s.revealEnd=Date.now()-1;});
    let s=(await call(base,g.token)).value;assert.equal(s.phase,'listen');assert.equal(s.turnIndex,1);assert.equal(s.activePlayerId,s.me);assert.equal(s.recordAt-s.readyAt,4000);assert.equal(s.collectUntil-s.endAt,30000);
    const wav=await readFile('public/audio/lah-kok-gitu.wav');
    await alter(h.code,s=>{s.recordAt=Date.now()-10000;s.endAt=Date.now()-1000;s.collectUntil=Date.now()+30000;s.recordSeconds=15;});
    assert.equal((await call(base+'/take?round=1',h.token,null,wav)).status,409);
    assert.equal((await call(base+'/take?round=1',g.token,null,wav)).status,200);
    s=(await call(base,g.token)).value;assert.equal(s.results.length,2);assert.equal(s.revealIndex,1);
    await alter(h.code,s=>{s.revealEnd=Date.now()-1;});s=(await call(base,h.token)).value;assert.equal(s.phase,'results');assert.equal(s.activePlayerId,null);
    const totals=s.players.map(p=>p.total);
    await alter(h.code,s=>{s.nextAt=Date.now()-1;});s=(await call(base,h.token)).value;assert.equal(s.round,2);assert.equal(s.phase,'listen');assert.equal(s.turnIndex,0);assert.equal(s.activePlayerId,s.me);assert.deepEqual(s.results,[]);assert.deepEqual(s.submitted,[]);assert.deepEqual(s.players.map(p=>p.total),totals);
    // A running pre-update room is not silently switched to a different turn protocol.
    await alter(h.code,s=>{delete s.turnMode;delete s.activePlayerId;s.recordAt=Date.now()-50000;s.endAt=Date.now()-40000;s.collectUntil=Date.now()-1;});
    s=(await call(base,h.token)).value;assert.equal(s.phase,'reveal');assert.equal(s.results.length,2);
    const solo=await create(true);await alter(solo.h.code,s=>{s.rules.rounds=1;s.recordAt=Date.now()-50000;s.endAt=Date.now()-40000;s.collectUntil=Date.now()-1;});
    s=(await call(solo.base,solo.h.token)).value;assert.equal(s.phase,'reveal');
    await alter(solo.h.code,s=>{s.revealEnd=Date.now()-1;});s=(await call(solo.base,solo.h.token)).value;assert.equal(s.phase,'finished');assert.equal(s.activePlayerId,null);
  }finally{await mf.dispose();}
});
