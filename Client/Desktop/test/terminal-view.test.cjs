// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; scope; snapshot; activity; target; response; model
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/terminal-view.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../ui/desktop/terminal-view.mjs');
const scope={task_id:'task',agent_id:'matrix',generation:3};
const snapshot=(items=[],extra={})=>({core_epoch:'core-one',session_id:'task',roles:[{id:'matrix',role:'matrix',generation:3,activity:{items}}],...extra});
const activity=(session=1,receipt={},extra={})=>({agent:'matrix',generation:3,tool:'exec_command',revision:8,command:'echo 检查',preview:JSON.stringify({ok:true,session_id:session,generation:3,state:'running',...receipt}),...extra});
const target=(id=1,offset=0,extra={})=>({...scope,session_id:id,session_generation:3,offset,terminal:false,...extra});
const response=(request,text,extra={})=>({ok:true,task_id:request.task_id,agent_id:request.agent_id,generation:request.generation,result:{ok:true,session_id:request.session_id,generation:request.session_generation,state:'running',output:text,terminal_output:request.terminal?text:undefined,next_offset:request.offset+Buffer.byteLength(text),logged_bytes:request.offset+Buffer.byteLength(text),...extra}});
async function model(items=[]){const {TerminalTranscript}=await load(),m=new TerminalTranscript();m.bind(snapshot(),scope);m.ingest(snapshot(items));return m;}

test('terminal decodes real JSON receipts once and separates foreground, PTY and background sessions',async()=>{
 const a=activity(1,{output:'一次输出',next_offset:12}),m=await model([a,activity(2,{tty:true}),activity(3,{background:true})]);
 m.ingest(snapshot([a]),{terminal:()=>[a]});
 assert.equal(m.rows().length,1);assert.equal(m.rows('pty',2).length,1);assert.equal(m.rows('pty',3).length,1);
 assert.equal(m.segments().filter(s=>s.text.includes('一次输出')).length,1);
 const nested=activity(4,{}, {preview:JSON.stringify({data:{output:[{type:'text',text:JSON.stringify({session_id:4,generation:3,state:'exited',exit_code:0,output:'嵌套输出',next_offset:12})}]}})});
 m.ingest(snapshot([nested]));assert.match(m.segments().map(s=>s.text).join(''),/嵌套输出/);
});

test('terminal byte cursors preserve Unicode and repeated identical lines without preview duplication',async()=>{
 const m=await model([activity(1,{output:'重复🙂\n',next_offset:22})]),first=target(),line='重复🙂\n';
 assert.equal(m.applyPage(first,response(first,line)),true);
 const second=target(1,Buffer.byteLength(line));assert.equal(m.applyPage(second,response(second,line)),true);
 assert.equal(m.rows()[0].output,line+line);assert.equal(m.rows()[0].offset,Buffer.byteLength(line+line));
 assert.equal(m.applyPage(first,response(first,'迟到重复')),false);
 assert.equal(m.segments().map(s=>s.text).join('').split('重复🙂').length-1,2);
});

test('terminal rejects foreign task, agent, generation, session and invalid cursors without changing output',async()=>{
 const m=await model([activity()]),t=target(),r=response(t,'有效');
 for(const field of ['task_id','agent_id','generation'])assert.equal(m.applyPage({...t,[field]:'foreign'},r),false);
 for(const change of [{task_id:'foreign'},{agent_id:'foreign'},{generation:4},{result:{...r.result,session_id:9}},{result:{...r.result,generation:2}},{result:{...r.result,next_offset:-1}},{result:{...r.result,next_offset:0}},{result:{...r.result,logged_bytes:0}},{ok:false,error:'拒绝读取'},{result:{ok:false,error:{message:'会话已失效'}}}]){
  assert.throws(()=>m.applyPage(t,{...r,...change}));assert.equal(m.rows()[0].output,'');assert.equal(m.rows()[0].offset,0);
 }
 assert.equal(m.applyPage(t,r),true);
});

