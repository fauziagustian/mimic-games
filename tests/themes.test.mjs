import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtime} from '../scripts/runtime.mjs';
import {categoryEnabled,categoryScope,categoryTrail,categorySelection,orderedCategories} from '../public/categories.js';
import {categoryEditorMarkup} from '../public/category-editor.js';
import {createPage} from '../public/game-pages.js';
import {DEFAULT_RULES} from '../public/catalog.js';
import vm from 'node:vm';

const tree=[{id:'anime',nameId:'Anime',nameEn:'Anime',active:true},{id:'bleach',parentId:'anime',nameId:'Bleach',nameEn:'Bleach',active:true},{id:'meme',nameId:'Meme',nameEn:'Memes',active:true},{id:'off',parentId:'anime',nameId:'Off',active:false}];
test('two-level themes: legacy roots, ancestry visibility, scope, selection and escaped admin/game markup',()=>{
  assert.deepEqual(categoryScope(tree,'anime'),['anime','bleach']);assert.deepEqual(categoryScope(tree,'bleach'),['bleach']);assert.deepEqual(categoryScope(tree,'off'),[]);assert.deepEqual(categoryScope(tree,'missing'),[]);
  assert.equal(categoryEnabled([{id:'a',parentId:'b'},{id:'b',parentId:'a'}],'a'),false);
  assert.equal(categoryEnabled(tree.map(c=>c.id==='anime'?{...c,active:false}:c),'bleach'),false);
  assert.deepEqual(categoryTrail(tree,'bleach').map(c=>c.id),['anime','bleach']);assert.equal(categorySelection(tree,'bleach').rootId,'anime');assert.deepEqual(orderedCategories(tree).map(c=>c.id),['anime','bleach','off','meme']);
  globalThis.localStorage={getItem:()=>null};
  const catalog={categories:tree,sounds:[],rules:DEFAULT_RULES,languages:[]};
  const page=createPage({catalog,setup:{categoryId:'bleach'},name:'A',avatarId:'male-a'});assert.match(page,/<option value="anime" selected>/);assert.match(page,/<option value="bleach" selected>/);assert.match(page,/id="subcategory"/);assert.match(page,/Semua sound dalam tema/);
  const editor=categoryEditorMarkup(catalog,{...tree[1],nameId:'<script>bad</script>'});assert.match(editor,/value="anime" selected/);assert.match(editor,/data-child-parent="anime"/);assert.doesNotMatch(editor,/<script>/);assert.match(editor,/&lt;script&gt;/);
});

test('create-match controller resets stale subcategories and filters parent/child sound counts (DOM doubles)',async()=>{
  const source=await readFile('public/app.js','utf8'),fn=source.slice(source.indexOf('function renderCreate()'),source.indexOf('function saveSession('));
  const nodes=Object.fromEntries(['category','subcategory','language','profile','matchType','capacity','soundCount','soundCards','create'].map(id=>['#'+id,{value:'',textContent:'',innerHTML:''}]));
  nodes['#language'].value='all';nodes['#profile'].value='party';nodes['#matchType'].value='custom';nodes['#capacity'].value='2';let resets=0;
  const catalog={categories:tree,rules:DEFAULT_RULES,languages:[],sounds:[{id:'child',categoryId:'bleach',duration:1,source:'QA'},{id:'root',categoryId:'anime',duration:1,source:'QA'},{id:'meme',categoryId:'meme',duration:1,source:'QA'}]};
  const c=vm.createContext({catalog,setup:{categoryId:'bleach'},app:{},$:selector=>nodes[selector],categoryScope,localStorage:{getItem:()=>''},sessionStorage:{setItem(){}},preferredAvatar:()=>'',esc:x=>String(x||''),label:x=>x,picker:{payload:()=>({}),render(){},reset(){resets++;}},creating:false,create(){},bind(){},document:{querySelectorAll:()=>[]},createPage:({setup})=>{const theme=categorySelection(tree,setup.categoryId);nodes['#category'].value=theme.rootId;nodes['#subcategory'].value=theme.childId;return '';}});
  vm.runInContext(fn+';renderCreate()',c);assert.equal(c.setup.categoryId,'bleach');assert.equal(nodes['#soundCount'].textContent,' · 1');
  nodes['#subcategory'].value='';nodes['#subcategory'].onchange();assert.equal(c.setup.categoryId,'anime');assert.equal(nodes['#soundCount'].textContent,' · 2');
  nodes['#subcategory'].value='bleach';nodes['#subcategory'].onchange();nodes['#category'].value='meme';nodes['#category'].onchange();assert.equal(c.setup.categoryId,'meme');assert.equal(nodes['#subcategory'].value,'');assert.equal(nodes['#soundCount'].textContent,' · 1');assert.equal(resets,1);
});

