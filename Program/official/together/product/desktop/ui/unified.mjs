/* @file-map:start
文件: link/desktop/ui/unified.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/controls.mjs, link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs
上游: AIDEBUG/controls.test.mjs, link/desktop/ui/index.html, link/desktop/ui/workspace.mjs
链路: shared-ui, governance
验证: AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, tests/test_u81_runtime.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  broadcastHTML | function
  milestoneStyle | function
  milestoneHTML | function
  stageHTML | function
  homeHTML | function
  pager | function
  managementHTML | function
  releaseVotesHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {pagerHTML} from './controls.mjs';
import {escape as e} from './markdown.mjs';
import {icon} from './icons.mjs';

export /* @chain-region broadcastHTML | calls: join, milestones.map, milestoneHTML */ function broadcastHTML(milestones,date){
 const feed=milestones.map(item=>milestoneHTML(item,date)).join('');
 return `<section class="home-milestones broadcast-dialog" data-shared-broadcast aria-label="共创动态">${feed?`<ol tabindex="0" aria-label="最近共创事件">${feed}</ol>`:'<p class="empty">暂无共创动态</p>'}</section>`;
}

const milestoneStyles={
 'election.nominated':['报名参选','elections','election'],
 'election.resolved':['负责人已确定','milestones','election',true],
 'election.recall_opened':['弹劾投票已发起','elections','election'],
 'election.replacement_opened':['负责人重新竞选','elections','election'],
 'agenda.approved':['议程通过','agendas','work'],
 'agenda.complete':['议程已完成','check','success',true],
 'engineering.task_created':['已安排施工','blueprint','work'],
 'engineering.integrated':['已合入云代码','merge','success',true],
 'engineering.automatically_integrated':['已合入云代码','merge','success',true],
 'engineering.goal_accepted':['目标通过验收','goals','success',true],
 'goal.completed':['阶段已完成','milestones','release',true]
};

export /* @chain-region milestoneStyle | calls: Object.hasOwn */ function milestoneStyle(item){
 if(item.action==='election.elected')return [item.result==='assistant'?'开发助理当选':'项目负责人当选','milestones','election',true];
 if(item.action==='engineering.verified')return item.result==='pass'?['版本复验通过','check','success']:['版本复验发现问题','search','attention'];
 if(item.action==='engineering.released')return [item.result==='stable'?'稳定版发布':'开发版发布','release','release',true];
 return Object.hasOwn(milestoneStyles,item.action)?milestoneStyles[item.action]:null;
}

/* @chain-region milestoneHTML | calls: milestoneStyle, Date, Number.isFinite, time.getTime, find, test, item.revision.slice, e … */ function milestoneHTML(item,date,featured=false){
 const style=milestoneStyle(item);
 const time=new Date(item.created*1000);
 if(!style||!Number.isFinite(time.getTime()))return '';
 const [label,symbol,tone,achievement]=style;
 const target=[
   ['candidate',item.candidate_id,'查看参选方案'],
   ['task',item.task_id,'查看施工任务'],
   ['engineering-release-id',item.release_id,'查看版本与产物'],
   ['snapshot',item.revision,/^[a-f0-9]{64}$/.test(item.revision||'')?'查看源码 '+item.revision.slice(0,10):'查看源码版本'],
   ['agenda',item.agenda_id,'查看议程'],
 ].find(([,id])=>id);
 const title=target?`<button class="milestone-link" data-${target[0]}="${e(target[1])}">${e(item.title||target[2])} ${icon('arrow')}</button>`
   :item.title?`<span>${e(item.title)}</span>`:'';
 return `<li data-milestone="${e(item.seq)}" data-tone="${tone}" data-achievement="${!!achievement}"${featured?' data-featured="true"':''}>
   <span class="milestone-icon">${icon(symbol)}</span>
   <div class="milestone-description"><strong>${e(label)}</strong><div>${title}${item.actor?`<span>${e(item.actor)}</span>`:''}</div></div>
   <time datetime="${time.toISOString()}">${e(date(item.created))}</time>
 </li>`;
}

