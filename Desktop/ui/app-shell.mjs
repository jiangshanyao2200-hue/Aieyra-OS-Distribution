import {applyAppearance} from './appearance.mjs';
import {setupMotion} from './motion.mjs';
setupMotion();
// OS 内程序的共同外壳（docs/程序开发协定.md）：字体外观跟随 OS，遮罩由 OS 提供，左侧圆形导航，提示条。
export const app=globalThis.window?.aieyraApp;
export const $=id=>document.getElementById(id);
export function call(payload){return app.invoke(payload).then(r=>{if(r?.ok===false)throw Error(r.error||r.errors?.join('; ')||'操作没有完成');return r;});}
let noticeTimer=0;
export function say(text,error=false){
 const n=$('app-notice');n.textContent=text||'';n.hidden=!text;n.dataset.error=String(!!error);
 clearTimeout(noticeTimer);if(text)noticeTimer=setTimeout(()=>{n.hidden=true;},error?6000:2600);
}
const appearance=value=>{if(value?.settings&&value.fields)applyAppearance(document.body,value.settings,value.fields);};
export function setupShell(){
 void app.invoke({scope:'theme'}).then(appearance).catch(()=>{});
 app.on(event=>{if(event?.type==='theme')appearance(event.theme);});
}
export function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
export function icon(paths){return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;}
// 圆形按钮：左侧导航和页面里的动作都用这一个。
export function orb(label,paths,onClick){
 const b=el('button','orb');b.type='button';b.setAttribute('aria-label',label);
 const face=el('i');face.innerHTML=icon(paths);b.append(face,el('span','',label));b.onclick=onClick;return b;
}
export function setupRail(root,items,pick){
 const nodes=new Map(items.map(item=>[item.id,orb(item.label,item.icon,()=>pick(item.id))]));
 root.replaceChildren(...nodes.values());
 return {select(id){for(const [key,node] of nodes)node.setAttribute('aria-current',key===id?'page':'false');}};
}
