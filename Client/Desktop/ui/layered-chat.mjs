// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat, native-chat
// Regions: chatLayerPreferences; compactWorkRows; compactLiveRows; ChatLayerState; chatLayerBounds; chatLayerMovePosition; chatCompactTextMetrics; chatCompactPlacement; chatBriefPreviewHeight; setupChatLayer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/layered-chat.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import * as motion from './motion.mjs';
const {animateUI,motionAllowed}=motion;
import {relocateHalo} from '../../../Halo/runtime/transition.mjs';
import {createRoleRing,paintRoleRing} from './role-identity.mjs';
import {createWorkTranscript} from './work-transcript.mjs';
import {setupChatColumn} from './chat-column.mjs';

// The host persists these booleans outside its per-launch Chromium profile.
export function chatLayerPreferences(call){
 const memory=new Map(),positions=new Map(),moves=new Map();
 return {async read(id,fallback){if(!id)return fallback;const version=moves.get(id);try{const value=await call?.({key:id});if(value?.ok!==false){if(value.position&&version===moves.get(id))positions.set(id,value.position);if(typeof value.open==='boolean'){memory.set(id,value.open);return value.open;}}}catch{}return memory.get(id)??fallback;},write(id,open){if(!id)return;memory.set(id,!!open);try{void Promise.resolve(call?.({key:id,open:!!open})).catch(()=>{});}catch{}},position:id=>positions.get(id),move(id,position,{save=true}={}){if(!id)return;positions.set(id,{...position});moves.set(id,(moves.get(id)||0)+1);if(save)try{void Promise.resolve(call?.({key:id,position})).catch(()=>{});}catch{}}};
}

// This is a bounded projection of current work, never another history reader.
// Chain chat -> native-chat: reduce the active generation's visible Brief
// window, retaining semantic rows/identity for the original chat-column.
// Current body is partitioned separately below; this is not another history.
export function compactWorkRows(messages,generation){
 const rows=[];
 const brief=(row,parent)=>({id:row.id,kind:'brief',from:'eyra',role:parent.role,identity:parent.identity,to:parent.to,talk:!!parent.talk,brief:true,text:row.text});
 for(const m of messages||[]){
  if(m.generation!==generation&&m.turnID!==generation||m.from==='user')continue;
  if((m.brief||m.talk)&&m.text)rows.push(brief(m,m));
  else if(m.work?.journal)rows.push(...m.work.journal.rows.filter(r=>r.kind==='brief').map(r=>brief(r,m)));
 }
 return [...new Map(rows.filter(r=>r.text?.trim()).map(r=>[r.id,r])).values()].slice(-3).map(r=>({...r,text:r.text.slice(-700)}));
}
export function compactLiveRows(messages,generation){
 const current=(messages||[]).findLast(m=>(m.generation===generation||m.turnID===generation)&&m.from!=='user'&&!m.brief&&(m.work?.journal||m.response&&m.text));
 const rows=current?.work?.journal?.rows|| (current?.text?[{id:current.id,kind:'body',text:current.text}]:[]);
 return rows.filter(r=>['thinking','body'].includes(r.kind)&&r.text?.trim()).slice(-2).map(r=>({id:r.id,kind:r.kind,text:r.text.slice(-1600)}));
}

// Parent and native renderer share this transition protocol. A stale close
// acknowledgement cannot shrink a surface which has already reopened.
export class ChatLayerState {
 constructor(open=true){this.open=open;this.transition=0;this.closing=false;}
 set(open){open=!!open;if(open===this.open)return false;this.open=open;this.closing=!open;this.transition++;return true;}
 settle(token){if(Number(token)!==this.transition||!this.closing)return false;this.closing=false;return true;}
 get full(){return this.open||this.closing;}
}
export function chatLayerBounds({width,height,left=0,top=0,full=false,avatarSize=110,position,previewHeight=0,contentExtra=0,details=true}){
 const x=Math.max(0,Math.min(left,width-1)),y=Math.max(0,Math.min(top,height-1)),w=Math.max(1,width-x),h=Math.max(1,height-y);
 const size=Math.max(1,Number(avatarSize)||110),anchorWidth=Math.min(w,size+336),cw=details?anchorWidth:Math.min(w,size+48),ch=Math.min(h,size+48);
 const clamp=v=>Math.min(1,Math.max(0,Number.isFinite(v)?v:0));
 const anchorY=y+(h-ch)*clamp(position?.y??1),extra=details?Math.min(Math.max(0,contentExtra),h-ch):0,rise=Math.min(extra,anchorY-y),preview=Math.min(Math.max(0,previewHeight),anchorY-y-rise);
 return full?{x,y,width:w,height:h}:{x:x+(w-anchorWidth)*clamp(position?.x),y:anchorY-rise-preview,width:cw,height:ch+extra+preview};
}
// Positions describe the avatar's anchor. Briefs growing above it never move it.
export function chatLayerMovePosition(geometry,dx,dy){
 const b=chatLayerBounds({...geometry,previewHeight:0,contentExtra:0,details:true}),full=chatLayerBounds({...geometry,full:true}),maxX=full.width-b.width,maxY=full.height-b.height;
 return {x:Math.max(0,Math.min(maxX,b.x-full.x+dx))/Math.max(1,maxX),y:Math.max(0,Math.min(maxY,b.y-full.y+dy))/Math.max(1,maxY)};
}

