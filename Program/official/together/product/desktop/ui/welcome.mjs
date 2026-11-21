/* @file-map:start
文件: link/desktop/ui/welcome.mjs
位置: 一环·完整界面模块 | 共享界面模块与页面渲染；workspace.mjs负责页面编排与业务事件。
约束: 优先复用controls、Surfaces、detail-view、native-overlays和既有设计变量；异步更新核对generation/epoch；账号变化释放旧DOM、草稿与定时器
下游: link/desktop/ui/icons.mjs, link/desktop/ui/markdown.mjs
上游: AIDEBUG/onboarding-timeout.test.cjs, AIDEBUG/restart-session.test.cjs, AIDEBUG/station-overview.test.cjs, link/desktop/ui/workspace.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/onboarding-timeout.test.cjs, AIDEBUG/restart-session.test.cjs, AIDEBUG/station-overview.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  expired | function
  activeAgent | function
  welcomePhase | function
  welcomeHTML | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import {escape as e} from './markdown.mjs';
import {icon} from './icons.mjs';
export const checkNames={api:'接口连通',prompt:'协作规则',safety:'安全边界',agenda:'议程能力',local:'本人工位',cloud:'收件通道'};
const /* @chain-region expired | calls: Number.isFinite, Date.now */ expired=value=>value?.state==='expired'||value?.state!=='completed'&&Number.isFinite(value?.deadline)&&value.deadline<=Date.now()/1000;
const /* @chain-region activeAgent | calls: data.agents.find, Date.now */ activeAgent=data=>data?.agents?.find(a=>!a.revoked&&a.expires>Date.now()/1000&&!(data.enrollment?.state==='checking'&&data.enrollment.replacing_agent_id===a.id));
export /* @chain-region welcomePhase | calls: activeAgent, expired */ function welcomePhase(data){
 const active=activeAgent(data);
 if(expired(active?.enrollment)||expired(data?.enrollment))return 'expired';
 if(data?.restart?.required)return 'reconnect';
 if(active?.ready)return 'ready';
 return active||data?.enrollment?.connected||data?.connection?.name?'checking':'connect';
}
export /* @chain-region welcomeHTML | calls: welcomePhase, activeAgent, icon, filter, Object.keys, find, Math.min, map … */ function welcomeHTML(data,access,halo,busy=false){
 const phase=welcomePhase(data),active=activeAgent(data);
 if(phase==='reconnect')return `<section class="login-stage onboarding-stage welcome-stage" data-welcome-phase="reconnect">${halo}<h1>重新连接 Agent</h1><button class="primary" data-action="agent-copy" ${busy?'disabled aria-busy="true"':''}>${icon('copy')}复制接入信息</button></section>`;
 if(phase==='expired')return `<section class="login-stage onboarding-stage welcome-stage" data-welcome-phase="expired">${halo}<h1>接入已超时</h1><button class="primary" data-action="agent-copy" ${busy?'disabled aria-busy="true"':''}>${icon('copy')}复制接入信息</button></section>`;
 if(phase==='connect')return `<section class="login-stage onboarding-stage welcome-stage" data-welcome-phase="connect">${halo}<h1>欢迎您，亲爱的工程师。</h1><button class="primary" data-action="agent-copy" ${busy?'disabled aria-busy="true"':''}>${icon('copy')}复制接入信息</button></section>`;
 const checks=active?.checks||{},done=Object.keys(checkNames).filter(k=>checks[k]).length;
 const current=Object.keys(checkNames).find(k=>!checks[k]);
 const application=access.application;
 const heading=access.member?'Agent 正在接入':application?.status==='pending'?'资格审核中':application?.status==='rejected'?'资格申请未通过':'申请工程师资格';
 const deadline=Math.min(...[active?.enrollment,data.enrollment].filter(v=>v&&v.state!=='completed'&&Number.isFinite(v.deadline)).map(v=>v.deadline));
 const remaining=Number.isFinite(deadline)?` · 剩余 ${Math.max(1,Math.ceil((deadline-Date.now()/1000)/60))} 分钟`:'';
 return `<section class="onboarding-stage welcome-stage welcome-checking" data-welcome-phase="checking"><div class="welcome-check-heading"><h1>${heading}</h1><p>${data.stale?'同步中…':''}<span class="welcome-check-count" role="status" aria-label="已通过 ${done} 项，共 6 项">${done} / 6${remaining}</span></p></div><div class="welcome-checks" role="list" aria-label="真实接入检查">${Object.entries(checkNames).map(([key,label],i)=>{const status=checks[key]?'已通过':!access.member?'等待资格审核':key===current?'等待 Agent 完成':'待检查';return `<div role="listitem" aria-label="${label}：${status}" title="${status}" data-check="${key}" data-check-state="${checks[key]?'passed':key===current&&access.member?'current':'waiting'}"><span aria-hidden="true">${checks[key]?icon('check'):String(i+1).padStart(2,'0')}</span><strong>${label}</strong></div>`;}).join('')}</div><div id="agent-flow" class="agent-flow" aria-hidden="true"><div class="flow-node">${icon('office')}<span>Agent</span></div><div class="flow-wire agent-wire"><i></i></div><div class="flow-link"><span>Link</span></div><div class="flow-wire api-wire"><i></i></div><div class="flow-node">${icon('repository')}<span>API</span></div></div><p id="agent-activity" class="flow-activity" hidden></p><div class="welcome-actions">${!access.member?`<button class="secondary" data-action="welcome-qualification">${e(application?.status==='pending'?'资格审核中':application?.status==='rejected'?'查看申请结果':'申请工程师资格')}</button>`:''}<button class="secondary welcome-recovery" data-action="agent-copy" ${busy?'disabled aria-busy="true"':''}>${icon('copy')}复制接入信息</button></div></section>`;
}
