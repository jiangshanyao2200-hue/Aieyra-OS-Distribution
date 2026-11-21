/* @file-map:start
文件: link/desktop/ui/work-status.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/detail-view.mjs, link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs, link/office/web/model.js, link/office/web/situation.js, link/office/web/station-model.js, link/office/web/station-visual.mjs
上游: AIDEBUG/personal-station.test.cjs, AIDEBUG/station-overview.test.cjs, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/personal-station.test.cjs, AIDEBUG/station-overview.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  stationReport | function
  slide | function
  situationItems | function
  workStatusHTML | function
  personalStationView | function
  operationItems | function
  operationsHTML | function
  updateOperations | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {icon} from './icons.mjs';
import {detailButton} from './detail-view.mjs';
import {deskArt} from '../../office/web/station-visual.mjs';
import {stationRows} from '../../office/web/situation.js';
import {linkStatusLabel,orderedTasks} from '../../office/web/station-model.js';
import {humanLine,taskRecordState,timestamp} from '../../office/web/model.js';
const phases={awaiting_goal:'等待新目标',nominating:'正在征集目标',voting:'目标与负责人投票中',active:'正在推进阶段目标',completed:'本阶段已完成',deferred:'等待新一轮'};
const reportLabels=['进展','验证','阻塞','下一步'];

/* @chain-region stationReport | calls: e, summary.startsWith, summary.split, exec, reportLabels.indexOf, sections.at, sections.push, join … */ function stationReport(summary,explicit){
 if(!summary)return '';
 const fallback=`<p class="station-report">${e(summary)}</p>`;
 if(!explicit||!summary.startsWith('进展：'))return fallback;
 const sections=[];
 for(const line of summary.split('\n')){
   const match=/^(进展|验证|阻塞|下一步)：(.*)$/.exec(line);
   if(match){
     const index=reportLabels.indexOf(match[1]);
     if(sections.length&&index<=sections.at(-1).index)return fallback;
     sections.push({index,text:match[2]});
   }else sections.at(-1).text+='\n'+line;
 }
 if(sections.length<2)return fallback;
 return `<dl class="station-report task-detail" aria-label="工作汇报">${sections.map(section=>`<dt>${reportLabels[section.index]}</dt><dd>${e(section.text)}</dd>`).join('')}</dl>`;
}
const /* @chain-region slide | calls: e */ slide=(key,kicker,title,summary)=>({key,html:`<span class="situation-headline">${e(title)}</span>`,text:title});
export /* @chain-region situationItems | calls: c.goals.filter, Date.now, slide, join, adopted.map, some, Object.values, rows.push … */ function situationItems(value){
 const c=value.context,s=c.situation,progress=s?.progress||c.engineering?.counts||{},working=s?.participants.working;
 const adopted=s?.adopted_goals||c.goals.filter(g=>g.adopted_rank);
 const closed=c.cycle?.closes<=Date.now()/1000&&c.phase==='voting';
 const rows=[slide('phase','项目态势 · AIEYRA OS',closed?'本轮投票已截止':s?.label||phases[c.phase]||'共同推进下一步',adopted.length?adopted.map(g=>g.title).join(' · '):'')];
 if(Object.values(progress).some(v=>typeof v==='number'&&v>0))rows.push(slide('progress','工程进展',`${progress.working||0} 项开发中 · ${progress.integrated||0} 项已整合`,`${progress.blocked||0} 项有阻塞 · ${progress.review||0} 项待整合`));
 rows.push(slide('people','共同创造的人',working?.working_engineers>0?`${working.working_engineers} 位工程师近期工作中`:`${c.participants?.total??0} 位工程师参与项目`,working?.working_engineers>0?'近 3 分钟有任务进展':c.access.member?'':'完成资格审核后了解工程态势'));
 const agendas=c.agendas.filter(a=>a.status==='approved'||a.status==='voting');
 if(agendas.length)rows.push(slide('agendas','项目议程',`${agendas.filter(a=>a.status==='approved').length} 项执行中 · ${agendas.filter(a=>a.status==='voting').length} 项表决中`,agendas[0].title));
 return rows;
}
export /* @chain-region workStatusHTML */ function workStatusHTML(value,active,date){
 return `<section class="work-status" aria-label="我的工位"><div id="station-reconnect" class="station-reconnect" hidden><p></p><button class="primary" data-action="agent-copy">复制接入信息</button></div><p id="station-warning" class="station-warning" role="status" ${value.stale?'':'hidden'}>暂未更新</p><div id="personal-station"><p class="empty">读取工位…</p></div><section class="link-activity" aria-label="Link 操作日志"><div id="link-activity-scroll" class="link-activity-scroll" tabindex="0" aria-label="最近 Link 动态"><div id="link-activity-list"></div></div><div class="activity-footer"><button class="secondary" data-action="activity-older">查看更早操作</button></div></section></section>`;
}

