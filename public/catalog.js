export const DEFAULT_RULES = {
  rounds:3, maxPlayers:8, turnSeconds:90, recordSeconds:15,
  asrModel:'tiny',
  weights:{pitch:30,words:35,timbre:20,rhythm:15}, perfectThreshold:98,
  applauseThreshold:50, rankedEnabled:true, minRankedSounds:1,
  roastId:'Nadanya ke mana, percaya dirinya ke mana!', roastEn:'The confidence was there. The notes were not!',
  applauseId:'Lumayan mirip! Satu room kasih tepuk tangan.', applauseEn:'Nice imitation! A round of applause for you.',
  perfectId:'Nada, kata, dan gayanya: kena semua. Panggung ini milikmu.', perfectEn:'Every note, word and detail. This stage is yours.',
  reactionAudio:{roast:'',applause:'',perfect:''}
};
export const LANGUAGES = [
  ['indonesian','Bahasa Indonesia','id'],['english','English','en'],['japanese','日本語','ja'],['korean','한국어','ko'],
  ['spanish','Español','es'],['french','Français','fr'],['german','Deutsch','de'],['portuguese','Português','pt'],
  ['arabic','العربية','ar'],['chinese','中文','zh'],['hindi','हिन्दी','hi'],['thai','ไทย','th'],['vietnamese','Tiếng Việt','vi'],['malay','Bahasa Melayu','ms']
].map(([id,label,code])=>({id,label,code,active:true}));
export const CATEGORIES = [
  {id:'drama',nameId:'Drama dadakan',nameEn:'Instant drama',descriptionId:'Ekspresi heboh, nada naik-turun.',descriptionEn:'Big reactions. Bigger pitch changes.',active:true},
  {id:'chill',nameId:'Sok tenang',nameEn:'Stay cool',descriptionId:'Santai boleh. Detail tetap kena.',descriptionEn:'Relaxed delivery. Precise details.',active:true},
  {id:'hype',nameId:'Hype maksimal',nameEn:'Maximum hype',descriptionId:'Gas ekspresinya, jaga ritmenya.',descriptionEn:'Bring the energy. Keep the rhythm.',active:true}
];
export const SEED_SOUNDS = [
  ['lah-kok-gitu','Lah, kok gitu?','Lah, kok gitu? Aku kan cuma nanya!','drama','indonesian'],
  ['santai-bos','Santai dulu, bos.','Santai dulu, bos. Kita belum mulai!','chill','indonesian'],
  ['serius-nih','Serius nih?!','Serius nih? Wah, ini sih keren banget!','hype','indonesian'],
  ['wait-what','Wait, what?!','Wait, what? I was only asking a question!','drama','english'],
  ['take-it-easy','Take it easy.','Take it easy, boss. We have not even started!','chill','english'],
  ['lets-go','Let’s go!','Are you serious? That is absolutely amazing!','hype','english'],
].map(([id,title,text,categoryId,language])=>({id,title,text,categoryId,language,url:`/audio/${id}.wav`,source:'MIMIC original · synthetic',rights:'Original synthetic practice audio',active:true,ranked:true,revision:1}));
export function randomQueue(ids, rounds, random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296) {
  if(!ids.length) throw new Error('No sounds match this selection.');
  const queue=[];
  while(queue.length<rounds) {
    const bag=[...new Set(ids)];
    for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    if(bag.length>1&&queue.at(-1)===bag[0]) [bag[0],bag[1]]=[bag[1],bag[0]];
    queue.push(...bag);
  }
  return queue.slice(0,rounds);
}
