import {fail,limitedBody} from './validation.js';

const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const text=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?text.encode(value):value));
const accountKey=email=>'netlify:account:'+email;
const emailKey=async email=>'netlify:email:'+await digest(email);
const sessionKey=async token=>'netlify:session:'+await digest(token);
const cookieName='mimic_session';
const cookieToken=req=>{
  const value=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  return value&&/^[a-f0-9]{64}$/.test(value)?value:null;
};
async function body(req){
  let value;try{value=JSON.parse(new TextDecoder().decode(await limitedBody(req,8000)));}catch{fail(400,'Invalid request.');}
  if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Invalid request.');return value;
}
function credentials(input){
  const email=String(input.email||'').trim().toLowerCase(),password=String(input.password||'');
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail(400,'Masukkan email yang valid / Enter a valid email.');
  if(password.length<12||password.length>128)fail(400,'Kata sandi harus 12–128 karakter / Password must be 12–128 characters.');
  return {email,password};
}
async function passwordRecord(password){
  const salt=crypto.getRandomValues(new Uint8Array(16)),key=await crypto.subtle.importKey('raw',text.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:180000},key,256);
  return `pbkdf2-sha256$180000$${b64(salt)}$${b64(bits)}`;
}
async function passwordMatches(password,record){
  const [scheme,count,salt,expected]=String(record||'').split('$');
  if(scheme!=='pbkdf2-sha256'||count!=='180000'||!salt||!expected)return false;
  const key=await crypto.subtle.importKey('raw',text.encode(password),'PBKDF2',false,['deriveBits']);
  const actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:180000},key,256)),wanted=unb64(expected);
  let diff=actual.length^wanted.length;for(let i=0;i<Math.min(actual.length,wanted.length);i++)diff|=actual[i]^wanted[i];return diff===0;
}
function cookie(req,token,maxAge){
  const secure=new URL(req.url).protocol==='https:'?'; Secure':'';
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
async function openSession(req,db,user){
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),key=await sessionKey(token),expiresAt=Date.now()+14*86400000;
  await db.run('INSERT INTO config(id,value) VALUES(?,?)',key,JSON.stringify({userId:user.id,email:user.email,expiresAt}));
  return json({ok:true,user:{id:user.id,email:user.email,role:user.role}},200,{'Set-Cookie':cookie(req,token,14*86400)});
}

export async function netlifyAuthRoutes(req,db){
  const path=new URL(req.url).pathname;
  if(path==='/api/auth/setup'&&req.method==='POST'){
    const {email,password}=credentials(await body(req));
    if(await db.one("SELECT id FROM config WHERE id='netlify:owner'"))fail(409,'Owner sudah diklaim. Masuk dengan akun owner / Owner is already claimed. Sign in.');
    const eKey=await emailKey(email),existing=await db.one('SELECT value FROM config WHERE id=?',eKey),owner=existing?JSON.parse(existing.value):{id:crypto.randomUUID(),email,role:'owner'};
    owner.role='owner';owner.email=email;owner.password=await passwordRecord(password);owner.createdAt??=Date.now();
    const writes=[db.statement("INSERT INTO config(id,value) VALUES('netlify:owner',?)",JSON.stringify({id:owner.id,email})),
      db.statement('INSERT INTO config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',accountKey(email),JSON.stringify(owner)),
      db.statement('INSERT INTO config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',eKey,JSON.stringify({id:owner.id}))];
    await db.batch(writes);return openSession(req,db,owner);
  }
  if(path==='/api/auth/register'&&req.method==='POST'){
    const {email,password}=credentials(await body(req)),eKey=await emailKey(email);
    if(await db.one('SELECT id FROM config WHERE id=?',eKey))fail(409,'Email sudah terdaftar. Masuk atau gunakan email lain / Email already registered. Sign in or use another email.');
    const user={id:crypto.randomUUID(),email,role:'player',password:await passwordRecord(password),createdAt:Date.now()};
    await db.batch([db.statement('INSERT INTO config(id,value) VALUES(?,?)',accountKey(email),JSON.stringify(user)),db.statement('INSERT INTO config(id,value) VALUES(?,?)',eKey,JSON.stringify({id:user.id}))]);
    return openSession(req,db,user);
  }
  if(path==='/api/auth/login'&&req.method==='POST'){
    const {email,password}=credentials(await body(req)),mapping=await db.one('SELECT value FROM config WHERE id=?',await emailKey(email));
    if(!mapping)fail(401,'Email atau kata sandi salah / Incorrect email or password.');
    const userRow=await db.one('SELECT value FROM config WHERE id=?',accountKey(email));if(!userRow)fail(401,'Email atau kata sandi salah / Incorrect email or password.');
    const user=JSON.parse(userRow.value);if(!await passwordMatches(password,user.password))fail(401,'Email atau kata sandi salah / Incorrect email or password.');
    return openSession(req,db,user);
  }
  if(path==='/api/auth/logout'&&req.method==='POST'){
    const token=cookieToken(req);if(token)await db.run('DELETE FROM config WHERE id=?',await sessionKey(token));
    return json({ok:true},200,{'Set-Cookie':cookie(req,'',0)});
  }
  return null;
}

export async function netlifySession(req,db){
  const token=cookieToken(req);if(!token)return null;
  const key=await sessionKey(token),row=await db.one('SELECT value FROM config WHERE id=?',key);if(!row)return null;
  let session;try{session=JSON.parse(row.value);}catch{return null;}
  if(!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now()){await db.run('DELETE FROM config WHERE id=?',key);return null;}
  const account=await db.one('SELECT value FROM config WHERE id=?','netlify:account:'+session.email);
  if(!account)return null;
  const user=JSON.parse(account.value);let role=user.role;
  if(role==='player'){
    const staff=await db.one('SELECT value FROM config WHERE id=?','staff:'+user.email.toLowerCase());
    if(staff){const grant=JSON.parse(staff.value);if(grant.active&&['admin','moderator'].includes(grant.role))role=grant.role;}
  }
  return {id:user.id,email:user.email,role,admin:role!=='player'};
}
