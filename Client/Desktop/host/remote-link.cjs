// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: BASE; ADMIN; OFFICIAL; ID; positive; failure; endpoint; createRemoteLink
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/remote-link.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// OS and detached Link share the existing verified human account partition.
// This bridge exposes only the tenant Link API and a sandboxed terminal view.
const {ACCOUNT}=require('./official-account.cjs');
const BASE='/api/aieyra/cloud-instances';
const ADMIN='/api/aieyra/admin-servers';
const OFFICIAL=require('../../../Contracts/official-services.json'),GATEWAY=OFFICIAL.link_cloud,SESSION_HOSTS=[new URL(OFFICIAL.account).hostname,new URL(OFFICIAL.site).hostname];
const ID=/^[A-Za-z0-9_-]{8,80}$/;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const failure=(code,message)=>Object.assign(Error(message||code),{code});

function endpoint(value,method){
 const url=new URL(value);
 if(url.origin!==ACCOUNT||url.username||url.password||url.hash||!['GET','POST'].includes(method))throw failure('remote_endpoint_denied','远程入口无效。');
 const path=url.pathname;
 if(path===ADMIN&&method==='GET'&&!url.search)return {kind:'administrators',administrator:true,url:new URL(GATEWAY+'/v1/admin-remote/servers')};
 const admin=new RegExp('^'+ADMIN+'/([1-9]\\d{0,9})/(remote|remote-deployments)$').exec(path);
 if(admin&&!url.search&&positive(Number(admin[1])))return {kind:admin[2],instance:Number(admin[1]),administrator:true,url:new URL(GATEWAY+'/v1/admin-remote/'+admin[1]+'/'+admin[2])};
 if(method==='GET'&&path===BASE+'/remote-entitlement'&&!url.search)return {kind:'entitlement',url};
 if(method==='GET'&&path===BASE+'/self'&&/^\?page=[1-9]\d{0,2}$/.test(url.search)&&Number(url.searchParams.get('page'))<=100)return {kind:'resources',url};
 const match=new RegExp('^'+BASE+'/([1-9]\\d{0,15})/(remote|remote-deployments)(?:/([A-Za-z0-9_-]{8,80}))?$').exec(path);
 if(!match||url.search||!positive(Number(match[1]))||(match[2]==='remote'&&match[3]))throw failure('remote_endpoint_denied','远程入口无效。');
 return {kind:match[2],instance:Number(match[1]),job:match[3],url};
}

