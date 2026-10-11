// Shared allowlist: clients choose an ID, never a user-supplied model URL.
const names=['Rio','Bayu','Niko','Damar','Arka','Juno','Mika','Luna','Tara','Nara','Kira','Sora'];
export const AVATARS=['male','female'].flatMap((group,g)=>['a','b','c','d','e','f'].map((letter,i)=>({
  id:`${group}-${letter}`,name:names[g*6+i],
  model:`/models/kenney/character-${group}-${letter}.glb`,
  thumbnail:`/models/kenney/previews/character-${group}-${letter}.png`,
})));
export const DEFAULT_AVATAR=AVATARS[0].id;
export const avatarById=id=>AVATARS.find(a=>a.id===id)||AVATARS[0];
export const isAvatar=id=>AVATARS.some(a=>a.id===id);
export function visualPose(room,player,now=Date.now()){
  if(!room||room.phase==='lobby')return player.ready?'emote-yes':'idle';
  if(room.phase==='listen'&&now<room.recordAt)return 'idle';
  if(room.phase==='record'||room.phase==='listen'&&now>=room.recordAt)return 'interact-right';
  if(room.phase==='collect')return 'idle';
  if(room.phase==='reveal'){
    const result=room.results?.[room.revealIndex];if(result?.playerId!==player.id)return 'idle';
    if(now<room.revealAt)return 'idle';
    if(now<room.revealAt+(room.recordSeconds||5)*1000)return 'interact-right';
    return result.reaction==='perfect'?'jump':result.reaction==='applause'?'emote-yes':'emote-no';
  }
  if(room.phase==='results'){
    const result=room.results?.find(r=>r.playerId===player.id);
    if(!result)return 'idle';
    return result?.reaction==='perfect'?'jump':result?.reaction==='applause'?'emote-yes':'emote-no';
  }
  if(room.phase==='finished')return player.total===Math.max(...room.players.map(p=>p.total))?'jump':'emote-yes';
  return 'idle';
}
