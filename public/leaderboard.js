import {t,escapeHTML as esc,mountNavigation} from './platform.js';
export function comingSoonMarkup(){
  return `<section class="coming-soon"><span class="eyebrow">MIMIC / LEADERBOARD</span><div class="coming-soon-mark" aria-hidden="true">100</div><h1>COMING SOON.</h1><p>${esc(t('Panggung dulu. Peringkat nanti. Sekarang waktunya main dan menemukan mimic terbaikmu.','The stage comes first. Rankings can wait. For now, play and find your best mimic.'))}</p><a class="button primary" href="/">${esc(t('Kembali bermain','Back to playing'))} →</a></section>`;
}
const render=()=>{document.querySelector('#app').innerHTML=comingSoonMarkup();};
mountNavigation();window.addEventListener('languagechange',render);render();
