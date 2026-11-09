import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const root=new URL('../.netlify/local-blobs/',import.meta.url);
const locks=new Map();

function bytesOf(value){
  if(value instanceof ArrayBuffer)return Buffer.from(value);
  if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
  throw new TypeError('Expected Blob bytes.');
}
function etag(bytes){return '"'+createHash('sha256').update(bytes).digest('hex')+'"';}
function fileFor(name,key){
  if(!['mimic-game-database','mimic-game-audio'].includes(name)||typeof key!=='string'||!key)throw new Error('Invalid local Blob key.');
  return join(new URL(name+'/',root).pathname,Buffer.from(key).toString('base64url')+'.blob');
}
async function existing(file){try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function serialized(file,work){
  const previous=locks.get(file)||Promise.resolve();
  const current=previous.catch(()=>{}).then(work);
  locks.set(file,current);
  current.finally(()=>{if(locks.get(file)===current)locks.delete(file);}).catch(()=>{});
  return current;
}

export function getLocalStore({name,consistency}){
  if(consistency!=='strong')throw new Error('Local preview requires strong Blob consistency.');
  return {
    async getWithMetadata(key,{consistency:readConsistency,type}={}){
      if(readConsistency!=='strong'||type!=='arrayBuffer')throw new Error('Local preview requires a strong Blob read.');
      const value=await existing(fileFor(name,key));
      return value?{data:value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength),etag:etag(value)}:{data:null,etag:undefined};
    },
    async set(key,value,{onlyIfNew,onlyIfMatch}={}){
      const file=fileFor(name,key);
      return serialized(file,async()=>{
        const before=await existing(file);
        if(onlyIfNew&&before||onlyIfMatch&&(!before||etag(before)!==onlyIfMatch))return {modified:false};
        const bytes=bytesOf(value),temporary=file+'.'+randomUUID()+'.tmp';
        await mkdir(new URL(name+'/',root),{recursive:true});
        try{await writeFile(temporary,bytes);await rename(temporary,file);}finally{await rm(temporary,{force:true});}
        return {modified:true,etag:etag(bytes)};
      });
    },
    async delete(key){const file=fileFor(name,key);return serialized(file,()=>rm(file,{force:true}));},
  };
}
