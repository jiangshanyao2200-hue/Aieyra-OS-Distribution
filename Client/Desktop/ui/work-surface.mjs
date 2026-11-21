// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: projection
// Regions: running; mediaKinds; currentOperation; operationStateLabel; homeOperations; workPanels; workProjectionGroups; setupWorkSurface; projectionPathsOverlap; briefJournal; setupToolWorkSurface; homeWorkReaders; conversationOperations; conversationWorkReaders
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/work-surface.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {createTerminalView} from './desktop/terminal-view.mjs';
import {OperationTranscript} from './operation-terminal.mjs';
import {setupSearchView} from '../../../Tool/base/official/web_search/presentation/desktop.mjs';
import {activityOutcome,activityData,activityDetails,activityBrief,activityLabel} from './activity.mjs';
import {stagePlacement,stageProcessVisible} from './stage-layout.mjs';
import {MOTION,motionAllowed,motionDuration,animateUI,cancelMotion,observeMotion} from './motion.mjs';
import {bindThemeComponent,disposeThemeTree} from '../../../Theme/runtime/layout.mjs';
import {createToolProjection,projectionKind,projectionIdentity,projectionLabel,projectionState} from '../../../Tool/presentation/projection.mjs';
import {createPatchView} from '../../../Tool/base/official/apply_patch/presentation/desktop.mjs';
import {activityFacts} from './activity.mjs';
import {middleEllipsis} from './tool-digest.mjs';
import {groupActivityState,activityStates} from '../../../Tool/presentation/state.mjs';
import {WorkSelection} from './work-selection.mjs';
import {chatMargins} from './chat-layout.mjs';
import {createRoleRing,paintRoleRing} from './role-identity.mjs';
import {mountHaloInstrument,paintHaloState} from '../../../Halo/official/instrument.mjs';

const running=state=>['queued','starting','running','cancelling','waiting_user','in_progress','in_flight'].includes(state);
const mediaKinds=new Set(['browser','contacts','search','image','video']);
export function currentOperation(items){return items.filter(i=>running(i.state)).at(-1)||items.at(-1);}
export function operationStateLabel(item){
 if(!item)return '暂无操作';
 return ({queued:'排队中',starting:'正在准备',running:'正在操作',cancelling:'正在停止',waiting_user:'等待回复',completed:'已完成',exited:'已结束',cancelled:'已停止',failed:'操作失败',timed_out:'操作超时',interrupted:'操作已中断',interrupted_unknown:'结果待确认',persistence_failed:'记录尚未保存'})[item.state]||'状态待确认';
}
export function homeOperations(snapshot,name='Eyra',items,{tools=false}={}){
 const role=snapshot?.roles?.find(r=>r.role==='matrix');
 return (items||role?.activity?.items||[]).filter(i=>i.generation===role?.generation&&(!i.agent||i.agent===role.id)&&(tools?!i.hidden&&!['ask_user','ask_subconscious','share_diary'].includes(i.tool):stageProcessVisible(i,{plan:true}))).map(i=>({...i,member:'matrix',name,call_id:i.id}));
}