// A compact view changes how much is shown, never the user's font recipe.
// Reserve one complete line of either body or thought after the real identity
// row. Extra room grows around the same avatar anchor, including near the top.
export function chatCompactTextMetrics(style){
 const value=(name,fallback)=>parseFloat(style.getPropertyValue?.(name))||fallback;
 const line=(name,size,fallback)=>{const raw=style.getPropertyValue?.(name)||'',n=parseFloat(raw);return Math.max(size*1.2,Number.isFinite(n)?raw.trim().endsWith('px')?n:size*n:size*fallback);};
 const avatarSize=value('--eyra-avatar',110),body=value('--os-assistant-size',value('--chat-text',16)),thought=value('--os-thinking-size',14);
 const identity=Math.max(value('--chat-name',25)*1.5,value('--os-status-size',14)*1.5);
 const text=Math.max(line('--os-assistant-line',body,value('--chat-leading',1.3)),line('--os-thinking-line',thought,1.6));
 return {avatarSize,contentExtra:Math.max(0,Math.ceil(avatarSize*.2+identity+4+text+2-(avatarSize+16)))};
}
export function chatCompactPlacement(geometry){
 const anchor=chatLayerBounds({...geometry,full:false,previewHeight:0,contentExtra:0}),bounds=chatLayerBounds({...geometry,full:false}),full=chatLayerBounds({...geometry,full:true});
 const contentExtra=geometry.details===false?0:Math.min(Math.max(0,geometry.contentExtra||0),full.height-anchor.height),contentRise=Math.min(contentExtra,anchor.y-full.y);
 return {anchor,bounds,contentExtra,contentRise,previewHeight:bounds.height-anchor.height-contentExtra};
}

// Reserve the same recent Brief rows the shared renderer will draw. Native
// bounds may clamp this to the space above the avatar, without moving it.
export function chatBriefPreviewHeight(style,count){
 const value=(name,fallback)=>parseFloat(style.getPropertyValue(name))||fallback;
 return count?Math.ceil(Math.min(3,count)*(Math.max(value('--eyra-avatar',110)*.5,value('--chat-name',25)*1.45+3+(value('--chat-text',16)-1)*1.65*2)+8)+16):0;
}

