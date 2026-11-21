// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TITLES; ICONS; reduced; TERMINAL_WHO; roleScope; setupStage
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/stage.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {createPatchView} from '../../../Tool/base/official/apply_patch/presentation/desktop.mjs';
import {bindThemeComponent,disposeThemeTree} from '../../../Theme/runtime/layout.mjs';
import {animateUI,cancelMotion,motionAllowed} from './motion.mjs';
// 展示台（docs/UI设计知识库.md 形态 §7）：工作形态里正文条下方的整块区域，只显示实时态。
// 每种工具一个窗口；排布由 stage-layout.mjs 的纯函数决定，这里只负责画和动画。
// 终端窗口复用 desktop/terminal-view.mjs：本轮所有 Shell 调用拼成同一个终端，像一个人在连续敲命令。
import {WorkSelection} from './work-selection.mjs';
import {stageKind,stageCapacity,stageColumns,stagePlacement,stageProcessVisible} from './stage-layout.mjs';
import {roleIdentity,createRoleRing,paintRoleRing} from './role-identity.mjs';
import {activeStates,sceneKind} from './model.mjs';
import {createTerminalView} from './desktop/terminal-view.mjs';
import {activityData,activityLabel,activityOutcome} from './activity.mjs';
import {activityStates as STATES,groupActivityState as groupState} from '../../../Tool/presentation/state.mjs';
import {brief} from './model.mjs';
import {BriefPacer} from './pacing.mjs';
import {setupStageTools} from './stage-tools.mjs';
import {middleEllipsis,createDigestController} from './tool-digest.mjs';

const TITLES={terminal:'终端',patch:'修改',search:'搜索',image:'看图'};
// 有自己画面的工具不进展示台（用户 2026-10-13：有的调用窗口里只写一个“工具”）：
// 计划、提问与潜意识沿各自入口；视觉协作留在共享聊天，不占 Eyra 操作区。
export {OFF_STAGE} from './stage-layout.mjs';
const ICONS={
 terminal:'M5 7l4 4-4 4M11 17h8',
 patch:'M5 19l1-4 9-9 3 3-9 9-4 1zM13 8l3 3',
 search:'M10.5 5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM15 15l4.5 4.5',
 image:'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z',
 other:'M12 5v14M5 12h14',
};
const reduced=doc=>!motionAllowed(doc);
// 某个角色本轮的终端范围（与 Matrix 的默认范围同一形状）。
// 执行窗口的提示符写谁在敲（与 team.css 的角色色一致）。
const TERMINAL_WHO={project:{name:'Vaya',rgb:'169;192;236'},execution:{name:'Cota',rgb:'178;222;200'}};
export const roleScope=(snapshot,name)=>{const role=snapshot?.roles?.find(r=>r.role===name);return role?.id&&role.generation>0?{task_id:snapshot.session_id,agent_id:role.id,generation:role.generation}:null;};