test('terminal retains foreground journal across turns and clears on core, task, agent or empty scope',async()=>{
 const m=await model([activity()]);assert.equal(m.bind(snapshot(),{...scope,generation:4}),false);assert.equal(m.rows().length,1);
 m.setSessions([{session_id:8,generation:3,background:true,state:'running'}]);assert.equal(m.sessions.length,1);
 assert.equal(m.bind(snapshot(),{...scope,generation:5}),false);assert.equal(m.sessions.length,0);
 for(const [s,t] of [[snapshot([],{core_epoch:'core-two'}),{...scope,generation:5}],[snapshot(),{...scope,task_id:'different'}],[snapshot(),{...scope,agent_id:'different'}],[snapshot(),null]]){
  assert.equal(m.bind(s,t),true);assert.equal(m.rows().length,0);assert.equal(m.sessions.length,0);
 }
});

test('terminal old activity revisions cannot overwrite commands, output or confirmed final state',async()=>{
 const m=await model([activity(1,{state:'exited',exit_code:0,output:'最终输出',next_offset:20},{command:'final',revision:20})]);
 m.ingest(snapshot([activity(1,{output:'过时输出',next_offset:1},{command:'old',revision:10})]));
 assert.equal(m.rows()[0].cmd,'final');assert.equal(m.rows()[0].state,'exited');assert.equal(m.rows()[0].preview,'最终输出');
 m.setSessions([{session_id:1,generation:3,state:'running',logged_bytes:1}]);assert.equal(m.rows()[0].state,'exited');assert.equal(m.rows()[0].exit_code,0);
 const t=target();m.applyPage(t,response(t,'ok',{state:'exited',exit_code:0,logged_bytes:30}));
 m.ingest(snapshot([activity(1,{state:'running',logged_bytes:2},{revision:30})]));assert.equal(m.rows()[0].state,'exited');assert.equal(m.rows()[0].logged_bytes,30);
});

test('terminal honors original creation generation for retained background sessions',async()=>{
 const m=await model();m.setSessions([{session_id:1,generation:2,background:true,tty:true,state:'running'},{session_id:2,generation:2,state:'running'},{session_id:3,generation:4,background:true,state:'running'},{session_id:4,generation:3,state:'running'}]);
 assert.deepEqual(m.sessions.map(r=>r.session_id),[1,4]);assert.deepEqual(m.rows().map(r=>r.session_id),[4]);
 const t=target(1,0,{session_generation:2,terminal:true});m.applyPage(t,response(t,'后台\r\n'));
 assert.equal(m.rows('pty',1,2)[0].output,'后台\r\n');assert.equal(m.rows('pty',1,3).length,0);
});

test('terminal keeps exit receipts for the model but never prints exit codes or durations for people',async()=>{
 const m=await model([activity(1,{state:'cancelled',exit_code:null})]);assert.doesNotMatch(m.segments().map(s=>s.text).join(''),/已停止/);
 const t=target();m.applyPage(t,response(t,'',{state:'cancelled',exit_code:1}));assert.equal(m.rows()[0].exit_code,1);assert.doesNotMatch(m.segments().map(s=>s.text).join(''),/退出码|已停止|毫秒/);
});