// One terminal plus one independent visual; browser and search share the
// second slot. Browser receives only geometry, retaining its native page.
// Plans and reports already have shared, durable entries on the right rail.
// Do not echo their documents into the background terminal.
export function workPanels(items){
 const terminal=items.filter(i=>!['update_plan','report'].includes(i.tool)&&!(i.tool==='workspace'&&i.action==='report')&&(!['web_search','browser'].includes(i.tool)||['load_tool','unload_tool'].includes(i.action)));
 const visual=items.filter(i=>['web_search','browser'].includes(i.tool)&&!['load_tool','unload_tool'].includes(i.action));
 return {terminal,visual:currentOperation(visual)?.tool||'',search:visual.filter(i=>i.tool==='web_search')};
}
export function workProjectionGroups(scope,items,{projectDiff=false,flow=false}={}){
 const groups=new Map();
 const terminalCalls=new Map();
 const latestByOwner=new Map();
 const terminalGroup=new Map();
 for(const [index,item] of items.entries()){
  let kind=projectionKind(item);
  if(kind==='patch'&&projectDiff)continue;
  if(!flow&&(kind==='receipt'||kind==='project'&&/^(?:read|list|find|search|grep|glob|stat|tree|current)$/.test(item.action||'')))kind='terminal';
  const owner=JSON.stringify([scope,item.member||item.agent||'',item.generation||0]);
  const key=projectionIdentity(scope,item);
  const id=flow?(kind==='terminal'?terminalGroup.get(owner)||key:key)
   :kind==='terminal'||mediaKinds.has(kind)?projectionIdentity(scope,{...item,call_id:kind}):key;
  if(flow){if(kind==='terminal')terminalGroup.set(owner,id);else terminalGroup.delete(owner);}
  if(kind==='terminal')terminalCalls.set(owner,(terminalCalls.get(owner)||0)+1);
  latestByOwner.set(owner,index);
  let group=groups.get(id);
  if(!group){group={id,kind,owner,operations:[]};groups.set(id,group);}
  group.operations.push(item);
  group.latest=index;
  group.terminalAt=terminalCalls.get(owner)||0;
 }
 const result=new Map();
 for(const group of groups.values()){
  group.item=currentOperation(group.operations);
  if(!flow&&group.kind==='toolbox'&&group.latest!==latestByOwner.get(group.owner)&&!running(group.item.state))continue;
  if(!flow&&mediaKinds.has(group.kind)&&(terminalCalls.get(group.owner)||0)-group.terminalAt>=3&&!running(group.item.state))continue;
  result.set(group.id,group);
 }
 return result;
}
export function setupWorkSurface(root,{doc=document,readReceipt,readTerminal,readImage,readArtifact,readProgram,browserSurface,browserActive,name='Eyra',onLayout=()=>{},onSettled,persistent=false,retain=false,tools=false,projectDiff=false}={}){
 if(tools)return setupToolWorkSurface(root,{doc,readReceipt,readTerminal,readImage,readArtifact,readProgram,browserSurface,browserActive,name,onLayout,onSettled,projectDiff});
 const win=doc.defaultView,make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 root.classList.add('shared-work-surface');root.hidden=true;
 function pane(label){const node=make('section','stage-pane'),head=make('header','stage-head'),title=make('span','stage-title',label),state=make('span','stage-state'),body=make('div','stage-body');head.append(title,state);node.append(head,body);root.append(node);bindThemeComponent(node,'tool',{heading:head,body},doc);return {node,head,title,state,body};}
 const terminalPane=pane('终端'),visualPane=pane('搜索');terminalPane.node.dataset.kind='terminal';
 const transcript=new OperationTranscript(),terminal=createTerminalView({doc,transcript,textOnly:true,who:{name},getScope:s=>({task_id:s.scope_id,agent_id:'work-surface',generation:1})});
 const terminalBody=make('div','work-terminal'),searchBody=make('div','work-search'),browserBody=make('div','work-browser'),browserError=make('p','work-browser-error');browserError.hidden=true;browserError.setAttribute('role','status');browserBody.append(browserError);terminalBody.append(terminal.element);terminalPane.body.append(terminalBody);visualPane.body.append(searchBody,browserBody);
 const search=setupSearchView({doc,make,reduced:()=>!motionAllowed(doc),motionAllowed,activityOutcome}),searchPane={node:visualPane.node,body:searchBody,state:visualPane.state};
 let last=null,scope='',closed=false,shown=false,kind='',browserTab='',browserNotice='',frame=0,browserKey='',browserChain=Promise.resolve(),layoutDirty=true,layoutMode='';
 function syncBrowser(){
  if(typeof browserSurface!=='function')return;
  const visible=!!browserTab&&!closed&&shown&&kind==='browser'&&!doc.hidden&&!doc.querySelector('dialog:modal')&&browserBody.checkVisibility();
  const r=visible?browserBody.getBoundingClientRect():{x:0,y:0,width:0,height:0},payload={visible,tab_id:browserTab,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}},key=JSON.stringify(payload);
  if(kind==='browser'&&!browserTab){browserError.textContent=browserNotice||'正在打开浏览器…';browserError.hidden=false;}
  if(key===browserKey)return;browserKey=key;
  browserChain=browserChain.catch(()=>{}).then(async()=>{const result=await browserSurface(payload);if(result?.ok===false)throw Error(result.error||'浏览器显示暂不可用');if(key===browserKey&&browserTab)browserError.hidden=true;}).catch(error=>{if(key!==browserKey)return;browserKey='';browserError.textContent=String(error.message||error);browserError.hidden=!payload.visible;});
 }
 function layout(){
  if(closed)return;
  let mode='none';
  if(shown){
   if(!layoutDirty)return;
   const style=win.getComputedStyle(doc.body);
   mode=stagePlacement({width:win.innerWidth,height:win.innerHeight,pushLeft:parseFloat(style.getPropertyValue('--workspace-inset'))||0,pushRight:parseFloat(style.getPropertyValue('--al-push'))||0}).mode;
  }
  layoutDirty=false;
  if(mode===layoutMode)return;layoutMode=mode;doc.body.dataset.previewLayout=mode;onLayout(mode);
 }
 function update(next){
  if(closed)return;last=next;
  const items=next.operations||[],panels=workPanels(items),nextScope=JSON.stringify([next.core_epoch,next.scope_id,next.project_key]);
  if(scope!==nextScope){
   scope=nextScope;search.close(searchPane);searchPane.searchScope=null;
   // A project can change within the same conversation. Release the previous
   // display and its pending reads without inventing a different Core identity.
   terminal.update({core_epoch:next.core_epoch,scope_id:'',operations:[]});
  }
  const visible=(persistent||(retain||!!next.active)&&(panels.terminal.length>0||!!panels.visual))&&!next.hidden;
  const entering=visible&&!shown;if(visible!==shown)layoutDirty=true;shown=visible;root.hidden=!shown;layout();
  if(!shown){terminal.suspend();search.suspend(searchPane);syncBrowser();return;}
  kind=panels.visual;const browserData=items.filter(i=>i.tool==='browser').map(activityData).map(d=>d.result||d).findLast(d=>d.tab_id);browserTab=browserData?.tab_id||'';const currentBrowser=currentOperation(items.filter(i=>i.tool==='browser'&&!['load_tool','unload_tool'].includes(i.action))),noticeData=activityData(currentBrowser||{});browserNotice=['failed','timed_out','interrupted'].includes(currentBrowser?.state)?String(noticeData.error?.message||noticeData.error||currentBrowser.detail||'浏览器操作未完成'):'';const showTerminal=panels.terminal.length>0||!kind;
  terminalPane.node.hidden=!showTerminal;visualPane.node.hidden=!kind;visualPane.node.dataset.kind=kind==='browser'?'browser':'search';visualPane.title.textContent=kind==='browser'?'浏览器':'搜索';
  root.dataset.count=String(Number(showTerminal)+Number(!!kind));root.dataset.columns='1';
  for(const [view,current]of [[terminalPane,currentOperation(panels.terminal)],[visualPane,currentOperation(items.filter(i=>i.tool===kind))]]){view.node.dataset.state=current?.state||'idle';view.state.textContent=operationStateLabel(current);}
  terminal.update({...next,operations:panels.terminal});if(!showTerminal)terminal.suspend();
  searchBody.hidden=kind!=='web_search';browserBody.hidden=kind!=='browser';
  if(kind==='web_search')search.fill(searchPane,panels.search,scope);else search.suspend(searchPane);
  const own=scope;
  void transcript.refreshReceipts(readReceipt,{readTerminal,isCurrent:()=>!closed&&shown&&showTerminal&&!doc.hidden&&scope===own,onChange:()=>terminal.refresh()});
  resize();
  if(entering)animateUI(root,[{opacity:0,transform:'translateX(20px)'},{opacity:1,transform:'translateX(0)'}],{key:'work-enter'});
 }
 function resize(){win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(()=>{frame=0;layout();if(shown&&!terminalPane.node.hidden)terminal.refresh();syncBrowser();});}
 function invalidateLayout(){layoutDirty=true;resize();}
 function visibility(){if(doc.hidden){terminal.suspend();search.suspend(searchPane);syncBrowser();}else if(last)update(last);}
 const observer=new win.ResizeObserver(invalidateLayout);observer.observe(root);observer.observe(browserBody);
 win.addEventListener('resize',invalidateLayout);doc.addEventListener('workspace-inset-change',invalidateLayout);doc.addEventListener('workspace-theme-change',invalidateLayout);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('workspace-modal-change',resize);
 return {update,transcript,get nativeVisible(){return shown&&kind==='browser'&&!!browserTab;},current:()=>transcript.current(),refresh:()=>last&&update(last),suspend(){shown=false;root.hidden=true;terminal.suspend();search.suspend(searchPane);layout();syncBrowser();},close(){closed=true;syncBrowser();observer.disconnect();win.cancelAnimationFrame(frame);win.removeEventListener('resize',invalidateLayout);doc.removeEventListener('workspace-inset-change',invalidateLayout);doc.removeEventListener('workspace-theme-change',invalidateLayout);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('workspace-modal-change',resize);terminal.close();search.close(searchPane);disposeThemeTree(terminalPane.node);disposeThemeTree(visualPane.node);}};
}