/* @chain-region stageHTML | calls: filter, agendas.filter, steps.find, e, icon, Number.isSafeInteger, join, steps.map */ function stageHTML({board,election,overview,tasks,members,adopted,electionContent}){
 const manager=election?.roles?.manager;
 const contest=election?.replacement?.state==='electing'||election?.cycle?.status==='voting';
 const agendas=(board.agendas||[]).filter(item=>board.cycle&&item.goal_id===board.cycle.id);
 const working=agendas.filter(item=>item.status==='approved').length;
 const finished=agendas.filter(item=>item.status==='completed').length;
 const taskRows=tasks?.tasks||[];
 const stageWork=tasks?.counts||{};
 const workStatus=stageWork.blocked?'有施工阻塞':stageWork.review?'有任务待整合':
   stageWork.working?'施工进行中':stageWork.ready?'有任务待开工':
   finished?'等待阶段验收':stageWork.integrated?'已有任务合入':'等待施工安排';
 const workflow=overview?.workflow;
 const phase=board.cycle&&workflow?.cycle_id===board.cycle.id?workflow.phase?.phase:null;
 const steps=[
   {target:'leadership',title:'负责人',symbol:'elections',tone:'election',done:!!manager,link:!!electionContent,
    status:manager?(manager.name||'负责人已就任'):contest?'项目负责人竞选中':'等待竞选负责人'},
   {target:'goals',title:'阶段目标',symbol:'goals',tone:'work',done:adopted.length>0,link:!!board.candidates?.length,
    status:adopted.length?`已采纳 ${adopted.length} 项`:board.candidates?.length?'等待采纳目标':'等待阶段目标'},
   {target:'agendas',title:'议程',symbol:'agendas',tone:'success',done:working+finished>0,link:agendas.length>0,
    status:working?`${working} 项执行中`:finished?`${finished} 项已完成`:agendas.length?'等待议程通过':'等待议程'},
   {target:'construction',title:'施工',symbol:'blueprint',tone:'release',done:phase==='development',link:taskRows.length>0,
    status:phase==='development'?'开发版已发布':phase==='debug'?'正在复验':workStatus}
 ];
 const current=steps.find(step=>!step.done);
 const headline=current?.status||'开发版已发布';
 const previous=board.cycle?null:overview?.previous_stable;
 return `<section class="home-situation" aria-labelledby="home-situation">
   <div class="home-stage-heading"><div><p>阶段进度</p><h1 id="home-situation">${e(headline)}</h1>
   ${previous?`<button class="home-previous-release secondary" data-engineering-release-id="${e(previous.id)}">${icon('release')}<span>上一阶段稳定版</span><strong>${e(previous.name)}</strong>${icon('arrow')}</button>`:''}</div>
   ${Number.isSafeInteger(members?.total)?`<button class="home-stage-members" data-home-section="members" ${members.members?.length?'':'disabled'}>${icon('members')}<b>${members.total}</b> 位工程师</button>`:''}</div>
   <ol class="home-stage-steps">${steps.map(step=>{
    const contents=`<span class="home-stage-icon">${icon(step.symbol)}${step.done?`<i aria-hidden="true">${icon('check')}</i>`:''}</span><span class="home-stage-text"><strong>${step.title}</strong><span>${e(step.status)}</span></span>`;
    const state=step.done?'done':step===current?'current':'waiting';
    return `<li data-stage-step="${step.target}" data-tone="${step.tone}" data-step-state="${state}" ${step===current?'aria-current="step"':''}>${step.link?`<button class="home-stage-step" data-home-section="${step.target}">${contents}</button>`:`<div class="home-stage-step">${contents}</div>`}</li>`;
   }).join('')}</ol>
 </section>`;
}

export /* @chain-region homeHTML | calls: some, Object.values, electionHTML, sort, candidates.filter, milestones.find, milestoneStyle, join … */ function homeHTML({board,election,overview,tasks,members,milestones=[],milestoneView='all',memberPage,goalCard,agendaCard,electionHTML,blueprintHTML,avatar,attributes,date}){
 const candidates=board.candidates||[],agendas=board.agendas||[];
 const elected=Object.values(election?.roles||{}).some(Boolean);
 const electionContent=election?.candidates?.length||elected||election?.pool?.length||election?.replacement?electionHTML(election,date):'';
 const adopted=candidates.filter(c=>c.adopted_rank).sort((a,b)=>a.adopted_rank-b.adopted_rank);
 const goals=adopted.length?adopted:candidates;
 const latestAchievement=milestones.find(item=>milestoneStyle(item)?.[3]);
 const feed=milestones.map(item=>milestoneHTML(item,date,item===latestAchievement)).join('');
 const canFilter=milestones.some(item=>milestoneStyle(item)?.[3])&&milestones.some(item=>milestoneStyle(item)&&!milestoneStyle(item)[3]);
 const view=canFilter&&milestoneView==='achievements'?'achievements':'all';
 return `<div class="unified-home">${stageHTML({board,election,overview,tasks,members,adopted,electionContent})}
 ${feed?`<section class="home-milestones" data-view="${view}" aria-labelledby="home-milestones-title">
   <div class="milestone-heading"><h2 id="home-milestones-title">${icon('broadcast')}共创播报</h2>
   ${canFilter?`<div class="milestone-filters" role="group" aria-label="播报筛选"><button data-milestone-view="all" aria-pressed="${view==='all'}">全部</button><button data-milestone-view="achievements" aria-pressed="${view==='achievements'}">${icon('milestones')}成果</button></div>`:''}</div>
   <ol tabindex="0" aria-label="最近共创事件">${feed}</ol></section>`:''}
 ${goals.length?`<section id="home-goals" tabindex="-1" class="home-goals" aria-label="阶段目标">${goals.map(goalCard).join('')}</section>`:''}
 ${electionContent?`<div id="home-leadership" tabindex="-1">${electionContent}</div>`:''}
 ${agendas.length?`<section id="home-agendas" tabindex="-1" class="home-agendas quests" aria-label="阶段议程">${agendas.map(agendaCard).join('')}</section>`:''}
 ${tasks?.tasks?.length?`<section id="home-construction" tabindex="-1" class="home-construction" aria-label="施工图">${blueprintHTML(overview,tasks)}</section>`:''}
 ${members?.members?.length?`<section id="home-members" tabindex="-1" class="home-members" aria-label="成员"><div class="members">${members.members.map(member=>`<button class="member" data-member="${e(member.id)}" ${attributes(member)}>${avatar(member)}<span>${e(member.name)}</span></button>`).join('')}</div>${memberPage||members.has_more?pagerHTML({attribute:'data-member-page',previous:-1,next:1,page:memberPage+1,canPrevious:memberPage>0,canNext:members.has_more,label:'成员分页'}):''}</section>`:''}</div>`;
}

