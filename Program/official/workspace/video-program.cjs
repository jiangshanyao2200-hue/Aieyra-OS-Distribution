'use strict';
// Program adapter for the same local editor and Core video task receipts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function createCanvasVideoProgram({media,scope,renderer,electron,videoCall,assertActive}){
 const checked=value=>{if(value?.ok===false)throw Error(value.error||'视频操作未完成');return value;};
 async function commit(projectId,result){
  if((result.asset||result.timeline)&&!result.job?.placed){
   const placement=checked(await renderer('videos.commit',{projectId,asset:result.asset,timeline:result.timeline}));
   if(result.job?.assetId)media.placed(projectId,result.job.id);
   return {...result,placement};
  }
  return result;
 }
 async function invoke(action,args={},meta={}){
  assertActive();const binding=await scope(args),projectId=binding.projectId;
  const stillCurrent=async()=>{assertActive();if((await scope(args)).projectId!==projectId)throw Error('当前画布已改变，请在原画布中继续');};
  if(action==='pick'){
   if(!meta.human)throw Error('请由用户点击导入视频，Agent可使用 videos.import 指定素材文件');
   const selected=await electron.dialog.showOpenDialog({title:'导入视频',properties:['openFile','multiSelections'],filters:[{name:'视频',extensions:['mp4','mov','m4v','webm','mkv','avi']}]});
   if(selected.canceled)return {ok:true,cancelled:true};await stillCurrent();
   const assets=[];
   for(const file of selected.filePaths){
    try{const result=await media.call(projectId,'import',{path:file});await commit(projectId,result);assets.push(result.asset);}
    catch(error){throw Error((assets.length?'已导入 '+assets.length+' 个视频。':'')+error.message);}
   }
   return {ok:true,assets};
  }
  if(action==='save_file'){
   if(!meta.human)throw Error('另存为需要用户选择目标位置；视频路径可从原始任务回执读取');
   const source=media.assetPath(projectId,args.assetId),selected=await electron.dialog.showSaveDialog({title:'保存视频',defaultPath:path.join(electron.app.getPath('videos'),path.basename(source)),filters:[{name:'视频',extensions:[path.extname(source).slice(1)]}]});
   if(selected.canceled||!selected.filePath)return {ok:true,cancelled:true};await stillCurrent();
   if(path.resolve(selected.filePath)===path.resolve(source))return {ok:true,path:source};
   const temp=selected.filePath+'.tmp-'+crypto.randomUUID();
   try{await fs.promises.copyFile(source,temp,fs.constants.COPYFILE_EXCL);await stillCurrent();await fs.promises.rename(temp,selected.filePath);}
   finally{fs.rmSync(temp,{force:true});}
   return {ok:true,path:selected.filePath};
  }
  if(action==='task'){
   if(!videoCall)throw Error('当前宿主未提供视频生成连接');
   const {projectId:_projectId,...request}=args,result=checked(await videoCall(request));await stillCurrent();
   if(result.path){
    const asset=await media.importFile(projectId,result.path,{name:'生成视频 '+result.request_id+'.mp4',provenance:{requestId:result.request_id,taskId:result.task_id,sha256:result.sha256}});
    return commit(projectId,{ok:true,generation:result,asset});
   }
   return {ok:true,generation:result};
  }
  if(action==='attach'){
   const list=await media.call(projectId,'list'),asset=list.assets.find(a=>a.id===args.assetId);
   if(!asset)throw Error('视频素材不属于当前画布');return commit(projectId,{ok:true,asset});
  }
  if(action==='list'){
   const list=await media.call(projectId,'list');
   for(const job of list.jobs)if(job.state==='completed'&&!job.placed)await commit(projectId,await media.call(projectId,'status',{requestId:job.id}));
   return media.call(projectId,'list');
  }
  const result=await media.call(projectId,action,args);await stillCurrent();return commit(projectId,result);
 }
 return {invoke};
}
module.exports={createCanvasVideoProgram};
