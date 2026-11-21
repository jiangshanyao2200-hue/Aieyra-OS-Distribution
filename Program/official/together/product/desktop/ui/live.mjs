/* @file-map:start
文件: link/desktop/ui/live.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/engineering.mjs, link/desktop/ui/markdown.mjs
上游: AIDEBUG/live.test.cjs, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/live.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  short | function
  next | function
  liveEntryHTML | function
  liveOverviewHTML | function
  queueHTML | function
  roomsHTML | function
  draftsHTML | function
  livePageHTML | function
  roomHTML | function
  planHTML | function
  contextHTML | function
  pheromonesHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {taskStateLabel} from './engineering.mjs';
const /* @chain-region short | calls: e, slice */ short=v=>e((v||'').slice(0,12));
const labels={queued:'等待组合',verifying:'等待精确复验',blocked:'有冲突待协调',integrated:'已融合',cancelled:'已取消',superseded:'已更新'};
const blockers={exact_independent_vm_verification_required:'等待作者与独立工程师复验',verification_failed:'发现失败记录，等待修复',repository_version_conflict:'云代码已更新，需要重新组合',composition_task_changed:'任务已更新，需要重新组合',dependency_not_integrated:'等待前置工作融合'};
const /* @chain-region next */ next=(kind,value)=>value.next_offset!=null?`<button class="secondary" data-live-page="${kind}" data-offset="${value.next_offset}">继续查看</button>`:'';
const liveStatus='<p class="live-status station-warning" role="status" hidden></p>';
export /* @chain-region liveEntryHTML */ function liveEntryHTML(){return '<div class="actions live-entry"><button class="secondary" data-action="live-overview">持续协作</button></div>';}
export /* @chain-region liveOverviewHTML | calls: queueHTML, next, roomsHTML, draftsHTML */ function liveOverviewHTML({queue,rooms,drafts}){
 return `${liveStatus}<section class="dialog-section"><h3>待融合成果</h3>${queueHTML(queue)}${next('queue',queue)}</section><section class="dialog-section"><h3>相关小会议</h3>${roomsHTML(rooms)}${next('rooms',rooms)}</section><details class="context-details" data-details-key="my-cloud-drafts"><summary>我的云端草稿${drafts.drafts.length?' · '+drafts.drafts.length:''}</summary>${draftsHTML(drafts)}${next('drafts',drafts)}</details>`;
}
export /* @chain-region queueHTML | calls: join, value.queue.map, e, JSON.stringify, short */ function queueHTML(value){return value.queue.map(q=>`<article class="verification-row"><strong>${e(labels[q.state]||'状态待核对')}</strong>${q.blocker?`<p class="station-warning">${e(blockers[q.blocker]||'待核对融合条件')}</p>`:''}${q.conflicts?.length?`<p class="station-warning">${q.conflicts.length} 处源码冲突需要协调</p><details class="context-details"><summary>冲突位置</summary><pre class="snapshot-source">${e(JSON.stringify(q.conflicts,null,2))}</pre></details>`:''}<div class="actions"><button class="secondary" data-task="${e(q.task_id)}">相关任务</button></div><details class="context-details"><summary>版本依据</summary><p>候选 ${short(q.candidate)}${q.prepared?' · 组合 '+short(q.prepared):''}</p><p>${q.complete_task?'融合成功后关闭本任务。':'本次为增量成果，融合后任务继续。'}</p></details></article>`).join('')||'<p class="muted">暂无待融合成果</p>';}
export /* @chain-region roomsHTML | calls: join, value.rooms.map, e */ function roomsHTML(value){return value.rooms.map(r=>`<button class="snapshot-row" data-live-room="${e(r.id)}"><div><strong>${e(r.title)}</strong><small>${r.state==='open'?'讨论中':'已结束'}${(r.seen_version||0)<r.version?' · 有未确认更新':''}</small></div><span aria-hidden="true">↗</span></button>`).join('')||'<p class="muted">暂无会议</p>';}
export /* @chain-region draftsHTML | calls: join, value.drafts.map, e, short */ function draftsHTML(value){return value.drafts.map(d=>`<article class="verification-row"><strong>${e(d.message)}</strong><details class="context-details"><summary>版本依据</summary><p>草稿 ${short(d.id)} · 基础 ${short(d.base)}</p></details></article>`).join('')||'<p class="muted">尚无云端草稿</p>';}
export /* @chain-region livePageHTML | calls: kind, next */ function livePageHTML(kind,value){return liveStatus+({queue:queueHTML,rooms:roomsHTML,drafts:draftsHTML})[kind](value)+next(kind,value);}
export /* @chain-region roomHTML | calls: join, value.messages.map, e, m.author.slice, r.actions.map, r.members.find, a.owner.slice, r.members.map */ function roomHTML(value){
 const r=value.room;
 return `${liveStatus}<p class="room-state">${r.state==='open'?'讨论中':'会议已结束'}</p>${value.messages.map(m=>`<article class="verification-row"><strong>${e(m.name||m.author.slice(0,8))}</strong><p class="live-message">${e(m.message)}</p></article>`).join('')||'<p class="muted">暂无消息</p>'}${value.has_more?`<button class="secondary" data-live-room="${e(r.id)}" data-after="${value.cursor}">继续阅读消息</button>`:''}${r.summary?`<section class="dialog-section"><h3>会议结论</h3><p class="live-message">${e(r.summary)}</p>${r.actions.map(a=>`<p>${e(r.members.find(m=>m.user_id===a.owner)?.name||a.owner.slice(0,8))}：${e(a.action)}</p>`).join('')}</section>`:''}<details class="context-details"><summary>参与与确认</summary>${r.members.map(m=>`<p>${e(m.name)} · ${(m.seen_version||0)>=r.version?'已确认当前更新':'待确认更新'}${m.accepted_version===r.version?' · 已接受行动项':''}</p>`).join('')}</details>`;
}
export /* @chain-region planHTML | calls: join, p.steps.map, e */ function planHTML(value){const p=value.plan;return `<details class="context-details" data-details-key="durable-plan"><summary>计划与进展</summary>${p.steps.length?`<ol>${p.steps.map(s=>`<li>${e(s)}</li>`).join('')}</ol><p>${e(p.progress)}</p><p>下一步：${e(p.next_step)}</p>`:'<p class="muted">暂无计划</p>'}</details>`;}
export /* @chain-region contextHTML | calls: taskStateLabel, join, map, e, short, value.meetings.map, includes, planHTML … */ function contextHTML(value){
 const {task,plan,repository}=value,checkpoint=task?.checkpoint;
 const nextStep=plan?.next_step||checkpoint?.next_step,progress=plan?.progress||checkpoint?.completed||task?.note;
 const status=taskStateLabel(task?.state);
 const dependencies=(value.dependencies||[]).map(dep=>`<button class="snapshot-row task-workbench-row" data-task="${e(dep.id)}"><strong>${e(dep.title)}</strong><span class="state-pill">${e(taskStateLabel(dep.state))}</span><small>v${e(dep.version)}</small></button>`).join('');
 const taskContext=task?`<section class="dialog-section current-task">
   <h3>${e(task.title)}</h3><p class="record-meta">${status?status+' · ':''}任务 v${e(task.version)}${task.base?` · 源码 <code>${short(task.base)}</code>`:''}</p>
   ${repository?.cloud&&task.base&&repository.cloud!==task.base?`<p class="station-warning">云代码已更新至 <code>${short(repository.cloud)}</code></p>`:''}
   <dl class="task-detail">${nextStep?`<dt>下一步</dt><dd>${e(nextStep)}</dd>`:''}${progress?`<dt>进展</dt><dd>${e(progress)}</dd>`:''}
   ${checkpoint?.blockers?`<dt>阻塞</dt><dd>${e(checkpoint.blockers)}</dd>`:''}${task.acceptance?`<dt>验收标准</dt><dd>${e(task.acceptance)}</dd>`:''}</dl>
   <div class="actions">
     <button class="secondary" data-task-records="checkpoints:${e(task.id)}:0">检查点历史</button>
     <button class="secondary" data-task-records="revisions:${e(task.id)}:0">源码版本与复验</button>
     <button class="secondary" data-task="${e(task.id)}">任务详情</button>
     <button class="secondary" data-agenda="${e(task.agenda_id)}">关联议程</button>
   </div>
 </section>`:'';
 const meetings=value.meetings.map(m=>`<button class="snapshot-row" data-live-room="${e(m.id)}"><div><strong>${e(m.title)}</strong><small>${e(m.summary||'讨论中')}${m.unread?' · 待确认':''}</small></div><span aria-hidden="true">↗</span></button>`).join('');
 return `${liveStatus}${task?`<div class="actions task-workbench-back"><button class="secondary" data-my-tasks="${['integrated','cancelled'].includes(task.state)?'all':'active'}:0">我的任务</button></div>`:''}${taskContext}
 ${dependencies?`<section class="dialog-section"><h3>前置任务</h3>${dependencies}${value.dependencies_truncated?`<button class="secondary" data-station-brief="${e(task.id)}">查看全部前置任务</button>`:''}</section>`:''}
 ${plan?planHTML({plan}):''}${meetings?`<section class="dialog-section"><h3>相关小会议</h3>${meetings}</section>`:''}
 <details class="context-details" data-details-key="current-work-rules"><summary>协作规则</summary><ol class="work-rules">${value.rules.map(r=>`<li>${e(r)}</li>`).join('')}</ol></details>`;
}
export /* @chain-region pheromonesHTML | calls: Date.now, filter, join, rows.map, e, Math.max, Math.ceil */ function pheromonesHTML(value,now=Date.now()/1000){
 const rows=(value.annotations||[]).filter(p=>p.current_state==='active'&&p.expires>now);
 return rows.length?`<aside class="code-pheromones" aria-label="当前代码线索"><h3>当前代码线索</h3>${rows.map(p=>`<p><strong>${e(p.author_name||'工程师')}</strong> · ${e(p.message)} <small>约 ${Math.max(1,Math.ceil((p.expires-now)/60))} 分钟后失效</small></p>`).join('')}</aside>`:'';
}
