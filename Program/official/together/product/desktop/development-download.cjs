/* @file-map:start
文件: link/desktop/development-download.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/transfer-recovery.cjs
上游: AIDEBUG/development-download.test.cjs, link/desktop/cloud-client.cjs, link/desktop/official-tools.cjs
链路: source-transfer
验证: AIDEBUG/development-download.test.cjs, AIDEBUG/transfer-recovery.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  failure | function
  download | function
  download.abort | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const /* @chain-region failure | calls: Object.assign, Error */ failure=(message,status=503,code='download_interrupted')=>Object.assign(Error(message),{status,code});
const {watchStall,recover,backoff}=require('./transfer-recovery.cjs');

// A verified artifact keeps its partial bytes across a dropped stream and app restarts.
/* @chain-region download | calls: Set, Number.isSafeInteger, failure, JSON.stringify, fs.mkdirSync, path.dirname, fs.readFileSync, isFile … */ async function download({artifact,target,fetchImpl,request,active,controllers=new Set(),progress=()=>{},diagnostic=()=>{},idleMs=60000,segmentBytes=4*1024*1024,sleep,signal,requireDigest=false}){
 if(!Number.isSafeInteger(segmentBytes)||segmentBytes<1)throw failure('下载分段无效',400,'download_range');
 const partial=target+'.partial',record=partial+'.json',identity=JSON.stringify({file:artifact.file,size:artifact.size,sha256:artifact.sha256});
 fs.mkdirSync(path.dirname(target),{recursive:true});
 let received=0;
 try{if(fs.readFileSync(record,'utf8')===identity&&fs.statSync(partial).isFile())received=fs.statSync(partial).size;}catch{}
 if(received<0||received>artifact.size)received=0;
 if(!received)await fs.promises.writeFile(partial,Buffer.alloc(0),{mode:0o600});
 await fs.promises.writeFile(record,identity,{mode:0o600});progress(received,artifact.size,{retrying:false});
 let failures=0;
 while(received<artifact.size){
  active();const offset=received,end=Math.min(artifact.size-1,offset+segmentBytes-1),controller=new AbortController();controllers.add(controller);
  const /* @chain-region download.abort | calls: controller.abort */ abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const watch=watchStall(controller,idleMs),started=Date.now();
  let handle,httpStatus=0,cause,body,expected,retry,route;
  try{
   const {url,headers}=request(offset,end);
   route=new URL(url).pathname;
   const response=await fetchImpl(url,{headers:{...headers,range:'bytes='+offset+'-'+end},redirect:'error',signal:controller.signal});
   body=response.body;httpStatus=response.status;watch.touch();
   if(!response.ok){const error=failure([401,403].includes(httpStatus)?'下载权限已失效':'下载暂不可用',httpStatus);error.retryAfter=Number(response.headers.get('retry-after'))||0;throw error;}
   if(requireDigest&&response.headers.get('x-content-sha256')!==artifact.sha256)throw failure('下载摘要与发布记录不符',502,'download_identity');
   if(response.status===206){
    const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
    if(!range||Number(range[1])!==offset||Number(range[3])!==artifact.size||Number(range[2])<offset||Number(range[2])>end)throw failure('下载范围不符',502,'download_range');
    expected=Number(range[2])+1;
   }else if(response.status===200){
    // Some origins ignore Range. Restart only when the response explicitly contains the whole object.
    const length=Number(response.headers.get('content-length'));
    if(length&&length!==artifact.size)throw failure('下载大小不符',502,'download_size');
    if(offset){received=0;progress(0,artifact.size,{retrying:false});}expected=artifact.size;
   }else throw failure('下载响应无效',502,'download_range');
   handle=await fs.promises.open(partial,received?'a':'w',0o600);
   for await(const chunk of body){
    active();watch.touch();if(received+chunk.length>expected)throw failure('下载大小不符',502,'download_size');
    await handle.writeFile(chunk);received+=chunk.length;progress(received,artifact.size,{retrying:false});
   }
   if(received!==expected)throw failure('下载连接中断');
   failures=0;
  }catch(error){
   cause=error.cause?.code||error.code||error.name;active();
   if(![408,429,500,502,503,504].includes(error.status||503)||['download_range','download_size','download_identity'].includes(error.code)||/^(?:ENOSPC|EACCES|EPERM|EROFS|EIO)$/.test(error.code||''))throw error;
   failures=received>offset?1:failures+1;
   retry=backoff(failures,error.retryAfter);
   progress(received,artifact.size,{retrying:true,status:httpStatus});
  }finally{
   watch.close();controller.abort();signal?.removeEventListener('abort',abort);
   if(handle)await handle.close();else try{await body?.cancel();}catch{}
   controllers.delete(controller);
   diagnostic({at:new Date().toISOString(),route,method:'GET',status:httpStatus,offset,end,received,total:artifact.size,cause,duration:Date.now()-started});
  }
  if(retry!==undefined)await recover(retry,active,sleep);
 }
 active();const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(partial))digest.update(chunk);
 if(digest.digest('hex')!==artifact.sha256){await fs.promises.unlink(partial);await fs.promises.unlink(record);throw failure('下载校验失败，请重新下载',502,'download_checksum');}
 active();await fs.promises.rename(partial,target);await fs.promises.unlink(record);progress(received,artifact.size,{retrying:false});return {path:target};
}
module.exports={download};
