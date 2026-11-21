// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: DOCK_AGENT; DOCK_TABS; busy; homeWorking; ringStates; dockFaces; setupDockAgents
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/dock-agents.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 顶栏工作指示（第109轮 R11）：某个程序的 Agent 在工作时，顶栏上它的图标换成该角色的头像加缩小光圈。
// 光圈绝对定位在按钮内，按钮几何不变；停止后淡回原图标。状态只取真实来源，不另造活动状态：
// 程序联系人的会话状态、Coding 绑定里成员的状态、首页 Eyra 的当前状态。
import {createRoleRing,paintRoleRing} from './role-identity.mjs';

export const DOCK_AGENT={leaveMs:260,codingBusyMs:1500,codingIdleMs:3000,codingErrorMs:20000};
export const DOCK_TABS={home:'dock-home',browser:'browser-bubble',settings:'api-bubble',contacts:'dock-contacts',link:'dock-link',servers:'dock-servers',center:'dock-center',coding:'dock-coding',market:'dock-market',workspace:'dock-workspace',together:'dock-together'};
const busy=state=>['queued','running','cancelling'].includes(state);
const homeWorking=new Set(['thinking','tool','preparing','body','waiting','compacting','cancelling']);
const ringStates=new Set(['thinking','tool','body','waiting','compacting']);

// 纯投影：program → {identity,state,name}，只包含正在工作的程序。
export function dockFaces({contacts=[],avatar=()=>'',coding=null,home=null}={}){
 const out=new Map();
 for(const c of Array.isArray(contacts)?contacts:[]){
  if(!c?.program)continue;
  const session=Object.hasOwn(c,'program_session')?c.program_session:c.sessions?.[0];
  const state=session?.state||'idle';
  if(busy(state)||c.program_activity?.active===true)out.set(c.program,{identity:{role:'conversation',name:c.name||'',avatar:avatar(c.id)||'',ring:c.ring||'orbit',glyph:''},state:'working'});
 }
 // Coding：主持人 Cota 在工作就显示 Cota，否则显示正在工作的那位成员。
 const members=Array.isArray(coding?.members)?coding.members:[];
 const member=members.find(m=>m.role==='cota'&&busy(m.state))||members.find(m=>busy(m.state));
 if(member)out.set('coding',{identity:{role:member.role==='vaya'?'project':'execution',name:member.name||'',avatar:avatar(member.contact_id)||'',ring:member.ring||'pulse',glyph:''},state:'working'});
 if(home?.identity&&homeWorking.has(home.state))out.set('home',{identity:home.identity,state:ringStates.has(home.state)?home.state:'working'});
 return out;
}

export function setupDockAgents(api,{doc=document,targets,createRing=createRoleRing,paintRing=paintRoleRing}={}){
 const win=doc.defaultView,rings=new Map(),leaving=new Map();
 let store=null,stopStore=null,coding=null,home=null,programProjection=null,timer=0,closed=false,paused=false,reading=false;
 const programs=Object.keys(targets||DOCK_TABS);
 const buttonFor=program=>targets?targets[program]:doc.getElementById(DOCK_TABS[program]);
 const reduced=()=>doc.body.classList.contains('reduce-motion')||!!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 function paint(){
  if(closed)return;
  // A detached window only presents the program session it currently owns.
  const contacts=targets?(programProjection?.contact?[{...programProjection.contact,program_session:programProjection.session||null}]:[]):store?.contacts||[];
  const faces=dockFaces({contacts,avatar:id=>store?.avatar(id)||'',coding,home});
  for(const program of programs){
   const button=buttonFor(program);if(!button)continue;
   const ownsDescription=program==='home'||program==='coding';
   const face=faces.get(program);let ring=rings.get(program);
   if(face){
    win.clearTimeout(leaving.get(program));leaving.delete(program);
    if(!ring||!ring.isConnected){
     ring=createRing(face.identity,{doc,state:face.state,live:true});ring.classList.add('dock-agent');ring.setAttribute('aria-hidden','true');
     button.append(ring);rings.set(program,ring);void ring.offsetWidth;
    }else paintRing(ring,face.identity,face.state,doc,{live:true});
    if(button.dataset.agentFace!=='true')button.dataset.agentFace='true';
    // 程序联系人的说明由 program-agent-surface 写；首页与 Coding 没有程序联系人，这里补上。
    if(ownsDescription){const text=face.identity.name+' · 工作中';if(button.getAttribute('aria-description')!==text)button.setAttribute('aria-description',text);}
   }else if(ring&&!leaving.has(program)){
    const remove=()=>{ring.remove();rings.delete(program);leaving.delete(program);delete button.dataset.agentFace;};
    button.dataset.agentFace='leaving';
    if(ownsDescription)button.removeAttribute('aria-description');
    if(reduced())remove();else leaving.set(program,win.setTimeout(remove,DOCK_AGENT.leaveMs));
   }
  }
 }
 // Coding 的成员会话属于受管群，不在联系人列表里：只读地查询绑定状态。页面隐藏时不查，失败时退避，不弹通知。
 async function readCoding(){
  win.clearTimeout(timer);timer=0;
  if(closed||paused||reading||doc.hidden||!buttonFor('coding'))return;
  reading=true;let delay=DOCK_AGENT.codingIdleMs;
  try{
   const value=await api.conversation({action:'program',program:'coding'});
   if(value?.ok===false)throw Error(value.error||'unavailable');
   coding=value?.binding||null;
   if((coding?.members||[]).some(m=>busy(m.state)))delay=DOCK_AGENT.codingBusyMs;
  }catch{coding=null;delay=DOCK_AGENT.codingErrorMs;}
  finally{reading=false;if(!closed&&!paused){paint();if(!doc.hidden)timer=win.setTimeout(readCoding,delay);}}
 }
 const visibility=()=>{if(!doc.hidden)void readCoding();};
 doc.addEventListener('visibilitychange',visibility);
 if(buttonFor('coding'))void readCoding();
 return {
  paint,
  connectStore(value){store=value;stopStore?.();stopStore=store.subscribe(()=>paint());},
  program(value){programProjection=value;paint();},
  // 首页 Eyra：由 companion 在状态变化时告知；identity 为空表示当前显示的不是母体。
  home(value){const a=home?.identity,b=value?.identity;if(home&&value&&home.state===value.state&&a?.name===b?.name&&a?.ring===b?.ring&&a?.avatar===b?.avatar)return;home=value;paint();},
  suspend(){paused=true;win.clearTimeout(timer);timer=0;},
  resume(){if(closed||!paused)return;paused=false;void readCoding();},
  close(){closed=true;win.clearTimeout(timer);for(const id of leaving.values())win.clearTimeout(id);stopStore?.();doc.removeEventListener('visibilitychange',visibility);for(const [program,ring] of rings){ring.remove();const button=buttonFor(program);if(button)delete button.dataset.agentFace;}rings.clear();},
 };
}
