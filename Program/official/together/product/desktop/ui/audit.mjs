/* @file-map:start
文件: link/desktop/ui/audit.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/markdown.mjs
上游: link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  auditHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';

const actions={
 'admin.bootstrap':'创建管理账号','session.login':'账号登录','password.changed':'修改账号密码','admin.unlocked':'验证管理权限',
 'application.created':'提交加入申请','application.approved':'通过加入申请','application.rejected':'拒绝加入申请',
 'development.applied':'申请开发资格','development.approved':'通过开发资格','development.rejected':'拒绝开发资格',
 'member.moderated':'管理成员',
 'member.registered':'工程师加入','member.disabled':'禁用工程师账号','member.restored':'恢复工程师账号',
 'settings.updated':'更新项目设置','content.removed':'移除内容','code.published':'更新参考源码',
 'repositories.created':'添加参考仓库','releases.created':'添加下载版本',
 'agent.pair_created':'创建 Agent 接入','agent.activated':'Agent 已连接','agent.revoked':'撤销 Agent 接入',
 'agent.duplicate_retired':'停用重复 Agent','agent.prompt_confirmed':'Agent 确认协作规则',
 'agent.safety_confirmed':'Agent 确认安全边界','agent.local_confirmed':'验证本人工位','agent.cloud_ack':'验证收件通道',
 'goal.nominated':'提出阶段目标','goal.vote':'投目标票','goal.vote_withdrawn':'撤回目标票',
 'goal.established_by_admin':'运营方确立目标','goal.completed':'完成阶段目标','goal.active':'确立阶段目标',
 'goal.deferred':'暂缓阶段目标','goal.rejected':'否决阶段目标',
 'agenda.created':'创建议程','agenda.publish':'提交议程表决','agenda.vote':'投议程票',
 'agenda.approved':'通过议程','agenda.rejected':'否决议程','agenda.deferred':'暂缓议程',
 'agenda.cancelled':'取消议程','agenda.completed':'完成议程','agenda.complete':'提交议程完成记录',
 'agenda.assigned':'分配议程','agenda.resumed':'Agent 接续议程',
 'key.created':'创建议程密钥','key.revoked':'撤销议程密钥',
 'election.nominated':'报名参选','election.vote':'投职位票','election.withdrawn':'撤回参选',
 'election.elected':'确认当选负责人','election.closed':'结束本轮选举','election.resolved':'运营方调节任职',
 'election.authorized':'授予本次操作权限','election.executed':'Agent 执行授权操作',
 'discussion.comment':'发表讨论回应','discussion.removed':'移除讨论回应','developer-chat.removed':'移除群聊消息',
 'engineering.task_created':'建立协作任务','engineering.review':'提交复验记录','engineering.verified':'提交执行证据',
 'engineering.composed':'组合候选源码','engineering.imported':'导入共创源码',
 'engineering.integrated':'整合协作成果','engineering.promoted':'整合协作成果',
 'engineering.automatically_integrated':'融合已复验成果','engineering.goal_accepted':'验收阶段目标',
 'engineering.frozen':'冻结源码进入 Debug','engineering.released':'发布阶段版本',
 'engineering.handoff_offered':'发出议程接续邀请','engineering.handoff_accepted':'接受议程接续',
 'engineering.meeting_opened':'发起协作会议','engineering.meeting_closed':'保存会议结论',
};
const choices={support:'支持',oppose:'反对',abstain:'撤回选票',pass:'验证通过',fail:'验证失败',stable:'稳定版',development:'开发版',manager:'项目负责人',assistant:'开发助理'};

export /* @chain-region auditHTML | calls: Map, users.map, join, records.map, JSON.parse, names.get, String, test … */ function auditHTML(records,date,users=[]){
 const names=new Map(users.map(user=>[user.id,user.name]));
 return records.map(record=>{
  let moderation;try{if(record.action==='member.moderated')moderation=JSON.parse(record.detail);}catch{}
  const actionLabel=moderation?({ban:'封禁',unban:'解除封禁',mute:'禁言',unmute:'解除禁言'}[moderation.action]||'管理成员')+' · '+(names.get(record.object_id)||'工程师'):actions[record.action]||'项目操作记录';
  const raw=String(record.detail||''),note=moderation?.reason||choices[raw]||(/^[\s\S]*[\u3400-\u9fff]/u.test(raw)&&!/^\s*[{[]/.test(raw)?raw:'');
  return `<article class="audit-entry"><time>${e(date(record.created))}</time><div><div class="audit-action"><strong>${e(actionLabel)}</strong><span class="audit-actor">${e(record.user_id?names.get(record.user_id)||'工程师':'系统')}</span></div>${note?`<p>${e(note.slice(0,180))}${note.length>180?'…':''}</p>`:''}<details class="context-details"><summary>原始记录</summary><dl class="task-detail"><dt>操作</dt><dd><code>${e(record.action)}</code></dd>${record.object_id?`<dt>对象</dt><dd><code>${e(record.object_id)}</code></dd>`:''}${record.user_id?`<dt>操作人编号</dt><dd><code>${e(record.user_id)}</code></dd>`:''}${raw?`<dt>原始详情</dt><dd>${e(raw)}</dd>`:''}</dl></details></div></article>`;
 }).join('')||'<p class="empty">暂无操作记录</p>';
}
