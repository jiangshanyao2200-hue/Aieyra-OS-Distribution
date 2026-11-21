/* @file-map:start
文件: link/desktop/ui/collaboration.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/detail-view.mjs, link/desktop/ui/markdown.mjs
上游: link/desktop/ui/engineering.mjs, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  inboxPreview | function
  inboxHTML | function
  eventHTML | function
  checkpointHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {detailButton} from './detail-view.mjs';
const kinds={created:'任务建立',updated:'进度更新',checkpoint:'接续检查点',session_replaced:'Agent 接续',candidate:'候选成果',integrated:'成果整合',collaboration:'协作请求'};
export /* @chain-region inboxPreview | calls: join, inbox.events.map, e */ function inboxPreview(inbox){
 if(!inbox)return '';
 return `<section class="engineering-inbox" aria-label="协作收件"><div class="section-heading"><h3>协作收件 <span class="state-pill">${inbox.pending} 待确认</span></h3><button class="secondary" data-inbox-page="0">查看收件箱</button></div>${inbox.events.map(v=>`<button class="inbox-preview-row" data-inbox-event="${v.seq}"><span>${e(kinds[v.kind]||v.kind)}</span><strong>${e(v.title)}</strong><small>v${v.version}</small></button>`).join('')||'<p class="muted">目前没有待确认的协作消息。</p>'}${inbox.reset_required?'<p class="station-warning">部分历史记录已过期</p>':''}</section>`;
}
export /* @chain-region inboxHTML | calls: join, value.events.map, e, v.payload.signal.message.slice */ function inboxHTML(value){
 return `<div class="inbox-detail">${value.events.length?`<p><strong>${value.pending}</strong> 待 Agent 确认 · ${value.acknowledged} 已确认</p>`:''}${value.reset_required?'<p class="station-warning">部分历史记录缺失</p>':''}${value.events.map(v=>`<article class="inbox-row"><div class="conversation-meta"><span>${e(kinds[v.kind]||v.kind)}</span><span>${v.state==='acknowledged'?'Agent 已确认':'待 Agent 确认'}</span></div><button class="inbox-title" data-inbox-event="${v.seq}">${e(v.payload?.task?.title||'任务更新')}</button>${v.payload?.signal?`<p>${e(v.payload.signal.message.slice(0,160))}</p>`:''}</article>`).join('')||'<p class="empty">暂无协作消息</p>'}${value.has_more?`<button class="secondary" data-inbox-page="${value.cursor}">下一页</button>`:''}${value.events.length&&value.events[0].seq>1?'<button class="secondary" data-inbox-page="0">回到第一页</button>':''}</div>`;
}
export /* @chain-region eventHTML | calls: e */ function eventHTML(event){
 const task=event.payload?.task,signal=event.payload?.signal;
 return `<span class="state-pill">${event.state==='acknowledged'?'Agent 已显式确认':'待 Agent 确认'}</span><p>${e(kinds[event.kind]||event.kind)} · 任务 v${event.version}</p>${task?`<h3>${e(task.title)}</h3><p class="inbox-body">${e(task.note||'')}</p>`:''}${signal?`<p class="muted">${e({question:'协作提问',answer:'协作答复',interface_change:'接口变更',blocked:'阻塞协调'}[signal.kind]||signal.kind)}</p><p class="inbox-body">${e(signal.message)}</p>${signal.reply_to?`<button class="secondary" data-inbox-event="${signal.reply_to}">查看原请求</button>`:''}<button class="secondary" data-task="${e(signal.target_task_id)}">查看关联任务</button>`:''}${event.payload?.legacy_event?'<p>历史事件未保存正文，请核对当前任务。</p>':''}<button class="primary" data-task="${e(event.task_id)}">查看当前任务与检查点</button>`;
}
export /* @chain-region checkpointHTML | calls: e, detailButton, join, p.evidence_refs.map */ function checkpointHTML(checkpoint){
 if(!checkpoint)return '';
 const p=checkpoint.payload;
 return `<section class="checkpoint"><h3>接续进展</h3><dl class="task-detail"><dt>已经完成</dt><dd>${e(p.completed)}${detailButton('检查点 · 已完成',p.completed)}</dd><dt>接下来</dt><dd>${e(p.next_step)}${detailButton('检查点 · 下一步',p.next_step)}</dd>${p.blockers?`<dt>仍有阻塞</dt><dd>${e(p.blockers)}</dd>`:''}</dl><details class="context-details"><summary>检查点与证据</summary><p>检查点 v${checkpoint.version} · Agent 汇报</p><p>${p.evidence_refs.map(e).join('\n')||'未附证据引用'}</p></details></section>`;
}
