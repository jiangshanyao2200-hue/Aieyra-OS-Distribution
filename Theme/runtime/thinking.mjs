// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: HEADING; MAX_TAIL; thoughtSections; clean; thoughtFrame; createThoughtView
// Impact: python -B scripts/code-atlas.py show Theme/runtime/thinking.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindThemeRenderer} from './layout.mjs';
// 思维的涌现（用户 2026-10-13：思考的显示和动画是“最大的问题”；UI设计知识库 形态 §15.11 T2 的涌现只做在折叠态，聊天和工作形态没有落地）。
// 光圈旁两层：上面是这一段思考的小标题（模型思考里的粗体标题），下面是最新的一两行思考。
// - 新来的字成串从微光和模糊里浮现（只动 opacity / filter / transform），旧行被平滑推上去，在顶部淡出；
// - 换到新的一段时，旧标题向上滑走，新标题从下方升起（与“换一行字”同一种动效）；
// - 不显示 Markdown 记号或编造标题；没有标题时仅显示实际思考正文，状态归姓名右侧。
// 其他页面也用这一套。

const HEADING=/^\s*(?:\*\*([^*\n]{1,80})\*\*|#{1,6}\s+(.{1,80}))\s*$/u;
const MAX_TAIL=420;

// 纯函数：把思考切成段（以粗体标题行或 Markdown 标题行分段），去掉记号，换行并成空格。
export function thoughtSections(text){
 const sections=[];let current={title:'',lines:[]};
 for(const line of String(text||'').split(/\r?\n/u)){
  const m=HEADING.exec(line);
  if(m){if(current.title||current.lines.some(l=>l.trim()))sections.push(current);current={title:(m[1]||m[2]).trim(),lines:[]};continue;}
  current.lines.push(line);
 }
 sections.push(current);
 return sections.map(s=>({title:clean(s.title),text:clean(s.lines.join(' '))})).filter((s,i,all)=>s.title||s.text||i===all.length-1);
}
export function clean(text){
 return String(text||'')
  .replace(/`{1,3}/g,'').replace(/\*\*|__/g,'').replace(/(^|\s)[*_](\S)/g,'$1$2').replace(/(\S)[*_](?=\s|$)/g,'$1')
  .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)/gmu,'').replace(/\s+/g,' ').trim();
}
// 纯函数：当前该显示的标题和正文尾巴（正文只留最后一段，最多 MAX_TAIL 个字，从句子或词的开头截）。
export function thoughtFrame(text){
 const sections=thoughtSections(text),last=sections.at(-1)||{title:'',text:''};
 const title=last.title||[...sections].reverse().find(s=>s.title)?.title||'';
 let body=last.text;const chars=Array.from(body);
 if(chars.length>MAX_TAIL){
  let tail=chars.slice(-MAX_TAIL).join('');
  const cut=tail.search(/[。！？；.!?;]\s*/u);if(cut>=0&&cut<120)tail=tail.slice(cut+1).trimStart();
  body=tail;
 }
 return {title,body,index:sections.length-1};
}

export function createThoughtView({doc=document,reduced=()=>false,motion={allowed:()=>false,duration:()=>0}}={}){
 const motionAllowed=motion.allowed,motionDuration=motion.duration;let releaseTheme=null;
 const mode=()=>root?.closest?.('[data-thought-animation]')?.dataset?.thoughtAnimation||doc.body?.dataset?.thoughtAnimation;
 const reducedByHost=reduced;reduced=()=>reducedByHost()||mode()==='none'||!motionAllowed(doc);
 let root=null,titleBox=null,flow=null,text=null,shownTitle=null,shownBody='',section=-1,frame=0,queued='';
 const make=(cls,tag='div')=>{const n=doc.createElement(tag);n.className=cls;return n;};
 function attach(node){
  releaseTheme?.();releaseTheme=null;
  shownTitle=null;shownBody='';section=-1;queued='';(doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView)||globalThis.cancelAnimationFrame||(()=>{}))(frame);frame=0;
  root=make('thought-view');titleBox=make('tv-titles');flow=make('tv-flow');text=make('tv-text');
  flow.append(text);root.append(titleBox,flow);node.replaceChildren(root);
  releaseTheme=bindThemeRenderer(root,'aieyra.content.thinking/1',{heading:titleBox,content:flow});
 }
 function setTitle(title){
  if(title===shownTitle)return;shownTitle=title;
  titleBox.hidden=!title;
  if(!title){titleBox.replaceChildren();return;}
  const next=make('tv-title','span');next.textContent=title;
  const old=[...titleBox.children];
  if(reduced()||!motionAllowed(doc)||!old.length){titleBox.replaceChildren(next);return;}
  for(const o of old){o.classList.add('out');o.addEventListener('animationend',()=>o.remove(),{once:true});setTimeout(()=>o.remove(),motionDuration(doc)+40);}
  next.classList.add('in');titleBox.append(next);
 }
 // 文字增长后整块从原来的位置滑到新位置（FLIP），而不是一帧跳上去。
 function slide(before){
  if(reduced()||mode()==='fade'||!text.animate||!motionAllowed(doc))return;
  const after=text.offsetHeight,delta=after-before;
  // 叠加（composite:add）：上一行还在滑时下一行接着滑，不会从头跳一下。
  if(delta>1)text.animate([{transform:'translateY('+delta+'px)'},{transform:'translateY(0)'}],{duration:Math.max(160,motionDuration(doc)),easing:'cubic-bezier(.2,.8,.2,1)',composite:'add'});
 }
 function setBody(body,fresh){
  if(body===shownBody&&!fresh)return;
  const before=text.offsetHeight;
  if(fresh||!body.startsWith(shownBody)){
   // 新的一段：旧文字很快淡掉，新文字整体浮现。
   queued='';(doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView)||globalThis.cancelAnimationFrame||(()=>{}))(frame);frame=0;
   text.replaceChildren();
   if(body){const span=make(reduced()?'':'tv-new','span');span.textContent=body;text.append(span);}
   shownBody=body;return;
  }
  const added=body.slice(shownBody.length);shownBody=body;
  if(!added)return;
  if(reduced()){text.append(doc.createTextNode(added));trim();slide(before);return;}
  // 网络分片是一阵一阵到的；按帧匀速放出（积压越多每帧放得越多，约 10 帧追平），读起来是连续流动而不是一块块跳出。
  queued+=added;
  if(!frame)frame=raf(pump);
 }
 // 没有逐帧回调的环境（测试替身、后台）直接放出。
 function raf(fn){const r=doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView)||globalThis.requestAnimationFrame;if(r)return r(fn);fn();return 0;}
 function pump(){
  frame=0;
  if(!text?.isConnected||!queued){queued='';return;}
  const chars=Array.from(queued),count=reduced()?chars.length:Math.max(1,Math.ceil(chars.length/10));
  const before=text.offsetHeight;
  const added=chars.slice(0,count).join('');
  if(reduced())text.append(doc.createTextNode(added));
  else{const span=make('tv-new','span');span.textContent=added;text.append(span);span.addEventListener?.('animationend',()=>{if(span.parentNode){span.replaceWith(doc.createTextNode(span.textContent));text?.normalize();}},{once:true});}
  queued=chars.slice(count).join('');
  if((text.childNodes?.length||0)>24)text.normalize();
  trim();slide(before);
  if(queued)frame=raf(pump);
 }
 function trim(){
  // 只保留看得见的尾巴：太长时把最前面的文字去掉。
  const total=Array.from(text.textContent);
  if(total.length>MAX_TAIL*1.5){
   let drop=total.length-MAX_TAIL;
   while(drop>0&&text.firstChild){const n=text.firstChild,len=Array.from(n.textContent).length;if(len<=drop){n.remove();drop-=len;}else{n.textContent=Array.from(n.textContent).slice(drop).join('');drop=0;}}
  }
 }
 return {
  attach,
  get attached(){return !!root?.isConnected;},
  update(thought){
   if(!root?.isConnected)return;
   const f=thoughtFrame(thought),fresh=f.index!==section;section=f.index;
   setTitle(f.title);setBody(f.body,fresh&&shownBody!=='');
  },
  detach(){releaseTheme?.();releaseTheme=null;root=null;titleBox=null;flow=null;text=null;shownTitle=null;shownBody='';section=-1;queued='';(doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView)||globalThis.cancelAnimationFrame||(()=>{}))(frame);frame=0;},
 };
}
