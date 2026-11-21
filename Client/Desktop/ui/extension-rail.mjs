// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/ui/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: api; catalog; glyph; run; make; paint; off
// Impact: python -B scripts/code-atlas.py show Client/Desktop/ui/extension-rail.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import {setupMotion} from './motion.mjs';
import {applyResourceTheme,applyAppearanceFrame} from './appearance.mjs';
setupMotion();
const api=window.aieyraExtension,root=document.getElementById('extension-orbs'),nodes=new Map();
let catalog=null,closed=false;
const glyph=row=>row.kind==='agent'?'':{settings:'⚙',link:'↗',plan:'✓',document:'文'}[row.kind]||'·';
function run(promise,node){void promise.then(r=>{if(r?.ok===false)throw Error(r.error);node?.removeAttribute('data-error');}).catch(error=>{if(node){node.dataset.error='true';node.title=error.message;}});}
function make(row){
 const button=document.createElement('button');button.type='button';button.className='extension-orb';
 const ring=document.createElementNS('http://www.w3.org/2000/svg','svg');ring.setAttribute('viewBox','0 0 60 60');ring.setAttribute('aria-hidden','true');
 for(const cls of ['orb-edge','orb-flow','orb-heart']){const circle=document.createElementNS(ring.namespaceURI,'circle');circle.setAttribute('cx','30');circle.setAttribute('cy','30');circle.setAttribute('r',cls==='orb-heart'?'20':'26');circle.setAttribute('class',cls);ring.append(circle);}
 const text=document.createElement('span');text.className='orb-glyph';button.append(ring,text);
 let drag=null,suppress=false;
 button.onpointerdown=event=>{if(event.button!==0||!event.isPrimary)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};button.setPointerCapture(event.pointerId);};
 button.onpointermove=event=>{if(!drag||event.pointerId!==drag.id)return;if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>8)drag.moved=true;button.classList.toggle('dragging',drag.moved);};
 const end=event=>{if(!drag||event.pointerId!==drag.id)return;const done=drag;drag=null;button.classList.remove('dragging');try{button.releasePointerCapture(event.pointerId);}catch{}if(done.moved){suppress=true;setTimeout(()=>suppress=false,0);if(event.type==='pointerup')run(api.detach({key:button.dataset.key,x:event.screenX,y:event.screenY}),button);}};
 button.onpointerup=end;button.onpointercancel=end;
 button.onclick=event=>{if(suppress){event.preventDefault();return;}run(api.open({key:button.dataset.key,toggle:true}),button);};
 button.oncontextmenu=event=>{event.preventDefault();run(api.detach({key:button.dataset.key}),button);};
 button.onkeydown=event=>{if(event.key==='Enter'&&event.shiftKey){event.preventDefault();run(api.detach({key:button.dataset.key}),button);}};
 return {button,text};
}
function paint(value){
 if(closed)return;catalog=value;if(value?.appearanceTheme)applyAppearanceFrame(document.body,value.appearanceTheme);else applyResourceTheme(document,value?.themeCss);const entries=value?.entries||[],keys=new Set(entries.map(r=>r.key));
 const focused=[...nodes.entries()].find(([,node])=>node.button===document.activeElement),oldIndex=focused?[...nodes.keys()].indexOf(focused[0]):-1;
 for(const[key,node]of nodes)if(!keys.has(key)){node.button.remove();nodes.delete(key);}
 const layout=value?.layout;if(layout){root.style.setProperty('--orb-size',layout.size+'px');root.style.setProperty('--orb-gap',layout.gap+'px');root.style.setProperty('--orb-rows',layout.rows);root.style.setProperty('--orb-padding',layout.padding+'px');root.dataset.columns=String(layout.columns);}
 root.dataset.side=value?.side||'left';
 for(const [index,row]of entries.entries()){let node=nodes.get(row.key);if(!node){node=make(row);nodes.set(row.key,node);}const b=node.button;b.dataset.key=row.key;b.dataset.role=row.binding?.role||row.kind;b.dataset.state=row.state;b.dataset.phase=row.phase;b.dataset.detached=String(row.window?.placement==='detached');b.setAttribute('aria-label',row.title+' · '+(row.summary||{running:'工作中',queued:'排队中',completed:'已完成'}[row.state]||'打开'));b.setAttribute('aria-expanded',String(row.window?.visible===true));b.title=row.title+(row.summary?'\n'+row.summary:'')+'\n单击查看 · 拖动或右键独立打开';node.text.textContent=glyph(row);if(root.children[index]!==b)root.insertBefore(b,root.children[index]||null);}
 if(focused&&!keys.has(focused[0])){if(entries.length)nodes.get(entries[Math.min(oldIndex,entries.length-1)].key)?.button.focus({preventScroll:true});else void api.retireFocus();}
}
root.addEventListener('keydown',event=>{
 const buttons=[...root.children],index=buttons.indexOf(document.activeElement);if(index<0)return;
 const delta={ArrowUp:-1,ArrowDown:1,ArrowLeft:-(catalog?.layout?.rows||1),ArrowRight:catalog?.layout?.rows||1}[event.key];
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:delta!=null?Math.max(0,Math.min(buttons.length-1,index+delta)):null;
 if(next!=null){event.preventDefault();buttons[next]?.focus({preventScroll:true});}
});
const off=[api.onCatalog(paint),api.onVisibility(value=>{document.body.dataset.visible=String(value.visible);})];
window.addEventListener('beforeunload',()=>{closed=true;for(const stop of off)stop();},{once:true});
paint(await api.catalog());
