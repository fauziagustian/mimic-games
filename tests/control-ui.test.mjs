import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SITE} from '../public/site-config.js';
import {soundPicker} from '../public/sound-picker.js';
import {applyHomeContent,applySiteChrome,loadSite} from '../public/site-ui.js';

class Element {
  nodes=new Map();children=[];dataset={};style={setProperty(){}};firstChild={textContent:''};
  querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
  remove(){this.removed=true;}
  before(node){if(node.id)document.nodes.set('#'+node.id,node);}
  after(node){if(node.id)document.nodes.set('#'+node.id,node);}
  append(node){this.children.push(node);}
  closest(){return this.card;}
}
function environment(){
  globalThis.localStorage={getItem:()=>null};globalThis.location={pathname:'/'};
  globalThis.document=new Element();document.documentElement=new Element();document.createElement=()=>new Element();document.querySelectorAll=()=>[];
  return document;
}
test('plain-text website content is escaped, colors are allowlisted, and a failed config fetch can retry',async()=>{
  const doc=environment(),settings={...DEFAULT_SITE,brandName:'<img src=x>',heroTitleId:'<script>bad</script>\n& hello',heroDescriptionId:'<b>plain text</b>',announcementEnabled:true,announcementId:'<svg onload=bad>',helpUrl:'https://example.test/?a=1&b=2'};
  applyHomeContent({settings});const entry=doc.querySelector('.entry-card');assert.match(entry.querySelector('h1').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(entry.querySelector('h1').innerHTML,/<script>/);assert.equal(entry.querySelector('p').textContent,settings.heroDescriptionId);
  let color;doc.documentElement.style.setProperty=(key,value)=>{assert.equal(key,'--orange');color=value;};applySiteChrome({settings});assert.equal(color,'#ff6038');assert.equal(doc.querySelector('.brand').firstChild.textContent,settings.brandName);assert.match(doc.querySelector('#site-notices').innerHTML,/&lt;svg/);assert.doesNotMatch(doc.querySelector('#site-notices').innerHTML,/<svg/);
  let attempts=0;globalThis.fetch=async()=>{attempts++;if(attempts===1)throw new Error('offline');return Response.json({settings:DEFAULT_SITE,revision:0});};
  await assert.rejects(loadSite(),/offline/);assert.equal((await loadSite()).revision,0);assert.equal(attempts,2);
});
test('sound picker: explicit pool, shared eligibility filters, maintenance UI and ranked reset (DOM doubles)',()=>{
  const doc=environment(),buttons=['a','b'].map(id=>{const button=new Element();button.dataset.play=id;button.card=new Element();return button;});
  doc.querySelectorAll=selector=>selector==='[data-play]'?buttons:buttons.flatMap(b=>b.card.children).filter(x=>!x.removed);
  let setup={categoryId:'drama',language:'all',mode:'casual'};const settings={...DEFAULT_SITE},account={user:null};
  const catalog={rules:{recordSeconds:15,rankedEnabled:true},sounds:[{id:'a',categoryId:'drama',language:'indonesian',ranked:true,duration:2},{id:'b',categoryId:'drama',language:'english',ranked:true,duration:2}]};
  let picker;picker=soundPicker({catalog,settings,account,getSetup:()=>setup,onChange:()=>picker.render()});picker.render();assert.equal(doc.querySelector('#create').disabled,false);assert.deepEqual(picker.payload(),{});
  doc.querySelector('#sound-picker-controls').querySelector('select').onchange({target:{value:'manual'}});assert.deepEqual(picker.payload(),{soundIds:[]});assert.equal(doc.querySelector('#create').disabled,true);
  buttons[0].card.children.at(-1).querySelector('input').onchange({target:{checked:true}});assert.deepEqual(picker.payload(),{soundIds:['a']});assert.equal(doc.querySelector('#create').disabled,false);
  setup.language='english';picker.render();assert.deepEqual(picker.payload(),{soundIds:[]});
  setup.mode='ranked';picker.render();assert.deepEqual(picker.payload(),{});assert.equal(doc.querySelector('#create').disabled,true);
  account.user={role:'player'};picker.render();assert.equal(doc.querySelector('#create').disabled,false);
  settings.acceptNewRooms=false;picker.render();assert.equal(doc.querySelector('#create').disabled,true);assert.equal(doc.querySelector('#joinForm button').disabled,true);
  account.user.role='owner';picker.render();assert.equal(doc.querySelector('#create').disabled,false);
  account.user=null;settings.acceptNewRooms=true;setup.mode='casual';setup.matchType='solo';picker.render();
  assert.deepEqual(picker.payload(),{});assert.match(doc.querySelector('#sound-picker-controls').innerHTML,/id="soundSelection" disabled/);
  settings.allowJoins=false;picker.render();assert.equal(doc.querySelector('#create').disabled,true,'solo also respects the join pause');
  setup.matchType='custom';picker.render();assert.equal(doc.querySelector('#create').disabled,false,'creating custom is allowed while joins alone are paused');
});
