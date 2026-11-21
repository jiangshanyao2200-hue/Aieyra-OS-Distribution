// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; revealFixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/reveal.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=f=>import(pathToFileURL(path.join(__dirname,'../ui',f)).href);

test('底部区域：输入框收起时看窗口底部 72px，打开时输入框和它上方一点也算',async()=>{
 const {inBottomZone}=await load('reveal.mjs');
 assert.equal(inBottomZone(800,{height:800}),true);
 assert.equal(inBottomZone(729,{height:800}),true);
 assert.equal(inBottomZone(727,{height:800}),false);
 // 输入框长高到 600 时，600-16 以下都算在区域里，鼠标移到输入框上半部分不会把它收起。
 assert.equal(inBottomZone(590,{height:800,composerTop:600}),true);
 assert.equal(inBottomZone(580,{height:800,composerTop:600}),false);
});

test('稍停才唤出：路过底部不打开，停够时间才打开，离开后收起',async()=>{
 const {setupReveal,REVEAL}=await load('reveal.mjs');
 const handlers={},timers=new Map();let seq=0,now=0,opened=false;
 const doc={addEventListener:(type,fn)=>{handlers[type]=fn;},removeEventListener(){}};
 const win={innerHeight:800,setTimeout:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{fn();return 0;},cancelAnimationFrame(){}};
 const run=ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}};
 const composer={getBoundingClientRect:()=>({top:740,height:opened?56:0}),addEventListener(){},removeEventListener(){}};
 setupReveal({composer,isOpen:()=>opened,open:()=>{opened=true;},close:()=>{opened=false;},keep:()=>false,doc,win});
 const move=y=>handlers.pointermove({clientX:400,clientY:y});
 move(790);run(REVEAL.bottomDwellMs-60);move(300);run(400);
 assert.equal(opened,false,'路过底部不打开');
 move(790);run(REVEAL.bottomDwellMs-60);assert.equal(opened,false);move(792);run(80);
 assert.equal(opened,true,'停够时间才打开');
 move(300);run(REVEAL.bottomLeaveMs+10);
 assert.equal(opened,false,'离开后收起');
});

// 共用夹具：假时钟、假窗口，返回控制柄。
async function revealFixture({keep=()=>false}={}){
 const {setupReveal,REVEAL}=await load('reveal.mjs');
 const handlers={},timers=new Map();let seq=0,now=0;const state={opened:false};
 const doc={addEventListener:(type,fn)=>{handlers[type]=fn;},removeEventListener(){}};
 const win={innerHeight:800,setTimeout:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{fn();return 0;},cancelAnimationFrame(){}};
 const run=ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}};
 const composer={getBoundingClientRect:()=>({top:740,height:state.opened?56:0}),addEventListener:(type,fn)=>{handlers['composer:'+type]=fn;},removeEventListener(){}};
 const reveal=setupReveal({composer,isOpen:()=>state.opened,open:()=>{state.opened=true;},close:()=>{state.opened=false;},keep,doc,win});
 return {REVEAL,reveal,run,state,move:y=>handlers.pointermove({clientX:400,clientY:y}),blur:()=>handlers['composer:focusout']()};
}

test('明确收起压过同一次停留：Esc 后指针不动不再弹回，离开再回来才重新自动打开（AIDEBUG I1 P1）',async()=>{
 const f=await revealFixture();
 f.move(790);f.run(f.REVEAL.bottomDwellMs+10);assert.equal(f.state.opened,true);
 // Esc：输入框收起、焦点交还光圈触发 focusout 重评。
 f.state.opened=false;f.reveal.suppress();f.blur();f.run(0);f.run(1000);
 assert.equal(f.state.opened,false,'指针静止 1 秒仍收着');
 f.move(791);f.run(f.REVEAL.bottomDwellMs+10);
 assert.equal(f.state.opened,false,'在底部区域里微动也不弹回');
 f.move(300);f.move(790);f.run(f.REVEAL.bottomDwellMs+10);
 assert.equal(f.state.opened,true,'离开再回来，停够时间照常打开');
 // 明确打开会解除抑制。
 f.state.opened=false;f.reveal.suppress();f.reveal.arm();f.move(792);f.run(f.REVEAL.bottomDwellMs+10);
 assert.equal(f.state.opened,true);
});

