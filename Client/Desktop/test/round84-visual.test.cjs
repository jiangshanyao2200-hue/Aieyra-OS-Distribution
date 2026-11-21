// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: test
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/round84-visual.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('长 brief 留头尾，中文按两格算',async()=>{
 const {middleEllipsis}=await import('../ui/tool-digest.mjs');
 assert.equal(middleEllipsis('short',20),'short');
 const cut=middleEllipsis('cd /very/long/path/to/project && npm run build --workspace=desktop',30);
 assert.ok(cut.includes('…'));assert.ok(cut.startsWith('cd /very'));assert.ok(cut.endsWith('=desktop')||cut.endsWith('desktop'));assert.ok(cut.length<=30);
 const wide=middleEllipsis('文'.repeat(40),20);assert.ok(Array.from(wide).length<=11);
});

test('长文本只留头尾，说清省略了多少',async()=>{
 const {foldText}=await import('../ui/tool-digest.mjs');
 const lines=foldText(Array.from({length:40},(_,i)=>'L'+i).join('\n'));
 assert.equal(lines.hidden,25);assert.equal(lines.unit,'行');assert.match(lines.head,/^L0/);assert.match(lines.tail,/L39$/);
 const chars=foldText('x'.repeat(2000));assert.equal(chars.unit,'字');assert.equal(chars.hidden,1100);
 assert.equal(foldText('short').hidden,0);
});

test('生成文档有详情：标题进事实，正文是一段，系统提示不打扰',async()=>{
 const {activityDigest}=await import('../ui/tool-digest.mjs');
 const d=activityDigest({tool:'report',action:'report',state:'completed',input_preview:{title:'周报',format:'md',content:'第一行\n第二行'},preview:{ok:true,document:{id:'d1',title:'周报',format:'md'},notice:'文档已出现在右侧报告入口，正文只需一句简短说明。'}});
 assert.deepEqual(d.facts.map(f=>f.label),['文档','格式']);
 assert.equal(d.sections.find(s=>s.label==='正文').text,'第一行\n第二行');
 assert.ok(!JSON.stringify(d).includes('右侧报告入口'));
});

test('失败放在最前，短回执并进事实',async()=>{
 const {activityDigest}=await import('../ui/tool-digest.mjs');
 const failed=activityDigest({tool:'settings',action:'update',state:'failed',preview:{ok:false,error:'保存失败'}});
 assert.equal(failed.error,'保存失败');
 const ok=activityDigest({tool:'project',action:'read',state:'completed',preview:{path:'a.go',lines:[{line:3,text:'x'}],total_lines:8}});
 assert.ok(ok.facts.some(f=>f.value==='a.go'));assert.equal(ok.error,'');
});

test('用量图：未报告不算零，图片请求不进图',async()=>{
 const {requestBars,compact,roleName}=await import('../ui/usage-view.mjs');
 const {bars,maxInput,maxOutput}=requestBars([
  {kind:'matrix',role:'matrix',input:1000,cached:900,output:50},
  {kind:'matrix',role:'project',input:400,cached:null,output:70},
  {kind:'image_gen',input:9999,cached:null,output:9999},
 ]);
 assert.equal(bars.length,2);assert.equal(maxInput,1000);assert.equal(maxOutput,70);
 assert.equal(bars[0].miss,100);assert.equal(bars[1].unknown,400);assert.equal(bars[1].known,false);
 assert.equal(compact(1234567),'1.23M');assert.equal(compact(1500),'1.5K');assert.equal(roleName('matrix'),'Eyra');assert.equal(roleName('project'),'Vaya');
});

test('当前会话账本：只读一个目录，拒绝路径穿越',()=>{
 const {session}=require('../host/request-records.cjs');
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-usage-'));
 try{
  const dir=path.join(data,'matrix','os-tasks','s1');fs.mkdirSync(dir,{recursive:true});
  const row=(at,input,cached)=>JSON.stringify({task:'t',role:'matrix',usage:{at,model:'m',kind:'matrix',input_tokens:input,output_tokens:1,cached_tokens:cached,usage_reported:true}});
  fs.writeFileSync(path.join(dir,'usage.jsonl'),row('2026-11-04T02:00:00Z',100,50)+'\n'+row('2026-11-04T01:00:00Z',200,null)+'\n');
  const v=session(data,{session:'s1'});
  assert.equal(v.recent.length,2);assert.equal(v.recent[0].input,200);assert.equal(v.summary.requests,2);assert.equal(v.roles[0].name,'matrix');
  assert.equal(session(data,{session:'missing'}).recent.length,0);
  assert.throws(()=>session(data,{session:'../s1'}),/会话编号无效/);assert.throws(()=>session(data,{session:'..'}),/会话编号无效/);assert.throws(()=>session(data,{}),/会话编号无效/);
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});

test('单独窗口的最佳大小：16:10，不超出工作区',()=>{
 const {bestWindowSize}=require('../host/module-window.cjs');
 const size=bestWindowSize({width:1920,height:1040},{minWidth:480,minHeight:380});
 assert.ok(size.width<=1920*.78+1&&size.height<=1040*.82+1);assert.ok(Math.abs(size.width/size.height-1.6)<.02);
 const small=bestWindowSize({width:800,height:500},{minWidth:480,minHeight:380});
 assert.ok(small.width>=480&&small.height>=380&&small.width<=800&&small.height<=500);
});

test('桌面最小化：收起再恢复，预览拿得到画面',async()=>{
 const {createDeskPark}=require('../host/desk-park.cjs');
 let hidden=false,changed=0,closed=null,bounds={x:10,y:10,width:400,height:300};
 const host={isDestroyed:()=>false,isMaximized:()=>false,getBounds:()=>bounds,getNormalBounds:()=>bounds,once(name,fn){if(name==='closed')closed=fn;},hide(){hidden=true;},setOpacity(){},setBounds(b){bounds=b;},maximize(){}};
 const image={isEmpty:()=>false,getSize:()=>({width:1200,height:800}),resize(){return this;},toJPEG:()=>Buffer.from('jpg')};
 const contents={isDestroyed:()=>false,capturePage:async(_,o)=>{assert.equal(o.stayHidden,true);return image;}};
 const park=createDeskPark({active:()=>true,owner:()=>({getContentBounds:()=>({x:0,y:0,width:1200,height:800})}),motion:()=>false,notify:()=>{changed++;}});
 assert.equal(park.take('notes',host),true);assert.equal(park.parked('notes'),true);assert.equal(hidden,true);assert.ok(changed>0);
 assert.equal(park.take('notes',host),false);
 const shot=await park.preview('notes',contents);assert.equal(shot.available,true);assert.match(shot.url,/^data:image\/jpeg;base64,/);assert.equal(shot.parked,true);
 assert.equal(park.restore('notes'),true);assert.equal(park.parked('notes'),false);assert.equal(park.restore('notes'),false);
 // 同一活页截图失败才回退上一张；来源消失后不复用旧画面。
 contents.capturePage=async()=>{throw Error('temporary capture failure');};
 assert.equal((await park.preview('notes',contents)).url,shot.url);
 assert.equal((await park.preview('notes')).available,false);
 park.take('notes',host);closed();assert.equal(park.parked('notes'),false);
});
