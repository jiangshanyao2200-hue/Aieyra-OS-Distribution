// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: documents; setupControlGeometry
// Impact: python -B scripts/code-atlas.py show Theme/runtime/control-geometry.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const documents=new WeakMap();
// A control edge occupies one physical pixel at both desktop zoom and display
// scale. Its fill continues under the edge, avoiding a second clipped contour.
export function setupControlGeometry(doc=globalThis.document){
 if(!doc?.defaultView?.addEventListener||!doc.documentElement?.style?.setProperty||documents.has(doc))return documents.get(doc);
 const win=doc.defaultView;let media,closed=false;
 function update(){
  if(closed)return;media?.removeEventListener('change',update);
  const scale=Math.max(.5,Number(win.devicePixelRatio)||1);doc.documentElement.style.setProperty('--ui-hairline',(1/scale)+'px');
  media=win.matchMedia?.(`(resolution: ${scale}dppx)`);media?.addEventListener('change',update);
 }
 const state={close(){closed=true;media?.removeEventListener('change',update);win.removeEventListener('resize',update);documents.delete(doc);}};
 documents.set(doc,state);win.addEventListener('resize',update);win.addEventListener('pagehide',()=>state.close(),{once:true});update();return state;
}
if(globalThis.document)setupControlGeometry();