// These scenes consume the original Core operations. A pane can retain
// successive calls for one owner while each receipt keeps its own identity.
// Both rectangle edges follow the same eased progress. Intersect the open
// intervals in which each separating axis overlaps, including crossings whose
// start and end rectangles are disjoint. No per-frame product observer is needed.
export function projectionPathsOverlap(a,b){
 let first=0,last=1;
 const edges=[['right','left'],['bottom','top']];
 for(const [end,start]of edges)for(const [x,y]of [[a,b],[b,a]]){
  const from=x.before[end]-y.before[start],to=x.after[end]-y.after[start],delta=to-from;
  if(Math.abs(delta)<1e-8){if(from<=0)return false;continue;}
  const crossing=-from/delta;if(delta>0)first=Math.max(first,crossing);else last=Math.min(last,crossing);
  if(first>=last)return false;
 }
 return first<last;
}
// Animate only new receipt text. Hiding a pane suspends its local clock.
function briefJournal(doc,body,follow){
 const host=doc.createElement('div');host.className='brief-journal';body.append(host);
 let current='',rows=[],index=0,offset=0,timer=0,visible=false;
 function advance(){
  timer=0;
  while(visible&&index<rows.length){
   const row=rows[index],now=motionAllowed(host);row.section.hidden=false;row.section.dataset.writing=String(now);
   const at=now?Math.min(row.text.length,offset+Math.max(12,Math.ceil(row.text.length/35))):row.text.length;
   row.node.textContent=row.text.slice(0,at);offset=at;
   if(offset===row.text.length){row.section.dataset.writing='false';index++;offset=0;}
   if(follow&&body.scrollHeight>body.clientHeight&&row.node.offsetHeight)body.scrollTop=body.scrollHeight;
   if(now){timer=setTimeout(advance,35);break;}
  }
 }
 return {update(item){
  const data=activityData(item),v=data.result||data,comp=v.compaction;
  const lines=[];
  const add=(label,text)=>{if(typeof text==='string'&&text.trim())lines.push({label,text});};
  if(comp){
   add('原始上下文',v.before);add('压缩摘要',v.after);add('结果',({scheduled:'已排队',running:'正在整理',completed:'摘要已提交',failed:'整理失败',skipped:'无需压缩',deferred:'已暂缓',cancelled:'已取消',interrupted:'整理中断'})[comp.state]||comp.state);add('原文读取',v.source_error);
  }else{
   if(!['terminal','search','patch'].includes(projectionKind(item)))add('操作',item.brief||item.title||projectionLabel(item));
   for(const detail of activityDetails(item))add(detail.label,detail.text);
   if(!lines.some(row=>row.label==='结果')&&!running(item.state))add('结果',activityOutcome(item)||projectionState(item.state));
  }
  const key=JSON.stringify(lines);if(current===key)return;current=key;
  // Keep completed prefixes when a running receipt gains its result.
  let common=0;while(common<rows.length&&common<lines.length&&rows[common].label===lines[common].label&&rows[common].text===lines[common].text)common++;
  for(const row of rows.splice(common))row.section.remove();
  if(index>=common){index=common;offset=0;}
  for(const line of lines.slice(common)){const section=doc.createElement('section'),label=doc.createElement('small'),node=doc.createElement('pre');section.hidden=true;label.textContent=line.label;section.append(label,node);host.append(section);rows.push({...line,node,section});}
  if(visible&&!timer)advance();
 },visible(value){visible=value;clearTimeout(timer);timer=0;if(value)advance();},close(){visible=false;clearTimeout(timer);}};
}
// Chain projection: every host composes this readonly surface. Readers are
// injected for the current scope/call generation; they never execute tools.
// Each window follows current receipts automatically. This owner coordinates
// geometry, hidden media and cleanup;
// ordinary streaming snapshots must not restart the same layout transition.
export function setupToolWorkSurface(root,{doc=document,readReceipt,readTerminal,readImage,readArtifact,readProgram,browserSurface,browserActive=()=>doc.body.dataset.view==='home',name='Eyra',onLayout=()=>{},onSettled=()=>{},projectDiff=false,flow=false,identityFor,onReceipt}={}){
 const win=doc.defaultView,make=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const grid=make('div','projection-grid'),panes=new Map(),selection=new WorkSelection(),trail=flow?make('div','coding-flow-trail'):null,rows=new Map();
 root.replaceChildren(...(trail?[trail]:[]),grid);root.classList.add('shared-work-surface','tool-work-surface');root.classList.toggle('coding-flow',flow);root.hidden=true;
 trail?.setAttribute('aria-label','最近的操作');
 const search=setupSearchView({doc,make,reduced:()=>!motionAllowed(doc),motionAllowed,activityOutcome}),patch=createPatchView({make,activityData,activityOutcome,groupState:groupActivityState,STATES:activityStates,middleEllipsis});
 let last=null,scope='',closed=false,shown=false,resizeFrame=0,layoutMode='none',items=[],paintKey='',outcomeTimer=0;
 let surfaceAnimation=null;
 let nativeKey='',nativeQueue=Promise.resolve(),nativeVisible=false;
 const nativeEvents=['workspace-chat-layer-change','workspace-view-change','workspace-modal-change'];
 function nativeBounds(p){
  const b=doc.body.dataset;
  if(closed||doc.hidden||b.visible==='false'||!browserActive()||b.chatExpanded!=='false'||b.chatClosing==='true'||b.chatTransition!=='idle'||root.dataset.motionState!=='visible'||!p?.visible||p.entryAnimation||p.node.getAnimations().some(a=>a.playState==='running')||doc.querySelector('dialog:modal'))return null;
  const area=p.body.parentElement.getBoundingClientRect(),clip=grid.getBoundingClientRect();
  const x=Math.ceil(Math.max(area.left,clip.left,0)),y=Math.ceil(Math.max(area.top,clip.top,0));
  const width=Math.floor(Math.min(area.right,clip.right,win.innerWidth)-x),height=Math.floor(Math.min(area.bottom,clip.bottom,win.innerHeight)-y);
  return width>=160&&height>=140?{x,y,width,height}:null;
 }
 function syncNativeBrowser(){
  if(!browserSurface)return;
  const p=[...panes.values()].find(p=>p.kind==='browser'&&p.visible&&p.tab);
  const bounds=nativeBounds(p),payload=bounds?{visible:true,tab_id:p.tab,bounds}:{visible:false};
  const key=payload.visible?JSON.stringify(payload):'';
  if(nativeKey===key)return;
  nativeKey=key;
  if(!key)nativeVisible=false;
  nativeQueue=nativeQueue.then(async()=>{
   if(nativeKey!==key)return;
   const r=await browserSurface(payload);
   if(nativeKey!==key)return;
   nativeVisible=payload.visible&&r?.ok===true&&!r.hidden&&!r.inactive_surface;
   if(payload.visible&&!nativeVisible)nativeKey='';
  }).catch(()=>{if(nativeKey===key){nativeKey='';nativeVisible=false;}});
 }
 root.dataset.motionState='hidden';
 const titleOf=(item,kind)=>kind==='terminal'?'终端':projectionLabel(item);
 function settle(visible){
  surfaceAnimation=null;cancelMotion(root,'projection-surface');
  root.hidden=!visible;root.inert=!visible;root.dataset.motionState=visible?'visible':'hidden';shown=visible;
  if(!visible){for(const p of panes.values())visiblePane(p,false);if(flow)release();onSettled();}
  layout();syncNativeBrowser();
 }
 function present(visible,immediate=false){
  const state=root.dataset.motionState;
  if(visible?(state==='visible'||state==='entering'):state==='hidden')return;
  if(!visible&&state==='exiting'&&!immediate)return;
  const style=win.getComputedStyle(root),current=state==='hidden'?{opacity:0,translate:'0 8px'}:{opacity:style.opacity,translate:style.translate};
  root.hidden=false;root.inert=!visible;shown=true;
  root.dataset.motionState=visible?'entering':'exiting';
  syncNativeBrowser();
  const animation=!immediate&&animateUI(root,[current,visible?{opacity:1,translate:'0 0'}:{opacity:0,translate:'0 8px'}],{kind:'move',fill:'both',key:'projection-surface'});
  if(!animation){settle(visible);return;}
  surfaceAnimation=animation;
  const finish=()=>{if(surfaceAnimation===animation)settle(visible);};
  animation.finished.then(finish,finish);
 }
 function layout(){
  // Tools share a background workspace. Its internal columns never change
  // the foreground conversation's profile, position or reading rectangle.
  const p={mode:shown?'background':'none'};
  if(layoutMode!==p.mode){layoutMode=p.mode;doc.body.dataset.previewLayout=p.mode;onLayout(p.mode);}
  doc.body.dataset.toolProjection=String(shown);
  if(flow)return;
  const wide=grid.clientWidth||root.clientWidth||1,columns=wide>=1050&&grid.dataset.count==='3'?3:wide>=500?2:1;
  grid.style.setProperty('--projection-columns',columns);
 }
 function stopPaneMotion(p){cancelMotion(p.node,'projection-layout');cancelMotion(p.node,'projection-enter');p.entryAnimation=null;p.node.inert=false;}
 function ownEntry(p,animation,blocked){
  p.entryAnimation=animation;p.node.inert=!!(blocked&&animation);
  if(animation){const settled=()=>{if(p.entryAnimation===animation){p.entryAnimation=null;p.node.inert=false;}};animation.finished.then(settled,settled);}
 }
 // Preserve the ordinary 2px clearance even when the responsive row gap
 // shrinks. A fixed 12px rise can cross the next stationary pane's border.
 function entryShift(){return Math.max(0,Math.min(12,(parseFloat(win.getComputedStyle(grid).rowGap)||0)-2));}
 function enterPane(p,delay=0,shift=entryShift()){ownEntry(p,animateUI(p.node,[{opacity:0,transform:`translateY(${shift}px)`},{opacity:1,transform:'none'}],{duration:360,delay,fill:'backwards',key:'projection-enter'}),delay);}
 function visiblePane(p,value){if(p.visible===value)return;if(!value)stopPaneMotion(p);p.visible=value;p.node.hidden=!value;p.view?.setVisible(value,p.item);p.journal?.visible(value);if(!value){p.terminal?.suspend();search.suspend(p);}}
 function projection(){
  const indexed=workProjectionGroups(scope,items,{projectDiff:last?.projectDiff??projectDiff,flow});
  if(flow){
   const nextShown=!!last&&!last.hidden&&(!!last.active||!!outcomeTimer)&&indexed.size>0&&!doc.hidden&&doc.body.dataset.visible!=='false';
   const ordered=nextShown?[...indexed.values()].sort((a,b)=>a.latest-b.latest):[];
   const picked=ordered.length?[ordered.at(-1).id]:[];
   const previous=ordered.slice(-3,-1).filter(row=>!running(row.item.state));
   return {indexed,nextShown,picked,previous,key:JSON.stringify([nextShown,picked,previous.map(row=>row.id)])};
  }
  const currentTerminal=[...indexed.values()].filter(group=>group.kind==='terminal').sort((a,b)=>Number(running(b.item.state))-Number(running(a.item.state))||b.latest-a.latest)[0];
  const candidates=[...indexed.values()].map(({id,kind,item,latest})=>({id,kind,state:item.state,focused:id===currentTerminal?.id,attention:kind==='decision'||['failed','timed_out','interrupted_unknown','persistence_failed'].includes(item.state),updated:latest}));
  const kinds=new Set(candidates.filter(row=>row.kind==='terminal'||mediaKinds.has(row.kind)).map(row=>row.kind));
  const nextShown=!!last&&!last.hidden&&(!!last.active||!!outcomeTimer)&&indexed.size>0&&!doc.hidden&&doc.body.dataset.visible!=='false';
  const picked=nextShown?selection.select(candidates,{limit:kinds.has('terminal')&&kinds.size>=3?3:2,hold:0}).items.map(x=>x.id):[];
  return {indexed,nextShown,picked,key:JSON.stringify([nextShown,picked])};
 }
 // Capture interrupted geometry before cancelling our own motion. Animate
 // dimensions and translation together; glyphs and controls are never scaled.
 function transition(change){
  change();const frame=projection();
  if(frame.key===paintKey){paint(frame);return;}
  if(!frame.nextShown){paint(frame);return;}
  if(flow){
   // Measure once per operation change; only translation and opacity animate.
   const prior=new Map([...rows].map(([id,node])=>[id,node.getBoundingClientRect().top]));
   const active=[...panes.values()].find(p=>p.visible);
   if(active)prior.set(active.key,active.node.getBoundingClientRect().top);
   paint(frame);
   for(const [id,node] of rows){const origin=prior.get(id),shift=origin===undefined?7:origin-node.getBoundingClientRect().top;if(shift)animateUI(node,[{transform:`translateY(${shift}px)`,opacity:.55},{transform:'none',opacity:1}],{kind:'enter',key:'coding-fold'});}
   const p=panes.get(frame.picked[0]);if(p&&p!==active)animateUI(p.node,[{transform:'translateY(8px)',opacity:0},{transform:'none',opacity:1}],{kind:'enter',key:'projection-enter'});
   return;
  }
  // A delayed entry is logically selected but still has no visible content.
  // On interruption it must retain entry choreography, not become a moving
  // survivor that fades through a surface which has yet to vacate its area.
  const before=new Map([...panes.values()].filter(p=>p.visible).map(p=>[p.key,{rect:p.node.getBoundingClientRect(),opacity:win.getComputedStyle(p.node).opacity}]).filter(([,prior])=>Number(prior.opacity)>0));
  for(const p of panes.values())stopPaneMotion(p);
  const wasShown=!root.hidden;
  paint(frame);if(!wasShown||!motionAllowed(root))return;const paths=[],moving=[];
  for(const p of panes.values()){
   const prior=before.get(p.key);if(!p.visible||!prior)continue;
   const after=p.node.getBoundingClientRect();paths.push({p,before:prior.rect,after,opacity:Number(prior.opacity)});
  }
  const rank=row=>row.p.node.contains(doc.activeElement)?3:row.p.item.decision?2:0,kept=[],yielding=[];
  for(const row of paths.sort((a,b)=>rank(b)-rank(a))){if(kept.some(other=>projectionPathsOverlap(row,other)))yielding.push(row);else kept.push(row);}
  const lead=yielding.length?motionDuration(root,'fast'):0,move=motionDuration(root,'move');
  for(const row of rows){
   const {p,before:prior,after,opacity}=row,dx=prior.x-after.x,dy=prior.y-after.y,start={width:prior.width+'px',height:prior.height+'px',transform:`translate(${dx}px,${dy}px)`,opacity},end={width:after.width+'px',height:after.height+'px',transform:'none',opacity:1};
   if(yielding.includes(row)){
    // Reverse a conflicting surface in place before the kept windows move,
    // relocate it while transparent, then reveal at its final free rectangle.
    // The primary/focused surface remains visible throughout the handoff.
    const duration=lead+move+360,animation=animateUI(p.node,[{...start,offset:0,easing:MOTION.ease},{...start,opacity:0,offset:lead/duration},{...end,opacity:0,offset:(lead+move)/duration,easing:MOTION.ease},{...end,offset:1}],{duration,easing:'linear',key:'projection-layout'});ownEntry(p,animation,true);if(animation)moving.push(row);continue;
   }
   if(Math.abs(dx)+Math.abs(dy)+Math.abs(prior.width-after.width)+Math.abs(prior.height-after.height)<.5&&opacity>=1)continue;
   const animation=animateUI(p.node,[start,end],{kind:'move',delay:lead,fill:'backwards',key:'projection-layout'});if(animation)moving.push(row);
  }
  // Let the previous surface vacate its rectangle before revealing new text.
  // Delayed panes stay inert; real tool execution and receipt reads never wait.
  const shift=entryShift();for(const p of panes.values())if(p.visible&&!before.has(p.key)){
   stopPaneMotion(p);const r=p.node.getBoundingClientRect(),area={left:r.left,right:r.right,top:r.top,bottom:r.bottom+shift},blocked=moving.some(row=>projectionPathsOverlap({before:area,after:area},row));enterPane(p,blocked?lead+move:0,shift);
  }
 }
 function dropPane(p){stopPaneMotion(p);cancelMotion(p.node);p.terminal?.close();p.view?.close();p.journal?.close();search.close(p);disposeThemeTree(p.node);p.node.remove();panes.delete(p.key);}
 function release(){clearTimeout(outcomeTimer);outcomeTimer=0;for(const p of panes.values())dropPane(p);for(const node of rows.values())cancelMotion(node);rows.clear();trail?.replaceChildren();selection.clear();paintKey='';}
 function paintTrail(groups){
  if(!trail)return;
  for(const [id,node] of rows)if(!groups.some(row=>row.id===id)){cancelMotion(node);node.remove();rows.delete(id);}
  for(const [index,{id,item}] of groups.entries()){
   let node=rows.get(id);
   if(!node){node=make(onReceipt?'button':'div','coding-flow-summary');if(onReceipt)node.type='button';rows.set(id,node);}
   if(onReceipt)node.onclick=()=>onReceipt(item);
   const text=[item.name,activityBrief(item)||activityLabel(item)].filter(Boolean).join(' · ');
   if(node.textContent!==text){node.textContent=text;node.title=text;}
   if(trail.children[index]!==node)trail.insertBefore(node,trail.children[index]||null);
  }
 }
 function hydrate(p,item){
  if(!flow||!readReceipt||p.kind==='terminal'||running(item.state)||(!item.preview_truncated&&item.preview!==undefined)||!item.receipt_version)return item;
  const version=JSON.stringify([item.call_id,item.generation,item.receipt_version]);
  if(p.fullVersion!==version){
   p.fullVersion=version;p.full=null;
   const own=scope;
   Promise.resolve(readReceipt({role:item.member,call_id:item.call_id,generation:item.generation,receipt_version:item.receipt_version,input_offset:0,output_offset:0})).then(result=>{
    if(closed||scope!==own||panes.get(p.key)!==p||p.fullVersion!==version||!p.visible||result?.ok===false||result?.pending||result?.receipt_version!==item.receipt_version)return;
    const output=result.output,input=result.input;
    if(!result.next_output&&typeof output==='string'&&output){
     const parsed=activityData({preview:output});
     if((p.kind==='patch'&&!Array.isArray(parsed.files))||(p.kind==='image'&&!parsed.image_id))return;
     p.full={...item,preview:output,preview_truncated:false,...(!result.next_input&&input?{input_preview:input}:{})};
     paint();
    }
   }).catch(()=>{});
  }
  return p.full||item;
 }
 function pane({id:key,item,kind}){
  let p=panes.get(key);if(p)return p;
  const node=make('section','stage-pane projection-pane'),head=make('header','stage-head'),symbol=flow&&identityFor?createRoleRing(identityFor(item)):make('span','projection-halo'),brief=make('span','projection-brief'),body=make('div','stage-body projection-body'),visual=make('div','projection-visual');
  if(!flow||!identityFor){symbol.setAttribute('aria-hidden','true');mountHaloInstrument(symbol);}
  head.append(symbol,brief);node.append(head,body);body.append(visual);
  node.dataset.kind=kind;node.dataset.source=key;node.setAttribute('aria-label',titleOf(item,kind));
  p={key,kind,node,head,symbol,brief,body:visual,visible:false,item};panes.set(key,p);grid.append(node);bindThemeComponent(node,'tool',{heading:head,body},doc);
  if(flow&&onReceipt){
   const more=make('button','quiet coding-flow-receipt','完整回执');more.type='button';more.onclick=()=>onReceipt(p.item);head.append(more);
  }
  if(kind==='terminal'){
   p.transcript=new OperationTranscript();p.terminal=createTerminalView({doc,transcript:p.transcript,textOnly:true,who:{name:item.name||name},getScope:s=>({task_id:s.scope_id,agent_id:item.member||item.agent||'work-surface',generation:item.generation||1})});visual.append(p.terminal.element);
  }else if(!['search','patch'].includes(kind)){
   const nativeProgram=kind==='browser'&&browserSurface?{eligible:()=>!!nativeBounds(p),apply:tab=>{p.tab=tab;syncNativeBrowser();}}:undefined;
   p.view=createToolProjection(doc,{kind,facts:activityFacts,nativeProgram,loadProgram:readProgram?(current,options)=>readProgram({role:current.member,call_id:current.call_id,generation:current.generation,metadataOnly:options.metadataOnly}):undefined,loadImage:readImage?(id,current)=>readImage({role:current.member,image_id:id,call_id:current.call_id,generation:current.generation}):undefined,loadArtifact:readArtifact?(path,current)=>readArtifact({role:current.member,path,call_id:current.call_id,generation:current.generation}):undefined,onDecision:key=>doc.dispatchEvent(new win.CustomEvent('eyra:decision-open',{detail:{key}}))});visual.append(p.view.element);
  }
  if(kind!=='terminal'&&!flow)p.journal=briefJournal(doc,body,!mediaKinds.has(kind));
  return p;
 }
 function paint(frame=projection()){
  if(closed||!last)return;
  const {indexed,nextShown,picked}=frame;paintKey=frame.key;
  if(!nextShown){present(false,flow&&!last.active||doc.hidden||doc.body.dataset.visible==='false');return;}
  for(const [key,p] of panes)if(!indexed.has(key)||flow&&!picked.includes(key))dropPane(p);
  present(true);layout();
  if(flow){paintTrail(frame.previous);root.dataset.kind=indexed.get(picked[0])?.kind||'';}
  for(const p of panes.values())if(!picked.includes(p.key))visiblePane(p,false);
  for(const id of picked){const group=indexed.get(id);if(!group)continue;const {item,operations}=group,p=pane(group);p.item=item;visiblePane(p,true);p.node.dataset.state=item.state||'unknown';p.node.dataset.call=item.call_id||item.id||'';
   const visual=hydrate(p,item);
   p.symbol.dataset.haloLive=String(['queued','running','in_progress','in_flight'].includes(item.state));
   const haloState=item.state==='running'?'tool':item.state,toolEffect=p.kind==='terminal'?'terminal':p.kind==='search'?'search':'generic';
   if(flow&&identityFor)paintRoleRing(p.symbol,identityFor(item),haloState,doc,{toolEffect,live:running(item.state)});
   else paintHaloState(p.symbol,haloState,toolEffect,{reduced:!motionAllowed(doc)});
   const brief=activityBrief(visual)||(flow?activityLabel(visual):'');
   if(p.brief.textContent!==brief){p.brief.textContent=brief;p.brief.title=brief;}
   p.brief.hidden=!brief;
   if(p.kind==='terminal'){
    p.terminal.update({...last,operations});const own=scope;void p.transcript.refreshReceipts(readReceipt,{readTerminal,isCurrent:()=>!closed&&scope===own&&shown&&p.visible&&!doc.hidden,onChange:()=>p.terminal.refresh()});
   }else if(p.kind==='search')search.fill(p,visual===item?operations:[visual],scope);else if(p.kind==='patch')patch(p,visual===item?operations:[visual]);else {const data=activityData(visual);p.body.hidden=!!(data.compaction||data.result?.compaction);if(!p.body.hidden)p.view?.update(visual);}
   if(flow&&item.tool==='core_link'&&item.action==='link_send'&&activityData(visual).accepted===true&&p.delivered!==item.id){
    p.delivered=item.id;const signal=make('span','coding-flow-link','→');signal.setAttribute('aria-hidden','true');p.head.prepend(signal);
    const animation=animateUI(signal,[{opacity:0,transform:'translateX(-7px)'},{opacity:1,transform:'translateX(6px)'},{opacity:0,transform:'translateX(14px)'}],{kind:'move',key:'coding-link'});if(animation)void animation.finished.then(()=>signal.remove(),()=>signal.remove());else signal.remove();
   }
   p.journal?.update(item);
  }
  grid.dataset.count=String(picked.length);root.dataset.count=String(picked.length);layout();syncNativeBrowser();
 }
 function update(next){
  if(closed)return;
  const own=JSON.stringify([next.core_epoch,next.scope_id,next.project_key,...(flow?[next.flow_key]:[])]);
  if(own!==scope){release();if(!root.hidden)settle(false);scope=own;}
  else if(!flow&&last?.active&&!next.active&&shown&&!next.hidden){
   clearTimeout(outcomeTimer);outcomeTimer=setTimeout(()=>{outcomeTimer=0;transition(()=>{});},6500);
  }
  if(next.active||next.hidden){clearTimeout(outcomeTimer);outcomeTimer=0;}
  last=next;
  // Decisions belong to the original composer, including older callers that
  // still publish decisions or their tool receipts alongside operations.
  const operations=(next.operations||[]).filter(i=>!i.decision&&!['ask_user','human'].includes(i.tool));
  if(operations.length||!outcomeTimer)items=operations;
  transition(()=>{});
 }
 function reflow(){if(resizeFrame||closed)return;resizeFrame=win.requestAnimationFrame(()=>{resizeFrame=0;paint();for(const p of panes.values())if(p.visible)p.terminal?.refresh();});}
 // A hidden document may stop rAF entirely. Release media and pending reads
 // in the visibility event itself; only visible layout waits for a frame.
 function resized(){for(const p of panes.values())stopPaneMotion(p);reflow();}
 function visibility(){if(closed)return;if(doc.hidden){win.cancelAnimationFrame(resizeFrame);resizeFrame=0;paint();}else reflow();}
 const stopMotion=observeMotion(doc,allowed=>{if(!allowed){for(const p of panes.values())stopPaneMotion(p);if(surfaceAnimation)settle(projection().nextShown);else if(doc.hidden||doc.body.dataset.visible==='false')paint();}});
 const observer=new win.ResizeObserver(reflow);observer.observe(root);win.addEventListener('resize',resized);win.addEventListener('os-scale',resized);doc.addEventListener('visibilitychange',visibility);doc.addEventListener('workspace-inset-change',reflow);doc.addEventListener('workspace-theme-change',reflow);
 if(browserSurface){for(const event of nativeEvents)doc.addEventListener(event,syncNativeBrowser);grid.addEventListener('scroll',syncNativeBrowser,{passive:true});}
 return {update,transcript:{rows:()=>[...panes.values()].flatMap(p=>p.transcript?.rows()||[])},get nativeVisible(){return nativeVisible;},current:()=>[...panes.values()].find(p=>p.visible)?.item,refresh:paint,suspend(){if(last)update({...last,hidden:true});},close(){if(closed)return;closed=true;syncNativeBrowser();surfaceAnimation=null;cancelMotion(root,'projection-surface');stopMotion();release();observer.disconnect();win.cancelAnimationFrame(resizeFrame);win.removeEventListener('resize',resized);win.removeEventListener('os-scale',resized);doc.removeEventListener('visibilitychange',visibility);doc.removeEventListener('workspace-inset-change',reflow);doc.removeEventListener('workspace-theme-change',reflow);for(const event of nativeEvents)doc.removeEventListener(event,syncNativeBrowser);grid.removeEventListener('scroll',syncNativeBrowser);root.hidden=true;doc.body.dataset.toolProjection='false';}};
}

