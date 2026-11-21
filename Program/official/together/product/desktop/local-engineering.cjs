/* @file-map:start
文件: link/desktop/local-engineering.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/local-engineering.test.cjs, link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/local-engineering.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  hash | function
  read | function
  read.query | function
  read.query.failed | function
  read.query.finish | function
  preview | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const /* @chain-region hash | calls: digest, update, crypto.createHash */ hash=value=>crypto.createHash('sha256').update(value).digest('hex');
/* @chain-region read | calls: test, Error, server.replace, hash, JSON.stringify, path.join, fs.existsSync, slice … */ async function read({python,cli,server,account,directory,id,offset=0,previewsOnly=false}){
 if(!/^[a-f0-9]{32}$/.test(account))throw Error('账号身份无效。');
 if(id!==undefined&&!/^[a-f0-9]{32}$/.test(id))throw Error('执行编号无效。');
 const scope={server:server.replace(/\/$/,''),user_id:account};
 const owner=hash(JSON.stringify(scope));
 const records=path.join(directory,'engineering-workspaces',owner,'records'),workspaces=[];
 if(id===undefined&&fs.existsSync(records))for(const name of fs.readdirSync(records).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).slice(0,100)){
  const file=path.join(records,name),info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4000000)continue;
  try{const record=JSON.parse(fs.readFileSync(file,'utf8'));if(record.scope?.server!==scope.server||record.scope?.user_id!==account)continue;
   workspaces.push({id:record.id,task_id:record.task_id,base:record.base,updated:record.updated,recovered_from:record.recovered_from||null,upstream:record.upstream||null,last_sync:record.last_sync||null,cloud_draft:record.cloud_draft||null,fusion_queue:record.fusion_queue||null});
  }catch{}
 }
 const /* @chain-region read.query | calls: Promise, spawn, path.join, path.dirname, setTimeout, child.kill, finish, failed … */ query=kind=>new Promise(resolve=>{
  const child=spawn(python,['-X','utf8','-B',path.join(path.dirname(cli),kind==='vm'?'local_vm.py':kind==='preview'?'local_preview.py':'local_runner.py'),'--bridge-rpc'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',stderr='',done=false;
  const /* @chain-region read.query.failed | calls: Buffer.byteLength */ failed=(code,exitCode=null)=>({[kind==='vm'?'environment':'local_environment']:{ready:null,query_failed:true,error:'本机状态暂未读到，请刷新重试。'},[kind==='vm'?'runs':'local_runs']:[],
    diagnostic:{code,exit_code:exitCode,stdout_bytes:Buffer.byteLength(output,'utf8'),stderr}});
  const /* @chain-region read.query.finish | calls: clearTimeout, resolve */ finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(failed('vm_query_timeout'));},45000);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2000000){child.kill();finish(failed('vm_query_response_limit'));}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
  child.on('error',()=>finish(failed('vm_query_start_failed')));
  // Process exit may arrive before the last pipe data on Windows. Parse only
  // once both stdout and stderr have closed.
  child.on('close',code=>{if(done)return;try{const value=JSON.parse(output);finish(value.error?failed(value.error,code):value);}catch{finish(failed('vm_query_invalid_response',code));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({action:id===undefined?'dashboard':'inspect',payload:{owner,offset,...(kind!=='vm'?{data_directory:directory}:{}),...(id===undefined?{}:{id})}}));
 });
 if(previewsOnly){const result=await query('preview');if(!result.preview)throw Error('本人的网页预览暂不可用，请重新启动预览。');return result.preview;}
 const [vm,local]=await Promise.all([query('vm'),query('local')]);
 if(id!==undefined){if(local.run)return local;if(vm.run)return vm;throw Error('暂时无法读取本人的执行记录。');}
 const previews=await query('preview');
 return {workspaces,...vm,local_runs:local.local_runs||[],local_environment:local.local_environment,local_diagnostic:local.diagnostic,
  local_previews:previews.local_previews||[],preview_query_failed:!!previews.local_environment?.query_failed};
}
module.exports={dashboard:read,/* @chain-region preview | calls: read */ preview:options=>read({...options,previewsOnly:true})};
