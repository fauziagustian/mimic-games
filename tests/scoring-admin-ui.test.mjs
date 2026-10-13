import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {escapeHTML} from '../public/platform.js';

const source=(await readFile('public/admin-scoring.js','utf8')).replace(/^import .*\n/gm,'').replaceAll('export ','');
test('admin scoring lab tags ASR vs manual evidence, sends only explicit tests and cleans up audio/worker (DOM/API doubles)',async()=>{
  const el=()=>({value:'',innerHTML:'',textContent:'',files:[],pause(){this.paused=true;}});
  const elements=Object.fromEntries(['sound','profile','audio','model','transcript'].map(k=>[k,el()]));
  Object.assign(elements.sound,{value:'ref'});elements.profile.value='precision';elements.model.value='base';elements.audio.files=[{size:10,arrayBuffer:async()=>new ArrayBuffer(10)}];
  const fieldset=el(),nodes=Object.fromEntries(['#labStatus','#labResult','#labPreview','#labSource','#labReference','#labTranscribe'].map(k=>[k,el()]));
  const form={elements,querySelector:()=>fieldset},root={innerHTML:'',isConnected:true,querySelector:s=>s==='form'?form:nodes[s]};
  let cancels=0,uploads=[],asrArgs=[];
  const c=vm.createContext({t:x=>x,esc:escapeHTML,root,catalog:{sounds:[{id:'ref',kind:'speech',title:'<script>',text:'reference',language:'english',url:'/audio/ref.wav'}],rules:{asrModel:'tiny'}},URLSearchParams,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},decodeAudio:async()=>new Float32Array(16000),wavBytes:()=>new ArrayBuffer(1),requestTranscription:async(...args)=>{asrArgs=args;return 'heard words';},cancelTranscriber:()=>cancels++,scoreReportMarkup:()=>'<p>score report</p>',api:async(path,options)=>{uploads.push({path,options});return {score:{total:80}};}});
  vm.runInContext(source+';const dispose=mountScoringLab(root,catalog);',c);
  assert.match(root.innerHTML,/&lt;script&gt;/);assert.equal(uploads.length,0);
  await nodes['#labTranscribe'].onclick();assert.equal(asrArgs[3],'english');assert.equal(asrArgs[4],'base');assert.equal(elements.transcript.value,'heard words');assert.match(nodes['#labSource'].textContent,/ASR otomatis/);
  form.onsubmit({preventDefault(){}});await new Promise(setImmediate);assert.equal(uploads[0].options.headers['X-Transcript-Source'],'browser-asr');assert.match(nodes['#labResult'].innerHTML,/80\/100/);
  elements.transcript.value='manual correction';elements.transcript.oninput();assert.equal(nodes['#labResult'].innerHTML,'');
  form.onsubmit({preventDefault(){}});await new Promise(setImmediate);assert.equal(uploads[1].options.headers['X-Transcript-Source'],'manual');
  vm.runInContext('dispose()',c);assert.equal(cancels,1);assert.equal(nodes['#labPreview'].paused,true);
});

test('reference draft assistant does not overwrite a changed transcript or detached form (DOM/API doubles)',async()=>{
  const nodes={button:{},'[role="status"]':{},select:{value:'tiny'}},box={querySelector:k=>nodes[k]};
  const field={value:'initial',after(){}},file={files:[{}]},form={isConnected:true,querySelector:k=>k==='#text'?field:file};
  let resolve,changed=0;
  const c=vm.createContext({t:x=>x,esc:escapeHTML,document:{createElement:()=>box},form,requestTranscription:()=>new Promise(r=>resolve=r),cancelTranscriber(){},getAudio:async()=>new Float32Array(16000),onChange:()=>changed++});
  vm.runInContext(source+";const dispose=mountTranscriptAssist(form,{getAudio,getLanguage:()=> 'indonesian',onChange});",c);
  const p=nodes.button.onclick();await new Promise(setImmediate);field.value='edited while loading';resolve('new draft');await p;assert.equal(field.value,'edited while loading');assert.equal(changed,0);assert.match(nodes['[role="status"]'].textContent,/Form berubah/);
  const next=nodes.button.onclick();await new Promise(setImmediate);vm.runInContext('dispose()',c);resolve('late draft');await next;assert.equal(field.value,'edited while loading');assert.equal(changed,0);
});
