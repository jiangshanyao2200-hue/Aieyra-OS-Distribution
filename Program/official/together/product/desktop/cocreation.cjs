/* @file-map:start
文件: link/desktop/cocreation.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/official-tools.cjs, link/desktop/transfer-recovery.cjs
上游: AIDEBUG/transfer-recovery.test.cjs, link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/transfer-recovery.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  digest | function
  isSourceRead | function
  Development | class
  Development.constructor | method
  Development.send | method
  Development.active | method
  Development.message | method
  Development.message.active | function
  Development.message.progress | method
  Development.transferRead | method
  Development.transferRead.active | function
  Development.toolchain | method
  Development.toolchain.matches | function
  Development.toolchain.active | method
  Development.toolchain.filter | method
  Development.command | method
  Development.fail | method
  Development.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const readline=require('node:readline');
const /* @chain-region digest | calls: crypto.createHash, fs.createReadStream, h.update, h.digest */ digest=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};

/* @chain-region isSourceRead | calls: route.includes, route.indexOf, route.slice, URLSearchParams, revision.test, query.get, offset.test, Set … */ function isSourceRead(route) {
 if (typeof route !== 'string' || route.length > 4096 || route.includes('#')) return false;
 if (route === '/engineering/overview' || route === '/engineering/development') return true;
 const separator = route.indexOf('?');
 if (separator < 0) return false;
 const endpoint = route.slice(0, separator);
 const query = new URLSearchParams(route.slice(separator + 1));
 const revision = /^[a-f0-9]{64}$/;
 const offset = /^\d+$/;
 if (!revision.test(query.get('revision') || '') || !offset.test(query.get('offset') || '')) return false;
 if (new Set(query.keys()).size !== query.size) return false;
 if (endpoint === '/engineering/archive') {
  if (query.has('segments') && query.get('segments') !== '1') return false;
  if (query.has('reuse') && (!query.has('segments') || !revision.test(query.get('reuse')))) return false;
  return [...query.keys()].every(key => ['revision', 'offset', 'segments', 'reuse'].includes(key));
 }
 return endpoint === '/engineering/file' && query.size === 5 && !!query.get('path') &&
  offset.test(query.get('limit') || '') && query.get('transfer') === '1';
}

