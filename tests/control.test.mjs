import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtime} from '../scripts/runtime.mjs';
import {DEFAULT_SITE} from '../public/site-config.js';
import {validateSite} from '../server/control.js';
import {adminTabs} from '../public/admin-control.js';

test('website validation and role-scoped admin navigation',()=>{
  assert.deepEqual(validateSite(DEFAULT_SITE),DEFAULT_SITE);
  for(const changes of [{accent:'__proto__'},{helpUrl:'javascript:alert(1)'},{helpUrl:'https://user:pass@example.test'},{heroTitleId:'x'.repeat(101)},{acceptNewRooms:'true'},{announcementEnabled:true}])assert.throws(()=>validateSite({...DEFAULT_SITE,...changes}));
  assert.equal(validateSite({...DEFAULT_SITE,helpUrl:'https://example.test/help'}).helpUrl,'https://example.test/help');
  assert.deepEqual(adminTabs('moderator').map(t=>t[0]),['overview','community','review']);
  assert.equal(adminTabs('admin').some(t=>t[0]==='staff'),false);assert.equal(adminTabs('owner').some(t=>t[0]==='staff'),true);
});

test('Control center: RBAC, site versions, operation gates, selected sounds, room closure, export',async t=>{
  const mf=await runtime(),db=await mf.getD1Database('DB'),origin='https://mimic.test';
  const call=async(path,{who,method='GET',data,token,headers={}}={})=>{const r=await mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,...(who?{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@preview.test'}:{}),...(token?{'X-Room-Token':token}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});const value=await r.json();return {status:r.status,value};};
  const write=(path,data,who='admin')=>call(path,{who,method:'POST',data});
  const create=data=>write('/api/rooms',{name:'Host',categoryId:'drama',language:'all',mode:'casual',capacity:2,...data},null);
  let config,host,guest;
  try{
    await t.test('owners can grant/revoke roles; nonstaff and moderators cannot operate or escalate',async()=>{
      for(const path of ['/api/admin/overview','/api/admin/site','/api/admin/staff','/api/admin/rooms','/api/admin/export','/api/admin/activity']){assert.equal((await call(path)).status,401,path);assert.equal((await call(path,{who:'player'})).status,403,path);}
      assert.equal((await call('/api/me',{who:'admin'})).value.user.role,'owner');
      assert.equal((await write('/api/admin/staff',{name:'Mod',email:'mod@preview.test',role:'moderator',active:true,revision:0})).status,200);
      assert.equal((await write('/api/admin/staff',{name:'Operator',email:'operator@preview.test',role:'admin',active:true,revision:0})).status,200);
      assert.equal((await call('/api/me',{who:'mod'})).value.user.role,'moderator');
      for(const path of ['/api/admin/overview','/api/admin/catalog','/api/admin/community','/api/admin/attempts'])assert.equal((await call(path,{who:'mod'})).status,200,path);
      for(const path of ['/api/admin/site','/api/admin/export','/api/admin/activity','/api/admin/staff','/api/admin/rooms'])assert.equal((await call(path,{who:'mod'})).status,403,path);
      assert.equal((await write('/api/admin/rules',{rules:{}},'mod')).status,403);
      assert.equal((await write('/api/admin/staff',{name:'Self',email:'operator@preview.test',role:'owner',active:true},'operator')).status,403);
      assert.equal((await call('/api/admin/site',{who:'operator'})).status,200);
      assert.equal((await call('/api/admin/staff',{who:'operator'})).status,403);
      assert.equal((await write('/api/admin/staff',{name:'Remove owner',email:'ADMIN@PREVIEW.TEST',role:'moderator',active:false})).status,403);
      assert.equal((await write('/api/admin/staff',{name:'Bad role',email:'new@preview.test',role:'owner',active:true})).status,400);
      assert.equal((await write('/api/admin/staff',{name:'Mod',email:'mod@preview.test',role:'moderator',active:false,revision:1})).status,200);
      assert.equal((await call('/api/admin/overview',{who:'mod'})).status,403);
      assert.equal((await write('/api/admin/staff',{name:'Stale',email:'mod@preview.test',role:'admin',active:true,revision:1})).status,409);
    });
    await t.test('public settings are validated, persisted and versioned; concurrent saves do not overwrite',async()=>{
      config=(await call('/api/site')).value;assert.equal(config.revision,0);assert.equal(config.settings.brandName,'MIMIC');
      assert.equal((await call('/api/admin/site',{who:'admin',method:'POST',headers:{Origin:'https://evil.test'},data:{revision:0,settings:DEFAULT_SITE}})).status,403);
      const first={...DEFAULT_SITE,brandName:'MIMIC CLUB',heroTitleId:'Suara kamu.\nPanggung kita.',announcementEnabled:true,announcementId:'Halo pemain!',announcementEn:'Hello players!'};
      assert.equal((await write('/api/admin/site',{revision:0,settings:{...first,helpUrl:'data:text/html,bad'}})).status,400);
      const r=await write('/api/admin/site',{revision:0,settings:first});assert.equal(r.status,200);config=r.value;assert.equal(config.revision,1);
      assert.equal((await call('/api/site')).value.settings.heroTitleId,first.heroTitleId);assert.equal((await call('/api/catalog')).value.rules.version,1);
      assert.equal((await write('/api/admin/site',{revision:0,settings:DEFAULT_SITE})).status,409);
      const race=await Promise.all(['A','B'].map(v=>write('/api/admin/site',{revision:1,settings:{...first,brandName:'Club '+v}})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
      config=(await call('/api/site')).value;assert.equal(config.revision,2);
      const history=(await call('/api/admin/site/history',{who:'admin'})).value.items;assert.deepEqual(history.map(i=>i.revision),[2,1]);assert.equal(history[1].settings.brandName,'MIMIC CLUB');
      const logs=(await call('/api/admin/activity?q=site.publish',{who:'admin'})).value.items;assert.equal(logs.length,2);
      assert.equal('operationId' in config,false);assert.equal(JSON.stringify(config).includes('preview.test'),false);
    });
    await t.test('manual casual pools stay server-validated and shared; ranked cannot choose exact clips',async()=>{
      const catalog=(await call('/api/catalog')).value,drama=catalog.sounds.filter(s=>s.categoryId==='drama');assert.ok(drama.length>=2);
      const r=await create({soundIds:[drama[0].id]});assert.equal(r.status,200);host=r.value;
      const join=await write('/api/rooms/'+host.code+'/join',{name:'Guest'},null);assert.equal(join.status,200);guest=join.value;
      for(const p of [host,guest]){const state=(await call('/api/rooms/'+host.code,{token:p.token})).value;assert.deepEqual(state.clips.map(s=>s.id),[drama[0].id]);}
      for(const soundIds of [[],['hidden'],[drama[0].id,drama[0].id],['santai-bos'],new Array(51).fill(drama[0].id)])assert.equal((await create({soundIds})).status,400);
      assert.equal((await write('/api/rooms',{name:'Ranked',mode:'ranked',categoryId:'drama',language:'all',soundIds:[drama[0].id]},'player')).status,400);
    });
    await t.test('maintenance blocks new player work but allows existing rooms and protected admin access',async()=>{
      config=(await write('/api/admin/site',{revision:config.revision,settings:{...config.settings,acceptNewRooms:false,ugcSubmissionsEnabled:false,manualSoundSelectionEnabled:false}})).value;
      assert.equal((await create({})).status,503);
      assert.equal((await create({matchType:'solo',capacity:8})).status,503);
      assert.equal((await write('/api/rooms/'+host.code+'/join',{name:'Blocked'},null)).status,503);
      assert.equal((await write('/api/community/submissions',{},'player')).status,503);
      assert.equal((await call('/api/community')).status,200);assert.equal((await call('/api/community/mine',{who:'player'})).status,200);
      assert.equal((await write('/api/community/submissions/unknown/withdraw',{},'player')).status,404);
      assert.equal((await call('/api/admin/site',{who:'admin'})).status,200);
      assert.equal((await write('/api/rooms',{name:'Admin QA',categoryId:'drama',language:'all'},'operator')).status,200);
      assert.equal((await write('/api/rooms',{name:'Legacy',categoryId:'drama',language:'all',peerId:'test',code:'ABCDEF'},'player')).status,503);
      for(const p of [host,guest])assert.equal((await call('/api/rooms/'+host.code+'/ready',{token:p.token,method:'POST',data:{}})).status,200);
      assert.equal((await call('/api/rooms/'+host.code+'/start',{token:host.token,method:'POST',data:{}})).status,200);
      const state=(await call('/api/rooms/'+host.code,{token:host.token})).value;assert.equal(state.phase,'listen');assert.ok(state.queue.every(id=>id===state.clips[0].id));
      config=(await write('/api/admin/site',{revision:config.revision,settings:{...config.settings,acceptNewRooms:true,allowJoins:false}})).value;
      const newHost=(await create({})).value;assert.ok(newHost.code);assert.equal((await write('/api/rooms/'+newHost.code+'/join',{name:'Blocked'},null)).status,503);
      assert.equal((await create({matchType:'solo',capacity:8})).status,503,'pausing joins also blocks solo queue entry');
      assert.equal((await write('/api/rooms',{name:'Solo QA',categoryId:'drama',language:'all',matchType:'solo',capacity:8},'operator')).status,200,'operators retain QA access');
      assert.equal((await create({soundIds:['lah-kok-gitu']})).status,403);
    });
    await t.test('room monitor is sanitized; explicit revision-checked closure rejects new takes without deletion',async()=>{
      const rooms=(await call('/api/admin/rooms',{who:'operator'})).value.items,r=rooms.find(r=>r.code===host.code);assert.ok(r);assert.equal(typeof r.players,'number');
      const encoded=JSON.stringify(rooms);for(const secret of [host.token,guest.token,'peer_id','privateClips','audioKey'])assert.equal(encoded.includes(secret),false);
      assert.equal((await write(`/api/admin/rooms/${host.code}/close`,{revision:r.revision,reason:''})).status,400);
      assert.equal((await write(`/api/admin/rooms/${host.code}/close`,{revision:r.revision-1,reason:'Outdated'})).status,409);
      assert.equal((await write(`/api/admin/rooms/${host.code}/close`,{revision:r.revision,reason:'QA room closed'},'operator')).status,200);
      assert.equal((await call('/api/rooms/'+host.code,{token:host.token})).status,410);
      assert.equal((await call('/api/rooms/'+host.code+'/take?round=1',{token:host.token,method:'POST',data:{}})).status,410);
      assert.ok(await db.prepare('SELECT code FROM rooms WHERE code=?').bind(host.code).first());
      assert.equal((await call('/api/admin/activity?q=room.close',{who:'operator'})).value.items.length,1);
    });
    await t.test('dashboard/export/audit are bounded and exclude secrets, recordings and staff lists',async()=>{
      const d=(await call('/api/admin/overview',{who:'operator'})).value;assert.equal(d.sounds.total,23);assert.equal(d.sounds.active,23);assert.ok(d.roomsLast24h>=2);assert.equal(d.season,1);
      const exported=(await call('/api/admin/export',{who:'operator'})).value;assert.equal(exported.format,'mimic-config-v1');assert.equal(exported.catalog.sounds.length,23);
      for(const secret of [host.token,guest.token,'admin@preview.test','operator@preview.test','audioHash','audioKey','ADMIN_EMAILS'])assert.equal(JSON.stringify(exported).includes(secret),false,secret);
      assert.equal((await call('/api/admin/activity?page=-1',{who:'admin'})).status,400);assert.equal((await call('/api/admin/rooms?page=999999',{who:'admin'})).status,400);
      assert.ok((await call('/api/admin/activity',{who:'admin'})).value.items.some(r=>r.action==='staff.revoke'));
    });
  }finally{await mf.dispose();}
});
