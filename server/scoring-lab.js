import {fail,id,text,limitedBody,pcmFromWav} from './validation.js';
import {analyzeAudio} from '../public/scoring.js';
import {scoreSound,audioQuality,SCORING_VERSION} from '../public/scoring-detail.js';

export async function scoringLab(req,db,user,getCatalog){
  const u=new URL(req.url);if(u.pathname!=='/api/admin/scoring-lab'||req.method!=='POST')return null;
  if(!['owner','admin'].includes(user?.role))fail(403,'Khusus admin / Admin only.');
  const key=`score-lab:${user.id}:${Math.floor(Date.now()/3600000)}`;
  await db.run("INSERT INTO config(id,value) VALUES(?,'1') ON CONFLICT(id) DO UPDATE SET value=CAST(value AS INTEGER)+1",key);
  if(Number((await db.one('SELECT value FROM config WHERE id=?',key)).value)>60)fail(429,'Maksimal 60 uji/jam / Maximum 60 tests/hour.');
  const sound=await db.one('SELECT * FROM sounds WHERE id=?',id(u.searchParams.get('sound')));if(!sound)fail(404,'Sound tidak ditemukan / Sound not found.');
  const reference=JSON.parse(sound.data),profile=u.searchParams.get('profile')||'precision';
  if(!['party','precision'].includes(profile))fail(400,'Invalid scoring profile.');
  if(!audioQuality(reference.profile).usable)fail(422,'Referensi hening/tidak layak; ganti audio referensi / Replace the silent or invalid reference.');
  let transcript;try{transcript=text(decodeURIComponent(req.headers.get('X-Transcript')||''),300,false);}catch{fail(400,'Invalid transcript.');}
  const source=req.headers.get('X-Transcript-Source')||'manual';if(!['manual','browser-asr','unavailable'].includes(source))fail(400,'Invalid transcript source.');
  const samples=pcmFromWav(await limitedBody(req,480100));
  const {rules}=await getCatalog(db),snapshot={...rules,profile,scoringVersion:SCORING_VERSION};
  const score=scoreSound(reference.profile,analyzeAudio(samples),reference.text,source==='unavailable'?'':transcript,snapshot,reference.kind||'speech',source);
  return Response.json({score,reference:{id:sound.id,title:reference.title,text:reference.text,kind:reference.kind||'speech',revision:sound.revision,duration:reference.duration},storage:'not-stored'},{headers:{'Cache-Control':'no-store'}});
}
