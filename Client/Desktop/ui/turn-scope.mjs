// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ACCEPTED; turnInputs; turnInput; messageInTurn; liveInTurn; trailingInputs; orderTurnReplies; timeOf; carryTimes; mergeTimed
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/turn-scope.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Generations restart when a restored conversation creates a new executor.
// Explicit instance provenance wins; older receipts use their submitted turn.
const ACCEPTED=new Set(['delivered','running','waiting_user','waiting_human','cancelling']);
export function turnInputs(messages=[],role={}){
 return messages.filter(m=>m.from==='user'&&(!m.to||m.to===role.role)&&m.generation===role.generation&&!['queued','context','withdrawn'].includes(m.state)&&(!m.agent_id||!role.id||m.agent_id===role.id));
}

export function turnInput(messages=[],role={}){
 const inputs=turnInputs(messages,role);
 // Steering stays in the current execution. A completed input from a reused
 // generation cannot become the owner of a newly delivered user request.
 return inputs.find(m=>ACCEPTED.has(m.state))||inputs.at(-1);
}

export function messageInTurn(message,role,messages=[]){
 if(role?.generation&&message.generation!==role.generation)return false;
 if(message.agent_id&&role?.id&&message.agent_id!==role.id)return false;
 const inputs=turnInputs(messages,role);
 const latest=inputs.at(-1);
 if(message.turn_id)return !!latest&&message.turn_id===latest.id;
 if(!role?.id)return true;
 if(message.agent_id)return true;
 // Unattributed process prose cannot prove ownership of a running request.
 if(!['completed','failed','cancelled','timed_out','interrupted','persistence_failed','idle'].includes(role.state))return false;
 return !latest||messages.indexOf(message)>messages.indexOf(latest);
}

export function liveInTurn(live,role){
 return !!role&&(!live.agent_id||live.agent_id===role.id)&&(live.generation===undefined||live.generation===(role.generation||0));
}

// Inputs submitted while an earlier turn is still running follow that turn's
// live answer. They must not make its existing body look like a new reply.
export function trailingInputs(messages=[],pending=[],role={},turnID=''){
 const input=(turnID&&messages.find(m=>m.id===turnID))||turnInput(messages,role),at=input?messages.indexOf(input):-1;
 return new Set([...messages.filter((m,i)=>m.from==='user'&&(!m.to||m.to===role.role)&&m.state!=='withdrawn'&&(['queued','context'].includes(m.state)||at>=0&&i>at&&m.generation===role.generation&&(!m.agent_id||m.agent_id===role.id))),...pending].map(m=>m.id));
}

export function orderTurnReplies(rows){
 const users=new Set(rows.filter(e=>e.from==='user').map(e=>e.id)),answers=new Map();
 for(const row of rows)if(row.from==='eyra'&&users.has(row.turnID)){
  if(!answers.has(row.turnID))answers.set(row.turnID,[]);answers.get(row.turnID).push(row);
 }
 if(!answers.size)return rows;
 const ordered=[];for(const row of rows){if(row.from==='eyra'&&answers.has(row.turnID))continue;ordered.push(row);if(row.from==='user')ordered.push(...(answers.get(row.id)||[]));}
 return ordered;
}

// Rows already in conversation order keep that order; timed extras (Link
// messages, team activity) are merged by time. An untimed row (a local send
// before its receipt, the greeting) inherits the previous row's time, so it can
// never be sorted to the top of the history and vanish from the visible tail.
export function timeOf(value){if(typeof value==='number')return value>1e14?value/1000:value;return Date.parse(value)||0;}
export function carryTimes(rows){let last=0;return rows.map(row=>{const at=timeOf(row.at);if(at)last=Math.max(last,at);return at||last;});}
export function mergeTimed(ordered,extra=[]){
 if(!extra.length)return ordered;
 const times=carryTimes(ordered),rows=ordered.map((row,i)=>({row,at:times[i],i}));
 extra.forEach((row,i)=>rows.push({row,at:timeOf(row.at),i:ordered.length+i}));
 return rows.sort((a,b)=>a.at-b.at||a.i-b.i).map(x=>x.row);
}
