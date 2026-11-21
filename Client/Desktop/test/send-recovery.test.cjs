// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: attachment; refused
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/send-recovery.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

require('node:test').test('same-ID edited-message retries keep one outbox record and preserve its bytes',async()=>{
 const assert=require('node:assert/strict'),{SendQueue}=await import('../ui/send-queue.mjs');let writes=0;
 const q=new SendQueue('owned',[],()=>writes++),first=q.add('原文\r\n🙂','inline-id');
 assert.equal(q.add('原文\r\n🙂','inline-id'),first);assert.equal(q.entries.length,1);assert.equal(writes,1);
 assert.throws(()=>q.add('changed payload','inline-id'),/原请求编号/);assert.equal(q.entries[0].text,'原文\r\n🙂');
 assert.throws(()=>q.add('🙂'.repeat(17000),'too-large'),/64 KiB/);assert.equal(q.entries.length,1);assert.equal(writes,1);
});
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {requestCore}=require('../host/bridge.cjs');
const attachment={name:'sample.txt',asset:'C:/fixtures/runtime/attachments/'+'a'.repeat(64),sha256:'a'.repeat(64),bytes:2,kind:'file',mime:'application/octet-stream'};
const refused=(entry,patch={})=>Object.assign(Error('attachment refused'),{send_rejection:{code:'attachment_rejected',task_id:entry.session_id,request_id:entry.request_id,...patch}});

test('definitive rejection persists exact bytes, edits with a new ID and survives reload',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let saved;
 const q=new SendQueue('task',[],entries=>saved=structuredClone(entries));q.add('body\r\n\t原文','original',[attachment]);q.add('later','later');
 await assert.rejects(q.drain(async entry=>{throw refused(entry);}),/refused/);
 const reload=new SendQueue('task',saved,entries=>saved=structuredClone(entries));
 const edited=reload.revise('original',reload.entries[0].text,[]);assert.notEqual(edited.request_id,'original');assert.equal(edited.text,'body\r\n\t原文');assert.equal(reload.entries[1].request_id,'later');
 const next=new SendQueue('task',saved);const sent=[];await next.drain(async entry=>sent.push(entry));assert.equal(sent[0].request_id,edited.request_id);assert.equal(sent[0].rejection,undefined);assert.equal(sent[1].request_id,'later');assert.equal(next.entries.length,0);
});

test('unknown, mismatched and failed-confirmation responses never authorize editing or discard',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');
 for(const make of [()=>Error('lost ACK'),e=>refused(e,{task_id:'other'}),e=>refused(e,{request_id:'other'}),e=>refused(e,{code:'unknown'})]){
  const q=new SendQueue('task');q.add('keep','original');await assert.rejects(q.drain(async entry=>{throw make(entry);}));
  assert.equal(q.entries[0].rejection,undefined);assert.throws(()=>q.revise('original','changed',[]),/确认/);assert.throws(()=>q.discard('original'),/确认/);assert.equal(q.entries[0].request_id,'original');
 }
 const q=new SendQueue('task');q.add('keep','original');await assert.rejects(q.drain(async entry=>{throw refused(entry);},async()=>{throw Error('confirmation unavailable');}),/confirmation/);assert.equal(q.entries[0].rejection,undefined);
});

test('confirmed receipt wins over rejection and task restore excludes foreign entries',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');const q=new SendQueue('task');q.add('keep','original');
 await q.drain(async entry=>{throw refused(entry);},async()=>true);assert.equal(q.entries.length,0);
 const restored=new SendQueue('other',[{session_id:'task',request_id:'original',text:'private',rejection:{code:'attachment_rejected'}}]);assert.equal(restored.entries.length,0);
});

test('retry durably revokes edit permission before dispatch and uncertain retry retains the same ID',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let saved,release;
 const q=new SendQueue('task',[],entries=>saved=structuredClone(entries));q.add('keep','original');await assert.rejects(q.drain(async entry=>{throw refused(entry);}));
 const retry=q.drain(async()=>{assert.equal(saved[0].rejection,undefined);await new Promise(resolve=>release=resolve);throw Error('lost retry');});
 assert.throws(()=>q.revise('original','changed',[]),/确认/);assert.throws(()=>q.discard('original'),/确认/);release();await assert.rejects(retry,/lost retry/);
 const reload=new SendQueue('task',saved);assert.equal(reload.entries[0].request_id,'original');assert.throws(()=>reload.discard('original'),/确认/);
});

test('storage failure preserves rejected entry and never dispatches before revocation is stored',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let fail=false;
 const q=new SendQueue('task',[],()=>{if(fail)throw Error('storage full');});q.add('keep','original',[attachment]);await assert.rejects(q.drain(async entry=>{throw refused(entry);}));const original=q.entries[0];fail=true;
 assert.throws(()=>q.revise('original','edit',[]),/storage full/);assert.strictEqual(q.entries[0],original);assert.throws(()=>q.discard('original'),/storage full/);assert.strictEqual(q.entries[0],original);
 let calls=0;await assert.rejects(q.drain(async()=>calls++),/storage full/);assert.equal(calls,0);assert.strictEqual(q.entries[0],original);
 fail=false;q.revise('original','',[]);await assert.rejects(q.drain(async()=>calls++),/添加文字/);assert.equal(calls,0);q.discard(q.entries[0].request_id);assert.equal(q.entries.length,0);
});

