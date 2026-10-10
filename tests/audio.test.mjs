import {test} from 'node:test';
import assert from 'node:assert/strict';
test('mock microphone: arming, capture, disable between rounds, permission errors',async()=>{
 let stopped=0,disconnected=0,denied=false;
 const track={enabled:false,stop(){stopped++;}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 class Context{state='running';destination={};sampleRate=16000;resume(){return Promise.resolve();}createMediaStreamSource(){return{connect(){},disconnect(){disconnected++;}};}createAnalyser(){return{getFloatTimeDomainData(a){a.fill(.1);}};}decodeAudioData(){return Promise.resolve({duration:1});}}
 globalThis.window={AudioContext:Context};globalThis.OfflineAudioContext=class{createBufferSource(){return{connect(){},start(){}};}startRendering(){return Promise.resolve({getChannelData(){return new Float32Array(16000).fill(.1);}});}};
 Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{async getUserMedia(){if(denied){const e=new Error('denied');e.name='NotAllowedError';throw e;}return stream;}}},configurable:true});
 globalThis.MediaRecorder=window.MediaRecorder=class{static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['fixture'])});queueMicrotask(()=>this.onstop());}};
 const {recordAudio}=await import('../public/audio.js');
 const capture=await recordAudio({seconds:1,stream});assert.equal(track.enabled,true);capture.stop();capture.stop();assert.equal((await capture.result).length,16000);assert.equal(track.enabled,false);assert.equal(stopped,0);assert.equal(disconnected,1);
 const automatic=await recordAudio({seconds:.01,stream});await automatic.result;assert.equal(track.enabled,false);assert.equal(stopped,0);
 const owned=await recordAudio({seconds:.01});await owned.result;assert.equal(stopped,1);
 denied=true;await assert.rejects(recordAudio(),e=>e.name==='NotAllowedError');
});
