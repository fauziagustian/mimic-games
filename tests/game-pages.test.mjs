import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as routing from '../public/game-routing.js';
import * as pages from '../public/game-pages.js';
import * as matchRules from '../public/match-rules.js';
import * as turns from '../public/turns.js';
import {DEFAULT_SITE} from '../public/site-config.js';
import {DEFAULT_RULES,CATEGORIES,LANGUAGES,SEED_SOUNDS} from '../public/catalog.js';
import {t,escapeHTML as esc,categoryName,uiLanguage} from '../public/platform.js';
import {runtime} from '../scripts/runtime.mjs';
const catalog={categories:CATEGORIES,languages:LANGUAGES,sounds:SEED_SOUNDS,rules:DEFAULT_RULES};
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};

test('route URLs: independent pages, guarded destinations, old invite and valid resume session',()=>{
  for(const [url,page]of [['/','home'],['/choose-character','character'],['/create-match','create'],['/matching','matching'],['/room/ABCDEF','play']])assert.equal(routing.gameRoute(url).page,page);
  assert.equal(routing.gameRoute('/room/bad').page,'unknown');
  assert.equal(routing.gameRoute('/?room=abcdef').code,'ABCDEF');
  assert.equal(routing.gameRoute('/choose-character?next=https://evil.test').next,'create');
  assert.equal(routing.gameRoute('/matching?room=%3Cscript%3E').code,'');
  assert.equal(routing.roomUrl({code:'ABCDEF',phase:'lobby'}),'/matching?room=ABCDEF');
  assert.equal(routing.roomUrl({code:'ABCDEF',phase:'listen'}),'/room/ABCDEF');
  assert.equal(routing.characterUrl('matching','ABCDEF'),'/choose-character?next=matching&room=ABCDEF');
  assert.equal(routing.parseRoomSession('{bad'),null);assert.equal(routing.parseRoomSession('{"code":"ABCDEF","token":"bad"}'),null);
  const saved={code:'ABCDEF',token:'a'.repeat(64)};assert.deepEqual(routing.parseRoomSession(JSON.stringify(saved)),saved);
});

