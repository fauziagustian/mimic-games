import {test} from 'node:test';
import assert from 'node:assert/strict';

// A small DOM test double, not a browser/WebGL renderer.
class Element {
  constructor(){this.nodes=new Map();this.attributes={};this.classes=new Set();this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
  querySelector(selector){if(!this.nodes.has(selector)){const child=new Element();child.owner=this;child.selector=selector;this.nodes.set(selector,child);}return this.nodes.get(selector);}
  setAttribute(k,v){this.attributes[k]=v;}
  append(child){this.child=child;child.parent=this;}
  prepend(child){this.append(child);}
  remove(){if(this.parent?.child===this)this.parent.child=null;}
  cloneNode(){const node=new Element();node.attributes={...this.attributes};return node;}
  replaceWith(node){node.owner=this.owner;node.selector=this.selector;this.owner.nodes.set(this.selector,node);}
  focus(){}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('avatar UI: persistent canvas, safe restart, 2D fallback, lazy loading and selection',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
  globalThis.document={head:new Element(),createElement:()=>new Element()};
  Object.defineProperty(globalThis,'navigator',{value:{connection:{saveData:false}},configurable:true});
  globalThis.matchMedia=()=>({matches:false});
  const {avatarStage,preferredAvatar}=await import('../public/avatar-ui.js');
  let made=0,disposed=0,updated=0,lastCanvas,callbacks;
  const module={createStage(canvas,options){made++;lastCanvas=canvas;callbacks=options;return{update(){updated++;},resize(){},dispose(){disposed++;}};}};
  const controller=avatarStage({loadStage:async()=>module}),target=new Element(),state={room:null,players:[{id:'a',name:'<script>x</script>',avatarId:'male-a'}]};
  controller.mount(target,state);await settle();const root=target.child,canvas=lastCanvas;assert.equal(made,1);
  assert.match(root.querySelector('.avatar-fallback').innerHTML,/&lt;script&gt;/);
  callbacks.onLoaded();assert.equal(root.classes.has('is-3d'),true);
  controller.detach();controller.mount(target,state);controller.sync({offset:7});await settle();assert.equal(target.child,root);assert.equal(made,1);assert.equal(lastCanvas,canvas);assert.ok(updated>=3);
  root.querySelector('.view-toggle').onclick();assert.equal(disposed,1);assert.equal(root.classes.has('is-3d'),false);assert.equal(storage.get('mimic-3d'),'off');
  root.querySelector('.view-toggle').onclick();await settle();assert.equal(made,2);assert.notEqual(lastCanvas,canvas);
  callbacks.onError(new Error('context lost'));assert.equal(disposed,2);assert.match(root.querySelector('.avatar-status').textContent,/2D/);
  root.querySelector('.view-toggle').onclick();await settle();assert.equal(made,3);
  const button={dataset:{avatar:'female-f'},disabled:false};
  await root.querySelector('.avatar-options').onclick({target:{closest:()=>button}});assert.equal(preferredAvatar(),'female-f');assert.equal(state.players[0].avatarId,'female-f');
  const room={phase:'record',me:'a',players:state.players};controller.mount(target,{...state,room});assert.match(root.querySelector('.avatar-options').innerHTML,/disabled/);
  controller.dispose();assert.equal(disposed,3);assert.equal(target.child,null);
  let resolve;storage.set('mimic-3d','on');const pending=avatarStage({loadStage:()=>new Promise(r=>resolve=r)});pending.mount(target,state);target.child.querySelector('.view-toggle').onclick();resolve(module);await settle();assert.equal(made,3);pending.dispose();
  storage.delete('mimic-3d');navigator.connection.saveData=true;const saver=avatarStage({loadStage:async()=>module});saver.mount(target,state);await settle();assert.equal(made,3);assert.match(target.child.querySelector('.avatar-status').textContent,/ringan/);saver.dispose();
});
