import game from './index.js';
import staticAssets from '../work/static-assets.json';

const pagePaths=new Set(['/','/choose-character','/create-match','/matching']);
const namedPages=new Set(['/admin','/leaderboard','/community','/login']);

export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path.startsWith('/api/'))return game.fetch(req,env);
    if(req.method!=='GET'&&req.method!=='HEAD')return new Response('Method not allowed',{status:405});
    const gamePage=pagePaths.has(path)||/^\/room\/[A-Z2-9]{6}$/.test(path);
    const key=gamePage?'/index.html':namedPages.has(path)?path+'.html':path;
    const asset=staticAssets[key];
    if(!asset)return new Response('Not found',{status:404});
    return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),{
      headers:{'Content-Type':asset.mime,'Cache-Control':path.endsWith('.wav')?'public, max-age=3600':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}
    });
  }
};
