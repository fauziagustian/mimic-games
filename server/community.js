import {HttpError,fail,text,id,integer,validateLanguage,limitedBody,pcmFromWav,digest} from './validation.js';
import {analyzeAudio} from '../public/scoring.js';
import {SOUND_KINDS,audioQuality} from '../public/scoring-detail.js';
import {categoryScope} from '../public/categories.js';
import {categoryList,enabledCategory,enabledCategorySQL} from './categories.js';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const LIMIT=24, DAY=86400000;
const requireUser=user=>{if(!user)fail(401,'Masuk untuk mengirim sound / Sign in to submit a sound.');};
const requireAdmin=user=>{requireUser(user);if(!user.admin)fail(403,'Khusus admin / Admin only.');};
async function body(req,max=12000){
  try{const value=JSON.parse(new TextDecoder().decode(await limitedBody(req,max)));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Invalid JSON object.');return value;}
  catch(e){if(e instanceof HttpError)throw e;fail(400,'Invalid JSON.');}
}
function view(row){
  const d=JSON.parse(row.data);
  return {id:row.id,title:d.title,text:d.text,kind:d.kind||'speech',quality:audioQuality(d.profile),creatorName:d.creatorName,source:d.source,rights:d.rights,
    categoryId:row.category_id,language:row.language,duration:d.duration,status:row.status,
    createdAt:row.created_at,reviewedAt:row.reviewed_at,note:row.review_note,soundId:row.sound_id,
    active:!!row.sound_active,ranked:!!(row.sound_data&&JSON.parse(row.sound_data).ranked),
    url:`/api/community/submissions/${row.id}/audio`};
}
const joined='SELECT u.*,s.active AS sound_active,s.data AS sound_data FROM community_submissions u LEFT JOIN sounds s ON s.id=u.sound_id';
const pageOf=u=>integer(Number(u.searchParams.get('page')||0),0,10000);
const paginated=(rows,page,mapper=view)=>({items:rows.slice(0,LIMIT).map(mapper),nextPage:rows.length>LIMIT?page+1:null});
function audit(db,user,action,rowId,token){
  return db.statement('INSERT INTO audit(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM community_submissions WHERE id=? AND action_token=?)',crypto.randomUUID(),user.id,action,rowId,Date.now(),rowId,token);
}

export async function communityRoutes(req,env,db,user){
  const u=new URL(req.url),p=u.pathname,method=req.method;
  if(p.startsWith('/api/admin/community'))requireAdmin(user);

  if(p==='/api/community'&&method==='GET'){
    const page=pageOf(u),conditions=["u.status='approved'",'s.active=1',enabledCategorySQL('c'),'l.active=1'],values=[];
    const category=u.searchParams.get('category');
    if(category&&category!=='all'){const scope=categoryScope(await categoryList(db),id(category));conditions.push(scope.length?`s.category_id IN (${scope.map(()=>'?').join(',')})`:'0');values.push(...scope);}
    for(const [key,column] of [['language','s.language']]){
      const value=u.searchParams.get(key);if(value&&value!=='all'){conditions.push(`${column}=?`);values.push(id(value));}
    }
    const rows=await db.all(`SELECT u.id,u.created_at,s.id AS sound_id,s.category_id,s.language,s.data FROM community_submissions u JOIN sounds s ON s.id=u.sound_id JOIN categories c ON c.id=s.category_id JOIN languages l ON l.id=s.language WHERE ${conditions.join(' AND ')} ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`,...values,LIMIT+1,page*LIMIT);
    return json(paginated(rows,page,r=>{const d=JSON.parse(r.data);return {id:r.id,soundId:r.sound_id,title:d.title,text:d.text,creatorName:d.creatorName,source:d.source,rights:d.rights,categoryId:r.category_id,language:r.language,duration:d.duration,ranked:!!d.ranked,url:d.url,createdAt:r.created_at};}));
  }
  if(p==='/api/community/mine'&&method==='GET'){
    requireUser(user);const page=pageOf(u),now=Date.now();
    const [rows,recent,pending]=await Promise.all([
      db.all(`${joined} WHERE u.owner_id=? ORDER BY u.created_at DESC,u.id DESC LIMIT ? OFFSET ?`,user.id,LIMIT+1,page*LIMIT),
      db.one('SELECT count(*) AS n FROM community_submissions WHERE owner_id=? AND created_at>?',user.id,now-DAY),
      db.one("SELECT count(*) AS n FROM community_submissions WHERE owner_id=? AND status='pending'",user.id)]);
    return json({...paginated(rows,page),remaining:Math.max(0,Math.min(5-recent.n,10-pending.n)),dailyLimit:5});
  }
  if(p==='/api/community/submissions'&&method==='POST'){
    requireUser(user);const b=await body(req,660000),requestId=id(b.requestId);
    const existing=await db.one(`${joined} WHERE u.owner_id=? AND u.request_id=?`,user.id,requestId);
    if(existing)return json({item:view(existing),duplicate:true});
    const quota=await db.one("SELECT sum(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS recent,sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM community_submissions WHERE owner_id=?",Date.now()-DAY,user.id);
    if(quota.recent>=5||quota.pending>=10)fail(429,'Batas 5 kiriman/24 jam dan 10 menunggu / Limit: 5 submissions per 24h, 10 pending.');
    if(b.consent!==true)fail(400,'Persetujuan izin dan publikasi diperlukan / Publication permission is required.');
    const kind=b.kind??'speech';if(!SOUND_KINDS.includes(kind))fail(400,'Invalid sound type.');
    const data={title:text(b.title,80),text:text(b.text??'',300,kind==='speech'),kind,creatorName:text(b.creatorName,40),source:text(b.source,120),rights:text(b.rights,400),consentVersion:1};
    const categoryId=id(b.categoryId),language=validateLanguage(b.language);
    if(!await enabledCategory(db,categoryId)||!await db.one('SELECT id FROM languages WHERE id=? AND active=1',language))fail(400,'Kategori/bahasa tidak aktif / Category or language is inactive.');
    if(typeof b.audio!=='string'||b.audio.length>640136||!b.audio.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.audio)||b.audio.length%4)fail(400,'Audio tidak valid / Invalid audio.');
    let bytes;try{bytes=Uint8Array.from(atob(b.audio),c=>c.charCodeAt(0));}catch{fail(400,'Invalid audio encoding.');}
    const samples=pcmFromWav(bytes.buffer);
    let energy=0;for(const v of samples)energy+=v*v;if(Math.sqrt(energy/samples.length)<0.002)fail(422,'Sound terlalu hening / The sound is too quiet.');
    Object.assign(data,{profile:analyzeAudio(samples),audioHash:await digest(samples.buffer),duration:samples.length/16000});
    if(!audioQuality(data.profile).usable)fail(422,'Audio tidak layak dinilai / Audio cannot be scored.');
    const submissionId=crypto.randomUUID(),audioKey=`community/${submissionId}.wav`,now=Date.now();
    // The INSERT atomically enforces quota; each contender owns a distinct R2 key.
    await env.BUCKET.put(audioKey,bytes,{httpMetadata:{contentType:'audio/wav'}});
    let inserted;
    try{
      inserted=await db.run(`INSERT INTO community_submissions(id,owner_id,request_id,category_id,language,data,audio_key,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM community_submissions WHERE owner_id=? AND created_at>?)<5 AND (SELECT count(*) FROM community_submissions WHERE owner_id=? AND status='pending')<10 AND EXISTS(SELECT 1 FROM categories c WHERE c.id=? AND ${enabledCategorySQL('c')}) AND EXISTS(SELECT 1 FROM languages WHERE id=? AND active=1) ON CONFLICT(owner_id,request_id) DO NOTHING`,submissionId,user.id,requestId,categoryId,language,JSON.stringify(data),audioKey,now,user.id,now-DAY,user.id,categoryId,language);
    }catch(e){
      // A transport error may follow a committed write. Never delete a referenced object.
      const committed=await db.one('SELECT id FROM community_submissions WHERE id=?',submissionId);
      if(!committed)await env.BUCKET.delete(audioKey);throw e;
    }
    if(!inserted.meta.changes){
      await env.BUCKET.delete(audioKey);
      const raced=await db.one(`${joined} WHERE u.owner_id=? AND u.request_id=?`,user.id,requestId);
      if(raced)return json({item:view(raced),duplicate:true});
      fail(429,'Batas 5 kiriman/24 jam dan 10 menunggu, atau pilihan dinonaktifkan. / Limit: 5 submissions/24h, 10 pending; selection may have been disabled.');
    }
    return json({item:view(await db.one(`${joined} WHERE u.id=?`,submissionId))},201);
  }
  const audio=p.match(/^\/api\/community\/submissions\/([\w-]+)\/audio$/);
  if(audio&&method==='GET'){
    const row=await db.one(`${joined} WHERE u.id=?`,id(audio[1]));
    if(!row)fail(404,'Audio not found.');
    // Pending, rejected and withdrawn audio never becomes public, including by guessed URL.
    const published=row.status==='approved'&&row.sound_active&&await db.one(`SELECT s.id FROM sounds s JOIN categories c ON c.id=s.category_id JOIN languages l ON l.id=s.language WHERE s.id=? AND s.active=1 AND ${enabledCategorySQL('c')} AND l.active=1`,row.sound_id);
    if(!published&&user?.id!==row.owner_id&&!user?.admin)fail(404,'Audio not found.');
    const obj=await env.BUCKET.get(row.audio_key);if(!obj)fail(404,'Audio unavailable.');
    return new Response(obj.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  const withdraw=p.match(/^\/api\/community\/submissions\/([\w-]+)\/withdraw$/);
  if(withdraw&&method==='POST'){
    requireUser(user);const rowId=id(withdraw[1]),row=await db.one('SELECT id,status FROM community_submissions WHERE id=? AND owner_id=?',rowId,user.id);
    if(!row)fail(404,'Submission not found.');if(row.status==='withdrawn')return json({ok:true});
    const token=crypto.randomUUID();
    await db.batch([
      db.statement("UPDATE sounds SET active=0,revision=revision+1 WHERE id=(SELECT sound_id FROM community_submissions WHERE id=? AND owner_id=?)",rowId,user.id),
      db.statement("UPDATE community_submissions SET status='withdrawn',action_token=? WHERE id=? AND owner_id=? AND status<>'withdrawn'",token,rowId,user.id),
      audit(db,user,'community.withdrawn',rowId,token)]);
    return json({ok:true});
  }
  if(p==='/api/admin/community'&&method==='GET'){
    const status=u.searchParams.get('status')||'pending',page=pageOf(u);
    if(!['pending','approved','rejected','withdrawn'].includes(status))fail(400,'Invalid status.');
    return json(paginated(await db.all(`${joined} WHERE u.status=? ORDER BY u.created_at ASC,u.id ASC LIMIT ? OFFSET ?`,status,LIMIT+1,page*LIMIT),page));
  }
  const review=p.match(/^\/api\/admin\/community\/([\w-]+)\/review$/);
  if(review&&method==='POST'){
    const row=await db.one('SELECT * FROM community_submissions WHERE id=?',id(review[1]));
    if(!row)fail(404,'Submission not found.');if(row.status!=='pending')fail(409,'Sudah diproses / Already processed.');
    const b=await body(req);if(!['approved','rejected'].includes(b.status))fail(400,'Invalid decision.');
    const note=text(b.note??'',400,b.status==='rejected'),token=crypto.randomUUID(),statements=[];
    let soundId=null;
    if(b.status==='approved'){
      if(b.checked!==true)fail(400,'Periksa audio, transkrip, izin, dan keamanan konten / Review audio, transcript, permission and content safety.');
      if(!await enabledCategory(db,row.category_id)||!await db.one('SELECT id FROM languages WHERE id=? AND active=1',row.language))fail(409,'Aktifkan kategori/bahasa sebelum menyetujui / Enable category and language first.');
      const {consentVersion,...data}=JSON.parse(row.data);soundId='ugc-'+row.id;
      const kind=b.kind??data.kind??'speech';if(!SOUND_KINDS.includes(kind))fail(400,'Invalid sound type.');
      if(kind==='speech'&&!data.text?.trim())fail(400,'Ucapan memerlukan transkrip / Speech needs a transcript.');
      data.kind=kind;
      Object.assign(data,{ugcId:row.id,ranked:false,url:`/api/community/submissions/${row.id}/audio`,audioKey:row.audio_key});
      statements.push(db.statement("INSERT INTO sounds(id,category_id,language,data,active,revision) SELECT ?,?,?,?,1,1 WHERE EXISTS(SELECT 1 FROM community_submissions WHERE id=? AND status='pending')",soundId,row.category_id,row.language,JSON.stringify(data),row.id));
    }
    const updateIndex=statements.length;
    statements.push(db.statement("UPDATE community_submissions SET status=?,sound_id=?,reviewed_at=?,reviewer=?,review_note=?,action_token=? WHERE id=? AND status='pending'",b.status,soundId,Date.now(),user.id,note,token,row.id),audit(db,user,'community.'+b.status,row.id,token));
    const result=await db.batch(statements);if(!result[updateIndex].meta.changes)fail(409,'Sudah diproses / Already processed.');
    return json({ok:true,soundId});
  }
  return null;
}
