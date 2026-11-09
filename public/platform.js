import {categoryTrail} from './categories.js';
export const uiLanguage=()=>localStorage.getItem('mimic-ui')==='en'?'en':'id';
export const t=(id,en)=>uiLanguage()==='en'?en:id;
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const functionUrl=route=>'/.netlify/functions/game?route='+encodeURIComponent(route.startsWith('/api/')?route:'/api'+route);
function rewriteApiAudio(value){
  if(Array.isArray(value))return value.map(rewriteApiAudio);
  if(value&&typeof value==='object'){for(const [key,item] of Object.entries(value)){if(key==='url'&&typeof item==='string'&&item.startsWith('/api/'))value[key]=functionUrl(item);else if(key==='reactionAudio'&&item&&typeof item==='object'){for(const [reaction,url] of Object.entries(item))if(typeof url==='string'&&url.startsWith('/api/'))item[reaction]=functionUrl(url);}else rewriteApiAudio(item);}}
  return value;
}
export async function api(path,options={}){
  const headers=new Headers(options.headers);
  if(options.body&&typeof options.body==='object'&&!(options.body instanceof ArrayBuffer)&&!(options.body instanceof Blob)&&!ArrayBuffer.isView(options.body)){headers.set('Content-Type','application/json');options.body=JSON.stringify(options.body);}
  const response=await fetch(functionUrl('/api'+path),{...options,headers,credentials:'same-origin'});
  let result;try{result=await response.json();}catch{throw new Error(t('Layanan belum siap. Muat ulang atau coba lagi.','Service unavailable. Refresh or try again.'));}
  if(!response.ok){const error=new Error(result.error||'Request failed');error.status=response.status;throw error;}return rewriteApiAudio(result);
}
export function signInLink(returnTo=location.pathname+location.search){return '/login?return_to='+encodeURIComponent(returnTo);}
export function signOutLink(returnTo=location.pathname+location.search){return '/login?logout=1&return_to='+encodeURIComponent(returnTo);}
export const categoryName=c=>uiLanguage()==='en'?c?.nameEn:c?.nameId;
export const categoryPath=(categories,id)=>categoryTrail(categories,id).map(categoryName).join(' › ')||id;
export function mountNavigation(){
  const style=document.createElement('link');style.rel='stylesheet';style.href='/control.css';document.head.append(style);
  const nav=document.createElement('nav');nav.className='site-nav';nav.setAttribute('aria-label','Game navigation');
  nav.innerHTML=`<a href="/">${t('Main','Play')}</a><a href="/community" id="communityNav">${t('Komunitas','Community')}</a><a href="/leaderboard">Leaderboard</a><a href="/admin">Admin</a><button class="text-button" id="uiLanguage" aria-label="Switch interface language">${uiLanguage()==='en'?'ID / <b>EN</b>':'<b>ID</b> / EN'}</button>`;
  document.querySelector('header').after(nav);
  document.querySelector('#uiLanguage').onclick=()=>{localStorage.setItem('mimic-ui',uiLanguage()==='en'?'id':'en');document.documentElement.lang=uiLanguage();document.querySelector('#uiLanguage').innerHTML=uiLanguage()==='en'?'ID / <b>EN</b>':'<b>ID</b> / EN';nav.querySelector('a').textContent=t('Main','Play');nav.querySelector('#communityNav').textContent=t('Komunitas','Community');window.dispatchEvent(new Event('languagechange'));};
  document.documentElement.lang=uiLanguage();
  import('./site-ui.js').then(m=>m.bootSiteChrome());
}
