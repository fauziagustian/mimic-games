import {AVATARS,avatarById} from './avatars.js';
import {t,escapeHTML as esc} from './platform.js';

const read=(key)=>{try{return localStorage.getItem(key);}catch{return null;}};
const remember=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
export const preferredAvatar=()=>avatarById(read('mimic-avatar')).id;
export const avatarImage=(id,cls='')=>`<img class="${cls}" src="${avatarById(id).thumbnail}" width="64" height="64" alt="" decoding="async">`;
const style=document.createElement('link');style.rel='stylesheet';style.href='/avatars.css';document.head.append(style);

// The canvas is moved, not recreated, when the room UI updates.
export function avatarStage({loadStage=()=>import('/stage-3d.js')}={}){
  const root=document.createElement('section');root.className='avatar-stage';
  root.innerHTML='<div class="avatar-heading"><div><span class="eyebrow">MIMIC / THE LIVING ROOM</span><h2></h2></div><button class="view-toggle" type="button"></button></div><div class="avatar-viewport"><canvas role="img"></canvas><div class="stage-labels" aria-hidden="true"></div><div class="avatar-fallback"></div><span class="stage-stamp">MAKE SOME NOISE.</span></div><div class="avatar-footer"><span class="avatar-status" role="status"></span><span>KENNEY · CC0</span></div><div class="avatar-picker"><div class="picker-heading"></div><div class="avatar-options"></div></div>';
  const q=s=>root.querySelector(s),toggle=q('.view-toggle'),fallback=q('.avatar-fallback');
  let canvas=q('canvas');
  let enabled=read('mimic-3d')!==null?read('mimic-3d')==='on':!navigator.connection?.saveData;
  let engine=null,loading=false,error=false,loaded=false,generation=0,state={},selecting=false,dead=false;
  const phaseTitle=()=>!state.room?t('Pilih teman satu panggung.','Meet your stage crew.'):state.room.phase==='lobby'?t('Ruang kumpul gengmu.','Your crew, backstage.'):state.room.phase==='finished'?t('Satu panggung. Banyak legenda.','One stage. Many legends.'):state.room.phase==='record'?t('Giliran kalian bersuara!','Time to make some noise!'):state.room.phase==='reveal'?t('Semua mata ke panggung.','All eyes on the stage.'):t('Dengarkan. Tirukan. Rayakan.','Listen. Mimic. Celebrate.');
  function status(){
    const use3d=enabled&&!error;
    root.classList.toggle('is-3d',use3d&&loaded);
    canvas.hidden=!use3d;fallback.hidden=use3d&&loaded;
    canvas.setAttribute('aria-label',t('Ruang 3D berisi avatar pemain; daftar pemain dan skor tersedia di bawah.','3D room with player avatars; player names and scores are also listed below.'));
    toggle.textContent=enabled&&!error?t('Mode 2D','Use 2D'):error?t('Coba 3D','Retry 3D'):t('Mode 3D','Use 3D');
    toggle.setAttribute('aria-pressed',String(use3d));toggle.setAttribute('aria-label',use3d?t('Beralih ke tampilan 2D','Switch to 2D view'):t('Beralih ke tampilan 3D','Switch to 3D view'));
    q('.avatar-status').textContent=error?t('3D tidak tersedia. Game tetap berjalan dalam 2D.','3D unavailable. The game still works in 2D.'):!enabled?t('Mode ringan · semua fitur permainan tetap aktif','Lightweight view · all game features remain active'):loaded?t('Avatar tersinkron dengan room · tanpa lip-sync','Room-synced avatars · no lip-sync'):t('Memuat panggung 3D…','Loading the 3D stage…');
  }
  function stop(){generation++;engine?.dispose();engine=null;loading=false;loaded=false;const fresh=canvas.cloneNode(false);canvas.replaceWith(fresh);canvas=fresh;}
  async function start(){
    if(!enabled||error||engine||loading||dead)return;
    loading=true;const version=++generation;status();
    try{
      const {createStage}=await loadStage();
      if(version!==generation||dead)return;
      engine=createStage(canvas,{labels:q('.stage-labels'),reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
        onLoaded:()=>{if(version!==generation)return;loaded=true;status();},
        onError:()=>{if(version!==generation)return;error=true;stop();status();},
      });
      engine.update(state);
    }catch{if(version===generation){error=true;stop();status();}}
    finally{if(version===generation)loading=false;}
  }
  function draw(){
    q('h2').textContent=phaseTitle();
    q('.avatar-picker').hidden=state.showPicker===false;
    fallback.innerHTML=(state.players||[]).map(p=>`<div class="fallback-player">${avatarImage(p.avatarId)}<b>${esc(p.name)}</b><span>${p.ready?'✓ ':''}${state.room?`${p.total||0} pts`:esc(t('Pratinjau','Preview'))}</span></div>`).join('');
    const own=state.room?.players.find(p=>p.id===state.room.me),selected=avatarById(own?.avatarId||preferredAvatar()),locked=selecting||state.room&&state.room.phase!=='lobby';
    q('.picker-heading').innerHTML=`<b>${esc(t('Karakter kamu','Your character'))} <span>· ${esc(selected.name)}</span></b><span>${esc(locked&&!selecting?t('Terkunci selama battle','Locked during battle'):t('12 karakter · pilih favoritmu','12 characters · pick your favorite'))}</span>`;
    q('.avatar-options').innerHTML=AVATARS.map(a=>`<button type="button" class="avatar-option" data-avatar="${a.id}" aria-label="${esc(t('Pilih','Choose'))} ${a.name}" aria-pressed="${a.id===selected.id}" ${locked?'disabled':''}>${avatarImage(a.id)}<span>${a.name}</span></button>`).join('');
    q('.avatar-options').onclick=async e=>{
      const button=e.target.closest('[data-avatar]');if(!button||button.disabled||selecting||state.showPicker===false)return;
      const id=button.dataset.avatar;selecting=true;draw();
      try{await state.onSelect?.(id);remember('mimic-avatar',id);if(!state.room){state.players[0].avatarId=id;engine?.update(state);}}
      catch(e){state.onError?.(e);}
      finally{selecting=false;draw();q(`[data-avatar="${id}"]`)?.focus({preventScroll:true});}
    };status();
  }
  toggle.onclick=()=>{enabled=!(enabled&&!error);error=false;remember('mimic-3d',enabled?'on':'off');stop();status();if(enabled)start();};
  return {
    detach(){root.remove();},
    mount(target,next){if(dead)return;state=next;target.prepend(root);draw();engine?.update(state);engine?.resize();start();},
    sync(next){state={...state,...next};engine?.update(state);},
    dispose(){dead=true;stop();root.remove();},
  };
}
