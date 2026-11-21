// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: readScrollFragments; paintScrollFragments; trimScrollFragments; retiring; retainNode; retireNode; setupScrollEdges
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/scroll-edges.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {animateUI,motionAllowed} from './motion.mjs';
// 滚动只读取三个几何量，不逐字测量；遮罩与滚动位置一起移动。
function readScrollFragments(root){
  if(!root||root.isConnected===false||root.ownerDocument?.hidden||root.ownerDocument?.body?.dataset.visible==='false'||root.closest?.('[hidden]'))return null;
  // 不滚动的容器（overflow:visible/clip）没有可淡出的剩余内容；而 mask 会裁掉
  // 边框盒外的一切，最后一行头像外圈描边因此被切平，所以直接不加遮罩。
  const style=getComputedStyle(root);if(style.visibility==='hidden'||style.display==='none')return null;
  const overflow=style.overflowY,scrolls=overflow!=='visible'&&overflow!=='clip';
  let fadeTop=0,fadeBottom=0;
  if(scrolls){
    const height=root.clientHeight;if(height<=0)return null;
    const maximum=Math.max(0,root.scrollHeight-height),top=Math.max(0,Math.min(maximum,root.scrollTop)),fade=Math.min(14,height/5);
    fadeTop=Math.min(fade,top);fadeBottom=Math.min(fade,maximum-top);
  }
  const signature=`${scrolls}:${fadeTop}:${fadeBottom}`;
  return root.dataset.scrollEdges===signature?null:{root,scrolls,signature,fadeTop,fadeBottom};
}
function paintScrollFragments(value){
  if(!value)return;
  const {root,scrolls,signature,fadeTop,fadeBottom}=value;
  root.dataset.scrollEdges=signature;root.classList.add('soft-scroll');root.style.clipPath='';
  root.style.maskImage=root.style.webkitMaskImage=scrolls?'':'none';
  root.style.setProperty('--fade-top',fadeTop+'px');root.style.setProperty('--fade-bottom',fadeBottom+'px');
}
export function trimScrollFragments(root){
  paintScrollFragments(readScrollFragments(root));
}

// 重新出现时取消退场，避免迟到回调移除新状态。
const retiring=new WeakMap();
export function retainNode(node){const animation=retiring.get(node);if(animation){retiring.delete(node);animation.cancel();}node.classList.remove('retiring');}
export function retireNode(node,done=()=>{}){
  if(retiring.has(node))return;
  if(!node.animate||!motionAllowed(node)){node.remove();done();return;}
  node.classList.add('retiring');
  const animation=animateUI(node,[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-6px)'}],{key:'retire',fill:'forwards'});
  retiring.set(node,animation);
  const finish=()=>{if(retiring.get(node)!==animation)return;retiring.delete(node);node.remove();done();};
  animation.finished.then(finish,finish);
}

export function setupScrollEdges(root=document){
  let frame=0;const pending=new Set(),observed=new WeakSet();
  const schedule=node=>{if(!(node instanceof Element))return;pending.add(node);if(!frame)frame=requestAnimationFrame(()=>{
    frame=0;
    // An inner mask write must not flush layout before its outer scroller is
    // measured. Read every pending viewport before committing any edge CSS.
    const values=[...pending].filter(item=>item.isConnected).map(readScrollFragments);pending.clear();
    for(const value of values)paintScrollFragments(value);
  });};
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>entries.forEach(entry=>schedule(entry.target)));
  const selector='.soft-scroll,.plan-phases,.plan-objective,.plan-reason,.transcript-detail,.terminal-reading,.terminal-current,#document-content,#panel-content,#tool-detail,#settings-body,#conversation,#conversation-content,#answer-stage,#live-current,#message,.settings-content,#prompt-editor,#appearance-preview,.glass-select-list,#stage .patch-diff';
  // The fixed work reader owns its inner scrolling and has no edge mask.
  // Its text cannot change an ancestor's scroll extent. Outer size, visibility
  // and scroll events still maintain the surrounding conversation's mask.
  const inWorkReader=node=>!!node?.closest?.('.work-transcript');
  // 内容变化要让每一层匹配的祖先都重测：内层（例如 #conversation-content）不滚动时，真正滚动的是外层 #conversation（Codex A1 发现）。
  const scheduleUp=node=>{if(inWorkReader(node))return;for(let item=node?.closest?.(selector);item;item=item.parentElement?.closest(selector))schedule(item);};
  const inspect=node=>{if(!(node instanceof Element)&&node!==root||inWorkReader(node))return;const found=[...(node.matches?.(selector)?[node]:[]),...node.querySelectorAll(selector)];for(const item of found){if(inWorkReader(item))continue;if(!observed.has(item)){observed.add(item);resize?.observe(item);}schedule(item);}};
  // 新弹窗首次出现、流式内容变长及窗口缩放都在下一帧测量一次。
  // 不扫描字形，也不观察本函数写出的 style/data 属性，避免自触发循环。
  const unobserve=node=>{if(node.nodeType!==1||node.isConnected)return;for(const item of [node,...node.querySelectorAll(selector)]){resize?.unobserve(item);observed.delete(item);pending.delete(item);}};
  const mutations=new MutationObserver(records=>{for(const record of records){if(record.type==='childList'){if(inWorkReader(record.target))continue;for(const node of record.removedNodes)unobserve(node);for(const node of record.addedNodes)if(node.nodeType===1)inspect(node);scheduleUp(record.target);}else if(record.type==='characterData')scheduleUp(record.target.parentElement);else inspect(record.target);}});
  mutations.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','open']});
  inspect(root);
  // 输入框改值不产生 DOM 变动（Codex D1 发现）：input 事件也调度一次。
  const onInput=event=>scheduleUp(event.target);
  root.addEventListener('input',onInput,{capture:true,passive:true});
  const onScroll=event=>{if(!inWorkReader(event.target))schedule(event.target);},onToggle=event=>{if(event.target.open)for(const item of event.target.querySelectorAll('.plan-phases,.transcript-detail'))schedule(item);};
  root.addEventListener('scroll',onScroll,{capture:true,passive:true});
  root.addEventListener('toggle',onToggle,true);
  const onResize=()=>root.querySelectorAll(selector).forEach(schedule);window.addEventListener('resize',onResize,{passive:true});
  return ()=>{mutations.disconnect();resize?.disconnect();if(frame)cancelAnimationFrame(frame);pending.clear();root.removeEventListener('scroll',onScroll,true);root.removeEventListener('input',onInput,true);root.removeEventListener('toggle',onToggle,true);window.removeEventListener('resize',onResize);};
}