/* @chain-region Development */ class Development {
 /* @chain-region Development.constructor | calls: Object.assign, Map, AbortController, spawn, path.join, path.dirname, child.stdin.on, child.stderr.on … */ constructor({python,cli,cloud,account,directory,server,offscreen=false,changed=()=>{}}){
  Object.assign(this,{python,cli,cloud,account,directory,changed});this.generation=cloud.generation;this.pending=new Map();this.serial=0;
  this.value={state:'idle',sandbox:'Windows AppContainer'};this.closed=false;this.transferController=new AbortController();
  this.child=spawn(python,['-X','utf8','-B',path.join(path.dirname(cli),'cocreation.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  this.child.stdin.on('error',()=>{});let stderr='';
  this.child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-6000);});
  const lines=readline.createInterface({input:this.child.stdout});
  lines.on('line',line=>{if(line.length>8*1024*1024){this.close();return;}try{void this.message(JSON.parse(line));}catch{this.fail('本地开发服务响应无效。');}});
  this.child.once('error',()=>this.fail('无法启动本地开发服务。'));
  this.child.once('close',()=>{if(!this.closed)this.fail('本地开发服务已退出。'+stderr.slice(-500));});
  this.send({directory,server,account,offscreen});
 }
 /* @chain-region Development.send | calls: child.stdin.write, JSON.stringify */ send(value){if(!this.child.stdin.destroyed)this.child.stdin.write(JSON.stringify(value)+'\n');}
 /* @chain-region Development.active | calls: Error */ active(){if(this.closed||this.cloud.generation!==this.generation)throw Error('账号已变化，请重新打开云仓库。');}
 /* @chain-region Development.message | calls: changed, pending.get, pending.delete, clearTimeout, row.reject, Error, row.resolve, active … */ async message(value){
  if(this.closed||this.cloud.generation!==this.generation)return;
  if(value.state){this.value=value.state;this.changed(value.state);return;}
  if(value.id){const row=this.pending.get(value.id);if(row){this.pending.delete(value.id);clearTimeout(row.timer);value.error?row.reject(Error(value.error)):row.resolve(value.value);}return;}
  if(!value.rpc)return;
  const signal=this.transferController.signal,/* @chain-region Development.message.active | calls: active, Object.assign, Error */ active=()=>{this.active();if(signal.aborted)throw Object.assign(Error('已取消'),{status:499});};
  try{
   active();let result;
   if(value.kind==='cloud'){
    const route=value.payload?.route;
    if(!isSourceRead(route))throw Error('源码读取入口无效。');
    let progressAt=0;
    result=await this.transferRead(route,{signal,/* @chain-region Development.message.progress | calls: Date.now, changed */ progress:(received,total)=>{this.value={...this.value,page_received:received,page_total:total};if(Date.now()-progressAt>250){progressAt=Date.now();this.changed(this.value);}}});
   }else if(value.kind==='artifact'){
    const meta=await this.transferRead('/engineering/development',{signal}),artifact=value.payload?.artifact;
    if(!artifact||artifact.file!==meta.file||artifact.size!==meta.size||artifact.sha256!==meta.sha256)throw Error('下载版本已更新，请重试。');
    const target=path.join(this.directory,'cache',artifact.file);
    let cached=false;try{cached=fs.statSync(target).isFile()&&fs.statSync(target).size===artifact.size&&await digest(target)===artifact.sha256;}catch{}
    let progressAt=0;
    active();if(!cached)await this.cloud.downloadDevelopment(artifact,target,(received,total,transfer)=>{this.value={...this.value,received,total,...transfer};if(Date.now()-progressAt>250||received===total){progressAt=Date.now();this.changed(this.value);}},{signal});
    result={path:target};
   }else if(value.kind==='toolchain'){
    result=await this.toolchain(value.payload,signal);
   }else throw Error('本地开发请求无效。');
   active();this.send({rpc:value.rpc,value:result});
  }catch(error){this.send({rpc:value.rpc,error:error.message,status:error.status,retry_after:error.retryAfter});}
 }
 /* @chain-region Development.transferRead | calls: require, active, cloud.call, changed, includes, recover, backoff */ async transferRead(route,{signal,progress,sleep}={}){
  const {backoff,recover}=require('./transfer-recovery.cjs');let failures=0;
  const /* @chain-region Development.transferRead.active | calls: active, Object.assign, Error */ active=()=>{this.active();if(signal?.aborted)throw Object.assign(Error('已取消'),{status:499});};
  while(true){
   active();
   try{const result=await this.cloud.call(route,undefined,{signal,progress});active();if(this.value.retrying){this.value={...this.value,retrying:false};this.changed(this.value);}return result;}
   catch(error){active();if(![408,429,500,502,503,504].includes(error.status||503))throw error;
    this.value={...this.value,retrying:true};this.changed(this.value);
    await recover(backoff(++failures,error.retryAfter),active,sleep);
   }
  }
 }
 /* @chain-region Development.toolchain | calls: includes, Error, test, path.resolve, path.relative, relative.startsWith, path.isAbsolute, relative.endsWith … */ async toolchain({kind,directory,version='1.26.8'},signal=this.transferController.signal){
  if(!['go','node'].includes(kind)||typeof directory!=='string')throw Error('构建工具无效。');
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(version))throw Error('构建版本无效。');
  const target=path.resolve(directory),relative=path.relative(this.directory,target);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!relative.endsWith(path.join('sandbox','tools',kind)))throw Error('构建目录无效。');
  let component=path.resolve(this.directory);
  for(const part of relative.split(path.sep)){component=path.join(component,part);try{if(fs.lstatSync(component).isSymbolicLink())throw Error('构建目录不能使用重定向。');}catch(error){if(error.code!=='ENOENT')throw error;}}
  const /* @chain-region Development.toolchain.matches | calls: split, fs.readFileSync, path.join */ matches=folder=>{try{return fs.readFileSync(path.join(folder,'VERSION'),'utf8').split(/\r?\n/)[0]==='go'+version;}catch{return false;}};
  if(fs.existsSync(path.join(target,kind==='go'?'bin/go.exe':'node.exe'))&&(kind!=='go'||matches(target)))return {path:target};
  // Copy only the public toolchain distribution, never a developer profile/cache.
  let source;
  try{
   source=kind==='go'?execFileSync('go',['env','GOROOT'],{encoding:'utf8',windowsHide:true}).trim():
    path.dirname(execFileSync('where.exe',['node.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0]);
   if(kind==='go'&&!matches(source)){
    const cache=execFileSync('go',['env','GOMODCACHE'],{encoding:'utf8',windowsHide:true}).trim();
    source=path.join(cache,'golang.org','toolchain@v0.0.1-go'+version+'.windows-amd64');
    if(!matches(source))throw Error('requested_toolchain_not_installed');
   }
  }catch{return require('./official-tools.cjs').install({kind,version,target,cache:path.join(this.directory,'cache','tools'),python:this.python,
    extractor:path.join(path.dirname(this.cli),'toolchain_extract.py'),signal,/* @chain-region Development.toolchain.active | calls: active, Object.assign, Error */ active:()=>{this.active();if(signal.aborted)throw Object.assign(Error('已取消'),{status:499});}});}
  const entries=kind==='go'?['api','bin','lib','misc','pkg','src','test','VERSION','go.env','LICENSE','PATENTS']:['node.exe','node_modules/npm'];
  if(fs.existsSync(target))await fs.promises.rm(target,{recursive:true,force:true});
  fs.mkdirSync(target,{recursive:true});
  for(const name of entries){const file=path.join(source,name);if(fs.existsSync(file))await fs.promises.cp(file,path.join(target,name),{recursive:true,errorOnExist:false,/* @chain-region Development.toolchain.filter | calls: isSymbolicLink, fs.lstatSync */ filter:src=>!fs.lstatSync(src).isSymbolicLink()});}
  if(!fs.existsSync(path.join(target,kind==='go'?'bin/go.exe':'node_modules/npm/bin/npm-cli.js')))throw Error('本机构建工具不完整。');
  return {path:target};
 }
 /* @chain-region Development.command | calls: active, includes, Error, Array.isArray, Number.isSafeInteger, transferController.abort, AbortController, String … */ command(action,offset=0){
  this.active();if(!['status','download','start','stop','logs','debug'].includes(action))throw Error('开发操作无效。');
  if(action==='debug'){if(!offset||typeof offset!=='object'||Array.isArray(offset))throw Error('诊断操作无效。');}
  else if(!Number.isSafeInteger(offset)||offset<0)throw Error('日志页码无效。');
  if(action==='stop')this.transferController.abort();
  else if(['download','start'].includes(action)&&this.transferController.signal.aborted)this.transferController=new AbortController();
  const id=String(++this.serial);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('本机服务未响应，请重试。'));},15000);this.pending.set(id,{resolve,reject,timer});this.send({id,action,...(action==='debug'?{command:offset}:{offset})});});
 }
 /* @chain-region Development.fail | calls: changed, pending.values, clearTimeout, row.reject, Error, pending.clear */ fail(message,notify=true){this.value={...this.value,state:'error',error:message};if(notify)this.changed(this.value);for(const row of this.pending.values()){clearTimeout(row.timer);row.reject(Error(message));}this.pending.clear();}
 /* @chain-region Development.close | calls: transferController.abort, child.stdin.end, setTimeout, child.kill, timer.unref, fail */ close(){if(this.closed)return;this.closed=true;this.transferController.abort();this.child.stdin.end();const child=this.child;const timer=setTimeout(()=>{if(child.exitCode===null)child.kill();},3000);timer.unref();this.fail('本地开发服务已关闭。',false);}
}
module.exports={Development};