test('terminal removes OSC title, links and clipboard payloads while preserving PTY ANSI across pages',async()=>{
 const m=await model([activity(1,{tty:true})]),a=target(1,0,{terminal:true}),one='\x1b[31m红色\x1b[0m\r\n\x1b]52;c;';
 m.applyPage(a,response(a,one));assert.doesNotMatch(m.segments('pty',1).map(s=>s.text).join(''),/52;c/);
 const b=target(1,Buffer.byteLength(one),{terminal:true});m.applyPage(b,response(b,'masked-payload\x07正常\r\n\x1b]8;;https://invalid.example\x07文字\x1b]8;;\x07'));
 const text=m.segments('pty',1).map(s=>s.text).join('');assert.match(text,/\x1b\[31m红色/);assert.match(text,/正常/);assert.match(text,/文字/);assert.doesNotMatch(text,/masked-payload|invalid.example|\x1b\]/);
 const plain=await model([activity(2,{output:'\x9d52;c;private\x07普通\x1b[31m文字\x1b[0m'})]);
 // 命令输出里的转义一律去掉；只有界面自己加的提示符/状态颜色（SGR 38;2 与 0）可以出现。
 assert.doesNotMatch(plain.segments().map(s=>s.text).join('').replace(/\x1b\[(?:0|38;2;\d+;\d+;\d+)m/g,''),/private|52;c|\x1b|\x9d/);
 assert.doesNotMatch(plain.segments().filter(s=>s.kind==='output').map(s=>s.text).join(''),/\x1b|\x9d/);
});

test('terminal treats HTML as text and labels private or incomplete logs',async()=>{
 const m=await model([activity(1,{output:'<img src=x onerror=alert(1)>',next_offset:Buffer.byteLength('<img src=x onerror=alert(1)>'),private_output:true,log_incomplete:true})]);
 const text=m.segments().map(s=>s.text).join('');assert.match(text,/<img src=x onerror=alert\(1\)>/);assert.match(text,/日志保存不完整/);assert.match(text,/后续输出保密/);
});

test('terminal command order handles ISO shell times and microsecond activity times together',async()=>{
 const base=Date.UTC(2026,9,9),m=await model([activity(2,{}, {started_at:(base+2000)*1000,command:'later'}),activity(1,{started_at:new Date(base+1000).toISOString()},{command:'earlier'})]);
 assert.deepEqual(m.segments().filter(s=>s.kind==='command').map(s=>s.text.includes('earlier')),[true,false]);
 const reversed=await model([activity(1,{started_at:new Date(base+3000).toISOString()},{command:'later'}),activity(2,{}, {started_at:(base+1000)*1000,command:'earlier'})]);
 assert.deepEqual(reversed.segments().filter(s=>s.kind==='command').map(s=>s.text.includes('earlier')),[true,false]);
});

test('terminal bounds Unicode output and retained session journal',async()=>{
 const m=await model([activity()]),t=target(),text='🙂'.repeat(450000);m.applyPage(t,response(t,text));
 assert.ok(m.rows()[0].output.length<=256*1024);assert.ok(!/^[\uDC00-\uDFFF]/.test(m.rows()[0].output));assert.equal(m.rows()[0].offset,Buffer.byteLength(text));
 assert.match(m.segments().map(s=>s.text).join(''),/仅保留最近输出/);
 m.ingest(snapshot(Array.from({length:140},(_,i)=>activity(i+2))));assert.equal(m.rows().length,120);assert.equal(m.rows()[0].session_id,22);
});

test('unmounted terminal never polls or mutates processes and close releases its observers and listeners',async()=>{
 const {createTerminalView}=await load(),timers=new Set(),listeners=new Map(),observers=[],events=[],calls=[];
 class Node{constructor(tag){this.tagName=tag;this.dataset={};this.isConnected=false;this.children=[];}append(...n){this.children.push(...n);}setAttribute(){}getBoundingClientRect(){return {width:0,height:0};}closest(){return null;}addEventListener(type,fn){listeners.set(type,fn);}removeEventListener(type){listeners.delete(type);}replaceChildren(){this.children=[];}dispatchEvent(e){events.push(e);} }
 class Observer{constructor(){observers.push(this);}observe(){}disconnect(){this.disconnected=true;} }
 const win={ResizeObserver:Observer,MutationObserver:Observer,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},setInterval(fn){timers.add(fn);return fn;},clearInterval(fn){timers.delete(fn);},setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);}};
 const doc={defaultView:win,createElement:tag=>new Node(tag),head:new Node('head'),body:{classList:{contains:()=>false}},querySelector:()=>null,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
 const api=new Proxy({}, {get:(_,name)=>()=>{calls.push(name);throw Error('No process call allowed');}}),view=createTerminalView({api,doc,getScope:()=>scope});
 view.update(snapshot([activity()]));for(const fn of timers)fn();assert.deepEqual(calls,[]);// 5 个：工具条、屏幕、运行条（用户 2026-10-13 第 7 项）、空态、错误态。
 assert.equal(view.element.children.length,5);
 view.close();view.close();view.update(snapshot([activity()]));await Promise.resolve();
 assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.ok(observers.every(o=>o.disconnected));assert.equal(view.sessions.length,0);assert.ok(events.some(e=>e.type==='terminal-sessions'));
});

