// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; scope; item; snapshot; journal; page
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/operation-terminal.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../ui/operation-terminal.mjs');
const scope={task_id:'coding',agent_id:'coding',generation:1};
const item=(member,call_id,extra={})=>({id:member+':'+call_id,call_id,member,name:member==='cota'?'Cota':'Vaya',generation:2,tool:'exec_command',command:'echo proof',state:'running',revision:1,...extra});
const snapshot=operations=>({core_epoch:'one',operations});
const journal=m=>m.segments().map(s=>s.text).join('');
test('project display reset rejects a late receipt even when the Core conversation stays the same',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();
 m.bind(snapshot([]),scope);m.ingest(snapshot([item('cota','old')]));
 let resolve;const pending=m.refreshReceipts(()=>new Promise(r=>resolve=r));await Promise.resolve();
 assert.equal(m.bind(snapshot([]),null),true);
 assert.equal(journal(m),'');assert.deepEqual(m.rows(),[]);
 m.bind(snapshot([]),scope);m.ingest(snapshot([item('cota','new')]));
 resolve(page({output:'OLD_PROJECT_OUTPUT',state:'exited'}));await pending;
 assert.doesNotMatch(journal(m),/OLD_PROJECT_OUTPUT/);
 await m.refreshReceipts(async p=>{assert.equal(p.call_id,'new');return page({output:'NEW_PROJECT_OUTPUT',state:'exited'});});
 assert.match(journal(m),/NEW_PROJECT_OUTPUT/);assert.equal(m.rows().length,1);
});
const page=(output,extra={})=>({ok:true,input:'{}',output:JSON.stringify(output),input_size:2,output_size:Buffer.byteLength(JSON.stringify(output)),next_input:0,next_output:0,receipt_version:'v1',...extra});

test('one terminal appends interleaved members, commands and search results without replaying the snapshot',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);
 const a=item('cota','a',{preview:{output:'A\n',state:'running'}}),b=item('vaya','b',{tool:'web_search',command:'',targets:['共同查询'],preview:{searches:[{query:'共同查询',results:[{title:'来源',url:'https://example.test/source',snippet:'原文摘要'}]}]}});
 m.ingest(snapshot([a,b]));await m.refreshReceipts(async p=>page(p.role==='cota'?a.preview:b.preview));const prior=journal(m);m.ingest(snapshot([a,b]));assert.equal(journal(m),prior);
 m.ingest(snapshot([{...a,revision:2,preview:{output:'A\nA\n',state:'exited'}},b]));await m.refreshReceipts(async p=>page(p.role==='cota'?{output:'A\nA\n',state:'exited'}:b.preview));
 assert.ok(journal(m).startsWith(prior));assert.equal(m.segments().filter(s=>s.kind==='command').length,2);
 assert.match(journal(m),/Cota/);assert.match(journal(m),/Vaya/);assert.match(journal(m),/来源\nhttps:\/\/example.test\/source\n原文摘要/);
 assert.equal(m.current().item.member,'vaya');assert.equal(m.rows()[0].output,'A\nA\n');
});

test('full receipts replace bounded previews once; later snapshots cannot append the old preview again',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);
 const a=item('cota','a');m.ingest(snapshot([a]));let calls=0;
 await m.refreshReceipts(async request=>{calls++;assert.equal(request.role,'cota');assert.equal(request.generation,2);return page({output:'完整🙂\n完整🙂\n',state:'exited'});});
 const text=journal(m);m.ingest(snapshot([{...a,revision:2,state:'completed',preview:{output:'旧预览'}}]));assert.equal(journal(m),text);
 await m.refreshReceipts(async()=>{calls++;return page({output:'完整🙂\n完整🙂\n',state:'exited'});});assert.equal(journal(m),text);assert.equal(calls,2);
});

test('scope change discards an in-flight old receipt and identical call IDs from different generations remain distinct',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);m.ingest(snapshot([item('cota','same')]));
 let resolve;const pending=m.refreshReceipts(()=>new Promise(r=>resolve=r));await Promise.resolve();
 m.bind(snapshot([]),{...scope,task_id:'new'});m.ingest(snapshot([item('vaya','same'),item('vaya','same',{generation:3})]));
 resolve(page({output:'STALE',state:'exited'}));await pending;
 assert.doesNotMatch(journal(m),/STALE/);assert.equal(m.rows().length,2);assert.equal(m.segments().filter(s=>s.kind==='command').length,2);
});

