// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: setupConversationSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/conversation-surface.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {workspaceBounds} from './workspace-slide.mjs';
// Native conversation views share the ordinary page rectangle. The contacts
// sidebar owns session discovery; this host has no avatar rail or polling loop.
export function setupConversationSurface(api,navigation,{doc=document,title=()=> '智能体',onError=()=>{}}={}){
 const host=doc.getElementById('conversation-surface'),win=doc.defaultView;
 const waiting=new Map();let current='',closed=false,frame=0,sending=false,signature='';
 const check=value=>{if(value?.ok===false)throw Error(value.error||'会话视图不可用');return value;};
 async function send(payload){
  waiting.set(payload.key,payload);if(sending)return;sending=true;
  try{while(waiting.size){const [key,next]=waiting.entries().next().value;waiting.delete(key);try{check(await api.extensionSurface(next));}catch(e){signature='';if(!closed)onError(e.message);}}}
  finally{sending=false;}
 }
 function layout(){
  frame=0;if(closed||!current)return;
  const r=workspaceBounds(host),payload={key:'conversation:'+current,visible:!doc.hidden&&!doc.querySelector('dialog:modal')&&navigation.is('conversation-view'),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};
  const next=JSON.stringify(payload);if(next===signature)return;signature=next;void send(payload);
 }
 const schedule=()=>{if(!closed&&!frame)frame=win.requestAnimationFrame(layout);};
 const stopNav=api.onNavigate?.(({page})=>{
  if(closed||!page?.startsWith('conversation:'))return;
  const id=page.slice(13);if(current&&current!==id)void send({key:'conversation:'+current,visible:false});
  current=id;doc.body.dataset.conversationId=id;navigation.open('conversation-view',title(id),{viewKey:'conversation:'+id});signature='';schedule();
 });
 const stopState=api.onExtensionState?.(row=>{if(row.kind==='conversation'&&row.agent_id===current&&row.placement==='detached'&&navigation.is('conversation-view'))navigation.home();});
 const resize=new win.ResizeObserver(schedule);resize.observe(host);
 for(const event of ['workspace-view-change','workspace-modal-change','visibilitychange'])doc.addEventListener(event,schedule);
 win.addEventListener('resize',schedule);
 return {refresh(){if(current&&navigation.is('conversation-view'))navigation.title(title(current));schedule();},close(){
  if(closed)return;closed=true;win.cancelAnimationFrame(frame);resize.disconnect();stopNav?.();stopState?.();
  for(const event of ['workspace-view-change','workspace-modal-change','visibilitychange'])doc.removeEventListener(event,schedule);
  win.removeEventListener('resize',schedule);if(current)void send({key:'conversation:'+current,visible:false});
 }};
}