test('指针不在底部时收起不留抑制：之后一步跨进底部也能打开',async()=>{
 const f=await revealFixture();
 f.move(300);f.reveal.suppress();
 f.move(790);f.run(f.REVEAL.bottomDwellMs+10);
 assert.equal(f.state.opened,true);
});

test('保留条件结束后 refresh 立即重评，不必等鼠标再动（AIDEBUG I1 P3）',async()=>{
 let composing=true;const f=await revealFixture({keep:()=>composing});
 f.move(790);f.run(f.REVEAL.bottomDwellMs+10);assert.equal(f.state.opened,true);
 f.move(300);f.run(f.REVEAL.bottomLeaveMs+50);
 assert.equal(f.state.opened,true,'组字中不收');
 composing=false;f.reveal.refresh();f.run(f.REVEAL.bottomLeaveMs+10);
 assert.equal(f.state.opened,false,'组字结束后按当前条件收起');
});

test('键入即唤出：只认可打印字符和输入法，不抢快捷键和输入控件',async()=>{
 const {typingOpens}=await load('reveal.mjs');
 const key=(k,extra={})=>({key:k,ctrlKey:false,metaKey:false,altKey:false,isComposing:false,defaultPrevented:false,...extra});
 assert.equal(typingOpens(key('a'),{}),true);
 assert.equal(typingOpens(key('你'),{}),true);
 assert.equal(typingOpens(key('Process',{isComposing:true}),{}),true);
 assert.equal(typingOpens(key(' '),{}),false);
 assert.equal(typingOpens(key('Enter'),{}),false);
 assert.equal(typingOpens(key('h',{ctrlKey:true}),{}),false);
 assert.equal(typingOpens(key('a'),{editable:true}),false);
 assert.equal(typingOpens(key('a'),{dialogOpen:true}),false);
 assert.equal(typingOpens(key('a'),{away:true}),false);
});

test('三种形态：其他页面是折叠态，首页按是否在干活分聊天与工作',async()=>{
 globalThis.window??={};
 const {eyraForm}=await load('desktop-shell.mjs');
 assert.equal(eyraForm({}),'chat');
 assert.equal(eyraForm({mode:'work'}),'work');
 assert.equal(eyraForm({away:true,mode:'work'}),'folded');
 assert.equal(eyraForm({away:true}),'folded');
});

test('聊天列：最近 10 轮，过程正文和失败的回复不进聊天，发送中的用户消息立即入列',async()=>{
 const {chatRounds}=await load('chat-column.mjs');
 const messages=[];
 for(let i=1;i<=12;i++){messages.push({id:'u'+i,from:'user',text:'问'+i,state:'completed'});messages.push({id:'e'+i,from:'matrix',to:'user',text:'答'+i,state:'completed'});}
 messages.push({id:'c1',from:'matrix',to:'user',text:'过程',state:'commentary'},{id:'f1',from:'matrix',to:'user',text:'坏了',state:'failed'},{id:'x1',from:'matrix',to:'project',text:'内部',state:'completed'});
 const rounds=chatRounds(messages,[{id:'p1',from:'user',text:'还在发',state:'queued'}]);
 assert.equal(rounds[0].id,'u4');
 assert.equal(rounds.filter(r=>r.from==='user').length,10);
 assert.equal(rounds.at(-1).id,'p1');
 assert.ok(!rounds.some(r=>['c1','f1','x1'].includes(r.id)));
 assert.equal(chatRounds([{id:'u1',from:'user',text:'a'},{id:'u1',from:'user',text:'a'}]).length,1);
});