test('receipt byte paging is versioned, retained across refreshes and retried after mutation',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);m.ingest(snapshot([item('cota','a')]));
 const output=JSON.stringify({output:'中文🙂',state:'exited'}),cut=10,total=Buffer.byteLength(output),first=output.slice(0,cut),last=output.slice(cut);let calls=0;
 await m.refreshReceipts(async()=>({ok:true,input:'{}',output:first,input_size:2,output_size:total,next_input:0,next_output:Buffer.byteLength(first),receipt_version:'one'}));
 await m.refreshReceipts(async p=>{assert.equal(p.receipt_version,'one');assert.equal(p.input_offset,2);assert.equal(p.output_offset,Buffer.byteLength(first));calls++;return {changed:true};});
 await m.refreshReceipts(async p=>{assert.equal(p.output_offset,0);assert.equal(p.receipt_version,undefined);return page({output:'新版中文🙂',state:'exited'});});
 assert.equal(calls,1);assert.match(journal(m),/新版中文🙂/);assert.doesNotMatch(journal(m),/记录读取失败/);
});

test('tool output cannot inject terminal controls; failed or cancelled operations retain their real state',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);
 m.ingest(snapshot([item('cota','bad',{state:'failed',preview:{output:'\x1b[2J<literal>\x1b]52;c;secret\x07\n',state:'failed'}}),item('vaya','stop',{state:'cancelled',tool:'web_search',preview:{error:{message:'搜索取消'}}})]));
 await m.refreshReceipts(async p=>page(p.role==='cota'?{output:'\x1b[2J<literal>\x1b]52;c;secret\x07\n',state:'failed'}:{error:{message:'搜索取消'}}));
 const output=m.segments().filter(s=>s.kind==='output').map(s=>s.text).join('');
 assert.match(output,/<literal>/);assert.doesNotMatch(output,/\x1b|secret/);assert.match(output,/执行失败/);assert.match(output,/搜索取消/);assert.equal(m.rows()[1].active,false);
});

test('live process pages use independent byte cursors and repeated wait calls do not replay output',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);const a=item('cota','exec');m.ingest(snapshot([a]));
 const readTerminal=async p=>({ok:true,call_id:p.call_id,receipt_generation:2,result:{ok:true,session_id:42,generation:2,state:'running',output:p.offset===0?'one\n':'two\n',next_offset:p.offset+4,logged_bytes:p.offset+4}});
 await m.refreshReceipts(()=>assert.fail('must read real process log'),{readTerminal});
 m.rows()[0].readAt=0;await m.refreshReceipts(()=>assert.fail(),{readTerminal});
 assert.equal(m.rows()[0].logOffset,8);assert.equal(m.rows()[0].output,'one\ntwo\n');
 m.ingest(snapshot([a,item('cota','wait',{tool:'write_stdin'})]));
 const before=journal(m);await m.refreshReceipts(()=>assert.fail(),{readTerminal});
 assert.equal(journal(m),before);assert.equal(m.rows()[1].logOffset,8);
});

test('failed process still displays stdout and its final status, while mismatched receipts cannot append',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);m.ingest(snapshot([item('cota','exec')]));
 await m.refreshReceipts(()=>assert.fail(),{readTerminal:async p=>({ok:true,call_id:p.call_id,receipt_generation:2,result:{ok:false,exit_code:1,session_id:5,generation:2,state:'exited',output:'real failure\n',next_offset:13,logged_bytes:13}})});
 assert.match(journal(m),/real failure/);assert.match(journal(m),/执行失败/);assert.equal(m.rows()[0].active,false);
 m.rows()[0].needsRead=true;await m.refreshReceipts(()=>assert.fail(),{readTerminal:async()=>({ok:true,call_id:'foreign',receipt_generation:2,result:{ok:true,session_id:5,generation:2,state:'exited',output:'FOREIGN',next_offset:20,logged_bytes:20}})});
 assert.doesNotMatch(journal(m),/FOREIGN/);
});

