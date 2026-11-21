// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; empty; fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/outbox-persistence.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createComposerDraft}=require('../host/composer-draft.cjs');
const {createAttachmentStore}=require('../host/attachments.cjs');
const empty=()=>({value:'',pastes:'',attachments:[]});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eyra-outbox-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,config:path.join(dir,'Config/config.json'),work:path.join(dir,'work')};}
test('fresh host recovers never-dispatched and uncertain entries with bytes, identities and attachment pins',async t=>{
 const {config,work,dir}=await fixture(t),assets=createAttachmentStore(config,{managed:true,owner:'b'.repeat(32)}),selected=await assets.chooseFileBytes({name:'未发.txt',bytes:Buffer.from('still needed')});
 const {SendQueue}=await import('../ui/send-queue.mjs');let outbox;
 const q=new SendQueue('old-task',[],rows=>outbox=structuredClone(rows));q.add('原文\r\n\t🙂','uncertain',selected.attachments);q.add('还没有派发','unsent',selected.attachments);
 await assert.rejects(q.drain(async()=>{throw Error('lost ACK');}));
 const store=createComposerDraft(config,work),opened=await store.open();await store.save({token:opened.token,sequence:1,draft:{...empty(),outbox}});
 const reopened=await createComposerDraft(config,work).open();assert.equal(reopened.draft.outbox[0].text,'原文\r\n\t🙂');assert.equal(reopened.draft.outbox[0].delivery,'pending');assert.equal(reopened.draft.outbox[1].delivery,'prepared');assert.deepEqual(reopened.draft.outbox.map(x=>x.request_id),['uncertain','unsent']);
 await assets.verify(reopened.draft.outbox[0].attachments);
 const refs=JSON.parse(await fs.readFile(path.join(dir,'Data/runtime/attachments/references-v2',path.basename(store.file)),'utf8'));assert.deepEqual(refs.sends['composer-draft'],selected.attachments.map(a=>a.sha256));
 assert.deepEqual((await createComposerDraft(config,work+'-other').open()).draft,empty());
});
test('definitive rejection survives a new host and can be revised without changing newer queued work',async t=>{
 const {config,work}=await fixture(t),{SendQueue}=await import('../ui/send-queue.mjs'),q=new SendQueue('old-task');q.add('rejected original','first');q.add('newer work','second');
 await assert.rejects(q.drain(async e=>{throw Object.assign(Error('attachment rejected'),{send_rejection:{code:'attachment_rejected',task_id:e.session_id,request_id:e.request_id}});}));
 const store=createComposerDraft(config,work),opened=await store.open();await store.save({token:opened.token,sequence:1,draft:{...empty(),outbox:q.entries}});
 const restored=new SendQueue('old-task',(await createComposerDraft(config,work).open()).draft.outbox);assert.equal(restored.entries[0].rejection.code,'attachment_rejected');
 const changed=restored.revise('first','corrected',[]);assert.notEqual(changed.request_id,'first');assert.equal(restored.entries[1].request_id,'second');assert.equal(restored.entries[1].delivery,'prepared');
});
test('flush failure does not cross the dispatch boundary; retry uses the same request identity',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let durable,fail=true,calls=0;
 const q=new SendQueue('task');q.add('work','original');
 const flush=async()=>{if(fail)throw Error('disk unavailable');durable=structuredClone(q.entries);};
 await assert.rejects(q.drain(async()=>calls++,async()=>false,flush),/disk unavailable/);assert.equal(calls,0);assert.equal(q.entries[0].request_id,'original');assert.equal(q.entries[0].delivery,'prepared');assert.equal(q.entries[0].rejection.code,'local_save_failed');
 fail=false;await q.drain(async e=>{assert.equal(durable[0].delivery,'pending');assert.equal(durable[0].request_id,e.request_id);calls++;},async()=>false,flush);assert.equal(calls,1);assert.equal(q.entries.length,0);
});
test('local retry failure never reclassifies an earlier uncertain send as editable',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs'),q=new SendQueue('task');q.add('可能已经收到','identity');
 let calls=0;await assert.rejects(q.drain(async()=>{calls++;throw Error('lost ACK');}));
 await assert.rejects(q.drain(async()=>calls++,async()=>false,async()=>{throw Error('disk unavailable');}));
 assert.equal(calls,1);assert.equal(q.entries[0].delivery,'pending');assert.equal(q.entries[0].rejection,undefined);assert.throws(()=>q.revise('identity','edited',[]),/确认/);
});
test('a pre-dispatch failure preserves body and attachments across storage recovery and a fresh host',async t=>{
 const {config,work}=await fixture(t),{SendQueue}=await import('../ui/send-queue.mjs'),assets=createAttachmentStore(config,{managed:true,owner:'c'.repeat(32)});
 const selected=await assets.chooseFileBytes({name:'保留.txt',bytes:Buffer.from('retained')});const q=new SendQueue('task');q.add('不能丢失\r\n🙂','identity',selected.attachments);
 await assert.rejects(q.drain(async()=>assert.fail('must not dispatch'),async()=>false,async()=>{throw Error('disk unavailable');}));
 const store=createComposerDraft(config,work),opened=await store.open();await store.save({token:opened.token,sequence:1,draft:{...empty(),outbox:q.entries}});await store.close();
 const restored=new SendQueue('task',(await createComposerDraft(config,work).open()).draft.outbox);assert.equal(restored.entries[0].rejection.code,'local_save_failed');await assets.verify(restored.entries[0].attachments);
 const retained=structuredClone(restored.entries[0].attachments),sent=[];await restored.drain(async e=>sent.push(e));assert.equal(sent.length,1);assert.equal(sent[0].request_id,'identity');assert.equal(sent[0].text,'不能丢失\r\n🙂');assert.deepEqual(sent[0].attachments,retained);
});
test('model admission rejection remains editable after a fresh host without authorizing an uncertain send',async t=>{
 const {config,work}=await fixture(t),{SendQueue}=await import('../ui/send-queue.mjs'),q=new SendQueue('task');q.add('未配置模型时的原文\r\n🙂','original');
 await assert.rejects(q.drain(async e=>{throw Object.assign(Error('尚未配置模型'),{send_rejection:{code:'not_admitted',task_id:e.session_id,request_id:e.request_id}});}));
 const store=createComposerDraft(config,work),opened=await store.open();await store.save({token:opened.token,sequence:1,draft:{...empty(),outbox:q.entries}});await store.close();
 const restored=new SendQueue('task',(await createComposerDraft(config,work).open()).draft.outbox);assert.equal(restored.entries[0].rejection.code,'not_admitted');assert.equal(restored.entries[0].text,'未配置模型时的原文\r\n🙂');assert.notEqual(restored.revise('original','修正后重试',[]).request_id,'original');
});
test('invalid outbox never replaces a valid durable draft, including duplicate identities and oversized entries',async t=>{
 const {config,work}=await fixture(t),store=createComposerDraft(config,work),opened=await store.open(),entry={session_id:'s',request_id:'r',text:'keep',delivery:'prepared',attachments:[]};
 await store.save({token:opened.token,sequence:1,draft:{...empty(),outbox:[entry]}});const original=await fs.readFile(store.file);
 for(const outbox of [[entry,entry],[{...entry,text:'x'.repeat(65537)}],[{...entry,session_id:'../../elsewhere'}],[{...entry,delivery:'accepted'}],[{...entry,attachments:[{}]}]])await assert.rejects(store.save({token:opened.token,sequence:2,draft:{...empty(),outbox}}));
 assert.deepEqual(await fs.readFile(store.file),original);
});
