import {compareAudio,normalizeText,wordScore} from './scoring.js';

export const SCORING_VERSION='mimic-v2';
export const SOUND_KINDS=['speech','sound'];
export function audioQuality(profile){
  const frames=profile?.frames||[],voiced=frames.filter(f=>f.pitch>0).length;
  const warnings=[];
  if(profile?.silent||!frames.length||(profile?.acRms!==undefined&&profile.acRms<.002))warnings.push('silent');
  if((profile?.clippedRatio||0)>.01)warnings.push('clipped');
  if(voiced<3)warnings.push('no-pitch');
  return {usable:!warnings.includes('silent'),voicedRatio:frames.length?voiced/frames.length:0,warnings};
}
export function scoringWeights(reference,rules={},kind='speech'){
  // Non-verbal effects have no canonical words or reliably periodic pitch.
  if(kind==='sound')return {pitch:0,words:0,timbre:60,rhythm:40};
  const w={...(rules.profile==='party'?{pitch:60,words:0,timbre:0,rhythm:40}:rules.weights||{pitch:30,words:35,timbre:20,rhythm:15})};
  if(audioQuality(reference).voicedRatio===0||reference.frames.filter(f=>f.pitch>0).length<3){
    w.pitch=0;
    if(rules.profile==='party'){w.timbre=60;w.rhythm=40;}
  }
  const sum=Object.values(w).reduce((a,b)=>a+b,0);
  if(!sum)return {pitch:0,words:0,timbre:50,rhythm:50};
  return Object.fromEntries(Object.entries(w).map(([k,v])=>[k,100*v/sum]));
}
export function scoreSound(reference,attempt,expectedText,actualText,rules={},kind='speech',transcriptSource='browser-asr'){
  if(rules.scoringVersion!==SCORING_VERSION)return compareAudio(reference,attempt,expectedText,actualText,rules);
  if(transcriptSource==='unavailable')actualText='';
  const weights=scoringWeights(reference,rules,kind),quality=audioQuality(attempt),referenceQuality=audioQuality(reference);
  // Keep the established acoustic equations. Missing pitch must not erase valid
  // spectral/rhythm/word scores; silence still earns zero on every component.
  const comparable={...attempt,voiced:3,frames:quality.warnings.includes('no-pitch')?attempt.frames.map(f=>({...f,pitch:0})):attempt.frames};
  const score=compareAudio(reference,comparable,expectedText,actualText,{...rules,profile:'precision',weights});
  // Party retains relative pitch normalization, even with the detailed rubric.
  if(rules.profile==='party'&&weights.pitch){
    const party=compareAudio(reference,comparable,expectedText,actualText,rules);
    Object.assign(score,party);
  }
  if(!referenceQuality.usable||!quality.usable){for(const k of ['total','pitch','words','timbre','rhythm'])score[k]=0;score.reaction='roast';}
  const wordsAssessed=weights.words>0;
  const failed=transcriptSource==='unavailable';
  if(failed&&wordsAssessed&&score.total===100){score.total=99;score.reaction=score.total>=(rules.applauseThreshold??50)?'applause':'roast';}
  return {...score,scoringVersion:SCORING_VERSION,kind,weights,quality,referenceQuality,
    assessed:Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v>0])),
    expectedTranscript:wordsAssessed?expectedText:'',
    transcriptSource:wordsAssessed?transcriptSource:'not-used',
    wordComparison:wordsAssessed?{expected:normalizeText(expectedText),heard:normalizeText(actualText),similarity:wordScore(expectedText,actualText)}:null,
    warnings:[...quality.warnings,...(!referenceQuality.usable?['invalid-reference']:[]),...(failed&&wordsAssessed?['asr-unavailable']:[])],
  };
}
