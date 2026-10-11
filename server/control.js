import {fail,text,integer,limitedBody,HttpError} from './validation.js';
import {DEFAULT_SITE,SITE_TEXT_LIMITS,SITE_FLAGS,ACCENTS} from '../public/site-config.js';

const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const key='site:settings';
export const owners=env=>(env.ADMIN_EMAILS||'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean);
export async function identity(req,env,db){
  const userId=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email');if(!userId||!email)return null;
  let role=owners(env).includes(email.toLowerCase())?'owner':'player';
  if(role==='player'){const row=await db.one('SELECT value FROM config WHERE id=?','staff:'+email.toLowerCase());if(row){const staff=JSON.parse(row.value);if(staff.active&&['admin','moderator'].includes(staff.role))role=staff.role;}}
  return {id:userId,email,role,admin:role!=='player'};
}
export function authorizeControl(path,user){
  if(!user)fail(401,'Masuk terlebih dahulu / Sign in first.');if(!user.admin)fail(403,'Khusus pengelola / Staff only.');
  if(path.startsWith('/api/admin/staff')&&user.role!=='owner')fail(403,'Khusus owner / Owner only.');
  if(user.role==='moderator'&&!/^\/api\/admin\/(catalog$|overview$|community(?:\/|$)|attempts(?:\/|$))/.test(path))fail(403,'Moderator hanya dapat meninjau UGC dan skor / Moderators can only review UGC and scores.');
}
async function body(req){try{const b=JSON.parse(new TextDecoder().decode(await limitedBody(req,20000)));if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Invalid object.');return b;}catch(e){if(e instanceof HttpError)throw e;fail(400,'Invalid JSON.');}}
export function validateSite(input){
  if(!input||typeof input!=='object')fail(400,'Settings required.');const out={};
  for(const [k,max] of Object.entries(SITE_TEXT_LIMITS))out[k]=text(input[k],max,!['announcementId','announcementEn'].includes(k));
  for(const k of SITE_FLAGS){if(typeof input[k]!=='boolean')fail(400,'Invalid setting: '+k);out[k]=input[k];}
  if(out.announcementEnabled&&(!out.announcementId||!out.announcementEn))fail(400,'Isi pengumuman dalam kedua bahasa / Fill both announcement languages.');
  if(!Object.hasOwn(ACCENTS,input.accent))fail(400,'Invalid accent.');out.accent=input.accent;
  out.helpUrl=text(input.helpUrl,300,false);if(out.helpUrl){let u;try{u=new URL(out.helpUrl);}catch{fail(400,'Use an HTTPS support URL.');}if(u.protocol!=='https:'||u.username||u.password)fail(400,'Use an HTTPS support URL without credentials.');}
  return out;
}
export async function siteSettings(db){const row=await db.one('SELECT value FROM config WHERE id=?',key);if(!row)return {settings:{...DEFAULT_SITE},revision:0,updatedAt:null};const value=JSON.parse(row.value);return {settings:{...DEFAULT_SITE,...value.settings},revision:value.revision,updatedAt:value.updatedAt};}
export async function enforceOperations(req,db,user){
  if(req.method!=='POST')return;const p=new URL(req.url).pathname;
  const create=p==='/api/rooms'||p==='/api/matches',join=/^\/api\/(rooms|matches)\/[^/]+\/join$/.test(p),ugc=p==='/api/community/submissions';
  if(!create&&!join&&!ugc)return;const {settings:s}=await siteSettings(db);
  // Owners/admins may smoke-test during maintenance. Moderators are not operators.
  const operator=['owner','admin'].includes(user?.role);
  if(!operator&&(create&&!s.acceptNewRooms||join&&(!s.acceptNewRooms||!s.allowJoins)))fail(503,s.maintenanceId+' / '+s.maintenanceEn);
  if(ugc&&!s.ugcSubmissionsEnabled)fail(503,'Pengiriman UGC sedang dijeda / UGC submissions are paused.');
}
const actorLog=(db,user,action,target,condition,values)=>db.statement(`INSERT INTO audit(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE ${condition}`,crypto.randomUUID(),user.id,action,target,Date.now(),...values);
export async function controlRoutes(req,env,db,user,getCatalog){
  const u=new URL(req.url),p=u.pathname,method=req.method;
  if(p==='/api/site'&&method==='GET')return json(await siteSettings(db));
  if(p==='/api/admin/site'&&method==='GET')return json(await siteSettings(db));
  if(p==='/api/admin/site'&&method==='POST'){
    const b=await body(req),settings=validateSite(b.settings),previous=await db.one('SELECT value FROM config WHERE id=?',key),old=previous?JSON.parse(previous.value):{revision:0};
    if(b.revision!==old.revision)fail(409,'Pengaturan berubah. Muat ulang sebelum menyimpan / Settings changed. Reload before saving.');
    const value=JSON.stringify({settings,revision:old.revision+1,updatedAt:Date.now(),operationId:crypto.randomUUID()}),condition='EXISTS(SELECT 1 FROM config WHERE id=? AND value=?)';
    const write=previous?db.statement('UPDATE config SET value=? WHERE id=? AND value=?',value,key,previous.value):db.statement('INSERT INTO config(id,value) VALUES(?,?) ON CONFLICT(id) DO NOTHING',key,value);
    const result=await db.batch([write,db.statement(`INSERT INTO config(id,value) SELECT ?,? WHERE ${condition}`,'site:version:'+String(old.revision+1).padStart(9,'0'),value,key,value),actorLog(db,user,'site.publish',String(old.revision+1),condition,[key,value])]);
    if(!result[0].meta.changes)fail(409,'Pengaturan sudah diubah admin lain / Another admin changed these settings.');return json(await siteSettings(db));
  }
  if(p==='/api/admin/site/history'&&method==='GET'){
    const rows=await db.all("SELECT value FROM config WHERE id LIKE 'site:version:%' ORDER BY id DESC LIMIT 20");
    return json({items:rows.map(r=>{const {settings,revision,updatedAt}=JSON.parse(r.value);return {settings,revision,updatedAt};})});
  }
  if(p==='/api/admin/overview'&&method==='GET'){
    const [sounds,categories,rooms,recent,ugc,attempts,season]=await Promise.all([
      db.one('SELECT count(*) AS total,sum(active) AS active FROM sounds'),db.one('SELECT count(*) AS total,sum(active) AS active FROM categories'),
      db.one("SELECT count(*) AS total,coalesce(sum(json_array_length(data,'$.players')),0) AS playerSlots FROM rooms WHERE expires_at>? AND json_extract(data,'$.phase')<>'finished'",Date.now()),
      db.one('SELECT count(*) AS total FROM matches WHERE created_at>?',Date.now()-86400000),
      db.all('SELECT status,count(*) AS total FROM community_submissions GROUP BY status'),db.all('SELECT status,count(*) AS total FROM attempts GROUP BY status'),db.one('SELECT max(version) AS version FROM rules')]);
    return json({sounds,categories,rooms,roomsLast24h:recent.total,ugc,attempts,season:season.version,generatedAt:Date.now()});
  }
  if(p==='/api/admin/rooms'&&method==='GET'){
    const page=integer(Number(u.searchParams.get('page')||0),0,10000),rows=await db.all('SELECT r.code,r.revision,r.data,r.expires_at,m.created_at FROM rooms r JOIN matches m ON m.id=r.match_id ORDER BY m.created_at DESC,r.code DESC LIMIT 26 OFFSET ?',page*25);
    return json({items:rows.slice(0,25).map(r=>{const s=JSON.parse(r.data);return {code:r.code,revision:r.revision,phase:s.closedReason?'closed':r.expires_at<Date.now()?'expired':s.phase,players:s.players.length,round:s.round,rounds:s.rules.rounds,mode:s.mode,categoryId:s.categoryId,createdAt:r.created_at,expiresAt:r.expires_at,closedReason:s.closedReason||''};}),nextPage:rows.length>25?page+1:null});
  }
  const close=p.match(/^\/api\/admin\/rooms\/([A-Z2-9]{6})\/close$/);
  if(close&&method==='POST'){
    const b=await body(req),reason=text(b.reason,200),row=await db.one('SELECT * FROM rooms WHERE code=?',close[1]);if(!row)fail(404,'Room not found.');
    if(row.revision!==b.revision||row.expires_at<Date.now())fail(409,'Room sudah berubah atau ditutup / Room changed or already closed.');
    const s=JSON.parse(row.data);s.closedReason=reason;s.closeOperation=crypto.randomUUID();const expires=Date.now()-1,condition="EXISTS(SELECT 1 FROM rooms WHERE code=? AND json_extract(data,'$.closeOperation')=?)";
    const results=await db.batch([db.statement('UPDATE rooms SET data=?,expires_at=?,revision=revision+1 WHERE code=? AND revision=?',JSON.stringify(s),expires,row.code,row.revision),db.statement(`UPDATE matches SET status='closed',expires_at=? WHERE id=? AND ${condition}`,expires,row.match_id,row.code,s.closeOperation),actorLog(db,user,'room.close',row.code,condition,[row.code,s.closeOperation])]);
    if(!results[0].meta.changes)fail(409,'Room changed. Refresh.');return json({ok:true});
  }
  if(p==='/api/admin/staff'&&method==='GET'){
    const rows=await db.all("SELECT value FROM config WHERE id LIKE 'staff:%' ORDER BY id LIMIT 100");return json({owners:owners(env),items:rows.map(r=>JSON.parse(r.value))});
  }
  if(p==='/api/admin/staff'&&method==='POST'){
    const b=await body(req),email=text(b.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Invalid email.');
    if(owners(env).includes(email))fail(403,'Akun owner dilindungi konfigurasi server / Bootstrap owner accounts are protected.');
    if(!['admin','moderator'].includes(b.role)||typeof b.active!=='boolean')fail(400,'Invalid role.');
    const k='staff:'+email,old=await db.one('SELECT value FROM config WHERE id=?',k),prior=old?JSON.parse(old.value):{revision:0};if((b.revision??0)!==prior.revision)fail(409,'Staff changed. Reload.');
    if(!old&&(await db.one("SELECT count(*) AS n FROM config WHERE id LIKE 'staff:%'")).n>=100)fail(409,'Maximum 100 staff accounts.');
    const value=JSON.stringify({email,name:text(b.name,60),role:b.role,active:b.active,revision:prior.revision+1,updatedAt:Date.now(),operationId:crypto.randomUUID()});
    const write=old?db.statement('UPDATE config SET value=? WHERE id=? AND value=?',value,k,old.value):db.statement('INSERT INTO config(id,value) VALUES(?,?) ON CONFLICT(id) DO NOTHING',k,value);
    const r=await db.batch([write,actorLog(db,user,'staff.'+(b.active?'grant':'revoke'),email,'EXISTS(SELECT 1 FROM config WHERE id=? AND value=?)',[k,value])]);if(!r[0].meta.changes)fail(409,'Staff changed. Reload.');return json({ok:true});
  }
  if(p==='/api/admin/export'&&method==='GET'){
    return json({format:'mimic-config-v1',exportedAt:new Date().toISOString(),website:await siteSettings(db),catalog:await getCatalog(db,true),note:'Metadata only. Audio binaries, player recordings, staff accounts, tokens and secrets are not included. This is not a full database backup.'});
  }
  if(p==='/api/admin/activity'&&method==='GET'){
    const page=integer(Number(u.searchParams.get('page')||0),0,10000),q=text(u.searchParams.get('q')||'',80,false),rows=await db.all('SELECT actor,action,target,created_at FROM audit WHERE (?=\'\' OR action LIKE ? OR target LIKE ?) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?',q,'%'+q+'%','%'+q+'%',page*50);
    return json({items:rows.slice(0,50),nextPage:rows.length>50?page+1:null});
  }
  return null;
}
