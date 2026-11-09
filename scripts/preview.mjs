import {createServer} from 'node:http';
import {runtime} from './runtime.mjs';
import {createLocalGameHandler} from './local-game.mjs';
const localGame=await createLocalGameHandler();
const mf=await runtime(true);
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:4173');
 if(req.headers.host!=='127.0.0.1:4173'){res.writeHead(403).end();return;}
 if(localGame(req,res,url))return;
 if(url.pathname==='/_preview/session'){
   const role=url.searchParams.get('role'),target=url.searchParams.get('return_to')||'/';
   res.writeHead(302,{'Location':target.startsWith('/')&&!target.startsWith('//')?target:'/','Set-Cookie':`preview-role=${['admin','player'].includes(role)?role:'none'}; HttpOnly; SameSite=Lax; Path=/`}).end();return;
 }
 const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(k.startsWith('oai-')||k==='host'||k==='connection'||k==='content-length')continue;if(v)headers.set(k,Array.isArray(v)?v.join(','):v);}
 const role=(req.headers.cookie||'').match(/(?:^|; )preview-role=(admin|player)(?:;|$)/)?.[1];if(role){headers.set('oai-authenticated-user-id','preview-'+role);headers.set('oai-authenticated-user-email',role+'@preview.test');}
 let bytes;if(!['GET','HEAD'].includes(req.method)){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>700000){res.writeHead(413).end();return;}chunks.push(chunk);}bytes=Buffer.concat(chunks);}
 const result=await mf.dispatchFetch(url.href,{method:req.method,headers,body:bytes});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 }catch(e){console.error(e.message);res.writeHead(500).end('Preview error');}});
server.listen(4173,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4173/\nBleach practice: http://127.0.0.1:4173/_preview/bleach\nLocal test identity only: /_preview/session?role=admin&return_to=/admin'));
process.on('SIGINT',async()=>{server.close();await mf.dispose();process.exit(0);});
