'use strict';
const crypto=require('node:crypto');
const {readGoal,resolveGoalImages,imageVersion}=require('./desktop/agent/workspace-goals.cjs');
const {normalizeImageInput}=require('./image-plan.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function createImageContext({storage,renderer,models}){
 return async(args,scope)=>{
  const s=storage(),project=s.getProjectById(scope.canvasProjectId,s.readProjectList());
  if(!project||project.kind!=='image'||project.quarantine?.readOnly)throw Error('图片任务所属画布不可写');
  const context=await renderer('images.context',{projectId:scope.canvasProjectId,nodeIds:args.nodeIds||[],input:args.input});
  if(context.ok===false||context.projectId!==scope.canvasProjectId)throw Error('图片任务画布归属已变化');
  const raw=structuredClone(args.input||{}),choice=await models();
  if(!choice.configured)throw Error('请先在 OS 设置中配置 Image Gen');
  if(raw.model&&raw.model!==choice.model)throw Error('图像模型已变化，请重新读取 OS 图像配置');
  const input=normalizeImageInput({...raw,model:choice.model});input.expectedConfiguration=choice.revision;
  const nodes=context.nodes||[],selected=new Set([...(args.nodeIds||[]),input.parentId,...[input.editImage,input.sourceImage,input.maskImage,...input.referenceImages||[]].map(a=>a?.nodeId)].filter(Boolean)),frozen=nodes.filter(n=>selected.has(n.id));
  if(frozen.length!==selected.size)throw Error('图片参考节点已删除，请重新选择');
  let goal,goalAssets=[];
  if(args.goalId){
   goal=readGoal(project.path,args.goalId);
   if(goal.status!=='active')throw Error('目标已暂停或完成');
   if(goal.revision!==args.goalRevision)throw Error('目标或反馈已更新，请重新读取后继续');
   const resolved=resolveGoalImages(goal,nodes);if(resolved.issues.length)throw Error(JSON.stringify(resolved.issues));goalAssets=resolved.assets;
   if(!input.parentId){const last=goal.checkpoints.find(c=>c.id===goal.selectedCheckpointId)||goal.checkpoints.at(-1);const note=nodes.find(n=>n.id===last?.noteNodeId);input.parentId=goal.feedbackMode==='notes'&&note?note.id:last?.outputs?.[0]?.nodeId||goalAssets[0]?.nodeId;}
  }else if(args.goalRevision!==undefined)throw Error('目标修订需要对应 goalId');
  const explicitAssets=nodes.filter(n=>(args.nodeIds||[]).includes(n.id)).flatMap(n=>(n.assets||[]).map((a,assetIndex)=>({...a,nodeId:n.id,assetIndex}))),references=[...(input.referenceImages||[]),...goalAssets,...explicitAssets];
  const resolve=a=>{
   if(typeof a==='string')a={path:a};
   if(a.dataUrl||a.data)return a;
   let value=a;
   if(a.assetIndex!==undefined&&(!Number.isInteger(a.assetIndex)||a.assetIndex<0))throw Error('来源图片序号必须从0开始');
   if(a.nodeId){const n=nodes.find(n=>n.id===a.nodeId);value=a.path&&a.assetIndex===undefined?n?.assets?.find(v=>v.path===a.path):n?.assets?.[a.assetIndex??0];if(!value)throw Error('来源图片序号不存在');}
   else if(a.assetId){const matches=nodes.flatMap(n=>n.assets||[]).filter(v=>v.assetId===a.assetId);const paths=new Set(matches.map(v=>v.path));if(paths.size!==1)throw Error('来源素材无法唯一确定');value=matches[0];}
   const file=value?.path&&s.resolveReadableImageAsset(value.path);if(!file)throw Error('参考图已删除或不属于画布');
   return {...value,...a,path:file,contentHash:imageVersion({...value,path:file})};
  };
  input.referenceImages=[...new Map(references.map(resolve).map(a=>[a.path||hash(a.dataUrl||a.data),a])).values()];
  const source=input.editImage||input.sourceImage||input.sourcePath||(input.sourceAssetId?{assetId:input.sourceAssetId}:null);
  const parent=nodes.find(n=>n.id===input.parentId);
  if(source)input.editImage=resolve(source);
  else if(parent?.assets?.length){const asset=resolve({nodeId:parent.id,assetIndex:input.assetIndex??0});if(input.operation==='generate')input.referenceImages.unshift(asset);else input.editImage=asset;}
  if(input.maskImage)input.maskImage=resolve(input.maskImage);
  if(['edit','replace','variants'].includes(input.operation)&&!input.editImage){const sources=input.referenceImages.filter(a=>String(a.role||'').toLowerCase()==='source'),choices=sources.length?sources:input.referenceImages;if(choices.length!==1)throw Error('编辑任务需要唯一原图，请指定 parentId 和 assetIndex');input.editImage=choices[0];}
  if(input.editImage)input.referenceImages=input.referenceImages.filter(a=>a.path? a.path!==input.editImage.path:hash(a.dataUrl||a.data)!==hash(input.editImage.dataUrl||input.editImage.data));
  input.referenceImages=[...new Map(input.referenceImages.map(a=>[a.path||hash(a.dataUrl||a.data),a])).values()];
  return {input,nodes,conversationId:context.conversationId||'main',identity:hash([choice.profile_id,choice.model,choice.revision,input,frozen.map(n=>({id:n.id,prompt:n.prompt,requirement:n.requirement,assets:(n.assets||[]).map(a=>({path:a.path,version:imageVersion(a)}))})),goal?.revision])};
 };
}
module.exports={createImageContext};
