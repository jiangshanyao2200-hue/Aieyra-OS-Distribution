// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; fixture; file
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/attachments.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createAttachmentStore,validateSelection}=require('../host/attachments.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aieyra-attachments-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,store:createAttachmentStore(path.join(dir,'data','config.json'))};}
async function file(dir,name,data){const p=path.join(dir,name);await fs.writeFile(p,data);return p;}
test('attachment snapshots survive source changes and reuse only identical hash bytes',async t=>{
 const {dir,store}=await fixture(t),source=await file(dir,'资料.txt','original\r\n\t内容');
 const entries=await store.stage([source]);assert.equal(entries[0].name,'资料.txt');assert.equal(entries[0].kind,'file');assert.equal(path.basename(entries[0].asset),entries[0].sha256);
 assert.deepEqual(await store.stage([source]),entries);await fs.writeFile(source,'changed source');
 assert.deepEqual(await store.verify(entries),entries);assert.equal(await fs.readFile(entries[0].asset,'utf8'),'original\r\n\t内容');
 await fs.writeFile(entries[0].asset,'tampered');await assert.rejects(store.verify(entries),/发生变化/);
 await fs.writeFile(source,'original\r\n\t内容');await assert.rejects(store.stage([source]),/损坏/);
});
test('image classification follows bytes, rejects unsupported extensions and enforces image budgets',async t=>{
 const {dir,store}=await fixture(t),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBp0AAAAASUVORK5CYII=','base64');
 const [a]=await store.stage([await file(dir,'renamed.bin',png)]);assert.equal(a.kind,'image');assert.equal(a.mime,'image/png');await store.verify([a]);
 await assert.rejects(store.verify([{...a,kind:'file',mime:'application/octet-stream'}]),/发生变化/);
 await assert.rejects(store.stage([await file(dir,'broken.png','not an image')]),/图片只支持/);
 await assert.rejects(store.stage([await file(dir,'drawing.svg','<svg/>')]),/图片只支持/);
 assert.throws(()=>validateSelection([{...a,bytes:8*1024*1024+1}]),/8 MiB/);
 assert.throws(()=>validateSelection(Array.from({length:4},()=>({...a,bytes:8*1024*1024}))),/24 MiB/);
});
test('clipboard image bytes share snapshots and managed receipt protection with path attachments',async t=>{
 const {dir}=await fixture(t),config=path.join(dir,'managed','config.json'),owner='c'.repeat(32),store=createAttachmentStore(config,{managed:true,owner});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBp0AAAAASUVORK5CYII=','base64');
 const result=await store.chooseBytes({name:'截图 12-34-56.png',bytes:new Uint8Array(png)}),a=result.attachments[0];
 assert.equal(a.kind,'image');assert.equal(a.mime,'image/png');assert.equal(a.name,'截图 12-34-56.png');assert.deepEqual(await fs.readFile(a.asset),png);await store.verify([a]);
 const copied=await store.choose([await file(dir,a.name,png)]);assert.deepEqual(copied.attachments,result.attachments);
 const journal=path.join(dir,'managed/runtime/attachments/references-v2',owner+'.json'),state=JSON.parse(await fs.readFile(journal,'utf8'));
 assert.deepEqual(state.pending[result.receipt],[a.sha256]);assert.deepEqual(state.pending[copied.receipt],[a.sha256]);
 for(const bytes of [new Uint8Array(),new Uint8Array(8*1024*1024+1),new Uint8Array([1,2,3])])await assert.rejects(store.chooseBytes({name:'bad.png',bytes}));
 await assert.rejects(store.chooseBytes({name:'../bad.png',bytes:new Uint8Array(png)}),/记录不完整/);
 await assert.rejects(store.stage([dir]),/文件夹/);await assert.rejects(store.stage(['relative.txt']),/本地文件/);
 await fs.writeFile(a.asset,'tampered');await assert.rejects(store.chooseBytes({name:a.name,bytes:new Uint8Array(png)}),/损坏/);
});
test('attachment validation rejects foreign paths, metadata and oversized selections',async t=>{
 const {dir,store}=await fixture(t),[a]=await store.stage([await file(dir,'empty.txt','')]);
 for(const patch of [{name:'../bad'},{sha256:'Z'.repeat(64)},{bytes:-1},{bytes:32*1024*1024+1},{mime:'text/html'}])assert.throws(()=>validateSelection([{...a,...patch}]));
 await assert.rejects(store.verify([{...a,asset:path.join(dir,a.sha256)}]),/不属于/);
 await assert.rejects(store.verify([{...a,bytes:1}]),/发生变化/);
 assert.throws(()=>validateSelection(Array(11).fill(a)),/10 个/);
 assert.throws(()=>validateSelection(Array(3).fill({...a,bytes:32*1024*1024})),/64 MiB/);
 const sparse=await fs.open(path.join(dir,'too-large'),'w');await sparse.truncate(32*1024*1024+1);await sparse.close();await assert.rejects(store.stage([path.join(dir,'too-large')]),/32 MiB/);
});
test('queued attachments retain immutable metadata and original IDs after lost acknowledgements',async t=>{
 const {dir,store}=await fixture(t),entries=await store.stage([await file(dir,'queued.txt','queued bytes')]);
 const {SendQueue}=await import('../ui/send-queue.mjs');let saved=[];
 const q=new SendQueue('task',[],v=>saved=structuredClone(v));q.add('','request',entries);entries[0].name='changed';
 await assert.rejects(q.drain(async()=>{throw Error('lost ack');}),/lost ack/);
 const reload=new SendQueue('task',saved);assert.equal(reload.entries[0].attachments[0].name,'queued.txt');
 let sent=0;await assert.rejects(reload.drain(async()=>{sent++;}),/暂未查到接收结果/);assert.equal(sent,0);assert.equal(reload.entries.length,1);
 const checked=[];await reload.drain(async()=>{sent++;},async entry=>{checked.push(entry.request_id);await store.verify(entry.attachments);return true;});assert.equal(sent,0);assert.deepEqual(checked,['request']);assert.equal(reload.entries.length,0);
});
test('renderer validates persisted metadata and keeps the caller draft on queue storage failure',async t=>{
 const {dir,store}=await fixture(t),entries=await store.stage([await file(dir,'draft.txt','draft bytes')]);
 const {SendQueue}=await import('../ui/send-queue.mjs'),{validateAttachments}=await import('../ui/attachments.mjs');
 for(const patch of [{name:'a/b'},{mime:'text/html'},{kind:'image',mime:'image/png',bytes:9*1024*1024}])assert.throws(()=>validateAttachments([{...entries[0],...patch}]));
 const q=new SendQueue('task',[],()=>{throw Error('storage full');});assert.throws(()=>q.add('keep','same-id',entries),/storage full/);assert.equal(q.entries.length,0);assert.equal(entries.length,1);await store.verify(entries);
});
test('paste handles use distinct numbering and repasting expands the original payload',async()=>{
 const {PasteDraft}=await import('../ui/paste-blocks.mjs'),d=new PasteDraft();
 assert.equal(d.pack('a\nb\nc'),'a\nb\nc');assert.equal(d.pack('中'.repeat(200)),'中'.repeat(200));
 const one=d.pack('a\nb\nc\nd'),two=d.pack('a\nb\nc\nd\ne');assert.equal(one,'⟦粘贴 1 · 4 行⟧');assert.equal(two,'⟦粘贴 2 · 5 行⟧');
 const literal=d.pack(one);assert.notEqual(literal,one);assert.equal(d.expand(literal),'a\nb\nc\nd');
 const restored=new PasteDraft();restored.restore(two,d.serialize(two));assert.equal(restored.expand(two),'a\nb\nc\nd\ne');
 const legacy='⟦粘贴 11234567-abcd-0123-abcd-0123456789ab · 2 行⟧';restored.restore(legacy,JSON.stringify({version:1,value:legacy,blocks:[[legacy,'old\nformat']]}));assert.equal(restored.expand(legacy),'old\nformat');
});