const /* @chain-region pager | calls: pagerHTML, Math.max, Math.floor */ pager=(kind,start,next,size)=>start||next!==null?pagerHTML({attribute:'data-management-page',previous:kind+':'+Math.max(0,start-size),next:kind+':'+(next??start),page:Math.floor(start/size)+1,canPrevious:start>0,canNext:next!==null}):'';
export /* @chain-region managementHTML | calls: join, applications.applications.map, e, pager, data.users.map, avatar, attributes, Date.now … */ function managementHTML(data,applications,{attributes,avatar,date,auditHTML}){
 return `<div class="management-grid"><section class="management-section"><h2>申请 <small>${data.counts?.pending||0}</small></h2><div class="admin-list">${applications.applications.map(a=>`<article><div class="row between"><strong>${e(a.name)}</strong><span>${{pending:'待审核',approved:'已同意',rejected:'已拒绝'}[a.status]}</span></div><details data-details-key="application-${e(a.id)}"><summary>申请说明</summary><p>${e(a.about)}</p><p>${e(a.participation)}</p></details>${a.status==='pending'?`<div class="actions"><button data-review="${a.id}:approved">同意</button><button data-review="${a.id}:rejected">拒绝</button></div>`:''}</article>`).join('')||'<p class="empty">暂无申请</p>'}</div>${pager('applications',data.offsets.applications,applications.has_more?data.offsets.applications+10:null,10)}</section>
 <section class="management-section"><h2>成员 <small>${data.counts?.members||0}</small></h2><div class="admin-list">${data.users.map(u=>`<article class="row between"><div class="row">${avatar(u)}<strong ${attributes(u)}>${e(u.name)}</strong></div><small>${u.disabled?'已封禁':u.muted_until>Date.now()/1000?'禁言中':u.role==='admin'?'超管':u.membership==='approved'?'工程师':'待加入'}</small></article>`).join('')}</div>${pager('members',data.offsets.members,data.next.members,20)}</section>
 <section class="management-section"><h2>议程</h2><div class="admin-list">${data.agendas.map(a=>`<article class="row between"><strong>${e(a.title)}</strong><button data-agenda="${e(a.id)}">查看</button></article>`).join('')||'<p class="empty">暂无议程</p>'}</div>${pager('agendas',data.offsets.agendas,data.next.agendas,20)}</section>
 <section class="management-section"><h2>记录</h2><div class="audit">${auditHTML(data.audit,date,data.users)}</div>${pager('audit',data.offsets.audit,data.next.audit,20)}</section></div>`;
}

export /* @chain-region releaseVotesHTML | calls: join, data.proposals.map, e, map */ function releaseVotesHTML(data){
 if(!data?.proposals?.length)return '';
 return `<section class="release-ballots" aria-label="稳定版发布意见">${data.proposals.map(p=>`<article class="release-ballot"><div><span class="state-pill">${p.state==='published'?'已发布':p.state==='stale'?'已更新':'征求发布意见'}</span><h3>${e(p.name)}</h3><p>${e(p.notes)}</p></div><div class="release-support"><strong>${p.support} / ${p.electorate}</strong><span>支持</span></div><div class="release-vote-meter"><i style="width:${p.electorate?p.support/p.electorate*100:0}%"></i></div>${p.state==='voting'&&p.eligible?`<div class="actions">${['support','oppose'].map(choice=>`<button data-release-vote="${e(p.id)}:${choice}" aria-pressed="${p.my_vote===choice}">${choice==='support'?'支持发布':'反对'}</button>`).join('')}</div>`:''}</article>`).join('')}</section>`;
}