test('parallel foreground commands append once in CORE order and never rewrite earlier output',async()=>{
 const call=(id,sequence,command)=>activity(id,{},{sequence,command,started_at:1000});
 const m=await model([call(3,7,'third'),call(1,5,'first'),call(2,6,'second')]);
 const commands=()=>m.segments().filter(s=>s.kind==='command').map(s=>s.text.includes('first')?1:s.text.includes('second')?2:3);
 assert.deepEqual(commands(),[1,2,3]);
 const page=(id,offset,text)=>{const t=target(id,offset);assert.equal(m.applyPage(t,response(t,text)),true);};
 page(2,0,'B1');const before=m.segments().map(s=>s.text).join('');
 page(1,0,'A1');page(2,2,'B2');
 const after=m.segments().map(s=>s.text).join('');
 assert.ok(after.startsWith(before),'earlier output is never rewritten');
 assert.ok(after.indexOf('A1')<after.indexOf('B2'));
 assert.equal(m.segments().filter(s=>s.kind==='command').length,3,'each command is typed once');
 assert.equal(m.segments().filter(s=>s.kind==='status'&&s.text.includes('first')).length,1,'switching source adds one marker');
});

test('a parallel command whose session is not known yet holds later commands until it arrives (Codex X1 retest)',async()=>{
 const {TerminalTranscript}=await load(),m=new TerminalTranscript();m.bind(snapshot(),scope);
 const queued={agent:'matrix',generation:3,tool:'exec_command',revision:1,sequence:9,id:'a',state:'queued',command:'first'};
 const later=['second','third'].map((command,i)=>activity(i+2,{},{sequence:10+i,id:'b'+i,command}));
 m.ingest(snapshot([queued,...later]));
 assert.equal(m.segments().filter(s=>s.kind==='command').length,0,'later commands wait for the earlier one');
 m.ingest(snapshot([{...queued,state:'running',revision:2,preview:JSON.stringify({ok:true,session_id:1,generation:3,state:'running'})},...later]));
 assert.deepEqual(m.segments().filter(s=>s.kind==='command').map(s=>['first','second','third'].findIndex(c=>s.text.includes(c))),[0,1,2]);
});

test('sessions listed before their activity claim the waiting call by description or command (Codex seq48)',async()=>{
 const {TerminalTranscript}=await load(),m=new TerminalTranscript();m.bind(snapshot(),scope);
 const running=(id,sequence,command,title)=>({agent:'matrix',generation:3,tool:'exec_command',revision:1,sequence,id,state:'running',command,title});
 const acts=[running('a',1,'echo alpha','先看 A'),running('b',2,'echo beta','再看 B')];
 const session=(session_id,cmd,description)=>({session_id,generation:3,state:'running',cmd,description,started_at:1000+session_id});
 const commands=()=>m.segments().filter(s=>s.kind==='command').map(s=>s.text.includes('alpha')?'A':'B');
 // 只有 B 的会话先出现：B 认领 sequence 2，等 A。
 m.setSessions([session(2,'echo beta','再看 B')]);m.ingest(snapshot(acts));m.ingest(snapshot(acts));m.ingest(snapshot(acts));
 assert.deepEqual(commands(),[],'B waits for the earlier call');
 // A 的会话出现（用途一致）：按 CORE 顺序 A、B。
 m.setSessions([session(2,'echo beta','再看 B'),session(1,'echo alpha','先看 A')]);m.ingest(snapshot(acts));
 assert.deepEqual(commands(),['A','B']);
});