test('accepted command waits for its process and a rejected command shows the original failure without a phantom read error',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);m.ingest(snapshot([item('cota','exec')]));
 const readPage=async()=>page({ok:false,state:'rejected',error:{message:'command rejected before process creation'}},{state:'failed'});
 await m.refreshReceipts(readPage,{readTerminal:async()=>({ok:false,pending:true})});
 assert.doesNotMatch(journal(m),/记录读取失败/);assert.equal(m.rows()[0].active,true);
 await m.refreshReceipts(readPage,{readTerminal:async()=>({ok:true,no_process:true})});
 await m.refreshReceipts(readPage,{readTerminal:async()=>assert.fail('rejected call has no process')});
 assert.match(journal(m),/command rejected before process creation/);assert.match(journal(m),/执行失败/);
 assert.doesNotMatch(journal(m),/记录读取失败/);assert.equal(m.rows()[0].active,false);
});


test('late process pages replace receipt fallback once while preserving genuine identical Unicode lines and byte cursors',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);
 const a=item('cota','late',{state:'completed'}),line='重复🙂',plain=line+'\n',raw=line+'\r\n',firstBytes=Buffer.byteLength(raw),total=firstBytes*3;
 m.ingest(snapshot([a]));const receipt=async()=>page({ok:true,state:'completed',output:plain.repeat(2)});
 await m.refreshReceipts(receipt,{readTerminal:async()=>({ok:true,no_process:true})});await m.refreshReceipts(receipt);
 const before=journal(m);assert.equal(before.split(line).length-1,2);
 m.ingest(snapshot([{...a,revision:2,preview:{session_id:42}}]));
 const offsets=[],readTerminal=async p=>{offsets.push(p.offset);return {ok:true,call_id:p.call_id,receipt_generation:2,result:{ok:true,session_id:42,generation:2,state:'exited',output:p.offset===0?raw:raw.repeat(2),next_offset:p.offset===0?firstBytes:total,logged_bytes:total}};};
 await m.refreshReceipts(()=>assert.fail('process source is available'),{readTerminal});assert.equal(journal(m),before,'a partial replay keeps the already readable fallback');
 await m.refreshReceipts(()=>assert.fail(),{readTerminal});
 assert.equal(journal(m).split(line).length-1,3,'only the actual third repeated line is appended');assert.equal(m.rows()[0].output,plain.repeat(3));assert.equal(m.rows()[0].logOffset,total);assert.deepEqual(offsets,[0,firstBytes]);
});

test('late authoritative process log replaces a bounded fallback in its original journal position without reordering other tools',async()=>{
 const {OperationTranscript}=await load(),m=new OperationTranscript();m.bind(snapshot([]),scope);
 const a=item('cota','late',{state:'completed'}),b=item('vaya','other',{tool:'web_search',state:'completed',preview:{answer:'OTHER_RESULT'}});
 m.ingest(snapshot([a]));const receipt=async()=>page({ok:true,state:'completed',output:'SOURCE_TAIL\n'});
 await m.refreshReceipts(receipt,{readTerminal:async()=>({ok:true,no_process:true})});await m.refreshReceipts(receipt);
 m.ingest(snapshot([a,b]));await m.refreshReceipts(async p=>page(p.call_id==='late'?{ok:true,state:'completed',output:'SOURCE_TAIL\n'}:{answer:'OTHER_RESULT'}));
 const output='SOURCE_HEAD\nSOURCE_TAIL\n';m.ingest(snapshot([{...a,revision:2,preview:{session_id:42}},b]));
 await m.refreshReceipts(()=>assert.fail(),{readTerminal:async p=>({ok:true,call_id:p.call_id,receipt_generation:2,result:{ok:true,session_id:42,generation:2,state:'exited',output,next_offset:Buffer.byteLength(output),logged_bytes:Buffer.byteLength(output)}})});
 const text=journal(m);assert.equal(text.split('SOURCE_TAIL').length-1,1);assert(text.indexOf('SOURCE_HEAD')<text.indexOf('OTHER_RESULT'));assert.equal(text.split('OTHER_RESULT').length-1,1);
});
