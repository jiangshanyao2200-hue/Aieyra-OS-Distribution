// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: setup; overlay; wire
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/contact-thinking.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const setup=require('../src/model-setup.cjs'),pool=require('../src/model-pool.cjs'),spec=require('../src/spec.cjs');
const {draftProfile}=require('../host/connection.cjs');

// Mirrors Core mergeModelParameters: the agent's keys over the pool parameters, null removes.
function overlay(p,patch){
 const out=structuredClone(p),params=out.parameters||={};
 for(const [k,v] of Object.entries(patch)){
  if(k==='model_options'){const mo=params.model_options||={};for(const [kk,vv] of Object.entries(v)){if(vv===null)delete mo[kk];else mo[kk]=vv;}}
  else if(v===null)delete params[k];else params[k]=v;
 }
 return out;
}
function wire(p){
 const state={...spec.defaults(),model_pool_version:1,active_profile:p.id,matrix_profile:p.id,api_profiles:[p],provider_connections:[{id:pool.connectionID(p),provider:p.provider,base_url:p.base_url,api_key:'synthetic-model-config-key',api_key_history:[],request_timeout_seconds:30}]};
 return spec.buildRequest(pool.activate(state,p),[{role:'user',content:'synthetic check'}],true);
}

test('an agent thinking choice is a patch over its model, never a pool edit',async()=>{
 const p=draftProfile({base_url:'https://relay.invalid/v1',model:'gpt-6.1-sol',api_protocol:'responses',parameters:{}},{});
 const s={...spec.defaults(),model_pool_version:1,api_profiles:[p],provider_connections:[]},before=structuredClone(p);
 const call=setup.createModelSetup({file:'',providers:{},connection:()=>{},save:()=>{throw Error('no write');},version:()=>'v',load:()=>s});
 const low=await call({op:'agent_thinking',id:p.id,key:'reasoning_effort',value:'low'},'',s);
 assert.equal(low.thinking.value,'low');assert.deepEqual(wire(overlay(p,low.patch)).reasoning,{effort:'low'});
 assert.equal(wire(p).reasoning,undefined);assert.deepEqual(s.api_profiles[0],before);
 // Reading a stored patch back shows the same choice.
 assert.equal((await call({op:'agent_thinking',id:p.id,patch:low.patch},'',s)).thinking.value,'low');
 const follow=await call({op:'agent_thinking',id:p.id,key:'reasoning_effort',value:''},'',s);
 assert.deepEqual(follow.patch,{});assert.equal(follow.thinking.value,'');
 await assert.rejects(()=>call({op:'agent_thinking',id:p.id,key:'reasoning_effort',value:'none'},'',s),/无效/);
 for(const key of Object.keys(low.patch).filter(k=>k!=='model_options'))assert.match(key,/^(reasoning_effort|thinking_type|thinking_mode|reasoning_enabled|reasoning_budget)$/);
});
