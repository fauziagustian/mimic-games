import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import {MIGRATIONS} from './generated/netlify-schema.js';

const DATABASE_KEY='mimic.sqlite';
const sqlPromise=initSqlJs();
const bytesOf=value=>{
  if(value instanceof ArrayBuffer)return new Uint8Array(value.slice(0));
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));
  if(value instanceof Blob)return value.arrayBuffer().then(bytesOf);
  if(typeof value==='string')return new TextEncoder().encode(value);
  throw new TypeError('Unsupported Blob value.');
};
const paramsOf=values=>values.map(value=>value===undefined?null:value);

function query(db,sql,values){
  const statement=db.prepare(sql);try{statement.bind(paramsOf(values));const rows=[];while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}
}
function execute(db,sql,values){
  db.run(sql,paramsOf(values));return {success:true,meta:{changes:db.getRowsModified()}};
}
export async function openBlobDatabase(store){
  const SQL=await sqlPromise,loaded=await store.getWithMetadata(DATABASE_KEY,{consistency:'strong',type:'arrayBuffer'});
  const db=loaded?.data?new SQL.Database(new Uint8Array(loaded.data)):new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  if(!loaded?.data)for(const migration of MIGRATIONS)db.run(migration);
  let dirty=!loaded?.data;
  const adapter={
    statement:(sql,...values)=>({sql,values}),
    one:async(sql,...values)=>query(db,sql,values)[0]||null,
    all:async(sql,...values)=>query(db,sql,values),
    run:async(sql,...values)=>{dirty=true;return execute(db,sql,values);},
    batch:async(statements)=>{
      db.run('BEGIN');try{const results=[];for(const statement of statements)results.push(execute(db,statement.sql,statement.values));db.run('COMMIT');dirty=true;return results;}
      catch(error){try{db.run('ROLLBACK');}catch{}throw error;}
    },
  };
  return {db,adapter,loaded,hasWrites:()=>dirty,exportBytes:()=>db.export()};
}

function blobBody(bytes){return {body:new Response(bytes).body};}
export function createBlobBucket(store){
  const puts=new Map(),deletes=new Set();
  return {
    async put(key,value,options={}){
      puts.set(key,{bytes:await bytesOf(value),contentType:options.httpMetadata?.contentType||'application/octet-stream'});deletes.delete(key);
    },
    async get(key){
      const pending=puts.get(key);if(pending)return blobBody(pending.bytes);
      const result=await store.getWithMetadata(key,{consistency:'strong',type:'arrayBuffer'});return result?.data?blobBody(result.data):null;
    },
    async delete(key){puts.delete(key);deletes.add(key);},
    async commitDatabase(snapshot,databaseStore){
      const newlyWritten=[];
      try{
        for(const [key,item] of puts){
          const value=item.bytes.buffer.slice(item.bytes.byteOffset,item.bytes.byteOffset+item.bytes.byteLength);
          const result=await store.set(key,value,{metadata:{contentType:item.contentType},onlyIfNew:true});
          if(result.modified)newlyWritten.push(key);
        }
        if(snapshot.hasWrites()){
          const bytes=snapshot.exportBytes(),data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
          const options=snapshot.loaded?.etag?{onlyIfMatch:snapshot.loaded.etag}:{onlyIfNew:true};
          const result=await databaseStore.set(DATABASE_KEY,data,options);
          if(!result.modified)throw new BlobWriteConflict();
        }
      }catch(error){
        if(error instanceof BlobWriteConflict)await Promise.allSettled(newlyWritten.map(key=>store.delete(key)));
        else await Promise.allSettled(newlyWritten.map(key=>store.delete(key)));
        throw error;
      }
      await Promise.allSettled([...deletes].map(key=>store.delete(key)));
      return true;
    },
    discard(){puts.clear();deletes.clear();},
  };
}

export class BlobWriteConflict extends Error {constructor(){super('Netlify Blob changed during request.');this.name='BlobWriteConflict';}}
