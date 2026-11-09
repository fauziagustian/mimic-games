import {mkdir,cp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {SEED_SOUNDS} from '../public/catalog.js';
import {analyzeAudio} from '../public/scoring.js';
import {audioQuality} from '../public/scoring-detail.js';
import {pcmFromWav,digest} from '../server/validation.js';

const generated='server/generated';
await mkdir(generated,{recursive:true});
const references={};
for(const sound of SEED_SOUNDS){
  const bytes=await readFile('public'+sound.url),samples=pcmFromWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  references[sound.id]={profile:analyzeAudio(samples),audioHash:await digest(samples.buffer),duration:samples.length/16000};
}
await writeFile(generated+'/reference-seeds.js','export default '+JSON.stringify(references)+';\n');
const manifest=JSON.parse(await readFile('private-assets/sample-collections.json','utf8')),sounds=[];
const ids=new Set();
for(const sound of manifest.sounds){
  if(ids.has(sound.id)||!/^[-a-z0-9]+$/.test(sound.id)||!/^[-a-z0-9]+\.wav$/.test(sound.file))throw new Error('Invalid sample manifest ID or filename.');
  ids.add(sound.id);
  const bytes=await readFile('private-assets/samples/'+sound.file),samples=pcmFromWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const profile=analyzeAudio(samples);
  if(!audioQuality(profile).usable)throw new Error('Unusable sample audio: '+sound.id);
  sounds.push({id:sound.id,title:sound.title,text:sound.text,kind:sound.kind,categoryId:sound.categoryId,language:sound.language,
    importPack:'user-samples-v2',rightsReviewed:true,transcriptReviewed:sound.kind==='sound',source:'Provided by project owner · '+sound.original,
    rights:manifest.permission,ranked:false,url:`/api/library-sounds/${sound.id}/audio`,profile,audioHash:await digest(samples.buffer),duration:samples.length/16000,
    bytes:bytes.toString('base64')});
}
await writeFile(generated+'/sample-collections.js','export default '+JSON.stringify({sounds})+';\n');
await rm(generated+'/bleach-pack.js',{force:true});
const migrations=[];
for(const file of (await readdir('drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
  const sql=await readFile('drizzle/'+file,'utf8');
  for(const part of sql.split(/--> statement-breakpoint/g).map(s=>s.trim().replace(/;\s*$/,'' )).filter(Boolean))migrations.push(part);
}
await writeFile(generated+'/netlify-schema.js','export const MIGRATIONS = '+JSON.stringify(migrations)+';\n');

await rm('dist/client',{recursive:true,force:true});
await cp('public','dist/client',{recursive:true});
await build({entryPoints:['client/stage-3d.js'],outfile:'dist/client/stage-3d.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
console.log('MIMIC static client and Netlify Function inputs built.');
