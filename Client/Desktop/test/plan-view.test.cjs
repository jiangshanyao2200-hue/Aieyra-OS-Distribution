// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: load; item
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/plan-view.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=()=>import(pathToFileURL(path.join(__dirname,'../ui/plan-view.mjs')).href);
const item=plan=>({preview:JSON.stringify(plan)});

test('plan model reads phases, current step and completion from the real receipt',async()=>{
 const {planModel}=await load();
 const m=planModel(item({objective:'交付并核验',phases:[{title:'一',steps:[{id:'a',description:'生成成果',status:'completed',result:'三项已保存'},{id:'b',description:'核验目录',status:'in_progress'}]},{title:'二',steps:[{id:'c',title:'交付',status:'pending'}]}]}));
 assert.equal(m.objective,'交付并核验');assert.equal(m.total,3);assert.equal(m.done,1);
 assert.equal(m.current.text,'核验目录');assert.equal(m.summary,'核验目录');assert.equal(m.complete,false);
 assert.deepEqual(m.phases.map(p=>p.title),['一','二']);assert.equal(m.steps[0].result,'三项已保存');
});

test('a fully completed plan reports completion; blocked and unknown statuses stay distinct',async()=>{
 const {planModel}=await load();
 const done=planModel(item({summary:'整理',steps:[{text:'甲',status:'completed'},{text:'乙',status:'done'}]}));
 assert.equal(done.complete,true);assert.equal(done.summary,'计划已完成');assert.equal(done.objective,'整理');
 const mixed=planModel(item({steps:[{text:'甲',status:'failed'},{text:'乙',status:'weird'},{text:'',status:'pending'}]}));
 assert.deepEqual(mixed.steps.map(s=>s.state),['blocked','pending']);assert.equal(mixed.total,2);
});

test('peek and page render the plan without inventing steps',async()=>{
 const {planModel,renderPlanPeek,renderPlanPage}=await load();
 const created=[];
 const doc={createElement(tag){const n={tag,children:[],dataset:{},style:{},attrs:{},textContent:'',className:'',append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(k,v){this.attrs[k]=v;}};created.push(n);return n;}};
 const root=doc.createElement('div');root.ownerDocument=doc;
 const m=planModel(item({objective:'目标',steps:[{text:'一',status:'completed'},{text:'二',status:'in_progress'}]}));
 renderPlanPeek(root,m,doc);
 const list=root.children.find(c=>c.tag==='ol');assert.deepEqual(list.children.map(li=>[li.textContent,li.dataset.state]),[['一','completed'],['二','in_progress']]);
 renderPlanPage(root,m,doc);
 const page=root.children[0];assert.equal(page.className,'plan-page');
 const meter=created.find(n=>n.className==='plan-meter');assert.equal(meter.attrs['aria-valuenow'],'1');assert.equal(meter.children[0].style.width,'50%');
 assert.equal(created.filter(n=>n.className==='plan-step').length,2);
});

test('domain acceptance, deferred work and historical replacement retain their meaning',async()=>{
 const {planModel}=await load();
 const m=planModel(item({mode:'goal',status:'awaiting_acceptance',objective:'核实交付',phases:[{id:'A',steps:[{id:'a',text:'核实',status:'completed',evidence:['文件SHA已读回']},{id:'old',text:'旧方案',status:'superseded',replaced_by:'a'},{id:'cancel',text:'取消项',status:'cancelled'}]}]}));
 assert.equal(m.total,1);assert.equal(m.done,1);assert.equal(m.complete,false);assert.equal(m.summary,'步骤已完成，待验收');
 assert.deepEqual(m.steps.map(s=>s.state),['completed','superseded','cancelled']);assert.deepEqual(m.steps[0].evidence,['文件SHA已读回']);
 const deferred=planModel(item({status:'active',steps:[{id:'d',text:'等恢复',status:'deferred',reason:'等待资源',resume_condition:{detail:'连接恢复'}},{id:'b',text:'阻塞项',status:'blocked'},{id:'p',text:'可推进',status:'pending'}]}));
 assert.equal(deferred.current.id,'p');assert.equal(deferred.steps[0].reason,'等待资源');assert.equal(deferred.steps[0].resume.detail,'连接恢复');
 assert.equal(planModel(item({status:'paused',steps:[{text:'已做',status:'completed'}]})).complete,false);
 assert.equal(planModel(item({status:'complete',steps:[{text:'已做',status:'completed'}]})).complete,true);
});
