// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: OVERLAY_TAIL; OVERLAY_PAGES; nativePage; overlayTail; setupFoldedSurface
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/folded-surface.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {readViewportScale} from './chat-layout.mjs';
// Native portal data comes from the existing companion and composer only.
import {instrumentFrame} from './eyra-instrument.mjs';
import {roleIdentity} from './role-identity.mjs';
import {ChatLayerState,chatLayerBounds,chatLayerMovePosition,chatBriefPreviewHeight,chatCompactTextMetrics,chatCompactPlacement} from './layered-chat.mjs';
import {presenceRingSize} from './eyra-presence-geometry.mjs';
// 浮层只放得下光圈高度的内容，送末尾一段就够；完整内容在首页。
const OVERLAY_TAIL=1600;
// 这些页面在主窗口画不了光圈：设置、指挥中心、阅读页一直用浮层；模块页和浏览器工作时才用，平时是原生小光圈。
const OVERLAY_PAGES=['settings-view','control-view','document-viewer'];
const nativePage=view=>view==='browser-view'||/-module-view$/.test(view||'');
const overlayTail=text=>{const s=String(text||'');return s.length>OVERLAY_TAIL?s.slice(-OVERLAY_TAIL):s;};
export function setupFoldedSurface(api,{navigation,companion,decisions,programs,snapshot,toggle,history,send,resend,stop,escape,attachments,attach,compact,home,onError},doc=document){
 const $=id=>doc.getElementById(id);let avatarSent=null,codeShown='',codeAt=0;let liveText='',liveAt=0,liveTimer=0;let signature='',closed=false,sent=false,ready=false,revision=0,editRevision=0,menuOpen=false,quick=false,quickSize=null,quickHeight=72,previewOpen=false;
 let appearanceKey='',appearanceValue=null,overlayKey='',homePortal=false,ownsPresence=false,prepared=false,unavailable=false,homeGeometry=null,dragOrigin=null;const homeLayer=new ChatLayerState(true);
 function appearance(){
  // Theme variables and typography change with appearance/form/viewport, not
  // every instrument frame. Ignore the overlay's own acknowledgement class.
  const key=JSON.stringify([doc.documentElement.getAttribute('style'),doc.documentElement.className,doc.body.getAttribute('style'),doc.body.className.replace(/\bnative-eyra-overlay\b/g,'').trim(),doc.body.dataset.form,doc.body.dataset.osAppearance,innerWidth,innerHeight]);
  if(key===appearanceKey&&appearanceValue)return appearanceValue;
  const style=getComputedStyle(doc.body),theme={};
  for(const source of [doc.documentElement.style,doc.body.style])for(const name of source)if(/^--(?:os-|eyra-|chat-|text|glass)/.test(name))theme[name]=style.getPropertyValue(name);
  appearanceKey=key;appearanceValue={theme,ringSize:parseFloat(style.getPropertyValue('--eyra-ring-size'))||104,fontFamily:style.fontFamily,fontSize:style.fontSize};return appearanceValue;
 }
 const stopQuick=api.onQuickInput?.(value=>{quick=value.open===true;quickSize=quick?value:null;signature='';paint();});
 const stopReady=api.onFoldedReady?.(value=>{revision++;ready=value.ready===true;if(ready){prepared=true;unavailable=false;}else if(value.reason==='unavailable'){prepared=false;unavailable=true;}signature='';avatarSent=null;paint();});
 const handoff=()=>doc.body.classList.toggle('native-eyra-overlay',ownsPresence&&!unavailable&&(ready||prepared));
 const unsubscribe=api.onFoldedAction?.(async value=>{
  const next=snapshot();if(closed||value.task_id!==next?.session_id||value.core_epoch!==next?.core_epoch)return;
  try{
  if(value.action==='decision'){const p=JSON.parse(value.text);await decisions?.action(p.action,p.value,p.key);paint();return;}
  if(['input','send','composition'].includes(value.action)&&(value.decision_key||'')!==(decisions?.frame?.key||''))return;
  if(value.action==='composition'){decisions?.composition(value.text==='start');return;}
  if(value.action==='reading'){
   if(!homePortal||!companion.acceptPortalReading?.(JSON.parse(value.text)))return;
   signature='';paint();return;
  }
  if(['input','send'].includes(value.action)){editRevision=value.edit_revision||0;$('message').value=value.text||'';$('message').dispatchEvent(new Event('input',{bubbles:true}));}
  if(value.action==='home'){quick=false;(home||(()=>doc.getElementById('dock-home')?.click()))();}
  else if(value.action==='toggle'){if(homePortal)companion.toggleChat();else{quick=!quick;quickSize=null;}}
  else if(value.action==='layer_settled'){homeLayer.settle(value.text);}
  else if(value.action==='move'&&homePortal&&!homeLayer.full&&homeGeometry){const move=JSON.parse(value.text||'{}');if(![move.dx,move.dy].every(Number.isFinite)||typeof move.done!=='boolean'||Math.abs(move.dx)>20000||Math.abs(move.dy)>20000)return;dragOrigin??={...homeGeometry};companion.moveChat?.(chatLayerMovePosition(dragOrigin,move.dx,move.dy),{save:move.done});if(move.done)dragOrigin=null;}
  else if(value.action==='preview'){previewOpen=value.text==='open';}
  else if(value.action==='layout'){quickHeight=Math.max(48,Math.min(340,Number(value.text)||72));}
  else if(value.action==='history')history();
  else if(value.action==='voice')companion.pinVoice?.(value.text);
  else if(value.action==='close'){quick=false;if(homePortal){if(companion.chatExpanded)companion.toggleChat();}else toggle(false,false);}
  else if(value.action==='stop')stop();
  else if(value.action==='escape'){quick=false;toggle(false,false);escape?.();}
  else if(value.action==='attachment')attach?.('file');
  else if(value.action==='attachment_media')attach?.('media');
  else if(value.action==='compact')compact?.();
  else if(value.action==='menu')menuOpen=value.text==='open';
  else if(value.action==='reference_reveal'){const a=attachments?.values().find(a=>a.sha256===value.text);if(a?.web_reference){const result=await api.browserReference({action:'reveal',reference:a.web_reference});if(result?.ok===false)throw Error(result.error);}}
  else if(value.action==='attachment_remove')attachments?.remove(value.text);
  else if(value.action==='send'){await send();sent=$('message').value==='';}
  else if(value.action==='resend'){const p=JSON.parse(value.text);if(typeof p.text!=='string'||typeof p.request_id!=='string')throw Error('编辑消息格式无效');await resend?.(p.text,p.request_id);}
  paint();}catch(error){onError?.(error.message);}
 });
 function paint(){
  if(closed||!api.foldedSurface)return;
  const programPage=programs?.ownsPage(),nextHomePortal=!programPage&&!navigation.current&&!!companion.nativeBackground;
  // Capture while the DOM is still visible, then release its renderer without
  // releasing the journal or the reader's anchor. Restore after clearing CSS.
  if(nextHomePortal&&!homePortal)companion.nativeChatVisibility?.(true);
  doc.body.dataset.homeNativeChat=String(nextHomePortal);
  if(!nextHomePortal&&homePortal)companion.nativeChatVisibility?.(false);
  homePortal=nextHomePortal;
  if(programPage){
   // Program surfaces replace the mother's folded presence, including while
   // their first snapshot is loading. Retire any late mother acknowledgement.
   revision++;signature='';ownsPresence=true;doc.body.classList.add('native-eyra-overlay');programs.paint();return;
  }
  const reading=navigation.current==='document-viewer'&&$('document-viewer')?.dataset.kind==='usage';
  const working=nativePage(navigation.current)&&!!companion.overlayState?.active,visible=!reading&&!doc.querySelector('dialog:modal')&&(homePortal||quick||working||OVERLAY_PAGES.includes(navigation.current)),next=snapshot();
  // Ownership is known before native paint acknowledgement. The page shell
  // must not start a legacy burst while this same presence is being hosted.
  ownsPresence=visible&&!!next&&!unavailable;
  // A previously painted native renderer can reclaim its slot synchronously.
  // Cold load keeps the page fallback until the first real paint; failure
  // retires that capability rather than re-hiding the fallback next frame.
  handoff();
  // 头像是 data URL，只在变化时发；浮层不显示时光圈字符一秒一变就够其他窗口用。之前每次刷新都序列化并发送，工作时持续写几 MB/s。
  const visual=appearance(),instrument=instrumentFrame(doc),avatarNow=instrument.avatar,reduced=doc.body.classList.contains('reduce-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches;
  delete instrument.avatar;
  if(!visible){const at=Date.now();if(at-codeAt<1000)instrument.code=codeShown;else{codeShown=instrument.code;codeAt=at;}}
  const summary=companion.overlayState;
  const publicPresence={summary:{name:summary.name,label:summary.label,body:summary.active?overlayTail(summary.body):'',kind:summary.kind},instrument,ringSize:visual.ringSize,effect:companion.profile.roles?.matrix?.ring||'pulse',reduced};
  let payload={visible:false};
  if(visible&&next){
   const viewportWidth=quickSize?.width||innerWidth,viewportHeight=(quickSize?.height||innerHeight)-Math.max(0,Number(quickSize?.bottomInset)||0);
   const state=companion.overlayState,compact=viewportHeight<=560,ringSize=presenceRingSize(viewportHeight,visual.ringSize);
   // 内页显示光圈和实时的思考、正文；完整回复、思考历史与输入仍属于首页。最多每 240ms 刷新一次。
   const wanted=state.active?overlayTail(state.body):'',now=Date.now(),tabRoom=(state.voices||[]).length>1?28:0;
   if(wanted!==liveText){if(!wanted||now-liveAt>=240){liveText=wanted;liveAt=now;}else if(!liveTimer)liveTimer=setTimeout(()=>{liveTimer=0;paint();},240-(now-liveAt));}
   const input=quick,body=input?'':liveText,label=input?'':state.label||'',composerHeight=input?quickHeight:0;
   const subconscious=null,subBottom=Math.max(ringSize+28,input?composerHeight+28+(body?ringSize+12:0):0);
   // Keep the ring anchored at the same screen coordinate when the native view
   // grows. The composer lives beside it; only the text may rise above input.
   // An open + menu stacks three 36px items above the input.
   const menuRoom=input&&menuOpen?3*44+12:0;
   const height=Math.min(viewportHeight-64,Math.max(previewOpen?Math.min(620,viewportHeight-80):0,ringSize+32+tabRoom,input?composerHeight+44+Math.max(menuRoom,ringSize):0,subconscious?subBottom+ringSize+16:0)),width=input||subconscious?Math.min(560,viewportWidth-32):body||label?Math.min(ringSize+32+400,viewportWidth-32):ringSize+32;
   payload={visible:true,quick,bounds:{x:16+(parseFloat(doc.body.style.getPropertyValue('--sd-push'))||0),y:Math.max(56,viewportHeight-height-16),width,height},content:{task_id:next.session_id,core_epoch:next.core_epoch,instrument,ringSize,compact:true,shortWindow:compact,effect:companion.profile.roles?.matrix?.ring||'pulse',body,name:state.name,label,textKind:state.kind,voices:state.voices||[],voice:state.voice,pinned:state.pinned||'',thoughtAnimation:doc.body.dataset.thoughtAnimation,subconscious:subconscious?{...subconscious,identity:roleIdentity(companion.profile,'subconscious'),bottom:subBottom}:null,input,active:state.active,draft:$('message').value,selection:[$('message').selectionStart,$('message').selectionEnd,$('message').selectionDirection],sent,edit_revision:editRevision,composerHeight,viewportHeight,attachments:attachments?.values().map(a=>({name:a.name,bytes:a.bytes,sha256:a.sha256,kind:a.kind,label:a.label,web_reference:a.web_reference}))||[],attachmentPending:attachments?.pending===true,theme:visual.theme,themeCss:doc.getElementById('aieyra-resource-theme')?.textContent||'',appearance:doc.body.dataset.osAppearance,fontFamily:visual.fontFamily,fontSize:visual.fontSize,reduced}};
  }
  if(homePortal&&next&&payload.visible){
   homeLayer.set(companion.chatExpanded);
   const left=parseFloat(doc.body.style.getPropertyValue('--workspace-inset'))||0,top=doc.getElementById('status-anchor')?.getBoundingClientRect?.().bottom||48;
   const compactStyle=getComputedStyle(doc.body);
   homeGeometry={width:innerWidth,height:innerHeight,left,top,...chatCompactTextMetrics(compactStyle),position:companion.chatPosition,previewHeight:chatBriefPreviewHeight(compactStyle,companion.compactRows?.length),details:!!summary.active};
   payload.bounds=chatLayerBounds({...homeGeometry,full:homeLayer.full});
   const placement=chatCompactPlacement(homeGeometry),compact=placement.anchor,bounds=payload.bounds;
   Object.assign(payload.content,{compact_rows:companion.compactRows||[],compact_live:companion.compactLive||[],content_extra:placement.contentExtra,content_rise:placement.contentRise,preview_height:placement.previewHeight,mini_position:{x:compact.x-bounds.x+16,bottom:bounds.y+bounds.height-(compact.y+compact.height)+16}});
   payload.takesPresence=true;
   Object.assign(payload.content,{program:'home',layout:{width:innerWidth-left,scale:readViewportScale(document.body)},layered:true,layer_transition:homeLayer.transition,layer_closing:homeLayer.closing,expanded:homeLayer.open,input:homeLayer.full,configured:true,ready:true,focusInput:false,profile:companion.profile,identity:roleIdentity(companion.viewProfile||companion.profile,'matrix'),messages:companion.chatEntries||[],home_reading:companion.portalReading,plan:companion.currentPlan,documents:next.documents||[],body:'',label:summary.label,composerHeight:quickHeight,description:'',receipts:[]});
  }
  if(payload.content)payload.content.decision=decisions?.frame||null;
  const editorOverlay={visible:payload.visible,bounds:payload.bounds},editorKey=JSON.stringify(editorOverlay);if(editorKey!==overlayKey){overlayKey=editorKey;doc.dispatchEvent(new CustomEvent('workspace-overlay-bounds',{detail:editorOverlay}));}
  payload.presence=publicPresence;payload.takesPresence=reading||payload.visible===true;
  const key=JSON.stringify(payload);if(key===signature&&avatarNow===avatarSent)return;signature=key;sent=false;
  if(avatarNow!==avatarSent){instrument.avatar=avatarNow;avatarSent=avatarNow;}
  const request=++revision;
  void api.foldedSurface(payload).then(result=>{if(closed||request!==revision)return;if(result?.ok===false)throw Error(result.error||'Eyra上层未能显示');ready=result.ready===true;unavailable=result.unavailable===true;if(ready)prepared=true;if(unavailable){prepared=false;ownsPresence=false;}handoff();}).catch(error=>{if(closed||request!==revision)return;signature='';ready=false;prepared=false;unavailable=true;ownsPresence=false;doc.body.classList.remove('native-eyra-overlay');onError?.(error.message);});
 }
 const changed=event=>{if(event?.type==='workspace-view-change'){quick=false;quickSize=null;dragOrigin=null;}signature='';paint();};doc.addEventListener('workspace-chat-layer-change',changed);doc.addEventListener('workspace-view-change',changed);doc.addEventListener('workspace-modal-change',changed);doc.addEventListener('workspace-theme-change',changed);doc.defaultView.addEventListener('resize',changed);
 return {paint,get ownsPresence(){return ownsPresence;},close(){closed=true;ownsPresence=false;doc.body.dataset.homeNativeChat='false';companion.nativeChatVisibility?.(false);clearTimeout(liveTimer);stopQuick?.();unsubscribe?.();stopReady?.();doc.removeEventListener('workspace-chat-layer-change',changed);doc.removeEventListener('workspace-view-change',changed);doc.removeEventListener('workspace-modal-change',changed);doc.removeEventListener('workspace-theme-change',changed);doc.defaultView.removeEventListener('resize',changed);void api.foldedSurface?.({visible:false});}};
}
