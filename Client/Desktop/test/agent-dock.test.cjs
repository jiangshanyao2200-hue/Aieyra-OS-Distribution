// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; assert; path; load
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/agent-dock.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.join(__dirname,'..','ui','agent-dock.mjs')).href);
test('Brief rows stay before a final reply that has already entered the archive',async()=>{
 const {mergeEntries}=await load(),history=[{id:'archive:u',snapshotId:'u',from:'user'},{id:'archive:reply',snapshotId:'reply',from:'eyra',text:'最终正文'}];
 const merged=mergeEntries(history,[{id:'u',from:'user'},{id:'brief:1',brief:true,text:'真实工作'},{id:'final:work',snapshotId:'reply',response:true,from:'eyra',text:'最终正文'}]);
 assert.deepEqual(merged.map(m=>m.id),['archive:u','brief:1','final:work']);assert.equal(merged.at(-1).text,'最终正文');
});
test('a persisted final snapshot merges once while retaining its live display identity and receipt',async()=>{
 const {mergeEntries}=await load(),receipt={entry_id:'saved'};
 const rows=mergeEntries([{id:'history:final',snapshotId:'reply:1',text:'存档摘要',textMore:true,receiptRef:receipt}],[{id:'live:segment',snapshotId:'reply:1',from:'eyra',text:'完整正文',response:true}]);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'live:segment');assert.equal(rows[0].text,'存档摘要');assert.equal(rows[0].receiptRef,receipt);
});

test('settled chat hides transient and failed bodies without removing their originals',async()=>{
 const {visibleChat}=await load(),entries=[{id:'user',from:'user'},{id:'progress',from:'eyra',process:true,text:'original progress'},{id:'partial',from:'eyra',state:'failed',text:'partial output'},{id:'final',from:'eyra',state:'completed',text:'done'}];
 assert.deepEqual(visibleChat(entries).map(e=>e.id),['user','final']);assert.equal(entries[1].text,'original progress');assert.equal(entries[2].text,'partial output');
});

test('chat_page 行转成聊天条目，原文引用不占用 receipt 字段',async()=>{
 const {entryOf}=await load();
 const ref={action:'history_receipt',id:'s1',entry_id:'s1:9'};
 const user=entryOf({id:'s1:9',snapshot_id:'m9',round_id:'s1:r1',sender_id:'user',text:'你好',at:'2026-11-11T10:00:00Z',text_more:true,receipt:ref});
 assert.equal(user.from,'user');
 assert.equal(user.snapshotId,'m9');
 assert.equal(user.textMore,true);
 assert.deepEqual(user.receiptRef,ref);
 assert.equal(user.receipt,undefined);
 const reply=entryOf({id:'s1:10',sender_id:'conversation',text:'好的'},()=>({role:'conversation',name:'Cota'}));
 assert.equal(reply.from,'eyra');
 assert.equal(reply.identity.name,'Cota');
 assert.equal(reply.role,'conversation');
});

test('合并：实时条目按 snapshot_id 对上历史，沿用历史 id 与原文入口',async()=>{
 const {mergeEntries}=await load();
 const history=[{id:'context-message:abc',snapshotId:'m1',text:'旧',textMore:false,receiptRef:{entry_id:'x'}},{id:'message:m2',snapshotId:'m2',text:'二'}];
 const merged=mergeEntries(history,[{id:'m1',text:'新'},{id:'m2',text:'二'},{id:'m3',text:'三'}]);
 assert.deepEqual(merged.map(e=>e.id),['context-message:abc','message:m2','m3']);
 assert.equal(merged[0].text,'新');
 assert.equal(merged[0].textMore,false);
 assert.deepEqual(merged[0].receiptRef,{entry_id:'x'});
 assert.equal(history.length,2);
 assert.equal(history[0].text,'旧');
});

test('合并：正文暂空时保留“查看全部”标记，重复的实时 id 只占一行',async()=>{
 const {mergeEntries}=await load();
 const kept=mergeEntries([{id:'h1',snapshotId:'m1',text:'预览',textMore:true}],[{id:'m1',text:''}]);
 assert.equal(kept.length,1);
 assert.equal(kept[0].textMore,true);
 assert.equal(kept[0].text,'预览');
 const twice=mergeEntries([],[{id:'m3',text:'a'},{id:'m3',text:'b'}]);
 assert.equal(twice.length,1);
 assert.equal(twice[0].text,'b');
 assert.deepEqual(mergeEntries([],[]),[]);
});


test('长消息保留档案摘要和原文分页，不被完整实时快照展开',async()=>{
 const {mergeEntries}=await load();
 const ref={entry_id:'long-original'},history=[{id:'archive',snapshotId:'reply',text:'开头摘要',textMore:true,receiptRef:ref}];
 const merged=mergeEntries(history,[{id:'reply',text:'开头摘要'+('完整原文'.repeat(4000))+'末尾',state:'completed'}]);
 assert.equal(merged.length,1);assert.equal(merged[0].text,'开头摘要');assert.equal(merged[0].state,'completed');assert.deepEqual(merged[0].receiptRef,ref);
 const live=mergeEntries([],[{id:'reply',text:'正在流式生成',streaming:true}]);assert.equal(live[0].text,'正在流式生成');
});
