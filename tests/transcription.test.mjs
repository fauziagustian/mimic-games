import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ASR_MODELS,asrModel} from '../public/asr-config.js';

test('ASR worker allowlists models, serializes inference, disposes on switch, bounds PCM and never hints the answer (API doubles)',async()=>{
  const source=(await readFile('public/transcriber-worker.js','utf8')).replace(/^import .*\n/,'').replace(/await import\(\s*"https:[^"]+"\s*\)/,'await importRuntime()');
  const messages=[],loads=[],calls=[],disposed=[];let failLoad=false;
  const c=vm.createContext({ASR_MODELS,asrModel,Float32Array,console:{error(){}},self:{postMessage:m=>messages.push(m)},importRuntime:async()=>({env:{backends:{onnx:{wasm:{}}}},pipeline:async(type,model,options)=>{
    loads.push({type,model,options});if(failLoad){failLoad=false;throw new Error('Download failed');}
    const fn=async(audio,options)=>{calls.push({audio,options});return {text:'  hello world  '};};fn.dispose=async()=>disposed.push(model);return fn;
  }})});
  vm.runInContext(source,c);
  const send=async data=>{c.self.onmessage({data});await vm.runInContext('queue',c);return messages.at(-1);};
  assert.equal((await send({id:1,type:'load',model:'tiny'})).type,'ready');assert.equal(loads.length,1);
  const audio=new Float32Array(16000);
  const result=await send({id:2,type:'transcribe',audio,language:'english',model:'tiny',expectedText:'secret answer'});
  assert.equal(result.text,'hello world');assert.equal(loads.length,1);assert.equal(calls[0].options.language,'english');
  assert.deepEqual(Object.keys(calls[0].options).sort(),['language','max_new_tokens','return_timestamps','task','temperature']);
  await send({id:3,type:'load',model:'base'});assert.equal(loads[1].model,ASR_MODELS.base);assert.equal(disposed[0],ASR_MODELS.tiny);
  await send({id:4,type:'load',model:'https://untrusted.invalid/model'});assert.equal(loads[2].model,ASR_MODELS.tiny);
  for(const input of [[],new Float32Array(3999),new Float32Array(240001),new Float32Array(4000).fill(NaN)])assert.equal((await send({id:5,type:'transcribe',audio:input})).type,'error');
  assert.equal(calls.length,1);assert.equal((await send({id:6,type:'unexpected'})).type,'error');
  failLoad=true;assert.equal((await send({id:7,type:'load',model:'base'})).type,'error');
  assert.equal((await send({id:8,type:'load',model:'base'})).type,'ready','failed loads must be retryable');
  assert.equal(loads.at(-1).options.device,'wasm');assert.equal(loads.at(-1).options.dtype,'q8');
});

test('transcription client tracks the selected model, bounds waiting and resets on cancellation (Worker doubles)',async()=>{
  const source=(await readFile('public/transcriber.js','utf8')).replace(/^import .*\n/,'').replaceAll('export ','').replace('import.meta.url',JSON.stringify('https://mimic.test/transcriber.js'));
  const workers=[],timers=[];
  class Worker {constructor(){workers.push(this);this.sent=[];}postMessage(m){this.sent.push(m);}terminate(){this.terminated=true;}}
  const c=vm.createContext({asrModel,Worker,URL,setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}});vm.runInContext(source,c);
  const p=vm.runInContext("requestTranscription('load',null,undefined,'english','base')",c),worker=workers[0],message=worker.sent[0];assert.equal(message.model,'base');assert.equal(timers[0].ms,300000);
  worker.onmessage({data:{id:message.id,type:'ready',model:'base'}});await p;
  assert.equal(vm.runInContext("modelReadyFor('base')",c),true);assert.equal(vm.runInContext("modelReadyFor('tiny')",c),false);
  const pending=vm.runInContext("requestTranscription('transcribe',null)",c);assert.equal(timers[1].ms,120000);
  const rejected=assert.rejects(pending,/dibatalkan/);vm.runInContext('cancelTranscriber()',c);await rejected;assert.equal(worker.terminated,true);assert.equal(vm.runInContext("modelReadyFor('base')",c),false);
});

test('player uploads acoustic take after ASR failure, skips ASR for nonverbal and never submits an outdated session (API doubles)',async()=>{
  const source=await readFile('public/app.js','utf8'),fn=source.slice(source.indexOf('async function sendTake()'),source.indexOf('function tick()'));
  let asrCalls=0,uploads=[],mode='fail',finish;
  const room={round:1,profile:'precision',collectUntil:Date.now()+100000,queue:['sample'],clips:[{id:'sample',kind:'speech',language:'indonesian'}],rules:{asrModel:'base'}};
  const c=vm.createContext({room,session:{code:'ABCDEF'},pendingTake:{round:1,transcript:null,samples:new Float32Array(16000)},offset:0,isMyTurn:()=>true,tr:x=>x,toast(){},renderRoom(){},wavBytes:()=>new ArrayBuffer(1),poll:async()=>{},roomApi:async(path,options)=>uploads.push({path,options}),requestTranscription:async(...args)=>{asrCalls++;assert.equal(args[4],'base');if(mode==='wait')return new Promise(resolve=>{finish=resolve;});throw new Error('failed ASR');}});vm.runInContext(fn,c);
  await vm.runInContext('sendTake()',c);assert.equal(uploads.length,1);assert.equal(uploads[0].options.headers['X-Transcript-Source'],'unavailable');assert.equal(uploads[0].options.headers['X-Transcript'],'');assert.equal(c.pendingTake.status,'sent');
  room.clips[0].kind='sound';c.pendingTake={round:1,transcript:null,samples:new Float32Array(16000)};
  await vm.runInContext('sendTake()',c);assert.equal(asrCalls,1);assert.equal(uploads.length,2);
  room.clips[0].kind='speech';mode='wait';c.pendingTake={round:1,transcript:null,samples:new Float32Array(16000)};
  const p=vm.runInContext('sendTake()',c);c.session={code:'NEW123'};finish('heard');await p;assert.equal(uploads.length,2);
});
