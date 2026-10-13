import pack from '../work/bleach-pack.json';
import {enabledCategory} from './categories.js';
import {id,fail} from './validation.js';
export const THEME_CATEGORIES=[
  {id:'anime',parentId:null,nameId:'Anime',nameEn:'Anime'},
  {id:'bleach',parentId:'anime',nameId:'Bleach',nameEn:'Bleach'},
  {id:'meme',parentId:null,nameId:'Meme',nameEn:'Memes'},
  {id:'meme-lucu',parentId:'meme',nameId:'Meme Lucu',nameEn:'Funny Memes'},
].map(c=>({...c,descriptionId:'',descriptionEn:'',active:true,revision:0}));
export async function seedThemePack(db,env){
  if(await db.one("SELECT id FROM config WHERE id='bleach-theme-pack-v1'"))return;
  // These are bundled private drafts, not public static files. Deterministic keys
  // make parallel first requests safe; metadata never overwrites existing edits.
  const ops=THEME_CATEGORIES.map(c=>db.statement('INSERT OR IGNORE INTO categories(id,data,active) VALUES(?,?,1)',c.id,JSON.stringify(c)));
  for(const sound of pack.sounds){
    const {bytes,...data}=sound;
    await env.BUCKET.put(data.audioKey,Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)),{httpMetadata:{contentType:'audio/wav'}});
    ops.push(db.statement('INSERT OR IGNORE INTO sounds(id,category_id,language,data,active,revision) VALUES(?,?,?,?,0,1)',data.id,'bleach','japanese',JSON.stringify(data)));
  }
  ops.push(db.statement("INSERT OR IGNORE INTO config(id,value) VALUES('bleach-theme-pack-v1','1')"));
  await db.batch(ops);
}
export async function themePackAudio(req,env,db,user){
  const path=new URL(req.url).pathname,match=path.match(/^\/api\/library-sounds\/([\w-]+)\/audio$/);
  if(!match||req.method!=='GET')return null;
  const row=await db.one('SELECT * FROM sounds WHERE id=?',id(match[1]));if(!row)fail(404,'Audio not found.');
  const data=JSON.parse(row.data);
  if(data.importPack!=='bleach-v1')fail(404,'Audio not found.');
  const published=row.active&&data.rightsReviewed&&(data.kind==='sound'||data.transcriptReviewed)&&await enabledCategory(db,row.category_id)&&await db.one('SELECT id FROM languages WHERE id=? AND active=1',row.language);
  if(!published&&!user?.admin)fail(404,'Audio not found.');
  const object=await env.BUCKET.get(data.audioKey);if(!object)fail(404,'Audio unavailable.');
  return new Response(object.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