// Keeps the real nodes, IME, selection, attachments and reading position alive.
// The same control and compositor animation are used by home, programs and Coding.
// Sole expanded/compact geometry owner. Reading/composer layout must settle
// before target measurement; external native surfaces additionally acknowledge
// the matching viewport. Reversal, hidden and close release this same motion,
// rather than restarting a parallel avatar/particle animation in each host.
export function setupChatLayer({nodes,doc=document,container=doc.body,onChange=()=>{},onSettled=()=>{},onBeforeOpen=()=>{},onMove,initialOpen=true,external=false,deferMotion=false,preference,content}={}){
 const win=doc.defaultView,body=doc.body,state=new ChatLayerState(initialOpen),make=(tag,cls)=>{const n=doc.createElement(tag);n.className=cls;return n;};
 const veil=make('div','chat-layer-veil'),fold=make('button','chat-layer-fold ui-icon-button'),mini=make('div','chat-layer-mini'),avatar=make('button','chat-layer-avatar'),summary=make('div','chat-layer-summary'),name=make('span','chat-layer-name'),status=make('span','chat-layer-status');
 veil.setAttribute('aria-hidden','true');fold.type=avatar.type='button';fold.setAttribute('aria-label','折叠对话');avatar.setAttribute('aria-label','展开对话');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 fold.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M8 12l4 4 4-4"/></svg>';
 const details=make('div','chat-layer-details'),live=make('div','chat-layer-live chat-text');
 const identity={role:'matrix',name:'Eyra',avatar:'',ring:'pulse',glyph:''},ring=createRoleRing(identity,{doc});avatar.append(ring);name.textContent=identity.name;summary.classList.add('chat-name');status.classList.add('chat-work-status');summary.append(name,status);details.append(summary,live);mini.append(avatar,details);container.append(veil,fold,mini);
 let feed=null,feedView=null,feedKey='',feedAnimations=[],liveView=null,liveKey='',liveRevision=0,compactActive=false;
 const paintLive=(rows=[],workScope=scope)=>{
  live.hidden=!compactActive||!rows.length;
  if(live.hidden){liveView?.visibility(false);return;}
  if(!liveView){liveView=createWorkTranscript(live,{wholeLines:true});live.removeAttribute?.('tabindex');}
  liveView.visibility(!state.open&&enabled);
  const next=JSON.stringify([workScope,rows]);if(next===liveKey)return;liveKey=next;const key='compact-live:'+workScope;
  liveView.update({key,phase:rows.at(-1)?.kind||'waiting',journal:{key,revision:++liveRevision,rows}});
 };
 const paintFeed=(rows=[],workScope=scope)=>{
  if(!rows.length){if(feed)feed.hidden=true;feedView?.clear();feedKey='';return;}
  if(!feed){feed=make('div','chat-layer-feed shared-chat-messages');mini.append(feed);feedView=setupChatColumn(feed,{getProfile:()=>({}),compact:true});}
  feed.hidden=false;feedView.visibility(!state.open&&enabled);
  const entries=rows.map(r=>({...r,from:'eyra',brief:true,identity:r.identity||currentIdentity,role:r.role||r.identity?.role||currentIdentity.role}));
  const next=JSON.stringify([workScope,entries]),structure=entries.map(r=>r.id).join('|');if(next===feedKey)return;
  const old=new Map(structure!==feed.dataset.structure?[...feed.children].map(n=>[n.dataset.id,n.getBoundingClientRect().top]):[]);
  feedKey=next;feed.dataset.structure=structure;feedView.paint(entries,{motion:false});
  if(old.size&&motionAllowed(doc)){for(const a of feedAnimations)a.cancel();feedAnimations=[];for(const node of feed.children){const previous=old.get(node.dataset.id),dy=previous===undefined?10:previous-node.getBoundingClientRect().top;const a=animateUI(node,[{transform:`translateY(${dy}px)`,opacity:previous===undefined?0:1},{transform:'none',opacity:1}],{key:'compact-work'});if(a)feedAnimations.push(a);}}
 };
 const reading=content||doc.getElementById('conversation')||doc.getElementById('chat-scroll')||doc.querySelector('.program-recent'),composer=doc.getElementById('bottom-bar');
 const hadViewport=reading?.classList.contains('chat-viewport');
 reading?.classList.add('layered-chat-content','chat-viewport');composer?.classList.add('layered-chat-composer');
 // Keep changing footer geometry on the reading surface. Writing an inherited
 // property on body invalidates every unrelated tool, rail and observer too.
 const layoutRoots=[reading,doc.getElementById('stage'),veil].filter(Boolean);
 const previousHeights=new Map(layoutRoots.map(node=>[node,node.style.getPropertyValue?.('--layer-input-height')||'']));
 const measure=()=>{const height=composer&&!composer.hidden?composer.getBoundingClientRect().height:0,value=height+'px';for(const node of layoutRoots)if(node.style.getPropertyValue?.('--layer-input-height')!==value)node.style.setProperty('--layer-input-height',value);};
 const observer=new win.ResizeObserver(measure);if(composer)observer.observe(composer);measure();
 const surfaces=[veil,...nodes,fold];for(const node of surfaces)node.classList.add('chat-layer-surface');
 let enabled=true,closed=false,animations=[],savedFocus=null,currentIdentity=identity,animationRun=0,scope='',preferenceVersion=0,unboundChoice=false,pendingMotion=null,relocation=null,hiddenSource=null,presentationFrame=0;const preferences=chatLayerPreferences(preference);
 const transitionState=value=>{mini.dataset.motion=value;body.dataset.chatTransition=value;};transitionState('idle');
 function controls(){body.dataset.chatLayer=enabled?'true':'false';body.dataset.chatExpanded=String(state.open);body.dataset.chatClosing=String(state.closing);mini.hidden=!enabled||state.open;details.hidden=!compactActive;fold.hidden=!enabled;veil.hidden=!enabled;for(const node of surfaces)node.inert=enabled&&!state.open;avatar.setAttribute('aria-expanded',String(state.open));feedView?.visibility(enabled&&!state.open&&compactActive);liveView?.visibility(enabled&&!state.open&&compactActive);}
 function cancelTransition(){win.cancelAnimationFrame(presentationFrame);presentationFrame=0;for(const a of animations)a.cancel();animations=[];relocation?.();relocation=null;if(hiddenSource){hiddenSource.node.style.visibility=hiddenSource.visibility;hiddenSource=null;}}
 function finish(token,run){if(closed||token!==state.transition||run!==animationRun)return;state.settle(token);body.dataset.chatClosing='false';transitionState('idle');cancelTransition();onSettled(token);}
 const fullRing=()=>{
  const candidates=reading?.querySelectorAll?.('.chat-entry.eyra:not(.brief) .role-ring, #eyra-trigger > .role-ring, #eyra-trigger')||[];
  return [...candidates].findLast(n=>n.getBoundingClientRect().width>0&&(!n.checkVisibility||n.checkVisibility({checkVisibilityCSS:true})))||null;
 };
 function playPresented({empty=false}={}){
  const pending=pendingMotion;if(!pending||closed||!enabled||deferMotion&&(body.dataset.frameReady!=='true'||body.dataset.portalPresented!=='true'))return;
  // A composer can become visible before its ResizeObserver is delivered.
  // Resolve its real occupied height before measuring the bottom-aligned row.
  measure();
  // Restore the retained reading position after the real composer reserve is
  // applied, while no relocated avatar can inflate its scroll range yet.
  if(state.open)onBeforeOpen();
  const {token,run,start,source}=pending;if(token!==state.transition||run!==animationRun)return;
  let from=pending.from;
  // A native opening replaces the compact viewport. Its new mini position
  // cannot be measured in the retiring viewport, even if that old rect is
  // nonzero. Measure both endpoints here, after the real viewport is ready.
  // Temporarily laying out the hidden mini is synchronous and never painted.
  if(pending.measureSource){const hidden=mini.hidden;mini.hidden=false;try{from=source.getBoundingClientRect();}finally{mini.hidden=hidden;}}
  const target=state.open?fullRing():ring,to=target?.getBoundingClientRect();
  // Program history is read asynchronously. Keep the one transition until its
  // real retained avatar exists, rather than silently dropping the first entry.
  if(!empty&&state.open&&motionAllowed(doc)&&source&&from?.width&&!to?.width)return;
  pendingMotion=null;transitionState('playing');
  if(motionAllowed(doc)){
   for(let i=0;i<surfaces.length;i++){const a=animateUI(surfaces[i],[{opacity:start[i]},{opacity:state.open?1:0}],{key:'chat-layer',fill:'both'});if(a)animations.push(a);}
   if(source&&from?.width&&to?.width){
    if(source!==target&&source.isConnected){hiddenSource={node:source,visibility:source.style.visibility};source.style.visibility='hidden';}
    relocation=relocateHalo(target,from,to,{motion,duration:420,ringDuration:112});
   }
  }
  const waits=[...animations.map(a=>a.finished),relocation?.finished].filter(Boolean);
  if(waits.length)void Promise.allSettled(waits).then(()=>finish(token,run));else finish(token,run);
 }
 function presented(options={}){
  if(!pendingMotion||closed||!enabled)return;
  pendingMotion.empty=options.empty??pendingMotion.empty??false;
  if(!deferMotion){playPresented(pendingMotion);return;}
  // History callbacks may fire inside the incoming paint, before its editor
  // and profile are applied. Join the next layout once, without a polling loop.
  if(!presentationFrame)presentationFrame=win.requestAnimationFrame(()=>{presentationFrame=0;playPresented(pendingMotion||{});});
 }
 function suspend(){const closing=state.closing;pendingMotion=null;transitionState('idle');animationRun++;cancelTransition();feedView?.visibility(false);liveView?.visibility(false);if(closing){state.settle(state.transition);controls();onSettled(state.transition);}}
 const stopMotion=motion.observeMotion(doc,allowed=>{if(!allowed)suspend();});
 function set(open,{animate=true,token,notify=true,reset=false}={}){
  if(closed)return;const changing=state.open!==!!open,source=changing?(state.open?fullRing():ring):null,from=source?.getBoundingClientRect?.(),measureSource=deferMotion&&source===ring&&!relocation,changed=state.set(open);if(token!==undefined)state.transition=token;
  if(state.open||reset)releaseDrag();
  if(reset){animationRun++;pendingMotion=null;transitionState('idle');cancelTransition();savedFocus=null;state.closing=false;}
  if(!changed){controls();if(reset)onSettled(state.transition);return;}
  if(!state.open&&surfaces.some(n=>n.contains(doc.activeElement)))savedFocus=doc.activeElement;
  // Sample before cancelling so an immediate reversal starts at the visible frame.
  const start=surfaces.map(n=>win.getComputedStyle(n).opacity);
  cancelTransition();controls();
  const own=state.transition,run=++animationRun;
  pendingMotion=animate&&enabled?{token:own,run,start,source,from,measureSource}:null;transitionState(pendingMotion?'waiting':'idle');
  if(notify){preferenceVersion++;if(!scope)unboundChoice=true;preferences.write(scope,state.open);onChange(state.open,own);}
  if(pendingMotion){if(!deferMotion)presented();}else finish(own,run);
  if(state.open&&savedFocus?.isConnected)win.requestAnimationFrame(()=>{if(state.open&&enabled)savedFocus.focus({preventScroll:true});});
  else if(!state.open&&enabled)avatar.focus({preventScroll:true});
 }
 const request=open=>external?onChange(open,state.transition+1):set(open);
 let drag=null,dragFrame=0,suppressClick=false;
 function releaseDrag(){const current=drag;drag=null;win.cancelAnimationFrame(dragFrame);dragFrame=0;delete mini.dataset.dragging;if(current?.position)preferences.move(scope,current.position);if(current&&mini.hasPointerCapture?.(current.id))mini.releasePointerCapture(current.id);}
 const localGeometry=()=>{const r=container===body?{width:win.innerWidth,height:win.innerHeight}:container.getBoundingClientRect(),size=parseFloat(win.getComputedStyle(body).getPropertyValue?.('--eyra-avatar'))||110;return {width:r.width,height:r.height,avatarSize:size,position:preferences.position(scope)};};
 const applyPosition=()=>{const position=preferences.position(scope);if(onMove||!position||closed||drag)return;const geometry=localGeometry(),b=chatLayerBounds(geometry);mini.style.left=b.x+16+'px';mini.style.bottom=geometry.height-b.y-b.height+16+'px';mini.style.top='auto';};
 const moved=()=>{dragFrame=0;if(!drag)return;const dx=(drag.x-drag.startX)/drag.scale,dy=(drag.y-drag.startY)/drag.scale;if(onMove){onMove({dx,dy,done:false});return;}drag.position=chatLayerMovePosition(drag.geometry,dx,dy);preferences.move(scope,drag.position,{save:false});const current=drag;drag=null;applyPosition();drag=current;};
 const down=e=>{if(e.button!==0||state.open||!enabled||e.target.closest?.('.chat-layer-feed, .chat-layer-live'))return;suppressClick=false;drag={id:e.pointerId,startX:e.screenX,startY:e.screenY,x:e.screenX,y:e.screenY,scale:Number(mini.dataset.surfaceScale)||1,geometry:onMove?null:localGeometry(),active:false};};
 const move=e=>{if(!drag||drag.id!==e.pointerId)return;drag.x=e.screenX;drag.y=e.screenY;if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<5)return;if(!drag.active)mini.setPointerCapture?.(e.pointerId);drag.active=true;mini.dataset.dragging='true';e.preventDefault();if(!dragFrame)dragFrame=win.requestAnimationFrame(moved);};
 const up=e=>{if(!drag||drag.id!==e.pointerId)return;const current=drag;if(dragFrame){win.cancelAnimationFrame(dragFrame);moved();}if(current.active){suppressClick=true;if(onMove)onMove({dx:(current.x-current.startX)/current.scale,dy:(current.y-current.startY)/current.scale,done:true});else if(current.position)preferences.move(scope,current.position);}drag=null;delete mini.dataset.dragging;if(mini.hasPointerCapture?.(e.pointerId))mini.releasePointerCapture(e.pointerId);};
 mini.addEventListener('pointerdown',down);mini.addEventListener('pointermove',move);mini.addEventListener('pointerup',up);mini.addEventListener('pointercancel',up);mini.addEventListener('lostpointercapture',up);
 win.addEventListener?.('resize',applyPosition);
 fold.onclick=()=>request(false);avatar.onclick=e=>{if(suppressClick){suppressClick=false;e?.preventDefault();return;}request(true);};
 const escape=e=>{if(enabled&&state.open&&e.key==='Escape'&&!e.defaultPrevented&&!e.isComposing&&!doc.querySelector('dialog[open],#composer-menu:not([hidden]):not([data-state=closing])')){e.preventDefault();request(false);}};
 doc.addEventListener('keydown',escape);
 controls();
 return {set,presented,suspend,scope(id){
  if(!id||scope===id)return;
  releaseDrag();
  const adopt=!scope&&unboundChoice;scope=id;const own=++preferenceVersion;
  mini.style.left='';mini.style.top='';mini.style.bottom='';applyPosition();
  // Initial binding may arrive after a user's click. Preserve and save that
  // choice for this first scope; a real session switch still loads its own state.
  if(adopt){unboundChoice=false;preferences.write(id,state.open);return;}
  set(initialOpen,{animate:false,notify:false,reset:true});
  void preferences.read(id,initialOpen).then(open=>{if(!closed&&own===preferenceVersion&&scope===id){applyPosition();set(open,{animate:false,notify:false,reset:true});}});
 },toggle:()=>request(!state.open),get expanded(){return state.open;},enable(value){enabled=!!value;if(!enabled){releaseDrag();suspend();}controls();},
  get position(){return preferences.position(scope);},move(position,options){preferences.move(scope,position,options);applyPosition();},
  update({identity=currentIdentity,state:phase='idle',label='',active=false,rows=[],liveRows=[],workScope=scope,surfaceScale=1,miniPosition,previewHeight,contentExtra,contentRise}={}){
   if(!active)contentExtra=contentRise=0;
   else if(!Number.isFinite(contentExtra)||!Number.isFinite(contentRise)){const geometry={...localGeometry(),...chatCompactTextMetrics(win.getComputedStyle(body))};({contentExtra,contentRise}=chatCompactPlacement(geometry));}
   currentIdentity=identity;compactActive=!!active;paintRoleRing(ring,identity,compactActive?phase:'idle',doc);if(name.textContent!==identity.name)name.textContent=identity.name;if(status.textContent!==label)status.textContent=label;status.hidden=!compactActive||!label;mini.dataset.active=String(compactActive);mini.dataset.surfaceScale=String(surfaceScale);
   for(const [key,value]of [['--chat-compact-extra',contentExtra],['--chat-compact-rise',contentRise]])if(mini.style.getPropertyValue?.(key)!==value+'px')mini.style.setProperty(key,value+'px');
   if(Number.isFinite(previewHeight))mini.style.setProperty('--chat-brief-preview-height',Math.max(0,previewHeight-16)+'px');if(miniPosition&&!drag){mini.style.left=miniPosition.x+'px';mini.style.bottom=miniPosition.bottom+'px';mini.style.top='auto';}paintFeed(compactActive?rows:[],workScope);paintLive(compactActive?liveRows:[],workScope);controls();avatar.setAttribute('aria-label','展开 '+identity.name+' 的对话');
  },
  close(){closed=true;pendingMotion=null;cancelTransition();stopMotion?.();observer.disconnect();win.removeEventListener?.('resize',applyPosition);win.cancelAnimationFrame(dragFrame);drag=null;for(const a of feedAnimations)a.cancel();feedView?.close();liveView?.close();for(const [node,previous]of previousHeights){if(previous)node.style.setProperty('--layer-input-height',previous);else node.style.removeProperty?.('--layer-input-height');}reading?.classList.remove('layered-chat-content');if(!hadViewport)reading?.classList.remove('chat-viewport');composer?.classList.remove('layered-chat-composer');doc.removeEventListener('keydown',escape);for(const n of surfaces){n.classList.remove('chat-layer-surface');n.inert=false;}veil.remove();fold.remove();mini.remove();delete body.dataset.chatLayer;delete body.dataset.chatExpanded;delete body.dataset.chatClosing;delete body.dataset.chatTransition;}
 };
}
