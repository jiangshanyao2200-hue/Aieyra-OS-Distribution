// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test; fixture
// Impact: python -B scripts/code-atlas.py show Tool/workbox/presentation/desktop.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function fixture(){class E{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.textContent='';}append(...nodes){this.children.push(...nodes);}}const walk=n=>[n,...n.children.flatMap(walk)];const doc={createElement:tag=>Object.assign(new E(tag),{ownerDocument:doc})};return{doc,walk,text:n=>walk(n).map(n=>n.textContent).join(' ')};}
test('actual Desktop digest exposes workflow review, unknown receipts and products',async()=>{
 const {renderDigest}=await import('../../../Client/Desktop/ui/tool-digest.mjs');
 const f=fixture(),identity='mod:example.images-workflow@'+'a'.repeat(64),data={schema:'aieyra.workbox-state/1',id:'owned-workflow',title:'图片工作流',state:'unknown',definition:{steps:[{id:'generate',title:'生成原图'},{id:'edit',title:'引用编辑'}]},steps:[{id:'generate',state:'completed',receipt:'original-batch',result:{paths:['actual.png']}},{id:'edit',state:'unknown',error:'原始回包待核实',receipt:'original-edit-batch'}],outputs:{original:['actual.png']}};
 const node=renderDigest(f.doc,{state:'completed',preview:{package:identity,state:'completed',data}});
 assert.equal(node.dataset.state,'unknown');assert.equal(node.dataset.view,'workflow');assert.match(f.text(node),/结果待核实/);assert.match(f.text(node),/actual.png/);assert.match(f.text(node),/原始回包待核实/);assert.equal(f.walk(node).filter(x=>x.tagName==='li'&&x.dataset.step).length,2);
});
test('workflow outputs decode real execution blocks into readable facts and tables, preserving the complete record',async()=>{
 const {renderWorkflowDigest}=await import('./desktop.mjs');
 const f=fixture(),privateText='<script>unsafe</script>',execution={state:'completed',cell_id:'receipt-one',output:[{type:'text',text:JSON.stringify({file:'report.json',workdir:'owned-work'})},{type:'text',text:JSON.stringify([{metric:'sum',value:12},{metric:privateText,value:3}])}]};
 const data={schema:'aieyra.workbox-state/1',id:'workflow',state:'completed',steps:[{id:'calculate',state:'completed',result:{sum:12,mean:4}}],outputs:{report:execution}};
 const node=renderWorkflowDigest(f.doc,{package:'mod:example.workflow@'+'a'.repeat(64),data}),all=f.walk(node);
 assert.ok(all.some(n=>n.tagName==='table'));assert.ok(all.some(n=>n.tagName==='td'&&n.textContent==='12'));assert.ok(all.some(n=>n.tagName==='td'&&n.textContent===privateText));assert.ok(all.some(n=>n.tagName==='dt'&&n.textContent==='合计'));assert.equal(all.find(n=>n.dataset.detail==='record').open,undefined);assert.match(f.text(node),/receipt-one/);
});
