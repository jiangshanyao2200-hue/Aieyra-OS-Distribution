// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: app; bindAppServices; $; call; noticeTimer; say; appearance; setupShell; el; icon; orb; setupRail
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/app-shell.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {applyWindowTheme} from './window-theme.mjs';
import {setupMotion} from './motion.mjs';
import {setFeedback} from './feedback.mjs';
import {createNoticeInteraction} from './system-notices.mjs';
setupMotion();
// OS 内程序共用字体、外观、背景与提示条。
export let app=globalThis.window?.aieyraApp;
// Existing package dialogs can live in Settings without an application window.
export function bindAppServices(value){const previous=app;app=value;return ()=>{if(app===value)app=previous;};}
export const $=id=>document.getElementById(id);
export function call(payload){return app.invoke(payload).then(r=>{if(r?.ok===false)throw Error(r.error||r.errors?.join('; ')||'操作没有完成');return r;});}
let noticeTimer=0,noticeVersion=0,noticeInteraction;
export function say(text,error=false){
 if(app?.notice){app.notice(text,error);return;}
 const n=$('app-notice'),version=++noticeVersion;
 noticeInteraction??=createNoticeInteraction(n);
 clearTimeout(noticeTimer);
 noticeInteraction.defer(()=>{
  if(version!==noticeVersion)return;
  setFeedback(n,text);n.dataset.error=String(!!error);
  if(text)noticeTimer=setTimeout(()=>noticeInteraction.defer(()=>{if(version===noticeVersion)n.hidden=true;},'hide'),error?6000:2600);
 },'text');
}
const appearance=value=>applyWindowTheme(document.body,value);
export function setupShell(){
 let changed=false;
 const stop=app.on(event=>{if(event?.type==='theme'){changed=true;appearance(event.theme);}});
 void app.invoke({scope:'theme'}).then(value=>{if(!changed)appearance(value);}).catch(()=>{});
 window.addEventListener('pagehide',()=>stop?.(),{once:true});
}
export function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
export function icon(paths){return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;}
// 圆形按钮：左侧导航和页面里的动作都用这一个。
export function orb(label,paths,onClick){
 const b=el('button','orb');b.type='button';b.setAttribute('aria-label',label);
 const face=el('i');face.innerHTML=icon(paths);b.append(face,el('span','',label));b.onclick=onClick;return b;
}
export function setupRail(root,items,pick){
 const nodes=new Map(items.map(item=>{const button=orb(item.label,item.icon,()=>pick(item.id));button.className='ui-rail-button';button.querySelector('i').className='ui-rail-icon';button.querySelector('span').className='ui-rail-label';return [item.id,button];}));
 root.replaceChildren(...nodes.values());
 return {setVisible(id,visible){const node=nodes.get(id);if(node)node.hidden=!visible;},select(id){for(const [key,node] of nodes)node.setAttribute('aria-current',key===id?'page':'false');}};
}
