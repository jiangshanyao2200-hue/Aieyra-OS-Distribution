// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: identity; textNode; readingNode; reconcilePresentation
// Impact: python -B scripts/code-atlas.py show Tool/presentation/retained-dom.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Reconcile trusted presentation nodes, retaining open details, focus, scroll
// and unchanged Text nodes. Callers own the source identity and lifecycle.
const identity=node=>node.nodeType===3?'#text':node.dataset?.digestKey||node.dataset?.detail||node.dataset?.stepId||node.dataset?.phaseId||node.dataset?.step||node.id||String(node.tagName)+'|'+String(node.className||'');
const textNode=node=>node.nodeType===3||node.tagName==='#text';
export function readingNode(doc,node){
 if(node.contains?.(doc.activeElement))return true;
 const selection=doc.getSelection?.();
 if(!selection||selection.isCollapsed)return false;
 for(let n=0;n<selection.rangeCount;n++)try{if(selection.getRangeAt(n).intersectsNode(node))return true;}catch{}
 return false;
}
export function reconcilePresentation(target,source,{doc=target.ownerDocument,force=false,onDeferred=()=>{},dispose=()=>{}}={}){
 const options={doc,force,onDeferred,dispose};
 if(textNode(target)&&textNode(source)){
  const before=target.data??target.textContent,after=source.data??source.textContent;
  if(before===after)return;
  if(!force&&!after.startsWith(before)&&readingNode(doc,target)){onDeferred();return;}
  if(after.startsWith(before)&&target.appendData)target.appendData(after.slice(before.length));else if(target.nodeType===3)target.data=after;else target.textContent=after;
  return;
 }
 if(target.getAttributeNames&&source.getAttributeNames){
  for(const key of target.getAttributeNames())if(key!=='open'&&!source.hasAttribute(key))target.removeAttribute(key);
  for(const key of source.getAttributeNames())if(key!=='open'&&target.getAttribute(key)!==source.getAttribute(key))target.setAttribute(key,source.getAttribute(key));
 }else{
  target.className=source.className;
  for(const key of Object.keys(target.dataset||{}))if(!(key in (source.dataset||{})))delete target.dataset[key];
  Object.assign(target.dataset||{},source.dataset||{});
 }
 for(const name of ['onclick','onkeydown','oninput','onchange','onpointerdown'])target[name]=source[name]||null;
 // Properties which are not always reflected to attributes.
 if('disabled'in source)target.disabled=source.disabled;
 if('hidden'in source)target.hidden=source.hidden;
 const old=[...target.childNodes],fresh=[...source.childNodes],used=new Set();
 for(let n=0;n<fresh.length;n++){
  const wanted=fresh[n],key=identity(wanted);let current=old.find(node=>!used.has(node)&&identity(node)===key&&textNode(node)===textNode(wanted));
  if(!current){current=wanted;const at=target.childNodes[n]||null;target.insertBefore(current,at);}
  else{used.add(current);const at=target.childNodes[n]||null;if(at!==current){if(target.moveBefore&&target.isConnected&&current.isConnected)target.moveBefore(current,at);else target.insertBefore(current,at);}reconcilePresentation(current,wanted,options);}
 }
 for(const node of old)if(!used.has(node)&&node.parentNode===target){
  if(!force&&readingNode(doc,node)){onDeferred();continue;}
  dispose(node);node.remove();
 }
 // Small non-DOM test hosts may represent textContent directly.
 if(!old.length&&!fresh.length&&target.nodeType===undefined&&target.textContent!==source.textContent)target.textContent=source.textContent;
}