test('failed rejection persistence leaves a request uncertain and does not mutate the durable queue',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let fail=false,saved;
 const q=new SendQueue('task',[],entries=>{if(fail)throw Error('storage full');saved=structuredClone(entries);});q.add('keep','original');fail=true;
 await assert.rejects(q.drain(async entry=>{throw refused(entry);}),/storage full/);assert.equal(q.entries[0].rejection,undefined);assert.deepEqual(q.entries,saved);
});

test('core bridge exposes only exact HTTP 400 task-send rejection receipts',async t=>{
 let status=400,receipt={code:'attachment_rejected',task_id:'task',request_id:'original'},drop=false;
 const server=http.createServer((req,res)=>{req.resume();if(drop){req.socket.destroy();return;}res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'rejected',send_rejection:receipt}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const descriptor={url:`http://127.0.0.1:${server.address().port}/v1/rpc`,token:'a'.repeat(64)},args={task_id:'task',request_id:'original'};
 for(const row of [{status:400,action:'workspace.task_send',patch:{},allowed:true},{status:400,action:'workspace.task_send',patch:{code:'not_admitted'},allowed:true},{status:500,action:'workspace.task_send',patch:{}},{status:200,action:'workspace.task_send',patch:{}},{status:400,action:'matrix.send',patch:{}},{status:400,action:'workspace.task_send',patch:{task_id:'other'}},{status:400,action:'workspace.task_send',patch:{request_id:'other'}},{status:400,action:'workspace.task_send',patch:{code:'other'}}]){
  status=row.status;receipt={code:'attachment_rejected',task_id:'task',request_id:'original',...row.patch};
  await assert.rejects(requestCore(descriptor,row.action,args),error=>{assert.deepEqual(error.send_rejection,row.allowed?receipt:undefined);return true;});
 }
 drop=true;await assert.rejects(requestCore(descriptor,'workspace.task_send',args),error=>{assert.equal(error.send_rejection,undefined);return true;});
});

test('checking an uncertain receipt never resends it or dispatches newer queued work',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');let stored;
 const q=new SendQueue('task',[],rows=>stored=structuredClone(rows));q.add('原文\r\n🙂','original');
 let sent=0;await assert.rejects(q.drain(async()=>{sent++;throw Error('lost ACK');}),/lost ACK/);q.add('后来输入','later');
 const reloaded=new SendQueue('task',stored);let checks=0;
 assert.equal(await reloaded.check(async e=>{checks++;assert.equal(e.request_id,'original');return false;}),false);
 assert.deepEqual(reloaded.entries.map(e=>e.request_id),['original','later']);
 await assert.rejects(reloaded.drain(async()=>sent++,async()=>false),/原消息继续保留/);assert.equal(sent,1);
 assert.equal(await reloaded.check(async()=>{checks++;return true;}),true);
 assert.deepEqual(reloaded.entries.map(e=>e.request_id),['later']);assert.equal(reloaded.entries[0].delivery,'prepared');assert.equal(sent,1);assert.equal(checks,2);
 await reloaded.drain(async e=>{sent++;assert.equal(e.request_id,'later');});assert.equal(sent,2);
});

test('a failed read-only confirmation preserves the pending request and its exact original',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');const original={session_id:'task',request_id:'stable',text:'原文\r\n\t🙂',delivery:'pending',attachments:[attachment]};
 const q=new SendQueue('task',[original],()=>{throw Error('disk full');});
 await assert.rejects(q.check(async()=>{throw Error('lookup offline');}),/lookup offline/);assert.strictEqual(q.entries[0],original);assert.equal(q.running,null);
 await assert.rejects(q.check(async()=>true),/disk full/);assert.strictEqual(q.entries[0],original);assert.equal(q.running,null);
});

test('only a matching not-admitted receipt authorizes editing after an ordinary model admission error',async()=>{
 const {SendQueue}=await import('../ui/send-queue.mjs');const q=new SendQueue('task');q.add('keep','original');
 await assert.rejects(q.drain(async e=>{throw refused(e,{code:'not_admitted'});}));
 assert.equal(q.entries[0].rejection.code,'not_admitted');assert.notEqual(q.revise('original','fixed',[]).request_id,'original');
 const other=new SendQueue('task');other.add('keep','original');await assert.rejects(other.drain(async e=>{throw refused(e,{code:'not_admitted',request_id:'other'});}));
 assert.equal(other.entries[0].rejection,undefined);assert.throws(()=>other.discard('original'),/确认/);
});
