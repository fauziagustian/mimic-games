export const uiLanguage=()=>localStorage.getItem('mimic-ui')==='en'?'en':'id';
export const t=(id,en)=>uiLanguage()==='en'?en:id;
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function api(path,options={}){
  const headers=new Headers(options.headers);
  if(options.body&&typeof options.body==='object'&&!(options.body instanceof ArrayBuffer)&&!(options.body instanceof Blob)&&!ArrayBuffer.isView(options.body)){headers.set('Content-Type','application/json');options.body=JSON.stringify(options.body);}
  const response=await fetch('/api'+path,{...options,headers,credentials:'same-origin'});
  let result;try{result=await response.json();}catch{throw new Error(t('Layanan belum siap. Muat ulang atau coba lagi.','Service unavailable. Refresh or try again.'));}
  if(!response.ok){const error=new Error(result.error||'Request failed');error.status=response.status;throw error;}return result;
}
export function signInLink(returnTo=location.pathname+location.search){return '/signin-with-chatgpt?return_to='+encodeURIComponent(returnTo);}
export const categoryName=c=>uiLanguage()==='en'?c?.nameEn:c?.nameId;
export function mountNavigation(){
  const nav=document.createElement('nav');nav.className='site-nav';nav.setAttribute('aria-label','Game navigation');
  nav.innerHTML=`<a href="/">${t('Main','Play')}</a><a href="/community" id="communityNav">${t('Komunitas','Community')}</a><a href="/leaderboard">Leaderboard</a><a href="/admin">Admin</a><button class="text-button" id="uiLanguage" aria-label="Switch interface language">${uiLanguage()==='en'?'ID / <b>EN</b>':'<b>ID</b> / EN'}</button>`;
  document.querySelector('header').after(nav);
  document.querySelector('#uiLanguage').onclick=()=>{localStorage.setItem('mimic-ui',uiLanguage()==='en'?'id':'en');document.documentElement.lang=uiLanguage();document.querySelector('#uiLanguage').innerHTML=uiLanguage()==='en'?'ID / <b>EN</b>':'<b>ID</b> / EN';nav.querySelector('a').textContent=t('Main','Play');nav.querySelector('#communityNav').textContent=t('Komunitas','Community');window.dispatchEvent(new Event('languagechange'));};
  document.documentElement.lang=uiLanguage();
}
