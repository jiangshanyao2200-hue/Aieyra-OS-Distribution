// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: clip; busy; sessionPreviewText; readSessionPreview; previewController; setupSessionPreviews
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/session-preview.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {recentChatMessages} from './experience.mjs';

const clip=(value,limit=120)=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length>limit?text.slice(0,limit)+'…':text;};
const busy=value=>['queued','running','context','waiting','cancelling'].includes(value);
export function sessionPreviewText(target,snapshot={}){
 const title=clip(target.title||'会话',120);
 if(target.pending)return title+'\n'+target.pending;
 let rows=target.kind==='home'?recentChatMessages(snapshot.messages||[],[],4):snapshot.messages||[];
 if(target.kind==='home')rows=rows.filter(m=>m.from==='user'||m.from==='matrix'&&m.to==='user');
 const lines=rows.filter(m=>!m.hidden&&(m.text||m.error||m.attachments?.length)).slice(-4).map(m=>{
  const name=m.from==='user'?'你':target.kind==='group'?clip(m.name||'成员',60):title;
  const text=clip(m.text||m.error)||(m.attachments?.length?'[附件]':'');
  return name+'：'+text;
 });
 const role=target.kind==='home'?snapshot.roles?.find(r=>r.role==='matrix'):snapshot.agent;
 const live=target.kind==='home'?snapshot.live?.[role?.id]||snapshot.live?.matrix:snapshot.live;
 if(busy(role?.state))lines.push(title+'：'+(clip(live?.text)||'正在回复…'));
 return (title+' · 最近对话\n\n'+(lines.join('\n\n')||'还没有消息')).slice(0,3500);
}
export async function readSessionPreview(api,target){
 if(target.pending)return sessionPreviewText(target);
 const value=target.kind==='home'?await api.snapshot({cursor:0}):await api.conversation({action:target.kind==='group'?'group':'snapshot',id:target.id});
 if(value?.ok===false)throw Error('暂时无法读取会话');
 return sessionPreviewText(target,value);
}
// Switching or closing invalidates every earlier read, including failed reads.
export function previewController({read,show,hide}){
 let epoch=0;
 return {async open(target,valid=()=>true){const own=++epoch;let text;try{text=await read(target);}catch{text=clip(target.title,120)+'\n暂时无法读取会话';}if(epoch===own&&valid())await show(text);},close(){epoch++;hide();}};
}
export function setupSessionPreviews(api,list,resolve,{doc=document}={}){
 if(typeof api.tip!=='function')return {hide(){},reposition(){},close(){}};
 const win=doc.defaultView;let anchor=null,delay=0,poll=0,remote=false,closed=false,point=null,origin='pointer';
 const controller=previewController({read:target=>readSessionPreview(api,target),show:async text=>{
  const r=anchor.getBoundingClientRect();remote=true;await api.tip({action:'show',text,x:r.left,y:r.top,width:r.width,height:r.height});
 },hide:()=>{if(remote){remote=false;void api.tip({action:'hide'}).catch(()=>{});}}});
 function hide(){clearTimeout(delay);clearTimeout(poll);anchor=null;controller.close();}
 async function refresh(row){
  const valid=()=>!closed&&!doc.hidden&&anchor===row&&row.isConnected;
  if(!valid()){hide();return;}
  const target=resolve(row);if(!target){hide();return;}
  await controller.open(target,valid).catch(()=>{});
  if(valid())poll=setTimeout(()=>void refresh(row),1500);
 }
 const eligible=target=>{const row=target?.closest?.('.sd-row');return row&&list.contains(row)&&!target.closest?.('.role-ring,.group-face,.sd-toggle')?row:null;};
 const track=event=>{if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))point={x:event.clientX,y:event.clientY};};
 function enter(event){
  track(event);origin=event.type==='focusin'?'focus':'pointer';const row=eligible(event.target);
  if(!row||closed){hide();return;}
  if(row===anchor)return;hide();anchor=row;delay=setTimeout(()=>void refresh(row),450);
 }
 function reposition(){
  if(!anchor||closed)return;
  const key=anchor.dataset.key,target=origin==='focus'?doc.activeElement:point&&doc.elementFromPoint(point.x,point.y),row=eligible(target);
  hide();
  // Layout settling or a refreshed list can move/replace the original row.
  // Resume only if the user's pointer/focus still addresses that same session.
  if(row?.dataset.key===key&&!doc.hidden){anchor=row;delay=setTimeout(()=>void refresh(row),450);}
 }
 const leave=event=>{if(anchor?.contains(event.target)&&!anchor.contains(event.relatedTarget))hide();};
 const bindings=[[list,'pointerover',enter],[list,'pointermove',track],[list,'pointerout',leave],[list,'focusin',enter],[list,'focusout',leave],[list,'scroll',hide],[doc,'pointerdown',hide],[doc,'keydown',hide],[doc,'visibilitychange',hide],[win,'blur',hide],[win,'resize',reposition]];
 for(const [node,event,fn]of bindings)node.addEventListener(event,fn);
 return {hide,reposition,close(){closed=true;hide();for(const [node,event,fn]of bindings)node.removeEventListener(event,fn);}};
}
