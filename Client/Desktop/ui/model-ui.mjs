// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: icon; ICONS; svg; hoverCard; showModelDetails; hideModelDetails; keyRow; MAX_PARALLEL; openModelPicker; displayModelName
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/model-ui.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {bindDialog} from './interaction.mjs';
// 设置 · 模型的三件共用部件（用户 2026-10-16）：
// 1. 模型悬停卡：价格、介绍、能力，鼠标停在任何模型名上就出现。
// 2. 模型列表弹窗：每行 测试 / 添加·移除；支持全选、多选测试（并行）、全选添加、全选移除；右下角 保存（勾选了还没加入的模型一并加入）。
// 3. Key 行：名称 · 截断的 Key · 启用开关 · 获取模型列表。
import { el } from './pool-ui.mjs';
import {setModelTooltip,showModelTooltip,hideModelTooltip} from './tooltip.mjs';

const icon=d=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);return svg;};
export const ICONS={
 test:'M8 5v14l11-7z',
 add:'M12 5v14M5 12h14',
 remove:'M6 12h12',
 check:'m5 12 5 5 9-10',
 close:'M6 6l12 12M18 6 6 18',
 list:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
 chevron:'m9 6 6 6-6 6',
 search:'M10.5 5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM15 15l4.5 4.5',
 dots:'M6 12h.01M12 12h.01M18 12h.01',
};
export const svg=name=>icon(ICONS[name]);

// Model descriptions share rendering, focus and native-window lifetime with tips.
export const hoverCard=setModelTooltip;
export const showModelDetails=showModelTooltip;
export const hideModelDetails=hideModelTooltip;

// —— Key 行 ——
export function keyRow({id,name,mask,enabled,meta,hint,disabled,onToggle,onFetch,fetching,onRemove,armed}){
 const toggle=el('button',{type:'button',class:'key-switch',role:'switch','aria-checked':String(enabled),'aria-label':(enabled?'禁用 ':'启用 ')+name,title:hint||(enabled?'已启用 · 点一下禁用':'已禁用 · 点一下启用'),disabled,onclick:onToggle},el('span',{class:'key-switch-knob'}));
 return el('div',{class:'key-line',dataset:{enabled:String(enabled),keyId:id||''}},
  el('span',{class:'key-line-name',text:name,title:name}),
  el('code',{class:'key-line-mask',text:mask||'••••'}),
  meta?el('span',{class:'key-line-meta',text:meta}):el('span',{class:'key-line-meta'}),
  toggle,
  el('button',{type:'button',class:'key-line-fetch',disabled:disabled||!enabled||fetching,title:enabled?'获取这把 Key 的模型列表':'启用后才能获取',onclick:onFetch},svg('list'),el('span',{text:fetching?'获取中…':'获取列表'})),
  onRemove?el('button',{type:'button',class:'key-line-x','aria-label':armed?'确认移除 '+name:'移除 '+name,title:armed?'再点一次确认移除':'移除（需点两次）',dataset:{armed:String(!!armed)},disabled,onclick:onRemove},svg('close'),armed?el('span',{text:'确认移除'}):null):null);
}

