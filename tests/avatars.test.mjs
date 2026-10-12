import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {AVATARS,avatarById,isAvatar,visualPose} from '../public/avatars.js';
import {createStageScene,seatPosition,disposeObject} from '../client/stage-scene.js';
import {runtime} from '../scripts/runtime.mjs';

test('avatar allowlist, legacy fallback and server-timed animation phases',()=>{
  assert.equal(AVATARS.length,12);assert.equal(new Set(AVATARS.map(a=>a.id)).size,12);
  assert.equal(avatarById('https://evil.test/model.glb').id,'male-a');assert.equal(isAvatar('../x'),false);
  const p={id:'a',total:50},other={id:'b',total:50};
  assert.equal(visualPose(null,p),'idle');assert.equal(visualPose({phase:'lobby'},{...p,ready:true}),'emote-yes');
  assert.equal(visualPose({phase:'listen',recordAt:100},p,99),'idle');assert.equal(visualPose({phase:'listen',recordAt:100},p,100),'interact-right');
  assert.equal(visualPose({phase:'record'},p),'interact-right');assert.equal(visualPose({phase:'collect'},p),'idle');
  for(const [reaction,pose] of [['roast','emote-no'],['applause','emote-yes'],['perfect','jump']]){
    const room={phase:'reveal',revealAt:1000,recordSeconds:5,revealIndex:0,results:[{playerId:'a',reaction}]};
    assert.equal(visualPose(room,p,999),'idle');assert.equal(visualPose(room,p,1000),'interact-right');assert.equal(visualPose(room,p,6000),pose);assert.equal(visualPose(room,other,6000),'idle');
    assert.equal(visualPose({...room,phase:'results'},p),pose);assert.equal(visualPose({...room,phase:'results'},other),'idle');
  }
  assert.equal(visualPose({phase:'finished',players:[p,other]},p),'jump');
  assert.equal(visualPose({phase:'finished',players:[p,{...other,total:100}]},p),'emote-yes');
});

