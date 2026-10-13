import {fail,id,text} from './validation.js';
import {categoryEnabled} from '../public/categories.js';
export async function categoryList(db){return (await db.all('SELECT * FROM categories')).map(r=>({...JSON.parse(r.data),id:r.id,active:!!r.active}));}
export async function enabledCategory(db,id){return categoryEnabled(await categoryList(db),id);}
// Used inside publication/quota transactions as well as paginated UGC queries.
export const enabledCategorySQL=alias=>`(${alias}.active=1 AND (json_extract(${alias}.data,'$.parentId') IS NULL OR EXISTS(SELECT 1 FROM categories category_parent WHERE category_parent.id=json_extract(${alias}.data,'$.parentId') AND category_parent.active=1 AND json_extract(category_parent.data,'$.parentId') IS NULL)))`;
export async function saveCategory(db,b,user){
  id(b.id);if(typeof b.active!=='boolean')fail(400,'Active flag required.');
  if(b.parentId!==undefined&&b.parentId!==null&&typeof b.parentId!=='string')fail(400,'Invalid parent category.');
  const rows=await categoryList(db),old=rows.find(c=>c.id===b.id),parentId=b.parentId===undefined?(old?.parentId||null):b.parentId||null;
  if(parentId){
    id(parentId);const parent=rows.find(c=>c.id===parentId);
    if(parentId===b.id||!parent||parent.parentId||rows.some(c=>c.parentId===b.id))fail(400,'Gunakan kategori utama sebagai induk. Maksimal 2 tingkat; tidak boleh melingkar / Use a root category; maximum two levels, no cycles.');
  }
  const revision=(old?.revision||0)+1;
  if(b.revision!==undefined&&b.revision!==(old?.revision||0))fail(409,'Kategori berubah. Muat ulang / Category changed. Reload.');
  const data={id:b.id,parentId,revision,nameId:text(b.nameId,60),nameEn:text(b.nameEn,60),descriptionId:text(b.descriptionId??'',160,false),descriptionEn:text(b.descriptionEn??'',160,false)};
  // Recheck tree structure and old revision atomically; concurrent moves cannot form a cycle.
  const structure=`(? IS NULL OR (?<>? AND EXISTS(SELECT 1 FROM categories p WHERE p.id=? AND json_extract(p.data,'$.parentId') IS NULL) AND NOT EXISTS(SELECT 1 FROM categories child WHERE json_extract(child.data,'$.parentId')=?)))`;
  const guard=[parentId,parentId,b.id,parentId,b.id];
  const write=await db.run(`INSERT INTO categories(id,data,active) SELECT ?,?,? WHERE ${structure} ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=excluded.active WHERE coalesce(json_extract(categories.data,'$.revision'),0)=? AND ${structure}`,b.id,JSON.stringify(data),+b.active,...guard,old?.revision||0,...guard);
  if(!write.meta.changes)fail(409,'Struktur kategori berubah. Muat ulang / Category tree changed. Reload.');
  await db.run('INSERT INTO audit(id,actor,action,target,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),user.id,'categories.save',b.id,Date.now());
  return {ok:true,revision};
}
