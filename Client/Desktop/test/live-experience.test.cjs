// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/live-experience.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const {test}=require('node:test'),assert=require('node:assert/strict');
test('late greetings wait until work settles and an already visible greeting stays stable',async()=>{
 const {GreetingPresentation}=await import('../ui/experience.mjs'),view=new GreetingPresentation();
 assert.equal(view.project(null,{scope:'home'}),null);
 assert.equal(view.project('late greeting',{scope:'home',working:true}),null);
 assert.equal(view.project('late greeting',{scope:'home'}),'late greeting');
 assert.equal(view.project('changed greeting',{scope:'home',working:true}),'late greeting');
 assert.equal(view.project('other session',{scope:'contact',working:true}),null);
 assert.equal(view.project('other session',{scope:'contact'}),'other session');
});
test('startup never blocks the canvas and reports connection failures separately',async()=>{
 const {StartupGate}=await import('../ui/experience.mjs');const g=new StartupGate();
 const s=(state,phase,text='',epoch='one')=>({core_epoch:epoch,greeting:{state,phase,text}});
 assert.equal(g.project(s('connecting','compacting')).visible,false);
 assert.equal(g.project(s('connecting','greeting','一')).visible,false);
 assert.equal(g.project(s('online','','')).visible,false);
 assert.ok(g.project(s('offline','','')).failed);
 assert.equal(g.project(s('online','','我在。')).visible,false);
 assert.equal(g.project(s('connecting','compacting','','two')).visible,false);
 assert.equal(g.project(s('skipped','','','two')).visible,false);
 assert.equal(g.project(s('connecting','compacting','','three')).visible,false);
});
test('thought bursts advance across frames, catch up within 160ms, and reset without replay',async()=>{
 const {ThoughtPacer}=await import('../ui/pacing.mjs');const p=new ThoughtPacer(),text='核对当前配置，然后检查连接和实际返回。';
 p.set(text,'turn1',0);const frames=[0,16,32,64,96,128,160].map(t=>p.next(t));
 assert.ok(new Set(frames).size>=6);assert.equal(frames.at(-1),text);
 for(let i=1;i<frames.length;i++)assert.ok(frames[i].startsWith(frames[i-1]));
 p.set(text+'继续验证','turn1',200);p.next(216);p.set(text+'继续验证更多结果','turn1',240);
 assert.equal(p.next(360),text+'继续验证更多结果');
 p.set('第二句','turn1',370);assert.equal(p.next(370),'');assert.equal(p.next(530),'第二句');
 p.clear();assert.equal(p.next(600),'');assert.equal(p.pending,false);
 p.set('新任务','turn2',610);assert.equal(p.next(610,true),'新任务');
});
test('thought pacing preserves Unicode graphemes',async()=>{
 const {ThoughtPacer}=await import('../ui/pacing.mjs');
 const p=new ThoughtPacer(),text='正在检查👩🏽‍💻的e\u0301配置';p.set(text,'x',0);
 const boundaries=new Set(['',...Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),s=>text.slice(0,s.index+s.segment.length))]);
 for(let t=0;t<=160;t+=8)assert.ok(boundaries.has(p.next(t)));
});
test('canvas shows only the latest request and reply without deleting archive',async()=>{
 const {currentMessages}=await import('../ui/experience.mjs');
 const messages=Array.from({length:20},(_,i)=>({id:'m'+i,generation:1+Math.floor(i/2),from:i%2?'matrix':'user',to:i%2?'user':'matrix',text:'完整正文'+i}));
 assert.equal(currentMessages(messages,10).length,0);
 assert.deepEqual(currentMessages(messages,6).map(m=>m.generation),[10,10]);
 messages.push({id:'new-body',generation:10,from:'matrix',to:'user',text:'最新正文'});
 assert.deepEqual(currentMessages(messages,6).map(m=>m.id),['m18','new-body']);
 assert.equal(messages.length,21);
});
test('streamed Unicode stays on grapheme boundaries across combining, ZWJ, flags and surrogate splits',async()=>{
 const {ThoughtPacer}=await import('../ui/pacing.mjs'),segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 const streams=[['进度：','👩','🏽','\u200d','💻','e','\u0301','🇨','🇳','🇩','🇪'],['文字','\ud83d','\udc69','\u200d','\ud83d','\udcbb','\r','\n','ᄒ','ᅡ','ᆫ'],Array.from('完整家庭👩‍👩‍👧‍👦与旗帜🇨🇳🇩🇪，继续。')];
 for(const chunks of streams){const p=new ThoughtPacer();let text='',now=0;for(const chunk of chunks){text+=chunk;p.set(text,'unicode',now);const boundaries=new Set(['',...Array.from(segmenter.segment(text),s=>text.slice(0,s.index+s.segment.length))]);for(let at=now;at<now+25;at+=8)assert.ok(boundaries.has(p.next(at)),JSON.stringify({text,value:p.value}));now+=25;}assert.equal(p.next(now+160),text);assert.equal(p.pending,false);}
});
test('long prose previews the latest bounded paragraph and exposes full history',async()=>{
 const {replyPreview}=await import('../ui/companion.mjs');
 const full='全面测试做完了，覆盖报告已放左下角。\n\n通过为主，computer与浏览器的原生边界仍有明确限制。'+ '后续结果完整保留。'.repeat(80);
 const preview=replyPreview(full);
 assert.equal(preview.details,true);assert.ok(Array.from(preview.text).length<=521);
 assert.equal(preview.text.includes('覆盖报告已放左下角'),false);
 assert.ok(preview.text.startsWith('…'));assert.ok(full.endsWith(preview.text.slice(1)));
 assert.equal(replyPreview('第一段。\n\n最近一段。').text,'最近一段。');
});
test('every visible tool is retained in this turn and next generation starts clean',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs');const p=new WorkspacePresentation();
 p.ingest({session_id:'s',roles:[{id:'m',role:'matrix',generation:1,state:'running',activity:{items:['exec_command','browser','project','update_plan','exec','wait'].map((tool,i)=>({tool,id:''+i,state:'completed'}))}}]});
 assert.equal(p.terminal().length,6);
 p.ingest({session_id:'s',roles:[{id:'m',role:'matrix',generation:2,state:'running',activity:{items:[]}}]});assert.equal(p.terminal().length,0);
});
