// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ICON; stamp; highlight; createHistorySearch
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/history-search.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';
import {roleIdentity} from './role-identity.mjs';

// 历史搜索（右上角放大镜）：在 Core 的完整历史里查用户消息与回复，最新的在上；
// 输入即搜（防抖），Enter 立刻搜，Esc 或再次点按钮收起并回到原来的历史位置。
const ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
const stamp=at=>{const d=new Date(at);return Number.isNaN(+d)?'':d.toLocaleString([],{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};

export function highlight(node,text,query){
 node.replaceChildren();const lower=text.toLowerCase(),needle=query.toLowerCase();let at=0;
 if(needle)for(let i=lower.indexOf(needle);i>=0;i=lower.indexOf(needle,at)){if(i>at)node.append(text.slice(at,i));node.append(el('mark',text.slice(i,i+needle.length)));at=i+needle.length;}
 if(at<text.length)node.append(text.slice(at));
}

export function createHistorySearch({fetch,scope,getProfile=()=>({}),onActive=()=>{},onPage=()=>{}}){
 const bar=el('div',undefined,'hx-search'),toggle=el('button',undefined,'cp-icon hx-search-toggle'),input=el('input',undefined,'hx-search-input ui-outline');
 const results=el('section',undefined,'hx-results'),status=el('p',undefined,'hx-results-status'),list=el('div',undefined,'hx-results-list');
 toggle.type='button';toggle.innerHTML=ICON;toggle.setAttribute('aria-label','搜索历史消息');toggle.dataset.tip='搜索历史消息';toggle.setAttribute('aria-expanded','false');
 input.type='search';input.placeholder='搜索历史消息';input.setAttribute('aria-label','搜索历史消息');input.maxLength=200;input.tabIndex=-1;
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 bar.append(input,toggle);results.append(status,list);results.hidden=true;bar.dataset.open='false';
 let open=false,query='',page=1,pages=1,timer=0,ticket=0,busy=false;
 const active=()=>open&&!!query;
 function setOpen(next){
  if(next===open)return;open=next;bar.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open));input.tabIndex=open?0:-1;
  if(open){input.focus({preventScroll:true});input.select();}
  else{clearTimeout(timer);ticket++;input.value='';query='';page=pages=1;busy=false;list.replaceChildren();results.hidden=true;onActive(false);}
 }
 function row(entry){
  const user=entry.role==='user'||entry.title==='user',identity=user?null:roleIdentity(getProfile(),entry.role&&entry.role!=='user'?entry.role:'matrix');
  const profile=getProfile()||{},name=user?(profile.name||'你'):identity?.name||'Eyra';
  const node=el('article',undefined,'hx-hit '+(user?'user':'eyra')),head=el('header'),text=el('p',undefined,'hx-hit-text');
  const time=el('time',stamp(entry.at));time.dateTime=entry.at||'';
  head.append(el('strong',name),time);highlight(text,String(entry.text||''),query);node.append(head,text);
  node.tabIndex=0;node.title='展开全文';
  node.onclick=()=>node.classList.toggle('expanded');
  node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();node.classList.toggle('expanded');}};
  return node;
 }
 async function run(requested=1){
  const q=input.value.trim();clearTimeout(timer);const mine=++ticket;
  if(!q){query='';busy=false;results.hidden=true;list.replaceChildren();onActive(false);return;}
  query=q;const {task_id,segment}=scope();busy=true;
  results.hidden=false;onActive(true);onPage(page,pages,true);status.textContent='正在搜索…';status.hidden=false;
  try{
   const result=await fetch({task_id,segment,all_history:true,query:q,page:requested});
   if(mine!==ticket||!open)return;
   if(result?.reset)throw Error('历史已更新，请重新搜索。');
   page=result.page||1;pages=result.pages||1;
   const hits=(result.entries||[]).filter(e=>e.kind==='message').reverse();
   list.replaceChildren(...hits.map(row));
   status.textContent=result.warning||(result.indexing?'正在搜索…':hits.length?'':'没有找到相关消息');status.hidden=!status.textContent;
   if(result.indexing&&!result.warning)timer=setTimeout(()=>{if(mine===ticket&&open)void run(requested);},350);
   if(results.closest('#panel-content'))results.closest('#panel-content').scrollTop=0;
  }catch(error){if(mine===ticket&&open){list.replaceChildren();status.textContent=error.message||'搜索没有完成';status.hidden=false;}}
  finally{if(mine===ticket){busy=false;onPage(page,pages,false);}}
 }
 toggle.onclick=()=>{if(open&&input.value.trim()){input.focus();return;}setOpen(!open);};
 input.addEventListener('input',()=>{ticket++;clearTimeout(timer);timer=setTimeout(()=>void run(),300);});
 input.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Enter'){event.preventDefault();void run();}
  else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);toggle.focus({preventScroll:true});}
 });

 return {bar,results,go:page=>run(page),get active(){return active();},close(){setOpen(false);},reset(){if(open){ticket++;list.replaceChildren();results.hidden=true;page=pages=1;if(input.value.trim())void run();}}};
}
