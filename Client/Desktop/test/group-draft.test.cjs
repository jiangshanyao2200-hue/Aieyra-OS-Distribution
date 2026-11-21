// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/group-draft.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGroupDraftStore}=require('../host/group-draft.cjs');

test('group drafts survive store reopen and reject stale writers without losing text',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-group-draft-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=path.join(root,'Config','config.json');fs.mkdirSync(path.dirname(config),{recursive:true});
 const id='a'.repeat(32),first=createGroupDraftStore(config),empty=await first.load(id);
 assert.deepEqual(empty,{ok:true,text:'',revision:'missing'});
 const saved=await first.save({id,text:'群里尚未发送的计划 🪶',expected_revision:empty.revision});assert.equal(saved.ok,true);
 const reopened=createGroupDraftStore(config),restored=await reopened.load(id);
 assert.equal(restored.text,'群里尚未发送的计划 🪶');assert.equal(restored.revision,saved.revision);
 const stale=await first.save({id,text:'旧窗口的内容',expected_revision:empty.revision});
 assert.equal(stale.ok,false);assert.equal(stale.code,'GROUP_DRAFT_CONFLICT');
 assert.equal((await reopened.load(id)).text,'群里尚未发送的计划 🪶');
 const cleared=await reopened.save({id,text:'',expected_revision:restored.revision});assert.equal(cleared.revision,'missing');
 assert.equal((await first.load(id)).text,'');
 await assert.rejects(first.load('../bad'),/群聊标识无效/u);
 await assert.rejects(first.save({id,text:'x',expected_revision:'wrong'}),/群聊草稿版本无效/u);
});

test('close flush reports a pending disk failure instead of confirming a clean shutdown',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-group-draft-flush-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=path.join(root,'Config','config.json');fs.mkdirSync(path.dirname(config),{recursive:true});
 const id='b'.repeat(32),store=createGroupDraftStore(config),lock=path.join(root,'Data','runtime','group-drafts',id+'.json.write-lock');
 fs.mkdirSync(path.dirname(lock),{recursive:true});fs.mkdirSync(lock);
 const saving=store.save({id,text:'磁盘失败时仍需留在窗口里的草稿',expected_revision:'missing'});
 const draining=store.flush();
 await assert.rejects(saving,/草稿保存锁异常/u);
 await assert.rejects(draining,/草稿保存锁异常/u);
});
