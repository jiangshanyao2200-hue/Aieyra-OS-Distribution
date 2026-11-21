// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; voiceTabs; frame; acknowledge; sub; subBriefs; paintSub; measuredHeight; layout; action; programOverlay; stopPrepare; decisions; unbind; pendingFrame; stopKeys; stopVisibility; composerMenu; paintFrame; stop
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/folded-overlay.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setFeedback} from './feedback.mjs';
import {setupProgramOverlay,setupProgramWorkOverlay} from './program-agent-overlay.mjs';
import {haloRuntime} from '../../../Halo/runtime/desktop.mjs';
import {setupMotion,animateUI,cancelMotion} from './motion.mjs';
import {configureTooltips} from './tooltip.mjs';
setupMotion();
// 浮层是嵌在窗口里的视图，提示框画在原生小窗里才不会被裁掉。
configureTooltips(document,{native:()=>window.aieyraTips?.call||null});
import {renderMarkdown} from './markdown.mjs';
import {applyResourceTheme,applyAppearanceFrame} from './appearance.mjs';
import {bindEyraGesture} from './eyra-state.mjs';
import {setupComposerKeys} from './composer-keyboard.mjs';
import {mountComposer,composerLayout} from './composer-surface.mjs';
import {mountEyraInstrument,paintInstrument} from './eyra-instrument.mjs';
import {renderAttachmentList,previewWebReference} from './attachments.mjs';
import {bindComposerMenu} from './composer-menu.mjs';
import {createRoleRing,paintRoleRing} from './role-identity.mjs';
import {createThoughtView,clean} from './thought-view.mjs';
import {BriefPacer} from './pacing.mjs';
import {paintVoiceTabs} from './voice-rotation.mjs';
import {createDecisionPanel} from './ask-user.mjs';
if(new URLSearchParams(location.search).get('surface')==='work'){
 setupProgramWorkOverlay(window.foldedEyra);
}else{
mountComposer();mountEyraInstrument();const halo=haloRuntime(document);
const api=window.foldedEyra,$=id=>document.getElementById(id);
// Layout acknowledgement precedes native presentation. A retiring view's old
// visible flag must never authorize an incoming Halo animation.
document.body.dataset.portalPresented='false';
const voiceTabs=document.createElement('div');voiceTabs.id='voice-tabs';voiceTabs.className='voice-tabs';voiceTabs.hidden=true;$('emergence').append(voiceTabs);
let frame={},body='',bodyKind='',wasOpen=false,editing=false,composition=null,editRevision=0,attachmentsKey='',paintedTimer=0,transfer=0;
function acknowledge(revision){
 clearTimeout(paintedTimer);
 if(frame.frame_revision!==revision)return;
 // Native bounds/zoom reach this renderer asynchronously. Wait for that
 // viewport, including the initial zero-height view, before revealing it.
 if(innerWidth<=0||innerHeight<=0||Math.abs(innerWidth-frame.surfaceWidth)>1.5||Math.abs(innerHeight-frame.surfaceHeight)>1.5){paintedTimer=setTimeout(()=>acknowledge(revision),16);return;}
 layout();$('eyra-trigger').getBoundingClientRect();
 document.body.dataset.frameRevision=String(revision);document.body.dataset.frameReady='true';programOverlay.presented();void api.painted(revision);
}
const sub=document.createElement('section'),subMain=document.createElement('div'),subName=document.createElement('header'),subText=document.createElement('div'),subThought=createThoughtView();
sub.id='sub-overlay';sub.hidden=true;subName.className='chat-name';subText.className='chat-text';subMain.className='sub-overlay-main';subMain.append(subName,subText);sub.append(subMain);document.body.append(sub);let subRing=null,subKey='';
const subBriefs=new BriefPacer(text=>{subText.textContent=text;subText.scrollTop=subText.scrollHeight;});let subLater=0;
function paintSub(value){
 clearTimeout(subLater);
 // 工具的 brief 还没读完时，正文和思考等它停够再上来。
 if(value&&!value.thought&&!['tool','waiting'].includes(value.phase)&&subBriefs.dwelling){subLater=setTimeout(()=>paintSub(value),Math.max(60,subBriefs.until-Date.now()));return;}
 sub.hidden=!value;if(!value){subThought.detach();subKey='';return;}
 sub.style.bottom=value.bottom+'px';subName.textContent=value.identity.name;
 if(!subRing){subRing=createRoleRing(value.identity,{state:value.phase});sub.prepend(subRing);}else paintRoleRing(subRing,value.identity,value.phase);
 subText.dataset.textKind=value.thought?'thinking':'body';
 const key=JSON.stringify([value.id,value.text,value.phase]);if(key===subKey)return;subKey=key;
 if(value.thought){if(!subThought.attached)subThought.attach(subText);subThought.update(value.text);}
 else{subThought.detach();if(value.phase==='tool'||value.phase==='waiting')subBriefs.push(value.text||value.title);else{renderMarkdown(subText,value.text);subText.scrollTop=subText.scrollHeight;}}
}
let measuredHeight=0;
function layout(){const height=composerLayout(document,{viewportHeight:frame.viewportHeight,folded:true});if(frame.input&&height>0&&Math.abs(height-measuredHeight)>1){measuredHeight=height;action('layout',String(Math.ceil(height)));}}
function action(action,text){
 if(['input','send'].includes(action))editRevision++;
 return api.action({action,text,edit_revision:editRevision,decision_key:frame.decision?.key||'',task_id:frame.task_id,core_epoch:frame.core_epoch}).then(r=>{if(r?.ok===false&&action!=='reading'){setFeedback($('overlay-error'),r.error);}return r;});
}
const programOverlay=setupProgramOverlay({frame:()=>frame,action,read:(action,p={})=>api.read({...p,action,task_id:frame.task_id,core_epoch:frame.core_epoch})});
const stopPrepare=api.onPrepare?.(({token})=>{
 if(editing)$('message').blur();
 transfer=token;clearTimeout(paintedTimer);document.body.dataset.portalPresented='false';document.body.inert=true;
 const from=getComputedStyle(document.body).opacity,animation=animateUI(document.body,[{opacity:from},{opacity:0}],{kind:'fast',key:'portal-transfer',fill:'both'});
 void Promise.resolve(animation?.finished).catch(()=>{}).then(()=>{if(transfer!==token)return;document.body.dataset.frameReady='false';programOverlay.hidden();void api.prepared(token);});
});
const decisions=createDecisionPanel($('input-dock'),{onAction:(kind,value,key)=>action('decision',JSON.stringify({action:kind,value,key}))});
const unbind=bindEyraGesture($('eyra-trigger'),{input:()=>{
 // Typing can expand the program while the single-click timer is still
 // distinguishing it from a double click. Do not collapse that active editor.
 if(frame.program&&frame.expanded&&document.activeElement===$('message'))return;
 return action(frame.program?'toggle':'home');
},history:()=>action('history')},window);
$('eyra-trigger').oncontextmenu=event=>{event.preventDefault();action('toggle');};
let pendingFrame=null;
$('message').addEventListener('compositionstart',()=>{editing=true;composition={task_id:frame.task_id,core_epoch:frame.core_epoch};action('composition','start');});
$('message').addEventListener('compositionend',()=>{const own=composition;composition=null;editing=false;if(!own||own.task_id!==frame.task_id||own.core_epoch!==frame.core_epoch)return;void action('input',$('message').value).then(()=>{if(own.task_id===frame.task_id&&own.core_epoch===frame.core_epoch)return action('composition','end');}).finally(()=>{if(pendingFrame){const next=pendingFrame;pendingFrame=null;paintFrame(next);}layout();});});
// Persist provisional input too; composition only blocks submission. A native
// page switch must not discard the last text while retiring the old viewport.
$('message').addEventListener('input',()=>{action('input',$('message').value);layout();});
for(const event of ['focus','blur'])$('message').addEventListener(event,layout);
const stopKeys=setupComposerKeys($('message'),{send:()=>action('send',$('message').value),isComposing:()=>editing});
// 执行中的 Esc 交给主窗口记“第一下”（顶部提示与第二下停止都在主窗口，esc-stop.mjs），同时照常收起。
$('message').addEventListener('keydown',event=>{if(frame.layered)return;if(event.key==='Escape'&&!event.repeat&&!document.querySelector('#composer-menu:not([hidden]):not([data-state=closing])')&&!editing&&!event.isComposing&&event.keyCode!==229){event.preventDefault();action($('stop').hidden?'close':'escape');}});
// 输入框已收起、焦点仍在浮层时，第二下 Esc 也要送到主窗口。
document.addEventListener('keydown',event=>{if(frame.layered)return;if(event.key==='Escape'&&!event.repeat&&event.target!==$('message')&&!$('stop').hidden&&!event.isComposing&&event.keyCode!==229&&!document.querySelector('#composer-menu:not([hidden]):not([data-state=closing])')){event.preventDefault();action('escape');}});
const stopVisibility=api.onVisibility(value=>{document.body.hidden=!value.visible;document.body.dataset.visible=String(value.visible);document.body.dataset.portalPresented=String(value.visible);if(!value.visible){transfer=0;cancelMotion(document.body,'portal-transfer');document.body.inert=false;clearTimeout(paintedTimer);document.body.dataset.frameReady='false';programOverlay.hidden();}else{if(transfer){transfer=0;document.body.inert=false;animateUI(document.body,[{opacity:0},{opacity:1}],{kind:'fast',key:'portal-transfer'});}programOverlay.presented();}});
$('send').onclick=()=>{if(!editing)action('send',$('message').value);};
$('stop').onclick=()=>action('stop');
const composerMenu=bindComposerMenu(document,{file:()=>action('attachment'),media:()=>action('attachment_media'),compact:()=>action('compact')},{onToggle:open=>action('menu',open?'open':'')});
function paintFrame(value){
 const changed=frame.task_id!==value.task_id||frame.core_epoch!==value.core_epoch,decisionChanged=(frame.decision?.key||'')!==(value.decision?.key||'');
 if(editing&&(changed||decisionChanged)&&!transfer){pendingFrame=value;return;}
 if(changed||decisionChanged)decisions.captureEditor();
 document.body.hidden=false;
 if(changed){editing=false;composition=null;pendingFrame=null;editRevision=0;$('overlay-error').hidden=true;}frame=value;
 composerMenu.setAvailable('compact',!value.program);
 if(changed||!value.input)composerMenu.close();
 document.body.classList.toggle('reduce-motion',!!value.reduced);document.body.classList.toggle('composer-open',!!value.input);document.body.dataset.input=String(value.input);
 document.body.dataset.ringEffect=value.effect||'pulse';document.body.dataset.compact=String(!!value.compact);document.body.dataset.shortWindow=String(!!value.shortWindow);
 document.body.dataset.thoughtAnimation=value.appearanceTheme?.settings?.thinking_animation||value.thoughtAnimation||'flow';$('voice').dataset.textKind=value.textKind||'body';
 document.body.style.setProperty('--fold-ring',value.ringSize+'px');document.body.style.setProperty('--overlay-input-height',(value.composerHeight||40)+'px');
 for(const [key,v]of Object.entries(value.theme||{}))document.body.style.setProperty(key,v);
 if(value?.appearanceTheme)applyAppearanceFrame(document.body,value.appearanceTheme);else applyResourceTheme(document,value?.themeCss);
 if(value.appearance)document.body.dataset.osAppearance=value.appearance;
 document.body.style.fontFamily=value.fontFamily;document.body.style.fontSize=value.fontSize;
 halo.apply(value.haloSelection);paintInstrument(value.instrument);programOverlay.paint(value,changed);
 document.body.dataset.decisionActive=String(!!value.decision);
 paintSub(value.subconscious);
 $('eyra-trigger').setAttribute('aria-expanded',String(value.input));
 paintVoiceTabs(voiceTabs,value.voices||[],value.voice,{pinned:value.pinned||'',onPick:role=>action('voice',role)});
 const kind=value.textKind==='thinking'?'thinking':'body';
 if(body!==value.body||bodyKind!==kind){
  body=value.body;bodyKind=kind;
  // The small native surface shows a plain current excerpt. Full Markdown
  // and the animated thought view belong to the conversation surface.
  $('voice').textContent=clean(body);$('answer-stage').scrollTop=0;
 }
 document.body.dataset.working=String(!!value.active);
 $('eyra-name').textContent=value.name||value.instrument?.data?.name||'Eyra';$('eyra-work-status').textContent=value.label||'';$('eyra-work-status').hidden=!value.label;
 $('answer-stage').hidden=!value.program&&!body&&!value.label;document.body.dataset.caption=String(!!(body||value.label)&&!value.input);$('composer').hidden=!value.input;$('stop').hidden=!value.active;
 const key=JSON.stringify(value.attachments||[]);
 if(key!==attachmentsKey){attachmentsKey=key;renderAttachmentList($('composer-attachments'),value.attachments||[],a=>action('attachment_remove',a.sha256),{media:!!value.program,thumbnail:value.program?a=>programOverlay.thumbnail(a):undefined,preview:(a,all)=>{if(value.program)return programOverlay.previewAttachment(a,all);action('preview','open');previewWebReference(a,{onClose:()=>action('preview',''),locate:r=>action('reference_reveal',JSON.stringify({id:r.id,tab_id:r.tab_id,frame_id:r.frame_id,navigation:r.navigation}))});}});}
 $('add-attachment').disabled=!!value.attachmentPending||value.program&&(!value.configured||!value.ready);$('send').disabled=!!value.program&&(!value.configured||!value.ready);$('message').disabled=!!value.program&&(!value.configured||!value.ready);
 $('message').readOnly=!!value.decision?.locked;$('message').maxLength=value.decision?.kind==='human'?8000:64000;$('message').placeholder=value.decision?'选择上方选项，或在这里回答…':'在这里输入…';if(value.decision)$('add-attachment').disabled=true;
 // Native sibling views retain document.activeElement after focus moves away.
 // A newer shared revision may update it, while local input/IME stays protected.
 if(changed||decisionChanged||!editing&&(value.edit_revision||0)>=editRevision&&($('message')!==document.activeElement||value.sent||value.program&&(value.edit_revision||0)>editRevision)){
  if($('message').value!==(value.draft||''))$('message').value=value.draft||'';
  editRevision=Math.max(editRevision,value.edit_revision||0);
  // 主输入的选区随草稿一起到浮层，切换表面后仍是用户刚才选中的那段。
  const sel=value.selection,m=$('message');
  if(Array.isArray(sel)&&m!==document.activeElement&&sel[1]<=m.value.length)m.setSelectionRange(sel[0],sel[1],sel[2]||'none');
 }
 layout();decisions.paint(value.decision);
 // Complete layout while the native view is hidden, then acknowledge the exact
 // frame. The host ignores acknowledgements from superseded navigation.
 acknowledge(value.frame_revision);
 if(value.input&&!wasOpen&&(!value.program||value.focusInput))requestAnimationFrame(()=>$('message').focus({preventScroll:true}));wasOpen=value.input;
}
const stop=api.onFrame(paintFrame);
window.addEventListener('beforeunload',()=>{transfer=0;stopPrepare?.();cancelMotion(document.body,'portal-transfer');programOverlay.close();halo.close();clearTimeout(paintedTimer);subThought.detach();stop();unbind();stopKeys();stopVisibility();},{once:true});

}
