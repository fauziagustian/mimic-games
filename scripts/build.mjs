import {mkdir, cp, readFile, writeFile, readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {SEED_SOUNDS} from '../public/catalog.js';
import {analyzeAudio} from '../public/scoring.js';
import {pcmFromWav,digest} from '../server/validation.js';
const references={};
for(const sound of SEED_SOUNDS){const bytes=await readFile('public'+sound.url),samples=pcmFromWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));references[sound.id]={profile:analyzeAudio(samples),audioHash:await digest(samples.buffer),duration:samples.length/16000};}
await mkdir('work',{recursive:true});
await writeFile('work/reference-seeds.json',JSON.stringify(references));
const files={};
async function collect(directory,prefix=''){
 for(const item of await readdir(directory,{withFileTypes:true})){if(item.name.startsWith('.'))continue;const name=prefix+'/'+item.name;if(item.isDirectory())await collect(directory+'/'+item.name,name);else{const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',wav:'audio/wav'}[item.name.split('.').at(-1)];if(!mime)throw new Error('Unsupported public asset: '+name);files[name]={mime,data:(await readFile(directory+'/'+item.name)).toString('base64')};}}
}
await collect('public');await writeFile('work/static-assets.json',JSON.stringify(files));
await mkdir('dist/server',{recursive:true});
await cp('public','dist/client',{recursive:true});
await build({entryPoints:['server/index.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:false});
const wrangler={name:'mimic-sound-battle',main:'index.js',compatibility_date:'2026-05-15',assets:{directory:'../client',binding:'ASSETS',run_worker_first:true,html_handling:'none'},d1_databases:[{binding:'DB',database_name:'mimic-local',database_id:'00000000-0000-0000-0000-000000000001'}],r2_buckets:[{binding:'BUCKET',bucket_name:'mimic-local'}]};
await writeFile('dist/server/wrangler.json',JSON.stringify(wrangler,null,2));
await mkdir('dist/.openai',{recursive:true});
await cp('.openai/hosting.json','dist/.openai/hosting.json');
console.log('MIMIC client and Worker built.');