// —— 模型列表弹窗 ——
// 版式（用户 2026-10-16）：左边一个短搜索框；右边 全选 · 测试 · 添加 · 移除。每行只有名称、测试结果、一个测试、一个添加/移除。
// 不显示上下文（那是用户自己设的预算）。sources：[{id,label,models}]，每个来源一把 Key。
// ctx：{test(source,model)→{ok,errors,elapsed_ms}, add(source,model), remove(source,model), onSave()}
const MAX_PARALLEL=6,PROBE='Reply with one short greeting.';
export function openModelPicker({title,sources,ctx,opener}){
 const host=document.getElementById('onboarding')||document.body;
 const prior=host.querySelector('dialog.model-picker');if(prior){prior.close();prior.remove();}
 const dialog=el('dialog',{class:'model-picker ui-dialog','aria-label':title});
 const state=new Map();// key -> {status:'idle'|'testing'|'ok'|'fail', note, at, busy}
 const selected=new Set(),seen=new Set();
 let query='',closed=false,queue=[],running=0,saving=false,shown=200;
 const rendered=new Map();
 const mutations=new Map();
 const keyOf=(s,m)=>s.id+'\0'+m.id;
 const all=()=>sources.flatMap(s=>s.models.map(m=>({s,m})));
 const visible=()=>all().filter(({m})=>!query||(m.id+' '+m.name).toLowerCase().includes(query));
 const input=el('input',{type:'search',placeholder:'搜索模型','aria-label':'搜索模型',spellcheck:'false',autocomplete:'off',oninput:()=>{query=input.value.trim().toLowerCase();shown=200;paint();}});
 const search=el('label',{class:'picker-search'},svg('search'),input);
 const count=el('span',{class:'picker-count'});
 const tool=(label,iconName,run,extra='')=>el('button',{type:'button',class:'picker-tool'+extra,onclick:run},svg(iconName),el('span',{text:label}));
 const allBtn=tool('全选','check',()=>{const rows=visible(),every=rows.length>0&&rows.every(({s,m})=>selected.has(keyOf(s,m)));rows.forEach(({s,m})=>every?selected.delete(keyOf(s,m)):selected.add(keyOf(s,m)));paint();},' picker-all');
 const testBtn=tool('测试','test',()=>{for(const r of chosen())schedule(r);});
 const addBtn=tool('添加','add',async()=>{for(const r of chosen().filter(r=>!r.m.in_pool))await addOne(r);});
 const removeBtn=tool('移除','remove',async()=>{for(const r of chosen().filter(r=>r.m.in_pool))await removeOne(r);},' picker-danger');
 const list=el('div',{class:'picker-rows',role:'list'});
 const status=el('span',{class:'picker-status',role:'status'});
 const dialogLife=bindDialog(dialog,{opener,canClose:()=>!saving,remove:true,onClose:()=>{closed=true;queue=[];clearInterval(ticker);}});
 const close=()=>{if(closed||saving)return;closed=true;queue=[];clearInterval(ticker);dialogLife.close();};
 // 保存（用户 2026-10-26）：勾选了但还没加入的模型，先加入模型池再保存；有加不进去的，弹窗留着，行内写明原因。
 const save=el('button',{type:'button',class:'picker-save',onclick:async()=>{
  if(saving)return;saving=true;save.disabled=true;save.textContent='正在添加…';paint();
  try{
   await Promise.allSettled([...mutations.values()]);
   const pending=chosen().filter(r=>!r.m.in_pool);
   for(const r of pending)await addOne(r);
   const failed=pending.filter(r=>!r.m.in_pool);
   if(failed.length){say(failed.length+' 个模型没能加入，原因见对应行；其余已加入。可以重试保存，或直接关闭。',true);return;}
   const result=await ctx.onSave?.();
   if(result===false||result?.ok===false){say('保存未完成，请重试；已添加的模型会保留。',true);return;}
   saving=false;close();
  }catch(e){say(e.message,true);}
  finally{saving=false;if(!closed){save.disabled=false;save.textContent='保存';paint();}}
 }},'保存');
 const chosen=()=>all().filter(({s,m})=>selected.has(keyOf(s,m)));
 const say=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
 function schedule(r){
  const k=keyOf(r.s,r.m),st=state.get(k);
  if(st?.status==='testing'||queue.some(q=>keyOf(q.s,q.m)===k))return;
  if(st?.at&&Date.now()-st.at<3000)return;
  if(['image','video'].includes(r.m.kind)){state.set(k,{status:'ok',note:r.m.kind==='video'?'视频模型':'生图模型'});paint();return;}
  if(queue.length>=200)return;
  state.set(k,{status:'testing',note:'排队',queued:true});queue.push(r);pump();paint();
 }
 function pump(){
  while(!closed&&running<MAX_PARALLEL&&queue.length){
   const r=queue.shift(),k=keyOf(r.s,r.m),started=Date.now();running++;state.set(k,{status:'testing',note:'测试中',sent:PROBE,started});
   Promise.resolve().then(()=>ctx.test(r.s,r.m)).then(res=>{const at=Date.now(),sent=res?.prompt||PROBE,elapsed=res?.elapsed_ms||at-started;state.set(k,res?.ok?{status:'ok',at,sent:res.skipped?'':sent,reply:res.reply||'',elapsed,note:res.skipped?'生图模型':elapsed<1000?Math.max(1,Math.round(elapsed))+' 毫秒':(elapsed/1000).toFixed(1)+' 秒'}:{status:'fail',at,sent,elapsed,note:res?.errors?.[0]||'没有回应'});},e=>state.set(k,{status:'fail',at:Date.now(),sent:PROBE,elapsed:Date.now()-started,note:e.message})).finally(()=>{running--;if(!closed){paint();pump();}});
  }
  const testing=[...state.values()].filter(v=>v.status==='testing').length;
  if(testing)say('正在测试 '+testing+' 个模型…');else if(/^正在测试/.test(status.textContent))say('');
 }
 function addOne(r){const key=keyOf(r.s,r.m);if(mutations.has(key))return mutations.get(key);const task=addModel(r).finally(()=>mutations.delete(key));mutations.set(key,task);return task;}
 async function addModel(r){
  const k=keyOf(r.s,r.m),st=state.get(k)||{status:'idle'};if(st.busy||r.m.in_pool)return;
  state.set(k,{...st,busy:true});paint();
  try{await ctx.add(r.s,r.m);r.m.in_pool=true;say('已添加 '+r.m.name);}
  catch(e){state.set(k,{...state.get(k),status:'fail',note:e.message,at:Date.now()});say(r.m.name+'：'+e.message,true);}
  finally{state.set(k,{...state.get(k),busy:false});if(!closed)paint();}
 }
 function removeOne(r){const key=keyOf(r.s,r.m);if(mutations.has(key))return mutations.get(key);const task=removeModel(r).finally(()=>mutations.delete(key));mutations.set(key,task);return task;}
 async function removeModel(r){
  const k=keyOf(r.s,r.m),st=state.get(k)||{status:'idle'};if(st.busy||!r.m.in_pool)return;
  state.set(k,{...st,busy:true});paint();
  try{await ctx.remove(r.s,r.m);r.m.in_pool=false;say('已移除 '+r.m.name);}
  catch(e){say(r.m.name+'：'+e.message,true);}
  finally{state.set(k,{...state.get(k),busy:false});if(!closed)paint();}
 }
 function row({s,m}){
  const k=keyOf(s,m),st=state.get(k)||{status:'idle'},on=selected.has(k);
  const stamp=JSON.stringify([st,on,saving,!!m.in_pool]);
  const cached=rendered.get(k);if(cached?.stamp===stamp)return cached.nodes;
  const check=el('button',{type:'button',class:'picker-check',role:'checkbox',disabled:saving,'aria-checked':String(on),'aria-label':'选择 '+m.name,onclick:()=>{selected.has(k)?selected.delete(k):selected.add(k);paint();}},svg('check'));
  const name=hoverCard(el('span',{class:'picker-name',tabindex:'0',text:m.name}),m);
  const tags=[m.kind==='image'?'生图':m.kind==='video'?'视频':'',m.free?'免费':''].filter(Boolean);
  // 测试过的行：过程（发了什么、回了什么、用时）在下面一行展开，这里只留一个结果小点，不重复用时。
  const result=st.status==='idle'||st.sent
   ?el('span',{class:'picker-tags'},...(st.sent?[el('i',{class:'picker-mark',dataset:{state:st.status},title:st.note||'','aria-label':st.status==='ok'?'可用':st.status==='fail'?'失败':'测试中'})]:tags.map(t=>el('i',{text:t}))))
   :el('span',{class:'picker-result',dataset:{state:st.status},title:st.note||''},st.status==='testing'?el('span',{class:'picker-dots','aria-hidden':'true'},el('i'),el('i'),el('i')):null,el('span',{class:'picker-result-text',text:st.status==='testing'?'':st.note||''}));
  const test=el('button',{type:'button',class:'picker-icon picker-test','aria-label':'测试 '+m.name,disabled:st.status==='testing',onclick:()=>schedule({s,m})},svg('test'),el('span',{text:'测试'}));
  const toggle=el('button',{type:'button',class:'picker-icon picker-toggle','aria-label':(m.in_pool?'移除 ':'添加 ')+m.name,title:m.in_pool?'已在模型池 · 点一下移出':'加入模型池',dataset:{added:String(!!m.in_pool),busy:String(!!st.busy)},disabled:!!st.busy,onclick:()=>m.in_pool?removeOne({s,m}):addOne({s,m})},svg(st.busy?'dots':m.in_pool?'check':'add'));
  const line=el('div',{class:'picker-row',role:'listitem',dataset:{added:String(!!m.in_pool),selected:String(on)}},check,name,sources.length>1?el('span',{class:'picker-source',text:s.label}):null,result,test,toggle);
  // Keep the name, checkbox and action targets stable while a test or selection
  // updates. Native focus and hover must survive asynchronous model replies.
  let stable=line;
  if(cached){
   stable=cached.nodes[0];Object.assign(stable.dataset,line.dataset);
   const oldCheck=stable.querySelector('.picker-check');oldCheck.disabled=saving;oldCheck.setAttribute('aria-checked',String(on));
   for(const cls of ['picker-test','picker-toggle']){
    const old=stable.querySelector('.'+cls),next=line.querySelector('.'+cls);
    for(const attr of next.attributes)old.setAttribute(attr.name,attr.value);
    old.disabled=next.disabled;old.replaceChildren(...next.childNodes);
   }
   stable.querySelector('.picker-tags,.picker-result').replaceWith(result);
  }
  const nodes=st.sent?[stable,testLog(k,st)]:[stable];rendered.set(k,{stamp,nodes});return nodes;
 }
 // 测试过程（用户 2026-10-16）：发出去的那句话、对方回的话、用了多久，都在这一行下面实时显示；等待时秒数一直在走。
 function testLog(k,st){
  const waiting=st.status==='testing',fail=st.status==='fail';
  const seconds=ms=>ms<1000?Math.max(1,Math.round(ms))+' 毫秒':(ms/1000).toFixed(1)+' 秒';
  const time=el('time',{class:'log-time',dataset:waiting?{started:String(st.started)}:{},text:waiting?((Date.now()-st.started)/1000).toFixed(1)+' 秒':seconds(st.elapsed||0)});
  const reply=waiting?el('span',{class:'log-wait'},el('span',{class:'picker-dots','aria-hidden':'true'},el('i'),el('i'),el('i')),el('span',{text:'等待回复'}))
   :el('span',{class:'log-text',text:fail?st.note:st.reply||'（回复为空）'});
  const mark=k+'\0'+st.status,fresh=!seen.has(mark);seen.add(mark);
  return el('div',{class:'picker-log',dataset:{state:st.status,fresh:String(fresh)},role:'group','aria-label':'测试过程'},
   el('p',{class:'log-sent'},el('i',{text:'发'}),el('span',{class:'log-text',text:st.sent})),
   el('p',{class:'log-reply'},el('i',{text:fail?'错':'回'}),reply,time));
 }
 const ticker=setInterval(()=>{for(const t of list.querySelectorAll('time[data-started]'))t.textContent=((Date.now()-Number(t.dataset.started))/1000).toFixed(1)+' 秒';},100);
 function paintTools(){
  const n=chosen().length,rows=visible(),every=rows.length>0&&rows.every(({s,m})=>selected.has(keyOf(s,m)));
  allBtn.setAttribute('aria-pressed',String(every));allBtn.querySelector('span').textContent=every?'取消全选':'全选';
  for(const b of [testBtn,addBtn,removeBtn])b.disabled=saving||!n;
  allBtn.disabled=saving;input.disabled=saving;
  for(const b of dialog.querySelectorAll('.picker-test,.picker-toggle'))if(saving)b.disabled=true;
  const closeButton=dialog.querySelector('.picker-x');if(closeButton)closeButton.disabled=saving;
  count.textContent=n?'已选 '+n+(query?' · '+rows.length+' 个结果':' / '+rows.length):rows.length+' 个模型';
 }
 function paint(){
  const rows=visible(),top=list.scrollTop;
  const nodes=rows.slice(0,shown).flatMap(row);
  if(!rows.length)nodes.push(el('p',{class:'picker-empty',text:all().length?'没有匹配的模型':'这把 Key 暂无可用模型'}));
  if(rows.length>shown)nodes.push(el('button',{type:'button',class:'picker-tool',text:'显示更多（'+Math.min(shown,rows.length)+' / '+rows.length+'）',onclick:()=>{shown+=200;paint();}}));
  const wanted=new Set(nodes);for(const child of [...list.childNodes])if(!wanted.has(child))child.remove();
  let anchor=list.firstChild;for(const node of nodes){if(node===anchor)anchor=anchor.nextSibling;else list.insertBefore(node,anchor);}
  list.scrollTop=top;paintTools();
 }
 dialog.append(
  el('header',{class:'picker-head'},el('h2',{text:title}),count,el('button',{type:'button',class:'picker-x','aria-label':'关闭',onclick:close},svg('close'))),
  el('div',{class:'picker-tools'},search,el('div',{class:'picker-actions'},allBtn,testBtn,addBtn,removeBtn)),
  list,
  el('footer',{class:'picker-foot'},status,save));
 host.append(dialog);dialogLife.show();paint();queueMicrotask(()=>input.focus());
 return {close,refresh:paint};
}

// Formatting is presentation-only: never use this label as a provider model ID.
export function displayModelName(value){
 return String(value||'选择模型').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/([A-Za-z])([0-9])/g,'$1 $2').replace(/([0-9])([A-Za-z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().split(' ').map(word=>/^(gpt|api|llm|vl)$/i.test(word)?word.toUpperCase():/^[a-z]/.test(word)?word[0].toUpperCase()+word.slice(1):word).join(' ');
}
