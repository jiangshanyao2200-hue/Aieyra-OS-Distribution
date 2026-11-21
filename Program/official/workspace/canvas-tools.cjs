'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicWriteJson}=require('./desktop/core/json-storage.cjs');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const checked=r=>{if(r?.ok===false)throw Error(r.error||'画布操作未完成');return r;};
function createCanvasTools({storage,renderer}){
 async function context(args){return checked(await renderer('images.context',{projectId:args.projectId,nodeIds:args.nodeIds||[]}));}
 function project(id){const s=storage(),p=s.getProjectById(id,s.readProjectList());if(!p||p.kind!=='image'||p.quarantine?.readOnly)throw Error('画布项目不可用');return p;}
 async function workflow(args,requestID){
  const c=await context(args),a=args.input||args,nodes=c.nodes||[],operation=a.operation||'list_nodes';
  const resolve=(id,title,selected=false)=>{
   const found=nodes.filter(n=>id?n.id===id||n.displayCode===id:title?n.title===title:selected&&n.id===c.selectedNodeId);
   if(found.length!==1)throw Error(found.length?'节点标题不唯一，请提供ID':'画布节点不存在，请重新读取');return found[0];
  };
  if(operation==='list_nodes'){
   const offset=Math.max(0,a.offset||0),limit=Math.min(100,Math.max(1,a.limit||25)),query=String(a.query||'').toLowerCase();
   const selected=nodes.filter(n=>(!a.type||n.type===a.type)&&(!a.relation||(a.relation==='root'?!n.parentId:n.parentId&&(n.relationType||'derived-from')===a.relation))&&(!query||JSON.stringify([n.id,n.title,n.prompt,n.requirement]).toLowerCase().includes(query)));
   return {ok:true,projectId:c.projectId,canvasRevision:c.canvasRevision,nodes:selected.slice(offset,offset+limit),total:selected.length,nextOffset:offset+limit<selected.length?offset+limit:null};
  }
  if(operation==='describe_node')return {ok:true,projectId:c.projectId,canvasRevision:c.canvasRevision,node:resolve(a.nodeId,a.nodeTitle,true)};
  if(args.canvasRevision!==undefined&&args.canvasRevision!==c.canvasRevision)throw Error('画布已变化，请重新读取后操作');
  let action;
  if(operation==='prepare_requirement'){
   const ids=[...new Set([...(a.inputNodeIds||[]),...(a.sourceNodeIds||[]),...(a.referenceNodeIds||[]),a.nodeId].filter(Boolean))];
   if(ids.length>40||ids.some(id=>resolve(id).type!=='image'))throw Error('需求便签最多连接40个已有图片节点');
   action={type:'workflow.requirement.prepare',operationId:requestID,toolRunId:requestID,inputNodeIds:ids,title:a.title,text:a.text,scenario:a.scenario,nodeId:a.nodeId};
  }else if(operation==='clear_canvas')action={type:'workflow.canvas.clear',mode:'all'};
  else if(operation==='connect_nodes')action={type:'workflow.node.connect',sourceId:resolve(a.sourceId,a.sourceTitle).id,targetId:resolve(a.targetId,a.targetTitle).id,relationType:a.relationType||'derived-from'};
  else{
   const node=resolve(a.nodeId,a.nodeTitle,true),id=node.id;
   if(operation==='focus_node')action={type:'workflow.node.focus',id};
   else if(operation==='disconnect_node')action={type:'workflow.node.disconnect',id,direction:a.direction||'input'};
   else if(operation==='delete_node')action={type:'workflow.node.delete',id,mode:a.deleteMode==='branch'?'branch':'only'};
   else if(operation==='update_node')action={type:'workflow.node.update',patch:{id,...Object.fromEntries(['title','prompt','status','x','y'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))}};
   else if(operation==='continue_node')action={type:'workflow.node.continue',id,prompt:a.prompt};
   else if(['redraw_node','cutout_node'].includes(operation)){
    if(node.type!=='image'||!node.assets?.[a.assetIndex||0])throw Error('图片序号已不存在');
    action={type:operation==='redraw_node'?'workflow.node.redraw':'workflow.node.cutout',id,kind:operation==='redraw_node'?'repaint':'cutout',assetIndex:a.assetIndex||0,prompt:a.prompt};
   }else throw Error('未知画布工作流操作');
  }
  return renderer('images.actions',{projectId:c.projectId,canvasRevision:c.canvasRevision,actions:[action]});
 }
 async function experience(args){
  const c=await context(args),p=project(c.projectId),a=args.input||args,file=path.join(p.path,'.iiimage','experience.json');
  if(a.scope&&a.scope!=='project')throw Error('绘图经验属于当前项目');
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,revision:0,entries:[],history:[]};
  if(state.version!==1||!Array.isArray(state.entries))throw Error('项目经验格式无法识别，原文件已保留');
  const current=()=>({ok:true,projectId:p.id,revision:state.revision,entries:state.entries,text:state.entries.map(e=>[e.title,e.text].filter(Boolean).join('\n')).join('\n\n')});
  const operation=a.action||'read';if(operation==='read')return current();
  if(!['add','write','replace','compact'].includes(operation))throw Error('未知经验操作');
  if(a.expectedRevision!==undefined&&a.expectedRevision!==state.revision)throw Error('项目经验已更新，请先合并最新内容');
  if(['replace','compact'].includes(operation)&&a.expectedRevision!==state.revision)throw Error('替换或整理经验需要刚读取的expectedRevision');
  const text=String(a.text||a.summary||'').trim();if(!text||text.length>64000)throw Error('项目经验正文需要1–64000个字符');
  if(['replace','compact'].includes(operation)){state.history.push({revision:state.revision,entries:state.entries});state.entries=[];}
  if(state.entries.reduce((n,e)=>n+e.text.length,0)+text.length>64000)throw Error('项目经验已满，请先读取并整理');
  state.entries.push({id:crypto.randomUUID(),title:String(a.title||'绘画经验').slice(0,160),text,rating:a.rating||'note',createdAt:new Date().toISOString()});state.revision++;
  fs.mkdirSync(path.dirname(file),{recursive:true});atomicWriteJson(file,state);return current();
 }
 async function view(args,many){
  const c=await context(args),p=project(c.projectId),a=args.input||args,s=storage();
  const node=a.nodeId?(c.nodes||[]).find(n=>n.id===a.nodeId||n.displayCode===a.nodeId):null;if(a.nodeId&&!node)throw Error('图片容器已不存在');
  const sources=node?node.assets||[]:many?a.paths:[a.path];if(!Array.isArray(sources)||!sources.length)throw Error('请提供图片路径或图片容器');
  const offset=a.offset||0;if(!Number.isInteger(offset)||offset<0||offset>=sources.length)throw Error('图片分页位置无效');
  const selected=sources.slice(offset,offset+(many?40:1)),paths=selected.map((asset,i)=>{const file=s.resolveReadableImageAsset(typeof asset==='string'?asset:asset.path);if(!file||fs.statSync(file).size>20*1024*1024)throw Error('第'+(offset+i+1)+'张图片不可读或超过20MiB');return file;});
  const detail=many?'high':a.detail==='original'?'original':'high';let file=paths[0];
  if(many&&paths.length>1){
   const sharp=require('sharp'),columns=Math.ceil(Math.sqrt(paths.length)),width=paths.length>12?280:420,height=paths.length>12?240:320,gap=12,composites=[];
   for(let index=0;index<paths.length;index++){
    const left=gap+index%columns*(width+gap),top=gap+Math.floor(index/columns)*(height+gap);
    const tile=await sharp(fs.readFileSync(paths[index]),{limitInputPixels:268402689}).rotate().resize(width,height-28,{fit:'contain',background:'#141c26',withoutEnlargement:true}).png().toBuffer();
    composites.push({input:tile,left,top:top+28},{input:Buffer.from(`<svg width="${width}" height="28" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#141c26"/><text x="12" y="19" fill="#d8e6ed" font-family="Arial,sans-serif" font-size="14">Image ${offset+index+1}</text></svg>`),left,top});
   }
   const bytes=await sharp({create:{width:columns*width+(columns+1)*gap,height:Math.ceil(paths.length/columns)*(height+gap)+gap,channels:4,background:'#080d14'}}).composite(composites).webp({quality:84}).toBuffer();
   const dir=path.join(p.path,'output','imagegen','_agent-review');fs.mkdirSync(dir,{recursive:true});file=path.join(dir,hash(bytes)+'.webp');if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});
  }
  return {ok:true,projectId:p.id,path:file,model_image:{path:file,detail},images:paths.map((path,i)=>({number:offset+i+1,path})),total:sources.length,nextOffset:offset+selected.length<sources.length?offset+selected.length:null};
 }
 return {workflow,experience,view};
}
module.exports={createCanvasTools};
