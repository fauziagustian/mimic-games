import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAudio,compareAudio} from '../public/scoring.js';
import {audioQuality,scoreSound,scoringWeights,SCORING_VERSION} from '../public/scoring-detail.js';
import {scoreReportMarkup} from '../public/score-report.js';
import {validateRules} from '../server/validation.js';
import {DEFAULT_RULES} from '../public/catalog.js';
const profile=({pitch=200,mfcc=0,energy=.2,duration=1}={})=>({frames:Array.from({length:4},()=>({pitch,energy,mfcc:Array(12).fill(mfcc)})),duration,silent:false,voiced:pitch?4:0});
const rules={...DEFAULT_RULES,profile:'precision',scoringVersion:SCORING_VERSION};

test('v2 preserves ordinary speech formulas and old snapshots, reports weights, word evidence and source',()=>{
  const ref=profile(),take=profile({pitch:220,mfcc:1});
  const legacy=compareAudio(ref,take,'halo teman','halo beda',rules),v2=scoreSound(ref,take,'halo teman','halo beda',rules);
  for(const k of ['total','pitch','words','timbre','rhythm'])assert.equal(v2[k],legacy[k]);
  assert.equal(v2.words,50);assert.equal(v2.expectedTranscript,'halo teman');assert.equal(v2.transcriptSource,'browser-asr');
  assert.equal(Object.values(v2.weights).reduce((a,b)=>a+b,0),100);
  assert.deepEqual(scoreSound(ref,take,'a','b',{},'sound'),compareAudio(ref,take,'a','b',{}),'legacy engine is unchanged');
  assert.equal(scoreSound(ref,ref,'a','a',rules).total,100);
  const failure=scoreSound(ref,ref,'a','a',rules,'speech','unavailable');assert.equal(failure.words,0);assert.equal(failure.total,65);assert.ok(failure.warnings.includes('asr-unavailable'));
});
test('nonverbal sound is not forced to transcribe or have pitch, but silence/DC never receives points',()=>{
  const ref=profile({pitch:0});
  for(const mode of ['party','precision']){
    const s=scoreSound(ref,ref,'caption','', {...rules,profile:mode},'sound');assert.equal(s.total,100);assert.equal(s.assessed.words,false);assert.equal(s.assessed.pitch,false);assert.equal(s.transcriptSource,'not-used');assert.deepEqual(s.weights,{pitch:0,words:0,timbre:60,rhythm:40});
    assert.equal(scoreSound(ref,profile({pitch:0,mfcc:3}), '','',{...rules,profile:mode},'sound').total,40);
  }
  for(const samples of [new Float32Array(16000),new Float32Array(16000).fill(.5)]){
    const analysis=analyzeAudio(samples);assert.equal(audioQuality(analysis).usable,false);assert.equal(scoreSound(ref,analysis,'a','a',rules).total,0);
  }
  const weights=scoringWeights(ref,rules);assert.equal(weights.pitch,0);assert.ok(Math.abs(Object.values(weights).reduce((a,b)=>a+b,0)-100)<1e-8);
  const onePitch=profile({pitch:0});onePitch.frames[0].pitch=200;
  const lowPitch=scoreSound(profile(),onePitch,'a','a',rules);assert.equal(lowPitch.pitch,0);assert.equal(lowPitch.words,100);assert.equal(lowPitch.total,70);
  const clipped=analyzeAudio(Float32Array.from({length:16000},(_,i)=>i%2?1:-1));assert.ok(audioQuality(clipped).warnings.includes('clipped'));
});
test('score report escapes transcripts, distinguishes unassessed components, and validates ASR model allowlist',()=>{
  globalThis.localStorage={getItem:()=> 'id'};
  const s=scoreSound(profile(),profile(),'<img src=x onerror=y>','<script>x</script>',rules);
  const html=scoreReportMarkup(s);assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;script&gt;/);assert.match(html,/belum diverifikasi/);assert.match(html,/35%/);
  const sound=scoreReportMarkup(scoreSound(profile({pitch:0}),profile({pitch:0}),'','',rules,'sound'));assert.match(sound,/<b>—<\/b>/);assert.doesNotMatch(sound,/Terdengar/);
  assert.equal(validateRules({...DEFAULT_RULES,asrModel:'base'}).asrModel,'base');assert.throws(()=>validateRules({...DEFAULT_RULES,asrModel:'https://evil.test/model'}));
});