// roles：这个展示台显示谁的工具调用。团队里 Eyra、Vaya、Cota 共用一个展示台，窗口交叉排，头部换成各自的头像。
export function setupStage(root,{api,doc=document,role='matrix',roles=[role],getProfile=()=>({}),readReceipt,includePlan=roles.length<2}){
 let memberIdentities=new Map(),scope='';const identityFor=name=>memberIdentities.get(name)||roleIdentity(getProfile(),name);const selection=new WorkSelection();const panes=new Map(),svgNS='http://www.w3.org/2000/svg';
 let lastLayout='',closed=false,lastPaint=null,resizeFrame=0;
 const make=(tag,className,text)=>{const n=doc.createElement(tag);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
 const toolsets=new Map(),lastActive=new Map();
 const toolsFor=name=>{let set=toolsets.get(name);if(!set){set=setupStageTools({api,doc,make,reduced:()=>reduced(doc),role:name});toolsets.set(name,set);}return set;};
 const disposeReceipts=p=>{for(const row of p.receiptNodes?.values()||[])row.controller?.dispose();p.receiptNodes?.clear();};
 const showReceipts=(p,value)=>{for(const row of p.receiptNodes?.values()||[])row.controller?.setVisible(value&&row.details.open);};
 const keyOf=(name,kind)=>name===roles[0]?kind:name+':'+kind;
 const syncYield=()=>{
  if(roles.length<2||closed)return;
  const body=doc.body,win=doc.defaultView,style=win.getComputedStyle(body),left=parseFloat(style.getPropertyValue('--workspace-inset'))||0,right=parseFloat(style.getPropertyValue('--al-push'))||0;
  const layout=stagePlacement({width:win.innerWidth,height:win.innerHeight,pushLeft:left,pushRight:right});
  body.dataset.previewLayout=root.hidden?'none':layout.mode;
  // CSS consumes the same animated drawer insets as the chat surface.
  // Sampling them into pixel widths here would lag behind the next paint.
 };
 if(roles.length>1){doc.defaultView.addEventListener('resize',syncYield);doc.addEventListener('workspace-inset-change',syncYield);}
 function icon(kind){const svg=doc.createElementNS(svgNS,'svg'),path=doc.createElementNS(svgNS,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',ICONS[kind]||ICONS.other);svg.append(path);return svg;}
 function pane(key){
  let p=panes.get(key);if(p)return p;
  const at=key.indexOf(':'),scoped=at>0&&(roles.includes(key.slice(0,at))||memberIdentities.has(key.slice(0,at))),name=scoped?key.slice(0,at):roles[0],kind=scoped?key.slice(at+1):key;
  const receiptOnly=memberIdentities.has(name),family=receiptOnly?'transcript':TITLES[kind]?kind:'transcript',node=make('section','stage-pane'),head=make('header','stage-head'),title=make('span','stage-title',TITLES[kind]||kind),state=make('span','stage-state'),body=make('div','stage-body');
  node.dataset.kind=family;node.dataset.role=name;node.setAttribute('aria-label',identityFor(name).name+' · '+(TITLES[kind]||kind));
  const ring=createRoleRing(identityFor(name),{doc});ring.classList.add('stage-role');
  head.append(icon(family==='transcript'?'terminal':family),ring,title,state);node.append(head,body);
  bindThemeComponent(node,'tool',{heading:head,body},doc);
  p={kind:key,base:kind,role:name,receiptOnly,ring,family,node,title,state,body,signature:''};
  if(kind==='terminal'&&!receiptOnly){p.terminal=createTerminalView({api,doc,fontSize:11.5,who:TERMINAL_WHO[name],getScope:name==='matrix'?undefined:next=>roleScope(next,name)});body.append(p.terminal.element);}
  panes.set(key,p);return p;
 }
 // 离场：先脱离排布（其余窗口平滑让出宽度），再淡出。
 function leave(p){
  p.terminal?.suspend();toolsFor(p.role).suspend(p);showReceipts(p,false);
  if(!p.node.isConnected||p.node.classList.contains('leaving'))return;
  const box=root.getBoundingClientRect(),r=p.node.getBoundingClientRect();
  Object.assign(p.node.style,{position:'absolute',left:r.left-box.left+'px',top:r.top-box.top+'px',width:r.width+'px',height:r.height+'px'});
  p.node.classList.add('leaving');
  const version=p.leaveVersion=(p.leaveVersion||0)+1;
  const done=()=>{if(p.leaveVersion===version&&p.node.classList.contains('leaving')){p.node.remove();p.node.classList.remove('leaving');p.node.removeAttribute('style');}};
  if(reduced(doc)||!p.node.animate)return done();
  const animation=animateUI(p.node,[{opacity:1,scale:'1'},{opacity:0,scale:'.97'}],{key:'leave'});if(animation)animation.finished.then(done,done);else done();
 }
 const fillPatch=createPatchView({make,activityData,activityOutcome,groupState,STATES,middleEllipsis});
 // 最新结果默认可读，复用终端文字样式；用户主动收起后不被轮询打开。
 // 新调用和轮询更新不得抢走键盘焦点或重置用户的展开/阅读位置。
 function fillOther(p,items,snapshot){
  const follow=p.body.scrollHeight-p.body.scrollTop-p.body.clientHeight<20;
   const item=items.at(-1),signature=JSON.stringify(items.map(i=>[i.id,i.generation,i.state,i.revision,i.preview,i.input_preview]));if(signature===p.signature){showReceipts(p,true);return;}p.signature=signature;
  const group=groupState(items);p.node.dataset.state=group.state;p.node.dataset.tool=item.tool;
  p.state.textContent=STATES[group.state];p.title.textContent=activityLabel(item);
  if(!p.receipts){p.receipts=make('div','tool-receipts');p.outcome=make('p','other-outcome');p.body.replaceChildren(p.outcome,p.receipts);p.receiptNodes=new Map();}
  const outcome=items.map(activityOutcome).filter(Boolean).join('；');p.outcome.textContent=outcome;p.outcome.hidden=!outcome;
  const sourceOf=call=>JSON.stringify([snapshot?.core_epoch,snapshot?.session_id,p.role,snapshot?.roles?.find(r=>r.role===p.role)?.id,call.generation,call.id]);
  const recent=items.slice(-8),keys=new Set(recent.map(sourceOf));let grew=false;
  for(const [id,row]of p.receiptNodes)if(!keys.has(id)&&!row.controller.reading()&&!(row.userToggled&&row.details.open)){row.controller.dispose();row.details.remove();p.receiptNodes.delete(id);}
  for(const call of recent){
   const sourceKey=sourceOf(call);let row=p.receiptNodes.get(sourceKey);
   if(!row){
    const details=make('details','tool-receipt'),summary=make('summary','transcript-command'),body=make('div','tool-receipt-body'),ownScope=scope,member=memberIdentities.has(p.role),owned=snapshot?.roles?.find(r=>r.role===(member?'matrix':p.role));
    const source={task_id:snapshot?.session_id,agent_id:owned?.id||p.role,id:call.id,...(member?{member_id:p.role}:{}),...(owned?{generation:owned.generation}:{}),...(call.generation?{receipt_generation:call.generation}:{}),...(snapshot?.core_epoch?{core_epoch:snapshot.core_epoch}:{}),all_history:true};
    const currentView=()=>{const latest=lastPaint?.[0];return latest?.core_epoch===source.core_epoch&&latest?.session_id===source.task_id&&latest?.roles?.find(r=>r.role===(member?'matrix':p.role))?.id===owned?.id?latest:null;};
    const readPage=call.receipt_unavailable?undefined:offsets=>{
     const latest=currentView();if(!latest)throw Error('当前会话已变化，请重新打开记录。');
     if(readReceipt)return readReceipt(call,{snapshot:latest,member_id:member?p.role:undefined,...offsets});
     const owner=latest.roles?.find(r=>r.role===(member?'matrix':p.role));
     return api.receipt({...source,...(owner?{generation:owner.generation}:{}),...offsets});
    };
    const controller=createDigestController(doc,call,{readPage,isCurrent:()=>!closed&&scope===ownScope&&!!currentView()&&!root.hidden&&details.open&&details.isConnected});
    body.append(controller.element);details.dataset.id=call.id;details.append(summary,body);p.receipts.append(details);row={details,summary,body,controller};summary.addEventListener('click',()=>{row.userToggled=true;});details.ontoggle=()=>controller.setVisible(details.open&&!root.hidden);p.receiptNodes.set(sourceKey,row);grew=true;
   }
   const data=activityData(call),record=data.record||data.item||data.packet||data;
   const title=call.tool==='memory'&&typeof record.title==='string'?record.title:brief(call);
   const line=identityFor(p.role).name+' › '+(['load_tool','unload_tool'].includes(call.action)?activityLabel(call):title&&title!==p.title.textContent?title:activityLabel(call));
   row.summary.textContent=middleEllipsis(line,110);row.summary.setAttribute('aria-label',line);
   if(!row.userToggled)row.details.open=call===item;
   row.details.dataset.state=call.state;
   const key=JSON.stringify([call.state,call.revision,call.preview,call.input_preview]);if(row.signature===key)continue;row.signature=key;
   row.controller.update(call);row.controller.setVisible(row.details.open);
  }
  if(grew&&follow)p.body.scrollTop=p.body.scrollHeight;
 }
 // 一组并行调用的状态看整组（Codex X1-05）：有一个还在跑就是运行中；失败一直可见；全部结束才算完成。人不看退出码和用时（UI设计知识库 形态 §15.11 K3）。
 function fillTerminal(p,items,snapshot,presentation){
  const g=groupState(items);
  const current=items.filter(i=>['queued','running'].includes(i.state)).at(-1)||items.at(-1);
  // Long briefs retain their ends; commands and output remain in the terminal.
  p.briefs||=new BriefPacer(text=>{p.state.textContent=middleEllipsis(text,Math.max(18,Math.min(96,Math.floor(((p.node.clientWidth||560)-112)/6.4))));});p.briefs.push(brief(current));
  p.state.setAttribute('aria-label',[brief(current),g.failed?'有命令未成功':'',g.live>1?'并行 '+g.live+' 项':''].filter(Boolean).join(' · '));
  p.node.dataset.state=g.state;
  p.terminal.update(snapshot,presentation);
 }
 const view={
  paint(snapshot,presentation,{show=false,team=false}={}){
   if(closed)return;
   if(!snapshot){root.hidden=true;for(const p of panes.values()){p.terminal?.suspend();toolsFor(p.role).suspend(p);showReceipts(p,false);}syncYield();return;}
   lastPaint=[snapshot,presentation,{show,team}];
   syncYield();
   const nextScope=JSON.stringify([snapshot?.core_epoch,snapshot?.session_id,snapshot?.link?.scope]);if(nextScope!==scope){scope=nextScope;selection.clear();for(const p of panes.values()){p.terminal?.close();toolsFor(p.role).close(p);disposeReceipts(p);disposeThemeTree(p.node);p.node.remove();}panes.clear();lastLayout='';}
   memberIdentities=new Map((snapshot?.link?.members||[]).map(m=>{const base=roleIdentity(getProfile(),m.role||'conversation');return [m.id,{...base,name:m.name||m.title||base.name,avatar:m.avatar||base.avatar,ring:m.ring||base.ring}];}));
   root.hidden=!show;syncYield();
   if(!show){for(const p of panes.values()){p.terminal?.suspend();toolsFor(p.role).suspend(p);showReceipts(p,false);if(p.node.isConnected){p.node.remove();p.node.removeAttribute('style');p.node.classList.remove('leaving');}}lastLayout='';return;}
   // 后台/交互式终端（tty、background）由右侧终端圆钮承载；展示台的终端只拼前台命令，
   // 否则这里会出现一个只写着“等待命令”的空终端窗口（R46 实测）。
   // 成员做完稍停一下就让位；调用按开始时间交叉排，谁先谁后和实际一致。
   const clock=Date.now(),owner=new Map(),live=[];
   for(const name of roles){
    const row=snapshot?.roles?.find(r=>r.role===name);
    if(name!==roles[0]&&row&&activeStates.has(row.state))lastActive.set(name,clock);
    if(name!==roles[0]&&clock-(lastActive.get(name)||0)>4000)continue;
    for(const i of presentation?.liveActivities?.(name,{process:true,plan:includePlan})||[])if(stageProcessVisible(i,{plan:includePlan})){owner.set(i,name);live.push(i);}
    if(includePlan){const plan=presentation?.plan?.();if(plan&&!live.some(i=>i.tool==='update_plan')){const saved={...plan,receipt_unavailable:plan.key?.startsWith('plan:')===true};owner.set(saved,name);live.push(saved);}}
   }
   for(const member of snapshot?.link?.members||[])for(const item of member.activity?.items||[]){if(item.generation!==member.generation||!stageProcessVisible(item,{plan:includePlan}))continue;owner.set(item,member.id);live.push(item);}
   if(roles.length>1)live.sort((a,b)=>(a.started_at||0)-(b.started_at||0));
   const paneKey=i=>keyOf(owner.get(i),stageKind(i.tool));
   const background=new Set([...(doc.querySelectorAll?.('#terminal-orbs .term-orb[data-session]')||[])].map(o=>Number(o.dataset.session)));
   for(const i of live){const d=activityData(i);if(d.tty||d.background)background.add(Number(i.session_id||d.session_id)||-1);}
   const calls=live.filter(i=>{if(owner.get(i)!==roles[0])return true;const d=activityData(i);return !(d.tty||d.background||background.has(Number(i.session_id||d.session_id)));});
   const win=doc.defaultView,box=root.getBoundingClientRect(),room=stageCapacity({width:box.width||win.innerWidth/2,height:box.height||win.innerHeight-160});
   const grouped=new Map();for(const call of calls){const key=paneKey(call);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(call);}
   const selected=selection.select([...grouped].map(([id,items])=>({id,state:groupState(items).state,attention:groupState(items).failed,focused:!!panes.get(id)?.node.contains(doc.activeElement),updated:Math.max(...items.map(i=>Number(i.started_at)||0))})),{limit:room.max,now:clock});
   const layout={mode:'normal',panes:selected.items.map(x=>x.id)};root.dataset.overflow=String(selected.hidden);root.setAttribute('aria-label',selected.hidden?'工作预览 · 另有 '+selected.hidden+' 项可在工作记录查看':'工作预览');
   root.dataset.team=String(!!team);const columns=stageColumns(layout.panes.length,room);root.dataset.columns=String(columns);root.style.setProperty('--stage-rows',String(Math.max(1,Math.ceil(layout.panes.length/columns))));
   root.dataset.mode=layout.mode;root.dataset.count=String(layout.panes.length);root.hidden=!layout.panes.length;syncYield();
   const key=layout.mode+':'+layout.panes.join(',');
   const before=new Map([...panes.values()].filter(p=>p.node.isConnected&&!p.node.classList.contains('leaving')).map(p=>[p.kind,p.node.getBoundingClientRect()]));
   if(key!==lastLayout){
    lastLayout=key;
    for(const p of panes.values())if(!layout.panes.includes(p.kind))leave(p);
    layout.panes.forEach((kind,i)=>{
     const p=pane(kind);p.leaveVersion=(p.leaveVersion||0)+1;p.node.classList.remove('leaving');cancelMotion(p.node,'leave');p.node.removeAttribute('style');
     const at=[...root.children].filter(n=>!n.classList.contains('leaving'))[i];
     if(at!==p.node)root.insertBefore(p.node,at||null);
     if(!before.has(kind))p.node.classList.add('entering');
    });
    root.style.setProperty('--panes',String(layout.panes.length));
    // 位置变化用 FLIP（translate）；新窗口在下一帧去掉 entering，滑入并从 0 长开（工作形态里是上下排列）。
    win.requestAnimationFrame(()=>{
     if(closed||root.hidden)return;
     for(const p of panes.values())p.node.classList.remove('entering');
     if(reduced(doc))return;
     for(const [kind,r] of before){const p=panes.get(kind);if(!p?.node.isConnected||!layout.panes.includes(kind)||!p.node.animate)continue;const now=p.node.getBoundingClientRect(),dx=r.left-now.left,dy=r.top-now.top;if(Math.abs(dx)>2||Math.abs(dy)>2)animateUI(p.node,[{translate:dx+'px '+dy+'px'},{translate:'0 0'}],{kind:'move',key:'layout'});}
    });
   }
   for(const kind of layout.panes){
    const p=pane(kind),items=calls.filter(i=>paneKey(i)===kind);if(!items.length)continue;
    if(p.family==='terminal')fillTerminal(p,items,snapshot,presentation);
    else if(p.family==='patch')fillPatch(p,items);
    else if(p.family==='search')toolsFor(p.role).fillSearch(p,items,snapshot);
    else if(p.family==='image')toolsFor(p.role).fillImage(p,items,snapshot,STATES);
    else fillOther(p,items,snapshot);
    paintRoleRing(p.ring,identityFor(p.role),p.node.dataset.state==='running'?'tool':groupState(items).failed?'error':'idle',doc,{toolEffect:sceneKind(items.at(-1))});
   }
  },
  close(){if(closed)return;closed=true;lastPaint=null;observer?.disconnect();doc.defaultView.removeEventListener('resize',reflow);if(resizeFrame)doc.defaultView.cancelAnimationFrame(resizeFrame);if(roles.length>1)doc.defaultView.removeEventListener('resize',syncYield);doc.removeEventListener('workspace-inset-change',syncYield);root.hidden=true;for(const p of panes.values()){p.terminal?.close();toolsFor(p.role).close(p);disposeReceipts(p);disposeThemeTree(p.node);p.node.remove();}panes.clear();selection.clear();lastLayout='';},
 };
 // Resize can happen while every Agent is waiting in a tool and no new
 // snapshot arrives. Recompute capacity from actual available geometry.
 function reflow(){if(closed||resizeFrame||!lastPaint)return;resizeFrame=doc.defaultView.requestAnimationFrame(()=>{resizeFrame=0;if(!closed&&lastPaint)view.paint(...lastPaint);});}
 const Observer=doc.defaultView.ResizeObserver,observer=Observer?new Observer(reflow):null;
 observer?.observe(root);const screen=roles.length>1&&doc.getElementById?.('screen');if(screen)observer?.observe(screen);doc.defaultView.addEventListener('resize',reflow);
 return view;
}
