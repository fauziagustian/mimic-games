import pack from './generated/sample-collections.js';
import {enabledCategory} from './categories.js';
import {id,fail} from './validation.js';
const bundled=new Map(pack.sounds.map(({id,bytes})=>[id,bytes]));
export const THEME_CATEGORIES=[
  {id:'anime',parentId:null,nameId:'Anime',nameEn:'Anime'},
  {id:'bleach',parentId:'anime',nameId:'Bleach',nameEn:'Bleach'},
  {id:'meme',parentId:null,nameId:'Meme',nameEn:'Memes'},
  {id:'meme-global',parentId:'meme',nameId:'Meme Global',nameEn:'Global Memes'},
  {id:'meme-indonesia',parentId:'meme',nameId:'Meme Indonesia',nameEn:'Indonesian Memes'},
  {id:'meme-lucu',parentId:'meme',nameId:'Meme Lucu',nameEn:'Funny Memes'},
].map(c=>({...c,descriptionId:'',descriptionEn:'',active:true,revision:0}));
export async function seedThemePack(db,env){
  if(await db.one("SELECT id FROM config WHERE id='user-sample-collections-v2'"))return;
  // Audio is bundled in the Function and served only after catalog access checks.
  // Keep every admin edit and migrate only untouched inactive Bleach drafts.
  const ops=THEME_CATEGORIES.map(c=>db.statement('INSERT OR IGNORE INTO categories(id,data,active) VALUES(?,?,1)',c.id,JSON.stringify(c)));
  for(const sound of pack.sounds){
    const {bytes,...data}=sound;
    const old=await db.one('SELECT data,active,revision FROM sounds WHERE id=?',sound.id);
    if(!old){ops.push(db.statement('INSERT OR IGNORE INTO sounds(id,category_id,language,data,active,revision) VALUES(?,?,?,?,1,1)',data.id,data.categoryId,data.language,JSON.stringify(data)));continue;}
    const previous=JSON.parse(old.data);
    if(old.active===0&&old.revision===1&&previous.importPack==='bleach-v1'){
      const migrated={...data,audioKey:previous.audioKey};
      ops.push(db.statement('UPDATE sounds SET data=?,active=1 WHERE id=? AND data=? AND active=0 AND revision=1',JSON.stringify(migrated),sound.id,old.data));
    }
  }
  ops.push(db.statement("INSERT OR IGNORE INTO config(id,value) VALUES('user-sample-collections-v2','1')"));
  await db.batch(ops);
}
export async function themePackAudio(req,env,db,user){
  const path=new URL(req.url).pathname,match=path.match(/^\/api\/library-sounds\/([\w-]+)\/audio$/);
  if(!match||req.method!=='GET')return null;
  const row=await db.one('SELECT * FROM sounds WHERE id=?',id(match[1]));if(!row)fail(404,'Audio not found.');
  const data=JSON.parse(row.data);
  if(!['bleach-v1','user-samples-v2'].includes(data.importPack))fail(404,'Audio not found.');
  const published=row.active&&data.rightsReviewed&&await enabledCategory(db,row.category_id)&&await db.one('SELECT id FROM languages WHERE id=? AND active=1',row.language);
  if(!published&&!user?.admin)fail(404,'Audio not found.');
  const encoded=bundled.get(row.id);
  if(encoded&&data.importPack==='user-samples-v2'){
    const audio=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    return new Response(audio,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  const object=data.audioKey&&await env.BUCKET.get(data.audioKey);if(!object)fail(404,'Audio unavailable.');
  return new Response(object.body,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
