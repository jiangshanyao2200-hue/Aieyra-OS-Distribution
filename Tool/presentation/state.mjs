// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: activityStates; groupActivityState
// Impact: python -B scripts/code-atlas.py show Tool/presentation/state.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {activityData} from './receipt.mjs';

export const activityStates={queued:'等待',running:'进行中',completed:'完成',failed:'未成功',cancelled:'已取消',timed_out:'超时',interrupted:'中断',interrupted_unknown:'结果未确认',persistence_failed:'结果保存失败',unknown:'状态待确认'};

// A missing receipt must never turn a possibly committed operation into success.
export function groupActivityState(items){
 const live=new Set(items.filter(i=>['queued','running'].includes(i.state)).map(i=>i.session_id||activityData(i).session_id||'item:'+(i.id??i.sequence))).size;
 const terminal=items.map(i=>{const d=activityData(i);if(d.ok===false||d.exit_code!=null&&d.exit_code!==0)return 'failed';return Object.hasOwn(activityStates,i.state)?i.state:'unknown';});
 const state=live?'running':['persistence_failed','interrupted_unknown','unknown','failed','timed_out','interrupted','cancelled'].find(s=>terminal.includes(s))||(items.length?'completed':'unknown');
 return {live,failed:!['queued','running','completed'].includes(state),state};
}
