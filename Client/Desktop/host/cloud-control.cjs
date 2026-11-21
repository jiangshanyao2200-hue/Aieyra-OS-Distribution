// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; ATTACHED; configFile; readConfig; request; project; attachCloudControl
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/cloud-control.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Cloud office joins this PC as a cloud station over verified HTTPS. Credentials
// remain in the host; the Link page shown is always the local office page.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {spawn}=require('node:child_process');
const ATTACHED=Symbol.for('aieyra.control.cloud');

function configFile(env){
 if(env.AIEYRA_LINK_CLOUD_CONFIG)return path.resolve(env.AIEYRA_LINK_CLOUD_CONFIG);
 const base=env.AIEYRA_CONTROL_DATA_DIR||env.AIEYRA_CONTROL_DATA;
 return base&&path.isAbsolute(base)?path.join(path.dirname(base),'cloud-office.json'):null;
}
function readConfig(file){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>8192)throw Error('云 Link 配置无效');
 const cfg=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(cfg.schema!==1||cfg.mode!=='cloud')throw Error('云 Link 配置无效');
 const url=new URL(cfg.url);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_/-]+$/.test(url.pathname))throw Error('云 Link 需要有效的 HTTPS 入口');
 for(const key of ['key_file','client_data'])if(typeof cfg[key]!=='string'||!path.isAbsolute(cfg[key]))throw Error('云 Link 私有目录无效');
 return {...cfg,url:url.href.replace(/\/$/,''),origin:url.origin,prefix:url.pathname.replace(/\/$/,''),file};
}
function request(cfg,route,{body,cookie,timeout=12000}={}){
 return new Promise((resolve,reject)=>{
  const raw=body?Buffer.from(JSON.stringify(body)):null;
  const req=https.request(cfg.url+route,{method:raw?'POST':'GET',headers:{Accept:'application/json',...(raw?{'Content-Type':'application/json','Content-Length':raw.length,Origin:cfg.origin,'X-Link-UI':'1'}:{}),...(cookie?{Cookie:cookie}:{})}},res=>{
   let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>2*1024*1024)req.destroy(Error('云 Link 响应过大'));else chunks.push(b);});
   res.on('error',()=>reject(Error('云 Link 响应中断')));
   res.on('end',()=>{try{if(!res.complete)throw Error();const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve({status:res.statusCode,value,cookies:res.headers['set-cookie']||[]});}catch{reject(Error('云 Link 响应无效'));}});
  });
  const timer=setTimeout(()=>req.destroy(Error('云 Link 连接超时')),timeout);req.once('close',()=>clearTimeout(timer));
  req.once('error',()=>reject(Error('云 Link 暂时无法连接')));req.end(raw);
 });
}
function project(view,stale=false){
 if(!view||view.capacity!==21||!Array.isArray(view.devices)||view.devices.length>21||view.devices.some(d=>!d||typeof d.name!=='string'||typeof d.online!=='boolean'))throw Error('云工位状态无效');
 return {observed_at:new Date().toISOString(),connection:stale?'unknown':'online',registry_connection:stale?'unknown':'online',stale,count_stale:stale,count:view.devices.length,os_count:0,running:stale?null:view.devices.filter(d=>d.online&&['busy','working','running'].includes(d.state)).length,
  online:stale?null:view.devices.filter(d=>d.online).length,capacity:view.capacity,office_id:view.office_id,
  seats:view.devices.map(d=>({id:d.device_id,name:d.name,project:'cloud',online:stale?null:d.online,execution_state:stale?'unknown':d.state,server_worker:d.server_worker}))};
}
function attachCloudControl(local,{env=process.env,launch=spawn,read=request}={}){
 const file=configFile(env);if(!file||!fs.existsSync(file)||local[ATTACHED])return local;
 const original=Object.fromEntries(['status','open','surface','close','release','ensure'].map(k=>[k,local[k]?.bind(local)]));
 let cfg,configError='';try{cfg=readConfig(file);}catch(e){configError=e.message;}
 let closed=false,released=false,last=null,pending=null,cookie='',child=null,childDone=null,childError='',closeWork=null,localError='';
 // 用户 2026-10-16：Link 只有一种页面——本地的工位 / 工单 / 群聊 / 连接标签页。
 // 云办公室只在后台做两件事：让这台电脑作为云工位接入，并报告云工位数；不再挂载服务器上的旧页面。
 async function ensureLocal(options){
  if(closed)throw Error('云 Link 已关闭');
  if(released)throw Object.assign(Error('Link 已交给独立窗口'),{code:'control_released'});
  if(!original.ensure)throw Error('本地指挥中心启动接口不可用');
  try{const health=await original.ensure(options);localError='';return health;}
  catch(e){localError=e.message||'本地指挥中心未能启动';throw e;}
 }
 const state={mode:'cloud',cloud_available:false,cloud_error:configError||null};
 local.setCloud?.(()=>last&&typeof last.office_id==='string'&&last.office_id?{id:last.office_id.slice(0,6).toUpperCase(),ready:state.cloud_available===true}:null);
 function merge(base){return {...(base||{ok:true}),...state,cloud_office:last?project(last,!state.cloud_available):null,local_error:localError||null};}
 function startOwner(){
  if(child||closed||released||!cfg)return;
  const root=path.resolve(__dirname,'../../..');
  const executable=require('./apps.cjs').controlInterpreter({root,env:{...env,AIEYRA_CONTROL_PYTHON:cfg.python||env.AIEYRA_CONTROL_PYTHON}});
  const clean={...env};for(const k of Object.keys(clean))if(k==='ELECTRON_RUN_AS_NODE'||k==='NODE_OPTIONS'||k==='CODEX_THREAD_ID'||k==='CLAUDE_CODE_SESSION_ID'||k==='CURSOR_CONVERSATION_ID'||k==='AIEYRA_WORKSPACE_BRIDGE'||k.startsWith('AIEYRA_OS_OWNER_')||k.startsWith('AIEYRA_RUNTIME_'))delete clean[k];
  const p=launch(executable,['-B','-X','utf8',path.join(root,'Link/cloud/desktop_owner.py'),'--config',file,'--portable',path.join(root,'Link/portable')],{cwd:root,env:clean,windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
  child=p;childError='';let output='';p.stdin.on('error',()=>{});
  p.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>8192){output='';return;}let at;while((at=output.indexOf('\n'))>=0){let msg;try{msg=JSON.parse(output.slice(0,at));}catch{}output=output.slice(at+1);if(msg?.type==='link.desktop.cloud.ready')state.device_ready=true;if(msg?.type==='link.desktop.cloud.error'){childError='电脑云工位暂未就绪';state.device_ready=false;}}});
  childDone=new Promise(resolve=>{p.once('close',(code,signal)=>{if(child===p){child=null;state.device_ready=false;if(code||signal)childError='电脑云工位连接中断，将自动重试';}resolve();});});
  p.once('error',()=>{childError='电脑云工位未能启动';state.device_ready=false;});
 }
 async function login(){
  const keyStat=fs.statSync(cfg.key_file);if(!keyStat.isFile()||keyStat.size>2048)throw Error('云 Link 链接密钥无效');
  const key=fs.readFileSync(cfg.key_file,'utf8').trim();
  const result=await read(cfg,'/v1/browser/login',{body:{key}});
  if(result.status!==200||result.value.logged_in!==true)throw Error('云 Link 链接密钥未能验证');
  const match=result.cookies.map(c=>/^aieyra_link_view=([A-Za-z0-9_-]{43,128});/.exec(c)).find(Boolean);
  if(!match)throw Error('云 Link 查看会话无效');cookie='aieyra_link_view='+match[1];
 }
 async function cloud(){
  if(closed||released||!cfg)return;if(pending)return pending;
  pending=(async()=>{try{
   startOwner();if(!cookie)await login();
   let result=await read(cfg,'/v1/browser/view',{cookie});if(result.status===401){await login();result=await read(cfg,'/v1/browser/view',{cookie});}
   if(result.status!==200)throw Error('云办公室暂时无法读取');project(result.value);if(closed)return;last=result.value;
   Object.assign(state,{cloud_available:true,cloud_error:childError||null,cloud_checked_at:new Date().toISOString()});
  }catch(e){if(!closed)Object.assign(state,{cloud_available:false,cloud_error:e.message||'云办公室暂时无法连接'});}})().finally(()=>{pending=null;});return pending;
 }
 async function status(){
  if(closed||released)return merge(await original.status());
  await ensureLocal().catch(()=>{});
  const [base]=await Promise.all([original.status(),cloud()]);
  return merge(base);
 }
 async function open(){
  if(closed)throw Error('云 Link 已关闭');
  released=false;
  void cloud();
  return merge(await original.open());
 }
 function surface(p={}){return merge(original.surface(p));}
 async function release(){
  // Polling remains active in the OS. It must become observation-only before
  // waiting for workers, otherwise the next status tick takes ownership back.
  released=true;
  await Promise.allSettled([pending]);
  if(child){child.stdin.end();await Promise.race([childDone,new Promise((_r,reject)=>{const t=setTimeout(()=>reject(Error('电脑云工位退出尚未确认')),45000);childDone.finally(()=>clearTimeout(t));})]);}
  state.device_ready=false;state.cloud_available=false;
  return merge(await original.release?.());
 }
 Object.assign(local,{status,open,surface,release,ensure:ensureLocal,close(){if(closeWork)return closeWork;closed=true;closeWork=Promise.allSettled([release(),original.close()]).then(results=>{const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;});return closeWork;}});
 local[ATTACHED]=true;return local;
}
module.exports={attachCloudControl,configFile,readConfig,request,project};
