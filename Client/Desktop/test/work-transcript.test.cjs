// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/work-transcript.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
test('conversation Brief handoff and final commit keep one identity without borrowing old-generation text',async()=>{
 const {ConversationPresentation}=await import('../ui/work-transcript.mjs'),view=new ConversationPresentation(),base={scope:'epoch:agent',agentId:'agent',generation:1,active:true,identity:{name:'Navi'}},user={id:'u1',from:'user',generation:1,text:'开始'};
 const first=view.project([user],{...base,live:{agent_id:'agent',generation:1,phase:'body',body_id:'r1',body_at:1,text:'第一段'}}),original=first.at(-1);
 const next=view.project([user],{...base,live:{agent_id:'agent',generation:1,phase:'thinking',body_id:'r2',new_body:true,text:'第一段',thought:'继续观察',reasoning_started_at:3},briefs:[{id:'b1',title:'真实 Brief',state:'completed',started_at:2000}]});
 assert.equal(next.find(m=>m.brief).id,original.id);assert.equal(next.find(m=>m.brief).text,'真实 Brief');assert.notEqual(next.at(-1).id,original.id);assert(!JSON.stringify(next.at(-1).work).includes('第一段'));
 const final=view.project([user,{id:'stored-reply',from:'eyra',generation:1,text:'最终正文',state:'completed'}],{...base,active:false,live:{generation:1}});
 assert.equal(final.at(-1).id,next.at(-1).id);assert.equal(final.at(-1).snapshotId,'stored-reply');assert.equal(final.at(-1).response,true);assert.equal(final.at(-1).work,undefined);
 const second=view.project([...final,{id:'u2',from:'user',generation:2,text:'下一轮'}],{...base,generation:2,live:{agent_id:'agent',generation:1,text:'残留正文',thought:'残留思考'}});
 assert.deepEqual(second.at(-1).work.journal.rows,[]);assert(!JSON.stringify(second.at(-1)).includes('残留'));
});
test('conversation projection retains the committed-work gap and rejects other agents and Core epochs',async()=>{
 const {ConversationPresentation}=await import('../ui/work-transcript.mjs'),view=new ConversationPresentation(),base={scope:'epoch:a',agentId:'a',generation:1,active:true},live={generation:1,agent_id:'a',phase:'body',text:'本轮内容',body_id:'r1'};
 const row=view.project([],{...base,live}).at(-1),gap=view.project([],{...base,active:false,live}).at(-1);assert.equal(gap.id,row.id);
 assert.deepEqual(view.project([],{...base,scope:'new-epoch:a',live:{...live,agent_id:'b'}}).at(-1).work.journal.rows,[]);
});
test('untitled receipts do not invent Brief or completion captions',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),view=new WorkTranscript();
 view.update({key:'home:1',phase:'body',text:'先检查这个命令。',live:{body_id:'r1',body_at:1}});
 const receipt={id:'terminal-call',tool:'terminal',action:'exec',state:'completed',started_at:1500,command:'Write-Output PRIVATE_COMMAND'};
 view.update({key:'home:1',phase:'thinking',thought:'继续核对结果。',live:{body_id:'r2',reasoning_started_at:2},briefs:[receipt]});
 assert.equal(view.rows.find(r=>r.kind==='brief'),undefined);
 assert.deepEqual(view.rows.map(r=>r.kind),['body','thinking']);
 view.update({key:'home:1',phase:'thinking',thought:'继续核对结果。',live:{body_id:'r2',reasoning_started_at:2},briefs:[receipt]});
 assert.equal(view.rows.filter(r=>r.kind==='brief').length,0);assert(!JSON.stringify(view.snapshot()).includes('PRIVATE_COMMAND'));
});
test('raw Core activity titles become Brief verbatim and never use a status explanation',async()=>{
 const {WorkTranscript,workTranscriptSegments}=await import('../ui/work-transcript.mjs'),view=new WorkTranscript();
 view.update({key:'core-title',briefs:[{id:'call1',title:'  核对入口与依赖。  ',tool:'browser',state:'running'}]});
 const first=workTranscriptSegments(view.snapshot());assert.equal(first.briefs[0].text,'核对入口与依赖。');assert.deepEqual(first.current.rows,[]);
 view.update({key:'core-title',briefs:[{id:'call1',title:'  核对入口与依赖。  ',tool:'browser',state:'completed'},{id:'call2',title:'内部标题',brief:'实际 Brief 原文',state:'completed'}]});
 const last=workTranscriptSegments(view.snapshot());assert.deepEqual(last.briefs.map(r=>r.text),['核对入口与依赖。','实际 Brief 原文']);assert.equal(last.briefs[0].key,first.briefs[0].key);
});
test('sliding Core thought tails append each observed delta once within its real reasoning segment',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),view=new WorkTranscript();let full='';
 for(let n=0;n<50;n++){
  full+=`第${n}段：`+'核对真实流式投影与连续阅读。'.repeat(10)+'\n\n';
  const bytes=Buffer.from(full);let start=Math.max(0,bytes.length-1024);while(start<bytes.length&&(bytes[start]&0xc0)===0x80)start++;
  view.update({key:'s:1',phase:'thinking',thought:bytes.subarray(start).toString(),live:{body_id:'request1',reasoning_started_at:100}});
 }
 assert.equal(view.rows.length,1);assert.equal(view.rows[0].text,full);
 const row=view.rows[0];view.update({key:'s:1',phase:'waiting',thought:row.raw,live:{body_id:'request2',new_body:true}});assert.equal(view.rows.length,1);
 view.update({key:'s:1',phase:'thinking',thought:'第0段：重新检查。',live:{body_id:'request2',reasoning_started_at:200}});assert.equal(view.rows.length,2);assert.equal(view.rows[0],row);
});
test('a body snapshot carries the final thought chunk through the real home state projection',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),{EyraState,roleLive}=await import('../ui/eyra-state.mjs'),view=new WorkTranscript(),state=new EyraState();
 const thought=n=>Array.from({length:n},(_,i)=>`交接思考${String(i+1).padStart(2,'0')}：核对原生页面切换前后的完整记录与阅读位置。\n\n`).join('');
 const text=Array.from({length:24},(_,i)=>`交接正文${String(i+1).padStart(2,'0')}：已经显示的内容需要完整保留，上翻之后继续从原处阅读。\n\n`).join('');
 const snapshot=live=>({core_epoch:'epoch',session_id:'session',roles:[{role:'matrix',id:'matrix',generation:1,state:'running',execution_started:true}],messages:[],live:{matrix:{agent_id:'matrix',generation:1,body_id:'request1',...live}}});
 const paint=s=>{const flow=state.project(s,{now:2000});return view.update({key:'home:1',phase:flow.state,thought:flow.thought,text:flow.preview?.full||'',live:roleLive(s)});};
 paint(snapshot({phase:'thinking',new_body:true,reasoning_started_at:1000,thought:thought(47)}));
 const before=view.snapshot(),firstID=before.rows[0].id;
 const body=snapshot({phase:'body',new_body:false,reasoning_started_at:0,reasoning_history:[{id:'request1:1000',started_at:1000,finished_at:1900}],thought:thought(48),text,body_at:2000000,body_updated_at:2000});
 assert.equal(state.project(body,{now:2000}).thought,'','the status projection intentionally stops exposing active thought after the phase changes');
 paint(body);
 assert.deepEqual(view.rows.map(r=>[r.kind,r.text]),[['thinking',thought(48)],['body',text]]);
 assert.equal(view.rows[0].id,firstID);assert.equal(before.rows[0].text,thought(47),'an earlier native frame remains immutable');
 const after=view.snapshot();paint(body);assert.equal(view.snapshot(),after,'unchanged polls do not replay or duplicate the recovered tail');
});
test('late thought is recovered at phase boundaries only for the current request',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs');
 for(const phase of ['body','typing','tool','waiting']){
  const view=new WorkTranscript();
  view.update({key:'s:1',phase:'thinking',thought:'当前思考。',live:{body_id:'request1',reasoning_started_at:100}});
  view.update({key:'s:1',phase,live:{body_id:'request1',new_body:true,reasoning_history:[{id:'request1:100',started_at:100,finished_at:110}],thought:'当前思考。最后一块。'}});
  assert.equal(view.rows[0].text,'当前思考。最后一块。',phase);
  const first=view.rows[0];
  for(const new_body of [true,false])view.update({key:'s:1',phase,live:{body_id:'request2',new_body,reasoning_history:[{id:'request1:100',started_at:100,finished_at:110}],thought:'当前思考。属于旧请求的迟到内容。'}});
  assert.equal(view.rows.length,1,phase+' ignores the previous request carried by a new body');assert.equal(first.text,'当前思考。最后一块。');
  view.update({key:'s:1',phase,live:{body_id:'request2',new_body:false,reasoning_history:[{id:'request2:200',started_at:200,finished_at:210}],thought:'新请求已结束的思考。'}});
  assert.deepEqual(view.rows.map(r=>r.text),['当前思考。最后一块。','新请求已结束的思考。'],phase+' also recovers a thinking phase missed between polls');
 }
});
test('new requests with identical body prefixes keep the earlier paragraph before its receipt',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),view=new WorkTranscript();
 view.update({key:'s:1',phase:'body',text:'正在检查。',live:{body_id:'request1',body_at:10}});
 view.update({key:'s:1',phase:'tool',briefs:[{id:'tool1',brief:'打开文件。'}]});
 view.update({key:'s:1',phase:'body',text:'正在检查。接着核对。',live:{body_id:'request2',body_at:20}});
 assert.deepEqual(view.rows.map(r=>[r.kind,r.text]),[['body','正在检查。'],['brief','打开文件。'],['body','正在检查。接着核对。']]);
 view.update({key:'s:1',phase:'body',text:'修正后的第二段。',live:{body_id:'request2',body_at:20}});assert.equal(view.rows.length,3);assert.equal(view.rows[2].text,'修正后的第二段。');
});
test('working transcript retains thought, body and distinct receipts through empty phase transitions',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),view=new WorkTranscript();
 view.update({key:'a:1',phase:'thinking',thought:'先检查项目。'});
 view.update({key:'a:1',phase:'body',thought:'先检查项目。',text:'我正在核对入口。'});
 view.update({key:'a:1',phase:'tool',briefs:[{id:'one',brief:'打开项目入口。',state:'running'}]});
 const rows=view.update({key:'a:1',phase:'thinking',thought:'入口已经找到，继续核对布局。',briefs:[{id:'one',brief:'打开项目入口。',state:'completed'}]});
 assert.deepEqual(rows.map(r=>[r.kind,r.text]),[['thinking','先检查项目。'],['body','我正在核对入口。'],['brief','打开项目入口。'],['thinking','入口已经找到，继续核对布局。']]);
 assert.equal(rows[2].state,'completed');
 const old=rows[0];for(let i=0;i<100;i++)view.update({key:'a:1',phase:'thinking',thought:'入口已经找到，继续核对布局。',briefs:[{id:'one',brief:'打开项目入口。',state:'completed'}]});
 assert.equal(view.rows.length,4);assert.equal(view.rows[0],old);
});
test('stream chunks update their paragraph while a new generation clears display state',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),view=new WorkTranscript();
 view.update({key:'a:1',phase:'body',text:'你好'});const paragraph=view.rows[0];
 for(let i=1;i<50;i++)view.update({key:'a:1',phase:'body',text:'你好'+'。'.repeat(i)});
 assert.equal(view.rows.length,1);assert.equal(view.rows[0],paragraph);assert.equal(paragraph.text.length,51);
 assert.deepEqual(view.update({key:'a:2',phase:'waiting'}),[]);
 view.update({key:'a:2',briefs:[{id:'one',brief:'新的操作'}]});assert.equal(view.rows.length,1);assert.equal(view.rows[0].text,'新的操作');
});
test('native presentation carries the complete journal with stable ids and immutable past frames',async()=>{
 const {WorkTranscript}=await import('../ui/work-transcript.mjs'),owner=new WorkTranscript(),key=JSON.stringify(['home','epoch1','matrix',1]);
 owner.update({key,phase:'thinking',thought:'早期内容。'.repeat(400),live:{body_id:'r1',reasoning_started_at:1}});
 const first=owner.snapshot();assert.equal(first.rows[0].text.length,2000);assert.equal(first.rows[0].raw,undefined);assert.equal(first.rows[0].source,undefined);
 assert.equal(owner.snapshot(),first);owner.update({key,phase:'thinking',thought:'早期内容。'.repeat(400),live:{body_id:'r1',reasoning_started_at:1}});assert.equal(owner.snapshot(),first,'unchanged polls share one immutable projection');
 owner.update({key,phase:'tool',briefs:[{id:'browser',brief:'我打开网页继续核对。',state:'running'}]});
 owner.update({key,phase:'body',text:'网页内容已经核对。',live:{body_id:'r2',body_at:2}});
 const delivered=JSON.parse(JSON.stringify(owner.snapshot()));assert.deepEqual(delivered.rows.map(r=>r.id),[first.rows[0].id,'brief:browser','text:2']);assert.equal(delivered.rows[0].text,first.rows[0].text);assert.equal(first.rows.length,1);assert(delivered.revision>first.revision);
 owner.update({key:JSON.stringify(['home','epoch2','matrix',1]),phase:'body',text:'另一次Core的回复。'});assert.equal(owner.snapshot().rows.length,1);assert.notEqual(owner.snapshot().key,first.key);assert.equal(delivered.rows.length,3);
});

