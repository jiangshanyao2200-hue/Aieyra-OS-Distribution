// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/work-history.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('work history orders actual reasoning, prose and tool receipts without duplicated current prose',async()=>{
 const {workHistory,workingBody}=await import('../ui/experience.mjs');
 const base=Date.UTC(2026,9,2),message={id:'body',generation:2,from:'matrix',state:'commentary',text:'检查过的完整过程正文',at:new Date(base+3000).toISOString()};
 const live={body_id:'next',phase:'body',text:'当前正文',reasoning_history:[{id:'reason',started_at:base,finished_at:base+2000}]};
 const tools=[{id:'tool',key:'matrix:tool',state:'completed',started_at:(base+4000)*1000}];
 assert.deepEqual(workHistory([message,{...message,id:'old',generation:1}],live,2,tools).map(x=>x.kind),['thinking','body','tool']);
 assert.equal(workingBody([message],live,2),'当前正文');
 assert.equal(workHistory([message],{...live,body_id:'body',text:message.text},2).filter(x=>x.kind==='body').length,0);
 assert.equal(workHistory([message],{...live,body_id:'body',phase:'settled',text:message.text},2,[{...tools[0],state:'running'}]).filter(x=>x.kind==='body').length,1);
 assert.equal(workHistory([message],{body_id:'next',phase:'thinking',text:message.text,new_body:true},2)[0].text,message.text);
});
test('reasoning duration uses only valid core boundaries and handles subsecond spans',async()=>{
 const {reasoningDuration,workHistory}=await import('../ui/experience.mjs');
 assert.equal(reasoningDuration({started_at:1000,finished_at:1120}),'思考了不到 1 秒');
 assert.equal(reasoningDuration({started_at:1000,finished_at:126000}),'思考了 2 分 5 秒');
 assert.equal(reasoningDuration({started_at:0,finished_at:1000}),'');
 assert.equal(reasoningDuration({started_at:2000,finished_at:1000}),'');
 assert.deepEqual(workHistory([],{phase:'thinking',thought:'公开摘要',thought_at:1234},1),[]);
});

test('consecutive execution groups preserve receipts and stop at prose, thinking and scope changes',async()=>{
 const {workGroups,workHistory,currentToolGroup}=await import('../ui/experience.mjs');
 const base=Date.UTC(2026,9,2),tool=(id,ms,command,state='completed')=>({id,key:'matrix:'+id,tool:'exec_command',agent:'matrix',generation:2,state,command,started_at:(base+ms)*1000});
 const items=[tool('read',1000,'cat a.go'),tool('search',2000,'rg needle a.go'),tool('build',4000,'go build'),tool('test',5000,'go test','running')];
 const message={id:'prose',generation:2,from:'matrix',state:'commentary',text:'准备验证',at:new Date(base+3000).toISOString()},live={phase:'tool'};
 const original=JSON.stringify(items),groups=workGroups([message],live,2,items);
 assert.deepEqual(groups.map(x=>x.items?.map(x=>x.id)||x.kind),[['read','search'],'body',['build','test']]);
 assert.deepEqual(workHistory([message],live,2,items).map(x=>x.kind),['tool','body']);
 assert.deepEqual(currentToolGroup([message],live,2,items).map(x=>x.id),['build','test']);
 assert.equal(JSON.stringify(items),original);
 const finished=items.map(x=>({...x,state:'completed'}));
 assert.deepEqual(workHistory([message],live,2,finished).at(-1).items.map(x=>x.id),['build','test']);
 assert.deepEqual(currentToolGroup([message],live,2,finished),[]);
 assert.equal(workGroups([],{},2,[items[0],{...items[1],agent:'child'}]).length,2);
 assert.equal(workGroups([],{},2,[items[0],{...items[1],generation:3}]).length,2);
 assert.equal(workGroups([],{},2,items.slice(0,2).map(x=>({...x,started_at:0}))).length,2);
 const reasoning={reasoning_history:[{id:'think',started_at:base+1500,finished_at:base+1800}]};
 assert.deepEqual(workGroups([],reasoning,2,items.slice(0,2)).map(x=>x.items?.length||x.kind),[1,'thinking',1]);
 // A currently displayed body still separates older tools, even though it is
 // deliberately omitted from the history itself.
 assert.equal(workHistory([message],{phase:'body',body_id:message.id,text:message.text},2,[tool('before',1000,'cat a'),tool('after',4000,'cat b')]).length,2);
});

test('projected receipts preserve the actual agent identity for grouping',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs'),{workGroups}=await import('../ui/experience.mjs');
 const p=new WorkspacePresentation(),role=id=>({id,role:'matrix',generation:1,state:'running',activity:{items:[{id:'call',generation:1,tool:'exec_command',command:'go test',state:'completed',started_at:1000000}]}});
 p.ingest({session_id:'one',roles:[role('first-agent')]});
 const first=p.terminal()[0];
 p.ingest({session_id:'one',roles:[role('second-agent')]});
 const second=p.terminal()[0];
 assert.equal(first.agent,'first-agent');assert.equal(second.agent,'second-agent');
 assert.equal(workGroups([],{},1,[first,second]).length,2);
});
