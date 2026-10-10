import {DEFAULT_RULES,LANGUAGES} from '../public/catalog.js';
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export const fail=(status,message)=>{throw new HttpError(status,message);};
export function text(value,max,required=true){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(400,'Invalid text / Teks tidak valid.');return value.trim();}
export function integer(value,min,max){if(!Number.isInteger(value)||value<min||value>max)fail(400,`Value must be ${min}–${max}.`);return value;}
export function id(value){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value))fail(400,'Invalid ID.');return value;}
export function validateRules(input){
  const r={...DEFAULT_RULES,...input};
  integer(r.rounds,1,10);integer(r.maxPlayers,2,8);integer(r.turnSeconds,30,180);integer(r.recordSeconds,3,15);
  integer(r.applauseThreshold,1,99);integer(r.perfectThreshold,90,100);integer(r.minRankedSounds,1,10);
  if(typeof r.rankedEnabled!=='boolean')fail(400,'Invalid ranked setting.');
  if(!r.weights||Object.keys(r.weights).sort().join(',')!=='pitch,rhythm,timbre,words')fail(400,'Four scoring weights are required.');
  if(Object.values(r.weights).reduce((s,n)=>s+integer(n,0,100),0)!==100)fail(400,'Bobot penilaian harus berjumlah 100%.');
  for(const key of ['roastId','roastEn','applauseId','applauseEn','perfectId','perfectEn'])r[key]=text(r[key],200);
  for(const key of ['roast','applause','perfect']) {const v=r.reactionAudio?.[key];if(typeof v!=='string'||(v&&!/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(v)))fail(400,'Invalid reaction audio.');}
  return Object.fromEntries(Object.keys(DEFAULT_RULES).map(k=>[k,r[k]]));
}
export function validateLanguage(value){if(!LANGUAGES.some(l=>l.id===value))fail(400,'Language not supported.');return value;}
export function pcmFromWav(buffer){
  if(buffer.byteLength<44||buffer.byteLength>480100)fail(400,'Audio must be 0.25–15 seconds, mono PCM WAV 16 kHz.');
  const v=new DataView(buffer),s=(o,n)=>String.fromCharCode(...new Uint8Array(buffer,o,n));
  if(s(0,4)!=='RIFF'||s(8,4)!=='WAVE')fail(400,'A WAV recording is required.');
  let fmt=false,samples;
  for(let off=12;off+8<=buffer.byteLength;){
    const key=s(off,4),length=v.getUint32(off+4,true),start=off+8;
    if(start+length>buffer.byteLength)fail(400,'Corrupt WAV.');
    if(key==='fmt '){if(length<16||v.getUint16(start,true)!==1||v.getUint16(start+2,true)!==1||v.getUint32(start+4,true)!==16000||v.getUint16(start+14,true)!==16)fail(400,'Required: mono PCM16 / 16000 Hz.');fmt=true;}
    if(key==='data'){if(length%2)fail(400,'Invalid PCM data.');samples=new Float32Array(length/2);for(let i=0;i<samples.length;i++)samples[i]=v.getInt16(start+i*2,true)/32768;}
    off=start+length+(length%2);
  }
  if(!fmt||!samples||samples.length<4000||samples.length>240000)fail(400,'Audio must be 0.25–15 seconds.');
  return samples;
}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function limitedBody(request,max){
  if(Number(request.headers.get('content-length'))>max)fail(413,'Upload too large.');
  const reader=request.body?.getReader();if(!reader)fail(400,'Request body is required.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'Upload too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes.buffer;
}
