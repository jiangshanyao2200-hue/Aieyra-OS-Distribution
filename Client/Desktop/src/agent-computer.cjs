// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; presentation; createComputer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/agent-computer.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const presentation=require('./window-presentation.cjs');
function createComputer(configFile){
 const targets=new Map(),active=new Set();
 const inputs=new Set(['click','double_click','right_click','set_value','keypress','type_text','scroll','drag','focus']);
 function execute(args,signal){return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('Computer operation cancelled before dispatch'));return;}
  const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const child=spawn(exe,['-NoProfile','-NonInteractive','-File',path.join(__dirname,'../tools/computer-use.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let aborted=false,grace;
  const cancellable=['drag','type_text'].includes(args.action);
  if(cancellable){const dir=require('./paths.cjs').privatePath(configFile,'captures');fs.mkdirSync(dir,{recursive:true});args.cancel_path=path.join(dir,crypto.randomBytes(12).toString('hex')+'.cancel');}
  active.add(child);const abort=()=>{aborted=true;if(cancellable){try{fs.writeFileSync(args.cancel_path,'cancel',{flag:'wx'});}catch{}grace=setTimeout(()=>child.kill(),2000);}else{child.kill();reject(Error('Computer operation cancelled; outcome unknown, inspect before retry'));}};child.stop=abort;signal?.addEventListener('abort',abort,{once:true});
  const cleanup=()=>{active.delete(child);clearTimeout(grace);signal?.removeEventListener('abort',abort);if(args.cancel_path)try{fs.unlinkSync(args.cancel_path);}catch{}};child.once('close',cleanup);
  let output='';const decoder=new StringDecoder('utf8');const timer=setTimeout(()=>{child.kill();reject(Error('UI Automation timed out; outcome unknown, inspect before retry'));},20000);
  child.stdout.on('data',d=>{output+=decoder.write(d);if(output.length>2<<20){child.kill();reject(Error('UI response too large'));}});child.stderr.on('data',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(Error('Windows UI Automation runtime unavailable'));});
  child.once('close',code=>{clearTimeout(timer);if(aborted){reject(Error('Computer operation cancelled; outcome unknown, inspect before retry'));return;}output+=decoder.end();try{resolve(JSON.parse(output));}catch{reject(Error('UI Automation response invalid (exit '+code+', '+output.length+' characters)'));}});
  child.stdin.once('error',()=>{clearTimeout(timer);reject(Error('Computer request pipe closed; outcome unknown, inspect before retry'));child.kill();});
  child.stdin.end(JSON.stringify(args));
 });}
 async function call(owner,a,signal){
  if(process.platform!=='win32')throw Error('Computer Use currently requires Windows');
  if(!owner)throw Error('Missing session identity');
  // 评测进程显式限定fixture，不能枚举或连接用户其他窗口；产品正常入口不设置此变量。
  const testPid=Number(process.env.AIEYRA_COMPUTER_LAB_PID||0);
  if(testPid){if(['list','attach'].includes(a.action)&&a.pid&&a.pid!==testPid)throw Error('Window outside lab');a={...a,pid:testPid};}
  if(a.action==='list')return execute({action:'list',pid:a.pid},signal);
  if(a.action==='attach'){
   const mode=presentation.mode(a.presentation);
   const r=await execute({action:'list',pid:a.pid},signal);if(!r.ok)return r;
   const identity=r.windows.find(w=>w.pid===a.pid&&w.handle===String(a.handle)&&w.path.toLowerCase()===String(a.path).toLowerCase());
   if(!identity)throw Error('Window PID, handle and complete executable path must match list');
   if(targets.size>=32)throw Error('Too many attached windows');
   const window_id=crypto.randomBytes(12).toString('hex');targets.set(window_id,{owner,identity,revision:null,observation:null,presentation:mode,epoch:0,pending:new Set()});return {ok:true,window_id,identity,presentation:mode,next:'observe for screenshot and semantic controls'};
  }
  const t=targets.get(a.window_id);if(!t||t.owner!==owner)throw Error('Unknown window for this session');
  if(a.action==='detach'){for(const c of t.pending)c.abort();targets.delete(a.window_id);return {ok:true,detached:true};}
  if(a.action==='presentation'){const next=presentation.mode(a.presentation);t.presentation=next;t.revision=null;t.epoch++;for(const c of t.pending)c.abort();return {ok:true,window_id:a.window_id,presentation:t.presentation,next:'inspect',inflight:'cancel_requested; already completed effects require observation'};}
  // 第三方UIA provider也可能自行激活窗口或打开弹窗，不能承诺其Invoke不打扰用户。
  if(inputs.has(a.action)&&t.presentation!=='interactive')throw Error('display_only: desktop input requires explicit presentation=interactive');
  if(!['inspect','screenshot','observe',...inputs].includes(a.action))throw Error('Unknown computer action');
  if(inputs.has(a.action)&&(!t.revision||a.revision!==t.revision))throw Error('stale_snapshot: observe or inspect before interaction');
  if(t.pending.size)throw Error('operation_in_progress: wait for the current target operation');
  if(a.value!==undefined&&(typeof a.value!=='string'||a.value.length>20000))throw Error('Invalid value');
  if(a.text!==undefined&&(typeof a.text!=='string'||a.text.length>6000))throw Error('type_text requires at most 6000 UTF-16 units');
  const coordinates=a.x!==undefined||a.y!==undefined||['double_click','right_click','scroll','drag'].includes(a.action);
  if(coordinates){
   if(!t.observation)throw Error('screenshot_required: observe and view_image before using pixel coordinates');
   for(const [x,y] of [[a.x,a.y],...(a.action==='drag'?[[a.to_x,a.to_y]]:[])])if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=t.observation.width||y>=t.observation.height)throw Error('Coordinates must be inside the latest original screenshot');
  }
  // 在异步派发前消耗revision，防止两次并行输入重复使用同一个旧观察。
  const args={...a,identity:t.identity,observation:t.observation};
  if(inputs.has(a.action)){t.revision=null;t.observation=null;t.epoch++;}
  if(['screenshot','observe'].includes(a.action)){const dir=require('./paths.cjs').privatePath(configFile,'captures');fs.mkdirSync(dir,{recursive:true});args.capture_path=path.join(dir,crypto.randomBytes(12).toString('hex')+'.png');}
  const epoch=t.epoch,controller=new AbortController();t.pending.add(controller);
  try{
   const r=await execute(args,signal?AbortSignal.any([signal,controller.signal]):controller.signal);
   if(epoch!==t.epoch||targets.get(a.window_id)!==t)throw Error('stale_snapshot: presentation or target changed during operation; inspect again');
   if(['inspect','screenshot','observe'].includes(a.action)&&r.ok){t.revision=crypto.randomBytes(8).toString('hex');t.observation=r.observation||null;r.revision=t.revision;}
   return {...r,window_id:a.window_id,presentation:t.presentation,content_trust:'untrusted_window_data'};
  }finally{t.pending.delete(controller);}
 }
 return {call,close(){for(const child of active)child.stop();targets.clear();}};
}
module.exports={createComputer};
