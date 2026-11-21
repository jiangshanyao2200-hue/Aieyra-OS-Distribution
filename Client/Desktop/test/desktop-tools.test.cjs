// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/desktop-tools.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDesktopTools}=require('../host/desktop-tools.cjs');

function fixture(){
 const pages=[];
 const tools=createDesktopTools({
  surface:{navigate:page=>{pages.push(page);return {ok:true,embedded:true,page};}},
  link:{status:async()=>({hub_state:'online',device_code:'secret-should-not-leak'})},
  control:{status:async()=>({available:true,office:{count:2}})},
  sessionId:'owned-os',
 });
 return {tools,pages};
}

test('desktop tools keep Link status and Eyra composer actions for the current OS session',async()=>{
 const {tools,pages}=fixture();
 const status=await tools.call({action:'link_status'},'owned-os');
 assert.deepEqual(status,{ok:true,connection:{hub_state:'online'},office:{count:2},available:true});
 for(const action of ['link_open','eyra_open','eyra_close'])assert.equal((await tools.call({action},'owned-os')).ok,true);
 assert.deepEqual(pages,['link','eyra','collapse-eyra']);
});

test('retired canvas aliases direct callers to the current Workspace program',async()=>{
 const {tools,pages}=fixture();
 for(const action of ['canvas_inspect','canvas_document','canvas_collect','canvas_folder','editor_open','editor_save'])
  await assert.rejects(tools.call({action},'owned-os'),e=>e.code==='UNAVAILABLE'&&/id=aieyra.workspace/.test(e.message));
 assert.deepEqual(pages,[]);
});

test('other sessions, malformed requests and unknown actions are rejected',async()=>{
 const {tools}=fixture();
 await assert.rejects(tools.call({action:'link_status'},'other'),e=>e.code==='SESSION_CONFLICT');
 await assert.rejects(tools.call(null,'owned-os'),e=>e.code==='INVALID_REQUEST');
 await assert.rejects(tools.call({action:'format_disk'},'owned-os'),e=>e.code==='UNKNOWN_ACTION');
});

test('legacy Link status and fallback open cannot wake a disabled office',async()=>{
 const calls=[];const tools=createDesktopTools({sessionId:'owner',authorizeLink:()=>{throw Error('disabled');},link:{status:()=>calls.push('device')},control:{status:()=>calls.push('office')},surface:{navigate:()=>calls.push('open')}});
 for(const action of ['link_status','link_open'])await assert.rejects(tools.call({action},'owner'),/disabled/);assert.deepEqual(calls,[]);
});
test('already cancelled legacy navigation cannot open or collapse the composer',async()=>{
 const {tools,pages}=fixture(),cancel=new AbortController();cancel.abort();
 for(const action of ['eyra_open','eyra_close','link_open'])await assert.rejects(tools.call({action},'owned-os',cancel.signal),error=>error.code==='CANCELLED');
 assert.deepEqual(pages,[]);
});
test('fallback Link admission rechecks cancellation before navigating after an asynchronous verification',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),pages=[],cancel=new AbortController();
 const tools=createDesktopTools({sessionId:'owner',surface:{navigate:page=>pages.push(page)},authorizeLink:async fn=>{entered();await gate;return fn();}});
 const opening=tools.call({action:'link_open'},'owner',cancel.signal);await started;cancel.abort();release();
 await assert.rejects(opening,error=>error.code==='CANCELLED');assert.deepEqual(pages,[]);
});
