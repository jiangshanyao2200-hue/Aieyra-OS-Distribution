// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; owner; fixture; source; read
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/attachment-references.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createAttachmentStore}=require('../host/attachments.cjs');
const owner='a'.repeat(32),other='b'.repeat(32);
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-refs-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const config=path.join(dir,'config.json');return {dir,config,store:createAttachmentStore(config,{managed:true,owner}),journal:path.join(dir,'runtime','attachments','references-v2',owner+'.json')};}
async function source(dir,name,text){const p=path.join(dir,name);await fs.writeFile(p,text);return p;}
async function read(p){return JSON.parse(await fs.readFile(p,'utf8'));}
test('managed selection persists a receipt before returning and never adopts a legacy snapshot',async t=>{
 const {dir,config,store,journal}=await fixture(t),f=await source(dir,'source','snapshot');
 const legacy=createAttachmentStore(config);const [old]=await legacy.stage([f]);const selected=await store.choose([f]);
 assert.notEqual(selected.attachments[0].asset,old.asset);assert.equal(path.basename(path.dirname(selected.attachments[0].asset)),'v2');
 const state=await read(journal);assert.deepEqual(state.pending[selected.receipt],[selected.attachments[0].sha256]);
 assert.deepEqual(await read(selected.attachments[0].asset+'.json'),{version:2,sha256:selected.attachments[0].sha256,bytes:8});
 await store.verify([old,...selected.attachments]);
});
test('explicit receipt acknowledgement can drop a late selection while preserving other task drafts',async t=>{
 const {dir,store,journal}=await fixture(t),token=store.references.begin();
 const first=await store.choose([await source(dir,'draft','kept draft')]),late=await store.choose([await source(dir,'late','discarded late')]);
 await store.references.sync({token,sequence:1,hashes:first.attachments.map(a=>a.sha256),receipts:[first.receipt,late.receipt]});
 const state=await read(journal);assert.deepEqual(state.refs,first.attachments.map(a=>a.sha256));assert.deepEqual(state.pending,{});
 assert.equal(await fs.readFile(late.attachments[0].asset,'utf8'),'discarded late');
});
test('an older snapshot cannot acknowledge a newer selection or cancel its pin',async t=>{
 const {dir,store,journal}=await fixture(t),token=store.references.begin();
 await store.references.sync({token,sequence:4,hashes:[],receipts:[]});
 const selected=await store.choose([await source(dir,'new','selected after old snapshot')]);
 assert.equal((await store.references.sync({token,sequence:3,hashes:[],receipts:[selected.receipt]})).stale,true);
 assert.deepEqual((await read(journal)).pending[selected.receipt],selected.attachments.map(a=>a.sha256));
 const next=store.references.begin();assert.equal((await store.references.sync({token,sequence:5,hashes:[],receipts:[selected.receipt]})).stale,true);
 await store.references.sync({token:next,sequence:1,hashes:selected.attachments.map(a=>a.sha256),receipts:[selected.receipt]});assert.deepEqual((await read(journal)).pending,{});
});
test('unacknowledged selections and uncertain sends survive a new host instance',async t=>{
 const {dir,config,store,journal}=await fixture(t),selected=await store.choose([await source(dir,'unknown','unknown send')]);
 await store.references.pinSend('task/request',selected.attachments.map(a=>a.sha256));
 const restored=createAttachmentStore(config,{managed:true,owner});const token=restored.references.begin();
 await restored.references.sync({token,sequence:1,hashes:[],receipts:[]});
 const state=await read(journal);assert.deepEqual(state.pending[selected.receipt],selected.attachments.map(a=>a.sha256));assert.deepEqual(state.sends['task/request'],state.pending[selected.receipt]);
 await restored.references.settleSend('task/request');assert.deepEqual((await read(journal)).sends,{});assert((await read(journal)).pending[selected.receipt]);
});
test('two native owners keep independent durable references for the same snapshot',async t=>{
 const {dir,config,store,journal}=await fixture(t),f=await source(dir,'same','shared snapshot');
 const otherStore=createAttachmentStore(config,{managed:true,owner:other});const [a,b]=await Promise.all([store.choose([f]),otherStore.choose([f])]);
 assert.deepEqual(a.attachments,b.attachments);const token=store.references.begin();await store.references.sync({token,sequence:1,hashes:[],receipts:[a.receipt]});
 assert.deepEqual((await read(journal)).pending,{});
 assert((await read(path.join(path.dirname(journal),other+'.json'))).pending[b.receipt]);
});
test('storage failure cannot release a receipt or overwrite a prior durable draft',async t=>{
 const {dir,store,journal}=await fixture(t),selected=await store.choose([await source(dir,'draft','durable draft')]),before=await fs.readFile(journal),token=store.references.begin();
 const parent=path.dirname(journal),backup=parent+'-saved';await fs.rename(parent,backup);await fs.writeFile(parent,'blocked');
 await assert.rejects(store.references.sync({token,sequence:1,hashes:[],receipts:[selected.receipt]}));
 assert.deepEqual(await fs.readFile(path.join(backup,path.basename(journal))),before);
 await fs.unlink(parent);await fs.rename(backup,parent);
 await store.references.sync({token,sequence:1,hashes:selected.attachments.map(a=>a.sha256),receipts:[selected.receipt]});assert.deepEqual((await read(journal)).refs,selected.attachments.map(a=>a.sha256));
});
test('corrupt durable references block further mutation and preserve exact original bytes',async t=>{
 const {dir,config,store,journal}=await fixture(t);await store.choose([await source(dir,'existing','data')]);
 const corrupt='{"version":2,"owner":"'+owner+'","refs":[],"pending":[],"sends":{}}';await fs.writeFile(journal,corrupt);
 const restored=createAttachmentStore(config,{managed:true,owner});await assert.rejects(restored.references.pinSend('id',[]),/损坏/);assert.equal(await fs.readFile(journal,'utf8'),corrupt);
});
