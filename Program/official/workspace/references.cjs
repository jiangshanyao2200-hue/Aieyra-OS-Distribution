'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateProgramContext}=require('../../contract/reference-context.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createCanvasReferences({root,context,projectList,saved,flush,asset}){
 const inFlight=new Map();
 async function snapshot(projectId,nodeIds){
  const value=await context({projectId,nodeIds});
  // Include image bytes: a replaced file with the same name is a new reference.
  for(const node of value.nodes)for(const a of node.assets||[]){
   if(!a.path)continue;const file=asset(a.path);if(!file)throw Error('引用素材已删除或不可读，请重新选择');
   a.contentHash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return value;
 }
 async function options(p={}){
  const list=await projectList(),id=p.projectId||list.activeProjectId,project=list.projects.find(v=>v.id===id&&v.kind==='image');
  if(!project)throw Error('请选择可用画布');
  await flush(id);
  const all=await context({projectId:id,all:true});
  const entries=[...saved().filter(r=>r.sourceProjectId===id),...all.nodes.map(n=>({id:n.id,sourceProjectId:id,sourceNodeIds:[n.id],title:n.title||n.displayCode||n.id}))];
  const references=[];
  for(const r of entries){
   // Deleted saved selections stay in the draft and fail explicitly at send;
   // they should not prevent picking other current objects.
   if(!r.sourceNodeIds.every(id=>all.nodes.some(n=>n.id===id)))continue;
   const value=await snapshot(id,r.sourceNodeIds);
   references.push({...r,sourceProjectName:project.name,revision:value.revision,signature:hash(value.nodes),count:value.nodes.length});
  }
  return {ok:true,projectId:id,references};
 }
 async function prepare(p){
  let selected=validateProgramContext(p.context);
  const legacy=p.referenceIds;
  if(legacy!==undefined&&(!Array.isArray(legacy)||legacy.length>40||legacy.some(id=>typeof id!=='string'||id.length>160)))throw Error('画布引用编号无效');
  if(!selected&&!legacy?.length)return p;
  if(!/^[a-f0-9]{32}$/.test(p.id)||!/^[a-zA-Z0-9:_-]{1,160}$/.test(p.request_id||''))throw Error('引用发送需要稳定的会话和请求编号');
  const digest=hash({message:p.message,attachments:p.attachments||[],context:selected,...(legacy?.length?{projectId:p.projectId,referenceIds:legacy}:{})}),key=p.id+'/'+p.request_id;
  if(inFlight.has(key)){const prior=await inFlight.get(key);if(prior.digest!==digest)throw Error('请求编号已用于另一条消息');return {...p,message:prior.message,context:undefined};}
  const job=(async()=>{
   const dir=path.join(root,'reference-submissions',p.id),file=path.join(dir,hash(p.request_id)+'.json');
   if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.digest!==digest)throw Error('请求编号已用于另一条消息');return old;}
   if(!selected){
    await flush(p.projectId);
    const references=[];
    for(const id of legacy){const ref=saved().find(r=>r.id===id&&r.sourceProjectId===p.projectId);if(!ref)throw Error('引用已删除，请重新选择');references.push(ref);}
    selected=validateProgramContext({program:'workspace',references});
   }
   for(const id of new Set(selected.references.map(r=>r.sourceProjectId)))await flush(id);
   const values=[];
   for(const ref of selected.references){const value=await snapshot(ref.sourceProjectId,ref.sourceNodeIds);if(hash(value.nodes)!==ref.signature)throw Error('引用对象已变化，请重新选择：'+ref.title);values.push({...value,referenceId:ref.id,title:ref.title});}
   const receipt={digest,message:String(p.message||'')+'\n\n[画布对象引用]\n'+JSON.stringify(values)};
   fs.mkdirSync(dir,{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';let fd;
   try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(receipt));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temp,file);}finally{if(fd!=null)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
   return receipt;
  })();inFlight.set(key,job);
  try{return {...p,message:(await job).message,context:undefined};}finally{inFlight.delete(key);}
 }
 return {options,prepare,async create(projectId,nodeIds){await flush(projectId);const value=await snapshot(projectId,nodeIds);if(!value.nodes.length)throw Error('请选择画布对象');return {id:crypto.randomUUID(),sourceProjectId:projectId,sourceNodeIds:value.nodes.map(n=>n.id),title:value.nodes.map(n=>n.title||n.id).join(' · ').slice(0,1000),count:value.nodes.length,revision:value.revision,signature:hash(value.nodes)};}};
}
module.exports={createCanvasReferences};
