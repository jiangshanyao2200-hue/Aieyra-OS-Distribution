
const sessionState={online:'在线',idle:'空闲',busy:'正在执行',running:'正在工作',waiting_user:'等待回复',offline:'离线',unknown:'状态未知'};
export function linkSummary(state){
 if(state?.installed===null)return 'Link 安装待核对';
 if(!state?.installed)return state?.supported===false?'此平台暂未接入 Link':'Link 尚未安装';
 if(state.identity_state==='missing')return '尚未连接其他设备';
 if(state.hub_state==='offline')return 'Link 已离线';
 if(state.hub_state!=='online')return 'Link 连接待核对';
 if(!state.catalog||state.catalog.stale)return 'Link 已连接 · 会话状态未知';
 return 'Link · '+state.catalog.sessions.length+' 个会话';
}
export function staleOffice(office){return office?{...office,stale:true,count_stale:true,running:null,seats:(office.seats||[]).map(s=>({...s,online:null,execution_state:'unknown'}))}:null;}
export function setupLink(api,navigation,doc=document,{el}={}){
 if(typeof api.linkStatus!=='function')return {close(){},open:async()=>{}};
 const $=id=>doc.getElementById(id);let state={},office=null,closed=false,pending=null,paintKey='';
 function row(title,details){const li=el('li');li.append(el('strong',title),el('span',details));return li;}
 function section(title,catalog,items,render,empty='暂无记录。'){
  const node=el('section',undefined,'link-section');node.append(el('h3',title));
  if(!catalog){node.append(el('p','状态待确认。'));return node;}
  const list=el('ul');for(const item of items)list.append(render(item));node.append(list);
  if(!items.length)node.append(el('p',catalog.stale?'上次记录为空。':empty));
  return node;
 }
 // 没有在线会话或工位时等待附近设备；接入后列出会话与工位。
 function paint(){
  if(closed)return;
  const sessions=state.hub_state==='online'&&state.catalog&&!state.catalog.stale?state.catalog.sessions||[]:[];
  const seats=office&&!office.stale?(office.seats||[]).filter(s=>s.online===true):[];
  const live=sessions.length>0||seats.length>0,view=$('link-view');
  if(view)view.dataset.linkState=live?'live':'quiet';
  $('link-status').textContent=live?linkSummary(state):'';
  const quiet=$('link-quiet');if(quiet)quiet.hidden=live;
  // 身份未配置、工位暂不可读都不是故障；只显示真正的错误。
  const errors=[state.identity_state==='missing'?'':state.error,state.control_error].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
  const error=$('link-error');error.textContent=errors.join(' ');error.hidden=!errors.length;
  const key=JSON.stringify([live,sessions,seats]);if(key===paintKey)return;paintKey=key;
  if(!live){$('link-details').replaceChildren();return;}
  const sessionRows=section('会话',state.catalog,sessions,s=>row(s.title||s.local_id||s.id,sessionState[s.state]||sessionState.unknown),'当前没有会话。');
  const seatRows=section('工位',office,seats,s=>row(s.name||s.id,sessionState[s.execution_state]||({waiting:'等待中',completed:'已完成',blocked:'待处理',failed:'执行失败',cancelling:'正在停止'})[s.execution_state]||'在线'),'当前没有在线工位。');
  $('link-details').replaceChildren(...(sessions.length?[sessionRows]:[]),...(seats.length?[seatRows]:[]));
 }
 function poll(){
  if(closed)return Promise.resolve();if(pending)return pending;
  pending=(async()=>{
   const [connection,control]=await Promise.allSettled([api.linkStatus(),typeof api.controlStatus==='function'?api.controlStatus():Promise.resolve(null)]);
   if(connection.status==='fulfilled'&&connection.value?.ok!==false)state=connection.value||{};
   else state={...state,identity_state:'unknown',hub_state:'unknown',error:'设备连接状态暂时无法读取。',catalog:state.catalog?{...state.catalog,stale:true}:null};
   if(closed)return;
   if(control.status==='fulfilled'&&control.value?.ok!==false&&control.value?.office)office=control.value.office;
   else office=staleOffice(office);
   paint();
  })().finally(()=>{pending=null;});return pending;
 }
 async function open({toggle=true,preserveFocus=false}={}){if(navigation.open('link-view','Link · 跨设备协同',{viewKey:'link',toggle,preserveFocus})){
  await poll();
 }}
 const timer=setInterval(()=>{void poll().catch(()=>{});},10000);void poll().catch(()=>{});
 return {open,close(){closed=true;clearInterval(timer);}};
}
