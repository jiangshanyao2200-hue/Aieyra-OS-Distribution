'use strict';
// Durable local media and edits. Both the canvas and its Agent use these same
// operations; reopening reads records and never starts an export by itself.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{Readable}=require('node:stream');
const idPattern=/^[a-zA-Z0-9_-]{1,96}$/;
const clone=value=>structuredClone(value);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function createCanvasVideoMedia({root,runtimeRoot,broadcast=()=>{},assertActive=()=>{}}){
 const directory=path.join(root,'media'),file=path.join(directory,'index.json'),running=new Map(),imports=new Set();
 let stopped=false,closing=false,index=null;
 function check(){assertActive();if(stopped||closing)throw Error('视频服务已停止');}
 function save(){fs.mkdirSync(directory,{recursive:true});const tmp=file+'.tmp-'+crypto.randomUUID();fs.writeFileSync(tmp,JSON.stringify(index),{flag:'wx'});fs.renameSync(tmp,file);}
 function read(){
  check();if(index)return index;
  index=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,assets:{},timelines:{},jobs:{}};
  if(index.version!==1||!index.assets||!index.timelines||!index.jobs)throw Error('视频资料格式不可读取，原件已保留');
  let changed=false;for(const job of Object.values(index.jobs))if(['queued','running','cancelling'].includes(job.state)){job.state='interrupted';job.error='上次导出已中断，可检查素材后重新导出';changed=true;}
  if(changed)save();return index;
 }
 function identity(value){if(typeof value!=='string'||!idPattern.test(value))throw Error('无效的视频编号');return value;}
 function scoped(collection,id,projectId){const item=read()[collection][identity(id)];if(!item||item.projectId!==projectId)throw Error('视频资料不属于当前画布');return item;}
 function location(asset){
  const target=path.join(directory,'assets',identity(asset.id)+asset.extension),stat=fs.lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==asset.bytes)throw Error('视频素材已改变或不可读取');
  if(fs.realpathSync(path.dirname(target))!==path.resolve(directory,'assets'))throw Error('视频素材目录已被重定向');
  return target;
 }
 function publish(job){save();broadcast('aieyra:video:changed',{projectId:job.projectId,job:clone(job)});}
 function execute(binary,args,{signal,progress,timeout=120000}={}){
  check();if(signal?.aborted)return Promise.reject(Error('视频操作已取消'));
  const exe=path.join(runtimeRoot,binary+'.exe');
  if(!fs.existsSync(exe))return Promise.reject(Error('视频运行组件不可用，请修复当前安装'));
  return new Promise((resolve,reject)=>{
   let stdout='',stderr='',progressBuffer='',timedOut=false,settled=false;
   const child=spawn(exe,args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
   const abort=()=>child.kill(),timer=setTimeout(()=>{timedOut=true;abort();},timeout);
   signal?.addEventListener('abort',abort,{once:true});
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(stdout);};
   child.on('error',finish);
   child.stdout.on('data',data=>{
    if(!progress){stdout+=data;if(stdout.length>1024*1024){abort();finish(Error('视频检查输出超过上限'));}return;}
    progressBuffer+=data;const lines=progressBuffer.split(/\r?\n/);progressBuffer=lines.pop();
    for(const line of lines){const match=/^out_time_us=(\d+)$/.exec(line);if(match)progress(Number(match[1])/1e6);}
   });
   child.stderr.on('data',data=>{stderr=(stderr+data).slice(-16000);});
   child.on('close',code=>finish(signal?.aborted?Error('视频操作已取消'):timedOut?Error('视频操作超时'):code?Error('视频处理失败：'+stderr.slice(-1200)):null));
  });
 }
 async function probe(source,signal){
  const result=JSON.parse(await execute('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi','-show_format','-show_streams','-of','json',source],{signal}));
  const video=result.streams?.find(s=>s.codec_type==='video'),duration=Number(result.format?.duration||video?.duration);
  if(!video||!Number.isFinite(duration)||duration<=0||duration>21600||video.width<1||video.height<1||video.width>16384||video.height>16384)throw Error('请选择长度不超过6小时的有效视频');
  return {duration,width:video.width,height:video.height,codec:video.codec_name,audio:result.streams.some(s=>s.codec_type==='audio')};
 }
 async function fileHash(source){const sum=crypto.createHash('sha256');for await(const block of fs.createReadStream(source))sum.update(block);return sum.digest('hex');}
 function view(asset){return {...clone(asset),src:'iiimage-asset://local/media/'+asset.id};}
 async function importFile(projectId,source,{name,provenance,signal}={}){
  read();if(!path.isAbsolute(source))throw Error('请选择本地视频文件');
  const extension=path.extname(source).toLowerCase();if(!['.mp4','.mov','.m4v','.webm','.mkv','.avi'].includes(extension))throw Error('支持 MP4、MOV、WebM、MKV 或 AVI 视频');
  const stat=await fs.promises.stat(source);check();if(!stat.isFile()||stat.size<12||stat.size>2*1024**3)throw Error('请选择不超过2GB的视频文件');
  const id=crypto.randomUUID(),folder=path.join(directory,'assets'),dest=path.join(folder,id+extension),controller=new AbortController();
  let finish;const work={controller,done:new Promise(resolve=>{finish=resolve;})},abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  imports.add(work);
  try{
   fs.mkdirSync(folder,{recursive:true});
   await fs.promises.copyFile(source,dest,fs.constants.COPYFILE_EXCL);check();if(controller.signal.aborted)throw Error('视频操作已取消');
   const info=await probe(dest,controller.signal),sha256=await fileHash(dest);check();if(controller.signal.aborted)throw Error('视频操作已取消');
   const existing=Object.values(index.assets).find(a=>a.projectId===projectId&&a.sha256===sha256);if(existing){fs.unlinkSync(dest);return view(existing);}
   const asset={id,projectId,name:String(name||path.basename(source)).slice(0,240),extension,bytes:fs.statSync(dest).size,sha256,...info,created:new Date().toISOString(),...(provenance?{provenance:clone(provenance)}:{})};
   index.assets[id]=asset;save();broadcast('aieyra:video:changed',{projectId,asset:view(asset)});return view(asset);
  }catch(error){fs.rmSync(dest,{force:true});throw error;}finally{imports.delete(work);signal?.removeEventListener('abort',abort);finish();}
 }
 function edits(projectId,value){
  if(!Array.isArray(value.clips)||value.clips.length>30)throw Error('每份剪辑最多保存30个片段');
  const clips=value.clips.map(c=>{
   const asset=scoped('assets',c.assetId,projectId),start=Number(c.start),end=Number(c.end);location(asset);
   if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>asset.duration+.001||end-start<.04)throw Error('片段的起止时间超出视频范围');
   return {assetId:asset.id,start,end};
  });
  const width=Number(value.width??1280),height=Number(value.height??720),fps=Number(value.fps??30);
  if(![[1280,720],[1920,1080],[720,1280],[1080,1920]].some(([w,h])=>width===w&&height===h)||![24,30].includes(fps))throw Error('请选择支持的导出分辨率和帧率');
  if(clips.reduce((n,c)=>n+c.end-c.start,0)>3600)throw Error('单次导出最长1小时');
  return {clips,width,height,fps};
 }
 function createTimeline(projectId,args){
  const value=edits(projectId,args),id=crypto.randomUUID(),timeline={id,projectId,name:String(args.name||'视频剪辑').slice(0,120),revision:1,...value};
  index.timelines[id]=timeline;save();return clone(timeline);
 }
 function updateTimeline(projectId,args){
  const old=scoped('timelines',args.id,projectId);if(args.revision!==old.revision)throw Error('剪辑已由另一个入口修改，请读取最新版本后再保存');
  const value=edits(projectId,args),timeline={...old,...value,name:String(args.name??old.name).slice(0,120),revision:old.revision+1};
  index.timelines[old.id]=timeline;save();broadcast('aieyra:video:changed',{projectId,timeline:clone(timeline)});return clone(timeline);
 }
 async function render(job,signal){
  const temp=path.join(directory,'exports',job.id),timeline=job.timeline;fs.mkdirSync(temp,{recursive:true});
  try{
   job.state='running';publish(job);const duration=timeline.clips.reduce((n,c)=>n+c.end-c.start,0);let finished=0;
   for(let i=0;i<timeline.clips.length;i++){
    check();if(signal.aborted)throw Error('视频操作已取消');
    const clip=timeline.clips[i],asset=scoped('assets',clip.assetId,job.projectId),source=location(asset),length=clip.end-clip.start;
    if(await fileHash(source)!==asset.sha256)throw Error('原素材已变化，请重新导入后核对');
    const args=['-hide_banner','-v','error','-nostdin','-n','-threads','1','-filter_threads','1','-filter_complex_threads','1','-protocol_whitelist','file,pipe','-ss',String(clip.start),'-i',source];
    if(!asset.audio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
    args.push('-t',String(length),'-map','0:v:0','-map',asset.audio?'0:a:0':'1:a:0','-vf',`scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=decrease,pad=${timeline.width}:${timeline.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${timeline.fps}`,'-c:v','libx264','-preset','fast','-crf','20','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-shortest','-movflags','+faststart','-progress','pipe:1',path.join(temp,i+'.mp4'));
    let last=0;await execute('ffmpeg',args,{signal,timeout:Math.max(120000,length*10000),progress:seconds=>{const now=Date.now();if(now-last<500)return;last=now;job.progress=Math.min(.98,(finished+Math.min(length,seconds))/duration);broadcast('aieyra:video:changed',{projectId:job.projectId,job:clone(job)});}});finished+=length;
   }
   const list=path.join(temp,'clips.txt');fs.writeFileSync(list,timeline.clips.map((_,i)=>"file '"+i+".mp4'").join('\n'));
   const output=path.join(temp,'output.mp4');
   // AAC padding can extend individual MP4 timestamps. Normalize the final
   // continuous timeline to its requested duration and constant frame rate.
   await execute('ffmpeg',['-hide_banner','-v','error','-nostdin','-n','-threads','1','-filter_threads','1','-f','concat','-safe','1','-i',list,'-t',String(duration),'-vf',`fps=${timeline.fps}`,'-af','aresample=async=1:first_pts=0','-c:v','libx264','-preset','fast','-crf','20','-threads','1','-c:a','aac','-movflags','+faststart',output],{signal,timeout:Math.max(120000,duration*10000)});
   const asset=await importFile(job.projectId,output,{name:timeline.name+'.mp4',provenance:{exportId:job.id,timelineId:timeline.id,revision:timeline.revision},signal});
   if(signal.aborted)throw Error('视频操作已取消');job.state='completed';job.progress=1;job.assetId=asset.id;publish(job);
  }catch(error){job.state=signal.aborted?'cancelled':'failed';job.error=error.message;publish(job);}
  finally{fs.rmSync(temp,{recursive:true,force:true});running.delete(job.id);}
 }
 function startExport(projectId,args){
  const timeline=scoped('timelines',args.id,projectId);if(args.revision!==timeline.revision)throw Error('剪辑版本已变化，请确认后再导出');
  if(!timeline.clips.length)throw Error('请先添加视频片段再导出');
  const id=identity(args.requestId),fingerprint=hash(JSON.stringify(timeline)),prior=index.jobs[id];
  if(prior){if(prior.projectId!==projectId||prior.fingerprint!==fingerprint)throw Error('导出请求编号已用于另一个剪辑版本');return clone(prior);}
  if(running.size)throw Error('已有视频正在导出，请等待完成或取消后再开始');
  const job={id,projectId,fingerprint,timeline:clone(timeline),state:'queued',progress:0,created:new Date().toISOString()};
  index.jobs[id]=job;publish(job);const controller=new AbortController(),run={controller,done:null};running.set(id,run);run.done=render(job,controller.signal);return clone(job);
 }
 async function call(projectId,action,args={}){
  read();identity(projectId);
  if(action==='list')return {ok:true,assets:Object.values(index.assets).filter(a=>a.projectId===projectId).map(view),timelines:Object.values(index.timelines).filter(a=>a.projectId===projectId).map(clone),jobs:Object.values(index.jobs).filter(a=>a.projectId===projectId).map(clone)};
  if(action==='import')return {ok:true,asset:await importFile(projectId,args.path,args)};
  if(action==='create')return {ok:true,timeline:createTimeline(projectId,args)};
  if(action==='update')return {ok:true,timeline:updateTimeline(projectId,args)};
  if(action==='export')return {ok:true,job:startExport(projectId,args)};
  if(action==='status'){const job=scoped('jobs',args.requestId,projectId);return {ok:true,job:clone(job),...(job.assetId?{asset:view(scoped('assets',job.assetId,projectId))}:{})};}
  if(action==='cancel'){
   const job=scoped('jobs',args.requestId,projectId),run=running.get(job.id);if(run){job.state='cancelling';publish(job);run.controller.abort();await run.done;}return {ok:true,job:clone(job)};
  }
  throw Error('未知视频剪辑操作');
 }
 function response(id,request){
  const asset=read().assets[id];if(!asset)return new Response('Not found',{status:404});
  const source=location(asset),size=asset.bytes,range=request.headers.get('range');let start=0,end=size-1;
  if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||!match[1]&&!match[2])return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});if(!match[1])start=Math.max(0,size-Number(match[2]));else start=Number(match[1]);if(match[2]&&match[1])end=Math.min(end,Number(match[2]));if(start>=size||end<start)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});}
  const headers={'Content-Type':asset.extension==='.webm'?'video/webm':asset.extension==='.mkv'?'video/x-matroska':asset.extension==='.avi'?'video/x-msvideo':'video/mp4','Accept-Ranges':'bytes','Content-Length':String(end-start+1)};
  if(range)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  const stream=fs.createReadStream(source,{start,end});return new Response(Readable.toWeb(stream),{status:range?206:200,headers});
 }
 return {call,importFile,response,assetPath(projectId,id){return location(scoped('assets',id,projectId));},
  placed(projectId,id){const job=scoped('jobs',id,projectId);if(job.state!=='completed')throw Error('导出尚未完成');job.placed=true;save();},
  jobs:()=>index?Object.values(index.jobs).map(clone):[],active:()=>running.size>0,
  async close(){if(stopped)return;closing=true;for(const work of imports)work.controller.abort();for(const run of running.values())run.controller.abort();await Promise.allSettled([...running.values(),...imports].map(r=>r.done));stopped=true;},resume(){stopped=false;closing=false;}};
}
module.exports={createCanvasVideoMedia};
