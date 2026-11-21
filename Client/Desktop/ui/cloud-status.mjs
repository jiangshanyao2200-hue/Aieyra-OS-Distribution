// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: cloudStatus; paintCloudStatus
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/cloud-status.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

export function cloudStatus(state, now=Date.now()){
 const checked=Date.parse(state?.cloud_checked_at||'');
 const connected=state?.cloud_available===true&&state?.device_ready===true&&!state?.cloud_error&&Number.isFinite(checked)&&checked<=now+5000&&now-checked<=90000;
 return {connected,label:connected?'云端已连接':'云端未连接'};
}
export function paintCloudStatus(node,state){
 if(!node)return;
 const status=cloudStatus(state);
 node.dataset.connected=String(status.connected);node.title=status.label;node.setAttribute('aria-label',status.label);
}
