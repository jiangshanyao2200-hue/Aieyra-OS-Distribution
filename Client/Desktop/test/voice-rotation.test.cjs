// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test; load
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/voice-rotation.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=f=>import(pathToFileURL(path.join(__dirname,'../ui',f)).href);

test('其他页面轮流显示：说话的优先，可以固定',async()=>{
 const {VoiceRotation,workingVoices}=await load('voice-rotation.mjs');
 const snapshot={roles:[{role:'matrix',state:'running'},{role:'project',state:'running'},{role:'execution',state:'idle'}],live:{matrix:{phase:'tool'},project:{phase:'body',text:'在写'}}};
 const voices=workingVoices(snapshot);
 assert.deepEqual(voices.map(v=>[v.role,v.speaking]),[['matrix',false],['project',true]]);
 const r=new VoiceRotation({dwell:1000});
 assert.equal(r.pick(voices,0).role,'project','说话的优先');
 assert.equal(r.pick(voices,5000).role,'project','只有一个在说话时不换');
 const both=[{role:'matrix',speaking:true},{role:'project',speaking:true}];
 const first=r.pick(both,5000).role;assert.equal(r.pick(both,5500).role,first,'停留时间内不换');
 assert.notEqual(r.pick(both,6100).role,first,'到时间轮到下一个');
 r.pin('matrix');assert.equal(r.pick(both,9000).role,'matrix');assert.equal(r.pick(both,19000).role,'matrix','固定后不轮换');
 r.pin('matrix');assert.equal(r.pinned,'','再点一下取消');
 r.pin('project');assert.equal(r.pick([{role:'matrix',speaking:false}],20000).role,'matrix','固定的角色做完了就回到还在工作的');
 assert.equal(r.pinned,'');
 assert.equal(r.pick([],21000),null);
});

test('成员的显示：思考、正文、动作',async()=>{
 const {helperView,helperState}=await load('voice-rotation.mjs');
 assert.equal(helperView({active:true,phase:'thinking',thought:'想'}).kind,'thinking');
 assert.equal(helperView({active:true,phase:'body',body:'写'}).done,false);
 assert.equal(helperView({active:true,phase:'tool',label:'读取文件'}).label,'读取文件');
 assert.equal(helperState({phase:'waiting'}),'waiting');
 assert.equal(helperState({},{tool:'x'}),'tool');
});

test('新思考尚无文字时不会把上一次正文当成本次进展',async()=>{
 const {helperView,workingVoices}=await load('voice-rotation.mjs');
 const view=helperView({active:true,phase:'thinking',thought:'',body:'上次正文',newBody:true});
 assert.equal(view.body,undefined);
 assert.equal(view.label,'思考中');
 const snapshot={roles:[{role:'project',generation:2,state:'running'}],live:{project:{generation:1,phase:'body',text:'旧代次'}}};
 assert.equal(workingVoices(snapshot)[0].speaking,false,'旧代次不能抢占活跃角色轮询');
});

test('展示台容量：所有模式最多两列六个；窄窗按可读尺寸减量',async()=>{
 const {stageCapacity,stageColumns,stageYields}=await load('stage-layout.mjs');
 const tall={width:900,height:1400};
 for(const desk of [false,true])for(const team of [false,true]){
  assert.deepEqual(stageCapacity({...tall,desk,team}),{columns:2,rows:3,max:6});
  assert.deepEqual(stageCapacity({width:500,height:400,desk,team}),{columns:1,rows:2,max:2});
 }
 assert.equal(stageColumns(3,{columns:2,rows:3}),1,'一列放得下就不分两列');
 assert.equal(stageColumns(4,{columns:2,rows:3}),2);
 assert.equal(stageYields({width:1100}),false,'没拉开侧栏不让位');
 assert.equal(stageYields({width:1100,pushLeft:264}),false,'剩余宽度足够双栏，不按固定半屏误收起');
 assert.equal(stageYields({width:2560,pushLeft:264}),false,'放得下不让位');
});

test('胶囊显示全部信息；自定义外观有上限',async()=>{
 const {capsuleText}=await load('team.mjs');
 assert.equal(capsuleText({name:'Vaya',model:'relay/glm-5.3',input:'1.2K',output:'300',cache:'80%',context:'12%'}),'Vaya · glm-5.3 · In 1.2K · Out 300 · Cache 80% · Ctx 12%');
 assert.equal(capsuleText({name:'Cota',cache:'—'}),'Cota');
 const {TEXT_LIMITS,regionStyle}=await load('appearance.mjs');
 const fields={font_latin:{options:[{id:'a',css:'Arial, sans-serif'}]},font_cjk:{options:[{id:'b',css:'Noto, sans-serif'}]}};
 const style=regionStyle({font_latin:'a',font_cjk:'b',size:16,stroke_width:5,stroke_color:'#000',shadow_blur:40,shadow_color:'#000'},fields);
 const text=JSON.stringify(style);
 assert.ok(parseFloat(style.stroke)<=16*TEXT_LIMITS.strokeRatio,text);
 assert.ok(text.includes('0 0 '+TEXT_LIMITS.shadow+'px'),text);
 const black=regionStyle({font_latin:'a',font_cjk:'b',size:13,stroke_width:4,stroke_color:'#000000',shadow_blur:32,shadow_color:'#000000'},fields);
 assert.equal(black.stroke,'0.5px');assert.equal(black.strokeColor,'#000000d9');assert.equal(black.shadow,'0 0 12px #00000061');
});
