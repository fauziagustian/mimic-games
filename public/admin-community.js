import {api,t,escapeHTML as esc,categoryName} from './platform.js';
const tr=(id,en)=>esc(t(id,en));
export function mountCommunityReview(root,catalog,onChange){
  let generation=0,page=0;
  root.innerHTML=`<h2>${tr('Moderasi sound komunitas','Community sound review')}</h2><p>${tr('Dengarkan seluruh cuplikan. Periksa transkrip, kategori, izin penggunaan, dan keamanan kontennya. Persetujuan menerbitkan sound untuk mode santai, bukan langsung kompetitif.','Listen to the full clip. Check its transcript, category, usage permission and content safety. Approval publishes the sound for casual play, not ranked play.')}</p><div class="toolbar"><div><label for="ugcStatus">Status</label><select id="ugcStatus"><option value="pending">${tr('Menunggu · terlama dulu','Pending · oldest first')}</option><option value="approved">${tr('Disetujui','Approved')}</option><option value="rejected">${tr('Ditolak','Rejected')}</option><option value="withdrawn">${tr('Ditarik kreator','Withdrawn by creator')}</option></select></div></div><div class="ugc-review-grid" id="ugcReviews"></div><button class="button light community-pagination" id="ugcMore" hidden>${tr('Muat lagi','Load more')}</button><p id="ugcMessage" role="status" class="form-status"></p>`;
  const $=selector=>root.querySelector(selector);
  async function load(more=false){
    const seq=++generation,filter=$('#ugcStatus').value,button=$('#ugcMore');button.disabled=true;$('#ugcMessage').textContent=t('Memuat…','Loading…');
    if(!more){page=0;button.hidden=true;$('#ugcReviews').innerHTML='';}
    try{const r=await api('/admin/community?'+new URLSearchParams({status:filter,page}));if(!root.isConnected||seq!==generation)return;
      if(!r.items.length&&!more)$('#ugcReviews').innerHTML=`<div class="empty">${tr('Tidak ada kiriman pada status ini.','No submissions with this status.')}</div>`;
      else $('#ugcReviews').insertAdjacentHTML('beforeend',r.items.map(s=>`<form class="review-card" data-ugc="${esc(s.id)}"><span class="tag">UGC · ${esc(s.language)}</span><h3>${esc(s.title)}</h3><p class="small">${tr('Kreator','Creator')}: ${esc(s.creatorName)} · ${s.duration.toFixed(1)}s<br>${esc(categoryName(catalog.categories.find(c=>c.id===s.categoryId))||s.categoryId)} · ${new Date(s.createdAt).toLocaleString()}</p><audio controls preload="none" src="${esc(s.url)}" aria-label="${esc(s.title)}"></audio><p><b>${tr('Transkrip','Transcript')}</b><br>${esc(s.text)}</p><p class="small"><b>${tr('Sumber','Source')}</b><br>${esc(s.source)}</p><p class="small"><b>${tr('Izin penggunaan','Permission to use')}</b><br>${esc(s.rights)}</p>${s.status==='pending'?`<label class="check-label"><input type="checkbox" name="checked"><span>${tr('Audio, transkrip, izin, dan keamanan konten sudah saya periksa.','I checked the audio, transcript, permission and content safety.')}</span></label><label>${tr('Catatan untuk kreator (wajib jika ditolak)','Note to creator (required when rejecting)')}<textarea name="note" maxlength="400" rows="2"></textarea></label><button class="button green" name="decision" value="approved">${tr('Setujui untuk santai','Approve for casual')}</button><button class="button light" name="decision" value="rejected">${tr('Tolak','Reject')}</button>`:`${s.note?`<p class="community-note">${esc(s.note)}</p>`:''}${s.status==='approved'?`<p class="small">${s.active?tr('Aktif','Active'):tr('Nonaktif','Inactive')} · ${s.ranked?'Ranked':tr('Santai saja','Casual only')}</p><a class="button light" href="/admin?tab=sounds&sound=${encodeURIComponent(s.soundId)}">${tr('Kelola publikasi / kompetitif','Manage visibility / ranked')}</a>`:''}`}<p class="form-status" role="status"></p></form>`).join(''));
      page=r.nextPage;button.hidden=page===null;$('#ugcMessage').textContent='';
      root.querySelectorAll('[data-ugc]').forEach(form=>form.onsubmit=async e=>{
        e.preventDefault();const output=form.querySelector('.form-status'),status=e.submitter.value;
        form.querySelectorAll('button').forEach(b=>b.disabled=true);output.textContent=t('Memproses…','Processing…');
        try{await api('/admin/community/'+form.dataset.ugc+'/review',{method:'POST',body:{status,checked:form.elements.checked.checked,note:form.elements.note.value}});await onChange();if(root.isConnected)await load();}
        catch(err){output.textContent=err.message;output.classList.add('error');form.querySelectorAll('button').forEach(b=>b.disabled=false);}
      });
    }catch(e){if(root.isConnected&&seq===generation)$('#ugcMessage').textContent=e.message;}
    finally{if(root.isConnected&&seq===generation)button.disabled=false;}
  }
  $('#ugcStatus').onchange=()=>load();$('#ugcMore').onclick=()=>load(true);load();
}
