// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: documents; move; state; binding; snapshot; projectLayoutSlots; paint; collect; sheet; bind; bindThemeComponent; bindThemeGreeting; bindThemeRenderer; withThemeBatch; disposeThemeTree; applyLayoutTheme
// Impact: python -B scripts/code-atlas.py show Theme/runtime/layout.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {catalog,validateTheme} from '../contract/definition.mjs';
import {assetCSS,fontFaces} from '../contract/assets.mjs';
const documents=new WeakMap();
// Modern renderers can relocate connected slots without resetting media,
// iframes or focus. Insert connected scaffolding before moving its slots.
function move(parent,node,before=null){
 if(parent.moveBefore&&parent.isConnected&&node.isConnected)parent.moveBefore(node,before);
 else parent.insertBefore(node,before);
}
function state(doc){let value=documents.get(doc);if(!value){value={key:'',definition:null,bindings:new Set(),staticBindings:[],style:null,serial:0,batch:0,dirty:false};documents.set(doc,value);}return value;}
function binding(root,surface,slots,kind='layouts',onChange=()=>{}){
 return {root,surface,slots,kind,onChange,originals:[],frame:null,css:'',restore(){this.onChange(false);if(!this.originals.length)return;for(const {node,marker}of this.originals)if(marker.parentNode)move(marker.parentNode,node,marker.nextSibling);this.frame?.remove();this.frame=null;this.css='';for(const node of Object.values(slots))node.removeAttribute('data-theme-node');},dispose(){this.restore();for(const {marker}of this.originals)marker.remove();this.originals=[];}};
}
function snapshot(doc){
 const active=doc.activeElement,selection=doc.getSelection(),ranges=[];
 for(let i=0;selection&&i<selection.rangeCount;i++){const r=selection.getRangeAt(i);ranges.push([r.startContainer,r.startOffset,r.endContainer,r.endOffset]);}
 const direction=selection?.anchorNode?[selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset]:null;
 const scroll=[...doc.querySelectorAll('*')].map(n=>[n,n.scrollTop,n.scrollLeft]);
 const input=active&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd,active.selectionDirection]:null;
 return ()=>{
  if(ranges.length&&selection){selection.removeAllRanges();for(const [start,a,end,b]of ranges)if(start.isConnected&&end.isConnected){const r=doc.createRange();r.setStart(start,a);r.setEnd(end,b);selection.addRange(r);}if(direction?.[0].isConnected&&direction[2].isConnected)selection.setBaseAndExtent?.(...direction);}
  // Chromium's document Selection also projects focused text controls. Restore
  // their native range last: restoring the document range can reset the caret,
  // even when the same input has retained focus throughout the move.
  if(active?.isConnected){if(doc.activeElement!==active)active.focus?.({preventScroll:true});if(input)active.setSelectionRange?.(...input);}
  for(const [n,top,left]of scroll){n.scrollTop=top;n.scrollLeft=left;}
 };
}
// A greeting has identity and answer, while the current Home surface may also
// have tools, thoughts and status. Project the same author layout onto the
// available semantic slots without creating empty UI or changing its source.
export function projectLayoutSlots(tree,slots){
 if(!tree)return null;
 if(tree.slot)return slots.has(tree.slot)?tree:null;
 const children=(tree.children||[]).map(child=>projectLayoutSlots(child,slots)).filter(Boolean);
 return children.length?{...tree,children}:null;
}
function paint(b,tree,s){
 if(b.partial)tree=projectLayoutSlots(tree,new Set(Object.keys(b.slots)));
 b.restore();if(!tree)return;
 const doc=b.root.ownerDocument,css=[];
 if(!b.originals.length)b.originals=Object.values(b.slots).map(node=>{const marker=doc.createComment('theme-slot');node.before(marker);return {node,marker};});
 function node(n,parent){
  const element=n.slot?b.slots[n.slot]:doc.createElement(n.tag||'div');
  const id='t'+(++s.serial);element.dataset.themeNode=id;
  if(n.label)element.setAttribute('aria-label',n.label);
  if(n.style){const declarations=Object.entries(n.style).map(([k,v])=>k+':'+assetCSS(k,v,s.selection)+'!important').join(';');css.push(`[data-theme-node="${id}"]:not([hidden]){${declarations}}`);}
  move(parent,element);
  if(!n.slot)for(const child of n.children)node(child,element);return element;
 }
 const frame=doc.createElement(b.kind==='renderers'&&catalog.renderers[b.surface]?.inline?'span':'div');frame.dataset[b.kind==='renderers'?'themeRenderer':'themeLayout']=b.surface;frame.style.display='contents';
 // Only persistent business nodes move. Their listeners, inputs and projected
 // state remain the same objects across both switching and recovery.
 b.root.append(frame);b.frame=frame;node(tree,frame);b.css=css.join('\n');b.onChange(true);
}
function collect(s){const list=[];for(const ref of s.bindings){const b=ref.deref();if(!b){s.bindings.delete(ref);continue;}list.push(b);}return [...s.staticBindings,...list];}
function sheet(doc,s){
 if(s.batch){s.dirty=true;return;}s.dirty=false;
 const def=s.definition,css=[fontFaces(s.selection)];
 if(def?.tokens)css.push(':root{'+Object.entries(def.tokens).map(([k,v])=>k+':'+v+'!important').join(';')+'}');
 for(const rule of def?.styles||[]){const selectors=catalog.elements[rule.element].split(',').map(x=>x+catalog.states[rule.state||'default']+':not([hidden])');css.push(selectors.join(',')+'{'+Object.entries(rule.properties||{}).map(([k,v])=>k+':'+assetCSS(k,v,s.selection)+'!important').join(';')+'}');}
 for(const b of collect(s))if(b.css)css.push(b.css);
 // Important declarations in an explicit layer take priority over legacy
 // unlayered ID rules. Authors never need to reproduce private selectors.
 if(!s.style){s.style=doc.createElement('style');s.style.id='aieyra-layout-theme';doc.head.append(s.style);}s.style.textContent='@layer aieyra-user, aieyra-theme;@layer aieyra-theme{'+css.join('\n')+'}';
}
function bind(root,surface,slots,doc,kind,onChange,partial=false){
 root._themeBinding?.release?.();
 const s=state(doc),b=binding(root,surface,slots,kind,onChange),ref=new WeakRef(b);b.partial=partial;root._themeBinding=b;s.bindings.add(ref);
 paint(b,s.definition?.[kind]?.[surface],s);if(b.css)sheet(doc,s);
 let disposed=false;
 return b.release=()=>{if(disposed)return;disposed=true;const styled=!!b.css;b.dispose();s.bindings.delete(ref);if(root._themeBinding===b)delete root._themeBinding;if(styled)sheet(doc,s);};
}
export function bindThemeComponent(root,surface,slots,doc=root?.ownerDocument){
 if(!root||!catalog.surfaces[surface]?.component)return ()=>{};
 return bind(root,surface,slots,doc,'layouts');
}
export function bindThemeGreeting(root,slots){return bind(root,'live',slots,root.ownerDocument,'layouts',undefined,true);}
export function bindThemeRenderer(root,schema,slots,onChange){
 const spec=catalog.renderers[schema];
 if(!spec||Object.keys(spec.slots).some(key=>!slots[key]))throw Error('Content renderer is missing required slots: '+schema);
 return bind(root,schema,slots,root.ownerDocument,'renderers',onChange);
}
// A streamed fragment can introduce several nested components. Commit their
// shared stylesheet once, without deferring visible content to another frame.
export function withThemeBatch(doc,update){
 const s=state(doc);s.batch++;
 try{return update();}finally{if(!--s.batch&&s.dirty)sheet(doc,s);}
}
// Owners explicitly release removed content, including nested bindings, before
// dropping DOM references. WeakRef remains a backstop rather than a GC timer.
export function disposeThemeTree(root){
 if(!root)return;
 const visit=node=>{node._themeBinding?.release?.();for(const child of [...node.childNodes])visit(child);};
 if(root.ownerDocument)withThemeBatch(root.ownerDocument,()=>visit(root));else visit(root);
}
export function applyLayoutTheme(doc,selection){
 const s=state(doc),safe=/[?&]extension=settings(?:&|$)/.test(doc.defaultView?.location?.search||'');
 let definition=selection?.definition||null,error='';
 try{if(definition)validateTheme(definition);}catch(e){error=e.message;definition=null;}
 if(safe)definition=null;
 const key=definition?JSON.stringify([selection.id,selection.digest,selection.preview_token,definition]):'';if(s.key===key)return {ok:!error,error};
 const restore=snapshot(doc);
 try{
  for(const b of s.staticBindings)b.dispose();s.staticBindings=[];s.definition=definition;s.selection=definition?selection:null;
  if(definition){for(const [name,spec]of Object.entries(catalog.surfaces)){
   if(spec.component||!definition.layouts?.[name]||!doc.querySelector(spec.requires))continue;
   const root=doc.querySelector(spec.root),slots=Object.fromEntries(Object.entries(spec.slots).map(([k,v])=>[k,root?.querySelector(v)]));
   if(!root||Object.values(slots).some(x=>!x))throw Error('Surface is missing required elements: '+name);
   s.staticBindings.push(binding(root,name,slots));
  }}
  for(const b of collect(s))paint(b,definition?.[b.kind]?.[b.surface],s);
  sheet(doc,s);s.key=key;doc.body.dataset.layoutTheme=definition?(selection.id||'custom'):'default';
 }catch(e){
  for(const b of s.staticBindings)b.dispose();s.staticBindings=[];for(const b of collect(s))b.restore();s.definition=null;s.selection=null;s.key='';s.style?.remove();s.style=null;doc.body.dataset.layoutTheme='default';error=e.message;
 }finally{restore();}
 doc.dispatchEvent(new CustomEvent('workspace-theme-change',{detail:{error}}));return {ok:!error,error};
}
