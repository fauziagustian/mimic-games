import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareAudio,wordScore,reactionFor,analyzeAudio} from '../public/scoring.js';
const profile=({pitch=200,energy=.2,mfcc=0,duration=1}={})=>({frames:Array.from({length:4},()=>({pitch,energy,mfcc:Array(12).fill(mfcc)})),duration,silent:false,voiced:4});
const only=key=>({weights:{pitch:0,words:0,timbre:0,rhythm:0,[key]:100}});

test('word similarity: normalized tokens, edit distance, longer denominator, not ASR accuracy',()=>{
  assert.equal(wordScore('Halo, TEMAN!','halo teman'),100);
  assert.equal(wordScore('satu dua tiga empat lima','satu dua beda empat lima'),80);
  assert.equal(wordScore('a b','a b c d'),50);
  assert.equal(wordScore('a b',''),0);assert.equal(wordScore('',''),0);
  assert.equal(wordScore('ＡＢＣ','abc'),100);
});
test('component equations on controlled features: semitone loss, MFCC loss, duration/energy',()=>{
  const ref=profile();
  assert.equal(compareAudio(ref,profile({pitch:200*2**(1/12)}),'a','a',only('pitch')).pitch,90);
  assert.equal(compareAudio(ref,profile({pitch:200*2**(5/12)}),'a','a',only('pitch')).pitch,50);
  assert.equal(compareAudio(ref,profile({pitch:400}),'a','a',only('pitch')).pitch,0);
  assert.equal(compareAudio(ref,profile({mfcc:1.5}),'a','a',only('timbre')).timbre,50);
  assert.equal(compareAudio(ref,profile({mfcc:3}),'a','a',only('timbre')).timbre,0);
  assert.equal(compareAudio(ref,profile({duration:2}),'a','a',only('rhythm')).rhythm,Math.round(100*(1-.55*Math.log(2))));
  const energy=.205*Math.exp(3)-.005;
  assert.equal(compareAudio(ref,profile({energy}),'a','a',only('rhythm')).rhythm,55);
  assert.equal(compareAudio(ref,profile({pitch:400}),'a','different',{profile:'party'}).total,100);
});
test('weighted values before rounding, all-component perfect threshold, silence and reactions',()=>{
  const ref=profile(),attempt=profile({pitch:200*2**(.15/12)});
  const r=compareAudio(ref,attempt,'one two three four five','one two three four wrong',{});
  assert.equal(r.pitch,99);assert.equal(r.words,80);assert.equal(r.total,Math.round(98.5*.30+80*.35+100*.20+100*.15));
  assert.equal(compareAudio(ref,attempt,'a','a',{}).total,100);
  assert.equal(compareAudio(ref,attempt,'a','a',{perfectThreshold:100}).total,99);
  assert.notEqual(compareAudio(ref,attempt,'a','wrong',{weights:{pitch:99,words:1,timbre:0,rhythm:0}}).total,100);
  assert.equal(compareAudio(ref,{...attempt,voiced:2},'a','a',{}).total,0);
  assert.equal(compareAudio(ref,analyzeAudio(new Float32Array(16000)),'a','a',{}).total,0);
  assert.equal(reactionFor(49),'roast');assert.equal(reactionFor(50),'applause');assert.equal(reactionFor(99),'applause');assert.equal(reactionFor(100),'perfect');assert.equal(reactionFor(60,70),'roast');
});
