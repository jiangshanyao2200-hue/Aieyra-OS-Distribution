// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load; usage; snapshot
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/team-settings.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=f=>import(pathToFileURL(path.join(__dirname,'../ui',f)).href);

test('模型连接页：团队只看开关，没选模型的角色跟随 Eyra',async()=>{
 const {teamState}=await load('team.mjs');
 const pool={a:{id:'a'},b:{id:'b'}},byId=id=>pool[id]||null;
 const none=teamState({vision_profile:'',execution_profile:''},byId);
 assert.equal(none.ready,true);assert.deepEqual(none.missing,[]);assert.deepEqual(none.following,['Vaya','Cota']);
 assert.deepEqual(teamState({vision_profile:'a',execution_profile:'gone'},byId).following,['Cota']);
 const ready=teamState({vision_profile:'a',execution_profile:'b'},byId);
 assert.equal(ready.ready,true);assert.match(ready.hint,/简单任务 Eyra 直接做，复杂的请 Vaya 配合，更复杂的再请 Cota$/);
 const off=teamState({vision_profile:'a',execution_profile:'b',collaboration_enabled:false},byId);
 assert.equal(off.ready,false);assert.match(off.hint,/已关闭/);
});

const usage=(input,output,cached)=>({samples:1,input_tokens:input,output_tokens:output,cached_tokens:cached,cached_known:true,cache_input_tokens:input,cache_reported:1,reported:1,complete:true});
const snapshot=(over={})=>({session_id:'s',collaboration:{team:{ready:true},dispatched:false,helpers:[]},
 roles:[{role:'matrix',id:'m',state:'running',generation:2,request_model:'gpt-5.5',usage:usage(1000,200,800),context:{tokens:5000,model_window:100000}},
  {role:'project',id:'p',state:'running',generation:1,usage:usage(300,40,0),context:{tokens:1000,model_window:100000}},
  {role:'execution',id:'x',state:'idle',generation:0}],
 live:{matrix:{phase:'thinking',thought:'先看看工具箱在哪里',text:'收到。\n\n我先写计划。'},project:{phase:'body',text:'工具箱在 Core/toolbox.go'}},...over});

test('协同形态：团队配齐、Eyra 写下计划且在工作时进入共享工作区',async()=>{
 const {teamForm}=await load('team.mjs');
 assert.equal(teamForm(snapshot(),{planned:true,worked:true}),true);
 assert.equal(teamForm(snapshot(),{planned:false}),true,'Vaya 已经在做，也算进入协同');
 const solo=snapshot();solo.roles[1].state='idle';
 assert.equal(teamForm(solo,{planned:false,worked:true}),false,'没写计划、没派工：单人工作形态');
 assert.equal(teamForm(solo,{planned:true,worked:false}),false,'只是发了消息：旧计划不能让它进工作形态');
 const before=snapshot({collaboration:{dispatched:true,team:{ready:true}}});before.roles[1].state='completed';
 assert.equal(teamForm(before,{worked:false}),false,'只是发了消息：成员上次的结果不能让它进工作形态');
 assert.equal(teamForm(before,{worked:true}),true,'这一轮调用过工具才进');
 assert.equal(teamForm(snapshot({collaboration:{team:{ready:false}}}),{planned:true}),false,'没配齐不分裂');
 const done=snapshot();done.roles[0].state='completed';
 assert.equal(teamForm(done,{worked:true}),true,'Eyra 停了但 Vaya 还在做：继续显示');
 done.roles[1].state='completed';
 assert.equal(teamForm(done,{planned:true,worked:true}),false,'都做完回到聊天形态');
 globalThis.window??={};
 const {eyraForm}=await load('desktop-shell.mjs');
 assert.equal(eyraForm({mode:'team'}),'work');assert.equal(eyraForm({mode:'team',away:true}),'folded');
});

