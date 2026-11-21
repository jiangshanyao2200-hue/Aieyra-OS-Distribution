// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: resultFrame
// Impact: python -B scripts/code-atlas.py show Tool/presentation/frame.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Tool owns the actual result and action nodes. The host may supply a trusted
// presentation adapter; packages cannot execute it or fabricate result state.
export function resultFrame(doc,root,present=()=>{}){
 const slots=Object.fromEntries(['summary','content','details'].map(key=>{const node=doc.createElement('div');node.style.display='contents';return [key,node];}));
 root.append(...Object.values(slots));
 return {...slots,finish(){present(root,'aieyra.content.tool-result/1',slots);return root;}};
}
