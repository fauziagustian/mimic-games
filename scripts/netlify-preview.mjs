import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {createNetlifyGameHandler} from '../server/netlify-handler.js';
import {createLocalGameHandler} from './local-game.mjs';
import {getLocalStore} from './local-blob-store.mjs';

const port=4173,origin=`http://127.0.0.1:${port}`;
const client=resolve('dist/client'),handleGame=createNetlifyGameHandler({getStore:getLocalStore});
const localPractice=await createLocalGameHandler();
const pageRoutes=new Map([
  ['/','index.html'],['/choose-character','index.html'],['/create-match','index.html'],['/matching','index.html'],
  ['/admin','admin.html'],['/community','community.html'],['/leaderboard','leaderboard.html'],['/login','login.html'],
]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary','.ico':'image/x-icon'};

async function sendFunction(req,res,url){
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers))if(value&&name!=='host'&&name!=='connection'&&name!=='content-length')headers.set(name,Array.isArray(value)?value.join(','):value);
  const chunks=[];let size=0;
  if(req.method!=='GET'&&req.method!=='HEAD')for await(const chunk of req){size+=chunk.length;if(size>750_000){res.writeHead(413).end('Request too large');return;}chunks.push(chunk);}
  const request=new Request(url,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined});
  const result=await handleGame(request);
  res.writeHead(result.status,Object.fromEntries(result.headers));
  res.end(req.method==='HEAD'?undefined:Buffer.from(await result.arrayBuffer()));
}
async function sendFile(req,res,path){
  const file=resolve(client,path);
  if(file!==client&&!file.startsWith(client+sep)){res.writeHead(403).end();return;}
  let bytes;try{bytes=await readFile(file);}catch(error){if(error.code==='ENOENT'||error.code==='EISDIR'){res.writeHead(404).end('Not found');return;}throw error;}
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:bytes);
}
const server=createServer(async(req,res)=>{try{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(await localPractice(req,res,url))return;
  if(url.pathname==='/.netlify/functions/game'){await sendFunction(req,res,url);return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  let path;try{path=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(path.split('/').includes('..')||path.includes('\\')){res.writeHead(403).end();return;}
  const page=pageRoutes.get(path)||(/^\/room\/[^/]+$/.test(path)?'index.html':path.slice(1));
  await sendFile(req,res,page);
}catch(error){console.error(error);if(!res.headersSent)res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Local preview error');}});
server.listen(port,'127.0.0.1',()=>console.log(`MIMIC local game: ${origin}/\nBleach practice: ${origin}/_preview/bleach`));
process.on('SIGINT',()=>server.close());