test('右上角：每个角色一行消耗，潜意识与子 agent 也在；胶囊一次一个角色（R23、R24）',async()=>{
 const {usageRows,capsuleItems}=await load('team.mjs');
 const rows=usageRows(snapshot({greeting_usage:usage(50,10,0),collaboration:{team:{ready:true},helpers:[{task_id:'h1',title:'查日志',state:'running'}]}}));
 assert.deepEqual(rows.map(r=>r.key),['matrix','project','execution','startup','helper:h1']);
 assert.equal(rows[0].cache,'80%');assert.equal(rows[0].context,'5.00%');assert.equal(rows[0].model,'gpt-5.5');
 assert.equal(rows[4].state,'在做');
 // 胶囊只轮到正在工作的角色；都没在工作就停在 Eyra。
 assert.deepEqual(capsuleItems(rows.map(r=>({...r,active:['matrix','project'].includes(r.key)}))).map(i=>i.key),['matrix','project']);
 assert.deepEqual(capsuleItems(rows.map(r=>({...r,active:false}))).map(i=>i.key),['matrix']);
});

test('团队对话：聊天里只放一句 brief，按时间插进去，不出现原文；旧默认名换成新名字',async()=>{
 const {chatRounds}=await load('chat-column.mjs');
 const messages=[{id:'u1',from:'user',text:'改一下工具箱',at:'2026-11-04T01:00:00Z',state:'completed'},{id:'e1',from:'matrix',to:'user',text:'好了',at:'2026-11-04T01:05:00Z',state:'completed'}];
 const talk=[{id:'t1',from:'matrix',to:'execution',brief:'Cota，帮我改掉',kind:'dispatch',at:'2026-11-04T01:01:00Z'},{id:'t2',from:'execution',to:'matrix',brief:'收到！',kind:'ack',at:'2026-11-04T01:01:01Z'},{id:'t3',from:'execution',to:'matrix',brief:'',at:'2026-11-04T01:02:00Z'}];
 const rows=chatRounds(messages,[],{limit:Infinity,talk});
 assert.deepEqual(rows.map(r=>r.id),['u1','talk:t1','talk:t2','e1']);
 assert.equal(rows[1].role,'matrix');assert.equal(rows[1].to,'execution');assert.equal(rows[2].role,'execution');assert.equal(rows[2].text,'收到！');
 assert.ok(rows.filter(r=>r.talk).every(r=>!/原文/.test(r.text)));
 const {roleIdentity}=await load('role-identity.mjs');
 assert.equal(roleIdentity({roles:{project:{name:'莹'},execution:{name:'Nova'}}},'project').name,'Vaya');
 assert.equal(roleIdentity({roles:{execution:{name:'Nova'}}},'execution').name,'Cota');
 assert.equal(roleIdentity({roles:{execution:{name:'小柯'}}},'execution').name,'小柯','用户起的名字保留');
});

test('模型连接：Vaya、Cota 的工具只能从可选范围里选，运行命令带上配套工具',()=>{
 const {setRoles}=require('../src/model-setup.cjs');
 const s={api_profiles:[]};
 setRoles(s,{execution_tools:['exec_command','apply_patch']});
 assert.deepEqual(s.execution_tools,['terminal','exec_command','write_stdin','read_shell_output','apply_patch']);
 setRoles(s,{vision_tools:['web_search','project']});assert.deepEqual(s.vision_tools,['project','web_search']);
 assert.deepEqual(setRoles(s,{execution_tools:['memory']}).execution_tools,['memory']);
 assert.throws(()=>setRoles(s,{execution_tools:['not_a_tool']}),/只能从这些工具里选/);
 assert.throws(()=>setRoles(s,{vision_tools:['toolbox']}),/只能从这些工具里选/);
 assert.deepEqual(setRoles(s,{vision_tools:['apply_patch']}).vision_tools,['apply_patch']);
 assert.throws(()=>setRoles(s,{execution_enabled:'off'}),/true 或 false/);
 assert.equal(setRoles(s,{execution_enabled:false}).execution_enabled,false);
 setRoles(s,{vision_tools:null});assert.equal('vision_tools' in s,false,'null 回到默认');
});
