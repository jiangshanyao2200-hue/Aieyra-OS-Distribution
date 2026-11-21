// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: toolNames; actionNames; friendly; stateNames; clock; dayKey; dayLabel; isProcess; setupHistory
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/history.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {el} from './views.mjs';
import {createReceiptReader} from '../../../Tool/presentation/receipt-reader.mjs';
import {renderMarkdown} from './markdown.mjs';
import {HistoryPages,historyNavigation} from './history-pages.mjs';
import {historyGroups} from './history-groups.mjs';
import {animateUI,motionAllowed} from './motion.mjs';
import {roleIdentity,createRoleRing} from './role-identity.mjs';
import {actionName,activityToolName} from './activity.mjs';
import {artifactChips} from './chat-column.mjs';
import {createAttachmentCards} from './attachments.mjs';
import {createHistorySearch} from './history-search.mjs';

// 历史弹窗（双击光圈）：与聊天列同一套元素——头像、粗体名字、正文；没有顶部控制栏。
// 往上滚自动读更早的记录；离开底部时右下角出现一个"回到最新"的圆；工具与思考收成每轮一段可展开的"过程"。
const toolNames={exec_command:'运行命令',write_stdin:'继续命令',read_shell_output:'读取命令输出',apply_patch:'修改文件',update_plan:'更新计划',workspace:'工作区',project:'项目',browser:'浏览器',memory:'记忆',settings:'设置',toolbox:'工具箱',agents:'协同',team:'团队',ask_user:'询问你',terminal:'终端',humans:'询问你',web_search:'搜索网页',image:'生成图片',wait:'等待',compact:'整理上下文',apps:'应用',updates:'更新'};
const actionNames={canvas_inspect:'查看画布',canvas_document:'添加文档',canvas_update:'整理画布',workflow_status:'查看交付进度',workflow_deliver:'确认交付',link_status:'查看 Link 状态',link_open:'打开 Link',eyra_open:'展开输入',eyra_close:'收起输入'};
const friendly=(value,tool)=>{const [head,...rest]=String(value||'').split(' · '),name=actionNames[head]||actionName(tool,head);return name?[name,...rest].join(' · '):String(value||'');};
const stateNames={running:'进行中',failed:'失败',cancelled:'已取消',waiting_user:'等待回复',queued:'排队中',commentary:'行进中'};
const clock=at=>{const d=new Date(at);return Number.isNaN(+d)?'':d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});};
const dayKey=at=>{const d=new Date(at);return Number.isNaN(+d)?'':d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();};
function dayLabel(at,now=new Date()){
 const d=new Date(at);if(Number.isNaN(+d))return '';
 const start=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime(),diff=Math.round((start(now)-start(d))/86400000);
 return diff===0?'今天':diff===1?'昨天':d.getFullYear()===now.getFullYear()?(d.getMonth()+1)+' 月 '+d.getDate()+' 日':d.getFullYear()+' 年 '+(d.getMonth()+1)+' 月 '+d.getDate()+' 日';
}
const isProcess=row=>row.kind==='tool'||row.kind==='thinking'||row.kind==='system';

