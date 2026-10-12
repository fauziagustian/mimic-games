import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {turnKey,isSequential,isMyTurn} from '../public/turns.js';
import {escapeHTML} from '../public/platform.js';

test('dropout markup shows remaining count, escapes names and never displays an out-of-range turn number (DOM doubles)',async()=>{
  const source=await readFile('public/app.js','utf8');
  const presence=source.slice(source.indexOf('function presenceMarkup()'),source.indexOf('function lobbyMarkup()'));
  const stage=source.slice(source.indexOf('function playStageMarkup('),source.indexOf('function renderRoom('));
  const room={round:1,turnMode:'sequential-v1',turnIndex:7,activePlayerId:'last',me:'last',players:[{id:'last',name:'Last'}],rules:{rounds:3},lastDeparture:{names:['<script>bad</script>'],reason:'disconnected'}};
  const c=vm.createContext({room,esc:escapeHTML,label:escapeHTML,isSequential,isMyTurn,mic:{},busy:false,pendingTake:null});
  const html=vm.runInContext(presence+stage+';presenceMarkup()+playStageMarkup({title:"Sound",text:"Hi"})',c);
  assert.match(html,/1 pemain tersisa/);assert.match(html,/GILIRAN 1\/1/);assert.doesNotMatch(html,/GILIRAN 8\/1|<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/sekitar 30 detik/);
});

test('poll lifecycle times out, retries, stops outdated turn playback, and releases microphone after eviction (DOM/API doubles)',async()=>{
  const source=await readFile('public/app.js','utf8'),fn=source.slice(source.indexOf('async function poll()'),source.indexOf('async function playTake('));
  let timer,mode='hang',stopped=0,capturesStopped=0,tracksStopped=0,removed=0,lastSignal;
  const status={textContent:'',classList:{add(){},remove(){removed++;}}};
  const original={round:1,turnMode:'sequential-v1',activePlayerId:'old',revision:1};
  const c=vm.createContext({session:{code:'ABCDEF'},room:original,polling:false,pollController:null,lastContact:0,offset:0,Date,AbortController,
    setTimeout(fn,ms){assert.equal(ms,8000);timer=fn;return 1;},clearTimeout(){},
    $:()=>status,tr:x=>x,turnKey,stopAudio(){stopped++;},capture:{stop(){capturesStopped++;}},mic:{getTracks:()=>[{stop(){tracksStopped++;}}]},
    sessionStorage:{removeItem(){removed++;}},toast(){},pendingTake:{},onRoomPage:()=>false,route:()=>({page:'home'}),renderScreen(){},
    roomApi:async(action,{signal})=>{lastSignal=signal;if(mode==='hang')return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('timed out'))));if(mode==='expired')throw Object.assign(new Error('Player left'),{status:403});return {...original,activePlayerId:'new',revision:2,code:'ABCDEF',serverTime:Date.now()};}
  });
  vm.runInContext(fn,c);
  const hung=vm.runInContext('poll()',c);assert.equal(c.polling,true);timer();await hung;
  assert.equal(lastSignal.aborted,true);assert.equal(c.polling,false);assert.equal(c.pollController,null);assert.match(status.textContent,/Menghubungkan/);
  mode='ok';await vm.runInContext('poll()',c);assert.equal(c.room.activePlayerId,'new');assert.ok(c.lastContact>0);assert.equal(stopped,1);assert.equal(capturesStopped,1);
  mode='expired';await vm.runInContext('poll()',c);assert.equal(c.session,null);assert.equal(c.mic,null);assert.equal(c.pendingTake,null);assert.equal(tracksStopped,1);assert.ok(removed>=2);
  const resume=source.slice(source.indexOf('function resumeConnection()'),source.indexOf("document.addEventListener('visibilitychange'"));
  let requests=0,aborts=0;const state=vm.createContext({document:{visibilityState:'hidden'},session:{},pollController:null,poll:()=>requests++});vm.runInContext(resume,state);
  vm.runInContext('resumeConnection()',state);assert.equal(requests,0);
  state.document.visibilityState='visible';vm.runInContext('resumeConnection()',state);assert.equal(requests,1);
  state.pollController={abort(){aborts++;}};vm.runInContext('resumeConnection()',state);assert.equal(aborts,1);assert.equal(requests,1);
  assert.doesNotMatch(source.slice(source.indexOf("window.addEventListener('pagehide'")),/roomApi\('leave'|sendBeacon/,'background/refresh must not be treated as explicit Leave');
});