test('工作形态的聊天列：本轮过程正文作为普通消息入列；不传轮次（任务结束）时退场；旧轮次的过程正文不进来',async()=>{
 const {chatRounds}=await load('chat-column.mjs');
 const messages=[{id:'u1',from:'user',text:'修一下',state:'completed',generation:1},{id:'c0',from:'matrix',to:'user',text:'上一轮过程',state:'commentary',generation:0},{id:'c1',from:'matrix',to:'user',text:'我先看看日志。',state:'commentary',generation:1},{id:'c2',from:'matrix',to:'user',text:'找到原因了。',state:'commentary',generation:1}];
 const working=chatRounds(messages,[],{commentary:1});
 assert.deepEqual(working.map(r=>r.id),['u1','c1','c2']);
 assert.ok(working.filter(r=>r.from==='eyra').every(r=>r.progress===true));
 assert.deepEqual(chatRounds(messages).map(r=>r.id),['u1']);
});

test('聊天列：Eyra 回复带着这一轮的产物（README.md 运行时 · 产物 B1），没有时是空列表',async()=>{
 const {chatRounds}=await load('chat-column.mjs');
 const artifacts=[{path:'site/index.html',size:9000,kind:'html',created:true}];
 const rounds=chatRounds([{id:'u1',from:'user',text:'做个网页',state:'completed'},{id:'e1',from:'matrix',to:'user',text:'做好了',state:'completed',artifacts},{id:'e2',from:'matrix',to:'user',text:'还有事吗',state:'completed'}]);
 assert.deepEqual(rounds.find(r=>r.id==='e1').artifacts,artifacts);
 assert.deepEqual(rounds.find(r=>r.id==='e2').artifacts,[]);
});

test('打字机：流中只落后约 0.3 秒；流结束后 250ms 内打完；英文不停在词中间',async()=>{
 const {revealStep}=await load('typewriter.mjs');
 const text='一'.repeat(300);
 // 流中：积压 300 字、一帧 16ms，显示约 300×16/300=16 字。
 assert.equal(revealStep({shown:0,length:300,done:false,dt:16,text}),16);
 // 积压很少时至少前进 1 个字。
 assert.equal(revealStep({shown:299,length:300,done:false,dt:16,text}),300);
 // 流结束：模拟 60fps，最多 16 帧（约 267ms）全部显示。
 let shown=0,frames=0;while(shown<300&&frames<100){shown=revealStep({shown,length:300,done:true,dt:16,doneFor:frames*16,text});frames++;}
 assert.ok(frames<=16,'frames '+frames);
 // 英文按词。
 const en='hello wonderful world';
 const next=revealStep({shown:6,length:en.length,done:false,dt:16,text:en});
 assert.ok(next===15||!/[a-z]/.test(en[next]),'stopped at '+next);
 // 不切断代理对。
 const emoji='a😀b';assert.notEqual(revealStep({shown:0,length:4,done:false,dt:1,text:emoji},{lagMs:1000}),2);
});

test('重复流帧不重绘，换段完成时钟重置，已显示正文不倒退',async()=>{
 const {createTypewriter}=await load('typewriter.mjs');let time=0,callback=null;const paints=[];
 const node=()=>({classList:{toggle(){},remove(){}}}),a=node(),b=node();
 const t=createTypewriter({render:(n,text)=>paints.push({n,text}),win:{requestAnimationFrame:f=>(callback=f,1),cancelAnimationFrame(){callback=null;}},now:()=>time});
 t.show(a,'完整正文',{done:true,from:4});const count=paints.length;
 for(let i=0;i<20;i++)t.show(a,'完整正文',{done:true});assert.equal(paints.length,count);
 t.show(b,'一'.repeat(100),{done:true,from:0});
 for(let i=0;i<20&&callback;i++){time+=16;const f=callback;callback=null;f();}
 assert.equal(paints.at(-1).text,'一'.repeat(100));
 assert(paints.filter(p=>p.n===b).every((p,i,all)=>i===0||p.text.startsWith(all[i-1].text)));
 t.detach();
});