export function setupHistory(api,check,notice,openDocument,getProfile=()=>({})){
 const root=el('section',undefined,'hx'),top=el('div',undefined,'hx-top'),list=el('div',undefined,'hx-list'),latest=el('button',undefined,'hx-latest');
 latest.type='button';latest.setAttribute('aria-label','回到最新');latest.title='回到最新';latest.hidden=true;
 latest.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
 const pager=new HistoryPages(args=>api.history(args).then(check)),nodes=new Map(),openGroups=new Set(),readers=new Set();
 let opened=false,timer=0,scrollHost=null,initial=false,readingAnchor=null,searchAnchor=null;
 // 搜索结果暂时替代记录列表；收起时回到搜索前的阅读位置。
 const navigation=historyNavigation(document,page=>{if(search.active)void search.go(page);else void load('page',page);});
 const search=createHistorySearch({fetch:args=>api.history(args).then(check),scope:()=>({task_id:pager.task,segment:pager.segment}),getProfile,onPage:(page,pages,busy)=>navigation.paint(page,pages,busy),onActive(on){
  if(on===list.hidden)return;
  if(on){searchAnchor=anchor();list.hidden=true;latest.hidden=true;const h=host();if(h)h.scrollTop=0;}
  else{list.hidden=false;paintedState='';render(searchAnchor);searchAnchor=null;}
 }});
 root.append(top,search.results,list,latest);top.setAttribute('aria-live','polite');
 function host(){return root.closest('#panel-content')||root.parentElement;}
 function anchor(){const h=host();if(!h)return null;const at=h.getBoundingClientRect().top;const node=[...list.querySelectorAll('[data-history-id]')].find(n=>n.getBoundingClientRect().bottom>at);return {id:node?.dataset.historyId,offset:node?node.getBoundingClientRect().top-at:0,scroll:h.scrollTop,atBottom:h.scrollHeight-h.scrollTop-h.clientHeight<70};}
 // 待答复问题的表单排在历史之前：此时首读/回到最新停在顶部，表单留在可视区。
 function pinned(h){return h?.querySelector(':scope > .human-request');}
 function restore(saved,mode){
  const h=host();if(!h)return;
  if(mode==='page'){h.scrollTop=0;return;}
  if(initial||mode==='reset'){h.scrollTop=pinned(h)?0:h.scrollHeight;initial=false;return;}
  const node=saved?.id&&list.querySelector('[data-history-id="'+CSS.escape(saved.id)+'"]');
  if(node)h.scrollTop+=node.getBoundingClientRect().top-h.getBoundingClientRect().top-saved.offset;else if(saved)h.scrollTop=saved.scroll;
  if(saved?.atBottom&&mode==='latest')h.scrollTop=h.scrollHeight;
 }
 // 顶部只有一行很轻的状态：读取中、索引中或读取失败（带重试）；正常时什么都不显示。
 function status(){
  if(!search.active)navigation.paint(pager.page,pager.pages,pager.busy);
  root.setAttribute('aria-busy',String(pager.busy));
  const text=pager.error||pager.warning||(!pager.loaded?'正在读取记录…':pager.busy&&pager.paged?'正在读取更早的记录…':pager.indexing?'正在整理记录…':pager.loaded&&!pager.rows.length?'还没有记录':'');
  top.replaceChildren();top.hidden=!text;if(!text)return;
  top.append(el('span',text));
  if(pager.error||pager.warning){const retry=el('button','重试','hx-retry');retry.type='button';retry.onclick=()=>void load('page',pager.page);top.append(retry);}
 }
 function disposeNode(node){for(const reader of readers)if(node.contains(reader.element)){reader.dispose();readers.delete(reader);}}
 function receipt(row,node,summaryNode){
  const tool=row.kind==='tool',scope=pager.scope,task=pager.task,segment=pager.segment;
  const args=tool?{agent_id:row.agent_id,id:row.call_id,...(row.generation?{receipt_generation:row.generation}:{})}:{entry_id:row.id,segment};
  const reader=createReceiptReader(document,{
   summary:summaryNode,mode:tool?'tool':'text',renderText:renderMarkdown,
   readPage:offsets=>api.receipt({...args,task_id:task,all_history:true,...offsets}),
   isCurrent:()=>opened&&scope===pager.scope&&node.isConnected,
  });
  readers.add(reader);node.append(reader.element);reader.setVisible(opened);
 }
 function avatar(src,name,kind){
  const node=el('span',undefined,'chat-avatar '+kind);
  if(src){const img=document.createElement('img');img.alt='';img.src=src;node.append(img);}
  else if(kind==='user')node.textContent=([...String(name||'').trim()][0]||'·').toUpperCase();
  return node;
 }
 // 过程里的一步：状态点 · 动作 · 摘要 · 时间，点开读原始输入输出。
 function step(row){
  const node=el('div',undefined,'hx-step');node.dataset.historyId=row.id;node.dataset.kind=row.kind;if(row.state)node.dataset.state=row.state;
  if(row.kind==='tool'||row.compaction){
   const summary=el('summary',undefined,'hx-step-line');
   summary.append(el('span',undefined,'hx-dot'),el('strong',toolNames[row.title]||activityToolName(row.title)||row.title||'工具'),el('span',friendly(row.summary,row.title),'hx-step-text'));
   if(stateNames[row.state])summary.append(el('em',stateNames[row.state],'hx-step-state'));
   summary.append(el('time',clock(row.at)));receipt(row,node,summary);return node;
  }
  if(row.kind==='thinking'){
   const details=el('details',undefined,'hx-receipt'),summary=el('summary',undefined,'hx-step-line'),body=el('div',undefined,'chat-text hx-thought');
   const preview=String(row.text||'').replace(/\s+/g,' ').trim();
   summary.append(el('span',undefined,'hx-dot'),el('strong','思考'),el('span',preview.slice(0,90)+(preview.length>90?'…':''),'hx-step-text'),el('time',clock(row.at)));
   renderMarkdown(body,row.text||'');details.append(summary,body);node.append(details);if(row.text_more||row.unavailable)receipt(row,node);return node;
  }
  node.append(el('span',undefined,'hx-dot'),el('span',row.title||row.text||'','hx-step-text'),el('time',clock(row.at)));return node;
 }
 function message(row){
  const user=row.title==='user'||row.role==='user',node=el('div',undefined,'hx-message');node.dataset.historyId=row.id;
  const text=el('div',undefined,'chat-text');
  if(row.kind==='document')text.append(el('strong',row.title||'文档'));
  else if(user)text.textContent=row.text||'';else renderMarkdown(text,row.text||'');
  const time=el('time',clock(row.at),'hx-message-time');time.dateTime=row.at||'';time.title=row.at?new Date(row.at).toLocaleString():'';
  node.append(text,time);
  if(user&&row.attachments?.some(a=>a.kind==='image'||a.web_reference))node.append(createAttachmentCards(row.attachments.filter(a=>a.kind==='image'||a.web_reference)));
  // 重开后仍能从历史打开当时交付的文件。
  if(!user&&Array.isArray(row.artifacts)&&row.artifacts.length)node.append(artifactChips(row.artifacts));
  if(row.truncated)node.append(el('small','当时保存的原文已截断；此处展示现有记录。','hx-state'));
  if(row.document_id&&(row.kind==='document'||row.text_more)){const button=el('button','查看原文','hx-page'),task=pager.task;button.type='button';button.onclick=()=>Promise.resolve(openDocument({id:row.document_id,task_id:task,history:true})).catch(error=>notice(error.message,true));node.append(button);}
  else if(row.text_more||row.unavailable)receipt(row,node);
  return node;
 }
 function speakerGroup(group){
  const profile=getProfile(),user=group.speaker==='user',identity=roleIdentity(profile,group.speaker),name=user?(profile.name||'你'):identity.name;
  const node=el('article',undefined,'chat-entry hx-entry hx-turn '+(user?'user':'eyra')),main=el('div',undefined,'chat-main'),header=el('header',undefined,'chat-name');
  node.dataset.speaker=group.speaker;node.dataset.historyGroup=group.id;
  header.append(el('span',name));const at=group.rows[0].at,time=el('time',clock(at));time.dateTime=at||'';time.title=at?new Date(at).toLocaleString():'';header.append(time);
  main.append(header);let buffer=[],day=dayKey(at);
  const flush=()=>{if(buffer.length){main.append(processGroup(buffer));buffer=[];}};
  for(const row of group.rows){
   const next=dayKey(row.at);if(next&&next!==day){flush();main.append(el('div',dayLabel(row.at),'hx-day hx-inline-day'));day=next;}
   if(isProcess(row))buffer.push(row);else{flush();main.append(cached(row,message));}
  }
  flush();
  // 组头已写了时间：同一分钟的消息不再在正文下重复一遍，分钟变了才显示。
  let shown=clock(at);for(const t of main.querySelectorAll(':scope > .hx-message > .hx-message-time')){t.hidden=t.textContent===shown;shown=t.textContent;}
  node.append(user?avatar(profile.avatar,name,'user'):createRoleRing(identity),main);return node;
 }
 // 一轮的过程：默认收起，只露一行"过程 · N 步"和用到的动作；点开看每一步。
 function processGroup(rows){
  const id=rows[0].id,box=el('details',undefined,'hx-process');box.dataset.group=id;box.open=openGroups.has(id);
  box.ontoggle=()=>{if(box.open){openGroups.add(id);animateUI(steps,[{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}],{key:'history-process'});}else openGroups.delete(id);};
  const counts=new Map();for(const r of rows){const label=r.kind==='thinking'?'思考':r.kind==='tool'?toolNames[r.title]||r.title||'工具':'';if(label)counts.set(label,(counts.get(label)||0)+1);}
  const summary=el('summary',undefined,'hx-process-line'),running=rows.some(r=>r.state==='running'),failed=rows.some(r=>r.state==='failed');
  summary.append(el('span',undefined,'hx-dot'),el('strong','过程'),el('span',rows.length+' 步 · '+[...counts].map(([k,n])=>n>1?k+' ×'+n:k).join('、'),'hx-step-text'));
  if(running)summary.append(el('em','进行中','hx-step-state'));else if(failed)summary.append(el('em','有失败','hx-step-state'));
  box.dataset.state=running?'running':failed?'failed':'done';
  const steps=el('div',undefined,'hx-steps');
  for(const r of rows)steps.append(cached(r,step));
  box.append(summary,steps);return box;
 }
 function cached(row,make){
  const profile=getProfile(),key=JSON.stringify([row,profile.name,profile.eyraName,profile.avatar,profile.eyraAvatar,profile.roles]);let c=nodes.get(row.id);
  // 正在阅读的回执保持不动，即使对应工具刚刚完成。
  if(!c||c.key!==key&&!c.node.querySelector('details[open]')){if(c)disposeNode(c.node);c={key,node:make(row)};nodes.set(row.id,c);}
  return c.node;
 }
 let paintedGroups=new Set(),paintedState='';
 function render(saved,mode){
  const state=JSON.stringify([pager.scope,pager.rows,getProfile()]);
  // Polling unchanged history must not detach the summary being focused or
  // the text being selected. Rebuild only when rows or their identity change.
  if(search.active){paintedState='';status();return;}
  if(mode==='latest'&&state===paintedState){status();follow();return;}
  paintedState=state;
  const children=[],groups=historyGroups(pager.rows),newNodes=[];let day='';
  for(const group of groups){
   const d=dayKey(group.rows[0].at);if(d&&d!==day){day=d;children.push(el('div',dayLabel(group.rows[0].at),'hx-day'));}
   const node=speakerGroup(group);children.push(node);if(!paintedGroups.has(group.id))newNodes.push(node);
  }
  paintedGroups=new Set(groups.map(g=>g.id));
  const ids=new Set(pager.rows.map(r=>r.id));for(const [id,cached]of nodes)if(!ids.has(id)){disposeNode(cached.node);nodes.delete(id);}
  for(const id of openGroups)if(!ids.has(id))openGroups.delete(id);
  list.replaceChildren(...children);status();restore(saved,mode);follow();
  if(mode!=='older')for(const node of newNodes.slice(-4))animateUI(node,[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{key:'history-enter'});
 }
 function follow(){latest.hidden=true;}
 latest.onclick=()=>{const h=host();if(pager.paged||pager.trimmed){void load('reset');return;}h?.scrollTo({top:h.scrollHeight,behavior:motionAllowed(root)?'smooth':'instant'});};
 function schedule(){clearTimeout(timer);if(!opened)return;timer=setTimeout(()=>{if(!opened)return;if(search.active){schedule();return;}if(!pager.indexing&&(root.querySelector('details.hx-receipt[open]')||pager.paged||pager.trimmed)){schedule();return;}void load('latest');},pager.indexing?350:1800);}
 async function load(mode,page=mode==='reset'?1:pager.page){if(pager.busy&&mode!=='page')return;const saved=anchor(),promise=pager.numbered(page);status();const accepted=await promise;if(!opened)return;if(accepted)render(saved,mode);else status();schedule();}
 function onScroll(){follow();}
 return {root,
  reset(next){const changed=pager.reset(next);if(changed){search.reset();for(const reader of readers)reader.dispose();readers.clear();nodes.clear();openGroups.clear();paintedGroups.clear();paintedState='';readingAnchor=null;list.replaceChildren();initial=true;status();if(opened)void load('reset');}return changed;},
  update(){},
  open(){const next=host();if(next!==scrollHost){scrollHost?.removeEventListener('scroll',onScroll);scrollHost=next;scrollHost?.addEventListener('scroll',onScroll,{passive:true});}const panel=root.closest('#panel');if(panel&&search.bar.parentElement!==panel)panel.append(search.bar,navigation.element);if(opened)return;opened=true;for(const reader of readers)reader.setVisible(true);pager.opened=true;initial=!pager.loaded;if(!pager.loaded)void load('reset');else{render(readingAnchor);readingAnchor=null;schedule();}},
  close(){search.close();search.bar.remove();navigation.element.remove();if(opened)readingAnchor=anchor();opened=false;for(const reader of readers)reader.setVisible(false);clearTimeout(timer);pager.close();scrollHost?.removeEventListener('scroll',onScroll);scrollHost=null;}
 };
}
