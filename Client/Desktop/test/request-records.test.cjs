// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: records; ledger; row
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/request-records.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const records=require('../host/request-records.cjs'),{officialLog}=require('../host/official-account.cjs');
function ledger(rows){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-requests-')),dir=path.join(data,'matrix','os-tasks','abcdef0123456789');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'usage.jsonl'),rows.map(u=>JSON.stringify({task:'t',role:'matrix',usage:u})).join('\n')+'\nnot json\n');
 return data;
}
const row=(at,host,model,input,cached=null)=>({at,host,model,kind:'chat',input_tokens:input,output_tokens:10,cached_tokens:cached,usage_reported:true,duration_ms:1500});
test('time range filters every ledger and tag before pagination and cache totals',t=>{
 const data=ledger([row('2026-11-01T00:00:00Z','local','old',1000,0),row('2026-11-06T00:00:00Z','local','edge',100,90),row('2026-11-09T00:00:00Z','local','recent',200,190)]);t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const dir=require('../../../Contracts/storage/paths.cjs').root(data,'conversations');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'usage.jsonl'),JSON.stringify({session:'private-one',role:'Cota',usage:row('2026-11-08T00:00:00Z','local','contact-model',300,270)}));
 const range={start:Date.parse('2026-11-06T00:00:00Z')/1000,end:Date.parse('2026-11-09T00:00:00Z')/1000};
 const first=records.local(data,{...range,page_size:1});assert.equal(first.total,3);assert.equal(first.rows.length,1);assert.equal(first.summary.input,600);assert.equal(first.summary.cached,550);assert(!first.models.some(m=>m.name==='old'));assert(first.models.some(m=>m.name==='contact-model'));
 const filtered=records.local(data,{...range,model:'edge'});assert.equal(filtered.total,1);assert.equal(filtered.filtered.cacheRate,90);assert.equal(filtered.summary.requests,3);assert.equal(records.local(data,{start:Date.parse('2026-11-10T00:00:00Z')/1000}).models.length,0);
 assert.equal(records.local(data).total,4);assert.equal(records.scoped(data).summary.requests,4,'conversation entries are counted once');
});
test('session detail aggregates collaborators without mixing sibling sessions or guessing old ownership',t=>{
 const data=ledger([row('2026-11-07T00:00:00Z','local','home',50,25)]);t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const dir=require('../../../Contracts/storage/paths.cjs').root(data,'conversations');fs.mkdirSync(dir,{recursive:true});
 const rows=[['lead','s1',100,50],['child','s1',200,100],['nested','',300,null],['sibling','s2',400,200],['deleted','',500,null]].map(([task,session,input,cached],i)=>({task,session,role:'Cota',usage:row('2026-11-07T01:00:0'+i+'Z','local','worker',input,cached)}));
 fs.writeFileSync(path.join(dir,'usage.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n'));
 const catalog=[{id:'s1',title:'第一段',roles:[{id:'lead',name:'Cota'},{id:'child',name:'Vaya'},{id:'nested',name:'Vaya'}]},{id:'s2',title:'第二段',roles:[{id:'sibling',name:'Cota'}]}];
 const first=records.scoped(data,{session:'s1'},catalog);assert.equal(first.summary.input,600);assert.equal(first.summary.cacheRate,50);assert.equal(first.summary.cacheComplete,false);assert.equal(first.recent.length,3);
 const all=records.scoped(data,{session:'*'},catalog);assert.equal(all.summary.input,1550);assert.equal(all.sessions.find(s=>s.id==='unattributed').input,500);assert.equal(all.sessions.find(s=>s.id==='s2').input,400);
 assert.equal(all.roles.find(r=>r.name==='Vaya').requests,2);
});
test('images and missing receipts do not dilute cache hit rate or invent token totals',()=>{
 const result=records.summarize([{kind:'chat',reported:true,input:100,output:20,cached:60,reasoning:2},{kind:'image_gen',reported:true,input:1000,output:1,cached:0},{kind:'chat',reported:false,input:999,output:999,cached:999},{kind:'chat',reported:false,estimated:true,input:200,output:30,cached:null}]);
 assert.equal(result.input,1300);assert.equal(result.cacheRate,60);assert.equal(result.unknown,1);assert.equal(result.estimated,1);assert.equal(result.complete,false);assert.equal(result.cacheComplete,false);assert.equal(result.reasoning,2);
});
test('只统计 Aieyra OS 账本：所有线路都算，按模型和来源分组，命中率只用报告缓存的请求',t=>{
 const data=ledger([row('2026-11-02T10:00:00Z','api.example.com','gpt-5',100,40),row('2026-11-02T10:05:00Z','fast.aieyra.cn','claude-opus-5-5',900),row('2026-11-02T10:06:00Z','127.0.0.1','local',50)]);
 t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const r=records.local(data,{page:1,page_size:10});
 assert.equal(r.total,3);assert.deepEqual(r.rows.map(x=>x.model),['local','claude-opus-5-5','gpt-5']);
 assert.equal(r.summary.input,1050);assert.equal(r.summary.cacheRate,40);
 assert.deepEqual(r.models.map(m=>m.name).sort(),['claude-opus-5-5','gpt-5','local']);assert.equal(r.roles[0].name,'matrix');assert.equal(r.roles[0].requests,3);
 const f=records.local(data,{model:'gpt-5'});assert.equal(f.total,1);assert.equal(f.filtered.requests,1);assert.equal(f.summary.requests,3);assert.equal(f.models.length,3);
 assert.equal(records.local(data,{role:'nobody'}).total,0);
 assert.ok(!JSON.stringify(r).includes('sk-'));
});
test('账号站日志解析：额度换算美元，other 里的缓存',()=>{
 const l=officialLog({id:3,created_at:1762077600,model_name:'claude-opus-5-5',token_name:'主力',prompt_tokens:1000,completion_tokens:50,quota:1000000,use_time:4,is_stream:true,other:'{"cache_tokens":700,"cache_creation_tokens":100}'});
 assert.equal(l.cost,2);assert.equal(l.cached,700);assert.equal(l.cache_write,100);assert.equal(l.duration_ms,4000);assert.equal(l.at,'2025-11-02T10:00:00.000Z');
 assert.equal(officialLog({created_at:0}),null);
});

