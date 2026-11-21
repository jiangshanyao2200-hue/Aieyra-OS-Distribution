// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: owners; withOwner; executable; request
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/model-diagnostic-worker.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// A settings service supplies its own config owner through async context. The
// renderer cannot choose a file, executable, credential, or adapter snapshot.
const {AsyncLocalStorage}=require('node:async_hooks'),{spawn}=require('node:child_process'),path=require('node:path');
const owners=new AsyncLocalStorage();
function withOwner(config,signal,work){return owners.run({config,signal},work);}
function executable(){
 if(process.env.AIEYRA_CORE_EXECUTABLE)return process.env.AIEYRA_CORE_EXECUTABLE;
 try{const bridge=JSON.parse(process.env.AIEYRA_WORKSPACE_BRIDGE||'{}');if(bridge.executable)return bridge.executable;}catch{}
 return path.join(require('./resources.cjs').root(),process.platform==='win32'?'Aieyra OS.exe':'aieyra-os');
}
async function request(settings,body,timeoutMs){
 const owner=owners.getStore();if(!owner)throw Error('API适配诊断需要共同Core设置服务');
 const pool=require('./model-pool.cjs'),stored=require('./config.cjs').load(owner.config).settings;
 const saved=stored.api_profiles.find(p=>p.id===settings.active_profile),selected=settings.api_profiles?.find(p=>p.id===settings.active_profile);
 if(!saved||!selected||JSON.stringify(saved.adapter_package)!==JSON.stringify(selected.adapter_package))throw Error('API适配绑定已变化，请刷新后重试');
 const active=pool.activate(stored,saved);
 if(['base_url','api_protocol','model','adapter','api_key'].some(k=>active[k]!==settings[k]))throw Error('请先保存模型连接，再测试API适配器');
 const limit=Math.min(72000,Math.max(1,timeoutMs));
 const identity=require('./runtime-credential.cjs').identity(settings),input=JSON.stringify({config:owner.config,profile:settings.active_profile,identity,selection:saved.adapter_package,body,timeout_ms:limit,session:settings.__diagnostic_session||''});
 if(Buffer.byteLength(input)>3*1024*1024)throw Error('诊断请求过大');
 if(owner.signal?.aborted)throw Error('诊断已取消');
 return new Promise((resolve,reject)=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','AIEYRA_WORKSPACE_BRIDGE'].includes(k)&&!k.startsWith('NODE_TEST_')&&!k.startsWith('AIEYRA_OS_OWNER_')));
  const child=spawn(executable(),['--model-diagnostic-worker'],{env,windowsHide:true,stdio:['pipe','pipe','ignore']});
  let chunks=[],size=0,failure=null,killTimer,settled=false;
  const stop=error=>{if(!failure)failure=error;child.stdin.end();killTimer??=setTimeout(()=>child.kill(),3000);};
  const abort=()=>stop(Error('诊断已取消'));
  const timer=setTimeout(()=>stop(Error(`诊断请求超时（${Math.round(limit/1000)} 秒）`)),limit+1000);
  owner.signal?.addEventListener('abort',abort,{once:true});
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);owner.signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  child.once('error',()=>finish(Error('共同Core诊断进程无法启动')));
  child.stdin.on('error',()=>stop(Error('共同Core诊断输入已关闭')));
  child.stdout.on('data',data=>{size+=data.length;if(size>5*1024*1024){stop(Error('诊断响应过大'));return;}chunks.push(data);});
  child.once('close',code=>{
   if(failure)return finish(failure);if(code!==0)return finish(Error('共同Core诊断未正常完成'));
   try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!result.ok){const error=Error(result.error||'诊断未完成');if(result.status)error.apiError={status:result.status,message:error.message,hint:result.hint||''};return finish(error);}finish(null,result.reply);}catch{return finish(Error('共同Core诊断响应无效'));}
  });
  child.stdin.write(input+'\n');
 });
}
module.exports={withOwner,request};
