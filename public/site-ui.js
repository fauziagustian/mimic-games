import {DEFAULT_SITE,ACCENTS} from './site-config.js';
import {api,t,uiLanguage,escapeHTML as esc} from './platform.js';
let pending;
export function loadSite(){return pending??=api('/site').catch(e=>{pending=null;throw e;});}
export const localized=(s,key)=>s[key+(uiLanguage()==='en'?'En':'Id')];
export function applySiteChrome(config){
  const s={...DEFAULT_SITE,...config.settings};
  document.documentElement.style.setProperty('--orange',ACCENTS[s.accent]||ACCENTS.orange);
  const brand=document.querySelector('.brand');if(brand?.firstChild)brand.firstChild.textContent=s.brandName;
  const caption=document.querySelector('.brand-caption');if(caption&&location.pathname!=='/admin')caption.textContent=s.tagline;
  document.title=s.brandName+' — '+(location.pathname==='/admin'?'Admin Studio':s.tagline);
  const footer=document.querySelector('footer span');if(footer)footer.textContent=localized(s,'footer');
  document.querySelector('#site-notices')?.remove();
  const notices=document.createElement('div');notices.id='site-notices';notices.className='site-notices';
  if(s.announcementEnabled)notices.innerHTML=`<p class="notice">${esc(localized(s,'announcement'))}</p>`;
  if(!s.acceptNewRooms||!s.allowJoins)notices.innerHTML+=`<p class="notice">${esc(localized(s,'maintenance'))}</p>`;
  if(!s.ugcSubmissionsEnabled)notices.innerHTML+=`<p class="notice">${esc(t('Pengiriman sound komunitas sedang dijeda; katalog dan kiriman yang sudah ada tetap tersedia.','Community submissions are paused; existing submissions and the catalog remain available.'))}</p>`;
  if(s.helpUrl)notices.innerHTML+=`<a class="small" href="${esc(s.helpUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('Bantuan & kontak ↗','Help & contact ↗'))}</a>`;
  document.querySelector('.site-nav')?.after(notices);
}
export function applyHomeContent(config){
  const s={...DEFAULT_SITE,...config.settings},entry=document.querySelector('.entry-card');if(!entry)return;
  entry.querySelector('.eyebrow').textContent=s.heroEyebrow;
  entry.querySelector('h1').innerHTML=localized(s,'heroTitle').split('\n').map((line,i)=>i?`<em>${esc(line)}</em>`:esc(line)).join('<br>');
  entry.querySelector('p').textContent=localized(s,'heroDescription');
}
export async function bootSiteChrome(){try{const site=await loadSite();applySiteChrome(site);window.addEventListener('languagechange',()=>applySiteChrome(site));}catch{/* Core game has its own connection status; operator gates are enforced on the server. */}}
