import {t,escapeHTML as esc} from './platform.js';
export function soundPicker({catalog,settings,account,getSetup,onChange}){
  let manual=false,chosen=new Set();
  return {
    payload(){return manual?{soundIds:[...chosen]}:{};},
    reset(){manual=false;chosen.clear();},
    render(){
      const setup=getSetup(),allowed=settings.manualSoundSelectionEnabled&&setup.mode!=='ranked'&&setup.matchType!=='solo';if(!allowed){manual=false;chosen.clear();}
      const eligible=catalog.sounds.filter(c=>c.quality?.usable!==false&&c.categoryId===setup.categoryId&&(setup.language==='all'||c.language===setup.language)&&(setup.mode!=='ranked'||c.ranked)&&c.duration<=catalog.rules.recordSeconds);
      const ids=new Set(eligible.map(s=>s.id));chosen=new Set([...chosen].filter(id=>ids.has(id)));
      document.querySelector('#sound-picker-controls')?.remove();document.querySelectorAll('.choose-sound').forEach(el=>el.remove());
      const box=document.createElement('div');box.id='sound-picker-controls';box.className='sound-picker-controls';
      box.innerHTML=`<label for="soundSelection">${esc(t('Kumpulan sound','Sound pool'))}</label><select id="soundSelection" ${!allowed?'disabled':''}><option value="random">${esc(t('Acak dari seluruh kategori','Random from the category'))}</option><option value="manual">${esc(t('Pilih sound sendiri (santai)','Pick sounds (casual)'))}</option></select><p class="small">${esc(setup.matchType==='solo'?t('Solo selalu acak sesuai kategori dan bahasa.','Solo always shuffles sounds from your category and language.'):setup.mode==='ranked'?t('Kompetitif selalu acak.','Ranked always uses random selection.'):t('Host memilih; semua pemain mendapat sound dan urutan yang sama.','The host chooses; everyone gets the same sounds and sequence.'))}</p>`;
      document.querySelector('#selectionInfo').before(box);box.querySelector('select').value=manual?'manual':'random';box.querySelector('select').onchange=e=>{manual=e.target.value==='manual';onChange();};
      if(manual)for(const button of document.querySelectorAll('[data-play]')){
        const id=button.dataset.play,label=document.createElement('label');label.className='check-label choose-sound';
        label.innerHTML=`<input type="checkbox" ${chosen.has(id)?'checked':''}>${esc(t('Masukkan ke room','Include in room'))}`;
        label.querySelector('input').onchange=e=>{if(e.target.checked&&chosen.size>=50){e.target.checked=false;return;}e.target.checked?chosen.add(id):chosen.delete(id);updateButtons();};button.closest('.clip-card').append(label);
      }
      const updateButtons=()=>{
        const count=manual?chosen.size:eligible.length,operator=['owner','admin'].includes(account.user?.role),paused=(!settings.acceptNewRooms||setup.matchType==='solo'&&!settings.allowJoins)&&!operator;
        document.querySelector('#selectionInfo').textContent=t(`${count} sound dipilih · diacak tanpa pengulangan sampai paket habis`,`${count} sounds selected · shuffled without repeats until the pack is exhausted`);
        document.querySelector('#create').disabled=!count||paused||setup.mode==='ranked'&&(!account.user||!catalog.rules.rankedEnabled);
        const join=document.querySelector('#joinForm button');if(join)join.disabled=(!settings.acceptNewRooms||!settings.allowJoins)&&!operator;
      };updateButtons();
    },
  };
}
