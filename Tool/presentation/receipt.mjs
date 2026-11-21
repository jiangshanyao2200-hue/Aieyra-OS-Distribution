// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: activityData
// Impact: python -B scripts/code-atlas.py show Tool/presentation/receipt.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Decode existing tool receipt envelopes without executing or interpreting them.
export function activityData(item) {
  let data=item.preview;
  for(let i=0;i<4;i++) {
    if(typeof data==='string') { try { data=JSON.parse(data); } catch { return {text:data}; } }
    if(data?.data) { data=data.data;continue; }
    if(Array.isArray(data?.output)&&data.output[0]?.type==='text') { data=data.output[0].text;continue; }
    break;
  }
  return data||{};
}
