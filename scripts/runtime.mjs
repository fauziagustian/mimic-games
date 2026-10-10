import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
export async function runtime(persist=false){
 const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],d1Persist:persist?'.wrangler/preview-db':false,r2Persist:persist?'.wrangler/preview-audio':false,bindings:{ADMIN_EMAILS:'admin@preview.test'},assets:{directory:'dist/client',binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true},assetConfig:{html_handling:'none'}},host:'127.0.0.1',port:0});
 const db=await mf.getD1Database('DB');await db.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){if(await db.prepare('SELECT name FROM _local_migrations WHERE name=?').bind(file).first())continue;for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();await db.prepare('INSERT INTO _local_migrations(name) VALUES(?)').bind(file).run();}
 return mf;
}
