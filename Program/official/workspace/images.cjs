'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const check=r=>{if(r?.ok===false)throw Error(r.error||r.failed?.[0]?.message||'图片任务未完成');return r;};
// A pending receipt is reconciled against its OS batch, never submitted again
// after an uncertain reply. The canvas owns only asset import and placement.
function createCanvasImages({root,call,storage,broadcast=()=>{}}){
 const active=new Map();let closed=false;
 const directory=path.join(root,'image-receipts');
 const write=(file,value)=>{fs.mkdirSync(directory,{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);};
 const batchID=p=>'canvas-'+crypto.createHash('sha256').update(p.projectId+'\n'+p.runId).digest('hex').slice(0,40);
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 async function generate(p){
  if(closed)throw Error('画布图片服务已停止');
  if(!p.runId||!p.projectId||!String(p.prompt||'').trim())throw Error('生图需要项目、任务编号和正文');
  const s=storage(),project=s.getProjectById(p.projectId,s.readProjectList());
  if(!project||project.kind!=='image'||project.quarantine?.readOnly)throw Error('画布项目不可写');
  const id=batchID(p),digest=crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex'),file=path.join(directory,id+'.json');
  if(active.has(id)){if(active.get(id).digest!==digest)throw Error('原图片请求的参数已变化');return active.get(id).promise;}
  const old=fs.existsSync(file)?read(file):null;
  if(old&&old.digest!==digest)throw Error('原图片请求的参数已变化');
  if(old?.state==='completed')return old.result;
  const entry={digest,cancelled:false,promise:null};
  entry.promise=Promise.resolve().then(async()=>{
   let receipt;
   if(old){
    receipt=check(await call({action:'status',batch_id:id,limit:100}));
    if(['persistence_failed','accounting_failed'].includes(receipt.state))receipt=check(await call({action:'recover',batch_id:id,limit:100}));
    if(receipt.state!=='completed')throw Error('原图片任务尚无完整回执，请先核对批次 '+id);
   }else{
    const localImage=image=>{
     if(!image)return '';
     if(image.path){const real=s.resolveReadableImageAsset(image.path);if(!real)throw Error('参考图已变化或不属于画布');return real;}
     const data=image.dataUrl||image.data;
     if(typeof data==='string'&&data.startsWith('data:image/'))return s.writeDataUrlOutput(data,id,'input',p.projectId,{subdir:'imports'}).path;
     throw Error('参考图缺少可读取的原图');
    };
    const references=[p.editImage,...p.referenceImages||[]].filter(Boolean),sources=references.map(localImage);
    const descriptions=references.map((a,i)=>[a.displayCode,a.role,a.purpose].filter(Boolean).length?`图像输入 ${i+1}：${[a.displayCode,a.role,a.purpose].filter(Boolean).join('；')}`:'').filter(Boolean);
    const prompt=descriptions.length?`${p.prompt}\n\n${descriptions.join('\n')}`:p.prompt;
    const mask=localImage(p.maskImage||(p.maskDataUrl?{dataUrl:p.maskDataUrl}:null));
    const args={request_id:id,operation:sources.length?'edit':'generate',prompt,model_requested:p.model||undefined,size:p.size||undefined,quality:p.quality||undefined,
     quality_reason:['medium','low'].includes(p.quality)?'用户在画布生图面板选择 '+p.quality:undefined,
     images:sources,mask:mask||undefined,count:p.count||1,output_format:p.outputFormat,output_compression:p.outputCompression,background:p.background,moderation:p.moderation,input_fidelity:p.inputFidelity};
    if(entry.cancelled||closed)throw Error('图片任务已取消');
    write(file,{state:'pending',digest,id,projectId:p.projectId,runId:p.runId,startedAt:Date.now(),input:p});
    const prepared=check(await call({...args,action:'create',expected_configuration:p.expectedConfiguration,limit:100}));
    if(entry.cancelled||closed)throw Error('图片任务已取消');
    receipt=prepared;
    for(let group=0;group<5&&(receipt.state==='prepared'||receipt.state==='partial'&&!receipt.unknown&&!receipt.failed?.length&&receipt.items?.some(item=>item.state==='prepared'));group++){
     if(entry.cancelled||closed)throw Error('图片任务已取消');
     receipt=check(await call({action:'run',batch_id:id,max_items:20,concurrency:1,limit:100}));
     if(receipt.state!=='partial'||receipt.unknown||receipt.failed?.length||!receipt.items?.some(item=>item.state==='prepared'))break;
    }
   }
   if(receipt.state!=='completed'||!receipt.images?.length)throw Error(receipt.failed?.[0]?.message||'图片结果尚未完整返回；请核对原批次');
   const imported=check(await s.handlers.get('aieyra:asset:import-local-images')({sender:{id:0}}, {projectId:p.projectId,paths:receipt.images.map(i=>i.path)}));
   const assets=(imported.assets||[]).map(asset=>({...asset,runId:p.runId}));
   if(assets.length!==receipt.images.length)throw Error('图片已生成，但画布导入尚未完整，请从原批次恢复');
   const result={ok:true,images:assets,assets,runId:p.runId,size:p.size,model:receipt.model,batchId:id};
   write(file,{...read(file),state:'completed',result});return result;
  }).catch(error=>{if(fs.existsSync(file))write(file,{...read(file),state:entry.cancelled?'cancelled':'failed',error:error.message,cancelled:entry.cancelled});throw error;}).finally(()=>{active.delete(id);broadcast('aieyra:matrix:changed',{kind:'images',projectId:p.projectId});});
  active.set(id,entry);return entry.promise;
 }
 async function cancel(runId,projectId){
  runId=String(runId||'').replace(/^manual-image:/,'');
  if(!runId)throw Error('没有该图像任务');
  const rows=receiptRows();
  if(!projectId){
   const matches=rows.filter(r=>r.runId===runId||r.id===runId||r.input?.placementRunId===runId),projects=new Set(matches.map(r=>r.projectId));
   if(!projects.size)throw Error('没有该图像任务');
   if(projects.size!==1)throw Error('图片任务编号属于多个画布，请指定 projectId');
   projectId=matches[0].projectId;
  }
  runId=rows.find(r=>r.projectId===projectId&&r.id===runId)?.runId||runId;
  // A single managed image uses its own run ID as placementRunId. Traverse
  // receipt links once so self-links and old cyclic groups cannot recurse.
  const children=new Map(),known=new Set();
  for(const r of rows){
   if(r.projectId!==projectId||!r.runId)continue;
   known.add(r.runId);
   const parent=r.input?.placementRunId;
   if(parent){if(!children.has(parent))children.set(parent,new Set());children.get(parent).add(r.runId);}
  }
  const waiting=[runId],seen=new Set(),targets=new Set();
  while(waiting.length){
   const next=waiting.pop();if(seen.has(next))continue;seen.add(next);
   if(known.has(next))targets.add(next);
   for(const child of children.get(next)||[])if(!seen.has(child))waiting.push(child);
  }
  if(!targets.size)targets.add(runId);
  const results=await Promise.all([...targets].map(async target=>{
   const id=batchID({runId:target,projectId}),entry=active.get(id);if(entry)entry.cancelled=true;
   return check(await call({action:'cancel',batch_id:id}));
  }));
  return {...(results.length===1?results[0]:{}),ok:true,cancelled:true};
 }
 async function recover(p){
  const file=path.join(directory,batchID(p)+'.json');if(!fs.existsSync(file))throw Error('没有原图片回执');
  const receipt=read(file);return generate(receipt.input);
 }
 function receiptRows(){return fs.existsSync(directory)?fs.readdirSync(directory).filter(f=>/^canvas-[a-f0-9]+\.json$/.test(f)).map(f=>read(path.join(directory,f))):[];}
 function jobs(){
  const groups=new Map();for(const r of receiptRows()){const key=r.projectId+'\n'+(r.input?.placementRunId||r.runId);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  return [...groups.values()].map(rows=>{
   const first=rows[0],id=first.input?.placementRunId||first.runId,assets=rows.flatMap(r=>r.result?.assets||[]),running=rows.some(r=>active.has(r.id));
   const project=storage().getProjectById(first.projectId,storage().readProjectList()),session=project&&storage().projectSessionFromDisk(project);
   const paths=new Set((session?.nodes||[]).flatMap(n=>(n.assets||[]).map(a=>a.path))),delivered=assets.length>0&&assets.every(a=>paths.has(a.path));
   const status=running?'running':rows.every(r=>r.state==='completed')?'completed':rows.every(r=>r.state==='cancelled')?'cancelled':'error';
   const actions=assets.length?[{type:'workflow.node.create',toolRunId:id,node:{id,nodeType:'image',title:'图片成果',prompt:first.input.prompt,assets,imageState:status==='completed'?'done':'error',imageError:rows.find(r=>r.error)?.error,imageParams:{size:first.input.size,count:assets.length}}}]:[];
   return {id,parentRunId:id,projectId:first.projectId,conversationId:session?.activeConversationId||'main',prompt:first.input.prompt,input:first.input,status,startedAt:first.startedAt,actions,delivered:delivered||running,result:{actions,envelope:{ok:status==='completed',summary:rows.find(r=>r.error)?.error||'图片已保存'}}};
  });
 }
 return {generate,cancel,recover,models:()=>call({action:'models'}),list:jobs,
  receipts:()=>receiptRows().map(r=>({id:r.id,runId:r.runId,projectId:r.projectId,state:active.has(r.id)?'running':r.state,error:r.error,result:r.result})),
  async close(){closed=true;for(const v of active.values())v.cancelled=true;await Promise.allSettled([...active.keys()].map(id=>call({action:'cancel',batch_id:id})));await Promise.allSettled([...active.values()].map(v=>v.promise));},resume(){closed=false;}};
}
module.exports={createCanvasImages};
