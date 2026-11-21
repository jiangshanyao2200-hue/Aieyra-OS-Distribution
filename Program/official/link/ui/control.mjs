
export function controlSummary(state){
 const office=state?.office;
 if(!state?.available)return state?.service_state==='offline'?'指挥中心离线':state?.installed?'指挥中心待连接':'指挥中心不可用';
 if(!office)return '工位状态未知';
 const count=office.count_stale?'上次 '+office.count+' 个工位':office.count+' 个工位';
 const cloud=state.mode==='cloud'&&state.cloud_office?' · 云 '+state.cloud_office.count+' 个':'';
 return count+' · OS '+office.os_count+(office.stale?' · 状态过期':office.running?' · '+office.running+' 个运行中':'')+cloud;
}
export function setupControl(api,navigation,doc=document,{el,setupRemoteLink,bounds=node=>node.getBoundingClientRect()}={}){
 if(typeof api.controlStatus!=='function'||typeof api.controlSurface!=='function')return {close(){},open:async()=>{}};
 const $=id=>doc.getElementById(id),slot=el('div',undefined,'settings-tool-entry'),button=el('button','指挥中心','quiet'),label=el('span');
 // 工位管理从 Settings 进入；工作区左上只展示当前计划和真实协同活动。
 slot.id='control-slot';slot.hidden=true;label.hidden=true;button.id='control-bubble';button.type='button';button.dataset.viewKey='control';button.setAttribute('aria-label','指挥中心与工位');button.setAttribute('aria-expanded','false');slot.append(button,label);doc.querySelector('.settings-tabs')?.append(slot);
 let state={},closed=false,polling=false,opening=false,revision=0,frame=0,layoutKey='',chain=Promise.resolve();
 let fault='';
 // 远程服务器（SSH 终端、宝塔、云号池部署）由 OS 这层渲染，因为它用的是设置里登录的 Aieyra 账号。
 // 入口在 Link 页的「连接」标签里；点了之后 Link 原生页让位、整页切到远程服务器，"返回 Link"回来。
 let remoteOpen=false;
 const remotePanel=doc.createElement('section');remotePanel.id='control-remote';remotePanel.hidden=true;
 const remote=setupRemoteLink(api,{panel:remotePanel,doc,onBack:()=>setRemote(false),onSettings:()=>{setRemote(false);doc.getElementById('api-bubble')?.click();doc.getElementById('aieyra-tab')?.click();}});
 function setRemote(value,instance=null){
  remoteOpen=!!value;$('control-surface').hidden=remoteOpen;
  layoutKey='';schedule();void remote.setOpen(remoteOpen,instance);
 }
 const stopRequest=api.onLinkRequest?.(request=>{if(request?.action==='remote'&&navigation.is('control-view'))setRemote(true,request.instance);})||(()=>{});
 function mode(value){
  $('control-surface').hidden=remoteOpen;
  layoutKey='';schedule();void remote.setActive(value&&navigation.is('control-view'));
 }
 $('control-view').append(remotePanel);
 // 连接状态（用户 2026-10-15）：不再是左上角一行灰字加文字按钮，而是 Link 区域正中一个与 OS 同款的呼吸圆。
 const stateBox=el('div',undefined,'link-state'),mark=el('span',undefined,'link-state-mark');
 stateBox.id='control-state-box';stateBox.setAttribute('role','status');mark.setAttribute('aria-hidden','true');
 $('control-retry').textContent='重新连接';stateBox.append(mark,$('control-error'),$('control-retry'));$('control-surface').append(stateBox);
 mode(false);
 function surface(){
  frame=0;if(closed)return;const r=bounds($('control-surface'));
  const payload={visible:!doc.querySelector('dialog:modal')&&navigation.is('control-view')&&!remoteOpen&&state.page_ready===true&&r.width>0&&r.height>0,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};
  const key=JSON.stringify(payload);if(key===layoutKey)return;layoutKey=key;
  chain=chain.catch(()=>{}).then(()=>closed?null:api.controlSurface(payload)).then(result=>{if(!closed&&result?.ok===false){layoutKey='';fail(result.error);}else if(!closed&&payload.visible&&result?.shown!==true&&layoutKey===key){layoutKey='';}}).catch(error=>{if(!closed){layoutKey='';fail(error.message);}});
 }
 function schedule(){if(!frame&&!closed)frame=requestAnimationFrame(surface);}
 function paint(next){
  if(closed)return;state=next;slot.hidden=!state.installed&&!state.available&&!state.office;
  label.textContent=controlSummary(state);button.title=label.textContent;button.setAttribute('aria-label','指挥中心与工位 · '+label.textContent);$('control-status').textContent=label.textContent;
  const observed=state.office?.observed_at;if(state.office?.stale&&observed)$('control-status').textContent+=' · 观察于 '+new Date(observed).toLocaleTimeString();
  fault=friendly(state.page_error||state.error||'');render();schedule();
  doc.dispatchEvent(new CustomEvent('control-situation',{detail:state.situation||null}));
 }
 // 宿主的原话面向开发者（"指挥中心"），给人看的统一叫 Link。
 function friendly(text){return String(text||'').replace(/指挥中心/g,'Link');}
 function fail(text){fault=friendly(text);render();}
 function render(){
  const ready=state.page_ready===true,quiet=ready&&!opening&&!fault;
  stateBox.hidden=quiet;stateBox.dataset.tone=opening||!fault?'busy':'error';
  $('control-error').textContent=quiet?'':opening?'正在连接 Link…':fault||'正在载入 Link…';
  $('control-retry').hidden=opening||(ready&&!fault);$('control-retry').disabled=opening;
 }
 async function poll(){if(closed||polling||opening)return;polling=true;const current=revision;try{const next=await api.controlStatus();if(next?.ok===false)throw Error(next.error);if(current===revision)paint(next);}catch(error){if(current===revision)paint({...state,available:false,cloud_available:false,error:error.message});}finally{polling=false;}}
 async function connect(){
  if(closed||opening)return;opening=true;revision++;render();
  // 连接要有截止时间（用户 2026-10-13 第 L 项）：宿主侧的页面载入已经加了上限，
  // 这里再加一道，任何一侧卡住都不会让这句话停在屏幕上不动，用户至少能看到原因并重试。
  let timer;
  const deadline=new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('连接指挥中心超时，可重试')),45000);});
  try{const next=await Promise.race([api.control(),deadline]);if(next?.ok===false)throw Error(next.error);paint(next);}catch(error){if(!closed)fault=friendly(error.message);}finally{clearTimeout(timer);opening=false;if(!closed)render();schedule();}
 }
 // Docking can hide the native page without changing its last rectangle.
 // An explicit open must reapply visibility even when the DOM still selects Link.
 async function open({toggle=true}={}){layoutKey='';const visible=navigation.open('control-view','Link',{viewKey:'control',toggle});schedule();if(visible){await remote.setActive(true);await connect();}}
 const viewChanged=()=>{if(!navigation.is('control-view')&&remoteOpen)setRemote(false);surface();void remote.setActive(navigation.is('control-view'));};
 button.onclick=open;$('control-retry').onclick=connect;doc.addEventListener('workspace-view-change',viewChanged);doc.addEventListener('workspace-modal-change',viewChanged);
 const resize=new ResizeObserver(schedule);resize.observe($('control-surface'));window.addEventListener('resize',schedule);
 const timer=setInterval(poll,4000);void poll();
 return {open,close(){if(closed)return;closed=true;stopRequest();remote.close();clearInterval(timer);cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener('resize',schedule);doc.removeEventListener('workspace-view-change',viewChanged);doc.removeEventListener('workspace-modal-change',viewChanged);void chain.catch(()=>{}).then(()=>api.controlSurface({visible:false})).catch(()=>{});}};
}