test('all 12 actual GLBs load, have playable rigs and clone independent skeletons',async()=>{
  // No GPU/browser assertions: textures are checked separately as actual PNG files.
  globalThis.self=globalThis;
  const loader=new GLTFLoader();loader.register(()=>({name:'offline-texture-placeholder',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
  let totalBytes=0;
  for(const avatar of AVATARS){
    const bytes=await readFile('public'+avatar.model);totalBytes+=bytes.length;
    assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert.equal(json.images[0].uri,'Textures/colormap.png');assert.equal(json.skins.length,2);
    const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    assert.equal(gltf.animations.length,32);
    const first=clone(gltf.scene),second=clone(gltf.scene),skins=[];first.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});
    for(const skin of skins){const other=second.getObjectByName(skin.name);assert.notEqual(skin.skeleton,other.skeleton);assert.notEqual(skin.skeleton.bones[0],other.skeleton.bones[0]);}
    const mixer=new THREE.AnimationMixer(first);
    for(const name of ['idle','emote-yes','emote-no','jump','interact-right']){
      const clip=gltf.animations.find(c=>c.name===name);assert.ok(clip,avatar.id+': '+name);
      mixer.stopAllAction();mixer.clipAction(clip).reset().play();mixer.setTime(.2);first.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(first,true),size=box.getSize(new THREE.Vector3());assert.ok(size.y>.1&&size.y<2);assert.ok(size.toArray().every(Number.isFinite));
      first.traverse(o=>assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
    }
    mixer.stopAllAction();mixer.uncacheRoot(first);disposeObject(gltf.scene);
    const png=await readFile('public'+avatar.thumbnail);assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
  }
  assert.ok(totalBytes<3.3*1024*1024);const texture=await readFile('public/models/kenney/Textures/colormap.png');assert.equal(texture.toString('hex',0,8),'89504e470d0a1a0a');
  assert.match(await readFile('public/models/kenney/License.txt','utf8'),/CC0/);
});

test('stage supports 1–8 separated seats, bounded geometry and disposal',()=>{
  for(let n=1;n<=8;n++){const seats=Array.from({length:n},(_,i)=>seatPosition(i,n));assert.equal(new Set(seats.map(JSON.stringify)).size,n);for(const [x,y,z] of seats){assert.ok(Math.abs(x)<5);assert.equal(y,0);assert.ok(Math.abs(z)<3);}}
  const {scene,camera}=createStageScene();assert.ok(camera.isOrthographicCamera);
  let meshes=0,triangles=0;scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
  assert.ok(meshes<90);assert.ok(triangles<15000);const seen=disposeObject(scene);assert.ok(seen.size>5);
});

test('Worker synchronizes avatar choices, rejects untrusted URLs and locks avatars in battle',async()=>{
  const mf=await runtime();const origin='https://mimic.test';
  const call=async(path,token,data)=>{const r=await mf.dispatchFetch(origin+path,{method:data?'POST':'GET',headers:{Origin:origin,...(token?{'X-Room-Token':token}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,value:await r.json()};};
  try{
    const settings={capacity:3,name:'Host',categoryId:'drama',language:'all',mode:'casual'};
    assert.equal((await call('/api/rooms',null,{...settings,avatarId:'https://evil.test/a.glb'})).status,400);
    const host=(await call('/api/rooms',null,{...settings,avatarId:'female-e'})).value,base='/api/rooms/'+host.code;
    assert.equal((await call(base+'/join',null,{name:'Invalid',avatarId:'../x'})).status,400);
    const guest=(await call(base+'/join',null,{name:'Guest',avatarId:'male-f'})).value;
    const legacy=(await call(base+'/join',null,{name:'Legacy'})).value;
    let room=(await call(base,host.token)).value;assert.deepEqual(room.players.map(p=>p.avatarId),['female-e','male-f','male-a']);
    assert.equal((await call(base+'/avatar',null,{avatarId:'male-b'})).status,401);
    assert.equal((await call(base+'/avatar','0'.repeat(64),{avatarId:'male-b'})).status,403);
    assert.equal((await call(base+'/avatar',guest.token,{avatarId:null})).status,400);
    assert.equal((await call(base+'/avatar',guest.token,{avatarId:'female-c',playerId:room.me})).status,200);
    room=(await call(base,host.token)).value;assert.deepEqual(room.players.map(p=>p.avatarId),['female-e','female-c','male-a']);
    assert.deepEqual((await call(base,guest.token)).value.players,room.players);
    const revision=room.revision;await call(base+'/avatar',guest.token,{avatarId:'female-c'});assert.equal((await call(base,host.token)).value.revision,revision);
    for(const p of [host,guest,legacy])assert.equal((await call(base+'/ready',p.token,{})).status,200);
    assert.equal((await call(base+'/start',host.token,{})).status,200);
    assert.equal((await call(base+'/avatar',guest.token,{avatarId:'male-a'})).status,409);
    assert.deepEqual((await call(base,guest.token)).value.players.map(p=>p.avatarId),['female-e','female-c','male-a']);
    for(const path of ['/models/kenney/character-male-a.glb','/models/kenney/Textures/colormap.png','/models/kenney/previews/character-female-f.png','/stage-3d.js','/avatar-ui.js','/avatars.css']){
      const r=await mf.dispatchFetch(origin+path);assert.equal(r.status,200,path);const bytes=new Uint8Array(await r.arrayBuffer());assert.ok(bytes.length>20);
      if(path.endsWith('.glb')){assert.match(r.headers.get('content-type'),/model\/gltf-binary/);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'glTF');}
      if(path.endsWith('.png'))assert.match(r.headers.get('content-type'),/image\/png/);
    }
    assert.equal((await mf.dispatchFetch(origin+'/models/kenney/../../server/index.js')).status,404);
  }finally{await mf.dispose();}
});
