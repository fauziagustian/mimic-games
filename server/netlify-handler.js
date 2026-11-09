import game from './index.js';
import {openBlobDatabase,createBlobBucket,BlobWriteConflict} from './netlify-storage.js';

function routedRequest(request,body){
  const incoming=new URL(request.url),route=incoming.searchParams.get('route');
  if(!route||!route.startsWith('/api/')||route.startsWith('//')||route.includes('\\'))return null;
  let target;try{target=new URL(route,incoming.origin);}catch{return null;}
  if(target.origin!==incoming.origin||!target.pathname.startsWith('/api/'))return null;
  return new Request(target,{method:request.method,headers:request.headers,body:['GET','HEAD'].includes(request.method)?undefined:body,redirect:'manual'});
}

export function createNetlifyGameHandler({getStore}){
  return async function handleFunction(request){
    const body=['GET','HEAD'].includes(request.method)?null:await request.arrayBuffer(),mapped=routedRequest(request,body);
    if(!mapped)return Response.json({error:'Invalid game route.'},{status:400,headers:{'Cache-Control':'no-store'}});
    for(let attempt=0;attempt<12;attempt++){
      const dbStore=getStore({name:'mimic-game-database',consistency:'strong'}),audioStore=getStore({name:'mimic-game-audio',consistency:'strong'});
      const snapshot=await openBlobDatabase(dbStore),bucket=createBlobBucket(audioStore),env={DB:snapshot.adapter,BUCKET:bucket,NETLIFY_AUTH:true};
      let response;
      try{response=await game.fetch(mapped.clone(),env);}catch(error){bucket.discard();throw error;}
      if(response.status>=400){bucket.discard();return response;}
      try{
        await bucket.commitDatabase(snapshot,dbStore);
        return response;
      }catch(error){
        bucket.discard();
        if(!(error instanceof BlobWriteConflict))throw error;
        if(attempt===11)return Response.json({error:'Game is busy. Please retry this action.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'1'}});
        await new Promise(resolve=>setTimeout(resolve,Math.min(8+attempt*5,60)));
      }
    }
    return Response.json({error:'Game is busy. Please retry this action.'},{status:503,headers:{'Cache-Control':'no-store'}});
  };
}
