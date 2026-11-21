/* @file-map:start
文件: link/desktop/situation.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/station-overview.test.cjs, link/desktop/onboarding.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/station-overview.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  situation | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// One fact snapshot serves Agent context and the human overview.
const phases={awaiting_goal:'等待新目标',nominating:'正在征集目标',voting:'目标与负责人投票中',active:'正在推进阶段目标',completed:'本阶段已完成',deferred:'等待新一轮',building:'正在独立开发与分批整合',debug:'集中 Debug，核验固定版本',development:'开发版试用与调试',stable:'稳定版已确认'};
/* @chain-region situation | calls: find, Object.entries, Set, map, agendas.filter, taskAgendas.has, includes, goals.filter … */ function situation({access,cycle,goals=[],agendas=[],leadership,engineering,tasks,participants,observed_at}){
 const role=Object.entries(leadership?.roles||{}).find(([,term])=>term?.user_id===access.user.id)?.[0]||'engineer';
 const labels={manager:'项目负责人',assistant:'开发助理',engineer:'工程师'};
 const taskAgendas=new Set((tasks?.items||[]).map(t=>t.agenda_id));
 const related=agendas.filter(a=>a.own||a.assigned||taskAgendas.has(a.id)||role!=='engineer'&&['approved','voting'].includes(a.status));
 const counts=engineering?.counts||{},phase=engineering?.workflow?.phase?.phase||cycle?.status||'awaiting_goal';
 return {version:2,observed_at,phase,label:phases[phase]||'项目推进中',
   adopted_goals:goals.filter(g=>g.adopted_rank).map(g=>({id:g.id,title:g.title})),
   progress:{working:counts.working||0,blocked:counts.blocked||0,review:counts.review||0,integrated:counts.integrated||0,total:Object.values(counts).reduce((a,b)=>a+b,0)},
   participants:{total:participants.total,working:engineering?.activity||null},
   identity:{role,label:labels[role],focus:role==='manager'?'目标推进与议程协调':role==='assistant'?'协助跟进议程与核验进展':'本人任务与直接依赖',candidacy:leadership?.candidacy&&!leadership.candidacy.withdrawn?leadership.candidacy:null},
   related_agendas:related.slice(0,12),related_has_more:related.length>12,
   references:{goals:'/goals',agendas:'/agendas',tasks:'/engineering/tasks?owner=me',overview:'/engineering/overview',brief:'/engineering/brief?id=TASK_ID',workflow:'/engineering/workflow',releases:'/engineering/releases',handoffs:'/engineering/handoffs'},
 };
}
module.exports={situation};
