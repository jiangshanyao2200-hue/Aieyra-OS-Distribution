/* @file-map:start
文件: link/desktop/ui/elections.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/detail-view.mjs, link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs
上游: link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test AIDEBUG/controls.test.mjs, AIDEBUG/live-review.cjs, link/DOCS/AIDEBUG-LIVE.md
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  roleName | function
  electionHTML | function
  replacementHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {icon} from './icons.mjs';
import {detailButton} from './detail-view.mjs';
export const /* @chain-region roleName */ roleName=role=>role==='manager'?'项目负责人':'开发助理';
export const electionGuide=`Agent 参选与授权操作（规则 v3）
使用安装目录 resources/link/runtime/python/python.exe 运行 Agent/proposal.py，也可用本机 Python 3。
每次调用加 --key-file "你自己的凭据路径"。先运行 status 确认六项通过，再用 goals、agendas、election --resource state 读取当前状态。
报名：election --action nominate --body-file "参选.json"。示例 JSON：
{"request_id":"nominate-2026-001","role":"manager","statement":"我将根据高票目标制定可验证的计划，并公开处理其他候选人的方案。","commitment":"每天投入一小时，及时同步阻塞和进度。","goal":{"title":"建立可靠的协作消息机制","summary":"让不同工程师的 Agent 在断线恢复后继续协作并保留处理状态。","acceptance":"验证消息去重、重连恢复和权限隔离，记录可复现结果。"},"agenda":{"title":"实现消息接收与回执验证","summary":"定义消息状态及边界，完成可复现的收件验证。","plan":"先阅读现有接口，限定变更范围，再实现消息确认和去重，最后由其他工程师独立复验。","acceptance":"断线重连不丢消息，同一消息不重复执行。","target":"next"}}
role 可选 manager / assistant；每人每轮只参选一个职位。已有本人目标时，用 goal_id 替换 goal；不能重复创建本轮目标。报名生成配套议程草案，后续 publish --id "agenda_id" --request-id "固定请求ID" 发起独立议程投票。
人类在 Link 投职位、目标与议程票，分别计票。24 小时结束后形成前五高票池，人员票至少三票且独占最高票才当选；平票或缺额交运营方处理。
当选负责人在界面选择目标或确认议程并授权后，取得 authorization_id。先运行 election --resource authorization --id "授权ID" 核对精确内容，再用 election --action execute --body-file "执行.json" 执行。
执行.json：{"request_id":"decision-2026-001","authorization_id":"界面提供的授权ID"}
授权十分钟有效，只能由管理 Agent 执行。管理 Agent 使用 election --resource management 查询申请，使用 election --action manage --body-file "管理操作.json" 提交当前授权范围内的操作。重新竞选期间用 election --action nominate-replacement --body-file "换届参选.json" 参选，正文包含 request_id、cycle_id、id 和 statement。
写入结果未知先运行 receipt --request-id "原请求ID"；确认需要恢复时原样重试，保持同一请求ID及内容。更换 Agent 后用 agendas 查本人草稿，agenda-show --id "议程ID" 读版本，再 agenda-resume --id "议程ID" --body-file "接续.json"；文件含 request_id、version、previous_agent_id。`;
export /* @chain-region electionHTML | calls: e, Date.now, date, join, data.pool.map, map, Object.entries, data.pool.find … */ function electionHTML(data,date,admin=false){
 if(!data)return '<section class="stage-leadership"><p class="muted">正在读取本阶段负责人…</p></section>';
 if(data.error)return `<section class="stage-leadership"><p class="error">${e(data.error)}</p><button class="secondary" data-action="refresh">重新读取负责人</button></section>`;
 if(data.legacy_cycle)return '';
 if(!data.cycle&&!data.candidates.length)return '';
 const active=data.cycle?.status==='voting'&&data.cycle.closes>Date.now()/1000,settled=!!data.selected;
 const status=!data.cycle?'随目标一起准备参选方案':active?`${date(data.cycle.closes)} 截止`:data.manager_deadline?`任期至 ${date(data.manager_deadline)}`:settled?'负责人待确定':'投票结束 · 等待确定目标';
 const pool=data.pool?.length?`<section class="election-pool"><div class="section-heading"><h3>${settled?'本阶段目标选择记录':'高票目标池'}</h3>${data.can_select?'<button class="primary" data-action="election-select">选择目标并授权</button>':''}</div><ol>${data.pool.map(p=>`<li><button data-goal="${p.candidate_id}">${e(p.title)}</button><span>支持 ${p.support} · 反对 ${p.oppose} · ${e(p.author_name)}</span></li>`).join('')}</ol>${settled?`<p>${e(data.selection_reason)}</p>${Object.entries(data.deferred_reasons||{}).map(([id,reason])=>`<p class="muted">暂缓 ${e(data.pool.find(p=>p.candidate_id===id)?.title||id)}：${e(reason)}</p>`).join('')}`:''}</section>`:'';
 return `<section class="stage-leadership" data-contesting="${active}" aria-label="本阶段负责人"><div class="election-summary"><div class="section-heading"><div><h3>${icon('milestones')}阶段负责人</h3></div></div><p class="election-status">${e(status)}</p><div class="election-roles">${['manager','assistant'].map(role=>{const term=data.roles?.[role],name=term?.name||data.candidates.find(c=>c.id===term?.candidate_id)?.name;return `<div><small>${roleName(role)}</small><strong>${e(term?(name||'已确认工程师'):'待确定')}</strong><span>${term?'已当选':active?'职位票选出':''}</span></div>`;}).join('')}</div></div>
 ${!settled?pool:''}
 <details class="election-records" data-details-key="election-records" data-phase="${settled?'settled':data.candidates.length?'voting':'empty'}" ${!settled&&data.candidates.length?'open':''}><summary>${settled?'查看本阶段参选与选票':'参选方案与职位票'}</summary><div class="election-record-body">${settled?pool:''}<details class="context-details" data-details-key="voting-rules"><summary>职位票与目标票分别计算</summary><p>每个职位一票，至少 3 票且独占最高票当选。目标票与职位票分别计数；每张选票及理由公开可查。</p></details><div class="quests">${data.candidates.map(c=>`<article class="quest election-candidate" data-candidate-card="${c.id}"><span class="eyebrow">${roleName(c.role)}${c.withdrawn?' · 已退出':''}</span><div class="candidate-person"><span class="candidate-avatar" aria-hidden="true">${e(Array.from(c.name||'E')[0])}</span><h3>${e(c.name)}</h3><div class="candidate-support"><b data-vote-number="candidate:${c.id}">${c.support}</b><small>支持票</small></div></div><p class="candidate-statement">${e(c.statement)}</p><div class="candidate-threshold" aria-label="至少三票且独占最高票方可当选"><i style="width:${Math.min(100,c.support/3*100)}%"></i></div><p class="candidate-goal">${icon('goals')}${e(c.goal_title)}</p>${detailButton('投入承诺与配套议程',c.commitment+'\n\n'+c.agenda_title,{label:'投入承诺与配套议程'})}<div class="actions"><button class="secondary" data-candidate="${c.id}">方案与选票 ${icon('arrow')}</button>${admin&&data.cycle?.status==='active'&&!c.withdrawn?`<button class="secondary" data-election-resolve="${c.role}:${c.id}">运营方任职调节</button>`:''}${active&&!c.withdrawn?`<button class="${c.my_vote?'secondary':'primary'}" data-election-vote="${c.role}:${c.id}" aria-pressed="${c.my_vote}">${c.my_vote?'已支持 · 改写理由':'支持参选'}</button>${c.my_vote?`<button data-election-withdraw="${c.role}">撤回职位票</button>`:''}`:''}</div></article>`).join('')||'<p class="empty">尚无参选方案</p>'}</div>${data.offset||data.has_more?`<div class="pager"><button data-election-page="${Math.max(0,(data.offset||0)-20)}" ${data.offset?'':'disabled'}>上一页</button><button data-election-page="${(data.offset||0)+20}" ${data.has_more?'':'disabled'}>下一页</button></div>`:''}</div></details></section>`;
}
export /* @chain-region replacementHTML | calls: includes, e, join, map, date, record.candidates.map */ function replacementHTML(data,date){
 const record=data?.replacement;
 if(!record||!['recall','electing','unfilled'].includes(record.state)){
  return data?.can_start_recall?'<button class="secondary" data-action="start-recall">发起弹劾</button>':'';
 }
 if(record.state==='recall'){
  return `<section class="election-pool" aria-label="弹劾投票"><h3>弹劾投票</h3><p>${e(record.reason)}</p><p>${record.support} / ${record.electorate} 支持 · 70% 触发重新竞选</p>${record.eligible?`<div class="actions">${['support','oppose','abstain'].map((choice,index)=>`<button data-recall-vote="${choice}" aria-pressed="${record.my_recall_vote===choice}">${['支持重新竞选','反对','弃权'][index]}</button>`).join('')}</div>`:''}</section>`;
 }
 if(record.state==='unfilled')return '<section class="election-pool"><h3>重新竞选结束，负责人待补选</h3></section>';
 return `<section class="election-pool" aria-label="项目负责人重新竞选"><h3>项目负责人重新竞选</h3><p>${e(record.reason)} · ${e(date(record.closes))} 截止</p><ol>${record.candidates.map(candidate=>`<li><div><strong>${e(candidate.name)}</strong><p>${e(candidate.statement)}</p></div><span>${candidate.support} 票</span>${record.eligible?`<button data-replacement-vote="${e(candidate.id)}" aria-pressed="${record.my_candidate===candidate.id}">支持</button>`:''}</li>`).join('')}</ol></section>`;
}

