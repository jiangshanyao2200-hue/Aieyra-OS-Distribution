// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: entitlementText; jobText; finalJobs; abortError; check; remoteLinkTransport; setupRemoteLink
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/remote-link.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {RemoteLinkClient,RemoteLinkError} from '../../../Link/cloud/client/remote-link.mjs';
import official from '../../../Contracts/official-services.mjs';

const entitlementText={signed_out:'在设置的 Aieyra API 里登录后可用。',loading:'正在读取本人服务器…',active:'选择服务器，打开终端或核对部署任务。',none:'此账号没有可用的远程服务器。',awaiting_delivery:'服务器正在交付，完成后可连接。',expired:'远程服务已到期。',unavailable:'远程服务暂时不可用。'};
const jobText={accepted:'已受理',preflight:'检查环境',installing:'正在安装',verifying:'正在验证',ready:'已就绪',needs_attention:'需要核对',cancelled:'已取消',rejected:'已拒绝'};
const finalJobs=new Set(['ready','cancelled','rejected']);
const abortError=()=>new DOMException('账号或视图已变更。','AbortError');
const check=value=>{if(value?.ok===false)throw new RemoteLinkError(value.code||'remote_request_failed',value.error||'远程操作未完成。');return value;};

// Fetch-shaped adapter. Cookies remain in Electron's verified account session.
export function remoteLinkTransport(api,current){
 return async(url,options={})=>{
  const account=current();if(!account||options.signal?.aborted)throw abortError();
  const requestID=crypto.randomUUID();
  const cancel=()=>{void api.remoteLink({action:'cancel',requestID,sessionKey:account.sessionKey}).catch(()=>{});};
  options.signal?.addEventListener('abort',cancel,{once:true});
  try{
   const result=check(await api.remoteLink({action:'request',requestID,sessionKey:account.sessionKey,userID:account.userID,url,method:options.method,...(options.body===undefined?{}:{body:options.body})}));
   if(options.signal?.aborted||current()?.sessionKey!==account.sessionKey)throw abortError();
   return {ok:result.status>=200&&result.status<300,status:result.status,json:async()=>structuredClone(result.value)};
  }catch(error){if(options.signal?.aborted||current()?.sessionKey!==account.sessionKey)throw abortError();throw error;}
  finally{options.signal?.removeEventListener('abort',cancel);}
 };
}

