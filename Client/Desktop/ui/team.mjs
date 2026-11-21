// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TEAM; NAMES; STATES; teamState; roleRow; busy; teamForm; usageRows; capsuleText; capsuleItems
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/team.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 固定团队：Eyra 自己就是执行者；复杂任务请 Vaya 配合（通读工程做地图），更复杂、多种类型的才请助理 Cota。
// 设置、协同状态与真实用量的纯函数；右侧操作展示始终属于 Matrix。
import {activeStates} from './model.mjs';
import {isInternalId} from './activity.mjs';
import {usageSummary,formatTokens,formatContext} from './status.mjs';

export const TEAM=[
 {role:'matrix',name:'Eyra',duty:'执行'},
 {role:'project',name:'Vaya',duty:'工程地图 · 配合'},
 {role:'execution',name:'Cota',duty:'助理'},
];
const NAMES=Object.fromEntries(TEAM.map(r=>[r.role,r.name]));
const STATES={queued:'排队中',running:'在做',waiting_user:'等你决定',cancelling:'停下中',completed:'交付了',failed:'没完成',cancelled:'已停下',idle:'待命'};

// 团队协同状态的人话：开没开；没单独选模型的角色跟随 Eyra 的模型。
export function teamState(roles,byId=()=>null){
 if(roles?.collaboration_enabled===false)return {ready:false,missing:[],hint:'已关闭：Eyra 单独工作'};
 const on={vision_profile:roles?.vision_enabled!==false,execution_profile:roles?.execution_enabled!==false};
 if(!on.vision_profile&&!on.execution_profile)return {ready:false,missing:[],hint:'Vaya、Cota 都关了：Eyra 单独工作'};
 const following=[['vision_profile','Vaya'],['execution_profile','Cota']].filter(([key])=>on[key]&&(!roles?.[key]||!byId(roles[key]))).map(([,name])=>name);
 return {ready:true,missing:[],following,hint:'简单任务 Eyra 直接做，复杂的请 Vaya 配合，更复杂的再请 Cota'+(following.length?'；'+following.join('、')+' 用 Eyra 的模型':'')};
}

const roleRow=(snapshot,role)=>(snapshot?.roles||[]).find(r=>r.role===role);
const busy=row=>!!row&&activeStates.has(row.state);

// 协同形态（R10、R12）：团队配齐、Eyra 在这一轮写下了计划（或已经请求视觉地图）、并且还在工作。
// 简单任务不写计划，仍是左聊天右展示台的工作形态。
// 成员在做就是协同，Eyra 这一轮停下也一样。
// 旧计划和成员上次的结果不算：只有这一轮 Eyra 调用过工具（worked）才进。
export function teamForm(snapshot,{planned=false,worked=false}={}){
 if(snapshot?.link?.members?.some(row=>!row.lead&&busy(row)))return true;
 if(!snapshot?.collaboration?.team?.ready)return false;
 const rows=['project','execution'].map(role=>roleRow(snapshot,role));
 if(rows.some(row=>busy(row)))return true;
 if(!worked||!busy(roleRow(snapshot,'matrix')))return false;
 return planned||rows.some(row=>row&&row.generation>0&&row.state==='completed'&&snapshot.collaboration?.dispatched);
}

// 右上角下拉：当前角色（子 agent 另列）每行一份消耗。数字只来自 CORE 快照，没有的就是 —。
export function usageRows(snapshot){
 const enabled=snapshot?.collaboration?.team?.enabled;
 const rows=TEAM.map(({role,name})=>{
  const row=roleRow(snapshot,role);if(!row||enabled?.[role]===false&&!busy(row))return null;
  const usage=usageSummary([row]);
  return {key:role,name,active:busy(row),model:row.request_model||(isInternalId(row.model_id)?'':row.model_id)||'',input:formatTokens(usage.input),output:formatTokens(usage.output),cache:usage.cacheRate===null?'—':usage.cacheRate+'%',context:formatContext(row.context),compressed:row.compression?.after_tokens>=0&&row.compression?.before_tokens>0?Math.round((1-row.compression.after_tokens/row.compression.before_tokens)*100)+'%':''};
 }).filter(Boolean);
 const sub=snapshot?.greeting_usage;
 if(sub?.samples>0){const usage=usageSummary([{usage:sub}]);rows.push({key:'startup',name:'启动与整理',model:'',input:formatTokens(usage.input),output:formatTokens(usage.output),cache:usage.cacheRate===null?'—':usage.cacheRate+'%',context:'',compressed:''});}
 for(const helper of snapshot?.collaboration?.helpers||[])rows.push({key:'helper:'+helper.task_id,name:helper.title||'子 agent',model:'',input:'',output:'',cache:'',context:'',compressed:'',state:STATES[helper.state]||helper.state||''});
 return rows;
}

// 胶囊一次显示一个角色的全部信息：模型、输入、输出、缓存、上下文。放不下时 ticker 自己滚动。
// 只轮到正在工作的角色，都没在工作就停在 Eyra。
export function capsuleText(r){
 const parts=[r.model&&String(r.model).split('/').pop(),r.input&&'In '+r.input,r.output&&'Out '+r.output,r.cache&&r.cache!=='—'&&'Cache '+r.cache,r.context&&'Ctx '+r.context].filter(Boolean);
 return [r.name,...parts].join(' · ');
}
export function capsuleItems(rows){
 const live=rows.filter(r=>NAMES[r.key]&&r.active),shown=live.length?live:rows.filter(r=>r.key==='matrix');
 return shown.map(r=>({key:r.key,text:capsuleText(r),tone:r.key}));
}
