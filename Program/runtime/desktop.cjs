// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/runtime/AGENTS.md | ring 1
// Chains: program
// Regions: crypto; digest; modes; checkCancelled; filename; descriptor; createProgramRuntime
// Impact: python -B scripts/code-atlas.py show Program/runtime/desktop.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Sandboxed program windows. Installation, identity and grants belong to Core.
const crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const modes=new Set(['observed','collaborative','human']);
function checkCancelled(signal){if(signal?.aborted)throw Object.assign(Error('程序操作在执行前已取消。'),{code:'CANCELLED'});}
function filename(value){
 if(typeof value!=='string'||!value||value.length>240||/[\\:<>"|?*\x00-\x1f]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('程序文件路径无效');
 return value;
}
function descriptor(manifest,files){
 const p=JSON.parse(files[manifest.entrypoints.program]?.toString('utf8')||'null');
 const process=p?.desktop?.native&&p.desktop.navigation?.host==='process';
 if(p?.schema!=='aieyra.program/1'||!modes.has(p.mode)||!p.desktop||!filename(p.desktop.entry).endsWith(process?'.mjs':'.html')||!Object.hasOwn(files,p.desktop.entry))throw Error('程序需要有效的使用模式与桌面入口');
 if(!Array.isArray(p.operations)||p.operations.length>64||p.operations.some(x=>!x||! /^[a-z][a-z0-9_.-]{0,63}$/.test(x.id)||typeof x.description!=='string'||!x.description||x.id==='snapshot'))throw Error('程序操作契约无效');
 if(new Set(p.operations.map(x=>x.id)).size!==p.operations.length||p.mode==='human'&&p.operations.length)throw Error('程序操作模式不匹配');
 if(p.mode!=='human'&&!p.operations.length)throw Error('AI 可用程序需要声明操作');
 if(p.desktop.native&&(!/^[a-z][a-z0-9_-]{0,47}$/.test(p.desktop.native)||!p.desktop.navigation))throw Error('原生程序适配声明无效');
 if(!p.desktop.native&&p.desktop.navigation)throw Error('原生导航缺少适配器');
 if(p.desktop.navigation&&!['surface','browser','process'].includes(p.desktop.navigation.host))throw Error('原生程序宿主类型无效');
 return p;
}
function createProgramRuntime({BrowserWindow,programWindow,session,storageRoot,legacyStorageRoot,offscreen=false}={}){
 const windows=new Map();let closed=false;
 const isOpen=id=>{const row=windows.get(id);return !!row&&!row.window.isDestroyed();};
 function current(row){if(closed||row.closing||windows.get(row.id)!==row||row.window.isDestroyed())throw Error('程序窗口已关闭或状态已变化');}
 function release(row){row.cancel();row.releaseDownload?.();if(windows.get(row.id)===row)windows.delete(row.id);}
 function destroy(row){row.closing=true;row.cancel();if(!row.window.isDestroyed())row.window.destroy?row.window.destroy():row.window.close();release(row);}
 async function open(p,{signal}={}){
  if(closed)throw Error('程序运行时已关闭');
  checkCancelled(signal);
  if(!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(p.id))throw Error('程序身份无效');
  const old=windows.get(p.id);
  if(isOpen(p.id)){if(old.digest!==p.digest)throw Error('程序版本已变化，请先关闭旧窗口');await old.ready;current(old);checkCancelled(signal);if(!offscreen)old.window.show();return {ok:true,reused:true};}
  // The OS host uses a disposable userData directory. A persistent partition
  // inside that directory still disappears on exit: own program data separately.
  let owned=storageRoot&&path.join(storageRoot,digest(p.id));
  const legacy=legacyStorageRoot&&path.join(legacyStorageRoot,digest(p.id));
  if(legacy&&fs.existsSync(legacy)){
   if(owned&&fs.existsSync(owned)&&path.resolve(owned)!==path.resolve(legacy))throw Error('程序新旧资料目录同时存在，请先核对迁移；没有覆盖任何资料');
   for(let file=path.resolve(legacy);;file=path.dirname(file)){if(fs.lstatSync(file).isSymbolicLink())throw Error('程序资料路径不能经过链接');if(path.dirname(file)===file)break;}
   owned=legacy;
  }
  const storage=owned&&session?.fromPath?{session:session.fromPath(owned)}:{partition:'resource-'+digest(p.id)};
  const prefs={sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,...storage};
  const options={title:p.name,width:1100,height:760,show:false,webPreferences:prefs};
  const window=programWindow?programWindow(options):new BrowserWindow(options);
  let cancel;const cancelled=new Promise((_,reject)=>{cancel=()=>reject(Error('程序窗口已关闭或状态已变化'));});
  const invoking=new Set();
  const row={id:p.id,window,digest:p.digest,mode:p.mode||'human',operations:p.operations||[],invoking,closing:false,
   cancel(){cancel();for(const reject of invoking)reject(Error('程序窗口已关闭或状态已变化'));invoking.clear();}};
  windows.set(p.id,row);window.on('closed',()=>release(row));
  const origin='aieyra-resource://'+p.id+'/';
  // All initialization belongs to this row, including protocol registration.
  // Closing cancels admission immediately; delayed work must recheck ownership.
  const preparing=Promise.resolve().then(async()=>{
   current(row);
   const protocol=window.webContents.session.protocol;
   const handled=await protocol.isProtocolHandled('aieyra-resource');current(row);
   if(handled){await protocol.unhandle('aieyra-resource');current(row);}
   protocol.handle('aieyra-resource',request=>{
    try{
     const u=new URL(request.url);if(u.host!==p.id||request.method!=='GET')return new Response('',{status:403});
     const name=filename(decodeURIComponent(u.pathname.slice(1)));if(!Object.hasOwn(p.files,name))return new Response('',{status:404});
     const mime={html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',woff2:'font/woff2',txt:'text/plain'}[name.split('.').pop()]||'application/octet-stream';
     return new Response(p.files[name],{headers:{'content-type':mime,'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'"+(p.network?.length?' '+p.network.join(' '):'')+"; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'",'x-content-type-options':'nosniff'}});
    }catch{return new Response('',{status:400});}
   });
   if(p.mode==='observed'){window.webContents.on('before-input-event',event=>event.preventDefault());window.webContents.on('before-mouse-event',event=>event.preventDefault());}
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   window.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(origin))e.preventDefault();});
   window.webContents.on('will-attach-webview',event=>event.preventDefault());
   window.webContents.session.setPermissionRequestHandler((_w,_p,reply)=>reply(false));
   window.webContents.session.setPermissionCheckHandler(()=>false);
   const programSession=window.webContents.session,denyDownload=event=>event.preventDefault();
   row.releaseDownload=()=>programSession.removeListener?.('will-download',denyDownload);
   programSession.on?.('will-download',denyDownload);
   current(row);await window.loadURL(origin+filename(p.entry));current(row);
   if(!offscreen)window.show();
  });
  row.ready=Promise.race([preparing,cancelled]).catch(error=>{
   try{destroy(row);}catch(releaseError){throw new AggregateError([error,releaseError],'程序初始化失败且释放未完成');}
   throw error;
  });
  await row.ready;return {ok:true,opened:true};
 }
 async function invoke(id,operation,args,{expectedDigest,signal}={}){
  checkCancelled(signal);
  const row=windows.get(id);if(!isOpen(id))throw Error('程序尚未打开');
  await row.ready;current(row);checkCancelled(signal);
  if(expectedDigest!==undefined&&row.digest!==expectedDigest)throw Error('程序版本已变化，请先关闭旧窗口并重新打开');
  if(row.mode==='human')throw Error('此程序仅供用户操作');
  if(operation!=='snapshot'&&!row.operations.some(p=>p.id===operation))throw Error('程序没有声明这项操作');
  const input=JSON.stringify({operation,args:args??{}});if(Buffer.byteLength(input)>65536)throw Error('程序输入超过 64 KiB');
  // This executes solely in the unprivileged program page, never in the host.
  // Serialize both arguments and response so page objects cannot cross the API.
  const code=`(async()=>{const p=${input};const api=globalThis.aieyraProgram;if(!api)throw Error('程序未提供 AI 接口');const out=await (p.operation==='snapshot'?api.snapshot():api.invoke(p.operation,p.args));const text=JSON.stringify(out??null);if(text.length>262144)throw Error('程序回执过大');return text;})()`;
  // Once dispatched, aborting the caller cannot undo a page effect. A closed
  // window does invalidate its response, and must not wait out the full timeout.
  let timer,interrupt;try{
   // Remove each completed call's waiter instead of retaining reactions on a
   // single lifetime promise for every snapshot of a long-lived window.
   const interrupted=new Promise((_,reject)=>{interrupt=reject;row.invoking.add(interrupt);});
   const text=await Promise.race([row.window.webContents.executeJavaScript(code),interrupted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('程序操作未在 15 秒内返回；结果未知，请先读取状态')),15000);timer.unref?.();})]);
   current(row);return {ok:true,result:JSON.parse(text)};
  }catch(error){return {ok:false,state:'unknown',code:'PROGRAM_RESULT_UNCONFIRMED',error:String(error?.message??error)};}finally{clearTimeout(timer);row.invoking.delete(interrupt);}
 }
 function close(id){const row=windows.get(id);if(row)destroy(row);}
 return {open,invoke,isOpen,close,active:()=>[...windows].map(([id,r])=>({id,digest:r.digest})),shutdown(){closed=true;const errors=[];for(const id of windows.keys()){try{close(id);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'部分程序窗口释放未完成');}};
}
module.exports={createProgramRuntime,descriptor,filename};
