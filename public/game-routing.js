export const validRoomCode = code => /^[A-Z2-9]{6}$/.test(code || '');
export const matchingUrl = code => '/matching' + (validRoomCode(code) ? '?room=' + code : '');
export const playUrl = code => validRoomCode(code) ? '/room/' + code : '/matching';
export const roomUrl = room => room.phase === 'lobby' ? matchingUrl(room.code) : playUrl(room.code);
export function gameRoute(url) {
  const {pathname,searchParams:q}=new URL(url, 'https://mimic.invalid');
  const code=(q.get('room')||'').toUpperCase();
  if(pathname==='/choose-character')return {page:'character',next:['create','matching','lobby'].includes(q.get('next'))?q.get('next'):'create',code:validRoomCode(code)?code:''};
  if(pathname==='/create-match')return {page:'create'};
  if(pathname==='/matching')return {page:'matching',code:validRoomCode(code)?code:''};
  const match=pathname.match(/^\/room\/([A-Z2-9]{6})$/);
  if(match)return {page:'play',code:match[1]};
  if(pathname==='/')return {page:'home',code:validRoomCode(code)?code:''};
  return {page:'unknown'};
}
export function characterUrl(next='create',code='') {
  const q=new URLSearchParams({next:['create','matching','lobby'].includes(next)?next:'create'});
  if(validRoomCode(code))q.set('room',code);
  return '/choose-character?'+q;
}
export function parseRoomSession(raw) {
  try {
    const value=JSON.parse(raw);
    return validRoomCode(value?.code)&&/^[a-f0-9]{64}$/.test(value?.token||'')?{code:value.code,token:value.token}:null;
  } catch {return null;}
}
