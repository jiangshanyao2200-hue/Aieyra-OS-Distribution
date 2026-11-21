// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: draft; deferred
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/shared-draft.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const draft=value=>({value,pastes:'',attachments:[]});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
test('a failed shared draft cannot resurrect behind a newer write already queued for the same store',async()=>{
 const {createSharedDraftPersistence}=await import('../ui/shared-draft.mjs'),first=deferred(),started=deferred(),saved=[];
 const controller=createSharedDraftPersistence(async p=>{saved.push(p);if(saved.length===1){started.resolve();await first.promise;}return {ok:true,revision:'saved-'+saved.length};},{delay:10000});
 controller.initialize({revision:'initial',draft:draft('')});controller.schedule(draft('old'));
 const writing=controller.flush(),rejected=assert.rejects(writing,/disk unavailable/);await started.promise;
 controller.schedule(draft('latest'));const next=controller.flush();first.reject(Error('disk unavailable'));await rejected;await next;await controller.drain();
 assert.deepEqual(saved.map(p=>p.draft.value),['old','latest']);assert.equal(controller.busy,false);
});
test('a shared write owns its read revision as soon as it is queued, before the save microtask starts',async()=>{
 const {createSharedDraftPersistence}=await import('../ui/shared-draft.mjs'),saved=[];
 const controller=createSharedDraftPersistence(async p=>{saved.push(p);return {ok:true,revision:'local-saved'};},{delay:10000});
 controller.initialize({revision:'initial',draft:draft('')});controller.schedule(draft('local'));const writing=controller.flush();
 const busy=controller.busy,accepted=controller.accept({revision:'foreign',draft:draft('another view')});await writing;
 assert.equal(busy,true);assert.equal(accepted,false);assert.equal(saved[0].revision,'initial');
 assert.equal(controller.accept({revision:'foreign-newer',draft:draft('another view')}),true);
});
test('changing back to the saved shared draft during a write persists the latest text and attachments',async()=>{
 const {createSharedDraftPersistence}=await import('../ui/shared-draft.mjs'),gate=deferred(),started=deferred(),saved=[];
 const controller=createSharedDraftPersistence(async p=>{saved.push(p);if(saved.length===1){started.resolve();await gate.promise;}return {ok:true,revision:'saved-'+saved.length};},{delay:10000});
 const original={...draft('原文🙂'),attachments:[{id:'kept-reference'}]};controller.initialize({revision:'initial',draft:original});
 controller.schedule(draft('intermediate'));const writing=controller.flush();await started.promise;controller.schedule(original);gate.resolve();await writing;await controller.drain();
 assert.deepEqual(saved.map(p=>p.draft),[draft('intermediate'),original]);assert.deepEqual(saved.map(p=>p.revision),['initial','saved-1']);
});
