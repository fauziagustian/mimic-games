import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {avatarById,visualPose} from '../public/avatars.js';
import {createStageScene,seatPosition,disposeObject} from './stage-scene.js';

export function createStage(canvas,{labels,onError=()=>{},onLoaded=()=>{},reducedMotion=false}={}){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  const {scene,camera}=createStageScene(),loader=new GLTFLoader(),actors=new Map(),assets=new Map();
  let disposed=false,frame=0,last=0,width=0,height=0,visible=true,room=null,players=[],offset=0;
  const colors=['#ff6038','#d2eb61','#efbadc','#8ac9e8','#ffe79f','#bbadf2','#71cbb6','#e89272'];
  const flakes=new THREE.InstancedMesh(new THREE.BoxGeometry(.055,.024,.055),new THREE.MeshBasicMaterial(),36),dummy=new THREE.Object3D();
  flakes.visible=false;for(let i=0;i<36;i++)flakes.setColorAt(i,new THREE.Color(colors[i%colors.length]));scene.add(flakes);
  async function asset(id){
    if(!assets.has(id)){
      const task=loader.loadAsync(avatarById(id).model).then(gltf=>{if(disposed){disposeObject(gltf.scene);throw new Error('disposed');}return gltf;}).catch(e=>{assets.delete(id);throw e;});assets.set(id,task);
    }
    return assets.get(id);
  }
  function remove(actor){actor.removed=true;actor.mixer?.stopAllAction();if(actor.model)actor.mixer?.uncacheRoot(actor.model);actor.group.traverse(o=>o.skeleton?.dispose());actor.ring.geometry.dispose();actor.ring.material.dispose();scene.remove(actor.group);actor.label?.remove();}
  async function add(player,index){
    const group=new THREE.Group(),ring=new THREE.Mesh(new THREE.CylinderGeometry(.67,.67,.045,24),new THREE.MeshStandardMaterial({color:colors[index%8],roughness:1}));ring.position.y=.075;group.add(ring);scene.add(group);
    const label=document.createElement('span');label.className='stage-name';label.textContent=player.name;labels.append(label);
    const actor={id:player.id,avatarId:avatarById(player.avatarId).id,group,ring,label,removed:false,model:null,mixer:null,pose:null,index};actors.set(player.id,actor);
    const pos=seatPosition(index,players.length);group.position.set(...pos);
    try{
      const gltf=await asset(actor.avatarId);if(disposed||actor.removed)return;
      const model=clone(gltf.scene),mixer=new THREE.AnimationMixer(model),box=new THREE.Box3().setFromObject(model,true),size=box.getSize(new THREE.Vector3());
      const scale=1.5/Math.max(.01,size.y);model.scale.setScalar(scale);model.position.set(-(box.min.x+box.max.x)*scale/2,.11-box.min.y*scale,-(box.min.z+box.max.z)*scale/2);model.rotation.y=.28;
      model.traverse(o=>{if(o.isMesh){o.frustumCulled=false;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.roughness=1;m.metalness=0;}}});
      group.add(model);Object.assign(actor,{model,mixer,clips:gltf.animations});onLoaded();
    }catch(e){if(disposed||actor.removed)return;actor.label.textContent=player.name+' · 2D';onError(e);}
  }
  function update(state){
    if(disposed)return;room=state.room;players=state.players||[];offset=state.offset||0;
    const wanted=new Set(players.map(p=>p.id));for(const [id,actor] of actors)if(!wanted.has(id)){remove(actor);actors.delete(id);}
    players.forEach((p,i)=>{
      let actor=actors.get(p.id);if(actor&&actor.avatarId!==avatarById(p.avatarId).id){remove(actor);actors.delete(p.id);actor=null;}
      if(!actor){add(p,i);return;}actor.index=i;actor.group.position.set(...seatPosition(i,players.length));actor.label.textContent=p.name;
    });
  }
  function resize(){
    if(disposed)return;const rect=canvas.parentElement.getBoundingClientRect();if(!rect.width||!rect.height)return;
    width=rect.width;height=rect.height;renderer.setSize(width,height,false);
    const aspect=width/height,vertical=Math.max(4.4,7.15/aspect);camera.left=-vertical*aspect;camera.right=vertical*aspect;camera.top=vertical;camera.bottom=-vertical;camera.updateProjectionMatrix();
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas.parentElement);
  const intersection=globalThis.IntersectionObserver?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}):null;intersection?.observe(canvas.parentElement);
  const contextLost=e=>{e.preventDefault();if(!disposed)onError(new Error('WebGL context lost'));};canvas.addEventListener('webglcontextlost',contextLost);
  function animate(time){
    if(disposed)return;frame=requestAnimationFrame(animate);if(!visible||document.hidden||time-last<(reducedMotion?200:1000/30))return;
    const dt=Math.min(.08,(time-last)/1000);last=time;if(!width||!height)resize();
    const now=Date.now()+offset,result=room?.results?.[room.revealIndex],celebrating=room?.phase==='reveal'&&result?.reaction==='perfect'&&now>=room.revealAt+(room.recordSeconds||5)*1000;
    for(const player of players){const actor=actors.get(player.id);if(!actor)continue;
      const pose=visualPose(room,player,now),active=room?.turnMode==='sequential-v1'?room.activePlayerId===player.id:room?.phase==='reveal'&&result?.playerId===player.id;
      actor.label.classList.toggle('active',active);actor.ring.material.emissive.set(active?'#6c551b':'#000000');
      if(actor.mixer){if(actor.pose!==pose){const clip=actor.clips.find(c=>c.name===pose)||actor.clips.find(c=>c.name==='idle');const next=actor.mixer.clipAction(clip);next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();if(actor.action&&actor.action!==next)actor.action.crossFadeTo(next,.18,true);actor.action=next;actor.pose=pose;if(reducedMotion)actor.mixer.setTime(.12);}
        if(!reducedMotion)actor.mixer.update(dt);
      }
      const point=actor.group.position.clone().add(new THREE.Vector3(0,2.03,0)).project(camera);actor.label.style.transform=`translate(-50%,-100%) translate(${(point.x*.5+.5)*width}px,${(-point.y*.5+.5)*height}px)`;
    }
    flakes.visible=celebrating&&!reducedMotion;
    if(flakes.visible){for(let i=0;i<36;i++){dummy.position.set(Math.sin(i*4.7)*4,3.8-((now/1000*.9+i*.11)%3.7),Math.cos(i*3.3)*2);dummy.rotation.set(now/600+i,i,now/800);dummy.updateMatrix();flakes.setMatrixAt(i,dummy.matrix);}flakes.instanceMatrix.needsUpdate=true;}
    renderer.render(scene,camera);
  }
  resize();frame=requestAnimationFrame(animate);
  return {update,resize,dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);resizeObserver.disconnect();intersection?.disconnect();canvas.removeEventListener('webglcontextlost',contextLost);for(const actor of actors.values())remove(actor);actors.clear();labels.replaceChildren();const seen=disposeObject(scene);for(const promise of assets.values())promise.then(g=>disposeObject(g.scene,seen)).catch(()=>{});assets.clear();renderer.dispose();renderer.forceContextLoss();}};
}
