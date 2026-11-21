// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/link-program.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLinkProgram}=require('../../../Program/official/link/desktop.cjs');
function fixture(options={}){
 const events=[];let enabled=true,failRelease=false;
 const agent={start:()=>events.push('start'),close:async()=>events.push('disconnect'),call:async p=>{events.push(p);return {ok:true,...p};}};
 const program=createLinkProgram({assert(){if(!enabled)throw Error('disabled');},run:async fn=>{if(!enabled)throw Error('disabled');return fn();},createAgent:()=>agent,
  createConnection:()=>{events.push('connection');return {status:async()=>({ok:true}),deviceCode:async()=>({ok:true}),close:async()=>events.push('connection-close')};},
  release:async()=>{events.push('release');if(failRelease)throw Error('release unconfirmed');},...options});
 return {program,events,agent,enable:value=>{enabled=value;},failRelease:value=>{failRelease=value;}};
}
test('disabled Link cannot start through status, invitation, legacy calls or program operations',async()=>{
 const f=fixture();f.enable(false);assert.equal(f.program.activateIfAdmitted(),false);
 for(const call of [()=>f.program.status(),()=>f.program.deviceCode(),()=>f.program.agentCall({action:'join'}),()=>f.program.snapshot(),()=>f.program.invoke('post',{body:'text'}),()=>f.program.run(()=>f.events.push('control-open'))])await assert.rejects(call,/disabled/);
 assert.deepEqual(f.events,[]);
 f.enable(true);assert.equal(f.program.activateIfAdmitted(),true);await f.program.status();assert.deepEqual(f.events,['connection','start']);await f.program.close();
 f.enable(false);await assert.rejects(f.program.status(),/disabled/);assert.deepEqual(f.events,['connection','start','disconnect','connection-close','release']);
});
test('release waits for accepted operations and failed release blocks restart until confirmed',async()=>{
 const f=fixture();let finish;const gate=new Promise(r=>{finish=r;});let started;
 const ready=new Promise(r=>{started=r;});
 const request=f.program.run(async()=>{started();await gate;f.events.push('write-receipt');});await ready;
 f.failRelease(true);const closing=f.program.close();await assert.rejects(f.program.status(),/释放/);assert.equal(f.events.includes('disconnect'),false);
 finish();await request;await assert.rejects(closing,/unconfirmed/);
 assert.ok(f.events.indexOf('write-receipt')<f.events.indexOf('disconnect'));assert.equal(f.program.activateIfAdmitted(),false);
 await assert.rejects(f.program.agentCall({action:'join'}),/释放/);
 f.failRelease(false);await f.program.close();await f.program.status();assert.equal(f.events.filter(e=>e==='connection').length,2);await f.program.close();
});
test('Link carries the Program receipt identity into the existing office write and rejects mismatch',async()=>{
 const f=fixture({autoJoin:false});
 const out=await f.program.invoke('post',{body:'same request'},{request_id:'program-request-1'});assert.equal(out.request_id,'program-request-1');
 await assert.rejects(f.program.invoke('post',{body:'wrong',request_id:'other'},{request_id:'program-request-1'}),/身份/);
 assert.equal(f.events.filter(e=>e?.action==='post').length,1);assert.equal(f.events.includes('start'),false);await f.program.close();
});
test('old Electron entry delegates to the shared Core launcher without inheriting an owner lease',()=>{
 const {forwardToSharedCore}=require('../host/modules/main.cjs');let actual;
 const child={once(){return this;},unref(){}};
 forwardToSharedCore({root:'/fixture',args:['--module=link','--config=/private/config.json','--unsafe=1'],env:{AIEYRA_OS_OWNER_TOKEN:'owned',NODE_OPTIONS:'preload',AIEYRA_MODULE_TEST_CDP_PORT:'9333',AIEYRA_MODULE_OFFSCREEN:'0'},exists:()=>true,launch:(...args)=>{actual=args;return child;}});
 assert.match(actual[0],/Aieyra Link(?:\.exe)?$/);assert.deepEqual(actual[1],['--config=/private/config.json']);
 assert.equal(actual[2].env.AIEYRA_OS_OWNER_TOKEN,undefined);assert.equal(actual[2].env.NODE_OPTIONS,undefined);assert.equal(actual[2].env.AIEYRA_WORKSPACE_TEST_CDP_PORT,'9333');assert.equal(actual[2].env.AIEYRA_WORKSPACE_OFFSCREEN,'0');
 assert.throws(()=>forwardToSharedCore({args:['--module=link'],exists:()=>false}),/启动器缺失/);
});