test('home detail follows durable scope across runtimes without merging other or legacy sessions',t=>{
 const data=ledger([row('2026-11-07T00:00:00Z','local','legacy',50)]);t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const base=path.join(require('../../../Contracts/storage/paths.cjs').root(data,'tasks'),'os-tasks');
 for(const [runtime,entries]of [['runtime-one',[['home-one',100],['home-two',200]]],['runtime-two',[['home-one',300]]]]){
  const dir=path.join(base,runtime);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'usage.jsonl'),entries.map(([session,input])=>JSON.stringify({session,task:'t-'+input,role:'matrix',usage:row('2026-11-07T01:00:00Z','local','home',input,50)})).join('\n'));
 }
 const current={session_id:'runtime-two',link:{scope:'home-one'}};
 const resumed=records.forWorkspace(data,{session:'runtime-two'},[],current);
 assert.equal(resumed.session,'runtime-two');assert.equal(resumed.scope,'home-one');assert.equal(resumed.summary.input,400);assert.equal(resumed.recent.length,2);
 assert.equal(resumed.sessions.find(s=>s.id==='abcdef0123456789').input,50);
 const switched=records.forWorkspace(data,{session:'home-two'},[],{...current,link:{scope:'home-two'}});assert.equal(switched.summary.input,200);
 assert.equal(records.forWorkspace(data,{session:'home-one'},[],{...current,link:{scope:'home-two'}}).summary.input,400);
 assert.equal(records.forWorkspace(data,{session:'*'},[],current).summary.input,650);
});
test('usage detail keeps durable current totals and marks incomplete historical rows',async()=>{
 const {usageScope,usageReport}=await import('../ui/usage-view.mjs');
 const shown={session_id:'runtime',link:{scope:'home-one'},roles:[{role:'matrix',usage:{samples:2,input_tokens:400,output_tokens:20,reported:2,complete:true},context:{tokens:10,window:100}}],greeting_usage:{samples:1,input_tokens:50,output_tokens:5,reported:1,complete:true}};
 assert.equal(usageScope(shown),'home-one');
 const partial={session:'home-one',summary:{samples:1,input:100,output:10},recent:[]};
 const current=usageReport(shown,partial);assert.equal(current.summary.input,450);assert.equal(current.summary.samples,3);assert.equal(current.partial,true);assert.equal(current.context.tokens,10);
 assert.equal(usageReport(shown,partial).summary.input,450);
 const other=usageReport(shown,{session:'home-two',summary:{samples:1,input:200,output:10}});assert.equal(other.summary.input,450);assert.equal(other.ledger,null);assert.equal(other.context.tokens,10);
 const stale=usageReport({...shown,link:{scope:'home-two'},roles:[],greeting_usage:null},partial);assert.equal(stale.summary.input,0);assert.equal(stale.ledger,null);assert.equal(stale.partial,false);
 assert.equal(usageReport(shown,{...partial,summary:{samples:3,input:450,output:25}}).partial,false);
});
