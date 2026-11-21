// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: stateNames; linkView
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/module-link.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 独立 Aieyra Link：自动局域网协同与指挥中心。
import {setupModuleShell} from './module-shell.mjs';
import {setupRemoteLink} from './remote-link.mjs';

const stateNames={online:'在线',idle:'空闲',busy:'正在执行',waiting_user:'等待回复',offline:'离线',unknown:'状态未知'};
// 纯函数：只有 Hub 在线且确有会话时才算"有连接"，其余一律静默。
export function linkView(state){
 const sessions=state?.hub_state==='online'&&state.catalog&&!state.catalog.stale?state.catalog.sessions:[];
 let summary='';
 if(state?.installed===false)summary='Link 尚未安装';
 else if(state?.identity_state==='missing')summary='尚未连接其他设备';
 else if(state?.hub_state==='offline')summary='Link 已离线';
 else if(sessions.length)summary=sessions.length+' 个会话';
 return {quiet:!sessions.length,summary,sessions:sessions.map(s=>({id:s.id,title:s.title||s.local_id||s.id,state:stateNames[s.state]||stateNames.unknown}))};
}

if(typeof window!=='undefined'&&globalThis.aieyra&&document.body?.dataset.module==='link'){
 const api=globalThis.aieyra,$=id=>document.getElementById(id);
 // 与 OS 内嵌 Link 一致：远程服务器的入口在 Link 页「连接」标签里，点了整页切换，"返回 Link"回来。
 let remoteOpen=false;
 const remote=setupRemoteLink(api,{panel:$('pane-remote'),onBack:()=>setRemote(false),onSettings:null});
 function setRemote(value,instance=null){
  remoteOpen=!!value;$('control-host').hidden=remoteOpen;$('pane-control').dataset.remote=String(remoteOpen);
  layoutKey='';surface();void remote.setOpen(remoteOpen,instance);
 }
 api.onLinkRequest?.(request=>{if(request?.action==='remote')setRemote(true,request.instance);});
 let closed=false,polling=null,controlVisible=false,opening=null,frame=0,layoutKey='';
 async function poll(){
  if(closed||polling)return polling;
  polling=(async()=>{
   let state;try{state=await api.linkStatus();}catch(error){state={hub_state:'unknown',error:error.message};}
   if(closed)return;
   const view=linkView(state);
   $('link-quiet').hidden=!view.quiet;$('link-live').hidden=view.quiet;$('link-status').textContent=view.summary;
   $('link-sessions').replaceChildren(...view.sessions.map(s=>{const li=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('span');title.textContent=s.title;detail.textContent=s.state;li.append(title,detail);return li;}));
   // 身份未配置不是故障：摘要已经说明，不再显示面向 OS 页面的旧提示。
   const error=(state?.identity_state==='missing'?[state?.control_error]:[state?.error,state?.control_error]).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(' ');
   $('link-error').textContent=error;$('link-error').hidden=!error;
  })().finally(()=>{polling=null;});
  return polling;
 }
 function bounds(){const r=$('control-host').getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};}
 function surface(){
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
   if(closed)return;
   const rect=bounds();
   // 布局尚未完成时不提交零尺寸区域，等下一次尺寸变化。
   if(controlVisible&&!remoteOpen&&(rect.width<1||rect.height<1))return;
   const payload=controlVisible&&!remoteOpen?{visible:true,bounds:rect}:{visible:false},key=JSON.stringify(payload);
   if(key===layoutKey)return;layoutKey=key;
   api.controlSurface(payload).then(result=>{
    if(result?.ok===false)throw Error(result.error);
    // The host deliberately returns promptly during ownership handoff. That
    // reply has not applied this rectangle, so it cannot be cached as shown.
    if(payload.visible&&!result?.shown&&layoutKey===key)layoutKey='';
    if(controlVisible&&result?.shown)controlMessage('');
   }).catch(error=>{layoutKey='';controlMessage(error.message,true);});
  });
 }
 function controlMessage(text,retry=false){$('control-state').hidden=!text;$('control-message').textContent=String(text||'').replace(/指挥中心/g,'Link');$('control-retry').hidden=!retry;}
 // 交接中（OS 正在交出指挥中心）时说清楚在等什么，而不是一句“正在启动”。
 const handoffText={releasing:'正在从 Aieyra OS 接过指挥中心…',starting:'正在启动指挥中心…'};
 globalThis.aieyraModule?.on?.(event=>{
  if(event?.name!=='handoff')return;
  if(event.payload?.phase==='failed')controlMessage(event.payload.error||'指挥中心未能启动，请重试',true);
  else if(event.payload?.phase==='ready')void openControl();
  else if(opening&&handoffText[event.payload?.phase])controlMessage(handoffText[event.payload.phase]);
 });
 async function openControl(){
  if(opening)return opening;
  controlMessage('正在启动指挥中心…');
  void globalThis.aieyraModule?.invoke('info').then(info=>{
   if(!opening)return;
   if(info?.handoff==='failed')controlMessage(info.handoff_error||'指挥中心未能启动，请重试',true);
   else if(handoffText[info?.handoff])controlMessage(handoffText[info.handoff]);
  }).catch(()=>{});
  opening=(async()=>{
   const result=await api.controlOpen();
   if(result?.code==='control_handoff_pending'){controlMessage(handoffText[result.service_state]||'正在连接 Link…');return;}
   if(result?.ok===false){
    const status=await api.controlStatus().catch(()=>null);
    const hint=result.code==='control_held_elsewhere'?'\nLink 的连接尚未完成，请重新连接。':'';
    throw Error((result.error||'指挥中心暂时无法打开。')+hint+(status?.os_release_error?'\nOS 未能交出指挥中心：'+status.os_release_error:''));
   }
   controlMessage(result.page_ready?'':'正在载入指挥中心页面…');
   if(result.page_error)controlMessage(result.page_error,true);
   layoutKey='';surface();
  })().catch(error=>controlMessage(error.message,true)).finally(()=>{opening=null;});
  return opening;
 }
 $('control-retry').onclick=()=>{layoutKey='';void openControl();};
 const shell=setupModuleShell({
  // 连接页承载本机、设备和远程服务器资源；远程服务器不是工位标签。
  tabs:{control:{tab:$('tab-control'),pane:$('pane-control')}},
  defaultPage:'control',
  onShow:page=>{controlVisible=page==='control';layoutKey='';void remote.setActive(controlVisible);if(controlVisible)void openControl();else surface();if(page==='devices')void poll();},
 });
 new ResizeObserver(surface).observe($('control-host'));
 window.addEventListener('resize',surface);
 const timer=setInterval(()=>{void poll();},10000);
 void shell.ready.then(()=>poll());
 window.addEventListener('beforeunload',()=>{closed=true;remote.close();clearInterval(timer);shell.close();});
}
