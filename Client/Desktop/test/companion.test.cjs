// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/companion.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProfileStore}=require('../host/profile.cjs');
test('task identity is transient and never borrows the saved Eyra name or avatar',async()=>{
 const {taskViewProfile,roleIdentity}=await import('../ui/role-identity.mjs');
 const profile={name:'用户',eyraName:'私人名字',eyraAvatar:'private.png',roles:{matrix:{ring:'wave'},project:{name:'导航员'}}},before=structuredClone(profile);
 const snapshot={session_id:'agent',root_id:'home',tasks:[{id:'home',primary:true,title:'Eyra'},{id:'agent',title:'独立审阅员'}]};
 const view=taskViewProfile(profile,snapshot);
 assert.deepEqual(roleIdentity(view),{role:'matrix',name:'独立审阅员',avatar:'',ring:'pulse',glyph:''});
 assert.equal(roleIdentity(view,'project').name,'导航员');assert.equal(view.name,'用户');assert.deepEqual(profile,before);
 assert.equal(taskViewProfile(profile,{...snapshot,session_id:'home'}),profile);
 assert.equal(taskViewProfile(profile,{...snapshot,session_id:'unknown'}),profile);
 assert.equal(taskViewProfile(profile,{...snapshot,tasks:[{id:'agent',title:'分裂任务',independent:true}]}),profile);
 assert.equal(taskViewProfile(profile),profile);
});
test('profile is optional, explicit, persistent, separate from model config',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-profile-'));
 try{const config=path.join(dir,'config.json');fs.writeFileSync(config,'unchanged');const store=createProfileStore(config);
 assert.equal(store.read().initialized,false);assert.equal(fs.readdirSync(dir).length,1);
 const {version,...saved}=store.save({name:'阿雨',avatar:''});assert.match(version,/^[a-f0-9]{64}$/);
 assert.deepEqual(saved,{name:'阿雨',avatar:'',eyraName:'',eyraAvatar:'',userRingColor:'#e6e9f0',roles:{},background:'',backgroundBlur:0,backgroundOpacity:0,chatBlur:12,chatOpacity:.18,chatLayout:{},initialized:true});
 assert.equal(createProfileStore(config).read().name,'阿雨');assert.equal(fs.readFileSync(config,'utf8'),'unchanged');
 const palette=require('../host/profile.cjs').identityPalette();assert.equal(palette.length,7);assert.equal(new Set(palette.map(x=>x.color)).size,7);
 for(const row of palette){store.save({...store.read(),userRingColor:row.color});assert.equal(createProfileStore(config).read().userRingColor,row.color);}
 assert.throws(()=>store.save({...store.read(),userRingColor:'red'}));
 assert.throws(()=>store.save({name:'x'.repeat(41)}));assert.throws(()=>store.save({avatar:'data:image/svg+xml;base64,AAAA'}));
 assert.equal(store.read().name,'阿雨');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('profile persists both identities and background, migrates old files and rejects invalid images',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-identity-'));
 try{
  const file=path.join(dir,'companion-profile.json'),store=createProfileStore(path.join(dir,'config.json'));
  fs.writeFileSync(file,JSON.stringify({name:'旧名字',avatar:'',initialized:true}));
  assert.equal(store.read().eyraName,'');assert.equal(store.read().background,'');assert.equal(store.read().backgroundBlur,0);assert.equal(store.read().backgroundOpacity,0);assert.equal(store.read().chatBlur,12);assert.equal(store.read().chatOpacity,.18);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=';
  const jpeg='data:image/jpeg;base64,'+Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9','hex').toString('base64');
  const expected=store.save({name:'用户',avatar:png,eyraName:'小伊',eyraAvatar:png,background:jpeg,backgroundBlur:7,backgroundOpacity:.32});
  assert.deepEqual(store.read(),expected);const before=fs.readFileSync(file,'utf8');
  for(const value of [{...expected,eyraName:'x'.repeat(41)},{...expected,eyraAvatar:'data:image/png;base64,AAAA'},{...expected,background:'https://example.invalid/image.jpg'},{...expected,background:'data:image/jpeg;base64,AAAA'},{...expected,background:jpeg+'A'.repeat(2800000)}])assert.throws(()=>store.save(value));
  assert.equal(fs.readFileSync(file,'utf8'),before);
  for(const backgroundBlur of [-1,33,NaN,Infinity,'12'])assert.throws(()=>store.save({...expected,backgroundBlur}));
  for(const backgroundOpacity of [-.1,1.1,NaN,Infinity,'0.5'])assert.throws(()=>store.save({...expected,backgroundOpacity}));
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.equal(store.save({...expected,backgroundBlur:0,backgroundOpacity:0}).backgroundOpacity,0);
  assert.throws(()=>store.save({...expected,backgroundBlur:32,backgroundOpacity:1}),e=>e.code==='version_conflict');
  assert.equal(store.save({...store.read(),backgroundBlur:32,backgroundOpacity:1}).backgroundBlur,32);
  assert.deepEqual(store.save({...store.read(),chatLayout:{eyraAvatar:96,userAvatar:40,bad:'x',big:99999,'no-key':3}}).chatLayout,{eyraAvatar:96,userAvatar:40},'chat layout keeps only finite known-shape numbers');
  assert.throws(()=>store.save({...expected,chatLayout:[1]}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('plan errors remain beside the persistent plan and clear only after an actual successful update',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs');const p=new WorkspacePresentation();
 const plan={id:'p',mode:'goal',revision:2,status:'active',phases:[{id:'A',steps:[{id:'a',text:'核验',status:'in_progress'}]}]};
 const feed=(items,extra={})=>p.ingest({session_id:'s',plan,plan_scope:{agent:'m',generation:1},roles:[{id:'m',role:'matrix',generation:1,state:'running',activity:{items}}],...extra});
 feed([{id:'failed',tool:'update_plan',state:'failed',preview:{ok:false,error:{code:'revision_conflict',message:'版本已变化'}}}]);
 assert.equal(p.planFeedback(),'计划未变更：版本已变化');assert.equal(p.plan().preview.state,plan);
 feed([{id:'ok',tool:'update_plan',state:'completed',preview:{ok:true,no_change:true}}]);assert.equal(p.planFeedback(),'');
 p.ingest({session_id:'s',plan,plan_scope:{agent:'m',generation:1},roles:[{id:'m',role:'matrix',generation:2,state:'failed'}]});assert.equal(p.plan(),null,'an unfinished prior task must not attach to the new task');
 p.ingest({session_id:'s',plan,plan_scope:{agent:'m',generation:2},roles:[{id:'m',role:'matrix',generation:2,state:'running'}]});assert.equal(p.plan().preview.state,plan);
 p.ingest({session_id:'new',roles:[]});assert.equal(p.plan(),null);
});
test('a body and later tools arriving in one poll keep only operations after the actual body boundary',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs');const p=new WorkspacePresentation();
 const items=[{id:'old',tool:'exec_command',state:'completed',started_at:100},{id:'new',tool:'exec_command',state:'running',started_at:300},{id:'old-read',tool:'project',action:'read',state:'completed',started_at:150},{id:'new-read',tool:'project',action:'read',state:'completed',started_at:350}];
 p.ingest({session_id:'one',roles:[{id:'m',role:'matrix',generation:1,state:'running',activity:{items}}],live:{matrix:{body_id:'answer',body_at:200,phase:'tool',text:'正文和随后调用已在一次查询中到达'}}});
 assert.deepEqual(p.terminal().map(x=>x.id),['old','new','old-read','new-read']);assert.deepEqual(p.current().map(x=>x.id),['new','new-read']);
 p.ingest({session_id:'one',roles:[{id:'m',role:'matrix',generation:1,state:'running',activity:{items:[]}}],live:{matrix:{body_id:'next-request',phase:'waiting',new_body:true,text:'上次正文'}}});assert.deepEqual(p.terminal().map(x=>x.id),['old','new','old-read','new-read']);
 p.ingest({session_id:'one',roles:[{id:'m',role:'matrix',generation:1,state:'running'}],live:{matrix:{body_id:'next-request',body_at:400,phase:'settled',text:'新的正文'}}});assert.equal(p.terminal().length,4);assert.deepEqual(p.current(),[]);
});

test('burst text reveals in readable batches, bounded delay and immediate cancellation/reduced motion',async()=>{
 const {TextPacer,PhasePacer}=await import('../ui/pacing.mjs');
 const p=new TextPacer(),body='第一句说清楚。第二句保留足够阅读时间。第三句也能完整呈现，不会挤在同一帧。';
 p.set(body,'a',0);assert.equal(p.fast,true);const first=p.next(0);assert.ok(first.length>1&&first.length<body.length);assert.equal(p.next(20),first);assert.ok(p.next(50).length>first.length);for(let now=95;now<1000;now+=45)p.next(now);assert.equal(p.value,body,'short burst should not wait several seconds');
 p.set('', 'late',5000);p.set(body,'late',12000);assert.ok(p.next(12000).length<body.length,'network wait must not consume display budget');
 p.set('🙂新的内容','b',4300);assert.equal(p.next(4300),'🙂');assert.equal(p.next(4301,true),'🙂新的内容');
 const phase=new PhasePacer();assert.equal(phase.choose('waiting','one',0),'waiting');assert.equal(phase.choose('thinking','one',40),'waiting');assert.equal(phase.choose('body','one',80),'waiting');assert.equal(phase.choose('body','one',200),'body');assert.equal(phase.choose('cancelling','one',210),'cancelling');
});

test('long live output has a readable preview without rewriting short JSON or code',async()=>{
 const {replyPreview}=await import('../ui/companion.mjs');
 for(const value of ['{"ok":true}','```js\nconst n=1;\n```','结果已核对。'])assert.deepEqual(replyPreview(value),{text:value,details:false});
 const longJSON=JSON.stringify({rows:Array.from({length:50},(_,i)=>({i,value:'完整内容'}))});
 assert.equal(replyPreview(longJSON).details,true);assert.ok(Array.from(replyPreview(longJSON).text).length<=521);
 assert.equal(replyPreview('已完成核对。\n\n'+longJSON).text,replyPreview(longJSON).text);
 assert.equal(replyPreview('```json\n'+longJSON+'\n```').details,true);
});
test('terminal retains same-turn output across tool changes and clears on turn completion',async()=>{
 const {WorkspacePresentation}=await import('../ui/model.mjs');const p=new WorkspacePresentation();
 const ingest=(items,state='running',generation=1)=>p.ingest({roles:[{role:'matrix',id:'m',generation,state,activity:{items}}]});
 const item=(id,tool,state='running')=>({id,tool,generation:1,state,command:'echo '+id});
 ingest([item('one','exec_command')]);assert.deepEqual(p.terminal().map(x=>x.id),['one']);
 ingest([{...item('one','exec_command'),preview:{output:'actual output'}}, {...item('poll','write_stdin'),hidden:true}]);assert.equal(p.terminal().length,1);
 ingest([item('one','exec_command','completed')]);assert.equal(p.terminal().length,1,'finished invocation remains readable while model continues');
 ingest([item('two','exec_command')]);assert.deepEqual(p.terminal().map(x=>x.id),['one','two']);
 ingest([item('read','project')]);assert.equal(p.terminal().length,3,'non-shell calls share the transcript');
 ingest([item('three','exec_command')]);assert.deepEqual(p.terminal().map(x=>x.id),['one','two','read','three']);
 ingest([], 'completed');assert.equal(p.terminal().length,4);assert.ok(p.history().some(x=>x.id==='one'));
 ingest([], 'running',2);assert.equal(p.terminal().length,0);
});

test('short reply finishing between scene ticks keeps the phase transition scheduled',async()=>{
 const {TextPacer,PhasePacer}=await import('../ui/pacing.mjs');
 const text=new TextPacer(),phase=new PhasePacer();
 phase.choose('waiting','turn',0);assert.equal(phase.pending,false);
 text.set('完成。','answer',20);
 assert.equal(phase.choose('body','turn',20),'waiting');assert.equal(phase.pending,true);
 for(const now of [20,44,68])text.next(now);
 assert.equal(text.pending,false,'animation frame finishes before the next 150ms scene tick');
 assert.equal(phase.pending,true,'completed text must not unschedule the unsettled phase');
 assert.equal(phase.choose('idle','turn',150),'idle');assert.equal(phase.pending,false);
 phase.choose('thinking','turn',160);assert.equal(phase.pending,true);
 phase.choose('offline','turn',161);assert.equal(phase.pending,false);
 phase.choose('body','next-turn',170);assert.equal(phase.pending,false);
});

test('mother professional identity changes only its live name and restores without editing profile',async()=>{
 const {taskViewProfile,roleIdentity}=await import('../ui/role-identity.mjs');
 const profile={eyraName:'我的母体',eyraAvatar:'mother.png',roles:{matrix:{ring:'wave'}}},before=structuredClone(profile);
 const snapshot={session_id:'home',root_id:'home',identity:{phase:'active',name:'代码助手'}};
 const live=roleIdentity(taskViewProfile(profile,snapshot));
 assert.equal(live.name,'代码助手 · Eyra');assert.equal(live.avatar,'mother.png');assert.equal(live.ring,'wave');
 assert.equal(taskViewProfile(profile,snapshot,{history:true}),profile);
 for(const phase of ['preparing','exiting','exited','aborted'])assert.equal(taskViewProfile(profile,{...snapshot,identity:{phase,name:'代码助手'}}),profile);
 assert.equal(taskViewProfile(profile,{...snapshot,session_id:'another',tasks:[]}),profile);
 assert.deepEqual(profile,before);
});
