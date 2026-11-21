// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: active; names; observationKey; observationEntries; extensionCatalog; projectedPresentation
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/observer-model.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Pure view descriptors. Opening one never creates or activates a task.
const active=new Set(['queued','running','waiting_user','cancelling']);
const names={matrix:'Eyra',project:'Vaya',execution:'Cota'};
export const observationKey=b=>JSON.stringify([b.core_epoch,b.task_id,b.agent_id,b.role,b.generation]);
export function observationEntries(snapshot){
 if(!snapshot?.session_id||!snapshot.core_epoch)return [];
 const entries=(snapshot.roles||[]).filter(r=>active.has(r.state)&&r.generation>0&&r.id).map(r=>({kind:'agent',key:observationKey({core_epoch:snapshot.core_epoch,task_id:snapshot.session_id,agent_id:r.id,role:r.role,generation:r.generation}),title:names[r.role]||r.title||'Agent',state:r.state,phase:snapshot.live?.[r.role]?.phase||'',summary:String(snapshot.live?.[r.role]?.thought||snapshot.live?.[r.role]?.text||'').trim().slice(-120),binding:{core_epoch:snapshot.core_epoch,task_id:snapshot.session_id,agent_id:r.id,role:r.role,generation:r.generation}}));
 for(const row of [...snapshot.collaboration?.helpers||[],...snapshot.collaboration?.splits||[]]){
  const id=row.task_id||row.id;if(!id||!active.has(row.state)||!(row.generation>0))continue;
  const binding={core_epoch:row.core_epoch||snapshot.core_epoch,task_id:id,agent_id:row.agent_id||id,role:'matrix',generation:row.generation};
  const key=observationKey(binding);if(!entries.some(e=>e.key===key))entries.push({kind:'agent',key,title:row.title||'Agent',state:row.state,phase:'',summary:row.activity||'',binding});
 }
 return entries;
}
export function extensionCatalog(snapshot,presentation){
 const entries=observationEntries(snapshot),matrix=snapshot?.roles?.find(r=>r.role==='matrix');
 if(matrix?.id&&matrix.generation>0){
  const binding={core_epoch:snapshot.core_epoch,task_id:snapshot.session_id,agent_id:matrix.id,role:'matrix',generation:matrix.generation};
  if(presentation?.plan?.())entries.push({kind:'plan',key:'plan:'+observationKey(binding),title:'计划',state:active.has(matrix.state)?'running':'completed',binding});
  for(const doc of snapshot.documents||[])if(doc.id&&!doc.dismissed)entries.push({kind:'document',key:'document:'+snapshot.session_id+':'+doc.id,title:doc.title||'报告',state:'completed',document_id:doc.id,binding});
 }
 return entries;
}
export function projectedPresentation(frame){
 const p=frame?.projection||{};
 return {liveActivities:()=>p.activities||[],terminal:()=>p.terminal||[],current:()=>p.current||[],plan:()=>p.plan||null,planFeedback:()=>p.planFeedback||''};
}
