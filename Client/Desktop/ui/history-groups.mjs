// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: historySpeaker; historyGroups
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/history-groups.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Consecutive turns share one identity, including all thoughts/tool receipts.
// A date change is metadata, not a new speaker. Legacy subconscious records
// retain their own identity and live in the same shared history.
export function historySpeaker(row,previous='matrix'){
 if(row.role==='user'||row.title==='user')return 'user';
 if(row.role&&row.role!=='assistant'&&row.role!=='tool'&&row.role!=='system')return row.role;
 if(['matrix','project','execution','subconscious'].includes(row.title))return row.title;
 if(row.kind==='system')return previous==='user'?'matrix':previous;
 return 'matrix';
}
export function historyGroups(rows){
 const groups=[];
 for(const row of rows){
  if(row.role==='system'||row.kind==='system'&&!row.compaction)continue;
  const previous=groups.at(-1),speaker=historySpeaker(row,previous?.speaker);
  if(previous?.speaker===speaker)previous.rows.push(row);
  else groups.push({id:row.id,speaker,rows:[row]});
 }
 return groups;
}