// Resolve the immutable call receipt before reading its actual process log.
// Every read retains task, agent, generation and epoch; no path is accepted.
export function homeWorkReaders(api,getSnapshot){
 const source=args=>{const s=getSnapshot(),r=s?.roles?.find(r=>r.role==='matrix');if(!r||args.generation!==r.generation)throw Error('当前任务已变化');return {task_id:s.session_id,agent_id:r.id,generation:r.generation,receipt_generation:args.generation,core_epoch:s.core_epoch,id:args.call_id};};
 const receipt=args=>api.receipt({...source(args),input_offset:args.input_offset||0,output_offset:args.output_offset||0,...(args.receipt_version?{receipt_version:args.receipt_version}:{})});
 const processes=new Map();
 return {readReceipt:receipt,browserSurface:api.browserSurface?args=>api.browserSurface({...args,work:true}):undefined,readProgram:api.programProjection?args=>api.programProjection({...source(args),call_id:args.call_id,metadata_only:args.metadataOnly}):undefined,readImage(args){return api.toolImage({...source(args),image_id:args.image_id});},async readArtifact(args){const target=source(args),own=JSON.stringify(target);const result=await api.artifact({task_id:target.task_id,path:args.path,action:'image_read'});if(JSON.stringify(source(args))!==own)throw Error('当前任务已变化');return result;},async readTerminal(args){
  const target=source(args),key=JSON.stringify(target);let process=processes.get(key);
  if(!process){
   let data=activityData(homeOperations(getSnapshot()).find(i=>i.call_id===args.call_id)||{});
   if(!data.session_id){
    const row=await receipt(args);if(row?.ok===false)throw Error(row.error||'工具记录不可用');
    try{data=JSON.parse(row.output||'{}');}catch{return {pending:true};}
    data=data.result||data;
    if(!data.session_id)return row.pending?{pending:true}:{ok:true,no_process:true};
   }
   process={id:data.session_id,generation:data.generation||target.generation};processes.set(key,process);while(processes.size>400)processes.delete(processes.keys().next().value);
  }
  const response=await api.terminalRead({...target,session_id:process.id,session_generation:process.generation,offset:args.offset||0});
  if(JSON.stringify(source(args))!==key)throw Error('当前任务已变化');
  return {...response,call_id:args.call_id,receipt_generation:args.generation};
 }};
}

