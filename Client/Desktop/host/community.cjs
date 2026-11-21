// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; OFFICIAL; hash; desktopAuthorization; cancelled; cloudHttpError; createCommunityClient; startCommunityBridge
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/community.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 云端凭据只存在原生宿主内存；模型通过限权回环接口提交公开内容。
const crypto=require('node:crypto'),http=require('node:http');
const OFFICIAL=require('../../../Contracts/official-services.json'),CLOUD=OFFICIAL.updates,ACCOUNT=OFFICIAL.account;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function desktopAuthorization(accountSession,authorization,origin,signal){
 const url=new URL(authorization),flow=url.searchParams.get('flow');
 if(url.origin!==ACCOUNT||url.pathname!=='/aieyra/os/authorize'||!flow||url.searchParams.getAll('flow').length!==1||url.username||url.password||url.hash)throw Error('账号授权地址无效');
 url.searchParams.set('response','json');
 const response=await accountSession.fetch(url.href,{credentials:'include',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])});
 if(!response.ok)throw Error('OS 账号授权未完成，请检查 OS 登录状态');
 const answer=await response.json();
 if(typeof answer.callbackUrl!=='string'||answer.callbackUrl.length>1024)throw Error('账号授权响应无效');
 const callback=new URL(answer.callbackUrl);
 if(callback.origin!==origin||callback.pathname!=='/auth/desktop-callback'||callback.username||callback.password||callback.hash||
    callback.searchParams.getAll('state').length!==1||callback.searchParams.get('state')!==flow||
    callback.searchParams.getAll('code').length!==1||!callback.searchParams.get('code'))throw Error('账号授权响应无效');
 return callback;
}
const cancelled=()=>Object.assign(Error('主题请求已取消或账号已切换'),{code:'cloud_cancelled'});
function cloudHttpError(response,data,now){
 const header=response.headers?.get('retry-after')||'',seconds=/^\d+(?:\.\d+)?$/.test(header)?Number(header):null;
 const delay=seconds===null?Date.parse(header)-now():seconds*1000,retryAfterMs=Number.isFinite(delay)?Math.max(0,Math.min(86400000,delay)):0;
 return Object.assign(Error(typeof data?.error==='string'?data.error:'OS 云服务暂时不可用（HTTP '+response.status+'）'),{status:response.status,code:'cloud_http',retryAfterMs});
}
function createCommunityClient({fetchImpl=fetch,origin=CLOUD,now=Date.now}={}){
 const pair=crypto.generateKeyPairSync('ed25519');let credential=null,generation=0,connecting=null,authController=new AbortController(),accountBinding=null,closed=false;
 const listeners=new Set(),themePending=new Map(),themeQueue=[];let themeActive=0,themeFailures=0,themeRetryAt=0,themeFailure=null,themeRevision=0;
 const changed=()=>{authController.abort();authController=new AbortController();themePending.clear();for(const fn of listeners)fn(status().signedIn);};
 const status=()=>({ok:true,signedIn:!!credential&&credential.expiresAt>now(),user:credential?.user||null});
 async function request(route,payload,{token,method=payload?'POST':'GET',signed=false,binding,signal}={}){
  if(closed||signal?.aborted)throw cancelled();
  if(binding&&credential!==binding)throw Error('账号已切换，请重新读取');
  const headers={accept:'application/json','x-aieyra-os-client':'1'};const body=payload?JSON.stringify(payload):undefined;
  if(body)headers['content-type']='application/json';if(token)headers.authorization='Bearer '+token;
  if(signed){const time=String(now()),nonce=crypto.randomBytes(24).toString('base64url');headers['x-os-time']=time;headers['x-os-nonce']=nonce;headers['x-os-proof']='2';headers['x-os-signature']=crypto.sign(null,Buffer.from(['aieyra-os-proof-v2',hash(token),method,route,time,nonce,hash(body)].join('\n')),pair.privateKey).toString('base64url');}
  const abort=AbortSignal.any([AbortSignal.timeout(20000),...(binding?[authController.signal]:[]),...(signal?[signal]:[])]);
  let response;try{response=await fetchImpl(origin+route,{method,headers,body,redirect:'error',signal:abort});}catch{if(closed||signal?.aborted||binding&&credential!==binding)throw cancelled();throw Object.assign(Error('OS 云服务暂时未连接；若已提交，请先查询原提交回执再重试'),{code:'cloud_unavailable'});}
  let size=0,chunks=[];
  try{for await(const chunk of response.body||[]){size+=chunk.length;if(size>1048576)throw Object.assign(Error('OS 云服务响应过大'),{code:'cloud_response_invalid'});chunks.push(chunk);}}
  catch(error){if(closed||signal?.aborted||binding&&credential!==binding)throw cancelled();if(!response.ok)throw cloudHttpError(response,null,now);throw Object.assign(error,{code:error.code||'cloud_unavailable'});}
  if(closed||signal?.aborted)throw cancelled();
  let data;try{data=JSON.parse(Buffer.concat(chunks));}catch{if(!response.ok)throw cloudHttpError(response,null,now);throw Object.assign(Error('OS 云服务响应无效'),{code:'cloud_response_invalid'});}
  if(binding&&credential!==binding)throw Error('账号已切换，请重新读取');
  if(!response.ok)throw cloudHttpError(response,data,now);return data;
 }
 async function connect(user,accountSession,force=false){
  if(!user||typeof user.id!=='string'||!accountSession?.fetch)throw Error('账号身份无效');
  if(accountBinding?.user.id!==user.id){generation++;const old=credential;credential=null;changed();if(old)void request('/api/v1/auth/logout',{}, {token:old.accessToken}).catch(()=>{});}
  const binding={user,accountSession};accountBinding=binding;
  if(connecting){await connecting.catch(()=>{});if(accountBinding!==binding)throw Error('账号连接已更新');}
  if(!force&&credential?.user.id===user.id&&credential.expiresAt>now()+60000)return status();
  const captured=generation;
  connecting=(async()=>{
   const verifier=crypto.randomBytes(32).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
   const flow=await request('/api/v1/auth/start',{kind:'desktop',challenge,publicKey:pair.publicKey.export({format:'pem',type:'spki'})});
   const authorization=new URL(flow.authorizationUrl);if(authorization.origin!==ACCOUNT||authorization.pathname!=='/aieyra/os/authorize'||authorization.searchParams.get('flow')!==flow.flow)throw Error('账号授权地址无效');
   const callback=await desktopAuthorization(accountSession,authorization.href,origin);
   const result=await request('/api/v1/auth/exchange',{flow:flow.flow,code:callback.searchParams.get('code'),verifier});
   if(result.user?.id!==user.id||captured!==generation||accountBinding!==binding){if(result.accessToken)await request('/api/v1/auth/logout',{}, {token:result.accessToken}).catch(()=>{});throw Error('账号已切换，请重新连接');}
   if(!/^[A-Za-z0-9_-]{43}$/.test(result.accessToken||'')||!Number.isSafeInteger(result.expiresAt)||result.expiresAt<=now())throw Error('云端登录响应无效');const old=credential;credential=result;changed();if(old)await request('/api/v1/auth/logout',{}, {token:old.accessToken}).catch(()=>{});return status();
  })();try{return await connecting;}finally{connecting=null;}
 }
 async function logout(){generation++;const old=credential;credential=null;accountBinding=null;changed();if(old)await request('/api/v1/auth/logout',{}, {token:old.accessToken}).catch(()=>{});}
 async function call(p){
  if(p.action==='status')return status();
  const elevated=['topic_state','moderate'].includes(p.action)||p.action==='topic_publish'&&(p.type==='update'||p.official===true);
  if(elevated){if(!accountBinding)throw Error('请先登录超管账号');await connect(accountBinding.user,accountBinding.accountSession,true);}
  const current=credential;if(!current||current.expiresAt<=now())throw Error('请先在 Aieyra OS 登录 Aieyra 账号');
  const options={token:current.accessToken,binding:current};
  try{
   if(p.action==='center_list'){const q=new URLSearchParams();for(const k of ['kind','q','cursor','sort'])if(p[k])q.set(k,p[k]);return await request('/api/v1/center/items?'+q,null,options);}
   if(p.action==='center_read')return await request('/api/v1/center/items/'+encodeURIComponent(String(p.id)),null,options);
   if(p.action==='center_begin')return await request('/api/v1/center/uploads',{requestId:p.request_id,manifest:p.manifest,publication:'public',confirmed:p.confirmed===true},{...options,signed:true});
   if(['center_chunk','center_commit','center_upload_status'].includes(p.action)){
    if(!/^[a-f0-9-]{36}$/.test(p.upload_id||''))throw Error('上传 ID 无效');
    const op={center_chunk:'chunk',center_commit:'commit',center_upload_status:'status'}[p.action];
    return await request('/api/v1/center/uploads/'+p.upload_id+'/'+op,p.action==='center_chunk'?{offset:p.offset,data:p.data}:p.action==='center_commit'?{requestId:p.request_id}:{},{...options,signed:true});
   }
   if(p.action==='center_withdraw')return await request('/api/v1/center/items/'+encodeURIComponent(String(p.id))+'/withdraw',{requestId:p.request_id,expectedDigest:p.expected_digest},{...options,signed:true});
   const topic='/api/v1/matrix/topics/'+encodeURIComponent(String(p.id));
   if(p.action==='home_status')return await request('/api/v1/matrix/status',null,options);
   if(p.action==='topics'){const q=new URLSearchParams();for(const k of ['cursor','query','type','sort'])if(p[k])q.set(k,p[k]);return await request('/api/v1/matrix/topics'+(q.size?'?'+q:''),null,options);}
   if(p.action==='topic_read')return await request(topic,null,options);
   if(p.action==='sync')return await request('/api/v1/matrix/events?after='+encodeURIComponent(p.after||0),null,options);
   if(p.action==='topic_updates')return await request(topic+'/updates'+(p.cursor?'?cursor='+encodeURIComponent(p.cursor):''),null,options);
   if(p.action==='replies')return await request(topic+'/replies'+(p.cursor?'?cursor='+encodeURIComponent(p.cursor):''),null,options);
   if(p.action==='reply')return await request(topic+'/replies',{requestId:p.request_id,content:p.content},{...options,signed:true});
   if(p.action==='reply_withdraw')return await request(topic+'/replies/'+encodeURIComponent(String(p.reply_id))+'/withdraw',{requestId:p.request_id},{...options,signed:true});
   if(p.action==='import_feedback')throw Error('旧私密反馈不自动公开；请另行整理不含私人信息的公开最小复现');
   if(p.action==='topic_like'){if(typeof p.liked!=='boolean')throw Error('需要明确 liked 状态');return await request(topic+'/likes',{requestId:p.request_id,liked:p.liked},{...options,signed:true});}
   if(p.action==='topic_publish'){
    if(p.confirmed!==true)throw Error('请核对所选公开内容已脱敏');
    return await request('/api/v1/matrix/topics',{requestId:p.request_id,publication:'public',confirmed:true,type:p.type||'discussion',official:p.official===true,title:p.title,summary:p.summary,content:p.content,projectUrl:p.project_url||'',sourceType:p.source_type||'',sourceId:p.source_id||''},{...options,signed:true});
   }
   if(['topic_state','topic_withdraw','moderate'].includes(p.action))return await request(topic+'/'+({topic_state:'state',topic_withdraw:'withdraw',moderate:'moderate'}[p.action]),{requestId:p.request_id,expectedRevision:p.expected_revision,state:p.state,note:p.note},{...options,signed:true});
   if(p.action==='list')return await request('/api/v1/community'+(p.cursor?'?cursor='+encodeURIComponent(p.cursor):''),null,options);
   if(p.action==='read')return await request('/api/v1/community/'+encodeURIComponent(String(p.id)),null,options);
   if(p.action==='receipt')return await request('/api/v1/community/operations/'+encodeURIComponent(String(p.request_id)),null,options);
   if(p.action==='publish'){
    if(p.confirmed!==true)throw Error('请明确选择公开，并检查内容中没有私人资料或凭据');
    return await request('/api/v1/community',{requestId:p.request_id,publication:'public',confirmed:true,title:p.title,summary:p.summary,content:p.content,projectUrl:p.project_url||''},{...options,signed:true});
   }
   if(p.action==='withdraw')return await request('/api/v1/community/'+encodeURIComponent(String(p.id)),{confirmed:true},{...options,method:'DELETE',signed:true});
   throw Error('不支持的分享操作');
  }catch(e){if(e.status===401&&credential===current){credential=null;changed();}throw e;}
 }
 async function authorizedFetch(input,options={}){
  const url=new URL(input),current=credential;
  if(url.origin!==origin||!(/^\/api\/v1\/releases\/(stable|events)$/.test(url.pathname)||/^\/downloads\/[a-zA-Z0-9._-]+$/.test(url.pathname))||url.search||url.hash)throw Error('更新地址无效');
  if(!current||current.expiresAt<=now())throw Error('请先登录 Aieyra 后接收更新');
  const response=await fetchImpl(url.href,{...options,method:'GET',redirect:'error',credentials:'omit',headers:{accept:'application/json',authorization:'Bearer '+current.accessToken,'x-aieyra-os-client':'1'},signal:options.signal?AbortSignal.any([options.signal,authController.signal]):authController.signal});
  if(credential!==current) {await response.body?.cancel();throw Error('账号已退出');}
  if(response.status===401){credential=null;changed();}
  return response;
 }
 async function centerDownload(id){
  if(!/^[a-z][a-z0-9_-]{0,47}\.[a-z][a-z0-9_-]{0,63}$/.test(id||''))throw Error('资源 ID 无效');
  const current=credential;if(!current||current.expiresAt<=now())throw Error('请先登录 Aieyra');const signal=AbortSignal.any([AbortSignal.timeout(30*60*1000),authController.signal]);
  const response=await fetchImpl(origin+'/api/v1/center/items/'+id+'/file',{headers:{authorization:'Bearer '+current.accessToken,'x-aieyra-os-client':'1'},redirect:'error',credentials:'omit',signal});
  const assertCurrent=()=>{if(credential!==current||signal.aborted||current.expiresAt<=now())throw Error('资源下载会话已失效');};
  try{assertCurrent();}catch(e){await response.body?.cancel();throw e;}return {response,assertCurrent};
 }
 // Theme browsing is public; likes retain the existing account and native proof.
 function themeCooldown(){
  if(closed)throw cancelled();
  if(themeRetryAt>now())throw Object.assign(Error('OS 云服务暂时繁忙，请 '+Math.ceil((themeRetryAt-now())/1000)+' 秒后重试'),{code:'theme_cooldown',status:themeFailure?.status,retryAt:themeRetryAt,retryAfterMs:themeRetryAt-now()});
 }
 function themePermit(signal){
  if(signal.aborted)return Promise.reject(cancelled());
  if(themeQueue.length>=64)return Promise.reject(Object.assign(Error('主题请求较多，请稍后重试'),{code:'theme_busy'}));
  return new Promise((resolve,reject)=>{
   let released=false;const release=()=>{if(released)return;released=true;themeActive--;themeQueue.shift()?.start();};
   const cancel=()=>{const index=themeQueue.indexOf(entry);if(index>=0)themeQueue.splice(index,1);signal.removeEventListener('abort',cancel);reject(cancelled());};
   const entry={start(){signal.removeEventListener('abort',cancel);themeActive++;resolve(release);}};
   if(themeActive<4)entry.start();else{themeQueue.push(entry);signal.addEventListener('abort',cancel,{once:true});}
  });
 }
 function themeFailed(error){
  if(error.code==='theme_cooldown'||!(error.status===429||error.status>=500||['cloud_unavailable','cloud_response_invalid'].includes(error.code)))return;
  themeFailures++;const backoff=Math.min(300000,(error.status===429?15000:5000)*2**Math.min(themeFailures-1,6));
  themeRetryAt=Math.max(themeRetryAt,now()+Math.max(backoff,error.retryAfterMs||0));themeFailure=error;themeRevision++;
  Object.assign(error,{retryAt:themeRetryAt,retryAfterMs:themeRetryAt-now()});
 }
 function themeBody(response,release,abort,bodySignal){
  const reader=response.body.getReader();let controller,finished=false;
  const finish=()=>{if(finished)return;finished=true;abort.removeEventListener('abort',cancel);bodySignal.removeEventListener('abort',cancel);release();};
  const fail=reason=>{
   if(finished)return;const error=abort.aborted||closed?cancelled():Object.assign(Error('主题图片读取中断，请稍后重试'),{code:'cloud_unavailable'});
   if(error.code!=='cloud_cancelled')themeFailed(error);controller.error(error);finish();void reader.cancel(reason).catch(()=>{});
  };
  const cancel=()=>fail(bodySignal.reason);
  const body=new ReadableStream({
   start(value){controller=value;abort.addEventListener('abort',cancel,{once:true});bodySignal.addEventListener('abort',cancel,{once:true});if(abort.aborted||bodySignal.aborted)cancel();},
   async pull(value){try{const row=await reader.read();if(finished)return;if(row.done){finish();value.close();}else value.enqueue(row.value);}catch(error){fail(error);}},
   cancel(reason){finish();return reader.cancel(reason);}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 }
 function themeOperation(key,run,signal){
  if(signal?.aborted)return Promise.reject(cancelled());
  const shared=key&&generation+':'+key;if(shared&&themePending.has(shared))return themePending.get(shared);
  try{themeCooldown();}catch(error){return Promise.reject(error);}
  const abort=AbortSignal.any([authController.signal,...(signal?[signal]:[])]);
  const operation=(async()=>{
   const release=await themePermit(abort);let revision,held=false;
   try{
    if(abort.aborted)throw cancelled();themeCooldown();revision=themeRevision;
    const result=await run(abort);if(abort.aborted||closed)throw cancelled();
    if(revision===themeRevision){themeFailures=0;themeRetryAt=0;themeFailure=null;}
    if(key===null){if(result.response.body){result.response=themeBody(result.response,release,abort,result.signal);held=true;}delete result.signal;}
    return result;
   }catch(error){
    if(error.status===401)throw error;
    if(abort.aborted||closed)throw cancelled();
    themeFailed(error);
    throw error;
   }finally{if(!held)release();}
  })().finally(()=>{if(shared&&themePending.get(shared)===operation)themePending.delete(shared);});
  if(shared)themePending.set(shared,operation);return operation;
 }
 // URLs are constructed here, never supplied by a renderer or downloaded metadata.
 async function themeRequest(p={}){
  const {ID,DIGEST}=require('../../../Theme/runtime/media-preferences.cjs');
  const current=credential?.expiresAt>now()?credential:null;
  const options=current?{token:current.accessToken,binding:current}:{};
  const send=(route,payload,extra={})=>themeOperation(route+':'+JSON.stringify(payload),async signal=>{try{return await request(route,payload,{...options,...extra,signal});}catch(error){if(error.status===401&&current&&credential===current){credential=null;changed();}throw error;}},p.signal);
  if(p.action==='list'){
   if(!['background','avatar','ui','halo'].includes(p.category)||!['recommended','hot','latest','pending'].includes(p.sort||'recommended')||typeof (p.q||'')!=='string'||(p.q||'').length>120||typeof (p.cursor||'')!=='string'||(p.cursor||'').length>512)throw Error('主题筛选无效');
   const query=new URLSearchParams({category:p.category,sort:p.sort||'recommended',platform:'windows'});
   if(p.category==='background')query.set('orientation','landscape');
   for(const k of ['q','cursor'])if(p[k])query.set(k,p[k]);
   return send('/api/v1/themes/items?'+query,null);
  }
  if(!ID.test(p.id||''))throw Error('主题 ID 无效');
  const route='/api/v1/themes/items/'+p.id;
  if(p.action==='read')return send(route,null);
  if(p.action==='like'){
   if(!current)throw Error('请先在 Aieyra OS 登录 Aieyra 账号');
   if(typeof p.liked!=='boolean'||!DIGEST.test(p.digest||''))throw Error('点赞参数无效');
   return send(route+'/likes',{liked:p.liked,expectedDigest:p.digest},{signed:true});
  }
  throw Error('未知主题操作');
 }
 async function themeMedia({id,variant,digest,signal}={}){
  const {ID,DIGEST}=require('../../../Theme/runtime/media-preferences.cjs');
  if(!ID.test(id||'')||!['preview','image','file'].includes(variant)||!DIGEST.test(digest||''))throw Error('主题图片地址无效');
  const original=variant==='file',current=credential;
  if(original&&(!current||current.expiresAt<=now()))throw Error('请先在 Aieyra OS 登录 Aieyra 账号');
  return themeOperation(null,async queuedSignal=>{
   const abort=AbortSignal.any([AbortSignal.timeout(30000),queuedSignal]);
   let response;try{response=await fetchImpl(origin+'/api/v1/themes/items/'+id+'/'+variant+(original?'':'?v='+digest),{method:'GET',redirect:'error',credentials:'omit',headers:{'x-aieyra-os-client':'1',...(original?{authorization:'Bearer '+current.accessToken}:{})},signal:abort});}
   catch{if(queuedSignal.aborted)throw cancelled();throw Object.assign(Error('主题图片暂时未连接，请稍后重试'),{code:'cloud_unavailable'});}
   const assertCurrent=()=>{if(abort.aborted||original&&(credential!==current||current.expiresAt<=now()))throw Error('图片请求已取消或账号已切换');};
   try{assertCurrent();}catch(error){await response.body?.cancel();throw error;}
   if(!response.ok){if(original&&response.status===401&&credential===current){credential=null;changed();}await response.body?.cancel();throw cloudHttpError(response,null,now);}
   return {response,assertCurrent,signal:abort};
  },signal);
 }
 async function reportIssue(owner,payload,signal){
  const binding=accountBinding;
  if(!binding||hash(String(binding.user.id))!==owner)throw cancelled();
  if(!credential||credential.expiresAt<=now()+60000)await connect(binding.user,binding.accountSession);
  const current=credential;
  if(signal.aborted||!current||current.expiresAt<=now()||hash(String(current.user.id))!==owner)throw cancelled();
  try{return await request('/api/v1/matrix/together/feedback',payload,{token:current.accessToken,binding:current,signed:true,signal});}
  catch(error){if(error.status===401&&credential===current){credential=null;changed();}throw error;}
 }
 return {get themeOrigin(){return origin;},status,connect,logout,call,reportIssue,authorizedFetch,centerDownload,themeRequest,themeMedia,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){if(closed)return;closed=true;generation++;credential=null;accountBinding=null;changed();listeners.clear();}};
}
async function startCommunityBridge(client){
 const secret=crypto.randomBytes(32).toString('hex');let authority='';
 const server=http.createServer(async(req,res)=>{
  const controller=new AbortController();req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
  res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');
  if(req.headers.host!==authority||req.headers.origin||req.headers['sec-fetch-site']||req.url!=='/'+secret||req.method!=='POST'){res.writeHead(403);res.end('{"ok":false}');return;}
  try{let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('分享内容过大');parts.push(chunk);}const p=JSON.parse(Buffer.concat(parts));if(!p||typeof p!=='object'||Array.isArray(p))throw Error('分享请求无效');res.end(JSON.stringify(await client.call(p,controller.signal)));}
  catch(e){res.end(JSON.stringify({ok:false,error:String(e.message),...(e.code?{code:String(e.code)}:{})}));}
 });server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});authority='127.0.0.1:'+server.address().port;
 return {url:'http://'+authority+'/'+secret,close(){server.close();server.closeAllConnections();client.close();}};
}
module.exports={createCommunityClient,startCommunityBridge,desktopAuthorization,CLOUD};
