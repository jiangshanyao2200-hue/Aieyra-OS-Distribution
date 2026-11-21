// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TARGETS; messageText; bling; bindDoubleClickCopy; clipboardWriter
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/copy-gesture.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 双击消息文字即复制这一整条到剪贴板（用户 2026-10-24）：不弹提示、不加按钮，
// 只让这段文字“卜灵卜灵”亮两下。双击不再选词，避免一闪的蓝色选区。
import {motionAllowed} from './motion.mjs';

const TARGETS='.chat-entry .chat-text, .hx-message .chat-text, #voice, .notice-text, .system-content';

function messageText(node){
 // A notice keeps its full text (with details) on its copy handle; others copy what they show.
 const holder=node.matches('.notice-text')?(node.closest('.ui-feedback')||node.parentElement):node.matches('.system-content')?node.closest('details,.system-item,[data-notice-id]'):null;
 const full=holder?.querySelector?.('.notice-copy')?._copyText?.();
 return String(full??node.innerText??node.textContent??'').trim();
}

export function bling(node){
 if(!node?.animate)return;
 if(!motionAllowed(node)){node.animate([{opacity:1},{opacity:.65},{opacity:1}],{duration:260,easing:'ease-in-out'});return;}
 const glow='brightness(1.45) drop-shadow(0 0 6px rgba(200,215,255,.55))',soft='brightness(1.25) drop-shadow(0 0 4px rgba(200,215,255,.4))';
 node.animate([{filter:'none'},{filter:glow,offset:.18},{filter:'none',offset:.42},{filter:soft,offset:.62},{filter:'none'}],{duration:620,easing:'cubic-bezier(.4,0,.2,1)'});
}

export function bindDoubleClickCopy(doc,{copy}){
 const target=event=>event.target?.closest?.(TARGETS);
 doc.addEventListener('mousedown',event=>{if(event.detail===2&&event.button===0&&target(event))event.preventDefault();},true);
 doc.addEventListener('dblclick',async event=>{
  const node=target(event);if(!node||event.button!==0)return;
  const text=messageText(node);if(!text)return;
  event.preventDefault();doc.getSelection?.()?.removeAllRanges?.();
  try{await copy(text);bling(node);}catch{}
 });
}

// Prefer the host clipboard (works without page focus); fall back to the web API.
export function clipboardWriter(api){
 return async text=>{
  if(api?.copyText){const result=await api.copyText({text});if(result?.ok!==false)return;}
  await navigator.clipboard.writeText(text);
 };
}
