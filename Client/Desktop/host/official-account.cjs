// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: OFFICIAL; ACCOUNT_HOST; digest; tokenMetadata; officialLog; createOfficialAccount
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/official-account.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Token owns authentication. This module never receives a password and exposes
// only account / Key metadata to the local renderer. Cookies use a dedicated
// Electron partition; remote pages have no preload or local IPC capability.
const OFFICIAL=require('../../../Contracts/official-services.json'),ACCOUNT=OFFICIAL.account,GATEWAY=OFFICIAL.gateway;
const ACCOUNT_HOST=new URL(ACCOUNT).hostname,SITE_HOST=new URL(OFFICIAL.site).hostname,SESSION_HOSTS=[ACCOUNT_HOST,SITE_HOST],SESSION_DOMAINS=[ACCOUNT_HOST,'.'+ACCOUNT_HOST,'.'+SITE_HOST,SITE_HOST];
const digest=key=>require('node:crypto').createHash('sha256').update(key).digest('hex');
function tokenMetadata(t,now=Date.now()){
 const id=String(t.id||''),expires=Number(t.expired_time||0),remaining=t.remain_quota;
 if(!/^[1-9]\d{0,15}$/.test(id))return null;
 const unavailableReason=Number(t.status)===3?'已过期':Number(t.status)===4?'额度不足':Number(t.status)!==1?'云端已停用':expires>0&&expires*1000<=now?'已过期':t.unlimited_quota!==true&&remaining!=null&&!(Number(remaining)>0)?'额度不足':'';
 return {id,name:String(t.name||'API Key').replace(/[\x00-\x1f]/g,' ').slice(0,80),usable:!unavailableReason,unavailableReason};
}
// 设置 · 请求记录（用户 2026-11-02）：账号站消费日志的一行，只留用量、价格与时间；500000 额度 = $1。
function officialLog(r){
 if(!r||typeof r!=='object')return null;
 let other=r.other;if(typeof other==='string')try{other=JSON.parse(other);}catch{other={};}other=other&&typeof other==='object'?other:{};
 const n=v=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v):null,at=n(r.created_at);if(!at)return null;
 const clean=v=>String(v||'').replace(/[\x00-\x1f]/g,' ').slice(0,120);
 return {id:String(r.id||''),at:new Date(at*1000).toISOString(),model:clean(r.model_name),token:clean(r.token_name),input:(n(r.prompt_tokens)||0)+(other.claude===true?(n(other.cache_tokens)||0)+(n(other.cache_creation_tokens)||0):0),output:n(r.completion_tokens)||0,cached:n(other.cache_tokens),cache_write:n(other.cache_creation_tokens),cost:n(r.quota)==null?null:n(r.quota)/500000,duration_ms:n(r.use_time)==null?null:n(r.use_time)*1000,stream:r.is_stream===true,request_id:clean(r.request_id)};
}
function createOfficialAccount({BrowserWindow,session,owner,core,community,config,offscreen=false,onChange=()=>{},onWindow=()=>{},openInBrowser}){
 const providers=require('../src/provider-settings.cjs'),store=require('../src/catalog-store.cjs').createStore(config);
 let proof=null,cookieRevision=0,remoteSessionKey=null,verifiedAt='',refreshError='';
 const accountSession=session.fromPartition('persist:aieyra-os-account',{cache:false});
 accountSession.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
 accountSession.setPermissionCheckHandler(()=>false);
 let keyMasks={},keysTask=null,keysAt=0,keysSyncedAt='',keysNotice='';
 let portal=null,user=null,epoch=0,refreshing=null,tokens=[],selected=null,refreshTimer=null,closed=false,connecting=false,selectionRevision=0,restoring=false;
 const cfg=require('../src/config.cjs'),human=require('../src/user-connections.cjs');
 const savedAccount=()=>config?cfg.load(config).settings.official_account||{}:{};
 const clearAccount=()=>{if(config)human.persist(config,human.disconnectOfficialAccount);};
 let restored=false,restoreTask=null;
 async function restoreLogin(){
  if(restored)return restoreTask;restored=true;if(!config||!accountSession.cookies.get||!accountSession.cookies.set)return;
  const captured=epoch;
  restoreTask=(async()=>{
   const existing=await accountSession.cookies.get({url:ACCOUNT});if(existing.length||captured!==epoch||closed)return;
   restoring=true;try{for(const c of savedAccount().session_cookies||[]){
    if(captured!==epoch||closed)return;
    if(!SESSION_DOMAINS.includes(c.domain)||c.expirationDate&&c.expirationDate<Date.now()/1000)continue;
    const value=Object.fromEntries(['name','value','domain','path','secure','httpOnly','expirationDate','sameSite'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
    await accountSession.cookies.set({...value,url:ACCOUNT});
   }}finally{restoring=false;}
  })();return restoreTask;
 }
 async function remember(){
  if(!config)return;
  const captured=epoch,identity=user,choice=selected;
  const cookies=accountSession.cookies.get?await accountSession.cookies.get({url:ACCOUNT}):[];
  if(closed||captured!==epoch||user!==identity||selected!==choice)return;
  const session_cookies=cookies.filter(c=>SESSION_DOMAINS.includes(c.domain)).slice(0,32).map(c=>Object.fromEntries(['name','value','domain','path','secure','httpOnly','expirationDate','sameSite'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])));
  const value={user:identity,selected_token_id:choice?.id||'',selected_key_digest:choice?digest(choice.key):'',session_cookies};
  if(JSON.stringify(value)!==JSON.stringify(savedAccount()))human.persist(config,s=>({...s,official_account:value}));
 }
 const controllers=new Set();
 function invalidate(){verifiedAt='';refreshError='';keyMasks={};keysTask=null;keysAt=0;keysSyncedAt='';keysNotice='';epoch++;selectionRevision++;remoteSessionKey=null;selected=null;proof=null;tokens=[];for(const c of controllers)c.abort();controllers.clear();}
 const publicState=()=>({ok:true,signedIn:!!user,user:user?{id:user.id,name:user.name,username:user.username||'',email:user.email||'',group:user.group||'',quota:user.quota??null,usedQuota:user.usedQuota??null,requestCount:user.requestCount??null}:null,verifiedAt,refreshError,remoteAccount:user&&remoteSessionKey&&Number.isSafeInteger(Number(user.id))?{userID:Number(user.id),sessionKey:remoteSessionKey}:null,tokens,keyMasks:user?keyMasks:{},keysSyncedAt,keysNotice,selectedTokenId:selected?.id||'',community:community?.status()||null});
 async function request(endpoint,{method='GET',userId=user?.id,origin=ACCOUNT,key,body}={}){
  const captured=epoch,c=new AbortController();controllers.add(c);const timer=setTimeout(()=>c.abort(),15000);
  try{
   const headers={accept:'application/json'};if(userId&&origin===ACCOUNT)headers['New-Api-User']=userId;if(key)headers.authorization='Bearer '+key;if(body)headers['content-type']='application/json';
   const response=await accountSession.fetch(origin+endpoint,{method,headers,body:body?JSON.stringify(body):undefined,credentials:origin===ACCOUNT?'include':'omit',redirect:'error',signal:c.signal});
   if(!response.ok)throw Object.assign(Error(response.status===401?'请重新登录 Aieyra Token':'账号服务暂时不可用（'+response.status+'）'),{status:response.status});
   const reader=response.body.getReader(),chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('账号响应过大');}chunks.push(value);}
   if(captured!==epoch)throw Error('账号已切换，请重试');
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('账号响应格式不正确，请稍后重试');}if(data.success===false)throw Error('账号请求未成功，请在账号站检查状态');return data;
  }finally{clearTimeout(timer);controllers.delete(c);}
 }
 async function refresh(){
  if(closed)return publicState();if(refreshing)return refreshing;
  let captured=epoch;
  refreshing=(async()=>{
   try{
    await restoreLogin();if(closed||captured!==epoch)return publicState();
    const verifiedCookies=cookieRevision;
    if(accountSession.cookies.get){
     const cookies=await accountSession.cookies.get({url:ACCOUNT});
     if(closed||captured!==epoch||verifiedCookies!==cookieRevision)return publicState();
     if(!cookies.length){
      if(user){invalidate();user=null;void community?.logout();}
      if(config)clearAccount();
      verifiedAt='';refreshError='';const state=publicState();onChange(state);return state;
     }
    }
    const body=await request('/api/aieyra/session',{userId:''}),identity=body.data,id=String(identity?.id||'');
    if(body.success!==true||identity?.status!==1||!/^[1-9]\d{0,15}$/.test(id))throw Object.assign(Error('请登录 Aieyra Token'),{status:401});
    const self=await request('/api/user/self',{userId:id});if(self.success!==true||String(self.data?.id)!==id||self.data.status!==1)throw Object.assign(Error('账号身份不一致'),{status:401});
    const priorID=user?.id||savedAccount().user?.id;
    if(priorID&&priorID!==id){invalidate();captured=epoch;clearAccount();void community?.logout();}
    // 账号菜单只显示用户自己的公开资料：名字、登录名、邮箱、分组、余额、已用与请求次数。
    const clean=v=>String(v||'').replace(/[\x00-\x1f]/g,' ').slice(0,80),num=v=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v):null;
    user={id,name:clean(self.data.display_name||self.data.username||'Aieyra'),username:clean(self.data.username),email:clean(self.data.email),group:clean(self.data.group),quota:num(self.data.quota),usedQuota:num(self.data.used_quota),requestCount:num(self.data.request_count)};
    let cloudError='';if(community)try{await community.connect(user,accountSession);}catch(e){cloudError=String(e.message);}
    if(closed||captured!==epoch)return publicState();
    const list=[];for(let page=1;page<=50;page++){
     const result=await request('/api/token/?p='+page+'&size=100'),rows=result.data?.items||result.data?.tokens||result.data||result.items||[];
     if(!Array.isArray(rows))throw Error('账号 Key 列表格式不正确');list.push(...rows);if(rows.length<100||Number(result.data?.total)<=list.length)break;
    }
    tokens=[...new Map(list.map(t=>tokenMetadata(t)).filter(Boolean).map(t=>[t.id,t])).values()];
    if(selected&&!tokens.some(t=>t.id===selected.id&&t.usable)){selected=null;proof=null;selectionRevision++;}
    const saved=savedAccount();
    if(!selected&&saved.user?.id===id&&tokens.some(t=>t.id===saved.selected_token_id&&t.usable)&&config){
     const c=human.draft(require('../src/model-pool.cjs').migrate(cfg.load(config).settings),'aieyra');
     if(c?.api_key&&c.base_url===GATEWAY&&saved.selected_key_digest===digest(c.api_key))selected={id:saved.selected_token_id,key:c.api_key,epoch,models:store.get('catalog:'+providers.catalogID(c))?.models||[]};
    }
    if(closed||captured!==epoch)return publicState();
    if(portal&&!portal.isDestroyed()){portal.close();portal=null;}
    if(verifiedCookies!==cookieRevision)throw Error('账号会话已变化，请重新验证。');
    remoteSessionKey ||= require('node:crypto').randomUUID();
    await remember();verifiedAt=new Date().toISOString();refreshError='';const state={...publicState(),communityError:cloudError};onChange(state);return state;
   }catch(e){if(e.status===401&&captured===epoch){invalidate();user=null;void community?.logout();clearAccount();}if(captured===epoch)refreshError=e.status===401?'':String(e.message);onChange(publicState());return {...publicState(),error:e.status===401||captured!==epoch?'':String(e.message)};}
   finally{refreshing=null;}
  })();return refreshing;
 }
 function schedule(){clearTimeout(refreshTimer);if(!closed&&!restoring)refreshTimer=setTimeout(()=>void refresh(),500);}
 const cookiesChanged=(_e,cookie)=>{if(SESSION_HOSTS.includes(String(cookie.domain||'').replace(/^\./,''))){cookieRevision++;remoteSessionKey=null;onChange(publicState());schedule();}};
 accountSession.cookies.on('changed',cookiesChanged);
 function login(){
  if(openInBrowser)return openSite('login');
  if(portal&&!portal.isDestroyed()){if(!offscreen){portal.show();portal.focus();}return {ok:true};}
  portal=new (require('./shell-window.cjs').ShellWindow)({electron:require('electron'),parent:owner(),theme:config?require('./window-theme.cjs').createWindowTheme(config):null,width:960,height:740,minWidth:500,minHeight:540,title:'登录 Aieyra Token',backgroundColor:'#0b0d0d',offscreen,webPreferences:{session:accountSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  onWindow(portal);
  const allowed=url=>{try{return new URL(url).origin===ACCOUNT;}catch{return false;}};
  portal.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const event of ['will-navigate','will-redirect'])portal.webContents.on(event,(e,url)=>{if(!allowed(url))e.preventDefault();});
  portal.webContents.on('did-navigate',schedule);portal.webContents.on('did-navigate-in-page',schedule);
  portal.once('ready-to-show',()=>{if(portal&&!offscreen)portal.show();});portal.once('closed',()=>{portal=null;schedule();});
  void portal.loadURL(ACCOUNT+'/sign-in').catch(()=>onChange({...publicState(),error:'账号站暂时未连接，请稍后重试'}));return {ok:true};
 }
 async function openSite(page='profile'){
  if(!openInBrowser)return login();
  await restoreLogin();
  const url=page==='home'?OFFICIAL.site:ACCOUNT+(page==='login'?'/sign-in':'/profile/');
  const opened=await openInBrowser({url,profile:'aieyra-account',reuse:true});if(opened?.ok===false)throw Error(opened.error||'账号标签未能打开');return {ok:true};
 }
 async function select(id){
  if(connecting)throw Error('连接正在验证或保存，请稍候');
  const revision=++selectionRevision;proof=null;if(!id){selected=null;await remember();onChange(publicState());return {...publicState(),models:[]};}await refresh();const captured=epoch;
  const token=tokens.find(t=>t.id===String(id)&&t.usable);if(!token||!user)throw Error('请选择账号中可用的 Key');
  const response=await request('/api/token/'+token.id+'/key',{method:'POST'}),raw=String(response.data?.key||response.key||'').trim();
  if(!raw||raw.length<16||raw.length>4096||/[\r\n]/.test(raw))throw Error('Key 不可用');
  const key=raw.startsWith('sk-')?raw:'sk-'+raw;
  if(captured!==epoch||revision!==selectionRevision)throw Error('账号或 Key 已变化，请重新选择');
  // 和“获取列表”一样补上模型目录的档次与说明（src/model-catalog.cjs）。
  const models=require('../src/model-catalog.cjs').rows({base_url:GATEWAY},store.get('catalog:'+providers.catalogID({base_url:GATEWAY,api_key:key}))?.models||[]);
  selected={id:token.id,key,epoch:captured,models};if(config)human.cache(config,'aieyra',{base_url:GATEWAY,api_key:key});await remember();onChange(publicState());return {...publicState(),models};
 }
 // 设置 · Aieyra API（用户 2026-10-16）：登录后列出全部 Key，每把 Key 单独获取模型。
 // 一次取回可用 Key 的原文写进配置 aieyra_key_drafts（按编号）；渲染层只拿到名称与截断显示。
 async function keys({refresh:force=false,token_id:tokenID=''}={}){
  if(!user)throw Error('请先登录 Aieyra');
  if(tokenID&&!/^[1-9]\d{0,15}$/.test(String(tokenID)))throw Error('Key 编号无效');
  if(keysTask){await keysTask;if(!tokenID||keyMasks[tokenID])return publicState();}
  if(!force&&!tokenID&&Date.now()-keysAt<3000)return publicState();
  const task=Promise.resolve().then(async()=>{try{
   if(force){const r=await refresh();if(r.error)throw Error(r.error);if(!r.signedIn)throw Error('请重新登录 Aieyra');}
   const captured=epoch,revision=cookieRevision,identity=user?.id;
   const current=()=>!closed&&captured===epoch&&revision===cookieRevision&&identity===user?.id;
   if(!current())throw Error('账号已变化，请重新同步');
   const saved=config?cfg.load(config).settings:{},old=saved.aieyra_key_drafts||{},drafts={},masks={},at=new Date().toISOString();
   // Keep verified, unchanged drafts outside this batch; removed and unavailable Keys have no credential draft.
   for(const t of tokens.filter(t=>t.usable))if(old[t.id]?.account_id===identity){drafts[t.id]=old[t.id];if(old[t.id].api_key)masks[t.id]=old[t.id].api_key.slice(0,3)+'••••••'+old[t.id].api_key.slice(-4);}
   const usable=tokens.filter(t=>t.usable),bound=new Set((saved.provider_connections||[]).filter(c=>c.token_id).map(c=>c.token_id));
   const batch=tokenID?usable.filter(t=>t.id===String(tokenID)):usable.slice().sort((a,b)=>Number(bound.has(b.id))-Number(bound.has(a.id))).slice(0,64);
   if(tokenID&&!batch.length)throw Error('这把 Key 在账号中不可用，请同步账号状态');
   let index=0,failed=false;const deadline=Date.now()+30000;
   const workers=await Promise.allSettled(Array.from({length:Math.min(4,batch.length)},async()=>{
    try{while(index<batch.length&&!failed){
     if(Date.now()>deadline)throw Error('同步耗时过长，请稍后重试');
     const token=batch[index++],response=await request('/api/token/'+token.id+'/key',{method:'POST'}),raw=String(response.data?.key||response.key||'').trim();
     if(!current())throw Error('账号已变化，请重新同步');
     if(!raw||raw.length<16||raw.length>4096||/[\s\x00-\x1f]/.test(raw))throw Error('账号返回了无效 Key，请稍后重新同步');
     const key=raw.startsWith('sk-')?raw:'sk-'+raw;
     drafts[token.id]={api_key:key,name:token.name,account_id:identity,updated_at:at};masks[token.id]=key.slice(0,3)+'••••••'+key.slice(-4);
    }}catch(e){failed=true;throw e;}
   }));
   const failure=workers.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   if(!current())throw Error('账号已变化，请重新同步');
   const selectedDraft=selected&&drafts[selected.id];
   if(config)human.persist(config,s=>{
    if(s.official_account?.user?.id!==identity)throw Error('账号已变化，请重新同步');
    s.aieyra_key_drafts=drafts;
    // Update live credentials as well as drafts. Local enable switches and model roles retain the user's choices.
    for(const c of s.provider_connections){const d=drafts[c.token_id];if(!d||c.id!=='user-aieyra-'+c.token_id||c.account_id&&c.account_id!==identity)continue;
     Object.assign(c,{api_key:d.api_key,api_key_history:[...new Set([d.api_key,c.api_key,...c.api_key_history||[]].filter(Boolean))].slice(0,8),key_name:d.name,account_id:identity,base_url:GATEWAY});
    }
    // Onboarding used a single legacy slot; synchronize its verified selected Key too.
    if(selectedDraft){
     const c=s.provider_connections.find(c=>c.id==='user-aieyra'&&c.base_url===GATEWAY&&digest(c.api_key)===s.official_account.selected_key_digest);
     if(c){c.api_key=selectedDraft.api_key;c.api_key_history=[...new Set([c.api_key,...c.api_key_history||[]])].slice(0,8);}
     s.user_connection_drafts={...s.user_connection_drafts,aieyra:{...s.user_connection_drafts?.aieyra,api_key:selectedDraft.api_key,base_url:GATEWAY,updated_at:at}};
     s.official_account={...s.official_account,selected_key_digest:digest(selectedDraft.api_key)};
    }
    return require('../src/model-pool.cjs').synchronize(s);
   });
   if(selectedDraft&&selected.key!==selectedDraft.api_key){selected={...selected,key:selectedDraft.api_key,models:[]};proof=null;selectionRevision++;}
   keyMasks=masks;keysAt=Date.now();keysSyncedAt=at;keysNotice=usable.length>64?'本次更新 64 把 Key，其余 Key 可在启用时单独同步。':'';const state=publicState();onChange(state);return state;
  }finally{if(keysTask===task)keysTask=null;}});
  keysTask=task;return task;
 }
 async function logs({page=1,page_size=50,start=0,end=0}={}){
  if(!user)throw Error('请先登录 Aieyra');
  const q=new URLSearchParams({p:String(Math.max(1,Math.floor(Number(page))||1)),page_size:String(Math.min(100,Math.max(1,Math.floor(Number(page_size))||50))),type:'2'});
  if(Number(start)>0)q.set('start_timestamp',String(Math.floor(start)));if(Number(end)>0)q.set('end_timestamp',String(Math.floor(end)));
  const result=await request('/api/log/self?'+q),data=result.data||{},rows=Array.isArray(data)?data:data.items||data.data||[];
  if(!Array.isArray(rows))throw Error('账号请求记录格式不正确');
  return {ok:true,page:Number(q.get('p')),page_size:Number(q.get('page_size')),total:Number(data.total)||rows.length,rows:rows.map(officialLog).filter(Boolean)};
 }
 async function catalog(){
  const current=selected,captured=epoch;if(!user||!current)throw Error('请先选择账号 Key');if(connecting)throw Error('正在连接，请稍候');connecting=true;proof=null;
  try{const result=await core('settings',{action:'onboarding_catalog',base_url:GATEWAY,api_key:current.key,user_slot:'aieyra'});if(captured!==epoch||selected!==current)throw Error('账号或 Key 已变化，请重试');if(result.ok!==false)current.models=result.models||[];return result;}finally{connecting=false;}
 }
 async function modelAction(action,p){
  if(connecting)throw Error('连接正在验证或保存，请稍候');
  const current=selected,captured=epoch,row=current?.models.find(m=>m.id===p.model);
  if(!current||current.epoch!==captured||!row)throw Error('请先登录并选择账号 Key 和模型');
  const protocol=p.api_protocol||p.protocol||'responses';
  if(!['responses','chat_completions','anthropic_messages','google_generate'].includes(protocol))throw Error('暂未识别此模型接口');
  connecting=true;
  try{
   // 每个模型的上下文窗口与压缩位置（拉条）随检测一起送到后端，保存时沿用检测时的值。
   const context=Object.fromEntries(['context_window','compact_at_tokens'].filter(k=>Number.isSafeInteger(p[k])&&p[k]>=0).map(k=>[k,p[k]]));
   const result=await core('settings',{action:'onboarding_'+action,base_url:GATEWAY,api_key:current.key,user_slot:'aieyra',model:p.model,api_protocol:protocol,auto_protocol:true,parameters:p.parameters||{},...context});
   if(epoch!==captured||selected!==current)throw Error('账号或 Key 已变化，请重新选择');
   if(action==='test')proof=result.ok===false?null:{result,current,captured};
   return result;
  }finally{connecting=false;}
 }
 async function save(p){
  if(connecting)throw Error('连接正在验证或保存，请稍候');
  if(!proof||proof.current!==selected||proof.captured!==epoch||p.test_id!==proof.result.test_id)throw Error('请先测试当前模型');
  const roles=Array.isArray(p.roles)?p.roles.filter(r=>r==='main'||r==='subconscious'):undefined;
  connecting=true;try{const result=await core('settings',{action:'onboarding_save',test_id:proof.result.test_id,expected_version:proof.result.version,...(roles?{roles}:{})});if(result.ok!==false)proof=null;return {...result,official:true};}finally{connecting=false;}
 }
 async function connect(p){const result=await modelAction('test',p);return result.ok===false?result:save(result);}
 async function authorizeTogether(binding,url,signal){
  const current=()=>!closed&&remoteSessionKey&&binding?.sessionKey===remoteSessionKey&&String(binding.userID)===user?.id;
  if(!current())throw Error('OS 账号已变化');
  const callback=await require('./community.cjs').desktopAuthorization(accountSession,url,OFFICIAL.updates,signal);
  if(!current())throw Error('OS 账号已变化');
  return callback.href;
 }
 async function logout(){if(connecting)throw Error('连接正在保存，请稍候再退出账号');clearTimeout(refreshTimer);invalidate();user=null;clearAccount();onChange(publicState());void community?.logout();if(portal&&!portal.isDestroyed())portal.close();await restoreTask?.catch(()=>{});await accountSession.clearStorageData();return publicState();}
 return {status:publicState,refresh,login,openSite,browserSession:()=>accountSession,authorizeTogether,select,keys,logs,catalog,connect,parameters:p=>modelAction('parameters',p),test:p=>modelAction('test',p),save,logout,canHandoff:()=>!connecting&&!portal,close(){closed=true;clearTimeout(refreshTimer);accountSession.cookies.removeListener('changed',cookiesChanged);invalidate();if(portal&&!portal.isDestroyed())portal.close();}};
}
module.exports={createOfficialAccount,tokenMetadata,officialLog,ACCOUNT,GATEWAY};