export /* @chain-region personalStationView | calls: Date.now, stationRows, Set, rows.find, find, orderedTasks, includes, taskRecordState … */ function personalStationView(value,context,date,now=Date.now()){
 const live=!value?.stale&&value?.snapshot?.connection?.state==='online';
 const rows=value?.registry?stationRows(value.registry,value.snapshot,live,new Set(),now):[];
 const row=rows.find(r=>r.agent?.runtime?.seat_id===r.id)||rows[0]||null;
 const report=row?.agent?.runtime?.work_report,link=row?.link||{state:'sync'};
 const localTask=row?orderedTasks(row.tasks,live).find(t=>['doing','blocked','planned','unconfirmed','expired'].includes(taskRecordState(t,live))):null;
 const ownedTasks=(context?.tasks?.items||[]).filter(t=>t.own&&['ready','working','blocked','review'].includes(t.state))
   .sort((a,b)=>Number(a.state==='ready')-Number(b.state==='ready')||(b.updated||0)-(a.updated||0));
 const [cloudTask,...otherTasks]=ownedTasks;
 const title=value?.unlinked?'工位尚未同步':cloudTask?.title||report?.task||localTask?.title||'等待下一项任务';
 const summary=report?.summary||localTask?.note||cloudTask?.note||'';
 const identity=context?.situation?.identity,agendas=context?.situation?.related_agendas||[],nominee=identity?.candidacy;
 const nomination=nominee&&context.phase==='voting'?`<small>参选中 · 职位支持 ${nominee.support??0} · 目标支持 ${context.goals.find(g=>g.own)?.votes?.support??0}</small>`:'';
 const workState=cloudTask?.state|| (localTask?taskRecordState(localTask,live):'');
 const workLabel={ready:'待开工',planned:'已安排',working:'开发中',doing:'处理中',blocked:'有阻塞',review:'待整合',unconfirmed:'待确认',expired:'待核对'}[workState];
 const workMarker=workLabel?`<span class="station-work-marker" data-task-state="${e(workState)}">${icon(workState==='blocked'?'pause':workState==='review'?'merge':'blueprint')}${workLabel}</span>`:'';
 const actions=`<div class="station-report-meta">
   ${cloudTask?`<button class="primary" data-live-context="${e(cloudTask.id)}">继续任务 ${icon('arrow')}</button>`:''}
   ${cloudTask||localTask?`<button class="secondary" data-station-brief="${e(cloudTask?.id||'local')}">任务简报 ${icon('arrow')}</button>`:''}
   ${context?.access?.member?`<button class="secondary" data-my-tasks="active:0">${icon('blueprint')} 我的任务</button>`:''}
   ${context?.inbox?`<button class="secondary" data-inbox-page="0">协作收件${context.inbox.pending>0?` · ${e(context.inbox.pending)} 条待确认`:''}</button>`:''}
 </div>`;
 const reportTitle=report?.task&&report.task!==title?`<p class="record-meta">Agent 汇报 · ${e(report.task)}</p>`:'';
 const others=otherTasks.length?`<details class="context-details" data-details-key="station-active-tasks"><summary>其他进行中的任务 · ${otherTasks.length}${context.tasks.has_more?'+':''}</summary>${otherTasks.map(task=>`<button class="snapshot-row" data-live-context="${e(task.id)}"><strong>${e(task.title)}</strong>${icon('arrow')}</button>`).join('')}</details>`:'';
 const html=`<div class="personal-desk" data-state="${e(link.state)}"><div class="station-illustration" style="--station-accent:${row?.color||'#a9bdd7'}">${row?deskArt(row):icon('office')}<span class="station-state"><i></i>${e(linkStatusLabel(link.state))}</span></div><div class="station-work"><div class="station-identity"><span>${e(identity?.label||'工程师')}</span>${workMarker}${nomination}</div><h2>${e(title)}</h2>${reportTitle}${stationReport(summary,!!report?.summary)}${cloudTask||localTask||context?.inbox||context?.access?.member?actions:''}${value?.stale?'<p class="station-warning" role="status">本机暂时无法同步</p>':''}</div></div>${others}${agendas.length?`<div class="station-agendas"><span>相关议程</span>${agendas.slice(0,2).map(a=>`<button data-agenda="${e(a.id)}">${e(a.title)} ${icon('arrow')}</button>`).join('')}${agendas.length>2?`<button data-work-home="agendas">还有 ${agendas.length-2} 项</button>`:''}</div>`:''}`;
 const messages=(value?.snapshot?.messages||[]).slice().sort((a,b)=>(timestamp(b.created)||0)-(timestamp(a.created)||0)).slice(0,8);
 const items=messages.map(m=>({key:m.id,html:`<div class="conversation-meta"><span>${e(m.sender_name)}</span><time>${date((timestamp(m.created)||0)/1000)}</time></div><p>${e(humanLine(m.body,240)||'暂无可显示的文字')}</p>${detailButton(m.sender_name+' · 交流详情',m.body)}`}));
 return {html,empty:!messages.length,items:items.length?items:[{key:'empty',html:'<p class="muted">暂无交流</p>'}],history:messages.map(m=>`<article><strong>${e(m.sender_name)}</strong><p>${e(humanLine(m.body,240))}</p>${detailButton(m.sender_name+' · 交流详情',m.body)}</article>`).join('')};
}
export /* @chain-region operationItems | calls: map, timestamp, humanLine, local.push, slice, sort */ function operationItems(value){
 const operations=(value?.operations?.items||[]).map(v=>({key:'cloud-'+v.seq,at:v.last_at,text:v.action+(v.title?' · '+v.title:''),detail:v.title?`${v.action}\n${v.title}`:'',repeats:v.repeats}));
 const communications=(value?.operations?.communications||[]).map(v=>({key:'event-'+v.seq,at:v.created,event:v.seq,text:`收到${{question:'协作提问',answer:'协作答复',interface_change:'接口变更',blocked:'阻塞协调'}[v.kind]||'协作消息'} · ${v.message}`}));
 const local=(value?.local_activity||[]).map(v=>({key:'local-'+v.id,at:v.created,text:v.action}));
 const messages=(value?.snapshot?.messages||[]).map(v=>({key:'message-'+v.id,at:(timestamp(v.created)||0)/1000,text:`${v.sender===value.actor?'已发送交流':'收到 '+v.sender_name+' 的交流'} · ${humanLine(v.body,100)}`,detail:v.body}));
 const report=value?.snapshot?.agents?.[0]?.runtime?.work_report;
 if(report)local.push({key:'report-'+report.at,at:report.at,text:'Agent 已提交工作汇报'+(report.task?' · '+report.task:''),detail:report.summary});
 return [...operations,...communications,...local,...messages].sort((a,b)=>b.at-a.at).slice(0,80);
}
export /* @chain-region operationsHTML | calls: join, items.map, trim, v.text.replace, detailButton, e, date */ function operationsHTML(items,date){
 return items.map(v=>{
  // Grouping metadata belongs to the detail; the overview carries one readable line.
  const text=v.text.replace(/\s*[·，]?\s*同类(?:读取|操作)已归并\s*[·：:]?\s*\d+\s*次/g,'').trim()||'已读取最新信息';
  const detail=(v.detail||v.text)+(v.repeats>1?'\n同类操作已归并：'+v.repeats+' 次':'');
  const button=v.event?`<button class="read-detail" data-inbox-event="${v.event}">查看详情</button>`:v.detail||v.repeats>1?detailButton('操作详情',detail):'';
  return `<article class="activity-row" data-activity-id="${e(v.key)}"><time>${date(v.at)}</time><div class="activity-copy"><p><span>${e(text)}</span>${button}</p></div><i aria-hidden="true"></i></article>`;
 }).join('')||'<p class="activity-empty">暂无新的操作</p>';
}