test('page content is task-specific, localized and escaped; leaderboard is only Coming soon',async()=>{
  globalThis.localStorage=storage();
  const home=pages.homePage({site:{settings:{...DEFAULT_SITE,heroTitleId:'<img src=x>\n& hello'}},session:null,name:''});
  assert.match(home,/&lt;img/);assert.doesNotMatch(home,/<img src=x>/);assert.doesNotMatch(home,/id="category"|id="joinForm"|avatar-options|id="nickname"/);
  const character=pages.characterPage({name:'<script>bad</script>',next:'create',inRoom:false,code:''});
  assert.match(character,/id="characterStage"/);assert.match(character,/id="nickname"/);assert.match(character,/&lt;script/);assert.doesNotMatch(character,/id="category"|id="joinForm"/);
  assert.match(character,/maxlength="10"/);assert.match(character,/id="saveName"/);assert.match(character,/id="nameStatus"/);
  assert.doesNotMatch(pages.characterPage({name:'Guest',next:'lobby',inRoom:true,code:'ABCDEF'}),/readonly/);
  const create=pages.createPage({catalog,setup:{categoryId:'drama',language:'all',profile:'party'},name:'Tester',avatarId:'male-a',manual:false});
  assert.match(create,/id="category"/);assert.match(create,/id="soundLibrary"/);assert.doesNotMatch(create,/id="nickname"|id="joinForm"|characterStage|ranked|season/i);
  assert.match(create,/id="matchType"/);assert.match(create,/id="capacity"/);assert.doesNotMatch(create,/id="practice"/);
  const solo=pages.createPage({catalog,setup:{categoryId:'drama',language:'all',profile:'party',matchType:'solo',capacity:3},name:'Tester',avatarId:'male-a'});
  assert.match(solo,/<select id="capacity" disabled>/);assert.match(solo,/<option value="8" selected>/);
  const matching=pages.matchingPage({code:'ABCDEF',name:'Tester',avatarId:'male-a',paused:false});
  assert.match(matching,/id="joinForm"/);assert.match(matching,/value="ABCDEF"/);assert.doesNotMatch(matching,/id="category"|soundCards|characterStage/);
  const source=(await readFile('public/leaderboard.js','utf8')).replace(/^import .*;\n/gm,'').split('const render=')[0].replace('export function','function');
  const board=vm.runInNewContext(source+';comingSoonMarkup()',{t,esc});
  assert.match(board,/COMING SOON/);assert.doesNotMatch(board,/<select|<table|season|musim/i);
  const boardSource=await readFile('public/leaderboard.js','utf8');assert.doesNotMatch(boardSource,/api\(|\/leaderboard\?|my-attempts/);
  localStorage.setItem('mimic-ui','en');assert.match(pages.matchingPage({code:'',name:'A',avatarId:'male-a',paused:false}),/JOIN YOUR CREW/);
});

test('navigation controller: character → create → lobby → room, invitation resume, back and privacy guards (DOM doubles)',async()=>{
  globalThis.localStorage=storage();localStorage.setItem('mimic-name','Tester');
  const ss=storage(),nodes=new Map(),location=new URL('https://mimic.test/choose-character?next=create');
  const element=()=>({innerHTML:'',textContent:'',value:'',dataset:{},isConnected:true,setAttribute(){},focus(){},classList:{add(){},remove(){}}});
  for(const id of ['app','toast','networkStatus','characterForm','characterStage','nickname','saveName','continueCharacter','nameStatus','nameCount','matchType','capacity','category','language','profile','selectionInfo','soundCount','soundCards','create','practice','ready','start','copy','leave','joinForm','code','roomStage'])nodes.set('#'+id,element());
  nodes.get('#matchType').value='custom';nodes.get('#capacity').value='2';nodes.get('#nickname').value='Tester';nodes.get('#category').value='drama';nodes.get('#language').value='all';nodes.get('#profile').value='party';
  const app=nodes.get('#app'),joinButton=element(),avatarStates=[],calls=[];let rejectName=false;
  let mockRoom={code:'ABCDEF',phase:'lobby',revision:1,me:'a',host:true,categoryId:'drama',profile:'party',mode:'casual',rules:DEFAULT_RULES,players:[{id:'a',name:'Tester',total:0,ready:true,avatarId:'male-a'}],clips:[SEED_SOUNDS[0]],submitted:[],results:[],queue:[],round:0};
  const context=vm.createContext({
    ...routing,...pages,...turns,...matchRules,t,esc,categoryName,uiLanguage,URL,URLSearchParams,Date,
    localStorage,sessionStorage:ss,location,history:{pushState(a,b,url){location.href=new URL(url,location).href;},replaceState(a,b,url){location.href=new URL(url,location).href;}},
    document:{querySelector:s=>s==='#joinForm button'?joinButton:nodes.get(s)||null,querySelectorAll:()=>[]},window:{scrollTo(){}},
    avatarStage:()=>({detach(){},sync(state){avatarStates.push(state);},mount(target,state){avatarStates.push(state);}}),avatarImage:()=>'',preferredAvatar:()=> 'male-a',
    stopAudio(){},drawWave(){},setTimeout:()=>0,clearTimeout(){},
    api:async(path,options)=>{calls.push({path,options});if(path==='/rooms'||path.endsWith('/join'))return {code:'ABCDEF',token:'a'.repeat(64)};if(path.endsWith('/name')){if(rejectName)throw new Error('Save failed');mockRoom={...mockRoom,revision:mockRoom.revision+1,players:mockRoom.players.map(p=>p.id==='a'?{...p,name:options.body.name}:p)};}if(path==='/rooms/ABCDEF')return {...mockRoom,serverTime:Date.now()};return {ok:true};},
  });
  const source=(await readFile('public/app.js','utf8')).replace(/^import .*;\n/gm,'').split('mountNavigation();window.addEventListener')[0];
  vm.runInContext(source,context);context.fixtureCatalog=catalog;context.fixtureSite={settings:DEFAULT_SITE};
  vm.runInContext('catalog=fixtureCatalog;site=fixtureSite;account={user:null};picker={payload:()=>({}),render(){}};tick=()=>{};renderScreen()',context);
  assert.match(app.innerHTML,/characterStage/);assert.equal(avatarStates.at(-1).showPicker,true);
  nodes.get('#nickname').value='johnuzi';nodes.get('#nickname').oninput();
  assert.equal(nodes.get('#continueCharacter').disabled,true);assert.equal(nodes.get('#nameCount').textContent,'7/10');
  nodes.get('#characterForm').onsubmit({preventDefault(){}});assert.equal(location.pathname,'/choose-character');
  await nodes.get('#saveName').onclick();assert.equal(localStorage.getItem('mimic-name'),'johnuzi');assert.equal(avatarStates.at(-1).players[0].name,'johnuzi');
  assert.equal(nodes.get('#continueCharacter').disabled,false);
  nodes.get('#characterForm').onsubmit({preventDefault(){}});assert.equal(location.pathname,'/create-match');assert.match(app.innerHTML,/match-settings/);
  await vm.runInContext('create(false)',context);assert.equal(location.pathname,'/matching');assert.equal(location.search,'?room=ABCDEF');assert.match(app.innerHTML,/lobby-layout/);assert.doesNotMatch(app.innerHTML,/characterStage|id="category"/);
  assert.equal(calls.find(c=>c.path==='/rooms').options.body.mode,'casual');
  assert.equal(calls.find(c=>c.path==='/rooms').options.body.capacity,2);
  vm.runInContext("navigate('/choose-character?next=lobby&room=ABCDEF')",context);
  nodes.get('#nickname').value='NewName';nodes.get('#nickname').oninput();await nodes.get('#saveName').onclick();
  assert.equal(calls.find(c=>c.path.endsWith('/name')).options.body.name,'NewName');assert.equal(avatarStates.at(-1).players[0].name,'NewName');
  assert.equal(localStorage.getItem('mimic-name'),'NewName');
  rejectName=true;nodes.get('#nickname').value='Failed';nodes.get('#nickname').oninput();await nodes.get('#saveName').onclick();
  assert.equal(localStorage.getItem('mimic-name'),'NewName');assert.equal(avatarStates.at(-1).players[0].name,'NewName');assert.equal(nodes.get('#continueCharacter').disabled,true);
  rejectName=false;nodes.get('#nickname').value='NewName';nodes.get('#nickname').oninput();nodes.get('#characterForm').onsubmit({preventDefault(){}});
  // Starting redirects within the same document, preserving the already-armed stream.
  context.armed={getTracks:()=>[],getAudioTracks:()=>[]};
  vm.runInContext('mic=armed',context);
  mockRoom={...mockRoom,phase:'listen',revision:mockRoom.revision+1,queue:[mockRoom.clips[0].id],round:1};
  await vm.runInContext('poll()',context);assert.equal(location.pathname,'/room/ABCDEF');assert.equal(vm.runInContext('mic===armed',context),true);assert.equal(avatarStates.at(-1).showPicker,false);
  assert.doesNotMatch(app.innerHTML,/id="code"|id="category"|Musim|Season/);
  vm.runInContext("navigate('/')",context);assert.equal(location.pathname,'/');assert.match(app.innerHTML,/Resume game|Lanjutkan permainan/);
  vm.runInContext("navigate('/create-match')",context);assert.match(app.innerHTML,/ACTIVE ROOM/); // No accidental second membership.
  vm.runInContext("navigate('/matching?room=ABCDEF')",context);assert.equal(location.pathname,'/room/ABCDEF');
  // Leaving while audio preparation is pending must not open a microphone prompt on another page.
  let releaseAudio,micRequests=0;const audioReady=new Promise(resolve=>releaseAudio=resolve);
  context.unlockAudio=()=>audioReady;context.navigator={mediaDevices:{getUserMedia(){micRequests++;throw new Error('unexpected microphone prompt');}}};
  vm.runInContext("clips.set(room.clips[0].id,new Float32Array(16000));mic=null",context);
  const ready=vm.runInContext('ready()',context);vm.runInContext("navigate('/')",context);releaseAudio();await ready;assert.equal(micRequests,0);
  await vm.runInContext('leave()',context);assert.equal(ss.getItem('mimic-room'),null);assert.equal(location.pathname,'/');
  // A friend with no saved identity keeps the invite through the character page.
  localStorage.removeItem('mimic-name');nodes.get('#code').value='ABCDEF';
  vm.runInContext("navigate('/matching?room=ABCDEF')",context);await vm.runInContext('join()',context);
  assert.equal(location.pathname,'/choose-character');assert.equal(routing.gameRoute(location.href).code,'ABCDEF');
  nodes.get('#nickname').value='Guest';nodes.get('#nickname').oninput();assert.equal(nodes.get('#continueCharacter').disabled,true);await nodes.get('#saveName').onclick();assert.equal(localStorage.getItem('mimic-name'),'Guest');nodes.get('#characterForm').onsubmit({preventDefault(){}});assert.equal(location.pathname,'/matching');assert.equal(location.search,'?room=ABCDEF');
  // Deep-linking the arena is never room authentication; it returns to code join.
  vm.runInContext("navigate('/room/ABCDEF')",context);assert.equal(location.pathname,'/matching');
});

test('Worker serves dedicated deep links and Coming soon; unrelated paths stay 404',async()=>{
  const mf=await runtime();
  try{
    for(const path of ['/','/choose-character','/create-match','/matching?room=ABCDEF','/room/ABCDEF']){
      const r=await mf.dispatchFetch('https://mimic.test'+path);assert.equal(r.status,200,path);assert.match(await r.text(),/src="\/app.js"/);
    }
    const r=await mf.dispatchFetch('https://mimic.test/leaderboard?version=1');assert.equal(r.status,200);const html=await r.text();assert.match(html,/COMING SOON/);assert.doesNotMatch(html,/<select|<table|PRECISION RANKED/);
    for(const path of ['/room/bad','/room/ABCDEF/anything','/missing'])assert.equal((await mf.dispatchFetch('https://mimic.test'+path)).status,404);
    assert.equal((await mf.dispatchFetch('https://mimic.test/create-match',{method:'POST'})).status,405);
  }finally{await mf.dispose();}
});
