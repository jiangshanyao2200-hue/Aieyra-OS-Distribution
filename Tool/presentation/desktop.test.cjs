// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: test; id; receipt; fixture
// Impact: python -B scripts/code-atlas.py show Tool/presentation/desktop.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const id='mod:example.statistics@'+'a'.repeat(64);
const receipt=(kind='cards')=>({tool:id,state:'completed',preview:{package:id,state:'completed',ok:true,presentation:{kind,title:'统计',columns:[{key:'metric',label:'指标'},{key:'value',label:'结果'}]},data:{ok:true,state:'completed',cell_id:'actual-cell',output:[{type:'text',text:'{"count":3,"sum":12}'},{type:'text',text:'second actual output'},{type:'image',image_id:'actual-image'}]}}});
function fixture(){class Element{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.textContent='';}append(...n){this.children.push(...n);}}
 const doc={createElement:tag=>Object.assign(new Element(tag),{ownerDocument:doc})},walk=n=>[n,...n.children.flatMap(walk)],text=n=>walk(n).map(n=>n.textContent).join(' ');return{doc,walk,text};}
test('package result uses the Tool renderer through the real Desktop digest entry',async()=>{
 const {renderDigest}=await import('../../Client/Desktop/ui/tool-digest.mjs'),f=fixture(),node=renderDigest(f.doc,receipt());
 assert.equal(node.dataset.view,'cards');assert.match(f.text(node),/sum.*12/);assert.match(f.text(node),/second actual output/);assert.match(f.text(node),/actual-image/);assert.equal(f.walk(node).filter(n=>n.tagName==='dl').length,1);
});
test('table binding displays real rows and keeps fields outside declared columns',async()=>{
 const {renderDigest}=await import('../../Client/Desktop/ui/tool-digest.mjs'),f=fixture(),item=receipt('table');item.preview.data.output=[{type:'text',text:'[{"metric":"sum","value":12,"extra":"retained"}]'}];
 const node=renderDigest(f.doc,item),cells=f.walk(node).filter(n=>n.tagName==='td').map(n=>n.textContent);
 assert.deepEqual(cells,['sum','12']);assert.match(f.text(node),/retained/);
});
test('running, cancelled and unknown results preserve error and actual text without HTML execution',async()=>{
 const {renderDigest}=await import('../../Client/Desktop/ui/tool-digest.mjs');
 for(const state of ['running','cancelled','interrupted_unknown']){const f=fixture(),item=receipt();item.state=state;item.preview.error={message:'actual failure'};item.preview.data.output=[{type:'text',text:'<img src=x onerror=boom>'}];item.preview.data.has_more=true;item.preview.preview_truncated=true;
  const node=renderDigest(f.doc,item);assert.equal(node.dataset.state,state);assert.match(f.text(node),/actual failure/);assert.match(f.text(node),/onerror=boom/);assert.match(f.text(node),/待读取/);assert.match(f.text(node),/部分预览/);assert.equal(f.walk(node).filter(n=>n.tagName==='img').length,0);
 }
});

test('package labels retain the saved view title in live and manual rows',async()=>{
 const {activityLabel}=await import('../../Client/Desktop/ui/activity.mjs');
 const item={tool:id,presentation:{kind:'cards',title:'数字统计'},state:'completed',targets:['implementation/path'],preview:{}};
 assert.equal(activityLabel(item),'数字统计');assert.equal(activityLabel({...item,action:'load_tool'}),'数字统计说明已就绪');
});

test('table keeps ancillary output collapsed so result rows remain the primary view',async()=>{
 const {renderDigest}=await import('../../Client/Desktop/ui/tool-digest.mjs'),f=fixture(),item=receipt('table');
 item.preview.data.output=[{type:'text',text:JSON.stringify({file:'actual-report.json',workdir:'long/path/'.repeat(30)})},{type:'text',text:'[{"metric":"sum","value":12}]'}];
 const node=renderDigest(f.doc,item),extra=f.walk(node).find(n=>n.className==='digest-section package-tool-extra');
 assert.equal(extra.tagName,'details');assert.ok(!extra.open);assert.match(f.text(extra),/actual-report.json/);assert.deepEqual(f.walk(node).filter(n=>n.tagName==='td').map(n=>n.textContent),['sum','12']);
});

test('theme adapter receives original semantic result nodes including unknown status and the complete receipt',async()=>{
 const {renderPackageDigest}=await import('./desktop.mjs'),f=fixture(),item=receipt();item.state='interrupted_unknown';item.preview.error={message:'不能确认执行结果'};
 let projection;const node=renderPackageDigest(f.doc,item,{present:(root,schema,slots)=>{projection={root,schema,slots};}});
 assert.equal(projection.root,node);assert.equal(projection.schema,'aieyra.content.tool-result/1');
 assert.match(f.text(projection.slots.summary),/执行结果尚未确认.*不能确认执行结果/);
 assert.match(f.text(projection.slots.content),/count.*3.*sum.*12/);
 assert.match(f.text(projection.slots.details),/预览记录.*actual-cell/s);
 assert.equal(new Set(Object.values(projection.slots)).size,3);
});
