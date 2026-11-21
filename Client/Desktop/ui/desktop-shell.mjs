// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: eyraForm; setupDesktopShell
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/desktop-shell.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import * as motion from './motion.mjs';
const {motionAllowed}=motion;
import {workspaceStatus} from './status.mjs';
import {bindEyraGesture} from './eyra-state.mjs';
import {setupEyraFloat} from './eyra-float.mjs';
import {relocateHalo} from '../../../Halo/runtime/transition.mjs';

// 团队仍沿共享聊天与 Eyra 操作区；team 映射为统一 work 形态。
export const eyraForm=({away=false,mode='chat'}={})=>away?'folded':['team','work'].includes(mode)?'work':'chat';

// One original circle, composer and CORE session on every page.
export function setupDesktopShell(navigation,{openLink,openHome,collapseEyra,onDesktopMode,desktopMode,onSessionFocus,openInput,closeInput,restoreInput,openHistory,toggleHistory,openSettings,pendingQuestion,canFold,foldInput,toggleChat,expandChat,nativeEyra,onError},doc=document){
  const $=id=>doc.getElementById(id),win=doc.defaultView;
  const get=(key,fallback)=>{try{return win.sessionStorage.getItem('desktop:'+key)||fallback;}catch{return fallback;}};
  const save=(key,value)=>{try{win.sessionStorage.setItem('desktop:'+key,value);}catch{}};
  const data=(node,key,value)=>{if(node.dataset[key]!==value)node.dataset[key]=value;};
  const hidden=(node,value)=>{if(node.hidden!==value)node.hidden=value;};
  const attr=(node,key,value)=>{if(node.getAttribute(key)!==value)node.setAttribute(key,value);};
  let ringBefore=null,stopRelocation=null,sessionFocus=null;
  const sameChatSurface=(from,to)=>doc.body.dataset.chatLayer==='true'&&['chat','work'].includes(from)&&['chat','work'].includes(to);
  const nativeOwner=()=>!!nativeEyra?.()||doc.body.classList.contains('native-eyra-overlay');
  const motionPreference=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reducedMotion=()=>!motionAllowed(doc);
  const stopRingMotion=()=>{stopRelocation?.();stopRelocation=null;};
  const motionChanged=()=>{if(reducedMotion())stopRingMotion();};
  motionPreference?.addEventListener?.('change',motionChanged);
  doc.addEventListener('workspace-view-before-change',event=>{const ring=$('eyra-trigger');if(ring)ringBefore={rect:ring.getBoundingClientRect(),at:win.performance.now(),native:nativeOwner(),navigation:true,history:navigation.is('panel')||event.detail?.to==='panel'};});
  const restorePage=get('page','home');let compact=false,externalFloat=false,closed=false,previousAway=false,eyraMode='chat';
  function report(error){onError?.(error?.message||'页面暂时无法打开，请重试。');}
  function paint(){
    if(closed)return;
    const away=!!navigation.current;
    // 首页聊天形态里光圈在聊天列末尾；旧的"紧凑"摆放只留给折叠态和（F4 之前的）工作形态。
    // 换形态时光圈先在你看到的位置淡出，再在新位置淡入，而不是一帧瞬移（R4：工作→折叠单帧 +610px）。
    // 旧位置要在任何布局写入之前取：切页时用切页前一刻记下的位置（navigation 先隐藏首页再通知我们）。
    const ring=$('eyra-trigger'),oldForm=doc.body.dataset.form,nextForm=eyraForm({away:away||externalFloat,mode:eyraMode}),changing=!!ring&&!!oldForm&&oldForm!==nextForm,relocating=changing&&!sameChatSurface(oldForm,nextForm);
    const quiet=!!ringBefore?.history;
    const nativeOrigin=ringBefore?.native??nativeOwner();
    const from=relocating?(ringBefore&&win.performance.now()-ringBefore.at<300?ringBefore.rect:ring.getBoundingClientRect()):null;ringBefore=null;
    if(nativeOwner())stopRingMotion();
    if(relocating)doc.dispatchEvent(new win.CustomEvent('workspace-form-before-change',{detail:{from:oldForm,to:nextForm}}));
    data(doc.body,'eyraPlacement',away||externalFloat?'compact':['work','team'].includes(eyraMode)?'work':'chat');
    // 三种形态（docs/UI设计知识库.md 形态 §1）：其他页面是折叠态；首页按 Eyra 是否在干活分聊天与工作。
    data(doc.body,'form',nextForm);
    doc.body.classList.toggle('desktop-away',away);
    hidden($('screen'),false);hidden($('bottom-bar'),false);
    hidden($('os-home'),away);
    if(away&&!previousAway&&canFold?.())foldInput?.();
    if(!away&&previousAway&&!compact&&!externalFloat)restoreInput?.();
    previousAway=away;
    // Home chat/work share one retained reader. Its layout motion owns this
    // handoff; the old page relocation would cancel it and draw a second halo.
    // Only an actual change of surface uses the page relocation below.
    if(relocating){
      // Take the visible origin before cancelling a previous navigation. A rapid
      // return must start there, without composing two ring translations.
      stopRingMotion();
      // 聊天列上一次的位移动画（祖先 FLIP）不能跨形态继续跑（AIDEBUG seq42）：先停掉，再让光圈从看到的位置淡出。
      for(const animation of $('emergence')?.getAnimations?.()||[])animation.cancel();
      // 先同步恢复新形态的聊天布局和滚动位置，再测终点；回首页不能用尚未展开的聊天列定位（seq78）。
      doc.dispatchEvent(new win.CustomEvent('workspace-form-settle',{detail:{form:nextForm}}));
      float.settle();
      const to=ring.getBoundingClientRect(),dx=from.left-to.left,dy=from.top-to.top;
      // 换形态不滑行（脉冲星，用户 2026-10-16 夜）：原地散成光点淡出，光点飞到新位置再聚拢成形，最后放出一圈脉冲。
      // 进入 / 离开工作形态、切到其他页面再回来，都是这一套。
      if(!nativeOrigin&&!nativeOwner()&&from.width&&to.width&&Math.hypot(dx,dy)>2&&ring.animate&&!reducedMotion()){
       // Reflow can put newly settled text under the old ring. In that case
       // appear at the destination; an old-position avatar or particle layer
       // would cover readable content while the new static avatar is visible.
       const obstructed=[...doc.querySelectorAll('#conversation-content .chat-main,#conversation-content .chat-avatar,#conversation-content .role-ring,#answer-stage')].some(node=>{
        if(!node.checkVisibility())return false;const r=node.getBoundingClientRect();
        const halo=from.width*.08;return r.bottom>0&&r.top<win.innerHeight&&from.right+halo>r.left&&from.left-halo<r.right&&from.bottom+halo>r.top&&from.top-halo<r.bottom;
       });
       stopRelocation=relocateHalo(ring,from,to,{motion,obstructed,quiet});
      }
    }
    const page=!away||navigation.is('conversation-view')||navigation.is('group-view')||navigation.is('contacts-module-view')&&sessionFocus?.kind==='group'?'home':['link-view','control-view'].includes(navigation.current)?'link':['onboarding','settings-view'].includes(navigation.current)?'settings':'detail';
    data(doc.body,'desktopPage',page);
    for(const name of ['home','link'])attr($('dock-'+name),'aria-current',page===name?'page':'false');
    attr($('api-bubble'),'aria-current',page==='settings'?'page':'false');
    if(!externalFloat&&page!=='detail')save('page',page);
  }
  const call=fn=>()=>Promise.resolve().then(fn).catch(report);
  $('dock-home').onclick=()=>{if(!navigation.current&&!externalFloat&&toggleChat){toggleChat();return;}navigation.resume();if(externalFloat)call(openHome)();};
  $('dock-home').ondblclick=()=>{navigation.home();if(externalFloat)call(openHome)();};
  $('dock-link').onclick=call(openLink);
  $('api-bubble').onclick=openSettings;
  const float=setupEyraFloat({screen:$('screen'),body:doc.body,storage:win.sessionStorage,win});
  // 折叠态（其他页面）里点光圈统一回首页；首页里点光圈照旧开关输入。
  const folded=()=>doc.body.dataset.form==='folded';
  const goHome=()=>$('dock-home').click();
  const unbind=bindEyraGesture($('eyra-trigger'),{input:()=>folded()?goHome():toggleChat?toggleChat():openInput(),history:()=> (toggleHistory||openHistory)?.(),drag:float.drag},win);
  function escape(event){
    if(event.key==='Escape'&&doc.querySelector('#composer-menu:not([hidden]):not([data-state=closing])'))return;
    // 历史面板打开时 Esc 先交给面板（面板里的搜索框先收起搜索，再收起面板），不越过它去收输入框。
    if(event.key==='Escape'&&$('panel')&&!$('panel').hidden)return;
    if(!toggleChat&&event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing&&event.keyCode!==229&&doc.body.classList.contains('composer-open')){event.preventDefault();event.stopPropagation();closeInput();}
  }
  doc.addEventListener('keydown',escape,true);doc.addEventListener('workspace-view-change',paint);paint();
  const mode=value=>{if(closed)return;externalFloat=value?.mode==='float';paint();};
  const unsubscribe=onDesktopMode?.(mode),stopSessionFocus=onSessionFocus?.(value=>{sessionFocus=value;paint();});
  if(desktopMode)Promise.resolve().then(()=>desktopMode()).then(mode).catch(report);
  return {restorePage,
    // companion 算出下一形态后、写布局前捕获；同形态的流式更新不测几何。
    // AIDEBUG seq49：聊天→工作时 companion 先改了布局，旧位置再取就晚了，首帧跳 −404px。切页时记下的位置优先。
    rememberRing({mode}={}){if(mode!==undefined){const next=eyraForm({away:!!navigation.current||externalFloat,mode}),previous=doc.body.dataset.form;if(next===previous||sameChatSurface(previous,next))return;}const ring=$('eyra-trigger'),now=win.performance.now();if(!ring||ringBefore?.navigation&&now-ringBefore.at<300)return;const rect=ring.getBoundingClientRect();if(rect.width)ringBefore={rect,at:now,native:nativeOwner()};},
    showEyra:()=>{expandChat?.();openInput();},collapseEyra:()=>externalFloat?call(collapseEyra)():toggleChat?.(),
    update(snapshot,disconnected=false,options={}){
      if(closed)return;compact=!!options.compact;eyraMode=['work','team'].includes(options.mode)?options.mode:'chat';
      const status=workspaceStatus(snapshot,disconnected);data($('eyra-trigger'),'sessionId',snapshot?.session_id||'');data($('eyra-trigger'),'phase',status.phase);paint();
    },
    close(){closed=true;stopRingMotion();motionPreference?.removeEventListener?.('change',motionChanged);unsubscribe?.();stopSessionFocus?.();unbind();float.close();doc.removeEventListener('keydown',escape,true);doc.removeEventListener('workspace-view-change',paint);}
  };
}
