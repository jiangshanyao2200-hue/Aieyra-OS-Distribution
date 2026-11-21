// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/coherent-canvas.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
test('tool descriptions and operational receipts have semantic outcomes, never raw JSON fallback',async()=>{
 const {activityLabel,activityOutcome}=await import('../ui/activity.mjs');
 const {sceneKind}=await import('../ui/model.mjs');
 const open={tool:'browser',action:'load_tool',state:'completed',preview:{open:{browser:true},output:'Tool opened. Details will be available on the next request.'}};
 assert.equal(sceneKind(open),'toolbox');assert.equal(activityLabel(open),'浏览器说明已就绪');
 assert.equal(activityLabel({tool:'settings',action:'inspect',title:'调整设置'}),'读取当前设置');
 assert.equal(activityLabel({tool:'workspace',action:'workflow_status',title:'调整工作区'}),'核对任务进度');
 assert.equal(activityLabel({tool:'workspace',action:'new_session',targets:['D:/Bird']}),'准备项目目录 · D:/Bird');
 assert.equal(activityOutcome({tool:'settings',preview:{ok:true,secret:'never render'}}),'');
 assert.equal(activityOutcome({state:'failed',preview:{ok:false,error:'连接中断'}}),'连接中断');
 assert.equal(activityOutcome({state:'failed',detail:'{"internal":"opaque"}'}),'这一步未完成，等待重新处理。');
});
test('valid task plan survives many later tools but never another role, generation, failed update or cancellation',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs');const v=new WorkspacePresentation();
 const p={id:'p',tool:'update_plan',state:'completed',preview:{state:{phases:[{steps:[{text:'创建页面',status:'in_progress'}]}]}}};
 const ingest=(id,generation,state,items)=>v.ingest({roles:[{id,role:'matrix',generation,state,activity:{items}}]});
 ingest('m',1,'running',[p,...Array.from({length:8},(_,i)=>({id:'x'+i,tool:'settings',state:'completed'}))]);assert.equal(v.current().length,3);assert.equal(v.plan().id,'p');
 ingest('m',1,'running',[{...p,id:'bad',preview:{ok:false,error:'conflict'}}]);assert.equal(v.plan().id,'p');
 ingest('m',1,'cancelled',[]);assert.equal(v.plan().id,'p');
 ingest('m',2,'running',[]);assert.equal(v.plan(),null);
 ingest('new',1,'running',[]);assert.equal(v.plan(),null);assert.equal(v.current().length,0);
});
