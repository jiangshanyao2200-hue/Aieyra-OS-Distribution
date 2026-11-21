// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/stage-layout.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');

test('stage kinds merge the three shell tools into one terminal',async()=>{
 const {stageKind}=await import('../ui/stage-layout.mjs');
 assert.deepEqual(['exec_command','write_stdin','read_shell_output','apply_patch','web_search','browser'].map(stageKind),['terminal','terminal','terminal','patch','search','browser']);
});

test('previews fit the remaining space and keep a narrow window useful',async()=>{
 const {stagePlacement}=await import('../ui/stage-layout.mjs');
 for(const [width,pushLeft,pushRight] of [[1280,280,0],[1600,280,280],[1100,264,0]]){
  const layout=stagePlacement({width,pushLeft,pushRight});
  assert.equal(layout.mode,'side');assert.ok(layout.chat>=320);
  assert.ok(width-layout.right-layout.left>=320);
  assert.ok(layout.left>pushLeft+layout.chat);
 }
 assert.equal(stagePlacement({width:800,height:600,pushLeft:280}).mode,'stack');
 assert.equal(stagePlacement({width:640,height:480}).mode,'stack');
 assert.equal(stagePlacement({width:640,height:300,pushLeft:280}).mode,'hidden');
 // Home preserves the chosen identity plus a readable text column. A side
 // layout must have room in both equal columns, even if the tool could fit.
 assert.equal(stagePlacement({width:768,height:561,chatMin:420}).mode,'stack');
 const home=stagePlacement({width:1000,height:700,chatMin:460});
 assert.equal(home.mode,'side');assert.ok(home.chat>=460);
});

test('chat layout preserves hundredths and uses the recommended avatar, name and text ranges',async()=>{
 const {normalizeChatLayout,applyChatLayout,snapValue,CHAT_LAYOUT}=await import('../ui/chat-layout.mjs');
 const d=normalizeChatLayout();assert.ok(d.eyraAvatar>=80&&d.userAvatar<d.eyraAvatar&&d.ring>=104);
 // 默认值沿用用户明确指定的推荐值。
 assert.deepEqual([d.eyraAvatar,d.userAvatar,d.ring,d.eyraName,d.userName,d.textSize,d.lineHeight,d.gap,d.top,d.left,d.right,d.maxWidth],[120,84,120,25,25,16,1.3,5,20,60,80,800]);
 const n=normalizeChatLayout({eyraAvatar:9999,userAvatar:-5,textSize:'x',lineHeight:1.83});
 assert.equal(n.eyraAvatar,200);assert.equal(n.userAvatar,140);assert.equal(n.textSize,16);assert.equal(n.lineHeight,1.83);
 // 旧版只有一个名字字号：两个名字都沿用。
 const old=normalizeChatLayout({nameSize:18});assert.equal(old.eyraName,18);assert.equal(old.userName,18);
 // 磁吸不再强制吞掉非整五的整数或小数。
 const f=key=>CHAT_LAYOUT.find(x=>x.key===key);
 assert.equal(snapValue(f('textSize'),19),19);assert.equal(snapValue(f('textSize'),17),17);assert.equal(snapValue(f('eyraName'),21),21);assert.equal(snapValue(f('eyraName'),25),25);
 assert.equal(snapValue(f('lineHeight'),1.23),1.23);assert.equal(snapValue(f('lineHeight'),1.12),1.12);assert.equal(snapValue(f('maxWidth'),784),784);
 assert.equal(snapValue(f('eyraAvatar'),119.8),120);assert.equal(snapValue(f('eyraAvatar'),124.8),125);assert.equal(snapValue(f('eyraAvatar'),123.15),123.15);
 const set=new Map();applyChatLayout({setProperty:(k,v)=>set.set(k,v)},{gap:30});
 assert.equal(set.get('--chat-gap'),'30px');assert.equal(set.get('--chat-leading'),'1.3');assert.equal(set.get('--chat-name-user'),'25px');
 const scaled=new Map();applyChatLayout({setProperty:(k,v)=>scaled.set(k,v)},{maxWidth:800,position:50},.875,761);
 assert.equal(scaled.get('--chat-max'),'700px');assert.equal(scaled.get('--chat-left'),'30.5px');assert.equal(scaled.get('--chat-right'),'30.5px');
});

test('chat column keeps the greeting as an Eyra line after the generation it followed',async()=>{
 const {chatRounds}=await import('../ui/chat-column.mjs');
 const messages=[{id:'u1',from:'user',text:'早',generation:1},{id:'e1',from:'matrix',to:'user',state:'completed',text:'早上好',generation:1},{id:'u2',from:'user',text:'再聊',generation:2}];
 const ids=g=>chatRounds(messages,[],{greeting:g}).map(e=>e.id);
 assert.deepEqual(ids({id:'greeting:a',text:'嗨，我在。',after:1}),['u1','e1','greeting:a','u2']);
 assert.deepEqual(ids({id:'greeting:a',text:'嗨，我在。',after:0}),['greeting:a','u1','e1','u2']);
 assert.deepEqual(ids({id:'greeting:a',text:'  ',after:0}),['u1','e1','u2']);
 assert.equal(chatRounds([],[],{greeting:{id:'g',text:'嗨',after:0}})[0].from,'eyra');
});

test('horizontal placement distributes spare width and remains bounded in narrow or scaled windows',async()=>{
 const {applyChatLayout}=await import('../ui/chat-layout.mjs');
 for(const scale of [.75,1,1.25])for(const viewport of [480,900,1400])for(const position of [0,25,50,100]){
  const style={setProperty(){}},shown=applyChatLayout(style,{maxWidth:800,position},scale,viewport),room=Math.max(0,viewport-800*scale);
  assert.equal(shown.left+shown.right,room);assert.ok(shown.left>=0&&shown.right>=0);
  assert.ok(Math.abs(shown.left-room*position/100)<=.25);
 }
});

test('tidy slider preserves endpoints and keyboard can leave off-grid saved values',async()=>{
 const {tidyValue,bindTidyRange}=await import('../ui/tidy-range.mjs');
 assert.equal(tidyValue(.631,{min:.63,max:2,step:.05}),.63);
 assert.equal(tidyValue(.63,{min:.63,max:2,step:.05}),.63);
 assert.equal(tidyValue(101,{min:0,max:98,step:5}),98);
 class Input extends EventTarget{min='0';max='98';value='22';step='1';ownerDocument={createElement:()=>({setAttribute(){}})};style={setProperty(){}};setAttribute(){}getAttribute(){return null;}}
 const input=new Input(),release=bindTidyRange(input,5),press=key=>{const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value:key});input.dispatchEvent(e);};
 press('ArrowRight');assert.equal(input.value,'22.01');press('ArrowLeft');assert.equal(input.value,'22');
 press('End');assert.equal(input.value,'98');press('ArrowLeft');assert.equal(input.value,'97.99');
 press('Home');assert.equal(input.value,'0');release.close();press('ArrowRight');assert.equal(input.value,'0');
 const integer=new Input(),binding=bindTidyRange(integer,{integer:true});const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'ArrowRight'});integer.dispatchEvent(event);assert.equal(integer.value,'23');binding.close();
});

