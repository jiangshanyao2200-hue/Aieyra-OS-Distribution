// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/basic-stage.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('cloud icon follows verified cloud/device state and rejects local-only, stale and failed observations',async()=>{
 const {cloudStatus}=await import('../ui/cloud-status.mjs'),now=Date.now();
 const good={cloud_available:true,device_ready:true,cloud_checked_at:new Date(now).toISOString()};
 assert.equal(cloudStatus(good,now).connected,true);
 for(const state of [{available:true,page_ready:true},{...good,device_ready:false},{...good,cloud_error:'offline'},{...good,cloud_available:false},{...good,cloud_checked_at:new Date(now-91000).toISOString()},{...good,cloud_checked_at:new Date(now+6000).toISOString()}])assert.deepEqual(cloudStatus(state,now),{connected:false,label:'云端未连接'});
 assert.equal(cloudStatus({...good,cloud_available:true},now).connected,true);
});
test('release switches remain separate from model preferences and defaults are closed',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-stage-')),previous=process.env.AIEYRA_RESOURCE_ROOT,resources=require('../src/resources.cjs');
 try{
  process.env.AIEYRA_RESOURCE_ROOT=root;fs.mkdirSync(path.join(root,'Config'));
  assert.deepEqual(resources.releaseStage(),{team_collaboration:false,toolbox:false,link_situation:false,cli:false,os_first_ring:false});
  fs.writeFileSync(path.join(root,'Config','运行参数.json'),JSON.stringify({release_stage:{team_collaboration:false,toolbox:true,link_situation:true,cli:'true'}}));
  assert.deepEqual(resources.releaseStage(),{team_collaboration:false,toolbox:true,link_situation:true,cli:false,os_first_ring:false});
 }finally{if(previous===undefined)delete process.env.AIEYRA_RESOURCE_ROOT;else process.env.AIEYRA_RESOURCE_ROOT=previous;fs.rmSync(root,{recursive:true,force:true});}
});
