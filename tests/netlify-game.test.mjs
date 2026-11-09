import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNetlifyGameHandler} from '../server/netlify-handler.js';

class MemoryStrongStore{
  values=new Map();serial=0;newWrites=0;conditionalWrites=0;
  async getWithMetadata(key,{consistency,type}={}){
    assert.equal(consistency,'strong','all live reads must request strong consistency');
    assert.equal(type,'arrayBuffer');const value=this.values.get(key);
    return value?{data:value.data.slice(0),etag:value.etag}:{data:null,etag:undefined};
  }
  async set(key,value,{onlyIfNew,onlyIfMatch}={}){
    const previous=this.values.get(key);
    if(onlyIfNew){this.newWrites++;if(previous)return {modified:false};}
    if(onlyIfMatch){this.conditionalWrites++;if(!previous||previous.etag!==onlyIfMatch)return {modified:false};}
    const bytes=value instanceof ArrayBuffer?value.slice(0):value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);
    const etag=`"m${++this.serial}"`;this.values.set(key,{data:bytes,etag});return {modified:true,etag};
  }
  async delete(key){this.values.delete(key);}
}

test('Netlify Function completes a three-round two-player game and ranks the winner',async()=>{
  const [platform,functionSource,netlifyConfig]=await Promise.all([
    readFile('public/platform.js','utf8'),readFile('netlify/functions/game.ts','utf8'),readFile('netlify.toml','utf8'),
  ]);
  assert.match(platform,/fetch\(functionUrl\('\/api'\+path\)/);
  assert.match(platform,/\.netlify\/functions\/game/);
  assert.doesNotMatch(platform,/fetch\(['"]\/api\//);
  assert.match(functionSource,/server\/netlify-handler\.js/);
  assert.doesNotMatch(functionSource,/config\.path/);
  assert.doesNotMatch(netlifyConfig,/from\s*=\s*["']\/api\/game/);
  const stores=new Map(),getStore=({name,consistency})=>{
    assert.equal(consistency,'strong');if(!stores.has(name))stores.set(name,new MemoryStrongStore());return stores.get(name);
  };
  const handle=createNetlifyGameHandler({getStore}),originalNow=Date.now;let now=1_800_000_000_000;Date.now=()=>now;
  const origin='https://mimic.test';
  async function call(path,{method='GET',body,headers={}}={}){
    const url=new URL('/.netlify/functions/game',origin);url.searchParams.set('route',path);
    const h=new Headers(headers);if(method==='POST')h.set('Origin',origin);
    if(body&&typeof body==='object'&&!ArrayBuffer.isView(body)&&!(body instanceof ArrayBuffer)){h.set('Content-Type','application/json');body=JSON.stringify(body);}
    const response=await handle(new Request(url,{method,headers:h,body:['GET','HEAD'].includes(method)?undefined:body}));
    const isAudio=response.headers.get('content-type')?.startsWith('audio/');
    return {response,data:isAudio?await response.arrayBuffer():await response.json()};
  }
  const requireOk=async(path,options)=>{const result=await call(path,options);assert.ok(result.response.ok,`${options?.method||'GET'} ${path}: ${JSON.stringify(result.data)}`);return result.data;};
  const roomView=async(code,token)=>requireOk(`/api/rooms/${code}`,{headers:{'X-Room-Token':token}});
  async function advanceTo(target,code,tokens){
    while(now+5000<target){now+=5000;for(const token of Object.values(tokens))await roomView(code,token);}
    now=target;return roomView(code,Object.values(tokens)[0]);
  }
  try{
    const owner=await requireOk('/api/auth/setup',{method:'POST',body:{email:'owner@mimic.test',password:'a-strong-owner-passphrase'}});
    assert.equal(owner.user.role,'owner');
    const login=await call('/api/auth/login',{method:'POST',body:{email:'owner@mimic.test',password:'a-strong-owner-passphrase'}});
    assert.equal(login.response.status,200,JSON.stringify(login.data));const sessionCookie=login.response.headers.get('set-cookie').split(';')[0];
    const me=await requireOk('/api/me',{headers:{cookie:sessionCookie}});assert.equal(me.adminConfigured,true);assert.equal(me.user.role,'owner');

    const catalog=await requireOk('/api/catalog');
    const samples=catalog.sounds.filter(sound=>sound.importPack==='user-samples-v2');
    assert.equal(samples.length,17);
    for(const [categoryId,count] of [['bleach',4],['meme-global',9],['meme-indonesia',4]]){
      assert.equal(samples.filter(sound=>sound.categoryId===categoryId).length,count);
      const sampleRoom=await requireOk('/api/rooms',{method:'POST',body:{name:'SampleQA',categoryId,language:'all',mode:'casual',profile:'party',capacity:2}});
      const sampleState=await roomView(sampleRoom.code,sampleRoom.token);
      assert.equal(sampleState.clips.length,count);
    }
    const bundledAudio=await requireOk('/api/library-sounds/bleach-ichigo-bankai/audio');
    assert.ok(bundledAudio.byteLength>44);
    const unavailable=await call('/api/rooms',{method:'POST',body:{name:'WordsQA',categoryId:'bleach',language:'japanese',mode:'casual',profile:'precision',capacity:2}});
    assert.equal(unavailable.response.status,400,'unreviewed Japanese transcript cannot enter Precision');

    const created=await requireOk('/api/rooms',{method:'POST',body:{name:'EchoOne',categoryId:'drama',language:'indonesian',mode:'casual',profile:'party',capacity:2}});
    const joined=await requireOk(`/api/rooms/${created.code}/join`,{method:'POST',body:{name:'EchoTwo'}});
    const tokens={EchoOne:created.token,EchoTwo:joined.token};
    await requireOk(`/api/rooms/${created.code}/ready`,{method:'POST',headers:{'X-Room-Token':tokens.EchoOne}});
    await requireOk(`/api/rooms/${created.code}/ready`,{method:'POST',headers:{'X-Room-Token':tokens.EchoTwo}});
    await requireOk(`/api/rooms/${created.code}/start`,{method:'POST',headers:{'X-Room-Token':tokens.EchoOne}});

    const exactTake=await readFile('public/audio/lah-kok-gitu.wav');
    const weakTake=await readFile('public/audio/roast-0.wav');
    const roundScores=[];
    let state=await roomView(created.code,tokens.EchoOne);
    assert.equal(state.rules.rounds,3);
    assert.equal(state.players.length,2);
    for(let round=1;round<=3;round++){
      if(state.phase==='results'){
        state=await advanceTo(state.nextAt+1,created.code,tokens);
      }
      assert.equal(state.round,round);
      for(let turn=0;turn<2;turn++){
        if(state.phase==='results'){
          state=await advanceTo(state.nextAt+1,created.code,tokens);
        }
        now=Math.max(now,state.recordAt+1);state=await roomView(created.code,tokens.EchoOne);
        assert.equal(state.phase,'record',`r${round} turn${turn} at ${now}: ${state.phase}, active=${state.activePlayerId}, recordAt=${state.recordAt}, round=${state.round}`);
        const active=state.players.find(player=>player.id===state.activePlayerId);
        assert.ok(active,`active player exists in round ${round}`);
        const token=tokens[active.name],bytes=active.name==='EchoOne'?exactTake:weakTake;
        const take=await call(`/api/rooms/${created.code}/take?round=${round}`,{method:'POST',headers:{'X-Room-Token':token,'Content-Type':'audio/wav','X-Transcript-Source':'unavailable'},body:bytes});
        assert.equal(take.response.status,200,JSON.stringify(take.data));
        state=await advanceTo(state.endAt+1,created.code,tokens);
        assert.equal(state.phase,'reveal');
        const result=state.results.find(item=>item.playerId===active.id);assert.ok(result);
        roundScores.push({round,name:active.name,score:result.total});
        state=await advanceTo(state.revealEnd+1,created.code,tokens);
      }
    }
    assert.equal(state.phase,'finished');
    assert.equal(state.round,3);
    assert.equal(roundScores.length,6);
    const standings=[...state.players].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
    assert.ok(standings[0].total>standings[1].total,`expected a unique winner: ${JSON.stringify(standings)}`);
    assert.equal(standings[0].name,'EchoOne');
    assert.ok(roundScores.filter(item=>item.name==='EchoOne').every(item=>item.score===100));

    // Imported content must also progress through a real shared turn and score path.
    const sampleMatch=await requireOk('/api/rooms',{method:'POST',body:{name:'MemeOne',categoryId:'meme-indonesia',language:'indonesian',mode:'casual',profile:'party',capacity:2}});
    const sampleGuest=await requireOk(`/api/rooms/${sampleMatch.code}/join`,{method:'POST',body:{name:'MemeTwo'}});
    const sampleTokens={MemeOne:sampleMatch.token,MemeTwo:sampleGuest.token};
    for(const token of Object.values(sampleTokens))await requireOk(`/api/rooms/${sampleMatch.code}/ready`,{method:'POST',headers:{'X-Room-Token':token}});
    await requireOk(`/api/rooms/${sampleMatch.code}/start`,{method:'POST',headers:{'X-Room-Token':sampleTokens.MemeOne}});
    let sampleState=await roomView(sampleMatch.code,sampleTokens.MemeOne);
    assert.ok(sampleState.clips.every(clip=>clip.categoryId==='meme-indonesia'));
    for(let turn=0;turn<2;turn++){
      now=sampleState.recordAt+1;sampleState=await roomView(sampleMatch.code,sampleTokens.MemeOne);
      const active=sampleState.players.find(player=>player.id===sampleState.activePlayerId);
      const take=await call(`/api/rooms/${sampleMatch.code}/take?round=1`,{method:'POST',headers:{'X-Room-Token':sampleTokens[active.name],'Content-Type':'audio/wav','X-Transcript-Source':'unavailable'},body:turn===0?exactTake:weakTake});
      assert.equal(take.response.status,200,JSON.stringify(take.data));
      sampleState=await advanceTo(sampleState.endAt+1,sampleMatch.code,sampleTokens);
      assert.equal(sampleState.phase,'reveal');
      const result=sampleState.results.find(item=>item.playerId===active.id);
      assert.ok(Number.isInteger(result?.total)&&result.total>=0&&result.total<=100);
      sampleState=await advanceTo(sampleState.revealEnd+1,sampleMatch.code,sampleTokens);
    }
    assert.equal(sampleState.phase,'results');
    assert.equal(sampleState.results.length,2);
    const dbStore=stores.get('mimic-game-database');assert.ok(dbStore.conditionalWrites>0,'database mutations use ETag conditional writes');
    assert.ok(dbStore.newWrites>0,'first database write uses onlyIfNew');
  }finally{Date.now=originalNow;}
});