function createRemoteLink({win,electron,account,onChange=()=>{},timeout=35000,pageLoadTimeout=25000}){
 const accountSession=electron.session.fromPartition('persist:aieyra-os-account',{cache:false});
 let scope=null,closed=false,view=null,viewInstance=null,viewID=null,desired=null,shown=false,loaded=false;
 const requests=new Map(),resources=new Map(),descriptors=new Map();
 let terminalSession=null,terminalEpoch=0;
 const status=()=>({ok:true,origin:ACCOUNT,account:scope?{userID:scope.userID,sessionKey:scope.sessionKey}:null,terminal:!!view&&loaded,terminalViewID:viewID});
 function destroyView(){
  terminalEpoch++;
  const prior=view;view=null;viewInstance=viewID=null;shown=loaded=false;desired=null;
  if(terminalSession){terminalSession.webRequest.onBeforeSendHeaders(null);terminalSession.webRequest.onBeforeRequest(null);terminalSession=null;}
  if(prior){win.contentView.removeChildView(prior);if(!prior.webContents.isDestroyed())prior.webContents.close({waitForBeforeUnload:false});onChange(status());}
 }
 function reset(next){
  for(const controller of requests.values())controller.abort();requests.clear();
  resources.clear();descriptors.clear();scope=next;destroyView();onChange(status());
 }
 function accountChanged(state){
  if(closed)return;
  const verified=state?.remoteAccount,id=state?.signedIn?Number(state.user?.id):null;
  if(!positive(id)||verified?.userID!==id||!ID.test(verified?.sessionKey)){if(scope)reset(null);return;}
  if(scope?.userID===id&&scope.sessionKey===verified.sessionKey)return;
  reset({userID:id,sessionKey:verified.sessionKey});
 }
 // A cookie change ends the old epoch even when the same user logs in again.
 // OfficialAccount re-verifies the server session before publishing identity.
 const cookieChanged=(_event,cookie)=>{
  if(SESSION_HOSTS.includes(String(cookie?.domain||'').replace(/^\./,'')))reset(null);
 };
 accountSession.cookies.on('changed',cookieChanged);
 const requireScope=key=>{
  if(closed||!scope||key!==scope.sessionKey)throw failure('remote_login_required','请重新确认 Aieyra 登录。');
  return scope;
 };
 async function administratorHeaders(captured){
  if(scope!==captured||closed)throw failure('remote_request_aborted');
  const cookies=await accountSession.cookies.get({url:ACCOUNT});
  if(scope!==captured||closed)throw failure('remote_request_aborted');
  const sessions=cookies.filter(cookie=>cookie.name==='session'&&SESSION_HOSTS.includes(String(cookie.domain).replace(/^\./,'')));
  if(sessions.length!==1||!sessions[0].secure)throw failure('remote_admin_login_required','请重新登录 Aieyra 管理员账号。');
  return {'New-Api-User':String(captured.userID),'X-Link-NewApi-Session':sessions[0].value};
 }
 function layout(){
  if(!view||view.webContents.isDestroyed())return;
  const z=win.webContents.getZoomFactor();let [w,h]=win.getContentSize();
  if((w<=0||h<=0)&&win.isMinimized?.()){const normal=win.getNormalBounds?.();if(normal){w=normal.width;h=normal.height;}}
  if(!desired||!Number.isFinite(z)||z<=0||w<=0||h<=0){view.setVisible(false);return;}
  const clip=desired.viewport;
  const x=Math.max(0,Math.ceil(Math.max(desired.x,clip.x)*z)),y=Math.max(0,Math.ceil(Math.max(desired.y,clip.y)*z));
  const right=Math.min(w,Math.floor(Math.min(desired.x+desired.width,clip.x+clip.width)*z)),bottom=Math.min(h,Math.floor(Math.min(desired.y+desired.height,clip.y+clip.height)*z));
  const visible=shown&&loaded&&right>x&&bottom>y;
  if(visible)view.setBounds({x,y,width:right-x,height:bottom-y});view.setVisible(visible);
 }
 async function request(p){
  const captured=requireScope(p.sessionKey),method=p.method||'GET',route=endpoint(p.url,method);
  if(!ID.test(p.requestID)||requests.has(p.requestID)||requests.size>=16)throw failure('remote_request_invalid','远程请求无效。');
  if(String(p.userID)!==String(captured.userID))throw failure('remote_account_mismatch','远程账号已变化。');
  if(route.instance&&!resources.has(route.instance))throw failure('remote_resource_not_discovered','请先刷新本人服务器。');
  if(route.instance&&resources.get(route.instance)!==!!route.administrator)throw failure('remote_resource_scope_mismatch');
  if(method==='GET'&&p.body!==undefined)throw failure('remote_request_invalid');
  if(method==='POST'){
   if(typeof p.body!=='string'||Buffer.byteLength(p.body)>65536)throw failure('remote_request_invalid');
   const body=JSON.parse(p.body);
   if(!body||typeof body!=='object'||Array.isArray(body))throw failure('remote_request_invalid');
   if(route.kind==='remote'&&!['sessions','plan'].includes(body.action))throw failure('remote_action_denied');
   if(route.kind==='remote-deployments'&&route.job&&!['resume','cancel'].includes(body.action))throw failure('remote_action_denied');
  }
  const controller=new AbortController();requests.set(p.requestID,controller);
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const humanHeaders=route.administrator?await administratorHeaders(captured):{'New-Api-User':String(captured.userID)};
   const response=await accountSession.fetch(route.url.href,{method,credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,
    headers:{Accept:'application/json','Content-Type':'application/json',...humanHeaders},...(route.administrator?{credentials:'omit'}:{}),...(p.body===undefined?{}:{body:p.body})});
   const reader=response.body.getReader(),chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw failure('remote_response_too_large','远程响应过大。');}chunks.push(value);}
   if(closed||scope!==captured||controller.signal.aborted)throw failure('remote_request_aborted','远程请求已取消。');
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(response.status===401){reset(null);void account.refresh().catch(()=>{});}
   else if(response.ok&&value?.success===true){
    if(route.kind==='entitlement'){resources.clear();descriptors.clear();destroyView();}
    if(route.kind==='administrators'&&Array.isArray(value.data?.items)){
     resources.clear();descriptors.clear();destroyView();
     for(const item of value.data.items)if(positive(item?.id)&&item.owner_id===captured.userID&&item.resource_scope==='administrator_server')resources.set(item.id,true);
    }
    if(route.kind==='resources'&&Array.isArray(value.data?.items))for(const item of value.data.items){
     if(positive(item?.id)&&item.owner_id===captured.userID&&!item.root_only)resources.set(item.id,false);
    }
    if(route.kind==='remote'&&method==='GET'){
     const next=value.data,old=descriptors.get(route.instance);
     if(positive(next?.revision)&&positive(next?.generation)&&next.binding&&next.remote){
      if(viewInstance===route.instance&&old&&(old.revision!==next.revision||old.generation!==next.generation))destroyView();
      descriptors.set(route.instance,structuredClone(next));
     }
    }
   }else if(route.instance&&[403,404,410].includes(response.status)){
    descriptors.delete(route.instance);if(viewInstance===route.instance)destroyView();
   }
   return {ok:true,status:response.status,value};
  }catch(error){
   if(scope!==captured||controller.signal.aborted)throw failure('remote_request_aborted','账号或远程视图已变更。');
   if(error.code)throw error;
   throw failure('remote_service_unavailable','远程服务暂时无法连接，请核对原任务后再继续。');
  }finally{clearTimeout(timer);if(requests.get(p.requestID)===controller)requests.delete(p.requestID);}
 }
 async function terminal(p){
  const captured=requireScope(p.sessionKey);
  if(!positive(p.instance)||!descriptors.has(p.instance)||!ID.test(p.sessionID)||!ID.test(p.viewID))throw failure('remote_session_invalid','请先读取此服务器的连接能力。');
  destroyView();
  const terminalVersion=terminalEpoch;
  const administrator=resources.get(p.instance)===true;
  const url=new URL(administrator?GATEWAY+'/remote/terminal.html':ACCOUNT+'/api/aieyra/link-assets/terminal.html');
  url.search=new URLSearchParams({instance:String(p.instance),user:String(captured.userID),session:p.sessionID}).toString();
  let pageSession=accountSession;
  if(administrator){
   await administratorHeaders(captured);
   if(scope!==captured||terminalVersion!==terminalEpoch||closed)throw failure('remote_request_aborted');
   pageSession=electron.session.fromPartition('aieyra-link-admin-terminal-'+p.viewID,{cache:false});
   terminalSession=pageSession;
   pageSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
    const target=new URL(details.url);
    const allowed=target.origin===new URL(GATEWAY).origin&&(target.pathname.startsWith('/link/cloud/remote/')||target.pathname==='/link/cloud/v1/admin-remote/'+p.instance+'/remote');
    callback({cancel:closed||scope!==captured||!allowed});
   });
   pageSession.webRequest.onBeforeSendHeaders({urls:[GATEWAY+'/v1/admin-remote/*']},(details,callback)=>{
    void administratorHeaders(captured).then(headers=>callback({requestHeaders:{...details.requestHeaders,...headers}}),()=>callback({cancel:true}));
   });
  }
  const next=new electron.WebContentsView({webPreferences:{session:pageSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  view=next;viewInstance=p.instance;viewID=p.viewID;win.contentView.addChildView(next);next.setVisible(false);
  next.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const event of ['will-navigate','will-redirect'])next.webContents.on(event,(e,target)=>{if(target!==url.href)e.preventDefault();});
  let timer;
  try{
   await Promise.race([next.webContents.loadURL(url.href),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(failure('remote_terminal_timeout','终端载入超时，请重试。')),pageLoadTimeout);})]);
   if(closed||scope!==captured||view!==next)throw failure('remote_request_aborted','账号或远程视图已变更。');
   loaded=true;layout();onChange(status());return {ok:true,sessionID:p.sessionID,viewID:p.viewID};
  }catch(error){if(view===next)destroyView();throw error;}
  finally{clearTimeout(timer);}
 }
 async function call(p={}){
  if(p.action==='status'){
   if(p.refresh){const value=await account.refresh();accountChanged(value);}return status();
  }
  if(p.action==='login')return account.login();
  if(p.action==='logout'){reset(null);await account.logout();return status();}
  if(p.action==='request')return request(p);
  if(p.action==='cancel'){if(scope&&p.sessionKey===scope.sessionKey)requests.get(p.requestID)?.abort();return {ok:true};}
  if(p.action==='terminalClose'){if(scope&&p.sessionKey===scope.sessionKey&&p.viewID===viewID)destroyView();return {ok:true};}
  if(p.action==='terminal')return terminal(p);
  if(p.action==='surface'){
   requireScope(p.sessionKey);
   if(p.viewID!==viewID||!view)return {ok:true,stale:true};
   // Hidden/background terminal views are destroyed, retaining remote tmux.
   if(!p.visible){destroyView();return {ok:true};}
   const b=p.bounds,viewport=p.viewport;
   const valid=rect=>rect&&['x','y','width','height'].every(k=>Number.isFinite(rect[k]))&&rect.width>0&&rect.height>0;
   if(!valid(b)||!valid(viewport))throw failure('remote_bounds_invalid');
   desired={x:b.x,y:b.y,width:b.width,height:b.height,viewport:{x:viewport.x,y:viewport.y,width:viewport.width,height:viewport.height}};shown=true;layout();return {ok:true};
  }
  if(p.action==='baota'){
   requireScope(p.sessionKey);const panel=descriptors.get(p.instance)?.remote?.baota;
   if(panel?.state!=='registered')throw failure('remote_panel_missing','此服务器尚未登记宝塔入口。');
   const url=new URL(panel.url);if(url.protocol!=='https:'||url.username||url.password||url.href.length>4096)throw failure('remote_panel_invalid');
   await electron.shell.openExternal(url.href);return {ok:true};
  }
  throw failure('remote_action_denied','未知的远程操作。');
 }
 const navigation=()=>destroyView(),minimize=()=>destroyView();
 win.webContents.on('did-start-navigation',navigation);
 win.on('minimize',minimize);for(const event of ['resize','restore','show'])win.on(event,layout);
 function close(){
  if(closed)return;closed=true;reset(null);accountSession.cookies.removeListener('changed',cookieChanged);
  win.webContents.removeListener('did-start-navigation',navigation);win.removeListener('minimize',minimize);
  for(const event of ['resize','restore','show'])win.removeListener(event,layout);
  win.removeListener('closed',close);
 }
 win.on('closed',close);accountChanged(account.status());
 return {call,accountChanged,status,close};
}
module.exports={createRemoteLink,endpoint};
