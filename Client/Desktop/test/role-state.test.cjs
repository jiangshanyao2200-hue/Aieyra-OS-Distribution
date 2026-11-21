// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/role-state.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('所有角色共享正文、空思考、漏过思考事件、换代与重连的状态语义',async()=>{
 const {RoleState}=await import('../ui/eyra-state.mjs');
 const now=100000;
 for(const name of ['matrix','project','execution','image-specialist']){
  const state=new RoleState({role:name});
  const snapshot=(live={},generation=1)=>({core_epoch:'core',session_id:'session',roles:[{role:name,id:'id-'+name,generation,state:'running'}],live:{[name]:{generation,...live}}});
  const body={phase:'body',body_id:'first',body_at:now*1000,body_updated_at:now,text:'第一段'};
  assert.equal(state.project(snapshot(body),{now}).body.full,'第一段',name);
  const thinking={...body,phase:'thinking',new_body:true,thought:'',reasoning_started_at:now+1000};
  let flow=state.project(snapshot(thinking),{now:now+1000});
  assert.equal(flow.body,null,name+': 空思考也使旧正文失效');
  assert.equal(flow.state,'thinking');assert.equal(flow.thought,'');
  flow=state.project(snapshot({...thinking,thought:'当前思考'}),{now:now+1100});
  assert.equal(flow.thought,'当前思考');
  assert.equal(state.project(snapshot({...thinking,phase:'waiting'}),{now:now+1200}).body,null,name+': 等待阶段不复活旧正文');
  const fresh={...body,body_id:'fresh',body_at:(now+2000)*1000,body_updated_at:now+2000,text:'新正文'};
  assert.equal(state.project(snapshot(fresh),{now:now+2000}).body.full,'新正文');
  assert.equal(state.project(snapshot({...fresh,reasoning_history:[{started_at:now+3000}]}),{now:now+3100}).body,null,'跳过思考轮询也应清理旧正文');
  const stale=snapshot({...fresh,generation:1},2);
  flow=state.project(stale,{now:now+4000});assert.equal(flow.body,null);assert.equal(flow.thought,'');
  const newGeneration=snapshot({...fresh,generation:2,body_id:'new-generation',body_at:(now+5000)*1000},2);
  assert.equal(state.project(newGeneration,{now:now+5000}).body.full,'新正文');
  assert.equal(state.project(newGeneration,{disconnected:true,now:now+5100}).body,null);
  assert.equal(state.project(newGeneration,{now:now+5200}).body.full,'新正文','重连重新投影真实快照');
 }
});

test('成员终态使用本成员档案，不投影 Eyra 问候或其他成员的正文',async()=>{
 const {RoleState}=await import('../ui/eyra-state.mjs');
 const state=new RoleState({role:'project'});
 const snapshot={core_epoch:'core',session_id:'one',roles:[{role:'project',id:'p',generation:1,state:'completed'}],live:{},messages:[
  {id:'p-final',from:'project',to:'matrix',generation:1,state:'answered',text:'Vaya 结果',at:new Date(100000).toISOString()},
  {id:'c-final',from:'execution',to:'matrix',generation:1,state:'answered',text:'Cota 结果',at:new Date(100001).toISOString()}
 ]};
 assert.equal(state.project(snapshot).body.full,'Vaya 结果');
 assert.equal(state.project({...snapshot,session_id:'two',roles:[{role:'project',id:'p2',generation:0,state:'idle'}],messages:[],greeting:{state:'online',text:'Eyra 问候'}}).body,null);
});
