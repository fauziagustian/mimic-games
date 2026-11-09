import {getStore} from '@netlify/blobs';
import {createNetlifyGameHandler} from '../../server/netlify-handler.js';

const handleGame=createNetlifyGameHandler({getStore});

export default async function gameFunction(request:Request):Promise<Response>{
  try{return await handleGame(request);}
  catch(error){
    console.error('MIMIC Netlify Function failed:',error instanceof Error?error.message:'unknown error');
    return Response.json({error:'Service unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
