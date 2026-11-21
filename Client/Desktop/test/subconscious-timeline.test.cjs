// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/subconscious-timeline.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict');
test('subconscious has one bounded live identity; Eyra stays newest and completion removes all process',async()=>{
 const {SubconsciousTimeline,subconsciousFrame}=await import('../ui/subconscious-timeline.mjs');
 const timeline=new SubconsciousTimeline(),a={id:1,message_id:'sub-one',actor:'subconscious',state:'running',started:100,phase:'thinking',thought:'真实公开思考'};
 const frame=rows=>({session_id:'task',core_epoch:'epoch',subconscious:{activities:rows}});
 timeline.ingest(frame([a]));let rows=timeline.entries([{id:'user',from:'user',text:'问',at:50},{id:'eyra',from:'eyra',text:'先处理任务',at:200}]);
 assert.deepEqual(rows.map(r=>r.id),['user','sub-one','eyra']);assert.equal(rows[1].thought,true);
 timeline.ingest(frame([{...a,phase:'tool',tool:'memory · fast_organize'}]));assert.equal(timeline.active.thought,false);assert.equal(timeline.entries([])[0].text,'memory · fast_organize');
 timeline.ingest(frame([{...a,state:'done',finished:300,summary:'较早的记忆已整理。',thought:'stale',body:'stale',tool:'stale'}]));
 rows=timeline.entries([]);assert.equal(rows.length,1);assert.equal(rows[0].text,'较早的记忆已整理。');assert.equal(rows[0].subprocess,false);assert.equal(timeline.active,null);assert(!rows[0].thought);
 timeline.ingest(frame([]));assert.equal(timeline.entries([]).length,1,'bounded snapshots must not erase a completed visible message');
 timeline.ingest({...frame([a]),core_epoch:'new'});assert.equal(timeline.entries([]).length,1);timeline.ingest({...frame([]),session_id:'new'});assert.equal(timeline.entries([]).length,0);
 assert.equal(subconsciousFrame(frame([{...a,actor:'eyra'}])),null,'Eyra self-compaction must not invent another identity');
});
test('queued maintenance never duplicates a streaming subconscious and failure has no live ring',async()=>{
 const {SubconsciousTimeline}=await import('../ui/subconscious-timeline.mjs'),t=new SubconsciousTimeline();
 const a={id:1,actor:'subconscious',state:'running',started:10,phase:'body',body:'进度'};
 t.ingest({subconscious:{activities:[a,{...a,id:2,started:20,phase:'tool',waiting:true}]}});assert.equal(t.entries([]).length,1);assert.equal(t.active.text,'进度');
 t.ingest({subconscious:{activities:[{...a,state:'failed',finished:30,summary:'本次整理未完成，原文保留。'}]}});assert.equal(t.active,null);assert.match(t.entries([])[0].text,/原文保留/);
});