test('Brief inherits the previous live identity and the next work starts below it without old content',async()=>{
 const {WorkTranscript,workTranscriptSegments}=await import('../ui/work-transcript.mjs'),owner=new WorkTranscript();
 owner.update({key:'turn-one',phase:'thinking',thought:'只属于第一段的推理。',live:{body_id:'r1',reasoning_started_at:1}});
 const first=workTranscriptSegments(owner.snapshot());assert.equal(first.briefs.length,0);assert.equal(first.current.rows[0].text,'只属于第一段的推理。');
 owner.update({key:'turn-one',phase:'tool',briefs:[{id:'tool-a',brief:'读取项目入口。',state:'running'}]});
 const second=workTranscriptSegments(owner.snapshot());assert.equal(second.briefs[0].key,first.current.key);assert.equal(second.briefs[0].text,'读取项目入口。');assert.deepEqual(second.current.rows,[]);assert.notEqual(second.current.key,first.current.key);
 owner.update({key:'turn-one',phase:'thinking',thought:'只属于第二段的推理。',live:{body_id:'r2',reasoning_started_at:2},briefs:[{id:'tool-a',brief:'读取项目入口。',state:'completed'}]});
 const next=workTranscriptSegments(owner.snapshot());assert.equal(next.current.key,second.current.key);assert.deepEqual(next.current.rows.map(r=>r.text),['只属于第二段的推理。']);assert.equal(next.briefs[0].text,'读取项目入口。');assert.equal(next.briefs[0].state,'completed');
 owner.update({key:'turn-one',phase:'tool',briefs:[{id:'tool-a',brief:'读取项目入口。',state:'completed'},{id:'tool-b',brief:'核对动画衔接。',state:'running'}]});
 const third=workTranscriptSegments(owner.snapshot());assert.equal(third.briefs[1].key,next.current.key);assert.deepEqual(third.current.rows,[]);assert.equal(third.briefs.length,2);assert.equal(first.current.rows[0].text,'只属于第一段的推理。');
 owner.update({key:'turn-two',phase:'waiting'});const fresh=workTranscriptSegments(owner.snapshot());assert.equal(fresh.briefs.length,0);assert.deepEqual(fresh.current.rows,[]);assert(![first.current.key,next.current.key,third.current.key].includes(fresh.current.key));
});

