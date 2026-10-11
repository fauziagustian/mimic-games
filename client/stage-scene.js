import * as THREE from 'three';

export function seatPosition(index,count){
  if(count<=3)return [[0,0,0.8],[-2.25,0,-0.4],[2.25,0,-0.4]][index]||[0,0,0];
  const columns=Math.min(4,count),row=Math.floor(index/4),inRow=Math.min(columns,count-row*4);
  return [(index%4-(inRow-1)/2)*2.15,0,row?1.6:-1.3];
}
export function createStageScene(){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#dfdfce');
  const decor=new THREE.Group();scene.add(decor);
  const material=color=>new THREE.MeshStandardMaterial({color,roughness:.85});
  const ink=material('#193a35'),wood=material('#bc8a64'),cream=material('#f2e4cd'),orange=material('#ff6038'),green=material('#d2eb61');
  const cube=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(1,1,1,24);
  function box(x,y,z,w,h,d,mat){const m=new THREE.Mesh(cube,mat);m.position.set(x,y,z);m.scale.set(w,h,d);decor.add(m);return m;}
  function disk(x,y,z,r,h,mat){const m=new THREE.Mesh(cylinder,mat);m.position.set(x,y,z);m.scale.set(r,h,r);decor.add(m);return m;}
  box(0,-.26,0,11.5,.5,7.5,ink);box(0,0,0,11.35,.06,7.35,wood);
  for(let i=0;i<12;i++)box(-5.2+i*.94,.035,0,.016,.012,7.3,cream);
  box(0,1.65,-3.66,11.4,3.35,.15,ink);box(-5.6,1.1,-1.4,.15,2.25,4.5,ink);
  // Original geometric scenery; third-party props are not published without license confirmation.
  box(0,2.15,-3.5,4.3,1.12,.1,orange);box(0,2.15,-3.43,3.85,.75,.04,cream);
  for(let i=0;i<15;i++)box(-1.55+i*.22,2.15,-3.39,.095,.16+Math.abs(Math.sin(i*1.1))*.43,.03,ink);
  for(const x of [-4.6,4.6]){
    box(x,1.13,-3.37,.65,2.15,.45,ink);
    for(const y of [.7,1.5]){const speaker=disk(x,y,-3.1,.23,.06,cream);speaker.rotation.x=Math.PI/2;}
    disk(x,2.8,-2.9,.34,.12,orange);
  }
  const leafGeo=new THREE.IcosahedronGeometry(1,0),leaf=material('#648755'),pot=material('#e8c1a0');
  for(const x of [-4.8,4.8]){
    disk(x,.24,1.65,.29,.48,pot);
    for(let i=0;i<5;i++){const mesh=new THREE.Mesh(leafGeo,leaf);mesh.position.set(x+Math.sin(i*2)*.19,.75+i*.11,1.65+Math.cos(i*2)*.18);mesh.scale.set(.22,.43,.17);mesh.rotation.z=Math.sin(i)*.7;decor.add(mesh);}
  }
  disk(0,.06,.2,3.2,.045,cream);disk(0,.09,.2,2.9,.045,green);
  // Microphone prop built from primitive geometry, not the supplied high-poly model.
  disk(0,.09,2.6,.27,.08,ink);box(0,.69,2.6,.035,1.2,.035,ink);
  const mic=new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),ink);mic.scale.set(.8,1.5,.8);mic.position.set(0,1.35,2.6);decor.add(mic);
  const ambient=new THREE.HemisphereLight('#fff5e4','#7a6754',2.7);scene.add(ambient);
  const sun=new THREE.DirectionalLight('#fff6e8',3.1);sun.position.set(3,8,6);scene.add(sun);
  const rim=new THREE.DirectionalLight('#d2eb61',1.2);rim.position.set(-4,4,-4);scene.add(rim);
  const camera=new THREE.OrthographicCamera(-7,7,4,-4,.1,100);camera.position.set(7.5,8.6,14);camera.lookAt(0,.65,0);
  return {scene,camera,decor,green,ink};
}

export function disposeObject(root,seen=new Set()){
  root.traverse(object=>{
    const dispose=value=>{if(value&&!seen.has(value)){seen.add(value);value.dispose?.();if(value.isTexture)value.source?.data?.close?.();}};
    dispose(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){for(const value of Object.values(material))if(value?.isTexture)dispose(value);dispose(material);}
    // Skeleton clones share meshes/materials, but own GPU bone textures.
    if(object.skeleton?.boneTexture)dispose(object.skeleton.boneTexture);
  });return seen;
}
