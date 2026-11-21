// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: chat
// Regions: problemStates; problemStatus; outcomes; chatFailureEntry; phases; statusLine; chatStatus
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/chat-status.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {redactNoticeText} from './system-notices.mjs';
import {activityBrief} from './activity.mjs';
const problemStates=new Set(['error','failed','timed_out','interrupted','interrupted_unknown','persistence_failed']);
export const problemStatus='我们遇到了问题';
const outcomes={cancelled:'任务已停止',cancelling:'正在停止',waiting_user:'等待你的回复',offline:'连接已断开',queued:'排队中'};
// Core classifies execution failures once. All chat surfaces project this same
// receipt; the outstanding-send queue separately owns unresolved delivery.
export function chatFailureEntry(agent,scope,identity){
 if(!agent?.id||!scope||!problemStates.has(agent.state))return null;
 const failure=agent.failure||{};
 const title=typeof failure.title==='string'?failure.title.trim():'';
 const original=typeof agent.error==='string'?agent.error.trim():'';
 const code=typeof failure.code==='string'?failure.code.trim():'';
 const text=redactNoticeText(title||original);
 const receipt=redactNoticeText([...new Set([title&&original!==title?original:'',code].filter(Boolean))].join('\n'));
 return {id:'failure:'+JSON.stringify([scope,agent.id,agent.generation]),from:'eyra',identity,role:identity?.role||'matrix',generation:agent.generation,haloState:'error',problem:true,retryable:failure.retryable===true,retry:{id:agent.id,session_id:scope,generation:agent.generation,attempt:agent.chat_retry_attempt||0},text:text||'执行已中断，当前回执没有提供更多详情。',receipt};
}
const phases={thinking:'正在思考',body:'正在回应',replying:'正在回应',tool:'正在操作',working:'正在操作',preparing:'正在准备',waiting:'等待模型回应',connecting:'正在连接',compacting:'正在整理上下文',running:'正在工作'};
export const statusLine=value=>String(value||'').split(/\r?\n/).find(s=>s.trim())?.replace(/\s+/g,' ').trim().slice(0,120)||'';
export function chatStatus({state='idle',phase='',label='',caption='',activities=[]}={}){
 if(problemStates.has(state))return problemStatus;
 if(outcomes[state])return outcomes[state];
 const current=activities.filter(a=>['running','queued','starting','cancelling','waiting_user'].includes(a.state));
 if(current.length){const lines=[...new Set(current.map(a=>statusLine(activityBrief(a))).filter(Boolean))];return lines.length?statusLine(lines.join(' · ')):'正在操作';}
 return statusLine(caption)||statusLine(label)||phases[phase]||phases[state]||'';
}
