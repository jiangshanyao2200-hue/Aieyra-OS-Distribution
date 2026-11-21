// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/renderer/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: $; english; stateNames; tr; state; node; showError; renderList; createDetail; renderDetail; loadActivity; loadOlder; loadDetail; refresh
// Impact: python -B scripts/code-atlas.py show Client/Desktop/renderer/matrix-window.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const $=id=>document.getElementById(id);
let english=false,selected='',records=[],detailRecord=null,busy=false,activity=null,detailVersion='',windowVisible=true,presentation='display';
const stateNames={waiting_user:['等待你的决定','Waiting for your decision'],running:['执行中','Working'],queued:['执行中','Working'],completed:['已交付','Delivered'],failed:['需要处理','Needs attention'],cancelled:['已停止','Stopped'],cancelling:['正在停止','Stopping'],interrupted:['结果待核对','Check outcome'],timed_out:['需要处理','Needs attention'],persistence_failed:['保存未完成','Not saved']};
const tr=(zh,en)=>english?en:zh;
const state=r=>r.acceptance==='accepted'?tr('已验收','Reviewed'):r.acceptance==='rework'?tr('正在返工','Rework requested'):(stateNames[r.state]||[r.state,r.state])[english?1:0];
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function showError(error){$('notice').hidden=false;$('notice').textContent=tr('暂时无法读取任务进展，已保留当前内容。','Cannot update progress. Current work remains visible.')+(error&&error!=='connection_unavailable'?'\n'+error:'');}
function renderList(){
 document.documentElement.lang=english?'en-US':'zh-CN';$('caption').textContent=tr('专项协作','Specialist work');$('title').textContent=tr('一起推进','Work in progress');$('foot').textContent=presentation==='display'?tr('仅展示 · 鼠标穿透 · Matrix 可开启交互','Display only · Mouse passes through · Matrix can enable interaction'):tr('允许操作 · 查看专项过程与交付','Interactive · Follow specialist work and delivery');
 $('task-count').textContent=records.length?tr(records.length+' 项任务',records.length+(records.length===1?' task':' tasks')):'';$('tasks').setAttribute('aria-label',tr('专项任务','Specialist tasks'));
 const focus=document.activeElement?.dataset?.id,scroll=$('tasks').scrollTop;
 $('tasks').replaceChildren(...records.map(r=>{const b=node('button',undefined,'task');b.dataset.id=r.id;b.setAttribute('aria-pressed',String(r.id===selected));b.append(node('strong',r.title||tr('专项任务','Assignment')),node('small',r.model_id),node('span',state(r),'task-outcome'));b.onclick=async()=>{if(selected===r.id)return;selected=r.id;detailRecord=null;detailVersion='';createDetail();renderList();try{await loadDetail();}catch{showError();}};return b;}));
 $('tasks').scrollTop=scroll;if(focus)[...$('tasks').children].find(b=>b.dataset.id===focus)?.focus({preventScroll:true});
}
function createDetail(){
 activity?.destroy();activity=null;const detail=$('detail');detail.replaceChildren();detail.dataset.id=selected;detail.className=selected?'':'empty';detail.scrollTop=0;
 if(!selected){detail.append(node('div','◈','glyph'),node('p',tr('专项任务开始后，实际执行过程将在这里展开。','Actual work appears here when a specialist task starts.')));return;}
 const head=node('div',undefined,'task-head'),titles=node('div');titles.append(node('p',tr('当前任务','ASSIGNMENT'),'eyebrow'),node('h2','',null));titles.lastChild.id='detail-title';head.append(titles);const stop=node('button',tr('停止任务','Stop task'),'action');stop.id='stop-task';stop.onclick=async()=>{const id=selected,generation=detailRecord?.generation;if(detailRecord?.id!==id||!Number.isInteger(generation))return;stop.disabled=true;try{const r=await window.matrix.call({action:'agents.cancel',arguments:{id,generation}});if(id!==selected)return;if(!r.ok)showError(r.error);await loadDetail();}catch{if(id===selected)showError();}finally{if(stop.isConnected)stop.disabled=detailRecord?.state==='cancelling';}};head.append(stop);
 const goal=node('p','', 'goal');goal.id='task-goal';const process=node('div');process.id='process';activity=new AieyraActivity.ActivityView(process);activity.windowVisible=windowVisible;activity.onOlder=loadOlder;
 const delivery=node('div');delivery.id='delivery';const extra=node('details',undefined,'task-information');extra.id='task-information';const summary=node('summary',tr('任务约定与运行信息','Assignment and runtime details'));extra.append(summary,node('div'));extra.lastChild.id='runtime-information';detail.append(head,goal,process,delivery,extra);
}
function renderDetail(){
 const r=detailRecord;if(!r)return;
 $('detail-title').textContent=r.spec.title||tr('专项任务','Assignment');$('task-goal').textContent=r.spec.task;
 document.querySelector('.task-head .eyebrow').textContent=tr('当前任务','ASSIGNMENT');
 const stop=$('stop-task');stop.hidden=presentation!=='interactive'||!['queued','running','cancelling','waiting_user'].includes(r.state);stop.disabled=r.state==='cancelling';stop.textContent=r.state==='cancelling'?tr('正在停止','Stopping'):tr('停止任务','Stop task');
 const delivery=$('delivery');const signature=JSON.stringify([english,r.result,r.evidence,r.error,r.acceptance,r.reviews,r.delivery,r.history]);if(delivery.dataset.signature!==signature){const expanded=new Set([...delivery.querySelectorAll('details[open]')].map(d=>d.dataset.identity));delivery.dataset.signature=signature;delivery.replaceChildren();
  for(const [label,value,cls]of [[tr('交付','Delivery'),r.result,'body'],[tr(r.acceptance==='rework'?'返工要求':'检查结果',r.acceptance==='rework'?'Requested corrections':'Review'),r.evidence,'body review'],[tr('需要处理','Needs attention'),r.error,'body error']])if(value)delivery.append(node('h3',label),node('div',value,cls));
  if(r.delivery?.artifacts?.length){delivery.append(node('h3',tr('交付文件','Delivered files')));const files=node('ul',undefined,'artifact-list');for(const file of r.delivery.artifacts){const line=node('li');line.append(node('span',file.path,'artifact-path'),node('small',file.error||file.bytes.toLocaleString()+tr(' 字节 · 已记录摘要',' bytes · Hash recorded'),file.error?'artifact-error':null));files.append(line);}delivery.append(files);}
  if(r.reviews?.length){const details=node('details',undefined,'review-history');details.dataset.identity='reviews';details.open=expanded.has('reviews');details.append(node('summary',tr('查看逐轮检查','Review history')));for(const rev of r.reviews){details.append(node('h3',tr('第 '+rev.generation+' 轮 · '+(rev.verdict==='accepted'?'验收通过':'要求返工'),'Round '+rev.generation+' · '+(rev.verdict==='accepted'?'Accepted':'Corrections requested'))),node('div',rev.evidence,'body'));for(const check of rev.checks||[]){const criterion=r.spec.contract?.acceptance?.[check.criterion]||String(check.criterion);details.append(node('p',criterion,'criterion'),node('div',check.evidence,'body review'));}}delivery.append(details);}
  if(r.history?.length){const details=node('details',undefined,'review-history');details.dataset.identity='deliveries';details.open=expanded.has('deliveries');details.append(node('summary',tr('查看之前的交付','Earlier deliveries')));for(const past of r.history)details.append(node('h3',tr('第 '+past.generation+' 轮','Round '+past.generation)),node('div',past.result||past.error||tr('未提交交付说明','No delivery summary'),'body'));delivery.append(details);}
 }
 const usage=r.usage||[],reported=usage.length>0&&usage.every(u=>u.usage_reported),sum=k=>usage.reduce((n,u)=>n+(u[k]||0),0),known=reported&&usage.every(u=>Number.isFinite(u.cached_tokens));
 const content=$('runtime-information'),dl=node('dl');for(const [k,v]of [[tr('模型','Model'),r.spec.model_id],[tr('工具','Tools'),(r.spec.tools||[]).join(', ')],[tr('请求','Requests'),r.requests],[tr('输入 / 输出','Input / output'),reported?sum('input_tokens').toLocaleString()+' / '+sum('output_tokens').toLocaleString():tr('未报告','Not reported')],[tr('缓存命中','Cache hits'),known?sum('cached_tokens').toLocaleString():tr('未报告','Not reported')]])dl.append(node('dt',k),node('dd',v));content.replaceChildren(dl);
 for(const h of r.human_requests||[])if(h.state==='waiting_user'){content.append(node('h3',tr('需要你的决定','Your decision is needed')),node('p',h.question),node('p',h.recommendation),node('p',h.impact),node('p',h.resume_summary));}
 if(r.spec.contract)for(const [key,label]of [['acceptance',tr('验收条件','Acceptance criteria')],['deliverables',tr('交付文件','Deliverables')],['constraints',tr('约束','Constraints')]])if(r.spec.contract[key]?.length){content.append(node('h3',label));const list=node('ul');for(const item of r.spec.contract[key])list.append(node('li',item));content.append(list);}
 $('task-information').firstChild.textContent=tr('任务约定与运行信息','Assignment and runtime details');
}
async function loadActivity(id){
 const view=activity;if(!view)return;const r=await window.matrix.call({action:'agents.activity',arguments:{id,since:view.timeline.cursor,limit:120}});if(id!==selected||view!==activity)return;if(!r.ok)throw Error(r.error||'connection_unavailable');
 view.update(r.data,english,detailRecord?.state||'running');
}
async function loadOlder(){
 const id=selected,view=activity;if(!id||!view)return;const first=Math.min(...[...view.timeline.items.values()].map(v=>v.sequence));view.more.disabled=true;try{const r=await window.matrix.call({action:'agents.activity',arguments:{id,before:first,limit:120}});if(id===selected&&r.ok){view.expanded=true;view.update({...r.data,cursor:view.timeline.cursor},english,detailRecord.state);}}catch{showError();}finally{view.more.disabled=false;}
}
async function loadDetail(){
 const id=selected;if(!id)return;const r=await window.matrix.call({action:'agents.status',arguments:{id}});if(id!==selected)return;if(!r.ok)throw Error(r.error||'connection_unavailable');detailRecord=r.data;
 const key=JSON.stringify([english,r.data]);if(key!==detailVersion){detailVersion=key;renderDetail();}await loadActivity(id);
}
async function refresh(){
 if(busy)return;busy=true;try{english=(await window.matrix.locale())==='en-US';const r=await window.matrix.call({action:'agents.list',arguments:{}});if(!r.ok)throw Error(r.error||'connection_unavailable');records=Array.isArray(r.data)?r.data:[];
  if(!records.some(r=>r.id===selected)){selected=records[0]?.id||'';detailRecord=null;detailVersion='';createDetail();}
  renderList();await loadDetail();$('notice').hidden=true;$('connection').textContent=tr('已连接','Connected');
 }catch(e){$('connection').textContent=tr('连接中断','Disconnected');showError(e.message);}finally{busy=false;}
}
window.matrix.onVisibility?.(visible=>{windowVisible=visible;if(activity)activity.windowVisible=visible;});
window.matrix.onPresentation?.(mode=>{presentation=mode==='interactive'?'interactive':'display';renderList();renderDetail();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')window.matrix.close();});
createDetail();renderList();refresh();setInterval(refresh,700);