test('member communication cannot replace the live response or become a completed answer',async()=>{
 const {ConversationPresentation}=await import('../ui/work-transcript.mjs'),p=new ConversationPresentation(),identity={role:'conversation',name:'成员'},brief={id:'member-message',from:'eyra',generation:1,talk:true,brief:true,text:'协作简报',identity};
 const base={scope:'one',agentId:'actor',generation:1,active:true,identity,live:{agent_id:'actor',generation:1,phase:'body',text:'正在继续核对',body_id:'body'}};
 const first=p.project([brief],base),live=first.find(m=>m.work);assert(live);assert.equal(first[0],brief);assert.notEqual(live.id,brief.id);
 const waiting=p.project([brief],{...base,active:false,live:{generation:1,phase:'waiting'}});assert(waiting.some(m=>m.work),'a member Brief is not the actor final answer');
 const final={id:'reply',from:'eyra',generation:1,text:'实际完成正文'};
 const complete=p.project([brief,final],{...base,active:false});assert.equal(complete[0],brief);assert.equal(complete[1].id,live.id);assert.equal(complete[1].snapshotId,'reply');
});

test('a new empty Core request cannot reassign the retained body after a Brief',async()=>{
 const {WorkTranscript,workTranscriptSegments}=await import('../ui/work-transcript.mjs'),{EyraState}=await import('../ui/eyra-state.mjs'),owner=new WorkTranscript(),state=new EyraState();
 const snapshot=live=>({core_epoch:'epoch',session_id:'session',roles:[{role:'matrix',id:'matrix',generation:1,state:'running',execution_started:true}],messages:[],live:{matrix:{agent_id:'matrix',generation:1,...live}}});
 const brief={id:'request1:tool-a',brief:'核对实际命令。',state:'completed',started_at:1500000};
 const paint=(live,briefs=[])=>{const flow=state.project(snapshot(live),{now:3000});owner.update({key:'turn-one',phase:flow.state,thought:flow.thought,text:flow.preview?.full||'',live:flow.live,briefs});return workTranscriptSegments(owner.snapshot());};
 paint({phase:'body',body_id:'request1',new_body:false,body_at:1000000,text:'上一段完整正文。'});
 const archived=paint({phase:'settled',body_id:'request1',new_body:false,body_at:1000000,text:'上一段完整正文。'},[brief]);
 assert.equal(archived.briefs[0].text,brief.brief);assert.deepEqual(archived.current.rows,[]);
 const waiting={phase:'waiting',body_id:'request2',new_body:true,body_at:0,text:'上一段完整正文。'};
 assert.equal(state.project(snapshot(waiting),{now:3000}).preview.full,'上一段完整正文。','legacy preview deliberately retains its own prior body');
 for(let i=0;i<3;i++){const next=paint(waiting,[brief]);assert.equal(next.current.key,archived.current.key);assert.deepEqual(next.current.rows,[]);}
 const next=paint({phase:'body',body_id:'request2',new_body:false,body_at:2000000,text:'新的正文可以从相同开头继续。'},[brief]);
 assert.deepEqual(next.current.rows.map(r=>r.text),['新的正文可以从相同开头继续。']);assert.equal(next.briefs.length,1);
 assert.equal(owner.rows.filter(r=>r.text==='上一段完整正文。').length,1,'prior text remains exactly once in its original journal segment');
});

test('completed and older turns retire Brief while retaining the final working identity',async()=>{
 const {ConversationPresentation}=await import('../ui/work-transcript.mjs'),p=new ConversationPresentation(),base={scope:'scope',agentId:'agent',generation:1,active:true};
 p.project([],{...base,live:{generation:1,phase:'body',text:'当前正文',body_id:'body1',body_at:1}});
 const active=p.project([],{...base,briefs:[{id:'brief1',brief:'读取真实页面',state:'completed'}],live:{generation:1,phase:'waiting',body_id:'body2',new_body:true}});
 assert.equal(active.filter(m=>m.brief).length,1);const key=active.find(m=>m.work).id;
 const final={id:'durable-final',from:'eyra',generation:1,text:'完整回复'};
 const completed=p.project([final],{...base,active:false,live:{generation:1,phase:'settled'}});
 assert.equal(completed.length,1);assert.equal(completed[0].id,key);assert.equal(completed[0].snapshotId,final.id);assert.equal(completed[0].text,final.text);
 const next=p.project([final],{...base,generation:2,live:{generation:2,phase:'waiting'}});
 assert.equal(next.filter(m=>m.brief).length,0);assert.equal(next[0].id,key);assert.notEqual(next.at(-1).id,key);
});