export /* @chain-region updateOperations | calls: document.createElement, operationsHTML, Map, map, matchMedia, previous.get, previous.delete, old.querySelector … */ function updateOperations(list,items,date){
 const template=document.createElement('template');template.innerHTML=operationsHTML(items,date);
 const previous=new Map([...list.children].map(node=>[node.dataset.activityId,node]));
 const motion=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='reduced';
 let cursor=list.firstElementChild;
 for(const next of [...template.content.children]){
  const old=previous.get(next.dataset.activityId),node=old||next;
  if(old){
   previous.delete(next.dataset.activityId);
   if(old.innerHTML!==next.innerHTML){
    old.querySelector('time').textContent=next.querySelector('time').textContent;
    old.querySelector('p>span').textContent=next.querySelector('p>span').textContent;
    const before=old.querySelector('button'),after=next.querySelector('button');
    if(before&&after){
     for(const attr of [...before.attributes])if(!after.hasAttribute(attr.name))before.removeAttribute(attr.name);
     for(const attr of after.attributes)if(before.getAttribute(attr.name)!==attr.value)before.setAttribute(attr.name,attr.value);
     if(before.innerHTML!==after.innerHTML)before.innerHTML=after.innerHTML;
    }else if(after)old.querySelector('p').append(after);else before?.remove();
   }
  }
  if(node!==cursor)list.insertBefore(node,cursor);
  cursor=node.nextElementSibling;
  if(!old&&!motion&&list.dataset.initialized)node.animate([{opacity:0,transform:'translateY(-8px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
 }
 for(const node of previous.values())node.remove();
 list.dataset.initialized='true';
}
