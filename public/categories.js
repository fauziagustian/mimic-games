// Two levels: root theme and optional subcategory. Missing parentId is legacy root.
export function categoryEnabled(categories,id){
  const c=categories.find(c=>c.id===id);if(!c||c.active===false)return false;
  if(!c.parentId)return true;
  const parent=categories.find(p=>p.id===c.parentId);
  return !!parent&&!parent.parentId&&parent.active!==false;
}
export function categoryScope(categories=[],selected){
  if(!categoryEnabled(categories,selected))return [];
  return categories.filter(c=>categoryEnabled(categories,c.id)&&(c.id===selected||c.parentId===selected)).map(c=>c.id);
}
export function categoryTrail(categories=[],id){
  const c=categories.find(c=>c.id===id);if(!c)return [];
  const parent=c.parentId&&categories.find(p=>p.id===c.parentId);
  return parent?[parent,c]:[c];
}
export function orderedCategories(categories=[]){
  return categories.filter(c=>!c.parentId).flatMap(c=>[c,...categories.filter(child=>child.parentId===c.id)]);
}
export function categorySelection(categories,id){
  const c=categories.find(c=>c.id===id),rootId=c?.parentId||c?.id||categories.find(c=>!c.parentId)?.id||'';
  return {rootId,childId:c?.parentId?c.id:'',children:categories.filter(c=>c.parentId===rootId)};
}
