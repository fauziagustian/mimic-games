import {api,t} from './platform.js';

const app=document.querySelector('#app'),query=new URLSearchParams(location.search);
const requested=query.get('return_to')||'/community',returnTo=requested.startsWith('/')&&!requested.startsWith('//')?requested:'/community';
if(query.get('logout')==='1'){
  api('/auth/logout',{method:'POST'}).catch(()=>{}).finally(()=>location.replace(returnTo));
}else render();

function render(mode='login'){
  const registering=mode==='register';
  app.innerHTML=`<section class="panel guard admin-login"><span class="eyebrow">PLAYER ACCOUNT</span><h1>${registering?t('Buat akun.','Create an account.'):t('Selamat datang kembali.','Welcome back.')}</h1><p>${t('Bermain santai tetap tanpa akun. Akun diperlukan untuk mode kompetitif dan fitur kreator.','Casual rooms do not require an account. Accounts are for ranked play and creator tools.')}</p><form id="accountForm" class="stack"><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>${registering?`<p class="small">${t('Email dipakai untuk masuk dan mengelola kirimanmu. Tidak ada email verifikasi.','Your email is used to sign in and manage your submissions. No verification email is sent.')}</p>`:''}<label>${t('Kata sandi (minimal 12 karakter)','Password (at least 12 characters)')}<input name="password" type="password" autocomplete="${registering?'new-password':'current-password'}" minlength="12" maxlength="128" required></label><button class="button primary">${registering?t('Buat akun','Create account'):t('Masuk','Sign in')}</button><p class="form-status" id="accountStatus" role="status"></p></form><button class="text-button" id="switchMode">${registering?t('Sudah punya akun? Masuk','Already have an account? Sign in'):t('Belum punya akun? Buat akun','New here? Create an account')}</button></section>`;
  document.querySelector('#switchMode').onclick=()=>render(registering?'login':'register');
  document.querySelector('#accountForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),status=document.querySelector('#accountStatus');button.disabled=true;status.textContent=t('Memeriksa akun…','Checking account…');
    try{await api(registering?'/auth/register':'/auth/login',{method:'POST',body:{email:form.elements.email.value,password:form.elements.password.value}});location.assign(returnTo);}
    catch(error){status.textContent=error.message;status.classList.add('error');button.disabled=false;}
  };
}
