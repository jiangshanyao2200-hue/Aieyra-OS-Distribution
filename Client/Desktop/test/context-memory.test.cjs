// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fixture
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/context-memory.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMemoryStore}=require('./fixtures/legacy-memory-store.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eyra-memory-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'memory.sqlite');}
test('semantic continuity uses cross-window CAS and prevents late resurrection after correction or forget',t=>{
 const file=fixture(t),a=createMemoryStore(file),b=createMemoryStore(file),c={project:'p',session:'one'},d={project:'q',session:'two'};
 const read=s=>s.call({action:'continuity_snapshot'}),commit=(s,snapshot,id,content,context=c)=>s.call({action:'continuity_commit',expected_epoch:snapshot.epoch,expected_version:snapshot.version,request_id:id,content},context);
 try{
  const start=read(a);assert.equal(start.content,'');
  assert.equal(commit(a,start,'one','semantic first').ok,true);
  assert.equal(commit(b,start,'two','stale',d).conflict,true);
  assert.equal(commit(b,read(b),'two','semantic first plus second',d).ok,true);
  const r=a.call({action:'read',id:'os-continuity'},c).record,late=read(b);
  a.call({action:'update',id:r.id,expected_revision:r.revision,content:'user correction'},c);
  assert.equal(commit(b,late,'late','old content').forgotten_or_corrected,true);
  const current=read(a);assert.equal(current.content,'user correction');
  const corrected=a.call({action:'read',id:r.id},c).record;
  a.call({action:'forget',id:r.id,expected_revision:corrected.revision},c);
  assert.equal(commit(b,current,'forgotten-late','user correction').forgotten_or_corrected,true);
  assert.equal(read(a).content,'');
  assert.equal(commit(a,start,'one','semantic first').replayed,true);
  assert.equal(read(a).content,'');
  assert.equal(commit(a,read(a),'new','fresh semantic memory').ok,true);
 }finally{a.close();b.close();}
 const s=createMemoryStore(file);try{assert.equal(read(s).content,'fresh semantic memory');assert.equal(s.call({action:'search',kind:'summary'},c).records.length,1);}finally{s.close();}
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file);try{assert.equal(db.prepare('SELECT count(*) n FROM os_continuity').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM memory_revisions').get().n,0);}finally{db.close();}
});
test('OS runs merge into one bounded memory; correction, restart and forgetting defeat replay',t=>{
 const file=fixture(t),{DatabaseSync}=require('node:sqlite');let now=1700000000000;
 let a=createMemoryStore(file,{now:()=>now++}),b=createMemoryStore(file,{now:()=>now++});
 const first={action:'consolidate',request_id:'turn',content:'old continuity from window one'},c={project:'p',session:'one'};
 try{
  a.call(first,c);b.call({action:'consolidate',request_id:'turn',content:'window two continuity'},{project:'q',session:'two'});
  let r=a.call({action:'read',id:'os-continuity'},c).record;
  assert.equal(r.revision,2);assert.match(r.content,/window one/);assert.match(r.content,/window two/);
  assert.equal(b.call(first,c).replayed,true);
  assert.throws(()=>b.call({...first,content:'different'},c),/其他内容/);
  assert.throws(()=>b.call({action:'update',id:r.id,expected_revision:1,content:'stale'},c));
  a.call({action:'update',id:r.id,expected_revision:r.revision,content:'corrected continuity'},c);
  b.call({action:'consolidate',request_id:'next',content:'new evidence'},c);
  r=a.call({action:'read',id:r.id},c).record;assert.match(r.content,/corrected/);assert.doesNotMatch(r.content,/old continuity|window two/);
  a.call({action:'forget',id:r.id,expected_revision:r.revision},c);
  assert.equal(b.call(first,c).replayed,true);assert.throws(()=>b.call({action:'read',id:r.id},c),/不存在/);
 }finally{a.close();b.close();}
 a=createMemoryStore(file,{now:()=>now++});
 try{
  assert.equal(a.call(first,c).replayed,true);
  for(let i=0;i<150;i++)a.call({action:'consolidate',request_id:'bounded-'+i,content:'entry '+i+' '+('文'.repeat(2000))},c);
  const r=a.call({action:'read',id:'os-continuity'},c).record;
  assert.ok(r.content.length<=12000);assert.match(r.content,/entry 149/);assert.doesNotMatch(r.content,/old continuity|corrected continuity/);
  assert.equal(a.call({action:'search',kind:'summary'},c).records.length,1);
  // R56（2026-11-02）：记忆不再拒绝或遮蔽账号与密钥，原文保留。
  a.call({action:'consolidate',request_id:'secret',content:'Bearer '+('a'.repeat(30))},c);
  assert.match(a.call({action:'read',id:'os-continuity'},c).record.content,/Bearer a{30}/);
 }finally{a.close();}
 const db=new DatabaseSync(file);try{
  assert.equal(db.prepare('SELECT count(*) n FROM os_continuity').get().n,128);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_revisions').get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM os_continuity WHERE content LIKE '%old continuity%'").get().n,0);
 }finally{db.close();}
});
test('task surface retrieves old relevant records, honors corrections and project boundaries', t=>{
 let now=1000000000000;const s=createMemoryStore(fixture(t),{now:()=>now++}),c={project:'p1',session:'s'};
 try {
 const old=s.call({action:'record',title:'payment gateway',content:'gateway settlement uses oldContract',source:'src/pay.ts hash fixture'},c).record;
 for(let i=0;i<530;i++)s.call({action:'record',title:'unrelated '+i,content:'flowers record '+i},c);
 s.call({action:'record',title:'payment gateway',content:'other project secret'},{project:'p2'});
 let result=s.call({action:'surface',query:'payment gateway',token_budget:1500},c);
 assert.equal(result.records[0].id,old.id);assert.ok(result.scanned<=512);assert.ok(!JSON.stringify(result).includes('other project'));
 s.call({action:'update',id:old.id,expected_revision:1,title:'inventory router',content:'newContract replaces old source'},c);
 assert.ok(!s.call({action:'surface',query:'payment gateway'},c).records.some(r=>r.id===old.id));
 result=s.call({action:'surface',query:'inventory router'},c);assert.equal(result.records[0].revision,2);assert.match(result.records[0].source,/src\/pay/);
 s.call({action:'forget',id:old.id,expected_revision:2},c);assert.equal(s.call({action:'surface',query:'inventory router'},c).records.length,0);
 } finally { s.close(); }
});
test('memory survives restart, isolates projects, enforces revisions, and forget removes history/indexes',t=>{
 const file=fixture(t),c={project:'p1',session:'s'},s=createMemoryStore(file);
 const r=s.call({action:'record',title:'编辑偏好',content:'用户明确要求默认采用中文说明。',kind:'preference',request_id:'a'},c).record;
 assert.equal(s.call({action:'record',title:'编辑偏好',content:'用户明确要求默认采用中文说明。',kind:'preference',request_id:'a'},c).record.id,r.id);
 assert.throws(()=>s.call({action:'record',title:'重复',content:'same',request_id:'a'},c));
 assert.equal(s.call({action:'search'},{project:'p2'}).records.length,0);
 assert.throws(()=>s.call({action:'read',id:r.id},{project:'p2'}));
 assert.throws(()=>s.call({action:'update',id:r.id,expected_revision:0,content:'no'},c));
 const next=s.call({action:'update',id:r.id,expected_revision:1,content:'用户改为英文说明。'},c).record;assert.equal(next.revision,2);s.close();
 const b=createMemoryStore(file);assert.equal(b.call({action:'read',id:r.id},c).record.content,next.content);
 assert.equal(b.call({action:'surface'},c).records[0].id,r.id);
 b.call({action:'forget',id:r.id,expected_revision:2},c);assert.equal(b.call({action:'search',query:'英文',history:true},c).records.length,0);b.close();
});
test('large memory stays bounded and supports keyset history retrieval with equal timestamps',t=>{
 const s=createMemoryStore(fixture(t),{now:()=>1000000000000}),c={project:'p',session:'s'};
 for(let i=0;i<1100;i++)s.call({action:'record',title:'条目 '+i,content:'sharedtoken bounded memory '+i},c);
 let cursor,ids=new Set();do{const r=s.call({action:'search',query:'sharedtoken',history:true,limit:20,cursor},c);assert.ok(r.scanned<=512);for(const m of r.records){assert.ok(!ids.has(m.id));ids.add(m.id);}cursor=r.next_cursor;}while(cursor);
 assert.equal(ids.size,1100);assert.ok(JSON.stringify(s.call({action:'surface'},c)).length<4000);s.close();
});
test('long-term plans retain due time and state; dream is restart-only, leased, fictional and acknowledged once',t=>{
 const file=fixture(t),c={project:'p',session:'s'};let time=1000000000000;let s=createMemoryStore(file,{now:()=>time,startedAt:time});
 const p=s.call({action:'record',kind:'plan',title:'星空花园',content:'下周检查星空花园设计进展。',due_at:'2026-10-01T08:00:00Z'},c).record;
 assert.equal(s.call({action:'plans'},c).records[0].due_at,'2026-10-01T08:00:00.000Z');assert.equal(s.call({action:'dream',mode:'claim'},c).dream,null);
 s.close();time+=10000;s=createMemoryStore(file,{now:()=>time});const d=s.call({action:'dream',mode:'claim'},c).dream;assert.ok(d.fiction);assert.ok(!d.content.includes("只是记忆的联想"));assert.equal(s.call({action:'dream',mode:'claim'},c).dream,null);
 assert.equal(s.call({action:'dream',mode:'claim'},{project:'other'}).dream,null);
 s.call({action:'dream',mode:'release',id:d.id,claim:d.claim},c);const d2=s.call({action:'dream',mode:'claim'},c).dream;assert.equal(d2.id,d.id);
 s.call({action:'dream',mode:'ack',id:d2.id,claim:d2.claim},c);assert.equal(s.call({action:'dream',mode:'claim'},c).dream,null);
 s.call({action:'update',id:p.id,expected_revision:1,status:'done'},c);assert.equal(s.call({action:'plans'},c).records.length,0);s.close();
});
test('pending legacy dreams omit the old disclaimer without rewriting stored content',t=>{
 const file=fixture(t),{DatabaseSync}=require('node:sqlite'),stored='梦里，星星落进了一本书。只是记忆的联想。';
 const initial=createMemoryStore(file);initial.close();
 const db=new DatabaseSync(file);db.prepare('INSERT INTO dreams(id,scope,content,created,watermark) VALUES(?,?,?,?,?)').run('legacy','p',stored,1,1);db.close();
 const s=createMemoryStore(file),c={project:'p',session:'s'};
 try {
  assert.equal(s.call({action:'dream'},c).dream.content,'梦里，星星落进了一本书。');
  const claimed=s.call({action:'dream',mode:'claim'},c).dream;assert.equal(claimed.id,'legacy');assert.equal(claimed.content,'梦里，星星落进了一本书。');
  s.call({action:'dream',mode:'ack',id:claimed.id,claim:claimed.claim},c);assert.equal(s.call({action:'dream',mode:'claim'},c).dream,null);
 } finally {s.close();}
 const after=new DatabaseSync(file);try {assert.equal(after.prepare('SELECT content FROM dreams WHERE id=?').get('legacy').content,stored);} finally {after.close();}
});
test('Astra relay receives model capabilities, effort, encrypted reasoning and 25K defaults without changing credential',()=>{
 const caps=require('../src/model-capabilities.cjs'),spec=require('../src/spec.cjs'),pool=require('../src/model-pool.cjs');
 const p=require('../host/connection.cjs').draftProfile({base_url:'https://relay.invalid/v1',model:'gpt-6-astra',api_protocol:'responses'});
 assert.equal(p.context_window,1050000);assert.equal(p.output_limit,128000);
 assert.deepEqual(caps.forProfile(p).find(x=>x.key==='reasoning_effort').values,['low','medium','high','xhigh','max']);
 const edited=caps.edit(p,{reasoning_effort:'xhigh'});const req=spec.buildRequest({...spec.defaults(),...edited.parameters,base_url:p.base_url,adapter:'openai',api_protocol:'responses',model:p.model},[{role:'user',content:'hello'}],true);
 assert.equal(req.reasoning.effort,'xhigh');assert.deepEqual(req.include,['reasoning.encrypted_content']);assert.equal(spec.defaults().context_working_tokens,200000);
 assert.throws(()=>caps.edit(p,{reasoning_effort:'none'}));
 const prior={...p,context_window:8192,output_limit:8192,context_window_source:'conservative_client_budget',parameter_specs:[{key:'stream',type:'boolean'}]};
 const migrated=pool.migrate({model_pool_version:1,api_profiles:[prior]});assert.equal(migrated.api_profiles[0].context_window,1050000);assert.equal(prior.context_window,8192);
 const constrained={...prior,context_window_source:'provider_catalog'};assert.equal(pool.migrate({model_pool_version:1,api_profiles:[constrained]}).api_profiles[0].context_window,8192);
});
test('workspace preferences are versioned and reveal only allowed local options',async t=>{
 const file=fixture(t)+'.json',spec=require('../src/spec.cjs');fs.writeFileSync(file,JSON.stringify({...spec.defaults(),api_key:'synthetic-credential'}));
 const service=require('../src/service.cjs').createService(file);t.after(()=>service.close());
 const read=()=>service.call('system:settings',{action:'onboarding_preferences',session_id:'test'});
 const r=await read();assert.equal(r.ok,true);assert.equal(r.settings.context_working_tokens,200000);assert.ok(!JSON.stringify(r).includes('synthetic-credential'));
 const next=await service.call('system:settings',{action:'onboarding_preferences',arguments:{expected_version:r.version,patch:{context_working_tokens:32000,dreams_enabled:false}},session_id:'test'});assert.equal(next.ok,true);assert.equal(next.settings.context_working_tokens,32000);
 const stale=await service.call('system:settings',{action:'onboarding_preferences',arguments:{expected_version:r.version,patch:{context_working_tokens:50000}},session_id:'test'});assert.equal(stale.ok,false);assert.equal((await read()).settings.context_working_tokens,32000);
 const forbidden=await service.call('system:settings',{action:'onboarding_preferences',arguments:{expected_version:next.version,patch:{api_key:'wrong'}}});assert.equal(forbidden.ok,false);
});