test('Worker themes: private imports, dynamic hierarchy, exact pool selection, UGC ancestry, stable rooms and concurrent edits',async t=>{
  const mf=await runtime(),db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('BUCKET'),origin='https://mimic.test';
  const raw=await readFile('public/audio/lah-kok-gitu.wav');
  const call=async(path,{who,body,raw:bytes,token,headers={}}={})=>{
    const r=await mf.dispatchFetch(origin+path,{method:body||bytes?'POST':'GET',headers:{Origin:origin,...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@preview.test'}:{}),...(token?{'X-Room-Token':token}:{}),...headers},body:bytes??(body?JSON.stringify(body):undefined)});
    const type=r.headers.get('content-type');return {status:r.status,data:type?.includes('json')?await r.json():await r.arrayBuffer()};
  };
  const catalog=async()=> (await call('/api/admin/catalog',{who:'admin'})).data;
  const cat=async(id,overrides={})=>{const old=(await catalog()).categories.find(c=>c.id===id);return call('/api/admin/categories',{who:'admin',body:{id,nameId:id,nameEn:id,descriptionId:'',descriptionEn:'',active:true,...old,...overrides}});};
  const create=async(categoryId,extra={})=>call('/api/rooms',{body:{name:'Tester',capacity:2,categoryId,language:'all',...extra}});
  let initial,host,ugc;
  try{
    await t.test('four imports are inactive, access-checked and never served as static assets',async()=>{
      initial=await catalog();const drafts=initial.sounds.filter(s=>s.importPack==='bleach-v1');assert.equal(drafts.length,4);
      assert.equal((await call('/api/catalog')).data.sounds.length,6);assert.equal((await bucket.list()).objects.length,4);
      for(const s of drafts){assert.equal(s.active,false);assert.equal(s.ranked,false);assert.equal(s.categoryId,'bleach');assert.equal(s.language,'japanese');assert.equal(s.transcriptReviewed,false);assert.ok(s.duration>.25&&s.duration<=15);assert.equal((await call(s.url)).status,404);assert.equal((await call(s.url,{who:'player'})).status,404);assert.equal((await call(s.url,{who:'admin'})).status,200);}
      assert.equal((await call('/private-assets/bleach/shunsui-bankai.wav')).status,404);assert.equal((await call('/audio/shunsui-bankai.wav')).status,404);
      const s=drafts[0];assert.equal((await call('/api/admin/sounds',{who:'admin',body:{...s,active:true}})).status,400);
      assert.equal((await call('/api/admin/sounds',{who:'admin',body:{...s,active:true,rightsReviewed:true,transcriptReviewed:true}})).status,400);
      const saved=await call('/api/admin/sounds',{who:'admin',body:{...s,title:'Draft title edited',active:false}});assert.equal(saved.status,200);
      assert.equal((await catalog()).sounds.find(x=>x.id===s.id).title,'Draft title edited','content pack must never overwrite edits');
      assert.equal((await create('bleach')).status,400,'empty/draft-only themes cannot start');
    });
    await t.test('admin tree guards reject missing/self/deep/cyclic parents and stale writes',async()=>{
      assert.equal((await cat('naruto',{parentId:'anime'})).status,200);
      for(const parentId of ['naruto','missing','bleach',22])assert.equal((await cat('naruto',{parentId})).status,400);
      assert.equal((await cat('anime',{parentId:'meme'})).status,400,'parent with children cannot become a child');
      const old=(await catalog()).categories.find(c=>c.id==='bleach');assert.equal((await cat('bleach',{nameId:'Bleach baru'})).status,200);
      assert.equal((await call('/api/admin/categories',{who:'admin',body:old})).status,409);
      assert.equal((await call('/api/admin/categories',{who:'player',body:old})).status,403);
      assert.equal((await call('/api/admin/categories',{who:'admin',body:old,headers:{Origin:'https://evil.test'}})).status,403);
      await cat('race-a');await cat('race-b');const race=await Promise.all([cat('race-a',{parentId:'race-b'}),cat('race-b',{parentId:'race-a'})]);assert.equal(race.filter(r=>r.status===200).length,1);
      const current=(await catalog()).categories;assert.ok(current.every(c=>!c.parentId||!current.find(p=>p.id===c.parentId)?.parentId));
    });
    await t.test('root themes aggregate children; specific themes and solo queues stay isolated',async()=>{
      const asset=(await call('/api/admin/upload',{who:'admin',raw})).data;
      for(const categoryId of ['bleach','naruto','meme-lucu'])assert.equal((await call('/api/admin/sounds',{who:'admin',body:{id:'test-'+categoryId,categoryId,language:'indonesian',title:'QA '+categoryId,text:'Lah kok gitu',source:'QA',rights:'Original synthetic QA',active:true,ranked:false,uploadId:asset.id}})).status,200);
      host=(await create('anime')).data;const room=(await call('/api/rooms/'+host.code,{token:host.token})).data;assert.deepEqual(room.clips.map(s=>s.id).sort(),['test-bleach','test-naruto']);assert.equal(room.theme.nameId,'Anime');
      const leaf=(await create('bleach')).data,leafRoom=(await call('/api/rooms/'+leaf.code,{token:leaf.token})).data;assert.deepEqual(leafRoom.clips.map(s=>s.id),['test-bleach']);assert.equal(leafRoom.theme.nameId,'Anime › Bleach baru');
      assert.equal((await create('bleach',{soundIds:['test-naruto']})).status,400);assert.equal((await create('anime',{soundIds:['test-naruto']})).status,200);
      const a=(await create('bleach',{matchType:'solo',capacity:8})).data,b=(await create('bleach',{matchType:'solo',capacity:8})).data,c=(await create('naruto',{matchType:'solo',capacity:8})).data;assert.equal(a.code,b.code);assert.notEqual(a.code,c.code);
      await cat('bleach',{nameId:'Renamed'});assert.equal((await call('/api/rooms/'+leaf.code,{token:leaf.token})).data.theme.nameId,'Anime › Bleach baru');
    });
    await t.test('UGC parent filtering and disabled ancestor visibility are enforced beyond the UI',async()=>{
      ugc=(await call('/api/community/submissions',{who:'creator',body:{requestId:crypto.randomUUID(),title:'Theme UGC',creatorName:'Tester',kind:'speech',text:'test phrase',categoryId:'bleach',language:'indonesian',source:'QA',rights:'Original synthetic',consent:true,audio:raw.toString('base64')}})).data.item;
      assert.equal((await call('/api/admin/community/'+ugc.id+'/review',{who:'admin',body:{status:'approved',checked:true}})).status,200);
      assert.ok((await call('/api/community?category=anime')).data.items.some(i=>i.id===ugc.id));assert.equal((await call('/api/community?category=naruto')).data.items.length,0);
      await cat('anime',{active:false});const publicCatalog=(await call('/api/catalog')).data;assert.ok(!publicCatalog.categories.some(c=>['anime','bleach','naruto'].includes(c.id)));assert.ok(!publicCatalog.sounds.some(s=>['bleach','naruto'].includes(s.categoryId)));
      assert.equal((await call('/api/community?category=anime')).data.items.length,0);assert.equal((await call(ugc.url)).status,404);assert.equal((await create('bleach')).status,400);
      const denied=await call('/api/community/submissions',{who:'creator2',body:{requestId:crypto.randomUUID(),title:'No',creatorName:'Tester',text:'test',categoryId:'bleach',language:'indonesian',source:'QA',rights:'Original',consent:true,audio:raw.toString('base64')}});assert.equal(denied.status,400);
      const oldRoom=(await call('/api/rooms/'+host.code,{token:host.token})).data;assert.equal(oldRoom.clips.length,2);assert.equal(oldRoom.theme.nameId,'Anime');
      await cat('anime',{active:true});assert.ok((await call('/api/catalog')).data.categories.some(c=>c.id==='bleach'));
    });
    await t.test('UGC audio visibility follows its current catalog parent after admin recategorization',async()=>{
      const sound=(await catalog()).sounds.find(s=>s.ugcId===ugc.id);
      assert.equal((await call('/api/admin/sounds',{who:'admin',body:{...sound,categoryId:'meme-lucu'}})).status,200);
      await cat('meme',{active:false});assert.equal((await call(ugc.url)).status,404);
      await cat('meme',{active:true});await cat('anime',{active:false});assert.equal((await call(ugc.url)).status,200,'original submission theme must not override the current catalog theme');
      assert.ok((await call('/api/community?category=meme')).data.items.some(i=>i.id===ugc.id));
      await cat('anime',{active:true});
    });
    await t.test('import publication requires explicit metadata review, and disabling revokes new audio access',async()=>{
      const s=(await catalog()).sounds.find(s=>s.id==='bleach-ichigo-bankai');
      const published=await call('/api/admin/sounds',{who:'admin',body:{...s,active:true,rights:'Unit test permission attestation',rightsReviewed:true,transcriptReviewed:true,text:'Unit test reviewed words'}});assert.equal(published.status,200);
      assert.equal((await call(s.url)).status,200);const current=(await catalog()).sounds.find(x=>x.id===s.id);assert.equal(current.rightsReviewed,true);
      assert.equal((await call('/api/admin/sounds',{who:'admin',body:{...current,active:false}})).status,200);assert.equal((await call(s.url)).status,404);assert.equal((await call(s.url,{who:'admin'})).status,200);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM sounds WHERE json_extract(data,'$.importPack')='bleach-v1'").first()).n,4);
    });
  }finally{await mf.dispose();}
});
