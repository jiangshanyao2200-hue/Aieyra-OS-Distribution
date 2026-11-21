/* @file-map:start
文件: link/desktop/official-tools.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/development-download.cjs, link/desktop/transfer-recovery.cjs
上游: AIDEBUG/transfer-recovery.test.cjs, link/desktop/cocreation.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/transfer-recovery.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  digest | function
  read | function
  read.abort | function
  install | function
  install.length | function
  install.request | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {watchStall,recover,backoff}=require('./transfer-recovery.cjs');
const /* @chain-region digest | calls: crypto.createHash, fs.createReadStream, h.update, h.digest */ digest=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
/* @chain-region read | calls: active, AbortController, signal.addEventListener, abort, watchStall, fetch, watch.touch, Object.assign … */ async function read(url,json=false,{active,signal,method='GET',headers={},inspect}={}){
 let failures=0;
 while(true){
  active();const controller=new AbortController(),/* @chain-region read.abort | calls: controller.abort */ abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const watch=watchStall(controller);let response,retry;
  try{
   response=await fetch(url,{redirect:'error',method,headers,signal:controller.signal});watch.touch();
   if(!response.ok)throw Object.assign(Error('构建工具下载失败'),{status:response.status,retryAfter:Number(response.headers.get('retry-after'))||0});
   if(inspect)return inspect(response);
   const parts=[];let size=0;for await(const chunk of response.body){active();watch.touch();size+=chunk.length;if(size>16*1024*1024)throw Object.assign(Error('构建工具清单无效'),{status:422});parts.push(chunk);}
   const text=Buffer.concat(parts).toString('utf8');
   if(!json)return text;
   try{return JSON.parse(text);}catch{throw Object.assign(Error('构建工具清单无效'),{status:422});}
  }catch(error){active();if(![408,429,500,502,503,504].includes(error.status||503))throw error;retry=backoff(++failures,error.retryAfter);}
  finally{watch.close();controller.abort();signal?.removeEventListener('abort',abort);try{await response?.body?.cancel();}catch{}}
  await recover(retry,active);
 }
}
/* @chain-region install | calls: read, releases.find, release.files.find, f.filename.endsWith, Error, Number, split, r.version.slice … */ async function install({kind,version,target,cache,python,extractor,active,signal}){
 let file,sha,url,prefix,size;const options={active,signal};
 if(kind==='go'){
  const releases=await read('https://go.dev/dl/?mode=json&include=all',true,options);
  const release=releases.find(r=>r.version==='go'+version);
  const item=release?.files.find(f=>f.os==='windows'&&f.arch==='amd64'&&f.kind==='archive'&&f.filename.endsWith('.zip'));
  if(!item)throw Error('暂未找到源码要求的 Go '+version+'。');
  file=item.filename;sha=item.sha256;url='https://dl.google.com/go/'+file;prefix='go';size=item.size;
 }else{
  const releases=await read('https://nodejs.org/dist/index.json',true,options),release=releases.find(r=>r.lts&&Number(r.version.slice(1).split('.')[0])>=22&&r.files.includes('win-x64-zip'));
  if(!release)throw Error('暂未找到 Node.js 构建工具。');
  prefix='node-'+release.version+'-win-x64';file=prefix+'.zip';url='https://nodejs.org/dist/'+release.version+'/'+file;
  sha=(await read('https://nodejs.org/dist/'+release.version+'/SHASUMS256.txt',false,options)).split(/\r?\n/).map(l=>l.trim().split(/\s+/)).find(r=>r[1]===file)?.[0];
 }
 if(!/^[a-f0-9]{64}$/.test(sha||'')||!/^[-A-Za-z0-9._]+\.zip$/.test(file))throw Error('构建工具清单无效。');
 fs.mkdirSync(cache,{recursive:true});const archive=path.join(cache,file);
 let cached=false;try{cached=await digest(archive)===sha;}catch{}
 if(!cached){
  if(!Number.isSafeInteger(size)||size<1){
   const /* @chain-region install.length | calls: Number, split, r.headers.get */ length=r=>Number(r.headers.get('content-range')?.split('/')[1]||r.headers.get('content-length'));
   try{size=await read(url,false,{...options,method:'HEAD',inspect:length});}
   catch(error){if(![405,501].includes(error.status))throw error;size=await read(url,false,{...options,headers:{range:'bytes=0-0'},inspect:length});}
  }
  if(!Number.isSafeInteger(size)||size<1||size>1024**3)throw Error('构建工具大小无效。');
  await require('./development-download.cjs').download({artifact:{file,size,sha256:sha},target:archive,fetchImpl:fetch,/* @chain-region install.request */ request:()=>({url,headers:{}}),active,signal});
 }
 active();
 await run(python,['-X','utf8','-B',extractor,'--archive',archive,'--target',target,'--prefix',prefix,'--sha256',sha],{windowsHide:true,timeout:180000});
 active();return {path:target};
}
module.exports={install};
