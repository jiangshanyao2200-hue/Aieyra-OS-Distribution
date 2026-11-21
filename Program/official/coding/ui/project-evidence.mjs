import {activityData} from '../../../../Tool/presentation/receipt.mjs';

export function projectMutation(item){
 return item?.tool==='apply_patch'||item?.tool==='project'&&/^(?:write|save|create|delete|move|rename|mkdir)$/.test(item.action||'');
}

// Paths are a display projection of actual operation targets, never commands.
export function projectRelative(target,base){
 const t=String(target||'').replaceAll('\\','/'),b=String(base||'').replaceAll('\\','/').replace(/\/$/,'');
 const relative=b&&t.toLowerCase().startsWith(b.toLowerCase()+'/')?t.slice(b.length+1):/^(?:[a-z]:|\/)/i.test(t)?'':t;
 return relative&&!relative.split('/').includes('..')?relative.replace(/^\.\//,''):'';
}
export function projectEvidence(operations,base){
 return operations.filter(projectMutation).flatMap(op=>{
  const raw=activityData(op),data=raw.result||raw;
  const files=Array.isArray(data.files)?data.files:[];
  const targets=files.length?files.map(file=>({path:file.new_path||file.path,change:file.operation})):(op.targets||[]).map(path=>({path}));
  return targets.map(target=>({path:projectRelative(target.path,base),change:target.change,operation:op.id,revision:op.revision,
   state:op.state,member:op.name||op.member,action:op.action||op.tool})).filter(row=>row.path);
 }).slice(-24).reverse();
}