// Program and OS conversations project the same Core receipts as Home. Reads
// retain the durable session, generation and epoch and never choose a log path.
export function conversationOperations(snapshot,name='Eyra',items=snapshot?.activity?.items||[]){
 const agent=snapshot?.agent;
 return items.filter(i=>!i.hidden&&i.generation===agent?.generation&&(!i.agent||i.agent===agent.id)&&!['ask_user','ask_subconscious','share_diary','human'].includes(i.tool)).map(i=>({...i,member:agent.id,name,call_id:i.id}));
}
export function conversationWorkReaders(call,getSnapshot){
 const source=args=>{const s=getSnapshot();if(!s?.agent?.id||args.generation!==s.agent.generation)throw Error('当前会话任务已变化');return {id:s.agent.id,call_id:args.call_id,receipt_generation:args.generation,core_epoch:s.core_epoch};};
 return {readReceipt:args=>call({...source(args),action:'receipt',input_offset:args.input_offset||0,output_offset:args.output_offset||0,receipt_version:args.receipt_version}),
  readTerminal:args=>call({...source(args),action:'terminal_read',offset:args.offset||0}),
  readImage:args=>call({...source(args),action:'image',image_id:args.image_id}),
  readProgram:args=>call({...source(args),action:'program_projection',metadata_only:args.metadataOnly===true})};
}