// 登录只在 OS 设置里做（用户 2026-10-15）：这里不放登录/退出按钮。没登录或账号下没有服务器时整块不出现，
// 只通过 onSummary 告诉宿主"有几台服务器"，由宿主决定是否显示入口。
export function setupRemoteLink(api,{panel,doc=document,onSummary=()=>{},onBack=null,onSettings=null}={}){
 if(typeof api.remoteLink!=='function')return {setActive(){},setOpen(){},close(){}};
 if(!doc.querySelector('link[data-remote-link-style]')){
  const style=doc.createElement('link');style.rel='stylesheet';style.href=new URL('./remote-link.css',import.meta.url).href;style.dataset.remoteLinkStyle='';doc.head.append(style);
 }
 panel.classList.add('remote-link-panel');panel.hidden=true;
 let account=null,active=false,shown=false,pending=null,closed=false,version=0,selection=0,busy=false,discovering=false,state='signed_out',notice='',selected=null,descriptor=null,sessions=[],jobs=[],terminal=null,unregister=null,frame=0;
 let resources=[];
 const plans=new Map(),unknown=new Map();
 const client=new RemoteLinkClient({origin:official.account,transport:remoteLinkTransport(api,()=>account),administratorServers:true});
 const node=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
 const button=(text,action,disabled=false)=>{const e=node('button',text);e.type='button';e.dataset.remoteAction=action;e.disabled=disabled||busy;return e;};
 const fact=(list,name,value)=>{list.append(node('dt',name),node('dd',value??'待确认'));};
 function closeTerminal(target=terminal){
  if(target===terminal){unregister?.();unregister=null;terminal=null;cancelAnimationFrame(frame);frame=0;}
  if(!target)return Promise.resolve();
  return api.remoteLink({action:'terminalClose',sessionKey:target.sessionKey,viewID:target.viewID}).catch(()=>{});
 }
 function clear(){version++;selection++;busy=false;selected=descriptor=null;sessions=[];jobs=[];resources=[];plans.clear();unknown.clear();void closeTerminal();}
 function paint(){
  if(closed)return;
  const header=node('div',undefined,'remote-link-heading');if(onBack)header.append(button('← 返回 Link','back'));header.append(node('h2','远程服务器'));if(account)header.append(button('刷新','refresh',discovering));
  const message=node('p',notice||entitlementText[state]||'远程状态待确认。','remote-link-notice');message.setAttribute('role','status');
  const servers=node('div',undefined,'remote-link-servers');
  for(const resource of resources){const row=button(resource.name||resource.title||'服务器 '+resource.id,'select');row.disabled=discovering;row.dataset.remoteInstance=String(resource.id);row.setAttribute('aria-pressed',String(selected===resource.id));servers.append(row);}
  const contents=[header,message,servers];
  if(!account&&onSettings)contents.splice(2,0,button('去设置登录 Aieyra','settings'));
  if(terminal){
   const view=node('section',undefined,'remote-link-terminal'),top=node('div',undefined,'remote-link-actions');
   top.append(node('strong','SSH · '+terminal.server),button('关闭视图，保留远端会话','terminal-close'));
   const slot=node('div',undefined,'remote-link-terminal-surface');slot.setAttribute('aria-label','SSH 终端');view.append(top,slot);contents.push(view);
  }
  if(descriptor&&selected){
   const detail=node('section',undefined,'remote-link-detail'),facts=node('dl'),transport=descriptor.transport;
   fact(facts,'服务器',transport.server_id||descriptor.remote.reference||selected);
   if(descriptor.resource_scope==='administrator_server')fact(facts,'访问身份','管理员服务器 · 当前超管账号');
   fact(facts,'连接方式',transport.mode==='wireguard'?'WireGuard · 中央 Link Agent':'SSH · 中央 Link Agent');
   if(transport.mode==='wireguard'){fact(facts,'隧道地址',transport.tunnel_address);fact(facts,'中央入口',transport.hub);}
   fact(facts,'远端用户',descriptor.binding.runtime_user||descriptor.remote.user);
   detail.append(facts);
   const actions=node('div',undefined,'remote-link-actions');
   let panelURL=null;try{panelURL=client.baotaURL(selected);}catch{detail.append(node('p','宝塔入口无效，请管理员核对登记。'));}
   actions.append(button('新建 SSH 终端','terminal'),button('刷新会话','sessions'),button('打开宝塔','baota',!panelURL),button('核对部署任务','recover'));
   detail.append(actions);
   const sessionList=node('ul',undefined,'remote-link-sessions');
   for(const session of sessions){const row=node('li'),open=button('恢复终端','terminal');open.dataset.remoteSession=session.id;row.append(node('code',session.id),open);sessionList.append(row);}
   if(!sessions.length)sessionList.append(node('li','暂无可恢复的终端会话。'));
   detail.append(sessionList);
   if(descriptor.binding.deploy_allowed){
    const choices=node('fieldset');choices.append(node('legend','部署组件'));
    const available=descriptor.remote.components;
    const names=Array.isArray(available)?available.map(item=>typeof item==='string'?item:item.name||item.component):['codex','eyra'];
    for(const name of ['codex','eyra'].filter(name=>names.includes(name))){const label=node('label'),input=node('input');input.type='checkbox';input.name='remote-component';input.value=name;input.checked=true;label.append(input,doc.createTextNode(name==='codex'?'Codex':'Eyra CLI'));choices.append(label);}
    choices.append(button('查看部署计划','plan',unknown.has(selected)));detail.append(choices);
   }else detail.append(node('p','此服务器未开放环境部署。'));
   const plan=plans.get(selected)||unknown.get(selected);
   if(plan){
    const card=node('section',undefined,'remote-link-plan'),summary=node('dl');card.append(node('h3','部署计划'));
    const target=plan.target||{};fact(summary,'目标',[target.os,target.arch,target.user].filter(Boolean).join(' · ')||transport.server_id||selected);
    for(const [name,item] of Object.entries(plan.components||{}))fact(summary,name,item.version||'待确认');
    fact(summary,'安装影响',plan.impact||'安装到专用用户的 ~/.local；保留已有配置和认证。');
    fact(summary,'计划有效期',new Date(plan.expires_at*1000).toLocaleString());fact(summary,'计划标识',plan.plan_hash);card.append(summary);
    const consent=node('label'),input=node('input');input.type='checkbox';input.dataset.remoteConsent='';consent.append(input,doc.createTextNode('我已查看以上计划，同意执行此计划。'));card.append(consent);
    card.append(button(unknown.has(selected)?'核对后重试原提交':'同意并部署',unknown.has(selected)?'retry':'deploy'));detail.append(card);
   }
   if(unknown.has(selected))detail.append(node('p','提交结果尚未确认。先核对原任务；重试会沿用原提交标识。','remote-link-warning'));
   const jobList=node('section',undefined,'remote-link-jobs');jobList.append(node('h3','部署任务'));
   for(const job of jobs){
    const row=node('article'),title=node('strong',(jobText[job.state]||job.state)+(job.cancel_requested?' · 已请求取消':''));row.append(title,node('code',job.job_id));
    if(job.error)row.append(node('p',job.error));
    row.append(node('small','计划 '+job.plan_hash));
    if(job.state==='needs_attention'){
     const consent=node('label'),input=node('input');input.type='checkbox';input.dataset.remoteResume=job.job_id;consent.append(input,doc.createTextNode('同意继续此原任务'));const resume=button('核对并继续原任务','resume');resume.dataset.remoteJob=job.job_id;row.append(consent,resume);
    }
    if(!finalJobs.has(job.state)){const cancel=button('请求取消部署','cancel');cancel.dataset.remoteJob=job.job_id;row.append(cancel);}
    jobList.append(row);
   }
   if(!jobs.length)jobList.append(node('p','暂无部署任务。'));
   detail.append(jobList);contents.push(detail);
  }
  panel.replaceChildren(...contents);scheduleSurface();
  onSummary({available:!!account&&resources.length>0,count:resources.length,loading:discovering});
 }
 function scheduleSurface(){
  cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   frame=0;if(!active||!terminal||!account||closed)return;
   const rect=panel.querySelector('.remote-link-terminal-surface')?.getBoundingClientRect();
   const viewport=panel.getBoundingClientRect();
   if(rect?.width>0&&rect.height>0&&viewport.width>0&&viewport.height>0)void api.remoteLink({action:'surface',visible:true,sessionKey:terminal.sessionKey,viewID:terminal.viewID,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport:{x:viewport.x,y:viewport.y,width:viewport.width,height:viewport.height}}).catch(()=>{});
  });
 }
 const matches=(v,s,id)=>!closed&&version===v&&selection===s&&selected===id;
 async function choose(id){
  if(discovering||!account||!resources.some(item=>item.id===id))return;
  const v=version,s=++selection;selected=id;descriptor=null;sessions=[];jobs=[];notice='正在读取服务器连接能力…';busy=false;
  await closeTerminal();if(!matches(v,s,id))return;
  paint();
  try{
   const value=await client.describe(id);if(!matches(v,s,id))return;descriptor=value;notice='';paint();
   const [sessionResult,jobResult]=await Promise.allSettled([client.sessions(id),client.recover(id)]);
   if(!matches(v,s,id))return;
   if(sessionResult.status==='fulfilled')sessions=sessionResult.value.sessions;else notice=sessionResult.reason.message;
   if(jobResult.status==='fulfilled')applyRecovery(id,jobResult.value);else notice=jobResult.reason.message;
  }catch(error){if(matches(v,s,id)&&error.name!=='AbortError')notice=error.message;}
  finally{if(matches(v,s,id))paint();}
 }
 function applyRecovery(id,result){
  jobs=result.jobs;if(!result.submissionUnconfirmed){unknown.delete(id);if(result.originalJob)plans.delete(id);}
 }
 async function discover(){
  if(discovering||!account||closed)return;
  const v=version;discovering=true;state='loading';notice='';selected=descriptor=null;sessions=[];jobs=[];resources=[];selection++;const closing=closeTerminal();paint();await closing;if(version!==v||closed)return;
  try{const result=await client.discover();if(version===v){state=result.state;resources=result.resources;for(const id of plans.keys())if(!unknown.has(id))plans.delete(id);}}
  catch(error){if(version===v&&error.name!=='AbortError'){state='unavailable';notice=error.message;}}
  finally{if(version===v){discovering=false;paint();if(pending&&resources.some(r=>r.id===pending)){const id=pending;pending=null;void choose(id);}}}
 }
 function acceptStatus(next){
  if(closed||next?.ok===false)return;
  const value=next?.account||null;
  if(value?.sessionKey===account?.sessionKey){
   if(terminal?.loaded&&next.terminalViewID!==terminal.viewID){unregister?.();unregister=null;terminal=null;paint();}
   return;
  }
  clear();discovering=false;account=value;client.setAccount(value);state=value?'loading':'signed_out';notice='';paint();
  if(active&&value)void discover();
 }
 async function refresh(){
  const v=version;const value=check(await api.remoteLink({action:'status',refresh:true}));
  if(closed)return;if(v!==version&&value.account?.sessionKey!==account?.sessionKey)return;
  acceptStatus(value);if(account&&!discovering)await discover();
 }
 async function operate(fn){
  if(busy||!active||!descriptor||!selected)return;
  const v=version,s=selection,id=selected;busy=true;notice='';paint();
  try{await fn(id,()=>matches(v,s,id));}
  catch(error){if(matches(v,s,id)&&error.name!=='AbortError')notice=error.message;}
  finally{if(matches(v,s,id)){busy=false;paint();}}
 }
 async function click(event){
  const target=event.target.closest('[data-remote-action]');if(!target||target.disabled)return;
  const action=target.dataset.remoteAction;
  if(action==='back'){onBack?.();return;}
  if(action==='settings'){onSettings?.();return;}
  if(action==='refresh'){await refresh();return;}
  if(action==='select'){await choose(Number(target.dataset.remoteInstance));return;}
  if(action==='terminal-close'){await closeTerminal();paint();return;}
  // Capture consent and component choices before busy painting resets controls.
  const consent=panel.querySelector('[data-remote-consent]')?.checked===true;
  const components=[...panel.querySelectorAll('[name="remote-component"]:checked')].map(input=>input.value);
  const jobID=target.dataset.remoteJob,job=jobs.find(item=>item.job_id===jobID);
  const resumeConsent=[...panel.querySelectorAll('[data-remote-resume]')].some(input=>input.dataset.remoteResume===jobID&&input.checked);
  const sessionID=target.dataset.remoteSession||crypto.randomUUID();
  await operate(async(id,current)=>{
   if(action==='sessions'){const value=await client.sessions(id);if(current())sessions=value.sessions;}
   else if(action==='recover'){const value=await client.recover(id);if(current())applyRecovery(id,value);}
   else if(action==='baota'){await api.remoteLink({action:'baota',instance:id,sessionKey:account.sessionKey}).then(check);}
   else if(action==='plan'){const value=await client.prepare(id,components);if(current())plans.set(id,value);}
   else if(action==='deploy'){
    const plan=plans.get(id);if(!consent||!plan)throw Error('请先查看计划并勾选同意。');
    unknown.set(id,plan);
    const value=await client.deploy(id,{consent:true,plan_id:plan.plan_id,plan_hash:plan.plan_hash});
    if(current()){unknown.delete(id);plans.delete(id);jobs=[value,...jobs.filter(item=>item.job_id!==value.job_id)];}
   }else if(action==='retry'){
    const plan=unknown.get(id);if(!consent||!plan)throw Error('请勾选同意重试原提交。');
    const result=await client.recover(id);if(!current())return;applyRecovery(id,result);
    if(!result.submissionUnconfirmed)return;
    const value=await client.retrySubmission(id,{consent:true,plan_hash:plan.plan_hash});
    if(current()){unknown.delete(id);plans.delete(id);jobs=[value,...jobs.filter(item=>item.job_id!==value.job_id)];}
   }else if(action==='resume'){
    if(!resumeConsent||!job)throw Error('请先勾选同意继续此原任务。');
    const value=await client.resume(id,jobID,{consent:true,plan_hash:job.plan_hash});if(current())jobs=jobs.map(item=>item.job_id===jobID?value:item);
   }else if(action==='cancel'){
    const value=await client.cancel(id,jobID);if(current())jobs=jobs.map(item=>item.job_id===jobID?value:item);
   }else if(action==='terminal'){
    const key=account.sessionKey,server=descriptor.transport.server_id||id;
    await closeTerminal();if(!current()||!active)return;
    if(descriptor.resource_scope!=='administrator_server')client.terminalURL(id,sessionID);
    const target={server,sessionID,sessionKey:key,viewID:crypto.randomUUID(),loaded:false};terminal=target;
    try{await api.remoteLink({action:'terminal',instance:id,sessionID,viewID:target.viewID,sessionKey:key}).then(check);}
    catch(error){await closeTerminal(target);throw error;}
    if(!current()||!active||terminal!==target){await closeTerminal(target);return;}
    target.loaded=true;unregister=client.registerView(()=>{void closeTerminal(target);paint();});paint();panel.querySelector('.remote-link-terminal')?.scrollIntoView({block:'nearest'});scheduleSurface();
   }
  });
 }
 const listener=event=>{void click(event).catch(error=>{if(!closed&&error.name!=='AbortError'){notice=error.message;paint();}});};
 panel.addEventListener('click',listener);
 const stop=api.onRemoteLinkChanged?.(acceptStatus)||(()=>{});
 const resize=new ResizeObserver(scheduleSurface);resize.observe(panel);window.addEventListener('resize',scheduleSurface);panel.addEventListener('scroll',scheduleSurface,{passive:true});
 const visibility=()=>{if(doc.hidden){void closeTerminal();paint();}else if(active)void refresh().catch(()=>{});};
 doc.addEventListener('visibilitychange',visibility);
 const timer=setInterval(()=>{
  if(active&&!doc.hidden&&!busy&&!discovering&&selected&&descriptor){const v=version,s=selection,id=selected;
   void client.recover(id).then(value=>{if(matches(v,s,id)){applyRecovery(id,value);paint();}}).catch(()=>{});
  }
 },5000);
 paint();
 return {
  // active：Link 页面可见，静默核对账号和服务器；shown：用户点开了远程服务器页。
  async setActive(value){if(active===!!value)return;active=!!value;panel.hidden=!(active&&shown);if(active){await refresh().catch(error=>{notice=error.message;paint();});}else{await closeTerminal();paint();}},
  async setOpen(value,instance=null){shown=!!value;panel.hidden=!(active&&shown);if(!shown){await closeTerminal();paint();return;}pending=instance;if(pending&&resources.some(r=>r.id===pending)){const id=pending;pending=null;await choose(id);}else scheduleSurface();},
  close(){if(closed)return;closed=true;stop();client.close();void closeTerminal();clearInterval(timer);cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener('resize',scheduleSurface);panel.removeEventListener('scroll',scheduleSurface);doc.removeEventListener('visibilitychange',visibility);panel.removeEventListener('click',listener);},
 };
}
